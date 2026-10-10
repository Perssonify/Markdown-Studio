import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndexedDBStorageAdapter, StorageReadError } from "../store/persistence/idb-storage-adapter";
import { LocalStorageAdapter, WindowStorageAdapter } from "../store/persistence/storage-adapter";
import { useDocumentStore } from "../store/documents/documentStore";
import { createDocument, serializeForStorage } from "../store/documents/document";

/**
 * A029 — a storage read that FAILS must not look like "document not found".
 *
 * Every built-in adapter caught its read errors and returned null. The save
 * path treats null as "nothing stored", so on a failed read the blank-over-
 * content backstop, the multi-tab conflict check and the pre-overwrite
 * snapshot were all skipped: the "fails closed" promise was unreachable.
 */

vi.mock("../store/history/snapshot-store", () => ({
  snapshotStore: { maybeRecordOnSave: vi.fn(), record: vi.fn(async () => null) },
}));

const canonical = (text) => text
  ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
  : { type: "doc", content: [{ type: "paragraph" }] };

let warn, error;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { warn.mockRestore(); error.mockRestore(); });

let seq = 0;
/** Put a raw value straight into an adapter database's documents store. */
async function putRaw(dbName, id, value) {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction("documents", "readwrite");
    tx.objectStore("documents").put(value, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe("IndexedDB adapter: get()", () => {
  it("returns null ONLY for a genuine miss", async () => {
    const a = new IndexedDBStorageAdapter({ dbName: `a029-miss-${++seq}` });
    await a.isReady();
    expect(await a.get("nope")).toBeNull();
  });

  it("throws StorageReadError when the read itself fails", async () => {
    const a = new IndexedDBStorageAdapter({ dbName: `a029-fail-${++seq}` });
    await a.isReady();
    await a.save(createDocument({ id: "d", canonical: canonical("x") }));
    const real = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function () { throw new DOMException("gone", "InvalidStateError"); };
    try {
      const err = await a.get("d").catch((e) => e);
      expect(err).toBeInstanceOf(StorageReadError);
      expect(err.corrupt).toBe(false);
    } finally {
      IDBDatabase.prototype.transaction = real;
    }
  });

  it("throws a CORRUPT StorageReadError for a record that will not parse", async () => {
    const name = `a029-corrupt-${++seq}`;
    const a = new IndexedDBStorageAdapter({ dbName: name });
    await a.isReady();
    await putRaw(name, "bad", "{not json");
    const err = await a.get("bad").catch((e) => e);
    expect(err).toBeInstanceOf(StorageReadError);
    expect(err.corrupt).toBe(true);
  });
});

describe("localStorage adapter: get()", () => {
  afterEach(() => { localStorage.clear(); });

  it("null when absent, throws when corrupt", async () => {
    const a = new LocalStorageAdapter();
    expect(await a.get("nope")).toBeNull();
    localStorage.setItem("doc:bad", "{not json");
    const err = await a.get("bad").catch((e) => e);
    expect(err).toBeInstanceOf(StorageReadError);
    expect(err.corrupt).toBe(true);
  });

  it("throws when the storage refuses the read", async () => {
    const a = new LocalStorageAdapter();
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
    try {
      await expect(a.get("d")).rejects.toBeInstanceOf(StorageReadError);
    } finally { spy.mockRestore(); }
  });

  it("round-trips a real record", async () => {
    const a = new LocalStorageAdapter();
    await a.save(createDocument({ id: "ok", canonical: canonical("fine") }));
    expect(JSON.stringify((await a.get("ok")).canonical)).toContain("fine");
  });
});

describe("window.storage adapter: get()", () => {
  afterEach(() => { delete window.storage; });

  it("a present value that will not parse is a read error, not a miss", async () => {
    window.storage = { get: async () => ({ value: "{not json" }), set: async () => {}, delete: async () => {} };
    await expect(new WindowStorageAdapter().get("bad")).rejects.toBeInstanceOf(StorageReadError);
  });

  it("a rejected lookup stays a miss — the API rejects for absent keys", async () => {
    window.storage = { get: async () => { throw new Error("no such key"); }, set: async () => {}, delete: async () => {} };
    expect(await new WindowStorageAdapter().get("nope")).toBeNull();
  });
});

describe("the save path fails CLOSED on a failed read", () => {
  function setup(get) {
    const stored = createDocument({ id: "a", title: "A", canonical: canonical("stored text"), updated: "2026-01-01T00:00:00.000Z" });
    const adapter = {
      list: async () => [stored], get,
      save: vi.fn(async () => {}), delete: async () => {}, search: async () => [],
      getPrefs: async () => ({}), setPrefs: async () => {},
    };
    useDocumentStore.getState().initStorage(adapter);
    useDocumentStore.setState({
      activeDoc: { ...stored }, activeDocId: "a", hydratedDocId: "a",
      saveStatus: "editing", saveError: null, _unsavedEdits: new Map(), _draftBases: new Map(),
    });
    return adapter;
  }
  afterEach(() => { useDocumentStore.getState().setDirty(); });

  it("writes NOTHING when the stored copy cannot be read (it may be another tab's newer version)", async () => {
    const adapter = setup(async () => { throw new StorageReadError("storage did not answer"); });
    const committed = await useDocumentStore.getState().saveActiveDoc({ getJSON: () => canonical("my edit") });
    expect(committed).toBe(false);
    expect(adapter.save).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().saveStatus).toBe("error");   // retried, visibly
  });

  it("a CORRUPT stored record may be repaired by real content…", async () => {
    const adapter = setup(async () => { throw new StorageReadError("garbage", { corrupt: true }); });
    expect(await useDocumentStore.getState().saveActiveDoc({ getJSON: () => canonical("good content") })).toBe(true);
    expect(adapter.save).toHaveBeenCalledOnce();
  });

  it("…but never by a blank editor", async () => {
    const adapter = setup(async () => { throw new StorageReadError("garbage", { corrupt: true }); });
    expect(await useDocumentStore.getState().saveActiveDoc({ getJSON: () => canonical("") })).toBe(false);
    expect(adapter.save).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().saveStatus).toBe("blocked");
  });
});

