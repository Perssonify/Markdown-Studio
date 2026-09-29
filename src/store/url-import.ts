/**
 * Safe "Import from URL" for a purely client-side app.
 *
 * Reality check: a browser can only READ a cross-origin response body when the
 * remote server sends permissive CORS headers. Most arbitrary URLs will NOT, so
 * a direct fetch fails for them — there is no way around this without a backend
 * or a third-party proxy (which we deliberately do not use, as it would see all
 * traffic). The UI therefore always offers a paste fallback; this module makes
 * the direct-fetch path as safe and bounded as possible for the URLs that do work.
 *
 * Safety measures:
 *  - only http(s) URLs; block file:/blob:/data:/javascript: and localhost/internal
 *  - AbortSignal timeout so a hung request can't wait forever
 *  - streamed read with a hard byte cap so a huge/endless body can't exhaust memory
 *  - credentials omitted and referrer suppressed (never leak cookies/referrer)
 *  - the returned text is fed through the existing ingest/sanitize pipeline by the
 *    caller — this module never touches the DOM or executes anything.
 */

import type { IngestFormat } from "./ingest";
import { ArchiveEncryptedError, ArchiveWrongPasswordError, extractArchive, isArchiveName, type ArchiveEntry } from "./archive";
import { normalizeImportUrl } from "./import-url-normalize";

/** Same 5 MB ceiling used for file imports (import-export.ts). */
export const MAX_URL_BYTES = 5_000_000;
/** Larger ceiling for archives (they hold many files); extractArchive still
 *  enforces its own per-entry / decompressed-total decompression-bomb limits. */
export const MAX_ARCHIVE_BYTES = 20_000_000;
export const URL_TIMEOUT_MS = 15_000;

export class UrlImportError extends Error {
  /** true when the failure is (almost certainly) the browser's CORS policy, so
   *  the UI can steer the user to the paste fallback. */
  readonly isCorsLikely: boolean;
  constructor(message: string, isCorsLikely = false) {
    super(message);
    this.name = "UrlImportError";
    this.isCorsLikely = isCorsLikely;
  }
}

/** Accept only http/https and reject obvious internal/loopback targets. */
export function validateImportUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UrlImportError("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UrlImportError("Only http and https URLs can be imported.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    isPrivateHost(host)
  ) {
    throw new UrlImportError("Local and internal addresses can't be imported.");
  }
  return url;
}

/** Client-side private/loopback/link-local literal-IP classifier — a
 *  defense-in-depth mirror of the relay's server-side SSRF guard, so the
 *  DIRECT browser-fetch path (which precedes the relay fallback) can't be aimed
 *  at a LAN device or the cloud-metadata endpoint. DNS names still resolve
 *  client-side to whatever the browser resolves; the server relay remains the
 *  authoritative guard for name-based targets. */
function isPrivateHost(host: string): boolean {
  // IPv4 literal
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]), d = Number(m[4]);
    if ([a, b, c, d].some((n) => n > 255)) return false; // not a valid v4 literal
    if (a === 0 || a === 10 || a === 127) return true;      // this-net, 10/8, loopback
    if (a === 169 && b === 254) return true;                 // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;        // 172.16/12
    if (a === 192 && b === 168) return true;                 // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true;       // CGNAT 100.64/10
    return false;
  }
  // IPv6 literal (brackets already stripped)
  if (host.includes(":")) {
    if (host === "::1" || host === "::") return true;                 // loopback / unspecified
    if (host.startsWith("fe80")) return true;                        // link-local
    if (host.startsWith("fc") || host.startsWith("fd")) return true; // unique-local fc00::/7
    if (host.startsWith("::ffff:")) return isPrivateHost(host.slice(7)); // IPv4-mapped
  }
  return false;
}

/** Pick an ingest format from a Content-Type header, URL extension, then a
 *  lightweight content sniff (raw hosts often serve .md as text/plain). */
export function detectUrlFormat(
  contentType: string | null,
  url: string,
  text: string
): IngestFormat {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("text/markdown") || ct.includes("text/x-markdown")) return "markdown";
  if (ct.includes("text/html") || ct.includes("application/xhtml")) return "html";
  if (ct.includes("application/json")) return "pmjson";

  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  if (/\.(md|markdown|mdown)$/.test(path)) return "markdown";
  if (/\.html?$/.test(path)) return "html";
  if (/\.json$/.test(path)) return "pmjson";

  // Content sniff: an html doctype/root tag ⇒ HTML, otherwise treat as markdown
  // (safe default — markdown ingest still sanitizes any embedded HTML).
  const head = text.slice(0, 2000).toLowerCase();
  if (/<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]/.test(head)) return "html";
  return "markdown";
}

/** Build a shareable deep link that re-launches the importer for `sourceUrl`.
 *  `base` is normally `location.origin + location.pathname`. */
