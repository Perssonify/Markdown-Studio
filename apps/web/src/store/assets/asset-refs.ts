/**
 * Image asset REFERENCES — the pure half of the asset store (A086).
 *
 * An image stored as a binary asset is referenced from a document as
 * `pf-asset:<sha256>` — 64 lowercase hex digits, optionally followed by a URL
 * fragment (`#gh-dark-mode-only` keeps working). Width, height, alt and title
 * stay on the node exactly as before; only `src` (or a theme image's
 * `lightSrc`/`darkSrc`) changes. Nothing here touches IndexedDB: it parses and
 * builds references, decodes and encodes `data:` URLs, and walks canonical
 * ProseMirror JSON and text for them, so every rule can be tested without a
 * database.
 */

export const ASSET_SCHEME = "pf-asset:";

/** A whole reference: the scheme, exactly 64 hex digits, an optional fragment. */
const REF_RE = /^pf-asset:([0-9a-f]{64})(#[^\s"'<>]*)?$/i;

/** Every reference inside arbitrary text (JSON, HTML, markdown, a stash). */
const REF_SCAN_RE = /pf-asset:([0-9a-f]{64})/gi;

/**
 * `data:` URLs shorter than this stay INLINE in the document. A 1×1 spacer or a
 * small icon costs less as a few hundred characters of base64 than as a
 * database record plus a reference of its own (a reference is 73 characters
 * anyway), and keeping them inline means they never depend on the asset store.
 * About 1.5 KB of image.
 */
export const INLINE_MAX_CHARS = 2048;

/** Refuse to store anything bigger as ONE asset (an image this size is a mistake,
 *  and holding it in memory to hash it is not free). It stays inline instead. */
export const MAX_ASSET_BYTES = 32 * 1024 * 1024;

/** Raster types only — the same set `isDangerousUrl` allows as `data:` URLs.
 *  SVG is excluded for the same reason: it can carry script. */
const RASTER_MIME = /^image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/i;

export function isRasterMime(mime: string | null | undefined): boolean {
  return !!mime && RASTER_MIME.test(mime.trim());
}

export function isAssetRef(value: unknown): value is string {
  return typeof value === "string" && REF_RE.test(value.trim());
}

/** `{ hash, fragment }` for a reference, or null for anything else. The hash is
 *  returned lower-case whatever case it was written in. */
export function parseAssetRef(value: unknown): { hash: string; fragment: string } | null {
  if (typeof value !== "string") return null;
  const m = REF_RE.exec(value.trim());
  return m ? { hash: m[1]!.toLowerCase(), fragment: m[2] ?? "" } : null;
}

export function assetRef(hash: string, fragment = ""): string {
  return `${ASSET_SCHEME}${hash.toLowerCase()}${fragment}`;
}

/** Every asset hash mentioned anywhere in `text`. */
export function refsInText(text: string, into: Set<string> = new Set()): Set<string> {
  if (!text) return into;
  for (const m of text.matchAll(REF_SCAN_RE)) into.add(m[1]!.toLowerCase());
  return into;
}

/**
 * Every asset hash a value mentions — a canonical document, a draft, a stash
 * entry, anything JSON can hold. Deliberately a TEXT scan of the serialised
 * value rather than a walk of known image attributes: the garbage collector
 * uses this to decide what it may delete, and over-counting (a reference
 * quoted in a code block keeps its image) is safe where under-counting (an
 * attribute this walker did not know about) loses an image.
 */
export function collectAssetRefs(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (value == null) return into;
  if (typeof value === "string") return refsInText(value, into);
  let text: string;
  try { text = JSON.stringify(value) ?? ""; } catch { return into; }
  return refsInText(text, into);
}

// ─── data: URLs ──────────────────────────────────────────────────────────────

const DATA_URL_RE = /^data:([^;,]*)((?:;[^;,]*)*?)(;base64)?,/i;

/** Is this a raster `data:` URL big enough to be worth storing as an asset? */
export function isExternalizableDataUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length < INLINE_MAX_CHARS) return false;
  const m = DATA_URL_RE.exec(value.slice(0, 200));
  return !!m && isRasterMime(m[1]);
}