describe("opening documents around an unreadable one", () => {
  it("switchToDoc stays on the current document when the target cannot be read", async () => {
    useDocumentStore.getState().initStorage({
      list: async () => [], get: async () => { throw new StorageReadError("nope"); },
      save: async () => {}, delete: async () => {}, search: async () => [],
      getPrefs: async () => ({}), setPrefs: async () => {},
    });
    useDocumentStore.setState({ activeDocId: "a", hydratedDocId: "a", saveStatus: "editing", saveError: "keep me" });
    expect(await useDocumentStore.getState().switchToDoc("broken", null)).toBeNull();
    const s = useDocumentStore.getState();
    expect(s.activeDocId).toBe("a");
    expect(s.hydratedDocId).toBe("a");
    expect(s.saveStatus).toBe("editing");
    expect(s.saveError).toBe("keep me");
  });

  it("boot skips a document it cannot read and opens the next one", async () => {
    vi.resetModules();
    const { useDocumentStore: fresh } = await import("../store/documents/documentStore");
    const good = createDocument({ id: "good", canonical: canonical("readable") });
    fresh.getState().initStorage({
      list: async () => [{ id: "broken", updated: "", title: "" }, { id: "good", updated: "", title: "" }],
      get: async (id) => { if (id === "broken") throw new StorageReadError("x", { corrupt: true }); return JSON.parse(serializeForStorage(good)); },
      save: async () => {}, delete: async () => {}, search: async () => [],
      getPrefs: async () => ({ lastActiveDocId: "broken" }), setPrefs: async () => {},
    });
    const rec = await fresh.getState().initialize();
    expect(rec.id).toBe("good");
  });
});
