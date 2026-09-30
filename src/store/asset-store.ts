/**
 * Images as binary ASSETS, in a sidecar IndexedDB (A086).
 *
 * An image used to live inside its document as a `data:` URL, so every save,
 * snapshot, crash stash, draft, export and cross-pane projection carried the
 * whole picture as base64 — a third bigger than the bytes, parsed and
 * re-serialised on every autosave, and shown in the markdown pane as a wall of
 * text. An asset is stored ONCE, content-addressed by the SHA-256 of its bytes,
 * and documents reference it as `pf-asset:<hash>` (asset-refs.ts).
 *
 * Design, following the snapshot store (snapshot-store.ts):
 *  - A SIDECAR database (`perssonify-assets`, namespaced per host exactly like
 *    `perssonify-snapshots` — see configureLocalStores). The main document
 *    database's version and object stores are never touched: they are an
 *    on-disk contract with every existing install.
 *  - Two object stores keyed by hash: `meta` (type, size, created, last used)
 *    and `bytes` (the ArrayBuffer), so listing and garbage collection never
 *    read a picture's bytes. ArrayBuffer rather than Blob: every engine clones
 *    it into IndexedDB (older WebKit refused some Blobs), and fake-indexeddb
 *    can hold it, so the database path is what the tests exercise.
 *  - NO in-memory fallback ring, deliberately unlike the snapshot store. A
 *    reference is written into a document only after its bytes have COMMITTED
 *    here (`put` resolves to a hash only on transaction complete, with strict
 *    durability); an asset held only in memory would be a reference that
 *    resolves to nothing after a reload — an image silently lost. Where this
 *    store is unavailable or disabled (no IndexedDB, no WebCrypto, a host that
 *    turned it off) the callers keep the image INLINE as a `data:` URL, which
 *    is exactly how every image was stored before.
 *  - IndexedDB's transaction rule (see CLAUDE.md): a write transaction never
 *    awaits a read in another transaction. `put` checks for an existing asset
 *    and writes in ONE transaction; the garbage collector re-checks each
 *    candidate inside the same transaction that deletes it.
 */
import {
  MAX_ASSET_BYTES,
  bytesToDataUrl,
  isRasterMime,
  parseDataUrl,
} from "./asset-refs";

export interface AssetMeta {
  hash: string;
  mime: string;
  size: number;
  /** When the asset was first stored (epoch ms). */
  created: number;
  /** When it was last stored again or shown (epoch ms, see `touch`). */
  touched: number;
}

export const ASSETS_DB_NAME = "perssonify-assets";
const DB_VERSION = 1;
const META = "meta";
const BYTES = "bytes";

/** How long a released object URL lives before it is revoked. ProseMirror
 *  re-creates a node view when its paragraph re-renders; without a grace the
 *  image would be revoked and re-read on every such render. */
const URL_GRACE_MS = 2000;

/** `touched` is refreshed at most this often per asset (it is a write). */
const TOUCH_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Budget for the copy cache of `data:` URLs (characters). */
const DATA_URL_CACHE_CHARS = 48 * 1024 * 1024;

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Asset transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("Asset transaction aborted"));
  });
}

/** Lower-case hex SHA-256, or null where WebCrypto is unavailable (an insecure
 *  context, an old engine) — which makes the whole store unavailable. */
export async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  const subtle = typeof crypto !== "undefined" ? crypto.subtle : undefined;
  if (!subtle?.digest) return null;
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes as BufferSource));
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** A standalone ArrayBuffer holding exactly `bytes` (a view onto a larger
 *  buffer would store the WHOLE buffer). */
function ownBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

interface UrlEntry {
  refs: number;
  /** undefined = not loaded yet; null = no such asset. */
  url: string | null | undefined;
  promise: Promise<string | null> | null;
  revokeTimer: ReturnType<typeof setTimeout> | null;
}

class AssetStore {
  private db: IDBDatabase | null = null;
  private ready: Promise<boolean> | null = null;
  private dbName = ASSETS_DB_NAME;
  private enabled = true;
  private listeners = new Set<() => void>();
  private urls = new Map<string, UrlEntry>();
  private dataUrls = new Map<string, string>();
  private dataUrlChars = 0;
  private touchedAt = new Map<string, number>();

  // ── Configuration ─────────────────────────────────────────────────────────

