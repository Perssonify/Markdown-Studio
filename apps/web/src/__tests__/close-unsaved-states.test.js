/**
 * Closing the active document must prompt for EVERY unsaved state, not just
 * `editing`. `conflict` and `blocked` are TERMINAL, and ordinary typing caches
 * no draft, so the old `saveStatus === "editing"` gate discarded live content
 * with no prompt. A resolved `saveActiveDoc` is also not proof of a commit.
 *
 * Found by the external code review recorded in docs/backlog.md (its F001).
 * Harness: exercise the real close lifecycle and store, with only editor/storage
 * boundaries replaced. Reverting the fix closes A (and hydrates B) without
 * asking in non-"editing" dirty states, or closes after a resolved failed save.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentLifecycle } from "../hooks/useDocumentLifecycle";
import { useDocumentStore } from "../store/documentStore";
import { createDocument } from "../store/document";

vi.mock("../store/snapshot-store", () => ({
  snapshotStore: { maybeRecordOnSave: vi.fn(), record: vi.fn(async () => null) },
}));
const canonical = (text) => ({ type: "doc", content: [
  { type: "paragraph", content: [{ type: "text", text }] },
] });
const clone = (v) => JSON.parse(JSON.stringify(v));
const at = "2026-01-01T00:00:00.000Z";

function fixture(status = "editing", choice = "cancel") {
  const a = createDocument({ id: "a", title: "A", canonical: canonical("disk A"), updated: at });
  const b = createDocument({ id: "b", title: "B", canonical: canonical("disk B"), updated: at });
  const records = new Map([["a", clone(a)], ["b", clone(b)]]);
  const adapter = {
    initialize: async () => {},
    get: vi.fn(async (id) => records.has(id) ? clone(records.get(id)) : null),
    list: async () => [...records.values()].map(clone),
    save: vi.fn(async (doc) => { records.set(doc.id, clone(doc)); }),
    delete: async (id) => { records.delete(id); },
    getPrefs: async () => ({}), setPrefs: async () => {},
  };
  const store = useDocumentStore.getState();
  store.initStorage(adapter);
  store.registerLiveCanonical(null);
  useDocumentStore.setState({
    activeDoc: clone(a), activeDocId: "a", hydratedDocId: "a",
    openTabs: [{ id: "a", title: "A" }, { id: "b", title: "B" }],
    documents: [a, b], saveStatus: status, saveError: null, _unsavedEdits: new Map(),
  });
  let live = status === "ready" ? clone(a.canonical) : canonical("unsaved A");
  const editor = { getJSON: () => clone(live) };
  const closeTab = vi.fn((...args) => useDocumentStore.getState().closeTab(...args));
  const params = {
    tiptapRef: { current: { getEditor: () => editor, endComposition: vi.fn(), resetHistory: vi.fn() } },
    cmRef: { current: { endComposition: vi.fn(), resetHistory: vi.fn(), getValue: () => "" } },
    engine: {}, syncMdToHtml: vi.fn(() => true), syncHtmlToMd: vi.fn(() => true),
    forceSyncMdToHtml: vi.fn(), forceSyncHtmlToMd: vi.fn(), resetHashes: vi.fn(),
    setCanonical: vi.fn((value) => { live = clone(value); }), setFromHtml: vi.fn(),
    switchToDoc: (...args) => useDocumentStore.getState().switchToDoc(...args), closeTab,
    createDoc: vi.fn(), deleteDoc: vi.fn(), finalizeDoc: vi.fn(), revertActiveDoc: vi.fn(),
    saveActiveDoc: (e) => useDocumentStore.getState().saveActiveDoc(e),
    setDirty: () => useDocumentStore.getState().setDirty(), handleCanonicalChange: vi.fn(),
    pasteStyled: true, setPasteStyled: vi.fn(), syncMode: "styled", setSyncMode: vi.fn(),
    toast: { show: vi.fn() }, confirm: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => choice),
  };
  const hook = renderHook(() => useDocumentLifecycle(params));
  return { ...hook, params, adapter, records, editor, live: () => live };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(at)); });
afterEach(() => {
  cleanup();
  useDocumentStore.getState().setDirty(); // cancel the store's status-reset timer
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

describe("F001: closing must not equate a save status with clean content", () => {
  it.each(["editing", "saving", "error", "conflict", "blocked"])(
    "offers Cancel for active %s content even without a cached draft", async (status) => {
      const f = fixture(status);
      expect(useDocumentStore.getState().getUnsavedEdit("a")).toBeUndefined();
      await act(async () => { await f.result.current.handleCloseTab("a"); });
      expect(f.params.confirmUnsaved).toHaveBeenCalledOnce();
      expect(f.params.closeTab).not.toHaveBeenCalled();
      expect(useDocumentStore.getState().activeDocId).toBe("a");
      expect(f.live()).toEqual(canonical("unsaved A"));
    }
  );

  it("keeps A open when Save resolves after a non-quota storage failure", async () => {
    const f = fixture("editing", "save");
    f.adapter.save.mockRejectedValueOnce(new Error("write failed"));
    await act(async () => { await f.result.current.handleCloseTab("a"); });
    expect(f.adapter.save).toHaveBeenCalledOnce();
    expect(useDocumentStore.getState().saveStatus).toBe("error");
    expect(f.params.closeTab).not.toHaveBeenCalled();
    expect(f.records.get("a").canonical).toEqual(canonical("disk A"));
    expect(f.live()).toEqual(canonical("unsaved A"));
  });

  it("keeps A open when the editor disappears before the requested save", async () => {
    const f = fixture("editing", "save");
    f.params.tiptapRef.current = null;
    await act(async () => { await f.result.current.handleCloseTab("a"); });
    expect(f.params.closeTab).not.toHaveBeenCalled();
    expect(f.adapter.save).not.toHaveBeenCalled();
  });

  it("does not apply a dialog's Save choice to a document switched to meanwhile", async () => {
    const f = fixture("editing", "save");
    let answer;
    f.params.confirmUnsaved.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    let closing;
    act(() => { closing = f.result.current.handleCloseTab("a"); });
    await act(async () => { await f.result.current.handleSwitchDoc("b"); });
    f.adapter.save.mockClear();
    await act(async () => { answer("save"); await closing; });
    expect(f.adapter.save).not.toHaveBeenCalled();
    expect(f.params.closeTab).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().activeDocId).toBe("b");
  });

  it("still closes after a successful save, and hydrates B", async () => {
    const f = fixture("editing", "save");
    await act(async () => { await f.result.current.handleCloseTab("a"); });
    expect(f.records.get("a").canonical).toEqual(canonical("unsaved A"));
    expect(f.params.closeTab).toHaveBeenCalledOnce();
    expect(useDocumentStore.getState().hydratedDocId).toBe("b");
    expect(f.live()).toEqual(canonical("disk B"));
  });

  it("still closes a clean tab without a prompt", async () => {
    const f = fixture("ready");
    await act(async () => { await f.result.current.handleCloseTab("a"); });
    expect(f.params.confirmUnsaved).not.toHaveBeenCalled();
    expect(f.params.closeTab).toHaveBeenCalledOnce();
  });
});
