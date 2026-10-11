/**
 * A save or rename must retire only the draft whose content it actually wrote.
 * Clearing unconditionally after the `await storage.list()` deleted newer
 * typing cached by a switch during that window — the only recovery copy when
 * the later leave-save then failed.
 *
 * Found by the external code review recorded in docs/backlog.md (its F002).
 * Harness: the real store must not retire content it did not persist. Reverting
 * either cleanup guard makes its delayed save/rename erase v2 after a failed
 * leave-save; reopening A then returns v1. Deferred promises select the exact
 * interleaving; there is no timing sleep or source-text assertion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "../store/documents/documentStore";
import { createDocument } from "../store/documents/document";

vi.mock("../store/history/snapshot-store", () => ({
  snapshotStore: { maybeRecordOnSave: vi.fn(), record: vi.fn(async () => null) },
}));
const canonical = (text) => ({ type: "doc", content: [
  { type: "paragraph", content: [{ type: "text", text }] },
] });
const clone = (v) => JSON.parse(JSON.stringify(v));
const at = "2026-01-01T00:00:00.000Z";
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const a = createDocument({ id: "a", title: "A", canonical: canonical("v0"), updated: at });
  const b = createDocument({ id: "b", title: "B", canonical: canonical("B"), updated: at });
  const records = new Map([["a", clone(a)], ["b", clone(b)]]);
  const enteredList = deferred();
  const releaseList = deferred();
  let lists = 0;
  const adapter = {
    initialize: async () => {},
    get: async (id) => records.has(id) ? clone(records.get(id)) : null,
    list: async () => {
      if (++lists === 1) { enteredList.resolve(); await releaseList.promise; }
      return [...records.values()].map(clone);
    },
    save: vi.fn(async (doc) => { records.set(doc.id, clone(doc)); }),
    delete: async (id) => { records.delete(id); },
    getPrefs: async () => ({}), setPrefs: async () => {},
  };
  const store = useDocumentStore.getState();
  store.initStorage(adapter);
  store.registerLiveCanonical((id) => id === "a" ? canonical("v1") : null);
  useDocumentStore.setState({
    activeDoc: clone(a), activeDocId: "a", hydratedDocId: "a", saveStatus: "editing",
    saveError: null, documents: [a, b], _unsavedEdits: new Map(),
    openTabs: [{ id: "a", title: "A" }, { id: "b", title: "B" }],
  });
  return { records, adapter, enteredList, releaseList };
}
function start(kind) {
  const s = useDocumentStore.getState();
  return kind === "save"
    ? s.saveActiveDoc({ getJSON: () => canonical("v1") })
    : s.renameDoc("a", "Renamed");
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(at)); });
afterEach(() => {
  useDocumentStore.getState().setDirty();
  useDocumentStore.getState().registerLiveCanonical(null);
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

describe.each(["save", "rename"])("F002: delayed %s completion", (kind) => {
  it("retains the newer draft when the later leave-save fails", async () => {
    const f = fixture();
    const older = start(kind);
    await f.enteredList.promise; // v1 was written; its completion still awaits list()
    const s = useDocumentStore.getState();
    s.setDirty();
    // This is the real lifecycle's flushAndCacheIfDirty boundary on departure.
    s.cacheUnsavedEdit("a", canonical("v2"));
    f.adapter.save.mockRejectedValueOnce(new Error("later leave-save failed"));
    await s.saveActiveDoc({ getJSON: () => canonical("v2") });
    expect(useDocumentStore.getState().saveStatus).toBe("error");
    const b = await s.switchToDoc("b", null);
    s.markHydrated(b.id); // the hook has hydrated B; its pane is no longer a copy of v2
    try {
      f.releaseList.resolve();
      await older;
      expect(useDocumentStore.getState().getUnsavedEdit("a")).toEqual(canonical("v2"));
      expect(f.records.get("a").canonical).toEqual(canonical("v1"));
      const reopened = await s.switchToDoc("a", null);
      expect(reopened.canonical).toEqual(canonical("v2"));
    } finally { f.releaseList.resolve(); await older; }
  });

  it("still retires a draft whose content is exactly what this write saved", async () => {
    const f = fixture();
    useDocumentStore.getState().cacheUnsavedEdit("a", canonical("v1"));
    const write = start(kind);
    await f.enteredList.promise;
    f.releaseList.resolve();
    await write;
    expect(useDocumentStore.getState().getUnsavedEdit("a")).toBeUndefined();
    expect(f.records.get("a").canonical).toEqual(canonical("v1"));
  });
});
