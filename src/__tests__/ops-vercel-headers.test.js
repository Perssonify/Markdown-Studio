/**
 * vercel.json's security and caching headers (A068, A012, A016, A014).
 *
 * The CSP allows the app's two inline <script>s (and the embed's one) by
 * SHA-256 hash. A hash is only right for the exact bytes it was computed from,
 * so editing an inline script without updating vercel.json would silently
 * block it the day the policy is enforced. This recomputes every hash from the
 * HTML — LF-normalised, as the Linux checkout Vercel builds from has it — and
 * fails on a missing OR a stale one. When dist-app/ exists (CI runs this file
 * again after `build:app`) it also checks the BUILT index.html, proving the
 * build did not rewrite the scripts.
 *
 * Headers are matched per path with the same regex semantics Vercel's `source`
 * uses for these patterns, so "the embed is frameable, the app is not" and
 * "a missing chunk 404s" are asserted as routing facts, not string contents.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const vercel = JSON.parse(read("vercel.json"));

function inlineScriptHashes(html) {
  const out = [];
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (/\ssrc=/.test(m[1] || "")) continue;
    out.push(`sha256-${createHash("sha256").update(m[2], "utf8").digest("base64")}`);
  }
  return out;
}

const matches = (source, path) => new RegExp(`^${source}$`).test(path);

/** Every header that applies to `path`, as { key → [values] }. */
function headersFor(path) {
  const out = {};
  for (const rule of vercel.headers) {
    if (!matches(rule.source, path)) continue;
    for (const h of rule.headers) (out[h.key.toLowerCase()] ||= []).push(h.value);
  }
  return out;
}

const one = (path, key) => {
  const values = headersFor(path)[key.toLowerCase()];
  expect(values, `${key} on ${path}`).toBeDefined();
  // Two rules setting the same header for one path would leave the result to
  // the platform's merge order.
  expect(values, `${key} is set by exactly one rule for ${path}`).toHaveLength(1);
  return values[0];
};

