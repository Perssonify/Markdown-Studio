/**
 * Storage adapter: pluggable persistence layer for documents.
 *
 * `createStorageAdapter()` picks the best available backend, in priority order:
 *   1. IndexedDBStorageAdapter — the default in standard browsers (configurable
 *      quota + live storage metrics). All persistence is browser-local; there is
 *      no backend or network.
 *   2. WindowStorageAdapter — a `window.storage` shim, when a host injects one.
 *   3. LocalStorageAdapter — `localStorage` fallback (key-per-doc: "doc:{id}",
 *      with a "doc:__manifest" listing key).
 *   4. MemoryStorageAdapter — in-memory only (SSR / tests / storage disabled).
 * A host may inject its own adapter via the editor's storage props instead.
 */

import {
  serializeForStorage,
  stampUpdated,
  toSummary,
  type DocumentRecord,
  type DocumentSummary,
} from "../documents/document";
import { safeStorage } from "@/utils/safe-storage";
import {
  IndexedDBStorageAdapter,
  StorageQuotaError,
  StorageReadError,
  parseStoredDocument,
  sameIdSet,
  type IDBStorageConfig,
  type StorageMetrics,
} from "./idb-storage-adapter";
import { diag } from "@/utils/diag";

// Re-export IDB types so callers only need to import from this module
export { IndexedDBStorageAdapter, StorageQuotaError, StorageReadError };

export type { IDBStorageConfig, StorageMetrics };

const PREFIX = "doc:";
const MANIFEST_KEY = "doc:__manifest";
const PREFS_KEY = "doc:__prefs";

// --- Types ---

interface StorageManifest {
  documents: DocumentSummary[];
}

interface StorageResult {
  value?: string;
}

interface WindowStorageAPI {
  get(key: string): Promise<StorageResult>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

declare global {
  interface Window {
    storage?: WindowStorageAPI;
  }
}

/**
 * Persistence contract for documents.
 *
 * `get` MUST resolve null only when no document has that id, and REJECT
 * (ideally with StorageReadError) when the read itself fails or the stored
 * value cannot be parsed. The save path's data-loss guards — the blank-over-
 * content backstop, the multi-tab conflict check, the pre-overwrite snapshot —
 * fail CLOSED on a rejected read; a read error reported as null walks straight
 * past all three.
 */
export interface StorageAdapter {
  list(): Promise<DocumentSummary[]>;
  get(id: string): Promise<DocumentRecord | null>;
  save(doc: DocumentRecord): Promise<void>;
  delete(id: string): Promise<void>;
  search(query: string): Promise<DocumentSummary[]>;
  getPrefs(): Promise<Record<string, unknown>>;
  setPrefs(prefs: Record<string, unknown>): Promise<void>;
  /** Erase EVERYTHING this adapter stores — documents, the list, and the
   *  editor's prefs (which hold folder names). Used by clearLocalData(); an
   *  adapter without it has its documents deleted one by one instead. */
  clear?(): Promise<void>;
  /**
   * The stored document's revision — its `updated`, exactly as `get` would
   * return it — or null when no document has that id; rejects exactly where
   * `get` rejects. Optional: a save that finds the revision it last wrote or
   * read uses what it already holds instead of parsing the whole record again
   * (A083 — a 4 MB note's autosave spent ~1.6 s at 4x CPU re-reading itself).
   * Without it every save reads the record with `get`.
   */
  getRevision?(id: string): Promise<string | null>;
}

/**
 * WindowStorageAdapter — uses window.storage.get/set/delete/list.
 */
export class WindowStorageAdapter implements StorageAdapter {
  /**
   * Get the document manifest (list of IDs + basic metadata).
   *
   * `window.storage` cannot enumerate its keys, so an UNREADABLE manifest
   * cannot be rebuilt here the way the IndexedDB and localStorage adapters
   * rebuild theirs. What it must not do is quietly start a fresh one-document
   * list over it — every other document would vanish from the library while
   * still stored. The unreadable value is set aside (once) under
   * `doc:__manifest.unreadable` so it can be recovered, before anything
   * writes a new list.
   */
  async _getManifest(): Promise<StorageManifest> {
    let value: string | undefined;
    try {
      value = (await window.storage!.get(MANIFEST_KEY))?.value;
    } catch {
      return { documents: [] }; // the API rejects for a key it does not have
    }
    if (!value) return { documents: [] };
    try {
      const parsed = JSON.parse(value) as StorageManifest;
      if (parsed && Array.isArray(parsed.documents)) return parsed;
    } catch { /* unreadable — below */ }
    console.error("[Storage] The document list is unreadable; keeping a copy under doc:__manifest.unreadable");
    try {
      const kept = await window.storage!.get(MANIFEST_KEY + ".unreadable").catch(() => undefined);
      if (!kept?.value) await window.storage!.set(MANIFEST_KEY + ".unreadable", value);
    } catch { /* best effort */ }
    return { documents: [] };
  }

