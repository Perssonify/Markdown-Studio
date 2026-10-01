import { readdirSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { cacheControlFor, type VercelConfig } from "./site-config.ts";

/**
 * Content types by extension, stated rather than guessed: a guess of
 * `binary/octet-stream` for manifest.webmanifest or a font breaks the PWA
 * install or the font, and the service worker only caches what is served as
 * JavaScript. An extension not listed fails the deploy instead of shipping
 * with a wrong type.
 */
export const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

export interface Upload {
  /** Absolute path on disk. */
  file: string;
  /** S3 key, no leading slash. */
  key: string;
  contentType: string;
  cacheControl: string;
}

/**
 * Every file of the built site, in upload order: hashed assets first, then
 * the other files, and the HTML entry points LAST — so a visitor who loads
 * the new index.html mid-deploy never asks for a chunk that is not there yet.
 * Source maps are never uploaded (they leave the build before deploy, as on
 * Vercel — apps/web/scripts/strip-sourcemaps.mjs).
 */
export function planUploads(distDir: string, cfg: VercelConfig): Upload[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(distDir);
  const uploads = files
    .filter((f) => !f.endsWith(".map"))
    .map((file) => {
      const key = relative(distDir, file).split(sep).join("/");
      const contentType = CONTENT_TYPES[extname(file).toLowerCase()];
      if (!contentType) throw new Error(`no content type for ${key}; add its extension to CONTENT_TYPES`);
      return { file, key, contentType, cacheControl: cacheControlFor(cfg, `/${key}`) };
    });
  const rank = (u: Upload) => (u.key.startsWith("assets/") ? 0 : u.key.endsWith(".html") ? 2 : 1);
  return uploads.sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key));
}
