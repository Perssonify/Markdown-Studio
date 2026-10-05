import { readFileSync } from "node:fs";

/**
 * The repository's vercel.json is the ONE description of how the site is
 * served: its SPA rewrite, its security headers (a hash-pinned CSP that
 * apps/web/src/__tests__/ops-vercel-headers.test.js keeps in step with the
 * inline scripts) and its cache headers. The AWS deployment reads it rather
 * than restating it, so the two hosts cannot drift: change vercel.json and
 * the next deploy carries the change to CloudFront and S3.
 *
 * vercel.json describes services (Vercel runs the editor as `web` and the API
 * as `api`): the site is the top-level headers, which every response gets, and
 * the `web` service's own headers and rewrite.
 */
export interface VercelConfig {
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
}

interface VercelFile {
  headers?: VercelConfig["headers"];
  services?: { web?: Partial<VercelConfig> };
}

export interface Header {
  key: string;
  value: string;
}

export function readVercelConfig(file: string): VercelConfig {
  const cfg = JSON.parse(readFileSync(file, "utf8")) as VercelFile;
  const web = cfg.services?.web;
  if (!web) throw new Error(`${file} has no "web" service`);
  return { rewrites: web.rewrites ?? [], headers: [...(cfg.headers ?? []), ...(web.headers ?? [])] };
}

/** Vercel `source` patterns used here are plain regex bodies (the test file reads them the same way). */
export const matches = (source: string, path: string): boolean => new RegExp(`^${source}$`).test(path);

/** Every header vercel.json applies to `path`. Two rules setting one header for the same path is refused: which should win is not ours to guess. */
export function headersFor(cfg: VercelConfig, path: string): Header[] {
  const out = new Map<string, Header>();
  for (const rule of cfg.headers) {
    if (!matches(rule.source, path)) continue;
    for (const h of rule.headers) {
      const k = h.key.toLowerCase();
      if (out.has(k)) throw new Error(`vercel.json sets ${h.key} twice for ${path}`);
      out.set(k, { key: h.key, value: h.value });
    }
  }
  return [...out.values()];
}

/** What Vercel sends for a static file no rule gives a Cache-Control. */
export const DEFAULT_CACHE_CONTROL = "public, max-age=0, must-revalidate";

export function cacheControlFor(cfg: VercelConfig, path: string): string {
  return headersFor(cfg, path).find((h) => h.key.toLowerCase() === "cache-control")?.value ?? DEFAULT_CACHE_CONTROL;
}

/** The response headers for `path`, without Cache-Control (S3 object metadata carries that). */
export function securityHeadersFor(cfg: VercelConfig, path: string): Header[] {
  return headersFor(cfg, path).filter((h) => h.key.toLowerCase() !== "cache-control");
}

/** The single SPA rewrite: everything not excluded, and not a real file, is served index.html. */
export function spaRewrite(cfg: VercelConfig): { source: string; destination: string } {
  if (cfg.rewrites.length !== 1) throw new Error(`expected exactly one rewrite in vercel.json, found ${cfg.rewrites.length}`);
  return cfg.rewrites[0]!;
}

/**
 * The CloudFront paths and the vercel.json path each one stands for. Every
 * path a behaviour serves must get the SAME headers from vercel.json — a
 * CloudFront behaviour has one response-headers policy — and
 * `assertUniformHeaders` checks a sample of each.
 */
export const BEHAVIOUR_SAMPLES = {
  default: ["/", "/index.html", "/about", "/help/x", "/graph", "/sw.js", "/sw-recover.js", "/manifest.webmanifest", "/favicon.ico", "/brand/logo.svg", "/.well-known/security.txt", "/missing.png"],
  assets: ["/assets/index-abc123.js", "/assets/style.css", "/assets/font.woff2"],
  embed: ["/embed.html"],
  api: ["/api/import", "/api/health", "/api/auth/callback/google"],
} as const;

export type Behaviour = keyof typeof BEHAVIOUR_SAMPLES;

export function assertUniformHeaders(cfg: VercelConfig): Record<Behaviour, Header[]> {
  const out = {} as Record<Behaviour, Header[]>;
  for (const [behaviour, paths] of Object.entries(BEHAVIOUR_SAMPLES) as [Behaviour, readonly string[]][]) {
    const sets = paths.map((p) => JSON.stringify(securityHeadersFor(cfg, p)));
    const first = sets[0]!;
    const odd = paths.find((_, i) => sets[i] !== first);
    if (odd) throw new Error(`vercel.json gives ${odd} different headers from ${paths[0]}; CloudFront serves both from the "${behaviour}" behaviour`);
    out[behaviour] = JSON.parse(first) as Header[];
  }
  return out;
}