  async _setManifest(manifest: StorageManifest): Promise<void> {
    await window.storage!.set(MANIFEST_KEY, JSON.stringify(manifest));
  }

  /**
   * List all documents (summaries only — doesn't load full content).
   */
  async list(): Promise<DocumentSummary[]> {
    const manifest = await this._getManifest();
    return manifest.documents.sort(
      (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
    );
  }

  /**
   * Get a full document by ID.
   *
   * `window.storage` REJECTS for a key it does not have (see `delete` below),
   * so a rejection here has to keep meaning "absent" — the API offers no way
   * to tell that from a failure. A value that IS present but will not parse is
   * a read error, never a miss (see StorageReadError).
   */
  async get(id: string): Promise<DocumentRecord | null> {
    let value: string | undefined;
    try {
      value = (await window.storage!.get(PREFIX + id))?.value;
    } catch (e) {
      console.warn(`[Storage] Failed to get doc ${id}:`, e);
      return null;
    }
    if (value === undefined || value === null) return null;
    return parseStoredDocument(id, value);
  }

  /**
   * Save a document (creates or updates).
   */
  async save(doc: DocumentRecord): Promise<void> {
    stampUpdated(doc);
    const serialized = serializeForStorage(doc);
    await window.storage!.set(PREFIX + doc.id, serialized);

    // Update manifest
    const manifest = await this._getManifest();
    const summary = toSummary(doc);
    const idx = manifest.documents.findIndex((d) => d.id === doc.id);
    if (idx >= 0) {
      manifest.documents[idx] = summary;
    } else {
      manifest.documents.push(summary);
    }
    await this._setManifest(manifest);
  }

  /**
   * Delete a document by ID.
   */
  async delete(id: string): Promise<void> {
    try {
      await window.storage!.delete(PREFIX + id);
    } catch {
      // Ignore if key doesn't exist
    }
    const manifest = await this._getManifest();
    manifest.documents = manifest.documents.filter((d) => d.id !== id);
    await this._setManifest(manifest);
  }

  /**
   * Search documents by title/tags (client-side, searches manifest).
   */
  async search(query: string): Promise<DocumentSummary[]> {
    const manifest = await this._getManifest();
    const q = query.toLowerCase();
    return manifest.documents.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        (d.tags ?? []).some((t) => t.toLowerCase().includes(q))
    );
  }

  /**
   * Get/set editor preferences (sync mode, last open doc, etc).
   */
  async getPrefs(): Promise<Record<string, unknown>> {
    try {
      const result = await window.storage!.get(PREFS_KEY);
      if (result?.value) return JSON.parse(result.value) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    return {};
  }

  async setPrefs(prefs: Record<string, unknown>): Promise<void> {
    try {
      // Merge with existing prefs so callers can update a single key without
      // wiping the rest (e.g. { lastActiveDocId } should not erase syncMode).
      const existing = await this.getPrefs();
      await window.storage!.set(
        PREFS_KEY,
        JSON.stringify({ ...existing, ...prefs })
      );
    } catch (e) {
      console.warn("[Storage] Failed to save prefs:", e);
    }
  }

  /** window.storage cannot enumerate keys: delete what the list names. */
  async clear(): Promise<void> {
    const manifest = await this._getManifest();
    for (const d of manifest.documents) {
      try { await window.storage!.delete(PREFIX + d.id); } catch { /* absent */ }
    }
    for (const key of [MANIFEST_KEY, MANIFEST_KEY + ".unreadable", PREFS_KEY]) {
      try { await window.storage!.delete(key); } catch { /* absent */ }
    }
  }
}

/**
 * LocalStorageAdapter — uses browser localStorage with JSON serialization.
 * Works in standard browsers and with the preview harness localStorage polyfill.
 * Documents persist across page reloads (in real browsers).
 */
export class LocalStorageAdapter implements StorageAdapter {
  _key(id: string): string {
    return PREFIX + id;
  }