  /**
   * Where assets live, and whether the store is used at all. Namespaced with
   * the rest of a host's browser stores (configureLocalStores); `enabled:
   * false` keeps every image inline, which is what a host with its own
   * StorageAdapter gets unless it opts in — its documents live somewhere this
   * browser-local database does not follow them.
   */
  configure(opts: { dbName?: string; enabled?: boolean } = {}): void {
    const dbName = opts.dbName || ASSETS_DB_NAME;
    const enabled = opts.enabled !== false;
    if (dbName === this.dbName && enabled === this.enabled) return;
    this.db?.close();
    this.db = null;
    this.ready = null;
    this.dbName = dbName;
    this.enabled = enabled;
    this.dropCaches();
    this.emit();
  }

  /** Configured on (it may still turn out to be unavailable — see `available`). */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** The database this store opens (for tests and diagnostics). */
  databaseName(): string {
    return this.dbName;
  }

  /** Whether images can be stored as assets here. False means "keep them inline". */
  available(): Promise<boolean> {
    return this.open();
  }

  private open(): Promise<boolean> {
    if (this.ready) return this.ready;
    this.ready = new Promise<boolean>((resolve) => {
      if (
        !this.enabled ||
        typeof indexedDB === "undefined" ||
        typeof crypto === "undefined" ||
        !crypto.subtle?.digest
      ) {
        resolve(false);
        return;
      }
      try {
        const req = indexedDB.open(this.dbName, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "hash" });
          if (!db.objectStoreNames.contains(BYTES)) db.createObjectStore(BYTES, { keyPath: "hash" });
        };
        req.onsuccess = () => {
          const db = req.result;
          // Never block a newer build's upgrade from another tab. Callers fall
          // back to inline images for the rest of this tab's life.
          db.onversionchange = () => {
            db.close();
            if (this.db === db) {
              this.db = null;
              this.ready = Promise.resolve(false);
            }
          };
          this.db = db;
          resolve(true);
        };
        req.onerror = () => resolve(false);
        req.onblocked = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
    return this.ready;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void {
    for (const l of [...this.listeners]) {
      try { l(); } catch { /* a listener must not break the store */ }
    }
  }

  // ── Writing ───────────────────────────────────────────────────────────────

  /**
   * Store an image and return its hash — ONLY once the write has committed.
   * Null means "not stored": the store is unavailable, the type is not a
   * raster image, it is empty or too big, or the write failed (quota). The
   * caller then keeps the image inline. Storing bytes that are already here
   * refreshes their `touched` stamp in the same transaction, so a garbage
   * collection running concurrently can never delete an asset this call has
   * just handed out.
   */
  async put(input: ArrayBuffer | Uint8Array, mime: string): Promise<string | null> {
    const type = (mime || "").trim().toLowerCase();
    if (!isRasterMime(type)) return null;
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!bytes.byteLength || bytes.byteLength > MAX_ASSET_BYTES) return null;
    if (!(await this.open()) || !this.db) return null;
    let hash: string | null;
    try {
      hash = await sha256Hex(bytes);
    } catch {
      return null;
    }
    if (!hash || !this.db) return null;
    const now = Date.now();
    let added = false;
    try {
      const tx = this.db.transaction([META, BYTES], "readwrite", { durability: "strict" });
      const done = txDone(tx);
      const meta = tx.objectStore(META);
      const req = meta.get(hash);
      req.onsuccess = () => {
        const existing = req.result as AssetMeta | undefined;
        if (existing) {
          meta.put({ ...existing, touched: now });
        } else {
          added = true;
          tx.objectStore(BYTES).put({ hash, bytes: ownBuffer(bytes) });
          meta.put({ hash, mime: type, size: bytes.byteLength, created: now, touched: now } satisfies AssetMeta);
        }
      };
      await done;
    } catch {
      return null;
    }
    this.touchedAt.set(hash, now);
    // A placeholder waiting for exactly this asset (a backup restored while a
    // document showing it was open) can resolve now.
    const pendingMiss = this.urls.get(hash);
    if (pendingMiss && pendingMiss.url === null) {
      pendingMiss.url = undefined;
      pendingMiss.promise = null;
    }
    if (added || pendingMiss) this.emit();
    return hash;
  }

  /** `put` for a `data:` URL. Returns the hash, or null (see `put`). */
  async putDataUrl(dataUrl: string): Promise<string | null> {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return null;
    return this.put(parsed.bytes, parsed.mime);
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  async get(hash: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
    if (!(await this.open()) || !this.db) return null;
    try {
      const tx = this.db.transaction([META, BYTES], "readonly");
      const [meta, row] = await Promise.all([
        idbRequest<AssetMeta | undefined>(tx.objectStore(META).get(hash)),
        idbRequest<{ hash: string; bytes: ArrayBuffer } | undefined>(tx.objectStore(BYTES).get(hash)),
      ]);
      if (!meta || !row?.bytes) return null;
      return { mime: meta.mime, bytes: new Uint8Array(row.bytes) };
    } catch {
      return null;
    }
  }

  /** Which of `hashes` are stored (one transaction). */
  async hasMany(hashes: Iterable<string>): Promise<Set<string>> {
    const found = new Set<string>();
    const list = [...new Set(hashes)];
    if (!list.length || !(await this.open()) || !this.db) return found;
    try {
      const tx = this.db.transaction(META, "readonly");
      const store = tx.objectStore(META);
      const rows = await Promise.all(list.map((h) => idbRequest<AssetMeta | undefined>(store.get(h))));
      rows.forEach((r, i) => { if (r) found.add(list[i]!); });
    } catch { /* nothing known */ }
    return found;
  }

  /**
   * Every asset's metadata. THROWS when the database cannot be read — the
   * garbage collector must never mistake "could not look" for "nothing there".
   */
  async list(): Promise<AssetMeta[]> {
    if (!(await this.open()) || !this.db) return [];
    const tx = this.db.transaction(META, "readonly");
    return (await idbRequest<AssetMeta[]>(tx.objectStore(META).getAll())) ?? [];
  }

  /** How many assets and how many bytes (0/0 when unavailable or unreadable). */
  async stats(): Promise<{ count: number; bytes: number }> {
    try {
      const all = await this.list();
      return { count: all.length, bytes: all.reduce((n, a) => n + (a.size || 0), 0) };
    } catch {
      return { count: 0, bytes: 0 };
    }
  }

  /** A self-contained `data:` URL for an asset (exports, copy), or null. */
  async dataUrl(hash: string): Promise<string | null> {
    const cached = this.dataUrls.get(hash);
    if (cached) return cached;
    const rec = await this.get(hash);
    if (!rec) return null;
    const url = bytesToDataUrl(rec.bytes, rec.mime);
    this.cacheDataUrl(hash, url);
    return url;
  }

  /** The cached `data:` URL, synchronously — the clipboard cannot wait. */
  peekDataUrl(hash: string): string | undefined {
    return this.dataUrls.get(hash);
  }

  /** Load assets' `data:` URLs ahead of a likely copy (a selection holding them). */
  warmDataUrls(hashes: Iterable<string>): void {
    for (const h of hashes) {
      if (!this.dataUrls.has(h)) void this.dataUrl(h).catch(() => null);
    }
  }

  private cacheDataUrl(hash: string, url: string): void {
    if (url.length > DATA_URL_CACHE_CHARS / 2) return; // not worth evicting everything for
    this.dataUrls.delete(hash);
    this.dataUrls.set(hash, url);
    this.dataUrlChars += url.length;
    for (const [k, v] of this.dataUrls) {
      if (this.dataUrlChars <= DATA_URL_CACHE_CHARS) break;
      this.dataUrls.delete(k);
      this.dataUrlChars -= v.length;
    }
  }

  // ── Display ───────────────────────────────────────────────────────────────

  /**
   * An object URL for showing an asset, shared by everyone showing it, or
   * null when no such asset exists. Every successful `acquireUrl` must be
   * matched by one `releaseUrl`; the URL is revoked shortly after the last
   * release (a node view's destroy, a document switch).
   */
  acquireUrl(hash: string): Promise<string | null> {
    let e = this.urls.get(hash);
    if (!e) {
      e = { refs: 0, url: undefined, promise: null, revokeTimer: null };
      this.urls.set(hash, e);
    }
    e.refs++;
    if (e.revokeTimer) { clearTimeout(e.revokeTimer); e.revokeTimer = null; }
    if (e.url !== undefined) return Promise.resolve(e.url);
    const entry = e;
    entry.promise ??= this.get(hash)
      .then((rec) => {
        if (!rec) { entry.url = null; return null; }
        let url: string;
        try {
          url = URL.createObjectURL(new Blob([rec.bytes as BlobPart], { type: rec.mime }));
        } catch {
          url = bytesToDataUrl(rec.bytes, rec.mime); // no object URLs in this environment
        }
        entry.url = url;
        void this.touch(hash);
        return url;
      })
      .catch(() => { entry.url = null; return null; });
    return entry.promise;
  }

  releaseUrl(hash: string): void {
    const e = this.urls.get(hash);
    if (!e) return;
    e.refs = Math.max(0, e.refs - 1);
    if (e.refs > 0 || e.revokeTimer) return;
    e.revokeTimer = setTimeout(() => {
      e.revokeTimer = null;
      if (e.refs > 0 || this.urls.get(hash) !== e) return;
      this.urls.delete(hash);
      if (e.url && e.url.startsWith("blob:")) {
        try { URL.revokeObjectURL(e.url); } catch { /* already gone */ }
      }
    }, URL_GRACE_MS);
  }

  /** Live object URLs (for tests and diagnostics). */
  liveUrlCount(): number {
    let n = 0;
    for (const e of this.urls.values()) if (e.url && e.refs > 0) n++;
    return n;
  }

  /**
   * Record that an asset is in use (shown). The garbage collector keeps
   * anything used within its grace window — which is what protects an image
   * that only an undo stack, or another open tab's unsaved edit, still refers
   * to. At most one write per asset per TOUCH_INTERVAL_MS.
   */
  async touch(hash: string): Promise<void> {
    const now = Date.now();
    if (now - (this.touchedAt.get(hash) ?? 0) < TOUCH_INTERVAL_MS) return;
    this.touchedAt.set(hash, now);
    if (!(await this.open()) || !this.db) return;
    try {
      const tx = this.db.transaction(META, "readwrite");
      const done = txDone(tx);
      const meta = tx.objectStore(META);
      const req = meta.get(hash);
      req.onsuccess = () => {
        const rec = req.result as AssetMeta | undefined;
        if (rec && now - (rec.touched || 0) >= TOUCH_INTERVAL_MS) meta.put({ ...rec, touched: now });
      };
      await done;
    } catch { /* best effort */ }
  }

  // ── Deleting ──────────────────────────────────────────────────────────────

  /**
   * Delete the given assets — each only if it has NOT been used since
   * `unusedSince` (epoch ms), re-checked inside the deleting transaction so a
   * concurrent `put` of the same image wins. Returns what was deleted.
   */
  async deleteUnused(hashes: Iterable<string>, unusedSince: number): Promise<{ deleted: string[]; bytes: number }> {
    const list = [...new Set(hashes)];
    const deleted: string[] = [];
    let bytes = 0;
    if (!list.length || !(await this.open()) || !this.db) return { deleted, bytes };
    const tx = this.db.transaction([META, BYTES], "readwrite", { durability: "strict" });
    const done = txDone(tx);
    const meta = tx.objectStore(META);
    const data = tx.objectStore(BYTES);
    for (const hash of list) {
      const req = meta.get(hash);
      req.onsuccess = () => {
        const rec = req.result as AssetMeta | undefined;
        if (!rec) return;
        if (Math.max(rec.touched || 0, rec.created || 0) >= unusedSince) return;
        meta.delete(hash);
        data.delete(hash);
        deleted.push(hash);
        bytes += rec.size || 0;
      };
    }
    await done;
    for (const h of deleted) this.forget(h);
    if (deleted.length) this.emit();
    return { deleted, bytes };
  }

  /** Erase every asset (clearLocalData). */
  async clearAll(): Promise<void> {
    this.dropCaches();
    if ((await this.open()) && this.db) {
      try {
        const tx = this.db.transaction([META, BYTES], "readwrite");
        const done = txDone(tx);
        tx.objectStore(META).clear();
        tx.objectStore(BYTES).clear();
        await done;
      } catch { /* best effort */ }
    }
    this.emit();
  }

  private forget(hash: string): void {
    const cached = this.dataUrls.get(hash);
    if (cached) { this.dataUrls.delete(hash); this.dataUrlChars -= cached.length; }
    this.touchedAt.delete(hash);
    const e = this.urls.get(hash);
    if (e && e.refs === 0) {
      if (e.revokeTimer) clearTimeout(e.revokeTimer);
      if (e.url && e.url.startsWith("blob:")) {
        try { URL.revokeObjectURL(e.url); } catch { /* ignore */ }
      }
      this.urls.delete(hash);
    }
  }

  private dropCaches(): void {
    for (const e of this.urls.values()) {
      if (e.revokeTimer) clearTimeout(e.revokeTimer);
      if (e.url && e.url.startsWith("blob:")) {
        try { URL.revokeObjectURL(e.url); } catch { /* ignore */ }
      }
    }
    this.urls.clear();
    this.dataUrls.clear();
    this.dataUrlChars = 0;
    this.touchedAt.clear();
  }

  /**
   * Test hook. The default makes the store UNAVAILABLE (a bare jsdom has no
   * IndexedDB); `{ useIndexedDB: true }` re-arms the real database path with
   * an IndexedDB shim installed (fake-indexeddb), under `dbName` if given.
   */
  _resetForTests(opts: { useIndexedDB?: boolean; dbName?: string } = {}): void {
    this.db?.close();
    this.db = null;
    this.dropCaches();
    this.listeners.clear();
    this.dbName = opts.dbName || ASSETS_DB_NAME;
    this.enabled = true;
    this.ready = opts.useIndexedDB ? null : Promise.resolve(false);
  }
}

export const assetStore = new AssetStore();
