import { Gunzip, strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { IngestFormat } from "./ingest";
import { MAX_ASSET_BYTES, mimeForExt } from "./asset-refs";

/**
 * Archive (ZIP / TAR / TAR.GZ / GZ) import & export. Uses fflate (MIT) for
 * zip/gzip; TAR is parsed with a small reader (fflate has no tar support).
 * Only text document files are extracted; directory structure maps to folders.
 */

export interface ArchiveEntry {
  /** Full path within the archive, e.g. "notes/2026/intro.md". */
  path: string;
  text: string;
  format: IngestFormat;
}

/**
 * An image asset carried by an archive (A086): a full backup's, or a markdown
 * export's, `assets/<sha256>.<ext>` file. Not a document — it goes back into
 * the asset store, and documents refer to it by its hash.
 */
export interface ArchiveAsset {
  hash: string;
  mime: string;
  bytes: Uint8Array;
}

/** What `extractArchive` returns: the text documents, plus the image assets
 *  the archive carried (empty for an archive with none). */
export type ExtractedArchive = ArchiveEntry[] & { assets: ArchiveAsset[] };

/** An asset file, where a backup and a markdown ZIP export write them: an
 *  `assets` directory, named by the SHA-256 of the bytes, with an IMAGE
 *  extension — so a document that merely lives in a folder called "assets"
 *  (`assets/notes.md`, even one titled with 64 hex digits) is never mistaken
 *  for one. */
const ASSET_PATH = /(?:^|\/)assets\/([0-9a-f]{64})\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i;

/** Is this archive path an image asset (rather than a document)? */
export function assetPathHash(path: string): { hash: string; ext: string } | null {
  const m = ASSET_PATH.exec(path);
  return m ? { hash: m[1]!.toLowerCase(), ext: m[2]!.toLowerCase() } : null;
}

export interface ExtractArchiveOptions {
  maxCompressedBytes?: number;
  maxTotalBytes?: number;
  maxEntryBytes?: number;
  maxEntries?: number;
  /** Image assets are budgeted apart from text: pictures are big and do not
   *  compress, and a backup of a library with images must still restore. */
  maxAssetBytes?: number;
  maxAssetTotalBytes?: number;
  /** Password for an encrypted ZIP (decrypted lazily via @zip.js/zip.js). */
  password?: string;
}

/** Thrown when a ZIP is encrypted and no password was supplied. */
export class ArchiveEncryptedError extends Error {
  constructor() {
    super("Archive is password-protected");
    this.name = "ArchiveEncryptedError";
  }
}

/** Thrown when the supplied password fails to decrypt the ZIP. */
export class ArchiveWrongPasswordError extends Error {
  constructor() {
    super("Incorrect password");
    this.name = "ArchiveWrongPasswordError";
  }
}

/**
 * Detect a password-protected ZIP without any dependency by reading the
 * general-purpose bit flag (bit 0 = encrypted) from the central directory — or,
 * if the EOCD can't be located, from the first local file header. fflate cannot
 * decrypt these, so we detect first and hand off to zip.js only when needed.
 */
export function isZipEncrypted(buf: Uint8Array): boolean {
  const n = buf.length;
  const u16 = (i: number) => buf[i]! | (buf[i + 1]! << 8);
  // Locate the End Of Central Directory record (PK\x05\x06) near the tail.
  let eocd = -1;
  for (let i = n - 22; i >= Math.max(0, n - 22 - 65536); i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) {
    if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
      return (u16(6) & 0x0001) !== 0; // local file header flag
    }
    return false;
  }
  let p = buf[eocd + 16]! | (buf[eocd + 17]! << 8) | (buf[eocd + 18]! << 16) | (buf[eocd + 19]! << 24);
  // Walk each central-directory header (PK\x01\x02); test bit 0 on each entry.
  while (p + 46 <= n && buf[p] === 0x50 && buf[p + 1] === 0x4b && buf[p + 2] === 0x01 && buf[p + 3] === 0x02) {
    if (u16(p + 8) & 0x0001) return true;
    p += 46 + u16(p + 28) + u16(p + 30) + u16(p + 32); // + name + extra + comment
  }
  return false;
}

