/**
 * Moving images between documents and the asset store (A086): storing the
 * `data:` images of an imported document as assets, putting a backup's assets
 * back, and turning references into self-contained data again for anything
 * that leaves the app (exports, the clipboard).
 *
 * Every function here degrades to today's behaviour when the store is
 * unavailable: nothing is externalized, and a reference whose bytes travelled
 * WITH the content (a backup, a JSON export) is inlined as a `data:` URL
 * rather than left pointing at nothing.
 */
import type { DocumentRecord } from "./document";
import {
  assetRef,
  bytesToBase64,
  bytesToDataUrl,
  collectAssetRefs,
  isExternalizableDataUrl,
  isRasterMime,
  mapImageSrcs,
  parseAssetRef,
  parseDataUrl,
  replaceRefsInText,
} from "./asset-refs";
import { assetStore } from "./asset-store";

/** An asset's bytes and type, travelling with an import or an export. */
export interface AssetPayload {
  mime: string;
  bytes: Uint8Array;
}

/** The `assets` member of a `perssonify-document` envelope. */
export type EnvelopeAssets = Record<string, { mime: string; data: string }>;

/** Where a markdown ZIP export points an image: `assets/<hash>.<ext>` beside
 *  the archive root, reached from a document with `../` per folder level. */
const RELATIVE_ASSET_RE = /^(?:\.\.?\/)*assets\/([0-9a-f]{64})\.(?:png|jpe?g|gif|webp|avif|bmp|ico)(#[^\s"'<>]*)?$/i;

/** The relative path a markdown ZIP export writes for an asset, from a
 *  document `depth` folders below the archive root. */
export function relativeAssetPath(hash: string, ext: string, depth: number): string {
  return `${"../".repeat(Math.max(0, depth))}assets/${hash}.${ext}`;
}

// ─── Into the store ──────────────────────────────────────────────────────────

/**
 * Store every big raster `data:` image of a canonical document as an asset
 * and return the document with references in their place, plus the map of
 * what was replaced (data URL → reference) so the same substitution can be
 * applied to the document's other copies of that text. An image that cannot
 * be stored stays inline. The input is never mutated.
 */
export async function externalizeCanonical<T>(
  canonical: T
): Promise<{ canonical: T; replaced: Map<string, string> }> {
  const replaced = new Map<string, string>();
  const candidates = new Set<string>();
  mapImageSrcs(canonical, (src) => {
    if (isExternalizableDataUrl(src)) candidates.add(src);
    return src;
  });
  if (!candidates.size || !(await assetStore.available())) return { canonical, replaced };
  for (const url of candidates) {
    const hash = await assetStore.putDataUrl(url);
    if (hash) replaced.set(url, assetRef(hash));
  }
  if (!replaced.size) return { canonical, replaced };
  return { canonical: mapImageSrcs(canonical, (src) => replaced.get(src) ?? src), replaced };
}

/** Apply a data-URL → reference map to text (an import's raw input). */
export function replaceDataUrlsInText(text: string, replaced: Map<string, string>): string {
  let out = text;
  for (const [url, ref] of replaced) {
    if (out.includes(url)) out = out.split(url).join(ref);
  }
  return out;
}

/**
 * Put assets that arrived WITH an import (a backup's `assets/` folder, a JSON
 * export's `assets`) into the store. Content-addressed, so a claimed hash is
 * VERIFIED: bytes that do not hash to the name they came under are not
 * restored under that name. Returns the hashes now available.
 */
export async function restoreAssets(assets: Map<string, AssetPayload>): Promise<Set<string>> {
  const stored = new Set<string>();
  if (!assets.size || !(await assetStore.available())) return stored;
  for (const [hash, a] of assets) {
    if (!isRasterMime(a.mime)) continue;
    const got = await assetStore.put(a.bytes, a.mime);
    if (got && got === hash) stored.add(hash);
  }
  return stored;
}

/** Decode an envelope's `assets` member, ignoring anything malformed. */
export function decodeEnvelopeAssets(raw: unknown): Map<string, AssetPayload> {
  const out = new Map<string, AssetPayload>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const hash = parseAssetRef(`pf-asset:${key}`)?.hash;
    if (!hash || !v || typeof v !== "object") continue;
    const { mime, data } = v as { mime?: unknown; data?: unknown };
    if (typeof mime !== "string" || typeof data !== "string" || !isRasterMime(mime)) continue;
    const parsed = parseDataUrl(`data:${mime};base64,${data}`);
    if (parsed) out.set(hash, { mime: mime.toLowerCase(), bytes: parsed.bytes });
  }
  return out;
}

export function encodeEnvelopeAssets(assets: Map<string, AssetPayload>): EnvelopeAssets {
  const out: EnvelopeAssets = {};
  for (const [hash, a] of assets) out[hash] = { mime: a.mime, data: bytesToBase64(a.bytes) };
  return out;
}