/** Decode a `data:` URL into its bytes and type, or null when it is not one. */
export function parseDataUrl(value: string): { mime: string; bytes: Uint8Array } | null {
  const m = DATA_URL_RE.exec(value);
  if (!m) return null;
  const mime = (m[1] || "text/plain").trim().toLowerCase();
  const payload = value.slice(m[0].length);
  try {
    if (m[3]) {
      // Whitespace is legal inside base64 in a data: URL (line-wrapped exports).
      const bin = atob(payload.replace(/[\s]+/g, ""));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { mime, bytes };
    }
    return { mime, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
  } catch {
    return null;
  }
}

/** Base64 without building one giant argument list (a 5 MB image would blow
 *  the call stack as `String.fromCharCode(...bytes)`). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(bin);
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

/** The file extension an asset is written under in a ZIP. */
export function extForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/x-icon" || m === "image/vnd.microsoft.icon") return "ico";
  const sub = /^image\/([a-z0-9.+-]+)$/.exec(m)?.[1];
  return sub && /^[a-z0-9]+$/.test(sub) ? sub : "bin";
}

/** …and back, for a restore (the ZIP carries no types of its own). */
export function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "avif": return "image/avif";
    case "bmp": return "image/bmp";
    case "ico": return "image/x-icon";
    default: return "application/octet-stream";
  }
}

// ─── Canonical JSON ──────────────────────────────────────────────────────────

/** The image-bearing attributes of each node type (mirrors SizedImage and
 *  ThemeImage). */
export const IMAGE_SRC_ATTRS: Readonly<Record<string, readonly string[]>> = {
  image: ["src"],
  themeImage: ["lightSrc", "darkSrc"],
};

interface JsonNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JsonNode[];
  [k: string]: unknown;
}

/** Every image source in a canonical document, in document order. */
export function collectImageSrcs(canonical: unknown): string[] {
  const out: string[] = [];
  const walk = (node: JsonNode | undefined, depth: number) => {
    if (!node || typeof node !== "object" || depth > 400) return;
    const attrs = node.type ? IMAGE_SRC_ATTRS[node.type] : undefined;
    if (attrs && node.attrs) {
      for (const a of attrs) {
        const v = node.attrs[a];
        if (typeof v === "string" && v) out.push(v);
      }
    }
    if (Array.isArray(node.content)) for (const c of node.content) walk(c, depth + 1);
  };
  walk(canonical as JsonNode, 0);
  return out;
}

/**
 * A copy of `canonical` with every image source passed through `fn`. Nodes
 * whose sources do not change are shared, not copied; the input is never
 * mutated (it may be the live editor's JSON or a stored record).
 */
export function mapImageSrcs<T>(canonical: T, fn: (src: string) => string): T {
  const walk = (node: JsonNode, depth: number): JsonNode => {
    if (!node || typeof node !== "object" || depth > 400) return node;
    let next = node;
    const attrs = node.type ? IMAGE_SRC_ATTRS[node.type] : undefined;
    if (attrs && node.attrs) {
      let changed: Record<string, unknown> | null = null;
      for (const a of attrs) {
        const v = node.attrs[a];
        if (typeof v !== "string" || !v) continue;
        const nv = fn(v);
        if (nv !== v) (changed ??= { ...node.attrs })[a] = nv;
      }
      if (changed) next = { ...node, attrs: changed };
    }
    if (Array.isArray(node.content)) {
      let kids: JsonNode[] | null = null;
      node.content.forEach((c, i) => {
        const nc = walk(c, depth + 1);
        if (nc !== c) (kids ??= node.content!.slice())[i] = nc;
      });
      if (kids) next = { ...next, content: kids };
    }
    return next;
  };
  return walk(canonical as unknown as JsonNode, 0) as unknown as T;
}

/**
 * Replace every `pf-asset:` reference in TEXT (HTML or markdown) with what
 * `resolve` returns for its hash — a `data:` URL for a self-contained export,
 * a relative path for a ZIP. A hash `resolve` cannot supply (null) is left as
 * it is and reported in `missing`.
 */
export function replaceRefsInText(
  text: string,
  resolve: (hash: string) => string | null | undefined
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  if (!text || !/pf-asset:/i.test(text)) return { text, missing: [] };
  const out = text.replace(REF_SCAN_RE, (whole, hash: string) => {
    const r = resolve(hash.toLowerCase());
    if (r == null) { missing.add(hash.toLowerCase()); return whole; }
    return r;
  });
  return { text: out, missing: [...missing] };
}