/** Decrypt an encrypted ZIP to a fflate-shaped file map via zip.js (lazy). */
async function unzipEncrypted(
  buf: Uint8Array,
  password: string,
  limits: Required<Omit<ExtractArchiveOptions, "password">>
): Promise<Record<string, Uint8Array>> {
  const { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } = await import("@zip.js/zip.js");
  const reader = new ZipReader(new Uint8ArrayReader(buf), { password });
  const map: Record<string, Uint8Array> = {};
  try {
    const zipEntries = await reader.getEntries();
    let total = 0;
    let assetTotal = 0;
    for (const e of zipEntries) {
      if (e.directory) continue;
      if (assetPathHash(e.filename)) {
        if ((e.uncompressedSize ?? 0) > limits.maxAssetBytes) continue; // too big to be one image: skipped
        assetTotal += e.uncompressedSize ?? 0;
        if (assetTotal > limits.maxAssetTotalBytes) throw new Error("Archive too large after decompression");
        map[e.filename] = await e.getData!(new Uint8ArrayWriter());
        continue;
      }
      if (!TEXT_EXT.test(e.filename)) continue;
      if ((e.uncompressedSize ?? 0) > limits.maxEntryBytes) throw new Error("Archive entry too large");
      total += e.uncompressedSize ?? 0;
      if (total > limits.maxTotalBytes) throw new Error("Archive too large after decompression");
      map[e.filename] = await e.getData!(new Uint8ArrayWriter());
    }
  } catch (err) {
    const msg = String((err as { message?: unknown } | null)?.message || err);
    if (/password|invalid pass|ERR_INVALID_PASSWORD/i.test(msg)) throw new ArchiveWrongPasswordError();
    throw err;
  } finally {
    await reader.close();
  }
  return map;
}

const DEFAULT_EXTRACT_LIMITS: Required<Omit<ExtractArchiveOptions, "password">> = {
  // Raised from 5 MB for A086: a backup now carries its images as files, and a
  // library with a few photos is past 5 MB compressed. The text budgets below
  // are unchanged, and every entry is still size-checked BEFORE it is inflated.
  maxCompressedBytes: 300 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024,
  maxEntryBytes: 5 * 1024 * 1024,
  maxEntries: 500,
  maxAssetBytes: MAX_ASSET_BYTES,
  maxAssetTotalBytes: 256 * 1024 * 1024,
};

const TEXT_EXT = /\.(md|markdown|mdown|txt|html?|json)$/i;

export function isArchiveName(name: string): boolean {
  return /\.(zip|tar|tgz|gz)$/i.test(name);
}

/**
 * Normalize an archive entry path to safe RELATIVE segments: convert backslashes,
 * strip an absolute root (leading `/` or a Windows `C:` drive) and drop every
 * `.`, `..`, or empty segment. A crafted entry (`../../x.md`, `/etc/x.md`,
 * `C:\x.md`) therefore can never traverse above the import tree or poison a
 * folder path / storage key downstream. Returns "" if nothing safe remains.
 */
export function normalizeArchivePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split("/")
    // Strip a leading Windows drive prefix on the segment (`C:` alone, or the
    // drive-relative `C:notes.md` form with no separator) so no `:` drive marker
    // survives into a folder name or storage key.
    .map((seg) => seg.replace(/^[a-zA-Z]:/, ""))
    .filter(
      (seg) =>
        seg &&
        seg !== "." &&
        seg !== ".." &&
        // Defense-in-depth: never let a path segment be a prototype-pollution key
        // if any future code ever indexes an object by path segment.
        seg !== "__proto__" &&
        seg !== "constructor" &&
        seg !== "prototype"
    )
    .join("/");
}

export function formatForName(name: string): IngestFormat {
  const n = name.toLowerCase();
  if (n.endsWith(".md") || n.endsWith(".markdown") || n.endsWith(".mdown"))
    return "markdown";
  if (n.endsWith(".html") || n.endsWith(".htm")) return "html";
  if (n.endsWith(".json")) return "pmjson";
  return "text";
}

/** Minimal POSIX tar reader — enough to extract regular file entries. */
function parseTar(buf: Uint8Array): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const dec = new TextDecoder();
  let off = 0;
  // Long name carried by a preceding GNU 'L' record or a PAX 'x'/'g' header,
  // applied to the next regular file entry.
  let pendingName: string | null = null;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    const rawName = dec.decode(header.subarray(0, 100)).replace(/\0.*$/, "");
    // ustar `prefix` field (bytes 345-500) holds the leading path for names >100
    // chars; prepend it so deeply-nested entries aren't truncated/misnamed.
    const prefix = dec.decode(header.subarray(345, 500)).replace(/\0.*$/, "");
    const sizeOctal = dec.decode(header.subarray(124, 136)).replace(/\0.*$/, "").trim();
    const size = parseInt(sizeOctal, 8) || 0;
    const typeflag = header[156];
    off += 512;
    const body = buf.subarray(off, off + size);
    off += Math.ceil(size / 512) * 512;

    if (typeflag === 0x4c /* 'L' GNU long name */) {
      pendingName = dec.decode(body).replace(/\0.*$/, "");
      continue;
    }
    if (typeflag === 0x78 /* 'x' */ || typeflag === 0x67 /* 'g' PAX */) {
      const m = dec.decode(body).match(/\d+ path=([^\n]*)\n/);
      if (m) pendingName = m[1] ?? null;
      continue;
    }
    if (typeflag === 0x4b /* 'K' GNU long link — ignore */) {
      continue;
    }

    if (!rawName && !pendingName) break; // end-of-archive (zero block)

    // '0' (0x30) or NUL typeflag = regular file
    if (typeflag === 0 || typeflag === 0x30) {
      const name = pendingName ?? (prefix ? `${prefix}/${rawName}` : rawName);
      if (name) files[name] = body;
    }
    pendingName = null;
  }
  return files;
}