export function buildImportShareLink(base: string, sourceUrl: string): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}import_url=${encodeURIComponent(sourceUrl)}`;
}

function nameFromUrl(url: URL): string {
  const last = url.pathname.split("/").filter(Boolean).pop();
  const base = (last ?? url.hostname).replace(/\.[^.]+$/, "");
  return decodeURIComponent(base) || url.hostname;
}

// ── Resource import (single files AND archives, provider-normalized) ─────────

/** A fetched import resource: either a single text document, or an archive whose
 *  text entries have been extracted (each carrying its in-archive path). */
export type ImportResource =
  | {
      kind: "text";
      name: string;
      format: IngestFormat;
      text: string;
      sourceUrl: string;
      provider: string;
      /** True when fetched through the public CORS proxy (content transited a
       *  third party) — surfaced in the UI for transparency. */
      viaProxy: boolean;
    }
  | {
      kind: "archive";
      name: string;
      entries: ArchiveEntry[];
      sourceUrl: string;
      provider: string;
      viaProxy: boolean;
    };

/** Parse a filename out of a Content-Disposition header, if present. */
function filenameFromDisposition(cd: string | null): string | null {
  if (!cd) return null;
  const star = cd.match(/filename\*\s*=\s*(?:UTF-8'')?["']?([^"';]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      return star[1];
    }
  }
  const plain = cd.match(/filename\s*=\s*["']?([^"';]+)/i);
  return plain?.[1] ?? null;
}

/** Zip (PK\x03\x04) / gzip (\x1f\x8b) magic-byte sniff. */
function looksLikeArchiveBytes(bytes: Uint8Array): boolean {
  return (
    (bytes[0] === 0x50 && bytes[1] === 0x4b) || // PK.. (zip)
    (bytes[0] === 0x1f && bytes[1] === 0x8b) // gzip
  );
}

/**
 * First-party "import relay" — a same-origin serverless function (see
 * `api/import.js`) used ONLY as a fallback when a direct cross-origin fetch is
 * blocked by the browser (notably Google Drive, which sends no CORS headers to a
 * real browser). Because it lives on the app's own origin, the request stays
 * first-party (no third party sees it) and it's reliable (unlike public proxies).
 *
 * It is never used for hosts the browser can already reach directly (GitHub raw,
 * Dropbox, any server that sets Access-Control-Allow-Origin) — those resolve on
 * the direct attempt and never touch the relay. Deployments without the function
 * (e.g. a non-Vercel host, or the embeddable library) simply get a failed relay
 * attempt and fall through to the download-and-drop guidance.
 */
const IMPORT_RELAY = "/api/import?url=";

/** A per-attempt timeout signal (uses AbortSignal.timeout when available). */
function timeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return {
      signal: (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout(timeoutMs),
      clear: () => {},
    };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return { signal: ctrl.signal, clear: () => clearTimeout(t) };
}

/**
 * Fetch a URL directly; on a CORS/network failure (a thrown TypeError), retry
 * through the same-origin {@link IMPORT_RELAY}. A direct timeout is surfaced
 * as-is (a slow origin won't get faster through the relay). Returns whether the
 * relay was used so the UI can disclose it.
 */
async function fetchDirectOrProxy(
  url: URL,
  doFetch: typeof fetch,
  timeoutMs: number,
): Promise<{ res: Response; viaProxy: boolean }> {
  const attempt = async (href: string, ms: number): Promise<Response> => {
    const { signal, clear } = timeoutSignal(ms);
    try {
      return await doFetch(href, {
        signal,
        redirect: "follow",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
    } finally {
      clear();
    }
  };

  try {
    return { res: await attempt(url.href, timeoutMs), viaProxy: false };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new UrlImportError("The request timed out.");
    }
    // Direct cross-origin fetch blocked (CORS) or a network error. Retry through
    // the app's own same-origin relay (reliable + first-party). A 404 (relay not
    // deployed) or any non-2xx just falls through to the guidance below.
    let relayTooLarge: string | null = null;
    try {
      const res = await attempt(IMPORT_RELAY + encodeURIComponent(url.href), timeoutMs);
      if (res.ok) return { res, viaProxy: true };
      // 413: the file is over what a serverless response can carry (~4 MB). The
      // relay says so; "the relay is unavailable" below would be untrue.
      if (res.status === 413) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        relayTooLarge = typeof body?.error === "string" ? body.error : "That file is too large for the import relay.";
      }
    } catch {
      /* relay unavailable — fall through */
    }
    if (relayTooLarge) throw new UrlImportError(relayTooLarge);
    throw new UrlImportError(
      "Couldn't fetch that URL. The host blocks direct browser access and the import " +
        'relay is unavailable. Download the file and drag it in (or use "Import file"), ' +
        "or paste its content below.",
      true,
    );
  }
}

/**
 * Fetch and normalize an import URL into an {@link ImportResource}. Rewrites
 * provider "share" links to their raw-download form (Google Drive, GitHub blob,
 * Dropbox), transparently handles archives (unpacked via the shared extractor),
 * and guards against a provider returning a sign-in / viewer webpage instead of
 * the file. Throws {@link UrlImportError} (with a paste-fallback hint on likely
 * CORS) on any failure.
 */
export async function fetchImportResource(
  rawUrl: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; password?: string } = {},
): Promise<ImportResource> {
  const timeoutMs = opts.timeoutMs ?? URL_TIMEOUT_MS;
  const doFetch = opts.fetchImpl ?? fetch;

  // normalizeImportUrl may throw a friendly UrlImportError (e.g. Drive folder).
  const { fetchUrl, provider, bestEffort } = normalizeImportUrl(rawUrl);
  const url = validateImportUrl(fetchUrl);

  // Direct fetch first (no third party); fall back to the CORS proxy only if the
  // browser blocks the direct request.
  const { res, viaProxy } = await fetchDirectOrProxy(url, doFetch, timeoutMs);
  if (!res.ok) {
    throw new UrlImportError(`The server responded with ${res.status} ${res.statusText}.`);
  }

  // The proxy neutralizes its own Content-Type to application/octet-stream (so a
  // browser can't render a relayed HTML payload on our origin) and forwards the
  // real upstream type in X-Upstream-Content-Type for our format hint. Prefer
  // that; fall back to the response type for the direct-fetch path.
  const contentType = (
    res.headers.get("x-upstream-content-type") ??
    res.headers.get("content-type") ??
    ""
  ).toLowerCase();
  const cdName = filenameFromDisposition(res.headers.get("content-disposition"));
  const urlName = nameFromUrl(url);
  const name = cdName || urlName;

  const bytes = await readCappedBytes(res, MAX_ARCHIVE_BYTES);

  // Archive? Decide by filename extension or magic bytes, then unpack via the
  // shared extractor (which enforces decompression-bomb limits itself).
  const archiveName = cdName && isArchiveName(cdName) ? cdName : name;
  if (isArchiveName(archiveName) || looksLikeArchiveBytes(bytes)) {
    const zipName = isArchiveName(archiveName) ? archiveName : `${name || "archive"}.zip`;
    const file = new File([bytes as BlobPart], zipName);
    let entries: ArchiveEntry[];
    try {
      // Match the fetch ceiling so archives up to MAX_ARCHIVE_BYTES actually
      // extract (extractArchive's own default compressed cap is smaller).
      entries = await extractArchive(file, { maxCompressedBytes: MAX_ARCHIVE_BYTES, password: opts.password });
    } catch (e) {
      // Preserve the encrypted / wrong-password signals so the caller can prompt
      // for a password and retry; wrap anything else as a friendly message.
      if (e instanceof ArchiveEncryptedError || e instanceof ArchiveWrongPasswordError) throw e;
      throw new UrlImportError(
        e instanceof Error && e.message ? `Couldn't read that archive: ${e.message}` : "Couldn't read that archive.",
      );
    }
    if (!entries.length) {
      throw new UrlImportError("That archive has no importable text documents in it.");
    }
    return { kind: "archive", name: zipName, entries, sourceUrl: rawUrl, provider, viaProxy };
  }

  if (bytes.length > MAX_URL_BYTES) {
    throw new UrlImportError("That file is too large to import (over 5 MB).");
  }
  const text = new TextDecoder().decode(bytes);
  const format = detectUrlFormat(contentType || null, url.href, text);

  // Guard: a Google download that comes back as an HTML page is a sign-in /
  // confirmation interstitial (file not truly public, or a folder), not the file.
  // The proxy strips the content-type to octet-stream, so sniff the body too.
  if (
    provider.startsWith("google") &&
    (contentType.includes("text/html") || /^\s*<(?:!doctype\s+html|html[\s>])/i.test(text.slice(0, 200)))
  ) {
    throw new UrlImportError(
      "Google returned a sign-in or confirmation page instead of the file. Make sure the " +
        'file\'s sharing is set to "Anyone with the link", and that it\'s a single file (not a folder).',
    );
  }

  // Best-effort provider (e.g. Google Docs export) that still handed back an
  // obvious login page: nudge to the paste fallback rather than import chrome.
  if (bestEffort && /<title>[^<]*sign in[^<]*<\/title>/i.test(text.slice(0, 4000))) {
    throw new UrlImportError(
      "That link returned a sign-in page, not the document. Open it, copy the content, and paste it below.",
      true,
    );
  }

  return { kind: "text", name, format, text, sourceUrl: rawUrl, provider, viaProxy };
}

/** Read a response body into bytes with a hard cap (mirrors readCapped). */
async function readCappedBytes(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new UrlImportError("That file is too large to import.");
  }
  const body = res.body;
  if (!body || typeof body.getReader !== "function") {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new UrlImportError("That file is too large to import.");
    return buf;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > maxBytes) {
          await reader.cancel();
          throw new UrlImportError("That file is too large to import.");
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock?.();
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  return merged;
}
