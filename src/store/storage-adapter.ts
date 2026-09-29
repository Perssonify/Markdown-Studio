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
  deserializeFromStorage,
  serializeForStorage,
  stampUpdated,
  toSummary,
  type DocumentRecord,
  type DocumentSummary,
} from "./document";
import { safeStorage } from "../utils/safe-storage";
import {
  IndexedDBStorageAdapter,
  StorageQuotaError,
  type IDBStorageConfig,
  type StorageMetrics,
} from "./idb-storage-adapter";
import { diag } from "../utils/diag";

// Re-export IDB types so callers only need to import from this module
export { IndexedDBStorageAdapter, StorageQuotaError };

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

export interface StorageAdapter {
  list(): Promise<DocumentSummary[]>;
  get(id: string): Promise<DocumentRecord | null>;
  save(doc: DocumentRecord): Promise<void>;
  delete(id: string): Promise<void>;
  search(query: string): Promise<DocumentSummary[]>;
  getPrefs(): Promise<Record<string, unknown>>;
  setPrefs(prefs: Record<string, unknown>): Promise<void>;
}

/**
 * WindowStorageAdapter — uses window.storage.get/set/delete/list.
 */
export class WindowStorageAdapter implements StorageAdapter {
  /**
   * Get the document manifest (list of IDs + basic metadata).
   */
  async _getManifest(): Promise<StorageManifest> {
    try {
      const result = await window.storage!.get(MANIFEST_KEY);
      if (result?.value) {
        return JSON.parse(result.value) as StorageManifest;
      }
    } catch {
      // Key doesn't exist or parse error — return empty
    }
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
   */
  async get(id: string): Promise<DocumentRecord | null> {
    try {
      const result = await window.storage!.get(PREFIX + id);
      if (result?.value) {
        return deserializeFromStorage(result.value);
      }
    } catch (e) {
      console.warn(`[Storage] Failed to get doc ${id}:`, e);
    }
    return null;
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

  async _getManifest(): Promise<StorageManifest> {
    try {
      const raw = localStorage.getItem(MANIFEST_KEY);
      if (raw) return JSON.parse(raw) as StorageManifest;
    } catch {
      /* parse error or access denied */
    }
    return { documents: [] };
  }

  async _setManifest(manifest: StorageManifest): Promise<void> {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
  }

  async list(): Promise<DocumentSummary[]> {
    const manifest = await this._getManifest();
    return manifest.documents.sort(
      (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
    );
  }

  async get(id: string): Promise<DocumentRecord | null> {
    try {
      const raw = localStorage.getItem(this._key(id));
      if (raw) return deserializeFromStorage(raw);
    } catch (e) {
      console.warn(`[Storage] Failed to get doc ${id}:`, e);
    }
    return null;
  }

  async save(doc: DocumentRecord): Promise<void> {
    stampUpdated(doc);
    const serialized = serializeForStorage(doc);

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

  async delete(id: string): Promise<void> {
    try {
      localStorage.removeItem(this._key(id));
    } catch {
      /* ignore */
    }
    const manifest = await this._getManifest();
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
