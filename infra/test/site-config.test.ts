import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertUniformHeaders, cacheControlFor, DEFAULT_CACHE_CONTROL, readVercelConfig, securityHeadersFor, spaRewrite } from "../lib/site-config.ts";

const vercel = readVercelConfig(fileURLToPath(new URL("../../vercel.json", import.meta.url)));
const value = (path: string, key: string) => securityHeadersFor(vercel, path).find((h) => h.key.toLowerCase() === key)?.value;

describe("reading vercel.json (the shared headers and the web service's)", () => {
  it("every CloudFront behaviour's paths get one consistent header set", () => {
    const h = assertUniformHeaders(vercel);
    expect(h.default.map((x) => x.key.toLowerCase()).sort()).toEqual([
      "content-security-policy",
      "content-security-policy-report-only",
      "permissions-policy",
      "referrer-policy",
      "x-content-type-options",
      "x-frame-options",
    ]);
    // The embed may be framed: no X-Frame-Options, no frame-ancestors.
    expect(h.embed.map((x) => x.key.toLowerCase())).not.toContain("x-frame-options");
    expect(h.embed.map((x) => x.key.toLowerCase())).not.toContain("content-security-policy");
    // The relay sets its own CSP; vercel.json gives /api/ only the common three.
    expect(h.api.map((x) => x.key.toLowerCase()).sort()).toEqual(["permissions-policy", "referrer-policy", "x-content-type-options"]);
  });

  it("carries the hash-pinned CSP verbatim", () => {
    expect(value("/about", "content-security-policy-report-only")).toMatch(/script-src 'self' 'wasm-unsafe-eval' 'sha256-/);
    expect(value("/about", "content-security-policy")).toBe("frame-ancestors 'none'");
  });

  it("gives each file the Cache-Control Vercel sends", () => {
    expect(cacheControlFor(vercel, "/assets/index-abc.js")).toBe("public, max-age=31536000, immutable");
    expect(cacheControlFor(vercel, "/sw.js")).toBe("no-cache, no-store, must-revalidate");
    expect(cacheControlFor(vercel, "/sw-recover.js")).toBe("no-cache, no-store, must-revalidate");
    expect(cacheControlFor(vercel, "/index.html")).toBe("no-cache, must-revalidate");
    expect(cacheControlFor(vercel, "/manifest.webmanifest")).toBe("no-cache, must-revalidate");
    expect(cacheControlFor(vercel, "/favicon.ico")).toBe(DEFAULT_CACHE_CONTROL);
  });

  it("has the one SPA rewrite to /index.html", () => {
    expect(spaRewrite(vercel).destination).toBe("/index.html");
  });

  it("refuses a config whose behaviours CloudFront could not represent", () => {
    const odd = { ...vercel, headers: [...vercel.headers, { source: "/about", headers: [{ key: "X-Odd", value: "1" }] }] };
    expect(() => assertUniformHeaders(odd)).toThrow(/\/about/);
  });
});
