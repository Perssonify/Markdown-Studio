/**
 * IndexedDB Storage Adapter
 *
 * Implements the StorageAdapter interface using the browser's IndexedDB API.
 * Provides configurable max storage quota and live storage metrics.
 *
 * Database layout:
 *   DB: <dbName> (default: "perssonify-docs")
 *   Object stores:
 *     "documents" — keyed by doc id, value: serialized DocumentRecord string
 *     "meta"      — keyed by string, stores manifest and prefs
 */

import {
  deserializeFromStorage,
  serializeForStorage,
  toSummary,
  type DocumentRecord,
  type DocumentSummary, stampUpdated } from "./document";
import type { StorageAdapter } from "./storage-adapter";

// ─── Public types ────────────────────────────────────────────────────────────

export interface StorageMetrics {
  /** Bytes currently consumed by all stored documents */
  usedBytes: number;
  /** Configured upper limit in bytes */
  maxBytes: number;
  /** Usage as a percentage 0–100 */
  pct: number;
  /** Number of documents stored */
  docCount: number;
  /** Bytes remaining before the limit is hit */
  available: number;
}

export interface IDBStorageConfig {
  /** IndexedDB database name. Defaults to "perssonify-docs". */
  dbName?: string;
  /** Maximum bytes allowed for document storage. Defaults to 50 MB. */
  maxBytes?: number;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class StorageQuotaError extends Error {
  readonly usedBytes: number;
  readonly maxBytes: number;
  readonly requiredBytes: number;

  constructor(used: number, max: number, required: number) {
    super(
      `Storage quota exceeded: ${formatBytes(used)} used of ${formatBytes(max)} limit. ` +
      `Requires ${formatBytes(required)} more.`
    );
    this.name = "StorageQuotaError";
    this.usedBytes = used;
    this.maxBytes = max;
    this.requiredBytes = required;
  }
}

/**
 * A stored document could not be READ — as opposed to not existing.
 *
 * Every adapter used to catch its read errors and return null, so a failed
 * read was indistinguishable from "no such document": the blank-over-content
 * backstop, the multi-tab check and the pre-overwrite snapshot all took the
 * "nothing stored" branch and let the write through, which made their "fail
 * closed" promise unreachable. `get()` now returns null ONLY for a genuine
 * miss and throws this for everything else. `corrupt` marks a record that is
 * present but cannot be parsed (as opposed to a storage that failed to answer).
 */
export class StorageReadError extends Error {
  readonly corrupt: boolean;
  constructor(message: string, opts: { cause?: unknown; corrupt?: boolean } = {}) {
    super(message);
    this.name = "StorageReadError";
    this.corrupt = !!opts.corrupt;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

/** Parse a stored record that IS present; a value that will not parse is
 *  corrupt, never "missing". */
export function parseStoredDocument(id: string, raw: string): DocumentRecord {
  const doc = deserializeFromStorage(raw);
  if (!doc) throw new StorageReadError(`Stored document ${id} could not be parsed`, { corrupt: true });
  return doc;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DB_NAME = "perssonify-docs";
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const DB_VERSION = 1;
const STORE_DOCS = "documents";
const STORE_META = "meta";
const MANIFEST_KEY = "__manifest";
const PREFS_KEY = "__prefs";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function byteSize(str: string): number {
  // UTF-16 code units × 2 gives a conservative estimate without TextEncoder overhead
  return str.length * 2;
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Run a sequence of IDB requests inside a single transaction.
 *
 * IMPORTANT: IndexedDB transactions auto-commit when the event loop is idle
 * with no pending requests. This means you CANNOT await arbitrary Promises
 * between IDB requests — only awaiting idbRequest() (which resolves in the
 * same microtask as the IDB success event) is safe.
 *
 * fn receives the transaction and must only await idbRequest() calls.
 * The outer Promise resolves with fn's return value once the transaction
 * commits, or rejects if the transaction aborts/errors.
 */
function idbTransaction<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let fnResult: T;
    let fnError: unknown;
    let fnDone = false;
    let complete = false;

    // Resolve only once BOTH the work function has settled and the transaction
    // has committed, using the real fnResult — never a possibly-unset value.
    const settle = () => {
      if (!fnDone || !complete) return;
      if (fnError !== undefined) reject(fnError);
      else resolve(fnResult);
    };

    fn(tx).then(
      (r) => { fnResult = r; fnDone = true; settle(); },
      (e) => { fnError = e; fnDone = true; tx.abort(); }
    );

    tx.oncomplete = () => { complete = true; settle(); };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(fnError ?? tx.error ?? new Error("IDB transaction aborted"));
  });
}

interface StorageManifest {
  documents: DocumentSummary[];
}

// ─── IndexedDBStorageAdapter ──────────────────────────────────────────────────

export class IndexedDBStorageAdapter implements StorageAdapter {
  private readonly _dbName: string;
  private readonly _maxBytes: number;
  private _db: IDBDatabase | null = null;
  private _readyPromise: Promise<void>;
  private _metrics: StorageMetrics;

