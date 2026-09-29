import { describe, it, expect, vi, afterEach } from "vitest";
import handler, { isBlockedIp, assertPublicUrl } from "../../api/import.js";

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
  it("REJECTS a request with no Sec-Fetch-Site header (non-browser open-proxy call)", async () => {
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
