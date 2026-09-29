// api/import.js — first-party "import relay" (Vercel Serverless Function).
//
// Fetches a user-supplied URL server-side and returns its bytes, so the browser
// can import from hosts that block direct cross-origin reads — notably Google
// Drive, which sends no CORS headers to a real browser. This runs on the app's
// OWN origin, so no third party ever sees the request.
//
// Security (this is an internet-facing fetch endpoint):
//  - SSRF: http(s) only; localhost/.local/.internal refused; the resolved
//    address must be GLOBAL UNICAST (an allowlist — see isGlobalUnicast), which
//    refuses private/loopback/link-local/CGNAT/cloud-metadata, multicast,
//    reserved and documentation space, and every IPv4-in-IPv6 wrapper except the
//    plain ::ffff: mapping (which is unwrapped and re-checked). Checked AFTER
//    DNS resolution and again on every redirect hop.
//  - DNS-rebinding: the resolved+vetted IPs are PINNED to the connection via an
//    undici dispatcher, so fetch cannot re-resolve to a different address
//    between validation and connection (TOCTOU).
//  - Abuse: browsers can only reach it first-party (Sec-Fetch-Site), responses
//    are CORS-restricted to the app's two exact origins, and a best-effort
//    per-IP rate limit plus hard size/time caps bound what one call costs. It
//    is NOT closed to non-browser clients — a script can send any
//    Sec-Fetch-Site value — so the real abuse controls are the platform's
//    (docs/import-relay.md ▸ Operating it: firewall rate limit, spend alerts).
//  - Every request emits ONE structured JSON log line (host, status, bytes,
//    ms, reason) — never the URL's path or query, which can carry tokens.

import dns from "node:dns/promises";
import net from "node:net";
import { Agent } from "undici";

// Vercel Functions cannot return a response body much over 4.5 MB, so a larger
// upstream used to be fetched in full and then fail at the platform with an
// opaque error. Refuse it here instead, with a message that says what to do.
export const MAX_BYTES = 4_000_000;
export const TOO_LARGE_MESSAGE =
  "That file is larger than the 4 MB the import relay can carry. Download it and drag it into the editor instead.";
const TIMEOUT_MS = 20_000;
const MAX_HOPS = 5;
const RATE_MAX = 40; // requests per window per IP (best-effort, per warm instance)
const RATE_WINDOW_MS = 60_000;

// Origins allowed to READ relayed responses cross-origin: the two production
// origins, exactly. Same-origin requests need no grant, which is how a preview
// deployment calls its own relay — so the old `markdown-studio-*.vercel.app`
// pattern bought nothing, and `markdown-studio.vercel.app` itself already
// belongs to a different product.
const ALLOWED_ORIGIN = /^https:\/\/(?:www\.)?markdownstudio\.com$/;

// ── SSRF address classification: an ALLOWLIST ──────────────────────────────
// A blocklist has to name every special range, and the old one did not
// (`::127.0.0.1`, `::ffff:0:127.0.0.1`, Teredo, multicast and reserved space all
// passed). Here an address is fetchable only when it is positively identified
// as global unicast; anything unrecognised is refused.

/** IPv4 blocks that are not global unicast: the IANA special-purpose registry's
 *  non-globally-reachable entries, plus multicast and the reserved 240/4. */
const V4_NOT_GLOBAL = [
  [[0, 0, 0, 0], 8], // "this network"
  [[10, 0, 0, 0], 8], // private
  [[100, 64, 0, 0], 10], // CGNAT
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local, incl. cloud metadata 169.254.169.254
  [[172, 16, 0, 0], 12], // private
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // TEST-NET-1
  [[192, 88, 99, 0], 24], // 6to4 relay anycast (deprecated)
  [[192, 168, 0, 0], 16], // private
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // TEST-NET-2
  [[203, 0, 113, 0], 24], // TEST-NET-3
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved, incl. limited broadcast 255.255.255.255
];

const v4ToInt = (p) => ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;

function isGlobalUnicastV4(p) {
  const n = v4ToInt(p);
  return !V4_NOT_GLOBAL.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((v4ToInt(base) & mask) >>> 0);
  });
}

/** IPv6: global unicast is 2000::/3, minus the special blocks carved out of it. */
function isGlobalUnicastV6(g) {
  // ::ffff:a.b.c.d — how a resolver or a dual-stack socket spells an IPv4
  // address. The ONLY embedded form accepted, and only for what it wraps.
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    return isGlobalUnicastV4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]);
  }
  // Everything outside 2000::/3 — ::, ::1, ::a.b.c.d, ::ffff:0:a.b.c.d, NAT64
  // 64:ff9b::/96, discard 100::/64, ULA fc00::/7, link-local fe80::/10,
  // multicast ff00::/8 — is refused by this one test.
  if ((g[0] & 0xe000) !== 0x2000) return false;
  if (g[0] === 0x2001 && (g[1] & 0xfe00) === 0) return false; // 2001::/23 IETF, incl. Teredo 2001::/32
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // 2001:db8::/32 documentation
  if (g[0] === 0x2002) return false; // 6to4 2002::/16 — an IPv4 tunnel, not a destination
  if (g[0] === 0x3fff && (g[1] & 0xf000) === 0) return false; // 3fff::/20 documentation
  return true;
}

