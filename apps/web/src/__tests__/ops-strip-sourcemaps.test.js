/**
 * Sourcemaps are built but not deployed (A016).
 *
 * dist-app shipped ~130 .map files (25 MB of 35 MB) — the whole readable source.
 * They must still be BUILT (the licence scan reads them; they symbolicate a
 * stack from "Copy diagnostics"), so a post-build step moves them out of the
 * published directory, and the deploy runs it last.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stripSourcemaps } from "../../scripts/strip-sourcemaps.mjs";

let dir;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  dir = mkdtempSync(join(tmpdir(), "pf-strip-"));
  const dist = join(dir, "dist-app");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<html></html>");
  writeFileSync(join(dist, "sw.js"), "// sw");
  writeFileSync(join(dist, "sw.js.map"), "{}");
  writeFileSync(join(dist, "assets", "index-abc.js"), "console.log(1)");
  writeFileSync(join(dist, "assets", "index-abc.js.map"), '{"version":3}');
  return { dist, out: join(dir, "dist-app-sourcemaps") };
}

describe("strip-sourcemaps", () => {
  it("moves every .map out of the deploy, keeping relative paths, and nothing else", () => {
    const { dist, out } = fixture();
    expect(stripSourcemaps(dist, out)).toBe(2);
    expect(existsSync(join(dist, "sw.js.map"))).toBe(false);
    expect(existsSync(join(dist, "assets", "index-abc.js.map"))).toBe(false);
    expect(readFileSync(join(out, "assets", "index-abc.js.map"), "utf8")).toBe('{"version":3}');
    expect(existsSync(join(out, "sw.js.map"))).toBe(true);
    // The deploy itself is untouched.
    expect(existsSync(join(dist, "assets", "index-abc.js"))).toBe(true);
    expect(existsSync(join(dist, "index.html"))).toBe(true);
  });

  it("is idempotent", () => {
    const { dist, out } = fixture();
    stripSourcemaps(dist, out);
    expect(stripSourcemaps(dist, out)).toBe(0);
  });

  it("the deploy runs it LAST, after the build that emits (and the scans that read) the maps", () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), "../../vercel.json"), "utf8")).services.web;
    expect(vercel.buildCommand).toMatch(/^bun run build:app\b.*&& node scripts\/strip-sourcemaps\.mjs$/);
    // …and the build still emits them for those scans.
    expect(readFileSync(join(process.cwd(), "vite.app.config.ts"), "utf8")).toMatch(/sourcemap: 'hidden'/);
  });
});
