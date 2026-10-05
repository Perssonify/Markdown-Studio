import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { readVercelConfig, spaRewrite } from "../lib/site-config.ts";
import { rewriteFunctionCode, siteFiles } from "../lib/spa-rewrite.ts";

const vercel = readVercelConfig(fileURLToPath(new URL("../../vercel.json", import.meta.url)));

const dist = mkdtempSync(join(tmpdir(), "ms-dist-"));
afterAll(() => rmSync(dist, { recursive: true, force: true }));
for (const f of ["index.html", "sw.js", "sw.js.map", "favicon.ico", "brand/logo.svg", ".well-known/security.txt", "assets/index-abc.js"]) {
  mkdirSync(dirname(join(dist, f)), { recursive: true });
  writeFileSync(join(dist, f), "x");
}

const files = siteFiles(dist);
// The generated CloudFront Function, run as CloudFront would run it.
const code = rewriteFunctionCode({ files, ...spaRewrite(vercel) });
const handler = new Function(`${code}\nreturn handler;`)() as (e: { request: { uri: string } }) => { uri: string };
const served = (uri: string) => handler({ request: { uri } }).uri;

describe("the SPA rewrite (Vercel: a real file first, then the rewrite)", () => {
  it("lists the site's own files, but not hashed assets or sourcemaps", () => {
    expect(files).toEqual(["/.well-known/security.txt", "/brand/logo.svg", "/favicon.ico", "/index.html", "/sw.js"]);
  });

  it("serves the app shell for the app's routes and the root", () => {
    for (const uri of ["/", "/about", "/help", "/graph", "/help/deep/link"]) expect(served(uri), uri).toBe("/index.html");
  });

  it("serves a real file as itself", () => {
    for (const uri of ["/sw.js", "/favicon.ico", "/brand/logo.svg", "/index.html", "/.well-known/security.txt"]) expect(served(uri), uri).toBe(uri);
  });

  it("never rewrites what vercel.json excludes, so a missing one is a 404", () => {
    for (const uri of ["/api/import", "/assets/gone-123.js", "/.well-known/missing", "/embed.html"]) expect(served(uri), uri).toBe(uri);
  });

  it("rewrites a missing file-like path outside the exclusions, as Vercel does", () => {
    expect(served("/missing.png")).toBe("/index.html");
  });

  it("fits CloudFront's 10 KB function limit with room to spare", () => {
    expect(code.length).toBeLessThan(5_000);
  });
});
