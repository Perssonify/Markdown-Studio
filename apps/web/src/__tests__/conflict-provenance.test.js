/**
 * A cached draft carries the revision it was written against. Without that,
 * switching away and back re-based it onto whatever another tab had written,
 * so a conflict the guard had already refused went through on the next save.
 *
 * Found by the external code review recorded in docs/backlog.md (its F003).
 * Harness: deliberately RED until the unpatched draft-provenance finding is fixed.
 * The first assertion proves the existing >2s guard works. The second save,
 * after leaving and reactivating the cached draft, must still reject. At
 * 2e29275 it resolves and overwrites the remote canonical instead. Do not mark
 * this it.fails/skip: it is the acceptance test for the eventual fix.
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

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(at)); });
afterEach(() => {
  useDocumentStore.getState().setDirty();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

describe("F003: a conflict belongs to the dirty document, not the selected tab", () => {
  it("does not silently rebase a rejected draft by switching away and back", async () => {
    const a = createDocument({ id: "a", title: "A", canonical: canonical("base"), updated: at });
    const b = createDocument({ id: "b", title: "B", canonical: canonical("B"), updated: at });
    const remote = { ...clone(a), canonical: canonical("remote work"), updated: "2026-01-01T00:00:10.000Z" };
    const records = new Map([["a", remote], ["b", b]]);
    const save = vi.fn(async (doc) => { records.set(doc.id, clone(doc)); });
    const s = useDocumentStore.getState();
    s.initStorage({
      initialize: async () => {},
      get: async (id) => records.has(id) ? clone(records.get(id)) : null,
      list: async () => [...records.values()].map(clone), save,
      delete: async (id) => { records.delete(id); },
      getPrefs: async () => ({}), setPrefs: async () => {},
    });
    s.registerLiveCanonical(null);
    useDocumentStore.setState({
      activeDoc: clone(a), activeDocId: "a", hydratedDocId: "a", saveStatus: "editing",
      saveError: null, documents: [a, b], _unsavedEdits: new Map(),
      openTabs: [{ id: "a", title: "A" }, { id: "b", title: "B" }],
    });
    const local = canonical("local draft");
    const editor = { getJSON: () => clone(local) };
    // A genuine conflict already exists before navigation. This is not a
    // demand for atomic concurrent writes or a change to the 2-second tolerance.
    await expect(s.saveActiveDoc(editor)).rejects.toThrow(/changed in another tab/i);
    expect(save).not.toHaveBeenCalled();
    s.cacheUnsavedEdit("a", clone(local)); // actual lifecycle's departure boundary
    await s.switchToDoc("b", null);
    s.markHydrated("b");
    const reopened = await s.switchToDoc("a", null);
    expect(reopened.canonical).toEqual(local);
    s.markHydrated("a");
    await expect(s.saveActiveDoc(editor)).rejects.toThrow(/changed in another tab/i);
    expect(save).not.toHaveBeenCalled();
    expect(records.get("a").canonical).toEqual(canonical("remote work"));
  });
});