const directive = (csp, name) => {
  const part = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${name} `) || s === name);
  return part ? part.slice(name.length).trim().split(/\s+/).filter(Boolean) : null;
};

const APP_PATHS = ["/", "/help", "/about", "/graph", "/assets/index-abc123.js"];
const HASHES = [...inlineScriptHashes(read("index.html")), ...inlineScriptHashes(read("embed.html"))];

describe("CSP hashes track the real inline scripts", () => {
  it("finds the inline scripts it is guarding", () => {
    expect(inlineScriptHashes(read("index.html"))).toHaveLength(2); // theme pre-paint + boot watchdog
    expect(inlineScriptHashes(read("embed.html"))).toHaveLength(1);
  });

  it.each(["/", "/embed.html"])("the policy on %s allows every inline script and nothing stale", (path) => {
    const scriptSrc = directive(one(path, "Content-Security-Policy-Report-Only"), "script-src");
    const listed = scriptSrc.filter((t) => t.startsWith("'sha256-")).map((t) => t.slice(1, -1));
    for (const h of HASHES) expect(listed, `missing ${h} — an inline script changed`).toContain(h);
    for (const h of listed) expect(HASHES, `stale hash ${h} — no inline script has it`).toContain(h);
  });

  it("the build does not alter the inline scripts (checked when dist-app/ exists)", () => {
    const built = join(process.cwd(), "dist-app", "index.html");
    if (!existsSync(built)) return; // CI re-runs this file after build:app
    for (const h of inlineScriptHashes(readFileSync(built, "utf8").replace(/\r\n/g, "\n"))) {
      expect(HASHES, `built index.html has an inline script the policy does not allow: ${h}`).toContain(h);
    }
  });
});

describe("the policy allows what the app really does, and no more", () => {
  const csp = () => one("/", "Content-Security-Policy-Report-Only");

  it("scripts: self + hashes (+ WebAssembly for zip.js's decrypt), never unsafe-inline / unsafe-eval", () => {
    const s = directive(csp(), "script-src");
    expect(s).toContain("'self'");
    expect(s).toContain("'wasm-unsafe-eval'");
    expect(s).not.toContain("'unsafe-inline'");
    expect(s).not.toContain("'unsafe-eval'");
  });

  it("connections: the relay (self) and DIRECT URL imports to any https origin", () => {
    const c = directive(csp(), "connect-src");
    expect(c).toEqual(expect.arrayContaining(["'self'", "https:"]));
    expect(c).not.toContain("*");
    expect(c).not.toContain("http:");
  });

  it("styles, images, fonts, workers as the renderers need them", () => {
    // Mermaid SVG <style>, KaTeX's style attributes, sonner's injected sheet.
    expect(directive(csp(), "style-src")).toEqual(expect.arrayContaining(["'self'", "'unsafe-inline'"]));
    // Pasted/imported images are data: and blob:, linked ones are https.
    expect(directive(csp(), "img-src")).toEqual(expect.arrayContaining(["'self'", "data:", "blob:", "https:"]));
    // KaTeX and the UI fonts are self-hosted.
    expect(directive(csp(), "font-src")).toContain("'self'");
    expect(directive(csp(), "worker-src")).toEqual(expect.arrayContaining(["'self'", "blob:"]));
    expect(directive(csp(), "object-src")).toEqual(["'none'"]);
    expect(directive(csp(), "base-uri")).toEqual(["'self'"]);
  });

  it("no page pulls a third-party stylesheet or font the policy would have to allow", () => {
    for (const f of ["index.html", "embed.html", "src/styles.css"]) {
      expect(read(f), f).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    }
  });
});

describe("framing: the app refuses it, the embed allows it", () => {
  it.each(APP_PATHS)("%s cannot be framed (enforced now, not just reported)", (path) => {
    expect(one(path, "X-Frame-Options")).toBe("DENY");
    expect(one(path, "Content-Security-Policy")).toBe("frame-ancestors 'none'");
    expect(directive(one(path, "Content-Security-Policy-Report-Only"), "frame-ancestors")).toEqual(["'none'"]);
  });

  it("/embed.html stays frameable", () => {
    const h = headersFor("/embed.html");
    expect(h["x-frame-options"]).toBeUndefined();
    expect(h["content-security-policy"]).toBeUndefined();
    expect(directive(one("/embed.html", "Content-Security-Policy-Report-Only"), "frame-ancestors")).toBeNull();
  });

  it("the relay keeps its own locked-down CSP", () => {
    const h = headersFor("/api/import");
    expect(h["content-security-policy"]).toBeUndefined();
    expect(h["content-security-policy-report-only"]).toBeUndefined();
  });
});

describe("baseline hardening headers on every path", () => {
  it.each([...APP_PATHS, "/embed.html", "/api/import"])("%s", (path) => {
    expect(one(path, "X-Content-Type-Options")).toBe("nosniff");
    expect(["no-referrer", "strict-origin-when-cross-origin"]).toContain(one(path, "Referrer-Policy"));
    const pp = one(path, "Permissions-Policy");
    for (const f of ["camera=()", "microphone=()", "geolocation=()", "payment=()"]) expect(pp).toContain(f);
  });
});

describe("caching and routing", () => {
  it("hashed assets are immutable", () => {
    expect(one("/assets/index-abc123.js", "Cache-Control")).toBe("public, max-age=31536000, immutable");
  });

  it("the service worker, its helper, the manifest and the HTML are always revalidated", () => {
    for (const p of ["/sw.js", "/sw-recover.js", "/manifest.webmanifest", "/index.html"]) {
      expect(one(p, "Cache-Control"), p).toMatch(/no-cache/);
    }
  });

  it("a missing chunk 404s instead of being answered with index.html (A012)", () => {
    const [rewrite] = vercel.rewrites;
    expect(rewrite.destination).toBe("/index.html");
    for (const p of ["/", "/help", "/about", "/graph", "/some/deep/link"]) expect(matches(rewrite.source, p), p).toBe(true);
    for (const p of ["/assets/index-deadbeef.js", "/api/import", "/.well-known/security.txt"]) {
      expect(matches(rewrite.source, p), p).toBe(false);
    }
  });

  it("installs exactly what bun.lock pins (A014)", () => {
    expect(vercel.installCommand).toMatch(/--frozen-lockfile/);
  });
});
