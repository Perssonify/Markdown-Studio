/**
 * "Clean up unused images" (Settings ▸ Storage, A086).
 *
 * Images stored as assets outlive the documents that stop using them — by
 * design: nothing is deleted automatically while anyone edits, because the
 * only safe moment to decide an image is garbage is when EVERY place that can
 * refer to one has been looked at. This is that look, run only when the user
 * asks, and it fails CLOSED: a source that cannot be read aborts the whole
 * collection rather than being taken as "no references there".
 *
 * An asset is kept when any of these mentions it:
 *  - a stored document (the whole record — content, and the import copy);
 *  - a version-history snapshot, including a deleted document's pre-delete
 *    copy (a restore must get its pictures back);
 *  - this tab's unsaved state: the live editor and every parked draft;
 *  - anything this origin keeps in localStorage — the crash-recovery stash,
 *    the Cards composer's draft — scanned whole, since over-counting is safe;
 *  - or it was stored or shown within GC_GRACE_MS. That window is what covers
 *    what no scan can see: an undo stack (in this tab or another), and an
 *    image another open tab has pasted but not yet saved. Each deletion
 *    re-checks it inside the deleting transaction, so an image re-pasted
 *    while the collection runs survives it.
 */
import { collectAssetRefs, refsInText } from "./asset-refs";
import { assetStore, type AssetMeta } from "./asset-store";
import type { DocumentRecord } from "../documents/document";
import { peekLiveCanonical, useDocumentStore } from "../documents/documentStore";
import { snapshotStore } from "../history/snapshot-store";
import { readDocuments } from "../importExport/zip-builder";

/** An unreferenced image younger than this (by storing or showing) is kept. */
export const GC_GRACE_MS = 24 * 60 * 60 * 1000;

/** Where references can live. Every reader THROWS when it cannot read. */
export interface AssetReferenceSources {
  documents(): Promise<unknown[]>;
  snapshots(): Promise<unknown[]>;
  inMemory(): unknown[];
  stashedText(): string[];
}

export interface UnusedAssetReport {
  /** Unreferenced and older than the grace window — what a clean-up deletes. */
  unused: AssetMeta[];
  unusedBytes: number;
  /** Unreferenced but used too recently to delete yet. */
  recent: number;
  /** Assets in the store at all. */
  total: number;
}

/** The references the app's own stores hold (the default sources). */
export function defaultReferenceSources(): AssetReferenceSources {
  return {
    async documents() {
      const storage = useDocumentStore.getState().getStorage();
      const ids = (await storage.list()).map((d) => d.id);
      const { docs, unreadable } = await readDocuments(storage, ids);
      if (unreadable.length) {
        throw new Error(`${unreadable.length} document(s) could not be read`);
      }
      return [...docs.values()] as DocumentRecord[];
    },
    snapshots: () => snapshotStore.scanCanonicals(),
    inMemory() {
      const s = useDocumentStore.getState();
      return [peekLiveCanonical(), s.activeDoc, ...s._unsavedEdits.values()];
    },
    stashedText() {
      const out: string[] = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          const v = k ? localStorage.getItem(k) : null;
          if (v && v.includes("pf-asset:")) out.push(v);
        }
      } catch {
        // Storage blocked: then nothing was stashed there either.
      }
      return out;
    },
  };
}

export async function findUnusedAssets(
  sources: AssetReferenceSources = defaultReferenceSources(),
  now: number = Date.now()
): Promise<UnusedAssetReport> {
  const all = await assetStore.list();
  const empty: UnusedAssetReport = { unused: [], unusedBytes: 0, recent: 0, total: all.length };
  if (!all.length) return empty;

  const refs = new Set<string>();
  for (const d of await sources.documents()) collectAssetRefs(d, refs);
  for (const c of await sources.snapshots()) collectAssetRefs(c, refs);
  for (const v of sources.inMemory()) collectAssetRefs(v, refs);
  for (const t of sources.stashedText()) refsInText(t, refs);

  const cutoff = now - GC_GRACE_MS;
  const unused: AssetMeta[] = [];
  let recent = 0;
  for (const a of all) {
    if (refs.has(a.hash)) continue;
    if (Math.max(a.touched || 0, a.created || 0) >= cutoff) recent++;
    else unused.push(a);
  }
  return { unused, unusedBytes: unused.reduce((n, a) => n + (a.size || 0), 0), recent, total: all.length };
}

/**
 * Delete what `findUnusedAssets` finds, re-scanning first (a report shown in
 * a confirmation dialog may be minutes old by the time it is confirmed).
 */
export async function cleanUpUnusedAssets(
  sources: AssetReferenceSources = defaultReferenceSources(),
  now: number = Date.now()
): Promise<{ deleted: number; freedBytes: number; recent: number }> {
  const report = await findUnusedAssets(sources, now);
  if (!report.unused.length) return { deleted: 0, freedBytes: 0, recent: report.recent };
  const { deleted, bytes } = await assetStore.deleteUnused(
    report.unused.map((a) => a.hash),
    now - GC_GRACE_MS
  );
  return { deleted: deleted.length, freedBytes: bytes, recent: report.recent };
}
