import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndexedDBStorageAdapter, StorageQuotaError, utf8Bytes } from "../store/idb-storage-adapter";
import { useDocumentStore } from "../store/documentStore";
import { createDocument } from "../store/document";

/**
 * A086 — the storage ceiling is the browser's, measured in real bytes, and a
 * full store is a clear, TERMINAL state rather than an endless retry.
 *
 * Reproduced by the audit: a self-imposed 50 MB cap counted characters × 2 and
 * ignored the snapshot database, so saves stopped at ~18 MB of real markdown
 * while the browser had room to spare — and at the cap the status bar read
 * "Save failed — retrying" indefinitely with no way to free space.
 */

vi.mock("../store/snapshot-store", () => ({
  snapshotStore: { maybeRecordOnSave: vi.fn(), record: vi.fn(async () => null) },
}));

const canonical = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
let seq = 0;
const fresh = (opts = {}) => new IndexedDBStorageAdapter({ dbName: `a086-${++seq}`, ...opts });

let warn;
beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => {
  warn.mockRestore();
  delete globalThis.navigator.storage;
});

describe("utf8Bytes", () => {
  it("counts real UTF-8 bytes, not UTF-16 code units × 2", () => {
    expect(utf8Bytes("hello")).toBe(5);                  // was 10
    expect(utf8Bytes("é")).toBe(2);
    expect(utf8Bytes("€")).toBe(3);
    expect(utf8Bytes("😀")).toBe(4);                      // a surrogate pair
    expect(utf8Bytes("a".repeat(1000))).toBe(new TextEncoder().encode("a".repeat(1000)).length);
  });
});

describe("the default limit is the browser's quota, not 50 MB", () => {
  it("saves far more than the old self-imposed ceiling would have allowed", async () => {
    // 30 MB of markdown: the old cap (50 MB of characters × 2) refused this.
    const a = fresh();
    await a.isReady();
    const big = createDocument({ id: "big", canonical: canonical("x".repeat(30 * 1024 * 1024)) });
    await expect(a.save(big)).resolves.toBeUndefined();
    expect(a.getMetrics().docCount).toBe(1);
  });

  it("has no self-imposed cap: an ordinary save does not walk the library to check one", async () => {
    // The cursor walk exists only to enforce a HOST-configured cap inside the
    // write transaction. A default cap would bring it back on every autosave.
    const a = fresh();
    await a.isReady();
    await a.save(createDocument({ id: "one", canonical: canonical("first") }));
    const open = vi.spyOn(IDBObjectStore.prototype, "openCursor");
    try {
      await a.save(createDocument({ id: "two", canonical: canonical("second") }));
      expect(open).not.toHaveBeenCalled();
    } finally { open.mockRestore(); }
    expect(a.getMetrics().docCount).toBe(2);
  });

  it("reports the origin's usage against its quota when the browser offers an estimate", async () => {
    globalThis.navigator.storage = { estimate: vi.fn(async () => ({ usage: 600, quota: 1000 })) };
    const a = fresh();
    await a.isReady();
    const m = a.getMetrics();
    expect(m).toMatchObject({ usedBytes: 600, maxBytes: 1000, pct: 60, available: 400, limitKnown: true });
  });

  it("says the limit is unknown, rather than inventing one, when there is no estimate", async () => {
    const a = fresh();
    await a.isReady();
    await a.save(createDocument({ id: "d", canonical: canonical("abc") }));
    const m = a.getMetrics();
    expect(m.limitKnown).toBe(false);
    expect(m.maxBytes).toBe(0);
    expect(m.pct).toBe(0);
  });

  it("a host's explicit cap is still enforced, in real bytes", async () => {
    const a = fresh({ maxBytes: 5000 });
    await a.isReady();
    await expect(a.save(createDocument({ id: "d", canonical: canonical("x".repeat(20000)) }))).rejects.toBeInstanceOf(StorageQuotaError);
    expect(await a.get("d")).toBeNull();
  });
});

describe("the browser refusing a write surfaces as StorageQuotaError", () => {
  it("translates QuotaExceededError", async () => {
    const a = fresh();
    await a.isReady();
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException("full", "QuotaExceededError"); };
    try {
      await expect(a.save(createDocument({ id: "d", canonical: canonical("x") }))).rejects.toBeInstanceOf(StorageQuotaError);
    } finally {
      IDBObjectStore.prototype.put = put;
    }
  });
});

describe("a full store is a terminal state, and freeing space retries", () => {
  function setup(save) {
    const stored = createDocument({ id: "a", title: "A", canonical: canonical("stored"), updated: "2026-01-01T00:00:00.000Z" });
    const records = { a: stored, b: createDocument({ id: "b", title: "B", canonical: canonical("b") }) };
    useDocumentStore.getState().initStorage({
      list: async () => Object.values(records), get: async (id) => (records[id] ? { ...records[id] } : null),
      save, delete: async (id) => { delete records[id]; }, search: async () => [],
      getPrefs: async () => ({}), setPrefs: async () => {},
    });
    useDocumentStore.setState({
      activeDoc: { ...stored }, activeDocId: "a", hydratedDocId: "a", openTabs: [{ id: "a", title: "A" }],
      saveStatus: "editing", saveError: null, _unsavedEdits: new Map(), _draftBases: new Map(),
    });
  }
  afterEach(() => { useDocumentStore.getState().setDirty(); });

  it("parks 'full' — no transient error that re-arms autosave", async () => {
    vi.useFakeTimers();
    try {
      setup(async () => { throw new StorageQuotaError(10, 10, 5); });
      await expect(useDocumentStore.getState().saveActiveDoc({ getJSON: () => canonical("new") }))
        .rejects.toBeInstanceOf(StorageQuotaError);
      expect(useDocumentStore.getState().saveStatus).toBe("full");
      vi.advanceTimersByTime(10_000);                                  // the old error→editing re-arm
      expect(useDocumentStore.getState().saveStatus).toBe("full");     // still parked
    } finally { vi.useRealTimers(); }
  });

  it("deleting another document frees space and resumes saving", async () => {
    setup(async () => { throw new StorageQuotaError(10, 10, 5); });
    await useDocumentStore.getState().saveActiveDoc({ getJSON: () => canonical("new") }).catch(() => {});
    expect(useDocumentStore.getState().saveStatus).toBe("full");
    await useDocumentStore.getState().deleteDoc("b", null);
    expect(useDocumentStore.getState().saveStatus).toBe("editing");   // autosave re-arms
  });
});
