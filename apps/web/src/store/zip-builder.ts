/**
 * Library export plumbing: batched document reads and a ZIP builder that does
 * not freeze the page.
 *
 * Kept out of import-export.ts on purpose — that module ships in the `/store`
 * library entry, and this one pulls in fflate at runtime.
 */
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from "fflate";
import type { DocumentRecord } from "./document";
import type { StorageAdapter } from "./storage-adapter";

/**
 * Read many documents without awaiting them one after another.
 *
 * The export loop awaited `storage.get` sequentially — one IndexedDB
 * transaction per document, each waiting for the last — so a 2,000-document
 * backup spent seconds just reading. Adapters that offer `getMany` (the
 * IndexedDB one reads everything in ONE transaction) are used directly;
 * others are read in parallel batches. A document that cannot be read is
 * reported, never silently dropped from a backup.
 */
export async function readDocuments(
  storage: StorageAdapter & { getMany?: (ids: string[]) => Promise<(DocumentRecord | null | Error)[]> },
  ids: string[],
  batchSize = 50
): Promise<{ docs: Map<string, DocumentRecord>; unreadable: string[] }> {
  const docs = new Map<string, DocumentRecord>();
  const unreadable: string[] = [];
  const take = (id: string, r: DocumentRecord | null | Error | undefined) => {
    if (r instanceof Error) unreadable.push(id);
    else if (r) docs.set(id, r);
  };
  if (typeof storage.getMany === "function") {
    const results = await storage.getMany(ids);
    ids.forEach((id, i) => take(id, results[i]));
    return { docs, unreadable };
  }
  for (let i = 0; i < ids.length; i += batchSize) {
    const slice = ids.slice(i, i + batchSize);
    const results = await Promise.all(
      slice.map((id) => storage.get(id).catch((e) => (e instanceof Error ? e : new Error(String(e)))))
    );
    slice.forEach((id, k) => take(id, results[k]));
  }
  return { docs, unreadable };
}

/**
 * Build a ZIP without one long main-thread task.
 *
 * `zipSync` compressed the whole library in a single synchronous call — about
 * three seconds of frozen page at 2,000 documents (measured by the audit).
 * This compresses one file at a time into fflate's streaming `Zip` and yields
 * to the event loop whenever a slice has run for `sliceMs`, so input and
 * rendering keep up while a big backup is built. fflate's worker-based API
 * would move the work off-thread entirely, but it spawns a blob-URL worker per
 * file (which a strict CSP forbids) and still deflates small files on the main
 * thread; yielding needs neither.
 */
export async function buildZipAsync(
  files: Record<string, string | Uint8Array>,
  opts: { sliceMs?: number } = {}
): Promise<Uint8Array> {
  const sliceMs = opts.sliceMs ?? 12;
  const chunks: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((err, data) => {
    if (err) failure = err;
    else chunks.push(data);
  });
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  let sliceStart = now();
  for (const [path, content] of Object.entries(files)) {
    // Image assets (A086) are already compressed: deflating them again costs
    // time and saves nothing, so they are stored.
    const entry = typeof content === "string" ? new ZipDeflate(path, { level: 6 }) : new ZipPassThrough(path);
    zip.add(entry);
    entry.push(typeof content === "string" ? strToU8(content) : content, true);
    if (failure) throw failure;
    if (now() - sliceStart > sliceMs) {
      await new Promise((r) => setTimeout(r, 0));
      sliceStart = now();
    }
  }
  zip.end();
  if (failure) throw failure;
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}
