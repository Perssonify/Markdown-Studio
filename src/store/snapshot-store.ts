/**
 * Recoverable snapshot net — the LAST line of defence against data loss.
 *
 * The prevention layers (blank-save backstop, live-canonical provider, switch-
 * generation guard, multi-tab guard) stop the known ways content gets clobbered.
 * This store is the safety net for everything they DON'T catch: it keeps a small,
 * bounded, PERSISTED ring of prior content versions per document so that if a
 * document ever ends up wiped or wrong — by a bug we haven't found, a bad
 * replace-all, a botched sync, an accidental clear, or a delete — the earlier
 * content can still be recovered after a reload. This directly answers the
 * "my file got wiped and I can't get it back" failure.
 *
 * Design choices:
 *  - SIDECAR IndexedDB (`perssonify-snapshots`), independent of the injected
 *    StorageAdapter. It must survive reloads (the in-memory undo/history caches
 *    do NOT — that is exactly why past losses were unrecoverable), work no matter
 *    which adapter a host supplies, and never touch the delicate main doc schema.
 *  - Bounded: per-doc count cap + a global byte budget + an age cap, evicted
 *    oldest-first. Snapshots are throttled on autosave (one per interval) but a
 *    large content SHRINK always snapshots immediately — that is the "got wiped"
 *    signature and the most important thing to preserve.
 *  - Fails soft: if IndexedDB is unavailable (SSR, private mode, tests) it keeps
 *    an in-memory ring so the API still works within the session.
 *  - Content-hash dedup so identical consecutive saves don't fill the ring.
 */

import { computeCounts, type PMNode } from "./document";
import { quickHash } from "../utils";

export type SnapshotReason =
  | "autosave"    // periodic pre-overwrite capture during editing
  | "pre-clear"   // captured a large shrink / explicit clear
  | "pre-delete"  // the doc was about to be deleted
  | "pre-restore" // captured current state before restoring an older snapshot
  | "manual";     // user asked to snapshot now

export interface SnapshotMeta {
  id: number;
  docId: string;
  ts: number;
  reason: SnapshotReason;
  /** Doc title at capture time (deleted docs have no live title to show). */
  title: string;
  /** Serialized canonical byte estimate. */
  bytes: number;
  words: number;
  /** Content hash — used for dedup and to skip no-op restores. */
  hash: number;
  /** Insertion order within the session that wrote it, shared by the memory
   *  ring and the database (see `byRecentDesc`). Absent on older records. */
  seq?: number;
}

interface SnapshotRecord extends SnapshotMeta {
  canonical: unknown;
}

// ─── Tuning ──────────────────────────────────────────────────────────────────

const DB_NAME = "perssonify-snapshots";
const DB_VERSION = 1;
const STORE = "snapshots";
const IDX_DOC = "byDoc";

const MAX_PER_DOC = 20;              // keep at most N versions per document
const MAX_TOTAL_BYTES = 12 * 1024 * 1024; // global ring budget (~12MB)
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const AUTOSAVE_MIN_INTERVAL_MS = 90 * 1000;  // ≥1 autosave snapshot per 90s/doc
const SHRINK_TRIGGER_RATIO = 0.5;   // new ≤ 50% of old chars ⇒ always snapshot

// ─── Blank detection (mirrors documentStore.isBlankCanonical) ─────────────────

function isBlank(c: any): boolean {
  if (!c || !Array.isArray(c.content) || c.content.length === 0) return true;
  if (c.content.length === 1) {
    const n = c.content[0];
    return !!n && n.type === "paragraph" && (!n.content || n.content.length === 0);
  }
  return false;
}

function serialize(canonical: unknown): string {
  try { return JSON.stringify(canonical) ?? ""; } catch { return ""; }
}

/**
 * Insertion order, for breaking same-millisecond ties. `seq` when the record
 * carries one (both stores stamp it from ONE session counter, so it also orders
 * a memory fallback against a database write in the same ms). Otherwise the
 * id's MAGNITUDE: IndexedDB's autoIncrement counts up from 1, the memory ring
 * counts DOWN from -1 — so for the ring "later" is "more negative", and
 * comparing raw ids ranked the oldest same-ms version as the newest (listed
 * first, restored as "latest", and the per-document cap evicted the newest).
 */