/** Expand an IPv6 literal (incl. `::` and trailing dotted-IPv4) to 8 hextets. */
function expandIpv6(input) {
  let s = input.toLowerCase();
  const v4 = s.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) {
    const p = v4[1].split(".").map(Number);
    if (p.some((x) => x > 255)) return null;
    s = s.slice(0, v4.index) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null;
  let groups;
  if (tail === null) groups = head;
  else {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array(missing).fill("0"), ...tail];
  }
  if (groups.length !== 8) return null;
  const out = groups.map((g) => parseInt(g || "0", 16));
  return out.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff) ? null : out;
}

/** True only for a global unicast address — the ONLY kind the relay fetches. */
export function isGlobalUnicast(ip) {
  const v = net.isIP(ip);
  if (v === 4) return isGlobalUnicastV4(ip.split(".").map(Number));
  if (v === 6) {
    const g = expandIpv6(ip);
    return !!g && isGlobalUnicastV6(g); // unparseable → refused
  }
  return false; // not an IP literal at all → refused
}

/** IPs that must never be reachable through the relay (the complement). */
export function isBlockedIp(ip) {
  return !isGlobalUnicast(ip);
}

/** Validate scheme + host, resolve, and refuse blocked addresses. Returns the
 *  vetted { hostname, addrs } so the caller can pin the connection to them.
 *  Throws { status, message, reason } on rejection. */
export async function assertPublicUrl(url) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw { status: 400, message: "Only http(s) URLs can be imported.", reason: "bad_scheme" };
  }
  // Port allowlist enforced HERE (not only on the initial URL) so it also covers
  // every redirect hop — otherwise a public URL could 302 to http://host:6379
  // and the relay would connect to an arbitrary port on a public host.
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw { status: 400, message: "Only ports 80 and 443 can be imported.", reason: "bad_port" };
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw { status: 403, message: "That host can't be imported.", reason: "blocked_host" };
  }
  // No numeric-host special cases are needed here: the WHATWG URL parser has
  // already normalised decimal (2130706433), octal (0177.0.0.1), hex (0x7f.1)
  // and short (127.1) IPv4 spellings to dotted-quad by the time we see them.
  const literal = net.isIP(hostname);
  let addrs;
  try {
    addrs = literal ? [{ address: hostname, family: literal }] : await dns.lookup(hostname, { all: true });
  } catch {
    throw { status: 502, message: "Couldn't resolve that host.", reason: "dns_failed" };
  }
  if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) {
    throw { status: 403, message: "That address can't be imported.", reason: "blocked_address" };
  }
  return { hostname, addrs };
}

/** An undici dispatcher whose DNS lookup is pinned to the pre-vetted IPs, so the
 *  connection can't be rebound to a different (internal) address after validation. */
function pinnedDispatcher(hostname, addrs) {
  return new Agent({
    connect: {
      lookup(hn, opts, cb) {
        if (hn.replace(/^\[|\]$/g, "") !== hostname) return cb(new Error("host mismatch"));
        const list = addrs.map((a) => ({ address: a.address, family: a.family }));
        if (opts && opts.all) cb(null, list);
        else cb(null, list[0].address, list[0].family);
      },
    },
  });
}

/** Fetch following redirects manually, re-validating AND re-pinning each hop.
 *  `trace` records the hops taken and the host that finally answered, for the
 *  request's log line. */
async function safeFetch(startUrl, trace = {}) {
  let current = new URL(startUrl);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    trace.hops = hop;
    trace.finalHost = current.hostname;
    const { hostname, addrs } = await assertPublicUrl(current);
    const dispatcher = pinnedDispatcher(hostname, addrs);
    let resp;
    try {
      resp = await fetch(current.href, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        dispatcher,
        headers: { "user-agent": "Mozilla/5.0 (compatible; PerssonifyImport/1.0)" },
      });
    } finally {
      dispatcher.close().catch(() => {});
    }
    if (resp.status >= 300 && resp.status < 400 && resp.headers.get("location")) {
      current = new URL(resp.headers.get("location"), current);
      continue;
    }
    return resp;
  }
  throw { status: 508, message: "Too many redirects.", reason: "too_many_redirects" };
}

const tooLarge = () => ({ status: 413, message: TOO_LARGE_MESSAGE, reason: "too_large" });