/**
 * Gunzip with a hard output-byte budget. fflate's streaming `Gunzip` emits the
 * decompressed data in chunks; we sum their sizes and abort the moment the total
 * would exceed `maxBytes`, so a gzip bomb can never buffer more than the budget
 * (plus one chunk) — unlike `gunzipSync`, which allocates the entire output
 * before any size check can run.
 */
function boundedGunzip(buf: Uint8Array, maxBytes: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflow = false;
  const g = new Gunzip((chunk) => {
    if (overflow) return;
    total += chunk.length;
    if (total > maxBytes) {
      // Stop retaining output; remaining chunks are discarded as they arrive so
      // peak memory stays bounded to ~maxBytes regardless of the bomb's size.
      overflow = true;
      chunks.length = 0;
      // Best-effort: also halt further decompression to bound CPU, if the
      // running fflate build exposes terminate() (not in its published types).
      (g as unknown as { terminate?: () => void }).terminate?.();
      return;
    }
    chunks.push(chunk);
  });
  g.push(buf, true);
  if (overflow) throw new Error("Archive too large after decompression");
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export async function extractArchive(
  file: File,
  options: ExtractArchiveOptions = {}
): Promise<ExtractedArchive> {
  const limits = { ...DEFAULT_EXTRACT_LIMITS, ...options };
  if (file.size > limits.maxCompressedBytes) {
    throw new Error("Archive compressed file too large");
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  let fileMap: Record<string, Uint8Array> = {};

  if (name.endsWith(".zip")) {
    // Password-protected ZIP: fflate can't decrypt, so detect the encryption bit
    // and either ask for a password (throw) or decrypt via zip.js when given one.
    if (isZipEncrypted(buf)) {
      if (!limits.password) throw new ArchiveEncryptedError();
      fileMap = await unzipEncrypted(buf, limits.password, limits);
    } else {
    // Decompression-bomb guard: fflate's `filter` runs against the zip central
    // directory (which carries each entry's declared uncompressed `originalSize`)
    // BEFORE inflating, so oversized entries — and any archive whose declared
    // total exceeds the cap — are rejected without ever allocating the bomb.
    let declaredTotal = 0;
    let declaredAssets = 0;
    fileMap = unzipSync(buf, {
      filter: (f) => {
        if (assetPathHash(f.name)) {
          if (f.originalSize > limits.maxAssetBytes) return false; // skipped, not fatal
          declaredAssets += f.originalSize;
          if (declaredAssets > limits.maxAssetTotalBytes) {
            throw new Error("Archive too large after decompression");
          }
          return true;
        }
        if (f.originalSize > limits.maxEntryBytes) {
          throw new Error("Archive entry too large");
        }
        declaredTotal += f.originalSize;
        if (declaredTotal > limits.maxTotalBytes) {
          throw new Error("Archive too large after decompression");
        }
        return TEXT_EXT.test(f.name); // only inflate text documents
      },
    });
    }
  } else if (name.endsWith(".tar")) {
    fileMap = parseTar(buf);
  } else if (name.endsWith(".tgz") || name.endsWith(".tar.gz")) {
    fileMap = parseTar(boundedGunzip(buf, limits.maxTotalBytes));
  } else if (name.endsWith(".gz")) {
    fileMap = {
      [file.name.replace(/\.gz$/i, "")]: boundedGunzip(buf, limits.maxTotalBytes),
    };
  }

  const entries: ArchiveEntry[] = [];
  const assets: ArchiveAsset[] = [];
  let totalBytes = 0;
  let assetBytes = 0;
  for (const [rawPath, data] of Object.entries(fileMap)) {
    if (rawPath.endsWith("/")) continue; // directory marker
    if (rawPath.includes("__MACOSX")) continue; // archiver junk
    // Normalize away absolute roots and `..`/`.` segments before the path is
    // trusted anywhere downstream (folder tree, storage keys).
    const path = normalizeArchivePath(rawPath);
    if (!path) continue;
    const segments = path.split("/");
    const base = segments[segments.length - 1] ?? path;
    // Hidden DIRECTORIES (.git/, .obsidian/) are junk. A dot-prefixed FILE name
    // is not: this used to skip any path containing "/." and any dot-prefixed
    // basename, which silently discarded real documents on re-import — a note
    // titled ".env setup" is written into the backup ZIP and counted in
    // "Exported N document(s)", then vanishes on restore with no warning. A
    // backup that looked complete and was not. Checked AFTER normalization, so
    // a `../escape.md` traversal entry is still flattened rather than dropped.
    if (segments.slice(0, -1).some((seg) => seg.startsWith("."))) continue;
    if (base === ".DS_Store" || base === ".gitkeep") continue;
    const asset = assetPathHash(path);
    if (asset) {
      // Budgeted apart from the documents (see maxAssetBytes). The TYPE comes
      // from the extension; the asset store refuses anything but a raster image.
      if (data.byteLength > limits.maxAssetBytes) continue;
      assetBytes += data.byteLength;
      if (assetBytes > limits.maxAssetTotalBytes) throw new Error("Archive too large after decompression");
      assets.push({ hash: asset.hash, mime: mimeForExt(asset.ext), bytes: data });
      continue;
    }
    if (!TEXT_EXT.test(path)) continue; // only text documents

    if (entries.length >= limits.maxEntries) {
      throw new Error("Archive contains too many entries");
    }
    if (data.byteLength > limits.maxEntryBytes) {
      throw new Error("Archive entry too large");
    }
    totalBytes += data.byteLength;
    if (totalBytes > limits.maxTotalBytes) {
      throw new Error("Archive too large after decompression");
    }

    entries.push({ path, text: strFromU8(data), format: formatForName(path) });
  }
  return Object.assign(entries, { assets });
}

/** One document extracted from an archive, ready for the import pipeline. */
export interface ArchiveImportItem {
  text: string;
  format: IngestFormat;
  /** Folder segments the doc should be created under ([] = top level). */
  folderPath: string[];
}

/** Strip an extension and filesystem-hostile characters from a name so it can
 *  serve as a folder name. */
export function sanitizeFolderName(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[/\\:*?"<>|]+/g, "_")
    .trim();
}

/**
 * Map extracted archive entries to import items, wrapping loose top-level files
 * in a folder named after the archive so importing `notes.zip` full of bare
 * `.md` files yields a tidy `notes/` folder instead of scattering them across
 * the root.
 *
 * Rules:
 *  - a **perssonify full backup** (every entry is a `perssonify-document`
 *    envelope) → paths kept EXACTLY as written so re-import restores the original
 *    folder tree; never wrapped (wrapping would nest the whole library under a
 *    synthetic `perssonify-backup-…/` folder and defeat the restore promise);
 *  - single file → imported at the root unchanged (nothing to organize);
 *  - every entry already nested under folders (no loose root file) → kept as-is
 *    (the archive already carries its own structure — don't double-nest);
 *  - otherwise (>1 entry with at least one loose root file) → every entry is
 *    nested under `<archive-name>/` so the archive imports as one folder.
 */
export function archiveEntriesToItems(
  entries: ArchiveEntry[],
  zipBaseName: string
): ArchiveImportItem[] {
  const paths = entries.map((e) => e.path.split("/").filter(Boolean));
  const hasRootFile = paths.some((segs) => segs.length <= 1);
  // A full backup carries its own folder structure in the entry paths and must
  // round-trip verbatim, so never apply the loose-file wrap heuristic to it.
  const isBackup =
    entries.length > 0 &&
    entries.every(
      (e) => e.format === "pmjson" && /"_format"\s*:\s*"perssonify-document"/.test(e.text)
    );
  const wrap = !isBackup && entries.length > 1 && hasRootFile;
  const base = sanitizeFolderName(zipBaseName) || "archive";

  return entries.map((e, i) => {
    const dir = paths[i]!.slice(0, -1);
    return {
      text: e.text,
      format: e.format,
      folderPath: wrap ? [base, ...dir] : dir,
    };
  });
}

/** Zip a map of `path → content` into a single archive byte array. Text is
 *  deflated; bytes (image assets, which do not compress) are stored as-is. */
export function buildZip(files: Record<string, string | Uint8Array>): Uint8Array {
  const map: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  for (const [path, content] of Object.entries(files)) {
    map[path] = typeof content === "string" ? strToU8(content) : [content, { level: 0 }];
  }
  return zipSync(map);
}