const insertionOrder = (m: SnapshotMeta): number => m.seq ?? Math.abs(m.id);

/** Newest-first ordering: by timestamp, then by insertion order. */
const byRecentDesc = (a: SnapshotMeta, b: SnapshotMeta) =>
  b.ts - a.ts || insertionOrder(b) - insertionOrder(a);

// ─── Store ─────────────────────────────────────────────────────────────────

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

class SnapshotStore {
  private db: IDBDatabase | null = null;
  private ready: Promise<void> | null = null;
  private usable = true;
  /** The database this ring lives in (namespaced per host — see configure). */
  private dbName = DB_NAME;
  /** False: a host turned version history off — nothing is recorded at all. */
  private enabled = true;
  /** In-memory fallback ring when IndexedDB is unavailable. */
  private mem: SnapshotRecord[] = [];
  /**
   * Ids for the in-memory fallback ring, allocated NEGATIVE and descending.
   *
   * IndexedDB's autoIncrement generator only ever produces positive integers,
   * so a negative id can never alias a stored one — and every id-keyed
   * operation can tell which store an id came from by its sign alone. They used
   * to share one space starting at 1, which was harmless only while the two
   * could not coexist (memory was consulted solely when the database was
   * unusable). Once readers began unioning both, a memory record and a stored
   * record could each be id 1: restoring one returned the other's content, in
   * the one code path whose entire job is recovering content.
   */
  private memSeq = -1;
  /** Session-wide insertion counter stamped on every record (`seq`). */
  private insertSeq = 0;
  /** Last autosave-reason snapshot time per doc (throttle; session-only). */
  private lastAutoAt = new Map<string, number>();
  private listeners = new Set<() => void>();

