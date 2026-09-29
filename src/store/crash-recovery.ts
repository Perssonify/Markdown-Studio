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
}

/**
 * Write the given unsaved documents synchronously. Returns how many were
 * stored. Never throws — a stash that fails must not break the unload path.
 */
export function stashUnsaved(entries: RecoveryEntry[]): number {
  if (!safeStorage.available() || !entries.length) return 0;
  // Newest first, so if the budget runs out it is the oldest that is dropped.
  const sorted = [...entries].sort((a, b) => b.at - a.at);
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
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(kept));
    return kept.length;
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
  const raw = safeStorage.get(RECOVERY_KEY);
  safeStorage.remove(RECOVERY_KEY);
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

export function clearStash(): void {
  safeStorage.remove(RECOVERY_KEY);
}
