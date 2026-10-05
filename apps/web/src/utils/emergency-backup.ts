/**
 * "Export my documents" for the crash screen.
 *
 * The library's own backup export lives inside PerssonifyEditor (a hook
 * closure over the live editor), which is exactly what is gone when the crash
 * screen is showing. This builds the same archive — a `perssonify-backup` ZIP of
 * `perssonify-document` envelopes in their folders, which Import restores
 * verbatim — from the storage adapter and the store's parked drafts alone. No
 * React, no editor, no engine.
 *
 * What it can NOT include: text typed into the editor after its last autosave.
 * That lived in the editor instance the crash destroyed.
 */
import { buildZip } from "../store/archive";
import { extForMime } from "../store/asset-refs";
import { collectAssetsFor } from "../store/assets";
import { resolveDocTitle, type DocumentRecord } from "../store/document";
import { isBlankCanonical, useDocumentStore } from "../store/documentStore";
import { useFolderStore } from "../store/folders";
import { downloadBlob, exportTimestamp, toExportEnvelope } from "../store/import-export";

export interface BackupSources {
  storage: {
    list(): Promise<Array<{ id: string }>>;
    get(id: string): Promise<DocumentRecord | null>;
  };
  /** Unsaved edits parked by document switches (docId → canonical). */
  drafts: ReadonlyMap<string, unknown>;
  folders: ReadonlyArray<{ id: string; name: string; parentId: string | null }>;
  docParents: Readonly<Record<string, string>>;
}

/** The library as it is now: stored documents, parked drafts and folders. */
export function liveBackupSources(): BackupSources {
  const docs = useDocumentStore.getState();
  const { folders, docParents } = useFolderStore.getState();
  return { storage: docs.getStorage(), drafts: docs._unsavedEdits, folders, docParents };
}

const sanitize = (s: string) => s.replace(/[/\\:*?"<>|]+/g, "_").trim() || "untitled";

/** path → JSON text, one envelope per stored document. */
export async function buildBackupFiles(src: BackupSources): Promise<Record<string, string>> {
  const byId = new Map(src.folders.map((f) => [f.id, f]));
  const dirOf = (docId: string): string => {
    const segs: string[] = [];
    const seen = new Set<string>();
    let cur: string | null | undefined = src.docParents[docId];
    while (cur && !seen.has(cur)) {
      seen.add(cur); // a corrupt parent cycle must not hang the escape hatch
      const f = byId.get(cur);
      if (!f) break;
      segs.unshift(sanitize(f.name));
      cur = f.parentId;
    }
    return segs.join("/");
  };

  const files: Record<string, string> = {};
  const used = new Set<string>();
  for (const { id } of await src.storage.list()) {
    let rec: DocumentRecord | null;
    try {
      rec = await src.storage.get(id);
    } catch {
      rec = null; // one unreadable record must not cost the user the rest
    }
    if (!rec) continue;
    // A parked draft is newer than the stored copy — unless it is blank over
    // real content, which the save path itself refuses to persist.
    const draft = src.drafts.get(id);
    const useDraft = draft != null && !(isBlankCanonical(draft) && !isBlankCanonical(rec.canonical));
    const canonical = (useDraft ? draft : rec.canonical) as DocumentRecord["canonical"];
    const title = resolveDocTitle(rec, canonical).title;
    const dir = dirOf(id);
    const base = (dir ? dir + "/" : "") + sanitize(title || "untitled");
    let path = `${base}.json`;
    for (let i = 1; used.has(path); i++) path = `${base} (${i}).json`;
    used.add(path);
    // The ONE envelope every export uses. Without it this escape hatch kept the
    // imported originals (origin.raw, clipboard copies: text the user may have
    // deleted since, A079) and carried no schemaVersion, so content from a
    // newer build restored into an older one could open blank (A021).
    const envelope = toExportEnvelope(
      { ...rec, canonical, updated: useDraft ? new Date().toISOString() : rec.updated },
      title,
    );
    files[path] = JSON.stringify(envelope, null, 2);
  }
  return files;
}

/**
 * Build the backup and hand it to the browser as a download. Returns how many
 * documents it contains (0 → nothing was downloaded).
 */
export async function exportEmergencyBackup(
  src: BackupSources = liveBackupSources(),
  download: (blob: Blob, filename: string) => void = downloadBlob,
): Promise<number> {
  const { zip, count } = await buildBackupZip(src);
  if (!count) return 0;
  download(new Blob([zip as BlobPart], { type: "application/zip" }), `perssonify-backup-${exportTimestamp()}.zip`);
  return count;
}

/**
 * The backup archive itself — the documents and, beside them, the images they
 * keep as assets — without handing it anywhere. The crash screen downloads it;
 * the signed-in app also stores one a day in the account (app/cloud/backup.ts).
 */
export async function buildBackupZip(src: BackupSources): Promise<{ zip: Uint8Array; count: number }> {
  const files = await buildBackupFiles(src);
  const count = Object.keys(files).length;
  if (!count) return { zip: new Uint8Array(), count: 0 };
  // The images those documents keep as assets (A086) go in beside them, as
  // the ordinary backup writes them, so Import restores the pictures too.
  // Best effort: an asset store that cannot be read must not cost the user
  // the documents themselves.
  const archive: Record<string, string | Uint8Array> = { ...files };
  try {
    const { assets } = await collectAssetsFor(Object.values(files));
    for (const [hash, a] of assets) archive[`assets/${hash}.${extForMime(a.mime)}`] = a.bytes;
  } catch { /* documents only */ }
  return { zip: buildZip(archive), count };
}