/** Read a web ReadableStream response with a hard byte cap. */
async function readCapped(resp, max) {
  const declared = Number(resp.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) throw tooLarge();
  const reader = resp.body?.getReader?.();
  if (!reader) {
    const b = Buffer.from(await resp.arrayBuffer());
    if (b.length > max) throw tooLarge();
    return b;
  }
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.length;
      if (total > max) throw tooLarge();
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.cancel?.().catch(() => {});
  }
  return Buffer.concat(chunks);
}

// ── Abuse controls ──────────────────────────────────────────────────────────

const rateBuckets = new Map(); // ip -> { count, resetAt }
function rateLimited(ip) {
  const now = Date.now();
  if (rateBuckets.size > 10_000) {
    for (const [k, v] of rateBuckets) if (now > v.resetAt) rateBuckets.delete(k);
  }
  const b = rateBuckets.get(ip);
  if (!b || now > b.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > RATE_MAX;
}

/**
 * ONE structured line per request, so abuse and failures are visible in the
 * platform's log stream. Hosts only: a URL's path and query routinely carry
 * share tokens and document names, and a log line must never become the place
 * they leak from. No client IP either — the platform's own request log has it,
 * and this line must not turn into a second store of personal data.
 */
function logRequest(fields) {
  try {
    console.log(JSON.stringify({ evt: "import_relay", ...fields }));
  } catch {
    /* logging must never fail a request */
  }
}

export default async function handler(req, res) {
  const started = Date.now();
  const log = { method: req.method, sfs: null, host: null, finalHost: null, hops: 0, status: 0, bytes: 0, reason: null };
  const finish = (status, reason, body) => {
    log.status = status;
    log.reason = reason;
    log.ms = Date.now() - started;
    if (log.finalHost === log.host) log.finalHost = null; // only worth a field when a redirect changed it
    logRequest(log);
    if (body === undefined) res.status(status).end();
    else res.status(status).json(body);
  };

  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGIN.test(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "OPTIONS") return finish(204, null);
  if (req.method !== "GET") return finish(405, "method", { error: "GET only." });

  // Refuse anything but a first-party BROWSER request. Sec-Fetch-Site is a
  // forbidden header — page script cannot set it — so a browser only ever sends
  // "same-origin" (the app's own fetch) or "none" (a direct navigation) here,
  // and a cross-site page cannot use a visitor's browser to drive the relay.
  // It is NOT a defence against a non-browser client, which can send any value
  // it likes; that traffic is bounded by the caps below and by the platform
  // rate limit, not by this check.
  const sfs = req.headers["sec-fetch-site"];
  log.sfs = typeof sfs === "string" ? sfs.slice(0, 32) : null;
  if (sfs !== "same-origin" && sfs !== "none") {
    return finish(403, "sec_fetch_site", { error: "Only first-party requests are allowed." });
  }
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) return finish(429, "rate_limited", { error: "Too many requests. Try again shortly." });

  const q = req.query?.url;
  const raw = typeof q === "string" ? q : Array.isArray(q) ? q[0] : "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return finish(400, "bad_url", { error: "Missing or invalid url parameter." });
  }
  log.host = url.hostname;
  // Only fetch over the standard web ports — a relay that will connect to any
  // port is a port-scanner/abuse amplifier even against public hosts.
  if (url.port && url.port !== "80" && url.port !== "443") {
    return finish(400, "bad_port", { error: "Only ports 80 and 443 are allowed." });
  }

  try {
    const upstream = await safeFetch(url.href, log); // validates + pins hop 0 and every redirect
    if (!upstream.ok) {
      return finish(502, `upstream_${upstream.status}`, { error: `Upstream responded ${upstream.status}.` });
    }
    const body = await readCapped(upstream, MAX_BYTES);
    // SECURITY: never reflect the upstream Content-Type/Disposition. Doing so let
    // an attacker serve text/html that a same-origin NAVIGATION to
    // /api/import?url=… would render as a page ON THIS ORIGIN — full XSS over the
    // user's stored documents. The client reads the bytes via fetch() and sniffs
    // the format from the body + URL, so a neutral type loses nothing. We also
    // force an attachment disposition and a locked-down CSP so a browser can
    // never execute the payload, and expose the real upstream type in a
    // non-rendering custom header for the client's format hint.
    const upstreamCt = upstream.headers.get("content-type");
    if (upstreamCt) res.setHeader("X-Upstream-Content-Type", upstreamCt);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", "attachment");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    log.status = 200;
    log.bytes = body.length;
    log.ms = Date.now() - started;
    if (log.finalHost === log.host) log.finalHost = null;
    logRequest(log);
    res.status(200).send(body);
  } catch (e) {
    if (e && typeof e.status === "number") finish(e.status, e.reason || "rejected", { error: e.message });
    else if (e && e.name === "TimeoutError") finish(504, "timeout", { error: "The request timed out." });
    else finish(502, "fetch_failed", { error: "Couldn't fetch that URL." });
  }
}