  /** The ids of every document actually stored (its own keys, not the list). */
  _storedIds(): string[] {
    const ids: string[] = [];
    for (let k = 0; k < localStorage.length; k++) {
      const key = localStorage.key(k);
      if (key && key.startsWith(PREFIX) && key !== MANIFEST_KEY && key !== PREFS_KEY) {
        ids.push(key.slice(PREFIX.length));
      }
    }
    return ids;
  }

  /**
   * The document list — rebuilt from the stored documents themselves when it
   * is missing, unreadable, or does not list exactly the ids that are stored.
   * An unreadable list used to read as EMPTY, and the next save wrote a list
   * of one: every other document vanished from the library while still stored.
   */
  async _getManifest(): Promise<StorageManifest> {
    let manifest: StorageManifest | null = null;
    const raw = localStorage.getItem(MANIFEST_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as StorageManifest;
        if (parsed && Array.isArray(parsed.documents)) manifest = parsed;
      } catch { /* unreadable — rebuilt below */ }
    }
    const ids = this._storedIds();
    if (manifest && sameIdSet(manifest.documents, ids)) return manifest;
    if (!manifest && ids.length === 0) return { documents: [] };
    const documents: DocumentSummary[] = [];
    for (const id of ids) {
      try {
        const doc = await this.get(id);
        if (doc) documents.push(toSummary(doc));
      } catch { /* unreadable document: cannot be summarised */ }
    }
    const rebuilt = { documents };
    try { await this._setManifest(rebuilt); } catch { /* the next write retries */ }
    return rebuilt;
  }

  async _setManifest(manifest: StorageManifest): Promise<void> {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
  }

  async list(): Promise<DocumentSummary[]> {
    const manifest = await this._getManifest();
    return manifest.documents.slice().sort(
      (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
    );
  }

  /** null only when the key is absent; a storage that throws, or a value that
   *  will not parse, is a read error (see StorageReadError). */
  async get(id: string): Promise<DocumentRecord | null> {
    let raw: string | null;
    try {
      raw = localStorage.getItem(this._key(id));
    } catch (e) {
      console.warn(`[Storage] Failed to get doc ${id}:`, e);
      throw new StorageReadError(`Could not read document ${id}`, { cause: e });
    }
    if (raw === null) return null;
    return parseStoredDocument(id, raw);
  }

  async save(doc: DocumentRecord): Promise<void> {
    stampUpdated(doc);
    const serialized = serializeForStorage(doc);
    // Read (and if need be rebuild) the list BEFORE the write, while it still
    // agrees with the stored keys — afterwards a new document would make every
    // save of one look like an out-of-step list and trigger a full rebuild.
    const manifest = await this._getManifest();

    try {
      localStorage.setItem(this._key(doc.id), serialized);
    } catch (e) {
      const err = e as Error & { name?: string };
      if (err.name === "QuotaExceededError") {
        // NEVER destroy user data to make room (the old behavior silently
        // deleted the oldest document). Surface the quota problem instead so
        // the UI can tell the user to export/delete something themselves.
        // Byte figures are estimates (UTF-16 ≈ 2 bytes/char; ~5MB typical cap).
        let usedChars = 0;
        try {
          for (let k = 0; k < localStorage.length; k++) {
            const key = localStorage.key(k);
            if (key) usedChars += key.length + (localStorage.getItem(key)?.length ?? 0);
          }
        } catch { /* best effort */ }
        throw new StorageQuotaError(usedChars * 2, 5 * 1024 * 1024, serialized.length * 2);
      }
      throw e;
    }

    // Update manifest
    const summary = toSummary(doc);
    const idx = manifest.documents.findIndex((d) => d.id === doc.id);
    if (idx >= 0) {
      manifest.documents[idx] = summary;
    } else {
      manifest.documents.push(summary);
    }
    await this._setManifest(manifest);
  }

  async delete(id: string): Promise<void> {
    const manifest = await this._getManifest(); // before the key goes — see save
    try {
      localStorage.removeItem(this._key(id));
    } catch {
      /* ignore */
    }
    manifest.documents = manifest.documents.filter((d) => d.id !== id);
    await this._setManifest(manifest);
  }

  async search(query: string): Promise<DocumentSummary[]> {
    const manifest = await this._getManifest();
    const q = query.toLowerCase();
    return manifest.documents.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        (d.tags ?? []).some((t) => t.toLowerCase().includes(q))
    );
  }

  async getPrefs(): Promise<Record<string, unknown>> {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    return {};
  }