  private open(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve) => {
      // Disabled by the host: do not even create the database.
      if (!this.enabled || typeof indexedDB === "undefined") {
        this.usable = false;
        resolve();
        return;
      }
      try {
        const req = indexedDB.open(this.dbName, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE)) {
            const os = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
            os.createIndex(IDX_DOC, "docId", { unique: false });
          }
        };
        req.onsuccess = (e) => {
          const db = (e.target as IDBOpenDBRequest).result;
          // Never block a newer build's upgrade of this database from another
          // tab (it would hang on open). Close, and keep working from the
          // in-memory ring for the rest of this tab's life.
          db.onversionchange = () => {
            db.close();
            if (this.db === db) { this.db = null; this.usable = false; }
          };
          this.db = db;
          resolve();
        };
        req.onerror = () => { this.usable = false; resolve(); };
      } catch {
        this.usable = false;
        resolve();
      }
    });
    return this.ready;
  }

  /**
   * Where version history lives, and whether it exists at all.
   *
   * The ring used to be one database per ORIGIN whatever storage a host
   * injected, so on a shared device user A's content showed up in user B's
   * Version history. A host that namespaces its documents namespaces this too
   * (the editor derives the name from `storageConfig`), or turns it off. The
   * standalone app's database name is unchanged.
   */
  configure(opts: { dbName?: string; enabled?: boolean } = {}): void {
    const dbName = opts.dbName || DB_NAME;
    const enabled = opts.enabled !== false;
    if (dbName === this.dbName && enabled === this.enabled) return;
    this.db?.close();
    this.db = null;
    this.ready = null;
    this.usable = true;
    this.mem = [];
    this.lastAutoAt.clear();
    this.dbName = dbName;
    this.enabled = enabled;
    this.emit();
  }

  /** Erase every snapshot, stored and in memory (see clearLocalData). */
  async clearAll(): Promise<void> {
    await this.open();
    this.mem = [];
    this.lastAutoAt.clear();
    if (this.usable && this.db) {
      try {
        const tx = this.db.transaction(STORE, "readwrite");
        await idbRequest(tx.objectStore(STORE).clear());
      } catch { /* best effort */ }
    }
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() { for (const l of this.listeners) l(); }

  // ── Recording ─────────────────────────────────────────────────────────────

  /**
   * Decide whether an autosave should snapshot the OLD (pre-overwrite) content,
   * and if so record it. `oldCanonical` is what is currently on disk; `newCanonical`
   * is what is about to replace it. Blank OLD content is never worth snapshotting
   * (nothing to protect). A large shrink always snapshots; otherwise it is
   * throttled to one snapshot per doc per interval. Fire-and-forget.
   */
  maybeRecordOnSave(
    docId: string,
    title: string,
    oldCanonical: unknown,
    newCanonical: unknown
  ): Promise<void> {
    if (!this.enabled || !docId || isBlank(oldCanonical)) return Promise.resolve();
    const oldChars = (computeCounts(oldCanonical as PMNode).chars) || 0;
    const newChars = isBlank(newCanonical) ? 0 : (computeCounts(newCanonical as PMNode).chars || 0);
    const shrink = oldChars > 0 && newChars <= oldChars * SHRINK_TRIGGER_RATIO;
    const now = Date.now();
    const last = this.lastAutoAt.get(docId) ?? 0;
    if (!shrink && now - last < AUTOSAVE_MIN_INTERVAL_MS) return Promise.resolve();
    this.lastAutoAt.set(docId, now);
    // Returns the write promise so callers (tests) MAY await it; production
    // callers treat it as fire-and-forget and ignore the result.
    return this.record(docId, title, oldCanonical, shrink ? "pre-clear" : "autosave");
  }

  /**
   * Record a snapshot unconditionally (used for pre-delete / pre-restore /
   * manual). Deduped against the most recent snapshot for the doc by content
   * hash so back-to-back identical captures don't accumulate.
   */
  async record(
    docId: string,
    title: string,
    canonical: unknown,
    reason: SnapshotReason
  ): Promise<void> {
    if (!this.enabled || !docId || isBlank(canonical)) return;
    await this.open();
    const serialized = serialize(canonical);
    const hash = quickHash(serialized);
    const meta: Omit<SnapshotRecord, "id"> = {
      docId,
      ts: Date.now(),
      reason,
      title: title || "Untitled",
      bytes: serialized.length * 2,
      words: computeCounts(canonical as PMNode).words || 0,
      hash,
      seq: ++this.insertSeq,
      canonical,
    };

    // Dedup vs the latest existing snapshot for this doc.
    const latest = (await this.listForDoc(docId))[0];
    if (latest && latest.hash === hash) return;

    if (!this.usable || !this.db) {
      this.mem.push({ ...meta, id: this.memSeq-- });
    } else {
      try {
        const tx = this.db.transaction(STORE, "readwrite");
        await idbRequest(tx.objectStore(STORE).add(meta as SnapshotRecord));
      } catch {
        // Fall back to memory on any write error (e.g. quota).
        this.mem.push({ ...meta, id: this.memSeq-- });
      }
    }
    await this.prune(docId);
    this.emit();
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  /** Metadata for a doc's snapshots, newest-first (no canonical payload). */
  async listForDoc(docId: string): Promise<SnapshotMeta[]> {
    await this.open();
    const recs = await this.allForDoc(docId);
    return recs
      .map(stripCanonical)
      .sort(byRecentDesc);
  }

  /** All snapshots grouped by docId, newest-first within each group. */
  async listAll(): Promise<Map<string, SnapshotMeta[]>> {
    await this.open();
    const recs = await this.allRecords();
    const byDoc = new Map<string, SnapshotMeta[]>();
    for (const r of recs.sort(byRecentDesc)) {
      const m = stripCanonical(r);
      const arr = byDoc.get(r.docId) ?? [];
      arr.push(m);
      byDoc.set(r.docId, arr);
    }
    return byDoc;
  }

  /** Full canonical for a snapshot id (for restore). */
  async getCanonical(id: number): Promise<unknown | null> {
    await this.open();
    // Negative id ⇒ memory ring; positive ⇒ IndexedDB. Dispatch on origin, never
    // on a bare number that both stores could have issued.
    if (id < 0) return this.mem.find((r) => r.id === id)?.canonical ?? null;
    if (!this.usable || !this.db) return null;
    try {
      const tx = this.db.transaction(STORE, "readonly");
      const rec = await idbRequest<SnapshotRecord | undefined>(tx.objectStore(STORE).get(id));
      return rec?.canonical ?? null;
    } catch {
      return null;
    }
  }

  // ── Deletion / pruning ───────────────────────────────────────────────────────

  /** Remove every snapshot for a doc (rarely needed — kept for hygiene). */
  async deleteForDoc(docId: string): Promise<void> {
    await this.open();
    // Always drop the doc's memory-ring entries; they exist independently of the
    // database's state. Sending their (negative) ids to IndexedDB would delete
    // nothing there — and, when ids still overlapped, deleted somebody else's.
    this.mem = this.mem.filter((r) => r.docId !== docId);
    if (!this.usable || !this.db) {
      this.emit();
      return;
    }
    try {
      // The read comes FIRST, and its own transaction is finished before this
      // one opens. IndexedDB auto-commits a transaction as soon as the microtask
      // queue drains with no request pending against it — the constraint
      // idb-storage-adapter documents at length — so awaiting `allForDoc`
      // (a SEPARATE transaction) after opening this one left `tx` dead, and
      // every `store.delete` threw into the catch below: the function cleared
      // the memory ring, emitted a change, and deleted nothing from the
      // database.
      const ids = (await this.allForDoc(docId)).map((r) => r.id).filter((id) => id >= 0);
      if (ids.length) {
        const tx = this.db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        for (const id of ids) await idbRequest(store.delete(id));
      }
    } catch { /* best effort */ }
    this.emit();
  }

  async deleteOne(id: number): Promise<void> {
    await this.open();
    // One deletion path for both stores — Version History's per-version delete
    // used to touch IndexedDB only, so removing a memory-fallback snapshot from
    // the list silently did nothing while it stayed listed.
    await this.rawDelete(id);
    this.emit();
  }

  /**
   * Enforce the bounds: per-doc count, global byte budget, and age. Called after
   * each record. Evicts oldest first — but never the single most-recent snapshot
   * of a LIVE doc (that is the recovery point we most want to keep). A deleted
   * document's pre-delete copy is the exception: it expires with age (A079).
   */
  private async prune(justSavedDocId: string): Promise<void> {
    // ONE read of the ring, then every cap decided in memory. This used to read
    // the doc's snapshots and then ALL records twice more (the age pass and the
    // byte pass each re-listed the store, payloads included) on every snapshot —
    // i.e. on autosaves — so its cost grew with the whole history.
    // Newest-first by `byRecentDesc` (timestamp, then insertion order), so
    // same-millisecond bursts never evict the newest instead of the oldest.
    const all = (await this.allRecords()).sort(byRecentDesc);
    const doomed = new Set<number>();

    // 1) Per-doc count cap (drop oldest beyond MAX_PER_DOC).
    all.filter((r) => r.docId === justSavedDocId)
      .slice(MAX_PER_DOC)
      .forEach((r) => doomed.add(r.id));

    // 2) Age cap (keep the newest per doc regardless of age — unless that
    //    newest one is the doc's PRE-DELETE copy). A deleted document's last
    //    snapshot used to be exempt from every cap, so deleted content lived
    //    in the browser forever. It is recoverable for the age window, like
    //    everything else, and then it goes.
    const seenNewest = new Set<string>();
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const r of all) {
      const isNewestForDoc = !seenNewest.has(r.docId);
      seenNewest.add(r.docId);
      const keep = isNewestForDoc && r.reason !== "pre-delete";
      if (!keep && r.ts < cutoff) doomed.add(r.id);
    }

    // 3) Global byte budget over what survives — evict oldest (never a live
    //    doc's newest) until under.
    const live = all.filter((r) => !doomed.has(r.id)); // still newest first
    let total = live.reduce((s, r) => s + r.bytes, 0);
    if (total > MAX_TOTAL_BYTES) {
      const newestIdByDoc = new Map<string, number>();
      for (const r of live) {
        if (!newestIdByDoc.has(r.docId) && r.reason !== "pre-delete") newestIdByDoc.set(r.docId, r.id);
        else if (!newestIdByDoc.has(r.docId)) newestIdByDoc.set(r.docId, -Infinity); // a deleted doc: not protected
      }
      // Walk oldest→newest, evicting until under budget.
      for (let i = live.length - 1; i >= 0 && total > MAX_TOTAL_BYTES; i--) {
        const r = live[i]!;
        if (newestIdByDoc.get(r.docId) === r.id) continue; // never evict a doc's newest
        doomed.add(r.id);
        total -= r.bytes;
      }
    }

    for (const id of doomed) await this.rawDelete(id);
  }

  // ── Low-level accessors ──────────────────────────────────────────────────────

  // NOTE: every accessor below UNIONS the in-memory ring with IndexedDB rather
  // than short-circuiting to one or the other. `record()` falls back to memory
  // when an individual IDB write fails (quota, for instance) — but the database
  // is still open and `usable`, so a reader that returned early on `this.db`
  // could never see those entries. The fallback in this file's last line of
  // defence was writing snapshots nothing could ever read back.
  private async allRecords(): Promise<SnapshotRecord[]> {
    const mem = this.mem.slice();
    if (!this.usable || !this.db) return mem;
    try {
      const tx = this.db.transaction(STORE, "readonly");
      const stored = (await idbRequest<SnapshotRecord[]>(tx.objectStore(STORE).getAll())) ?? [];
      return mem.length ? [...stored, ...mem] : stored;
    } catch {
      return mem;
    }
  }

  private async allForDoc(docId: string): Promise<SnapshotRecord[]> {
    const mem = this.mem.filter((r) => r.docId === docId);
    if (!this.usable || !this.db) return mem;
    try {
      const tx = this.db.transaction(STORE, "readonly");
      const idx = tx.objectStore(STORE).index(IDX_DOC);
      const stored = (await idbRequest<SnapshotRecord[]>(idx.getAll(docId))) ?? [];
      return mem.length ? [...stored, ...mem] : stored;
    } catch {
      return mem;
    }
  }

  private async rawDelete(id: number): Promise<void> {
    // Memory-only entries are negative and never exist in IndexedDB, so deleting
    // one must not send that id to the store (and vice versa).
    if (id < 0) {
      this.mem = this.mem.filter((r) => r.id !== id);
      return;
    }
    if (!this.usable || !this.db) return;
    try {
      const tx = this.db.transaction(STORE, "readwrite");
      await idbRequest(tx.objectStore(STORE).delete(id));
    } catch { /* best effort */ }
  }

  /**
   * Test hook: wipe in-memory state + throttle map.
   *
   * The default forces the in-memory fallback, which is all a bare jsdom can
   * do. `{ useIndexedDB: true }` re-arms the real database path instead (with
   * an IndexedDB shim installed) — without it the last line of defence for
   * recovering a user's content had never once run against a database, only
   * against the ring it falls back to.
   */
  _resetForTests(opts: { useIndexedDB?: boolean } = {}): void {
    this.mem = [];
    this.memSeq = -1;
    this.insertSeq = 0;
    this.dbName = DB_NAME;
    this.enabled = true;
    this.lastAutoAt.clear();
    if (opts.useIndexedDB) {
      this.usable = true;
      this.db = null;
      this.ready = null; // the next open() re-opens the database
      return;
    }
    this.usable = false;
    this.db = null;
    this.ready = Promise.resolve();
  }
}

function stripCanonical(r: SnapshotRecord): SnapshotMeta {
  const { canonical, ...meta } = r;
  void canonical;
  return meta;
}

export const snapshotStore = new SnapshotStore();

/** Human formatting for byte counts (shared with the version-history UI). */
export function formatSnapshotBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
