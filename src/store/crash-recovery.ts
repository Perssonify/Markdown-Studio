/**
 * Last-resort recovery for edits that never reached IndexedDB.
 *
 * `beforeunload` already fires a best-effort autosave, but IndexedDB is
 * ASYNCHRONOUS: `saveActiveDoc` awaits a read before it writes, and the page is
 * gone long before that resolves. Measured in a browser — type into the editor
 * and reload within the autosave window and the text is on neither pane nor
 * disk afterwards. The in-memory draft cache does not survive a reload either.
 *
 * localStorage is the only store the page can write SYNCHRONOUSLY while it is
 * being torn down, which is the entire reason this module exists rather than
 * going through the injected StorageAdapter (the editor otherwise never writes
 * to localStorage directly). It is a stash, not a store: written on unload,
 * taken exactly once on the next boot, and handed to the ordinary unsaved-draft
 * cache so every existing path — the dirty flag, the close prompt, the next
 * autosave — treats it like any other unsaved edit.
 */
import { safeStorage } from "../utils/safe-storage";

export const RECOVERY_KEY = "pf:recovery";

/** Above this the stash is not worth attempting: localStorage is ~5MB total
 *  and a failed write would cost the whole stash, small documents included. */
const MAX_STASH_BYTES = 2 * 1024 * 1024;

/** Older than this and the user has moved on; do not resurrect it. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface RecoveryEntry {
  docId: string;
  canonical: unknown;
  /** When the stash was written (epoch ms). */
  at: number;
  /**
   * The `updated` stamp of the stored revision this draft was written ON TOP
   * OF — its provenance, the same value documentStore keeps in `_draftBases`.
   *
   * Without it a reload laundered a multi-tab conflict: the tab that had
   * already REFUSED to save (another tab wrote a newer version) stashed its
   * text, the next boot adopted it against the record now on disk — carrying
   * the OTHER tab's `updated` — so the guard measured zero drift and the first
   * autosave silently replaced the other tab's work. Absent on stashes written
   * before this existed; those keep the old behaviour.
   */
  base?: string;
  /** The tab had already refused to save this draft because another tab wrote
   *  a newer version. Carried so the conflict resurfaces after the reload
   *  instead of resolving itself silently. */
  conflict?: boolean;
}

// Host overrides (see `configureRecovery`). The defaults are the on-disk
// contract with every existing install and must not change.
let recoveryKey = RECOVERY_KEY;
let recoveryEnabled = true;

/**
 * Let a host keep the stash out of its origin's localStorage, or give it a
 * key of its own.
 *
 * The stash is written to the HOST page's origin, whatever storage adapter the
 * host injected — so on a shared device one user's unsaved text could be
 * adopted by the next user's editor. A host that namespaces its documents
 * (per-user IndexedDB name, its own adapter) namespaces this too, or turns it
 * off. Called by the editor before it initializes; the defaults are untouched
 * for the standalone app.
 */
export function configureRecovery(opts: { key?: string; enabled?: boolean } = {}): void {
  recoveryKey = opts.key || RECOVERY_KEY;
  recoveryEnabled = opts.enabled !== false;
}

/** The key the stash is currently written under (for `clearLocalData`). */
export function recoveryStorageKey(): string {
  return recoveryKey;
}

/** Parse, validate and age-filter whatever is stashed now. Never throws. */
function readStash(): RecoveryEntry[] {
  const raw = safeStorage.get(recoveryKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter(
      (e): e is RecoveryEntry =>
        !!e && typeof e.docId === "string" && !!e.canonical &&
        typeof e.at === "number" && now - e.at < MAX_AGE_MS
    );
  } catch {
    return [];
  }
}

/**
 * Write the given unsaved documents synchronously. Returns how many of THESE
 * entries were stored. Never throws — a stash that fails must not break the
 * unload path.
 *
 * Read-merge-write, never a whole-value overwrite. Every tab of the origin
 * shares this ONE key, so closing a window with two dirty tabs ran two unload
 * handlers back to back and the second erased the first tab's stash. Entries
 * are merged per document, the newest winning.
 */
export function stashUnsaved(entries: RecoveryEntry[]): number {
  if (!recoveryEnabled || !safeStorage.available() || !entries.length) return 0;
  const byDoc = new Map<string, RecoveryEntry>();
  for (const entry of [...readStash(), ...entries]) {
    const prev = byDoc.get(entry.docId);
    if (!prev || entry.at >= prev.at) byDoc.set(entry.docId, entry);
  }
  // Newest first, so if the budget runs out it is the oldest that is dropped.
  const sorted = [...byDoc.values()].sort((a, b) => b.at - a.at);
  const kept: RecoveryEntry[] = [];
  let bytes = 0;
  for (const entry of sorted) {
    let size = 0;
    try {
      size = JSON.stringify(entry).length;
    } catch {
      continue; // not serialisable — skip this one, keep the rest
    }
    if (bytes + size > MAX_STASH_BYTES) continue;
    bytes += size;
    kept.push(entry);
  }
  if (!kept.length) return 0;
  try {
    // Not through safeStorage.set: a refused write must be REPORTED here, so
    // the caller knows nothing was stashed.
    localStorage.setItem(recoveryKey, JSON.stringify(kept));
    return entries.filter((e) => kept.includes(e)).length;
  } catch {
    // Quota, private mode, or a disabled store. Nothing more to try — the
    // beforeunload warning still tells the user their work is unsaved.
    return 0;
  }
}

/**
 * Read the stash and remove it, in one step. One-shot on purpose (the same
 * discipline as history-cache's `takeForRestore`): a stash that survived its
 * own restore would keep resurrecting itself over newer content.
 */
export function takeStashed(): RecoveryEntry[] {
  if (!recoveryEnabled) return [];
  const entries = readStash();
  safeStorage.remove(recoveryKey);
  return entries;
}

export function clearStash(): void {
  safeStorage.remove(recoveryKey);
}