  async setPrefs(prefs: Record<string, unknown>): Promise<void> {
    try {
      // Merge with existing prefs so callers can update a single key without
      // wiping the rest (e.g. { lastActiveDocId } should not erase syncMode).
      const existing = await this.getPrefs();
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ ...existing, ...prefs })
      );
    } catch (e) {
      console.warn("[Storage] Failed to save prefs:", e);
    }
  }

  /** Every key this adapter owns — documents, the list, the prefs. */
  async clear(): Promise<void> {
    const mine: string[] = [];
    for (let k = 0; k < localStorage.length; k++) {
      const key = localStorage.key(k);
      if (key && key.startsWith(PREFIX)) mine.push(key);
    }
    for (const key of mine) localStorage.removeItem(key);
  }

  /** Evict the oldest document when storage is full */
  _getManifestSync(): StorageManifest {
    try {
      const raw = localStorage.getItem(MANIFEST_KEY);
      if (raw) return JSON.parse(raw) as StorageManifest;
    } catch {
      /* ignore */
    }
    return { documents: [] };
  }
}

/**
 * In-memory adapter for testing / environments without persistent storage.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private _docs = new Map<string, DocumentRecord>();

  async list(): Promise<DocumentSummary[]> {
    return [...this._docs.values()]
      .map(toSummary)
      .sort(
        (a, b) =>
          new Date(b.updated).getTime() - new Date(a.updated).getTime()
      );
  }

  async get(id: string): Promise<DocumentRecord | null> {
    const doc = this._docs.get(id);
    return doc ? { ...doc } : null;
  }

  async save(doc: DocumentRecord): Promise<void> {
    stampUpdated(doc);
    this._docs.set(doc.id, { ...doc });
  }

  async delete(id: string): Promise<void> {
    this._docs.delete(id);
  }

  async search(query: string): Promise<DocumentSummary[]> {
    const q = query.toLowerCase();
    return (await this.list()).filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        (d.tags ?? []).some((t) => t.toLowerCase().includes(q))
    );
  }

  async getPrefs(): Promise<Record<string, unknown>> {
    return {};
  }

  async setPrefs(): Promise<void> {}

  async clear(): Promise<void> {
    this._docs.clear();
  }
}

/**
 * Create the appropriate storage adapter for the environment.
 *
 * Priority: IndexedDB → window.storage  → localStorage → in-memory
 *
 * Pass an IDBStorageConfig to configure the IndexedDB adapter (dbName, maxBytes).
 * The editor itself never calls this directly — adapters should be injected via props.
 */
export function createStorageAdapter(
  config?: IDBStorageConfig
):
  | IndexedDBStorageAdapter
  | WindowStorageAdapter
  | LocalStorageAdapter
  | MemoryStorageAdapter {
  diag("STORAGE", "creating adapter...", {
    hasIndexedDB: typeof indexedDB !== "undefined",
    hasWindowStorage: !!(typeof window !== "undefined" && window.storage),
    // Through safeStorage: `typeof localStorage` EVALUATES the getter, which
    // throws where a browser blocks site data — and this expression sits in an
    // object literal with no try, so adapter creation itself threw and the app
    // never rendered.
    hasLocalStorage: !!(typeof window !== "undefined" && safeStorage.available()),
  });

  // Prefer IndexedDB in standard browser environments
  if (typeof indexedDB !== "undefined") {
    diag("STORAGE", "using IndexedDBStorageAdapter");
    return new IndexedDBStorageAdapter(config);
  }

  if (typeof window !== "undefined" && window.storage) {
    diag("STORAGE", "using WindowStorageAdapter");
    return new WindowStorageAdapter();
  }

  if (typeof window !== "undefined" && safeStorage.available()) {
    try {
      // Test that localStorage actually works (might throw in some contexts)
      localStorage.setItem("__test", "1");
      localStorage.removeItem("__test");
      diag("STORAGE", "using LocalStorageAdapter");
      return new LocalStorageAdapter();
    } catch (e) {
      const err = e as Error;
      diag("STORAGE", "localStorage test FAILED", err.message);
    }
  }

  console.warn(
    "[Storage] No persistent storage available — using in-memory adapter"
  );
  diag("STORAGE", "using MemoryStorageAdapter");
  return new MemoryStorageAdapter();
}

/**
 * Type guard — returns true when the adapter supports live storage metrics.
 * Use this before calling adapter.getMetrics().
 */
export function hasMetrics(
  adapter: StorageAdapter
): adapter is IndexedDBStorageAdapter {
  return adapter instanceof IndexedDBStorageAdapter;
}