/**
 * Make an imported document's images work HERE, in place: store the assets
 * that came with it, store its big `data:` images as assets, and — for any
 * reference whose asset could not be stored but whose bytes arrived with the
 * import — fall back to an inline `data:` URL, so a backup restored where the
 * asset store is unavailable still shows every picture. A reference whose
 * bytes are nowhere is left as it is (the editor shows it as unavailable).
 * `origin.raw` and the ingest report's HTML copy get the same substitution,
 * or the stored record would still carry every picture as base64.
 */
export async function prepareImportedDocAssets(
  doc: DocumentRecord,
  carried: Map<string, AssetPayload> = new Map()
): Promise<void> {
  const own = decodeEnvelopeAssets((doc as DocumentRecord & { _importAssets?: unknown })._importAssets);
  delete (doc as DocumentRecord & { _importAssets?: unknown })._importAssets;
  const bytesFor = new Map([...carried, ...own]);

  // A markdown ZIP export links its images by relative path
  // (`../assets/<hash>.png`); with those files in the same archive, they are
  // the same assets — point the document back at them.
  if (bytesFor.size) {
    doc.canonical = mapImageSrcs(doc.canonical, (src) => {
      const m = RELATIVE_ASSET_RE.exec(src);
      const hash = m?.[1]?.toLowerCase();
      return hash && bytesFor.has(hash) ? assetRef(hash, m![2] ?? "") : src;
    });
  }

  // Only the carried assets this document actually refers to.
  const refs = collectAssetRefs(doc.canonical);
  if (refs.size) {
    const wanted = new Map<string, AssetPayload>();
    for (const h of refs) {
      const a = bytesFor.get(h);
      if (a) wanted.set(h, a);
    }
    await restoreAssets(wanted);
    const present = await assetStore.hasMany(refs);
    const inline = new Map<string, string>();
    for (const h of refs) {
      const a = bytesFor.get(h);
      if (!present.has(h) && a) inline.set(h, bytesToDataUrl(a.bytes, a.mime));
    }
    if (inline.size) {
      doc.canonical = mapImageSrcs(doc.canonical, (src) => {
        const ref = parseAssetRef(src);
        const url = ref && inline.get(ref.hash);
        return url ? url + ref.fragment : src;
      });
    }
  }

  const { canonical, replaced } = await externalizeCanonical(doc.canonical);
  if (!replaced.size) return;
  doc.canonical = canonical;
  if (doc.origin && typeof doc.origin.raw === "string") {
    doc.origin = { ...doc.origin, raw: replaceDataUrlsInText(doc.origin.raw, replaced) };
  }
  const report = doc.ingestReport as { preIngestHtml?: unknown } | null | undefined;
  if (report && typeof report.preIngestHtml === "string") {
    doc.ingestReport = { ...report, preIngestHtml: replaceDataUrlsInText(report.preIngestHtml, replaced) };
  }
}

// ─── Out of the store ────────────────────────────────────────────────────────

/**
 * Every asset the given values refer to, with its bytes — for an export that
 * must carry them. Hashes with no asset here are listed in `missing`.
 */
export async function collectAssetsFor(
  values: Iterable<unknown>
): Promise<{ assets: Map<string, AssetPayload>; missing: string[] }> {
  const refs = new Set<string>();
  for (const v of values) collectAssetRefs(v, refs);
  const assets = new Map<string, AssetPayload>();
  const missing: string[] = [];
  for (const hash of refs) {
    const rec = await assetStore.get(hash);
    if (rec) assets.set(hash, rec);
    else missing.push(hash);
  }
  return { assets, missing };
}

/**
 * Replace every reference in exported TEXT (HTML, markdown) with the image
 * itself as a `data:` URL, so the file stands on its own anywhere. A
 * reference with no asset is left as it is and reported.
 */
export async function inlineAssetRefsInText(text: string): Promise<{ text: string; missing: string[] }> {
  const refs = collectAssetRefs(text);
  if (!refs.size) return { text, missing: [] };
  const urls = new Map<string, string>();
  for (const hash of refs) {
    const url = await assetStore.dataUrl(hash);
    if (url) urls.set(hash, url);
  }
  return replaceRefsInText(text, (hash) => urls.get(hash));
}

/** The same for a canonical document (a JSON export where the store is off). */
export function inlineRefsInCanonical<T>(canonical: T, assets: Map<string, AssetPayload>): T {
  return mapImageSrcs(canonical, (src) => {
    const ref = parseAssetRef(src);
    const a = ref && assets.get(ref.hash);
    return a ? bytesToDataUrl(a.bytes, a.mime) + ref.fragment : src;
  });
}

/** A short, human sentence for exports that could not include every image. */
export function missingImagesNote(missing: number): string | null {
  if (!missing) return null;
  return missing === 1
    ? "1 image is not stored in this browser and could not be included"
    : `${missing} images are not stored in this browser and could not be included`;
}
