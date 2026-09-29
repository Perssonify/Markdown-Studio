import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import handler, { isBlockedIp, isGlobalUnicast, assertPublicUrl, MAX_BYTES, TOO_LARGE_MESSAGE } from "../../api/import.js";

// The handler writes one JSON log line per request; keep the test output clean.
// Cases that assert on the line install their own spy.
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("import relay — SSRF address blocklist (isBlockedIp)", () => {
  it("blocks IPv4 loopback / private / CGNAT / link-local / metadata", () => {
    for (const ip of [
      "127.0.0.1",
      "0.0.0.0",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "169.254.169.254", // cloud metadata
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("blocks IPv6 loopback / ULA / link-local", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("blocks IPv4-embedded IPv6 forms (mapped, NAT64, 6to4) — the classic bypass", () => {
    for (const ip of [
      "::ffff:127.0.0.1",
      "::ffff:7f00:1", // hex form of 127.0.0.1
      "::ffff:a9fe:a9fe", // 169.254.169.254 metadata
      "64:ff9b::7f00:1", // NAT64 → 127.0.0.1
      "2002:7f00:0001::", // 6to4 → 127.0.0.x
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("allows genuine public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "142.250.80.14", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it("blocks anything that isn't a valid IP", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(isBlockedIp("")).toBe(true);
  });
});

describe("import relay — assertPublicUrl", () => {
  it("rejects non-http(s) schemes without a network call", async () => {
    for (const u of ["ftp://example.com/x", "file:///etc/passwd", "gopher://x/"]) {
      await expect(assertPublicUrl(new URL(u))).rejects.toMatchObject({ status: 400 });
    }
  });

  it("rejects localhost / .local / .internal hosts", async () => {
    for (const u of ["http://localhost/x", "http://foo.local/x", "https://svc.internal/x"]) {
      await expect(assertPublicUrl(new URL(u))).rejects.toMatchObject({ status: 403 });
    }
  });

  it("rejects literal private/metadata IPs (incl. IPv6-mapped)", async () => {
    for (const u of ["http://127.0.0.1/", "http://169.254.169.254/", "http://[::ffff:a9fe:a9fe]/"]) {
      await expect(assertPublicUrl(new URL(u))).rejects.toMatchObject({ status: 403 });
    }
  });
});

// ── Handler-level tests ─────────────────────────────────────────────────────
// The exported default handler carries two documented "do NOT regress" security
// invariants (CLAUDE.md ▸ Security invariants): the Sec-Fetch-Site gate, and the
// response hardening that refuses to reflect the upstream Content-Type /
// Content-Disposition. Drive it with a stub req/res; stub global fetch for the
// cases that would otherwise reach the network.

let ipSeq = 0;
/** Minimal Vercel-style request. A unique client IP per call keeps the module's
 *  best-effort per-IP rate limiter out of the way of these assertions. */
function makeReq({ method = "GET", url = "https://93.184.216.34/doc.md", headers = {} } = {}) {
  const h = { "sec-fetch-site": "same-origin", "x-forwarded-for": `relay-test-ip-${ipSeq++}`, ...headers };
  for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
  return { method, headers: h, query: url === undefined ? {} : { url } };
}

/** Records what the handler wrote. Header lookup is case-insensitive (as HTTP is). */
function makeRes() {
  return {
    statusCode: undefined,
    body: undefined,
    ended: false,
    _headers: new Map(),
    setHeader(name, value) {
      this._headers.set(String(name).toLowerCase(), value);
    },
    getHeader(name) {
      const v = this._headers.get(String(name).toLowerCase());
      return v === undefined ? undefined : v;
    },
    hasHeader(name) {
      return this._headers.has(String(name).toLowerCase());
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    send(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

/** A stand-in for the upstream `Response` shaped exactly as the relay consumes it:
 *  `.ok` / `.status` / `.headers.get()` / `.arrayBuffer()` (no `.body` stream, so
 *  readCapped takes its buffered branch). */
function upstreamResponse({ status = 200, headers = {}, body = "# hi" } = {}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (map.has(String(name).toLowerCase()) ? map.get(String(name).toLowerCase()) : null) },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

/** Stub global fetch. Requests are recorded so a test can assert the relay never
 *  reached the network at all. */
function stubFetch(impl) {
  const calls = [];
  vi.stubGlobal("fetch", async (input, init) => {
    calls.push({ url: String(input), init });
    if (typeof impl === "function") return impl(String(input), init);
    return upstreamResponse();
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("import relay — Sec-Fetch-Site gate (handler)", () => {
  it("REJECTS a request with no Sec-Fetch-Site header (a script that does not send one)", async () => {
    const calls = stubFetch();
    const req = makeReq({ headers: { "sec-fetch-site": undefined } });
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Only first-party requests are allowed." });
    expect(calls).toHaveLength(0); // never reached the network
  });

  it("REJECTS cross-site / same-site / bogus values", async () => {
    for (const sfs of ["cross-site", "same-site", "", "SAME-ORIGIN", "none, same-origin"]) {
      const calls = stubFetch();
      const res = makeRes();
      await handler(makeReq({ headers: { "sec-fetch-site": sfs } }), res);
      expect(res.statusCode, `sec-fetch-site: ${JSON.stringify(sfs)}`).toBe(403);
      expect(calls, `sec-fetch-site: ${JSON.stringify(sfs)}`).toHaveLength(0);
      vi.unstubAllGlobals();
    }
  });

  it("ACCEPTS same-origin (the app's own fetch) and none (a direct navigation)", async () => {
    for (const sfs of ["same-origin", "none"]) {
      const calls = stubFetch();
      const res = makeRes();
      await handler(makeReq({ headers: { "sec-fetch-site": sfs } }), res);
      expect(res.statusCode, sfs).toBe(200);
      expect(calls, sfs).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });
});

describe("import relay — response hardening (handler)", () => {
  it("NEVER reflects the upstream Content-Type / Content-Disposition", async () => {
    stubFetch(() =>
      upstreamResponse({
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-disposition": "inline; filename=evil.html",
        },
        body: "<script>alert(document.domain)</script>",
      }),
    );
    const res = makeRes();
    await handler(makeReq({ url: "https://93.184.216.34/evil.html" }), res);

    expect(res.statusCode).toBe(200);
    // The payload is relayed verbatim…
    expect(Buffer.from(res.body).toString("utf8")).toBe("<script>alert(document.domain)</script>");
    // …but it can never be RENDERED on our origin.
    expect(res.getHeader("Content-Type")).toBe("application/octet-stream");
    expect(res.getHeader("content-type")).not.toMatch(/html/i);
    expect(res.getHeader("Content-Disposition")).toBe("attachment");
    expect(res.getHeader("content-disposition")).not.toMatch(/inline/i);
    expect(res.getHeader("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(res.getHeader("X-Content-Type-Options")).toBe("nosniff");
    expect(res.getHeader("Cache-Control")).toBe("no-store");
    // The real type survives only in a non-rendering custom header (format hint).
    expect(res.getHeader("X-Upstream-Content-Type")).toBe("text/html; charset=utf-8");
  });

  it("forwards the real upstream type in X-Upstream-Content-Type, and omits it when there is none", async () => {
    stubFetch(() => upstreamResponse({ headers: { "content-type": "application/zip" } }));
    const withType = makeRes();
    await handler(makeReq(), withType);
    expect(withType.getHeader("X-Upstream-Content-Type")).toBe("application/zip");
    vi.unstubAllGlobals();

    stubFetch(() => upstreamResponse({ headers: {} }));
    const noType = makeRes();
    await handler(makeReq(), noType);
    expect(noType.statusCode).toBe(200);
    expect(noType.hasHeader("X-Upstream-Content-Type")).toBe(false);
    expect(noType.getHeader("Content-Type")).toBe("application/octet-stream");
  });

  it("does not relay the body of a failing upstream", async () => {
    stubFetch(() =>
      upstreamResponse({ status: 404, headers: { "content-type": "text/html" }, body: "<h1>nope</h1>" }),
    );
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: "Upstream responded 404." });
    expect(res.hasHeader("X-Upstream-Content-Type")).toBe(false);
  });
});

describe("import relay — port allowlist", () => {
  it("REJECTS non-80/443 ports before any network call", async () => {
    for (const url of [
      "http://93.184.216.34:6379/",
      "http://93.184.216.34:22/",
      "https://93.184.216.34:8080/x.md",
      "http://[2606:4700:4700::1111]:9200/",
    ]) {
      const calls = stubFetch();
      const res = makeRes();
      await handler(makeReq({ url }), res);
      expect(res.statusCode, url).toBe(400);
      expect(res.body, url).toEqual({ error: "Only ports 80 and 443 are allowed." });
      expect(calls, url).toHaveLength(0);
      vi.unstubAllGlobals();
    }
  });

  it("ACCEPTS the default port and explicit :80 / :443", async () => {
    for (const url of ["https://93.184.216.34/x.md", "https://93.184.216.34:443/x.md", "http://93.184.216.34:80/x.md"]) {
      const calls = stubFetch();
      const res = makeRes();
      await handler(makeReq({ url }), res);
      expect(res.statusCode, url).toBe(200);
      expect(calls, url).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });

  it("assertPublicUrl re-applies the port allowlist, so redirect hops are covered too", async () => {
    for (const u of ["http://example.com:6379/", "https://example.com:8080/x"]) {
      await expect(assertPublicUrl(new URL(u))).rejects.toMatchObject({
        status: 400,
        message: "Only ports 80 and 443 can be imported.",
      });
    }
    // …and does not reject the standard web ports on that same path.
    await expect(assertPublicUrl(new URL("https://93.184.216.34:443/x"))).resolves.toBeTruthy();
  });
});

// ── The allowlist (A074) ────────────────────────────────────────────────────
// Every address below got past the old blocklist or sits in space it never
// named. An allowlist refuses them all by construction; these cases pin that it
// actually does, and that genuine public addresses — including ones that LOOK
// close to a refused block — still pass.

describe("import relay — global-unicast allowlist", () => {
  it("refuses the IPv4-in-IPv6 wrappers the blocklist missed", () => {
    for (const ip of [
      "::127.0.0.1", // IPv4-compatible (deprecated) — was allowed
      "::ffff:0:127.0.0.1", // IPv4-translated (SIIT) — was allowed
      "::ffff:0:8.8.8.8", // …refused even around a public address: not a destination form
      "64:ff9b::808:808", // NAT64 of a public address
      "64:ff9b::7f00:1", // NAT64 of loopback
      "2002:0808:0808::1", // 6to4 — a tunnel, not a destination
      "2002:7f00:0001::",
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("refuses Teredo and the rest of 2001::/23, documentation and discard space", () => {
    for (const ip of [
      "2001:0:4136:e378:8000:63bf:3fff:fdd2", // Teredo 2001::/32
      "2001::1",
      "2001:2::1", // benchmarking
      "2001:10::1", // ORCHID
      "2001:db8::1", // documentation
      "3fff::1", // documentation (RFC 9637)
      "100::1", // discard-only
      "fec0::1", // deprecated site-local
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("refuses multicast, reserved and broadcast in both families", () => {
    for (const ip of ["224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255", "ff02::1", "ff0e::1"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("refuses the IPv4 special-purpose blocks", () => {
    for (const ip of [
      "192.0.0.8", // IETF protocol assignments
      "192.0.2.1", // TEST-NET-1
      "192.88.99.1", // 6to4 relay anycast
      "198.18.0.1", // benchmarking
      "198.19.255.255",
      "198.51.100.7", // TEST-NET-2
      "203.0.113.9", // TEST-NET-3
      "100.127.255.255", // top of CGNAT
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("allows public addresses, including ones right next to a refused block", () => {
    for (const ip of [
      "93.184.216.34",
      "100.63.255.255", // just below CGNAT
      "100.128.0.0", // just above it
      "172.15.255.255",
      "172.32.0.0",
      "198.17.255.255",
      "198.20.0.0",
      "223.255.255.255", // last unicast /8 before multicast
      "2001:4860:4860::8888", // Google DNS — a 2001: address OUTSIDE 2001::/23
      "2620:fe::fe", // Quad9
      "2a00:1450:4001:82a::200e",
    ]) {
      expect(isGlobalUnicast(ip), ip).toBe(true);
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it("refuses decimal / octal / hex / short IPv4 spellings of loopback, which the URL parser normalises", async () => {
    for (const u of [
      "http://2130706433/",
      "http://0177.0.0.1/",
      "http://0x7f.0.0.1/",
      "http://0x7f000001/",
      "http://017700000001/",
      "http://127.1/",
      "http://[::127.0.0.1]/",
      "http://[::ffff:0:127.0.0.1]/",
      "http://[2001::1]/",
    ]) {
      // A literal after normalisation — refused without a DNS lookup.
      await expect(assertPublicUrl(new URL(u)), u).rejects.toMatchObject({ status: 403, reason: "blocked_address" });
    }
  });
});

// ── One structured log line per request (A010) ─────────────────────────────

function captureLog() {
  vi.restoreAllMocks(); // replace the file-wide silencer with a spy we can read
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  return {
    lines: () => spy.mock.calls.map((c) => String(c[0])),
    records: () => spy.mock.calls.map((c) => JSON.parse(String(c[0]))),
  };
}

describe("import relay — structured request log", () => {
  it("logs a success with host, status, bytes and duration — never the path or query", async () => {
    const log = captureLog();
    stubFetch(() => upstreamResponse({ headers: { "content-type": "text/markdown" }, body: "# twelve bytes" }));
    const res = makeRes();
    await handler(makeReq({ url: "https://93.184.216.34/private/Quarterly%20Plan.md?token=SECRET-TOKEN&x=1" }), res);

    expect(res.statusCode).toBe(200);
    const lines = log.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/SECRET-TOKEN|private|Quarterly|token=/);
    const [rec] = log.records();
    expect(rec).toMatchObject({ evt: "import_relay", status: 200, host: "93.184.216.34", bytes: 14, reason: null, sfs: "same-origin" });
    expect(typeof rec.ms).toBe("number");
  });

  it("logs every refusal with a machine-readable reason", async () => {
    const cases = [
      [{ headers: { "sec-fetch-site": undefined } }, 403, "sec_fetch_site"],
      [{ url: "not a url" }, 400, "bad_url"],
      [{ url: "http://93.184.216.34:6379/" }, 400, "bad_port"],
      [{ url: "http://169.254.169.254/latest/meta-data/" }, 403, "blocked_address"],
      [{ method: "POST" }, 405, "method"],
    ];
    for (const [reqOpts, status, reason] of cases) {
      const log = captureLog();
      stubFetch();
      const res = makeRes();
      await handler(makeReq(reqOpts), res);
      expect(res.statusCode, reason).toBe(status);
      const recs = log.records();
      expect(recs, reason).toHaveLength(1);
      expect(recs[0], reason).toMatchObject({ evt: "import_relay", status, reason });
      vi.unstubAllGlobals();
    }
  });

  it("names the upstream status when the upstream fails", async () => {
    const log = captureLog();
    stubFetch(() => upstreamResponse({ status: 404 }));
    await handler(makeReq(), makeRes());
    expect(log.records()[0]).toMatchObject({ status: 502, reason: "upstream_404" });
  });
});

// ── Response size cap (A013) ────────────────────────────────────────────────
// Vercel cannot return a function body much over 4.5 MB. The relay used to
// accept 25 MB, fetch it all, and then fail at the platform with no useful
// message; it now refuses anything over MAX_BYTES itself, and says why.

/** An upstream whose body arrives as a real stream, in chunks. */
function streamedUpstream(totalBytes, { declareLength = false } = {}) {
  const chunk = new Uint8Array(256 * 1024);
  let sent = 0;
  const body = new ReadableStream({
    pull(ctrl) {
      if (sent >= totalBytes) return ctrl.close();
      const n = Math.min(chunk.length, totalBytes - sent);
      sent += n;
      ctrl.enqueue(chunk.slice(0, n));
    },
  });
  const headers = new Map(declareLength ? [["content-length", String(totalBytes)]] : []);
  return { ok: true, status: 200, headers: { get: (k) => headers.get(k.toLowerCase()) ?? null }, body };
}

describe("import relay — ~4 MB response cap", () => {
  it("stays under the platform's response limit", () => {
    expect(MAX_BYTES).toBeLessThanOrEqual(4_000_000);
    expect(MAX_BYTES).toBeGreaterThanOrEqual(3_500_000);
  });

  it("refuses a body over the cap with a message that says what to do", async () => {
    stubFetch(() => upstreamResponse({ body: new Uint8Array(MAX_BYTES + 1) }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ error: TOO_LARGE_MESSAGE });
    expect(TOO_LARGE_MESSAGE).toMatch(/4 MB/);
    expect(TOO_LARGE_MESSAGE).toMatch(/drag it into the editor/);
  });

  it("refuses a 4.4 MB file — under the old 25 MB ceiling, over what Vercel can return", async () => {
    stubFetch(() => streamedUpstream(4_400_000));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(413);
  });

  it("refuses on a declared Content-Length without reading the body", async () => {
    stubFetch(() => streamedUpstream(MAX_BYTES * 3, { declareLength: true }));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(413);
  });

  it("refuses a STREAMED body that crosses the cap mid-read", async () => {
    stubFetch(() => streamedUpstream(MAX_BYTES + 10));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ error: TOO_LARGE_MESSAGE });
  });

  it("relays a body exactly at the cap", async () => {
    stubFetch(() => streamedUpstream(MAX_BYTES));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(MAX_BYTES);
  });
});

// ── CORS: exact origins only (A074) ─────────────────────────────────────────

describe("import relay — CORS is pinned to the two production origins", () => {
  it("grants exactly https://markdownstudio.com and its www host", async () => {
    for (const origin of ["https://markdownstudio.com", "https://www.markdownstudio.com"]) {
      stubFetch();
      const res = makeRes();
      await handler(makeReq({ headers: { origin } }), res);
      expect(res.getHeader("Access-Control-Allow-Origin"), origin).toBe(origin);
      vi.unstubAllGlobals();
    }
  });

  it("grants nothing to lookalikes, plain http, or any vercel.app host", async () => {
    for (const origin of [
      "https://markdown-studio.vercel.app", // belongs to a different product
      "https://markdown-studio-git-main-team.vercel.app",
      "https://evilmarkdownstudio.com",
      "https://markdownstudio.com.evil.example",
      "http://markdownstudio.com",
    ]) {
      stubFetch();
      const res = makeRes();
      await handler(makeReq({ headers: { origin } }), res);
      expect(res.hasHeader("Access-Control-Allow-Origin"), origin).toBe(false);
      vi.unstubAllGlobals();
    }
  });
});