  constructor(config?: IDBStorageConfig) {
    this._dbName = config?.dbName ?? DEFAULT_DB_NAME;
    this._maxBytes = config?.maxBytes ?? DEFAULT_MAX_BYTES;
    this._metrics = {
      usedBytes: 0,
      maxBytes: this._maxBytes,
      pct: 0,
      docCount: 0,
      available: this._maxBytes,
    };
    this._readyPromise = this._open();
    // A rejected open with no consumer YET is an unhandled rejection, which
    // surfaces as a top-level page error — and in a browser with storage
    // disabled (Safari private mode, blocked site data) `indexedDB.open` throws
    // synchronously, so that is exactly what happened: the app degraded
    // correctly and still reported an uncaught SecurityError. Marking it handled
    // here does not swallow anything — `isReady()` returns the original promise
    // and still rejects for whoever awaits it.
    this._readyPromise.catch(() => {});
  }

  // ── IndexedDB open 

  private _open(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available in this environment"));
        return;
      }
      const req = indexedDB.open(this._dbName, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_DOCS)) {
          db.createObjectStore(STORE_DOCS); // keyed by doc id
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META); // keyed by string
        }
      };
      req.onsuccess = (event) => {
        this._db = (event.target as IDBOpenDBRequest).result;
        // Recompute metrics after open so first getMetrics() call is accurate
        this._recomputeMetrics().then(resolve).catch(resolve);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /** Resolves once the database is open and metrics have been computed. */
  isReady(): Promise<void> {
    return this._readyPromise;
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private _db_(): IDBDatabase {
    if (!this._db) throw new Error("IndexedDB not yet open — await isReady() first");
    return this._db;
  }

  private async _getManifest(tx?: IDBTransaction): Promise<StorageManifest> {
    try {
      const store = tx
        ? tx.objectStore(STORE_META)
        : this._db_().transaction(STORE_META, "readonly").objectStore(STORE_META);
      // idbRequest resolves in the onsuccess microtask — safe to await inside a tx
      const raw = await idbRequest<string | undefined>(store.get(MANIFEST_KEY));
      if (raw) return JSON.parse(raw) as StorageManifest;
    } catch {
      /* return empty manifest on any error */
    }
    return { documents: [] };
  }

  private async _setManifest(manifest: StorageManifest, tx: IDBTransaction): Promise<void> {
    const store = tx.objectStore(STORE_META);
    await idbRequest(store.put(JSON.stringify(manifest), MANIFEST_KEY));
  }

  /**
   * Walk all document keys and sum their byte sizes to build accurate metrics.
   * Called once on open and after every mutating operation.
   */
  private async _recomputeMetrics(): Promise<void> {
    try {
      const db = this._db_();
      const tx = db.transaction(STORE_DOCS, "readonly");
      const store = tx.objectStore(STORE_DOCS);

      // Collect all values via cursor
      let usedBytes = 0;
      let docCount = 0;
      await new Promise<void>((resolve, reject) => {
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result as IDBCursorWithValue | null;
          if (cursor) {
            const val: unknown = cursor.value;
            if (typeof val === "string") {
              usedBytes += byteSize(val);
              docCount++;
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => reject(req.error);
      });

      this._metrics = {
        usedBytes,
        maxBytes: this._maxBytes,
        pct: Math.min(100, Math.round((usedBytes / this._maxBytes) * 100)),
        docCount,
        available: Math.max(0, this._maxBytes - usedBytes),
      };
    } catch {
      /* best effort — keep last known metrics */
    }
  }

  // ── StorageAdapter interface ────────────────────────────────────────────────

  async list(): Promise<DocumentSummary[]> {
    await this._readyPromise;
    const manifest = await this._getManifest();
    return manifest.documents.sort(
      (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
    );
  }

  /** The document, or null when no document has this id. A read that FAILS
   *  throws StorageReadError instead of pretending the document is absent. */
  async get(id: string): Promise<DocumentRecord | null> {
    await this._readyPromise;
    let raw: string | undefined;
    try {
      const tx = this._db_().transaction(STORE_DOCS, "readonly");
      raw = await idbRequest<string | undefined>(tx.objectStore(STORE_DOCS).get(id));
    } catch (e) {
      console.warn(`[IDBStorage] Failed to get doc ${id}:`, e);
      throw new StorageReadError(`Could not read document ${id}`, { cause: e });
    }
    if (raw === undefined || raw === null) return null;
    return parseStoredDocument(id, raw);
  }

  async save(doc: DocumentRecord): Promise<void> {
    await this._readyPromise;
    stampUpdated(doc);
    const serialized = serializeForStorage(doc);
    const newDocBytes = byteSize(serialized);
    let usedAfter = -1;
    let countAfter = 0;

    await idbTransaction(
      this._db_(),
      [STORE_DOCS, STORE_META],
      "readwrite",
      async (tx) => {
        // Quota check INSIDE the write transaction, computing the true current
        // usage from the store (not cached metrics that concurrent saves could
        // read stale). This serializes the check+write and closes the race.
        const store = tx.objectStore(STORE_DOCS);
        // The cursor also counts documents, so the post-commit metrics can be
        // derived arithmetically instead of walking the whole store a SECOND
        // time (see below).
        const { total, existing, count } = await new Promise<{ total: number; existing: number; count: number }>(
          (resolve, reject) => {
            let total = 0;
            let existing = 0;
            let count = 0;
            const req = store.openCursor();
            req.onsuccess = () => {
              const cursor = req.result;
              if (cursor) {
                const bytes = byteSize(cursor.value as string);
                total += bytes;
                count++;
                if (cursor.key === doc.id) existing = bytes;
                cursor.continue();
              } else {
                resolve({ total, existing, count });
              }
            };
            req.onerror = () => reject(req.error);
          }
        );
        const projectedUsed = total - existing + newDocBytes;
        if (projectedUsed > this._maxBytes) {
          throw new StorageQuotaError(total, this._maxBytes, projectedUsed - this._maxBytes);
        }

        await idbRequest(store.put(serialized, doc.id));

        const manifest = await this._getManifest(tx);
        const summary = toSummary(doc);
        const idx = manifest.documents.findIndex((d) => d.id === doc.id);
        if (idx >= 0) {
          manifest.documents[idx] = summary;
        } else {
          manifest.documents.push(summary);
        }
        await this._setManifest(manifest, tx);
        // Metrics from the numbers this transaction ALREADY has. Every autosave
        // used to walk the entire document store twice — once here for the quota
        // check, then again in _recomputeMetrics() — so the cost of saving one
        // note was proportional to the whole library, on a 5-second timer, while
        // the user typed. The quota cursor is unavoidable (it must be inside the
        // write transaction to close the check/write race); the second pass was
        // pure duplication.
        usedAfter = total - existing + newDocBytes;
        countAfter = existing > 0 ? count : count + 1;
      }
    );

    if (usedAfter >= 0) {
      this._metrics = {
        usedBytes: usedAfter,
        maxBytes: this._maxBytes,
        pct: Math.min(100, Math.round((usedAfter / this._maxBytes) * 100)),
        docCount: countAfter,
        available: Math.max(0, this._maxBytes - usedAfter),
      };
    } else {
      // Transaction did not reach the accounting step — fall back to a full walk.
      await this._recomputeMetrics();
    }
  }

  async delete(id: string): Promise<void> {
    await this._readyPromise;
    await idbTransaction(
      this._db_(),
      [STORE_DOCS, STORE_META],
      "readwrite",
      async (tx) => {
        await idbRequest(tx.objectStore(STORE_DOCS).delete(id));

        const manifest = await this._getManifest(tx);
        manifest.documents = manifest.documents.filter((d) => d.id !== id);
        await this._setManifest(manifest, tx);
      }
    );

    await this._recomputeMetrics();
  }

  async search(query: string): Promise<DocumentSummary[]> {
    await this._readyPromise;
    const manifest = await this._getManifest();
    const q = query.toLowerCase();
    return manifest.documents.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        (d.tags ?? []).some((t) => t.toLowerCase().includes(q))
    );
  }

  async getPrefs(): Promise<Record<string, unknown>> {
    await this._readyPromise;
    try {
      const tx = this._db_().transaction(STORE_META, "readonly");
      const raw = await idbRequest<string | undefined>(tx.objectStore(STORE_META).get(PREFS_KEY));
      if (raw) return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
    return {};
  }

  async setPrefs(prefs: Record<string, unknown>): Promise<void> {
    await this._readyPromise;
    try {
      // Merge with existing prefs so callers can update a single key without
      // wiping the rest (e.g. { lastActiveDocId } should not erase syncMode).
      await idbTransaction(this._db_(), [STORE_META], "readwrite", async (tx) => {
        const store = tx.objectStore(STORE_META);
        const existing = await idbRequest<string | undefined>(store.get(PREFS_KEY));
        const merged = { ...(existing ? JSON.parse(existing) : {}), ...prefs };
        return idbRequest(store.put(JSON.stringify(merged), PREFS_KEY));
      });
    } catch (e) {
      console.warn("[IDBStorage] Failed to save prefs:", e);
    }
  }

  // ── Metrics API ─────────────────────────────────────────────────────────────

  /**
   * Returns the current storage metrics synchronously from the cached value.
   * The cache is updated after every save() and delete() call.
   */
  getMetrics(): StorageMetrics {
    return { ...this._metrics };
  }
}
