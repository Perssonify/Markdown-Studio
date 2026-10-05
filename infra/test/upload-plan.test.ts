import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { readVercelConfig } from "../lib/site-config.ts";
import { planUploads } from "../lib/upload-plan.ts";

const vercel = readVercelConfig(fileURLToPath(new URL("../../vercel.json", import.meta.url)));
const made: string[] = [];
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

function site(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "ms-site-"));
  made.push(dir);
  for (const f of files) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), "x");
  }
  return dir;
}

describe("planUploads", () => {
  const plan = planUploads(
    site(["index.html", "assets/app-1.js", "assets/app-1.js.map", "sw.js", "manifest.webmanifest", "assets/font.woff2", "favicon.ico", ".well-known/security.txt"]),
    vercel,
  );
  const by = (key: string) => plan.find((u) => u.key === key)!;

  it("uploads hashed assets first and the HTML last, and never a sourcemap", () => {
    expect(plan.map((u) => u.key)).toEqual([
      "assets/app-1.js",
      "assets/font.woff2",
      ".well-known/security.txt",
      "favicon.ico",
      "manifest.webmanifest",
      "sw.js",
      "index.html",
    ]);
  });

  it("states each content type", () => {
    expect(by("manifest.webmanifest").contentType).toBe("application/manifest+json");
    expect(by("sw.js").contentType).toMatch(/javascript/);
    expect(by("assets/font.woff2").contentType).toBe("font/woff2");
    expect(by("index.html").contentType).toBe("text/html; charset=utf-8");
  });

  it("carries vercel.json's Cache-Control", () => {
    expect(by("assets/app-1.js").cacheControl).toBe("public, max-age=31536000, immutable");
    expect(by("sw.js").cacheControl).toBe("no-cache, no-store, must-revalidate");
    expect(by("index.html").cacheControl).toBe("no-cache, must-revalidate");
  });

  it("refuses a file whose type it does not know", () => {
    expect(() => planUploads(site(["index.html", "data.bin"]), vercel)).toThrow(/data\.bin/);
  });
});
