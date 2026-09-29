// api/import.js — first-party "import relay" (Vercel Serverless Function).
//
// Fetches a user-supplied URL server-side and returns its bytes, so the browser
// can import from hosts that block direct cross-origin reads — notably Google
// Drive, which sends no CORS headers to a real browser. This runs on the app's
// OWN origin, so no third party ever sees the request.
//
// Security (this is an internet-facing fetch endpoint):
//  - SSRF: http(s) only; localhost/.local/.internal and private/loopback/
//    link-local/CGNAT/cloud-metadata addresses refused AFTER DNS resolution,
//    including IPv6 loopback/ULA/link-local and IPv4-embedded forms (mapped,
//    NAT64, 6to4). Every redirect hop is re-validated.
//  - DNS-rebinding: the resolved+vetted IPs are PINNED to the connection via an
//    undici dispatcher, so fetch cannot re-resolve to a different address
//    between validation and connection (TOCTOU).
//  - Abuse: cross-site browser requests are refused (Sec-Fetch-Site); responses
//    are CORS-restricted to the app's own origins; a best-effort per-IP rate
//    limit and hard size/time caps bound resource use.

import dns from "node:dns/promises";
import net from "node:net";
import { Agent } from "undici";

const MAX_BYTES = 25_000_000; // headroom over the client's 20 MB archive ceiling
const TIMEOUT_MS = 20_000;
const MAX_HOPS = 5;
const RATE_MAX = 40; // requests per window per IP (best-effort, per warm instance)
const RATE_WINDOW_MS = 60_000;

// Origins allowed to READ relayed responses (this project's custom and Vercel
// domains, plus any same-origin request).
// A hyphen separator is REQUIRED before any suffix so a squatted domain like
// `markdown-studioevil.vercel.app` cannot match, while the exact host and
// Vercel preview URLs (`markdown-studio-git-…`) still do.
const ALLOWED_ORIGIN = /^https:\/\/(?:(?:www\.)?markdownstudio\.com|markdown-studio(?:-[a-z0-9-]+)?\.vercel\.app)$/i;

// ── SSRF address classification ─────────────────────────────────────────────

function isBlockedIpv4Parts(p) {
  if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true; // this-net, 10/8, loopback
  if (p[0] === 169 && p[1] === 254) return true; // link-local + cloud metadata
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16/12
  if (p[0] === 192 && p[1] === 168) return true; // 192.168/16
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT 100.64/10
  return false;
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

/** IPs that must never be reachable through the relay. */
export function isBlockedIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return isBlockedIpv4Parts(ip.split(".").map(Number));
  if (v === 6) {
    const g = expandIpv6(ip);
    if (!g) return true; // unparseable → block
    if (g.every((x) => x === 0)) return true; // ::  (unspecified)
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1 loopback
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    // IPv4 embedded in IPv6 — resolve to the underlying v4 and re-check.
    let emb = null;
    if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff)
      emb = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]; // ::ffff:0:0/96 mapped
    else if (g[0] === 0x64 && g[1] === 0xff9b) emb = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]; // 64:ff9b::/96 NAT64
    else if (g[0] === 0x2002) emb = [g[1] >> 8, g[1] & 0xff, g[2] >> 8, g[2] & 0xff]; // 2002::/16 6to4
    if (emb) return isBlockedIpv4Parts(emb);
    return false;
  }
  return true; // not a valid IP → block
}

/** Validate scheme + host, resolve, and refuse blocked addresses. Returns the
 *  vetted { hostname, addrs } so the caller can pin the connection to them.
 *  Throws { status, message } on rejection. */
export async function assertPublicUrl(url) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw { status: 400, message: "Only http(s) URLs can be imported." };
  }
  // Port allowlist enforced HERE (not only on the initial URL) so it also covers
  // every redirect hop — otherwise a public URL could 302 to http://host:6379
  // and the relay would connect to an arbitrary port on a public host.
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw { status: 400, message: "Only ports 80 and 443 can be imported." };
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw { status: 403, message: "That host can't be imported." };
  }
  const literal = net.isIP(hostname);
  const addrs = literal ? [{ address: hostname, family: literal }] : await dns.lookup(hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) {
    throw { status: 403, message: "That address can't be imported." };
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

/** Fetch following redirects manually, re-validating AND re-pinning each hop. */
async function safeFetch(startUrl) {
  let current = new URL(startUrl);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
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
  throw { status: 508, message: "Too many redirects." };
}

/** Read a web ReadableStream response with a hard byte cap. */
async function readCapped(resp, max) {
  const declared = Number(resp.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) throw { status: 413, message: "File too large." };
  const reader = resp.body?.getReader?.();
  if (!reader) {
    const b = Buffer.from(await resp.arrayBuffer());
    if (b.length > max) throw { status: 413, message: "File too large." };
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
      if (total > max) throw { status: 413, message: "File too large." };
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

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGIN.test(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "GET only." });
    return;
  }
  // Refuse anything but a first-party browser request. Sec-Fetch-Site is a
  // forbidden header (page JS can't spoof it): the app's own fetch sends
  // "same-origin", a direct navigation sends "none". We now REQUIRE the header
  // to be present and in that allowlist — an absent header means a non-browser
  // client (curl/another server), i.e. the open-proxy abuse path, so reject it.
  const sfs = req.headers["sec-fetch-site"];
  if (sfs !== "same-origin" && sfs !== "none") {
    res.status(403).json({ error: "Only first-party requests are allowed." });
    return;
  }
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    res.status(429).json({ error: "Too many requests. Try again shortly." });
    return;
  }

  const q = req.query?.url;
  const raw = typeof q === "string" ? q : Array.isArray(q) ? q[0] : "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    res.status(400).json({ error: "Missing or invalid url parameter." });
    return;
  }
  // Only fetch over the standard web ports — a relay that will connect to any
  // port is a port-scanner/abuse amplifier even against public hosts.
  if (url.port && url.port !== "80" && url.port !== "443") {
    res.status(400).json({ error: "Only ports 80 and 443 are allowed." });
    return;
  }

  try {
    const upstream = await safeFetch(url.href); // validates + pins hop 0 and every redirect
    if (!upstream.ok) {
      res.status(502).json({ error: `Upstream responded ${upstream.status}.` });
      return;
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
    res.status(200).send(body);
  } catch (e) {
    if (e && typeof e.status === "number") res.status(e.status).json({ error: e.message });
    else if (e && e.name === "TimeoutError") res.status(504).json({ error: "The request timed out." });
    else res.status(502).json({ error: "Couldn't fetch that URL." });
  }
}
