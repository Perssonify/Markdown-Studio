/**
 * IndexedDB Storage Adapter
 *
 * Implements the StorageAdapter interface using the browser's IndexedDB API.
 * Provides live storage metrics and, optionally, a host-configured hard cap.
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

/**
 * Storage usage, measured in real bytes.
 *
 * With a host-configured `maxBytes`, the numbers are the documents' own
 * (UTF-8) bytes against that cap. Without one — the default — the limit is the
 * BROWSER's quota for this site, so the numbers come from
 * `navigator.storage.estimate()`: the whole origin's usage (documents,
 * version history, caches) against its quota. `limitKnown: false` means the
 * browser offers no estimate; `maxBytes` is then 0 and `pct` 0.
 */
export interface StorageMetrics {
  /** Bytes in use (see above for which bytes). */
  usedBytes: number;
  /** The limit in bytes, or 0 when unknown. */
  maxBytes: number;
  /** Usage as a percentage 0–100 */
  pct: number;
  /** Number of documents stored */
  docCount: number;
  /** Bytes remaining before the limit is hit (0 when the limit is unknown). */
  available: number;
  /** Whether `maxBytes` is a real limit rather than unknown. */
  limitKnown?: boolean;
}

export interface IDBStorageConfig {
  /** IndexedDB database name. Defaults to "perssonify-docs". */
  dbName?: string;
  /**
   * Namespace for the editor's OTHER browser stores — the version-history
   * database and the crash-recovery stash — which otherwise belong to the
   * whole ORIGIN whatever storage a host uses. On a shared device that put
   * user A's content in user B's Version history. Defaults to `dbName` when a
   * host sets one; the standalone app's names are unchanged
   * ("perssonify-snapshots", "pf:recovery").
   */
  namespace?: string;
  /** Keep version history (the snapshot database). Default true. */
  snapshots?: boolean;
  /** Keep the crash-recovery stash (localStorage, written on unload). Default true. */
  crashRecovery?: boolean;
  /**
   * An optional HARD cap on document bytes, for a host that wants one. Unset
   * (the default), the browser's own quota is the limit. There used to be a
   * self-imposed 50 MB default measured as characters × 2, which stopped a
   * library at ~18 MB of real markdown while the browser had gigabytes free.
   */
  maxBytes?: number;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class StorageQuotaError extends Error {
  readonly usedBytes: number;
  readonly maxBytes: number;
  readonly requiredBytes: number;

  constructor(used: number, max: number, required: number) {
    super(
      max > 0
        ? `Storage quota exceeded: ${formatBytes(used)} used of ${formatBytes(max)} limit. ` +
          `Requires ${formatBytes(required)} more.`
        : `Storage is full: the browser refused to store more data for this site.`
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
const DB_VERSION = 1;
/** How often a write may re-ask the browser for its storage estimate. */
const ESTIMATE_THROTTLE_MS = 3000;
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

/**
 * The UTF-8 size of a string, without allocating an encoded copy. Characters ×
 * 2 (UTF-16 code units) was the old measure: it roughly DOUBLED every
 * ASCII-heavy note, which is most of them, so the cap was hit at about half the
 * data it claimed to allow.
 */
export function utf8Bytes(str: string): number {
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { n += 4; i++; } else n += 3;
    } else n += 3;
  }
  return n;
}

/** The browser refused a write because the origin is out of quota. */
export function isQuotaExceeded(e: unknown): boolean {
  const err = e as { name?: string; code?: number } | null;
  return !!err && (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED" || err.code === 22);
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

/** Does the manifest list exactly the ids that are stored? */
export function sameIdSet(documents: { id: string }[], ids: readonly unknown[]): boolean {
  if (documents.length !== ids.length) return false;
  const stored = new Set(ids.map(String));
  const listed = new Set(documents.map((d) => d.id));
  if (listed.size !== documents.length) return false; // duplicate rows
  for (const id of listed) if (!stored.has(id)) return false;
  return true;
}

// ─── IndexedDBStorageAdapter ──────────────────────────────────────────────────

export class IndexedDBStorageAdapter implements StorageAdapter {
  private readonly _dbName: string;
  /** A host-configured hard cap, or null: the browser's quota is the limit. */
  private readonly _maxBytes: number | null;
  private _db: IDBDatabase | null = null;
  private _readyPromise: Promise<void>;
  private _metrics: StorageMetrics;
  /** The documents' own UTF-8 bytes and count (the store, not the origin). */
  private _docBytes = 0;
  private _docCount = 0;
  /** The browser's last answer to navigator.storage.estimate(), if any. */
  private _estimate: { usage: number; quota: number } | null = null;
  private _estimateAt = 0;
  /** Closed because another tab is upgrading the database (versionchange). */
  private _closedForUpgrade = false;

  constructor(config?: IDBStorageConfig) {
    this._dbName = config?.dbName ?? DEFAULT_DB_NAME;
    this._maxBytes = typeof config?.maxBytes === "number" && config.maxBytes > 0 ? config.maxBytes : null;
    this._metrics = { usedBytes: 0, maxBytes: 0, pct: 0, docCount: 0, available: 0, limitKnown: false };
    this._publishMetrics();
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
      const adopt = (db: IDBDatabase) => {
        // A newer build in another tab wants to UPGRADE this database. An open
        // connection BLOCKS that upgrade — the new tab hangs on open for as
        // long as this one lives. Close it; this tab's storage calls then fail
        // with a clear "reload" message instead of silently wedging the other.
        db.onversionchange = () => {
          db.close();
          if (this._db === db) this._db = null;
          this._closedForUpgrade = true;
          console.warn("[IDBStorage] The document database is being upgraded by a newer version in another tab — reload this tab.");
        };
        this._db = db;
        // Recompute metrics after open so first getMetrics() call is accurate
        Promise.all([this._recomputeMetrics(), this._refreshEstimate(true)]).then(() => resolve(), () => resolve());
      };
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
      req.onsuccess = (event) => adopt((event.target as IDBOpenDBRequest).result);
      req.onblocked = () => {
        console.warn("[IDBStorage] Opening the document database is waiting for another tab to close it.");
      };
      req.onerror = () => {
        // The database is at a HIGHER version than this build knows — a newer
        // build upgraded it, then this one was served (a rollback, a stale
        // cached tab). Refusing to open made the whole editor fail to start.
        // Open it at its own version instead, as long as the stores this build
        // uses are still there; content from the newer build is protected by
        // the schema lock (schema-version.ts), not by locking the user out.
        if (req.error?.name !== "VersionError") { reject(req.error); return; }
        const fallback = indexedDB.open(this._dbName);
        fallback.onsuccess = () => {
          const db = fallback.result;
          if (db.objectStoreNames.contains(STORE_DOCS) && db.objectStoreNames.contains(STORE_META)) {
            console.warn(`[IDBStorage] ${this._dbName} is at version ${db.version} (newer than ${DB_VERSION}); opening it as it is.`);
            adopt(db);
          } else {
            db.close();
            reject(new Error("The document database was changed by a newer version of the app — open it in that version."));
          }
        };
        fallback.onerror = () => reject(fallback.error ?? req.error);
      };
    });
  }

  /** Resolves once the database is open and metrics have been computed. */
  isReady(): Promise<void> {
    return this._readyPromise;
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  private _db_(): IDBDatabase {
    if (this._closedForUpgrade) {
      throw new Error("The document database was upgraded by a newer version of the app in another tab — reload this tab.");
    }
    if (!this._db) throw new Error("IndexedDB not yet open — await isReady() first");
    return this._db;
  }

  /**
   * The stored document list, or null when it is MISSING or UNREADABLE — which
   * the caller must answer by rebuilding it from the documents themselves.
   *
   * It used to answer both with an empty list. The very next save then wrote a
   * manifest containing one document, and every other document became
   * invisible though still stored — the whole library hanging off one JSON
   * value nothing ever rebuilt. A transaction that fails still throws.
   */
  private async _getManifest(tx: IDBTransaction): Promise<StorageManifest | null> {
    // idbRequest resolves in the onsuccess microtask — safe to await inside a tx
    const raw = await idbRequest<string | undefined>(tx.objectStore(STORE_META).get(MANIFEST_KEY));
    if (raw === undefined || raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as StorageManifest;
      if (parsed && Array.isArray(parsed.documents)) return parsed;
    } catch { /* fall through: unreadable */ }
    console.warn("[IDBStorage] The document list is unreadable — rebuilding it from the stored documents.");
    return null;
  }

  /** Summaries of every document actually in the store (cursor, inside `tx`).
   *  A record that will not parse cannot be summarised and is left out. */
  private _summariesFromStore(tx: IDBTransaction): Promise<DocumentSummary[]> {
    return new Promise((resolve, reject) => {
      const out: DocumentSummary[] = [];
      const req = tx.objectStore(STORE_DOCS).openCursor();
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null;
        if (!cursor) { resolve(out); return; }
        const doc = typeof cursor.value === "string" ? deserializeFromStorage(cursor.value) : null;
        if (doc) out.push(toSummary(doc));
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  /** The manifest inside a write transaction, rebuilt first when it is missing
   *  or unreadable — so a write never replaces the library's index with one
   *  that lists only the document being written. */
  private async _manifestForWrite(tx: IDBTransaction): Promise<StorageManifest> {
    return (await this._getManifest(tx)) ?? { documents: await this._summariesFromStore(tx) };
  }

  private async _setManifest(manifest: StorageManifest, tx: IDBTransaction): Promise<void> {
    const store = tx.objectStore(STORE_META);
    await idbRequest(store.put(JSON.stringify(manifest), MANIFEST_KEY));
  }

  /** Derive the published metrics from what is known (see StorageMetrics). */
  private _publishMetrics(): void {
    const docCount = this._docCount;
    if (this._maxBytes != null) {
      const used = this._docBytes;
      const max = this._maxBytes;
      this._metrics = {
        usedBytes: used, maxBytes: max, docCount, limitKnown: true,
        pct: Math.min(100, Math.round((used / max) * 100)),
        available: Math.max(0, max - used),
      };
    } else if (this._estimate && this._estimate.quota > 0) {
      const { usage, quota } = this._estimate;
      this._metrics = {
        usedBytes: usage, maxBytes: quota, docCount, limitKnown: true,
        pct: Math.min(100, Math.round((usage / quota) * 100)),
        available: Math.max(0, quota - usage),
      };
    } else {
      this._metrics = { usedBytes: this._docBytes, maxBytes: 0, pct: 0, docCount, available: 0, limitKnown: false };
    }
  }

  /**
   * Ask the browser how much of its quota this origin uses — the limit that
   * actually decides whether a write lands. Throttled on the write path; never
   * throws (a browser without the API leaves the limit unknown).
   */
  private async _refreshEstimate(force = false): Promise<void> {
    if (!force && Date.now() - this._estimateAt < ESTIMATE_THROTTLE_MS) return;
    this._estimateAt = Date.now();
    try {
      const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { storage?: StorageManager }) : null;
      const est = nav?.storage?.estimate ? await nav.storage.estimate() : null;
      if (est && typeof est.quota === "number" && typeof est.usage === "number") {
        this._estimate = { usage: est.usage, quota: est.quota };
      }
    } catch { /* no estimate — the limit stays unknown */ }
    this._publishMetrics();
  }

  /** The error to raise when the browser refused a write for lack of quota. */
  private _quotaError(requiredBytes: number): StorageQuotaError {
    return this._estimate
      ? new StorageQuotaError(this._estimate.usage, this._estimate.quota, requiredBytes)
      : new StorageQuotaError(this._docBytes, 0, requiredBytes);
  }

  /**
   * Walk all document keys and sum their byte sizes to build accurate metrics.
   * Called on open and after a delete; saves account for themselves.
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
              usedBytes += utf8Bytes(val);
              docCount++;
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
        req.onerror = () => reject(req.error);
      });

      this._docBytes = usedBytes;
      this._docCount = docCount;
      this._publishMetrics();
    } catch {
      /* best effort — keep last known metrics */
    }
  }

  // ── StorageAdapter interface ────────────────────────────────────────────────

  /**
   * Summaries, newest first. The manifest is checked against the ids that are
   * really stored and rebuilt from the documents when it is missing,
   * unreadable or out of step, instead of being trusted blindly.
   */
  async list(): Promise<DocumentSummary[]> {
    await this._readyPromise;
    const { manifest, ids } = await idbTransaction(
      this._db_(), [STORE_DOCS, STORE_META], "readonly",
      async (tx) => ({
        manifest: await this._getManifest(tx),
        ids: await idbRequest<IDBValidKey[]>(tx.objectStore(STORE_DOCS).getAllKeys()),
      })
    );
    let documents = manifest?.documents;
    if (!documents ? ids.length > 0 : !sameIdSet(documents, ids)) {
      documents = await idbTransaction(this._db_(), [STORE_DOCS, STORE_META], "readwrite", async (tx) => {
        const rebuilt = await this._summariesFromStore(tx);
        await this._setManifest({ documents: rebuilt }, tx);
        return rebuilt;
      });
    }
    return (documents ?? []).slice().sort(
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

  /**
   * Many documents in ONE read transaction (library export). Each slot is the
   * record, null for an id that is not stored, or a StorageReadError for a
   * record that will not parse; a transaction that fails rejects the call.
   */
  async getMany(ids: string[]): Promise<(DocumentRecord | null | StorageReadError)[]> {
    await this._readyPromise;
    let raws: (string | undefined)[];
    try {
      raws = await idbTransaction(this._db_(), [STORE_DOCS], "readonly", async (tx) => {
        const store = tx.objectStore(STORE_DOCS);
        // Every request is issued before the first await, so the transaction
        // stays alive until the last one answers.
        return Promise.all(ids.map((id) => idbRequest<string | undefined>(store.get(id))));
      });
    } catch (e) {
      throw new StorageReadError(`Could not read ${ids.length} documents`, { cause: e });
    }
    return raws.map((raw, i) => {
      if (raw === undefined || raw === null) return null;
      try {
        return parseStoredDocument(ids[i]!, raw);
      } catch (e) {
        return e instanceof StorageReadError ? e : new StorageReadError(String(e), { corrupt: true });
      }
    });
  }

  async save(doc: DocumentRecord): Promise<void> {
    await this._readyPromise;
    stampUpdated(doc);
    const serialized = serializeForStorage(doc);
    const newDocBytes = utf8Bytes(serialized);
    let docBytesAfter = -1;
    let docCountAfter = 0;

    try {
      await idbTransaction(
        this._db_(),
        [STORE_DOCS, STORE_META],
        "readwrite",
        async (tx) => {
          const store = tx.objectStore(STORE_DOCS);
          let existing = 0;
          let found = false;
          if (this._maxBytes != null) {
            // A host's HARD cap is checked INSIDE the write transaction against
            // the true current usage (not cached metrics a concurrent save could
            // read stale), which serializes the check and the write. The cursor
            // also counts documents, so the post-commit metrics are arithmetic.
            const cap = this._maxBytes;
            const walk = await new Promise<{ total: number; existing: number; found: boolean; count: number }>(
              (resolve, reject) => {
                let total = 0;
                let existingBytes = 0;
                let hit = false;
                let count = 0;
                const req = store.openCursor();
                req.onsuccess = () => {
                  const cursor = req.result;
                  if (cursor) {
                    const bytes = utf8Bytes(cursor.value as string);
                    total += bytes;
                    count++;
                    if (cursor.key === doc.id) { existingBytes = bytes; hit = true; }
                    cursor.continue();
                  } else {
                    resolve({ total, existing: existingBytes, found: hit, count });
                  }
                };
                req.onerror = () => reject(req.error);
              }
            );
            const projectedUsed = walk.total - walk.existing + newDocBytes;
            if (projectedUsed > cap) {
              throw new StorageQuotaError(walk.total, cap, projectedUsed - cap);
            }
            existing = walk.existing;
            found = walk.found;
            this._docBytes = walk.total;
            this._docCount = walk.count;
          } else {
            // No self-imposed cap: the browser's quota is the limit, and the
            // browser enforces it (a QuotaExceededError, translated below). Only
            // this record's previous size is needed — not a walk of the whole
            // library on every autosave.
            const prev = await idbRequest<string | undefined>(store.get(doc.id));
            found = prev !== undefined && prev !== null;
            existing = typeof prev === "string" ? utf8Bytes(prev) : 0;
          }

          await idbRequest(store.put(serialized, doc.id));

          const manifest = await this._manifestForWrite(tx);
          const summary = toSummary(doc);
          const idx = manifest.documents.findIndex((d) => d.id === doc.id);
          if (idx >= 0) {
            manifest.documents[idx] = summary;
          } else {
            manifest.documents.push(summary);
          }
          await this._setManifest(manifest, tx);
          // Metrics from the numbers this transaction ALREADY has, never a second
          // walk of the store: saving one note must not cost the whole library.
          docBytesAfter = this._docBytes - existing + newDocBytes;
          docCountAfter = found ? this._docCount : this._docCount + 1;
        }
      );
    } catch (e) {
      // The browser is out of quota for this site. Surface it as the one error
      // the UI knows means "storage is full" — raw, it read as a generic write
      // failure and autosave retried it forever ("Save failed — retrying").
      if (isQuotaExceeded(e)) throw this._quotaError(newDocBytes);
      throw e;
    }

    if (docBytesAfter >= 0) {
      this._docBytes = Math.max(0, docBytesAfter);
      this._docCount = docCountAfter;
      this._publishMetrics();
    } else {
      // Transaction did not reach the accounting step — fall back to a full walk.
      await this._recomputeMetrics();
    }
    void this._refreshEstimate();
  }

  async delete(id: string): Promise<void> {
    await this._readyPromise;
    await idbTransaction(
      this._db_(),
      [STORE_DOCS, STORE_META],
      "readwrite",
      async (tx) => {
        await idbRequest(tx.objectStore(STORE_DOCS).delete(id));

        const manifest = await this._manifestForWrite(tx);
        manifest.documents = manifest.documents.filter((d) => d.id !== id);
        await this._setManifest(manifest, tx);
      }
    );

    await this._recomputeMetrics();
    await this._refreshEstimate(true);
  }

  /** Erase both stores — every document, the list, and the prefs (which hold
   *  folder names) — in one transaction. See clearLocalData. */
  async clear(): Promise<void> {
    await this._readyPromise;
    await idbTransaction(this._db_(), [STORE_DOCS, STORE_META], "readwrite", async (tx) => {
      await idbRequest(tx.objectStore(STORE_DOCS).clear());
      await idbRequest(tx.objectStore(STORE_META).clear());
    });
    await this._recomputeMetrics();
    await this._refreshEstimate(true);
  }

  async search(query: string): Promise<DocumentSummary[]> {
    const documents = await this.list();
    const q = query.toLowerCase();
    return documents.filter(
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
