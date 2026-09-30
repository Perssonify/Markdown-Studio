/**
 * Live sync between tabs — the document store's half.
 *
 *  - Every COMMITTED write tells the other tabs, and only a committed one:
 *    after the adapter resolved, never for a refused write.
 *  - What other tabs announce reaches the save guard: a write another tab made
 *    inside the drift check's 2s tolerance used to be overwritten silently.
 *  - A document another tab DELETED is never written back by this one.
 *  - The small actions the hook uses: refresh the listing, take a stored
 *    revision, consent to overwrite one, park a conflict.
 *
 * "Another tab" is a direct write to the shared records plus the message that
 * tab would have sent (delivered through a fake transport).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConflictError,
  clearLocalData,
  describeUncommittedSave,
  isOvertaken,
  useDocumentStore,
} from "../store/documentStore";
import { createDocument } from "../store/document";
import { _resetTabSyncForTests, markDeletedElsewhere, startTabSync } from "../store/tab-sync";
import { snapshotStore } from "../store/snapshot-store";

vi.mock("../store/snapshot-store", () => ({
  snapshotStore: {
    maybeRecordOnSave: vi.fn(),
    record: vi.fn(async () => {}),
    clearAll: vi.fn(async () => {}),
    deleteForDoc: vi.fn(async () => {}),
    isEnabled: () => true,
  },
}));

const canonical = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const text = (c) => JSON.stringify(c);
const clone = (v) => JSON.parse(JSON.stringify(v));
const T0 = "2026-01-01T00:00:00.000Z";
const NOW = "2026-01-01T00:01:00.000Z";

let records, adapter, posted, deliver, editor, saveGate;

function setup() {
  records = new Map();
  for (const id of ["x", "y"]) {
    records.set(id, clone(createDocument({ id, title: id.toUpperCase(), canonical: canonical(`${id} original`), updated: T0 })));
  }
  saveGate = null;
  adapter = {
    list: async () => [...records.values()].map((d) => ({ id: d.id, title: d.title, updated: d.updated })),
    get: async (id) => (records.has(id) ? createDocument(clone(records.get(id))) : null),
    save: vi.fn(async (d) => {
      if (saveGate) await saveGate;
      if (d._preserveUpdated) delete d._preserveUpdated;
      else d.updated = new Date().toISOString();
      records.set(d.id, clone(d));
    }),
    delete: async (id) => { records.delete(id); },
    search: async () => [], getPrefs: async () => ({}), setPrefs: async () => {},
  };
  const store = useDocumentStore.getState();
  store.initStorage(adapter);
  posted = [];
  _resetTabSyncForTests({
    channel: "pf-tab-sync:test",
    factory: (_name, onMessage) => {
      deliver = onMessage;
      return { post: (m) => posted.push(...m.events), close: () => {} };
    },
  });
  startTabSync(() => {});
  editor = { json: canonical("this tab's edit"), getJSON() { return this.json; } };
  store.registerLiveCanonical((id) => (id === "x" ? editor.json : null));
  useDocumentStore.setState({
    activeDoc: createDocument(clone(records.get("x"))), activeDocId: "x", hydratedDocId: "x",
    openTabs: [{ id: "x", title: "X" }], saveStatus: "editing", saveError: null,
    _unsavedEdits: new Map(), _draftBases: new Map(), documents: [],
  });
}
const settle = () => new Promise((r) => setTimeout(r, 0));
/** Another tab writes `id` at `at` and — unless `silent` — says so. */
function otherTabWrites(id, body, at, { silent = false } = {}) {
  records.set(id, { ...records.get(id), canonical: canonical(body), updated: at });
  if (!silent) deliver({ v: 1, from: "other-tab", events: [{ type: "doc", id, updated: at }] });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  vi.mocked(snapshotStore.record).mockClear();
  setup();
});
afterEach(() => {
  useDocumentStore.getState().registerLiveCanonical(null);
  _resetTabSyncForTests({ channel: null });
  vi.useRealTimers();
});

describe("every committed write is announced — and only a committed one", () => {
  it("a save announces the revision it wrote", async () => {
    expect(await useDocumentStore.getState().saveActiveDoc(editor)).toBe(true);
    await settle();
    expect(posted).toEqual([{ type: "doc", id: "x", updated: records.get("x").updated }]);
  });

  it("not before the write resolves", async () => {
    let open;
    saveGate = new Promise((r) => { open = r; });
    const saving = useDocumentStore.getState().saveActiveDoc(editor);
    await settle(); await settle();
    expect(posted).toEqual([]); // the adapter has not committed yet
    open();
    await saving;
    await settle();
    expect(posted.map((e) => e.type)).toEqual(["doc"]);
  });

  it("a refused save announces nothing: conflict, blank over content, ownership", async () => {
    // Conflict: another tab wrote 30s later.
    records.set("x", { ...records.get("x"), updated: "2026-01-01T00:00:30.000Z" });
    await expect(useDocumentStore.getState().saveActiveDoc(editor)).rejects.toBeInstanceOf(ConflictError);
    await settle();
    expect(posted).toEqual([]);
    // Blank over content.
    setup();
    editor.json = { type: "doc", content: [{ type: "paragraph" }] };
    expect(await useDocumentStore.getState().saveActiveDoc(editor)).toBe(false);
    expect(useDocumentStore.getState().saveStatus).toBe("blocked");
    await settle();
    expect(posted).toEqual([]);
    // The editor does not hold the active document.
    setup();
    useDocumentStore.setState({ hydratedDocId: null });
    await expect(useDocumentStore.getState().saveActiveDoc(editor)).rejects.toThrow();
    await settle();
    expect(posted).toEqual([]);
  });

  it("rename, patch, metadata patch, duplicate, import, create and delete all announce", async () => {
    const s = useDocumentStore.getState();
    await s.renameDoc("y", "Why");
    await s.patchDocById("y", { canonical: canonical("patched") });
    await s.patchDocById("y", { metadata: { cardPinned: true }, touchUpdated: false });
    const dup = await s.duplicateDoc("y");
    const imported = createDocument({ id: "imp", title: "Imported", canonical: canonical("imported") });
    await s.saveNewDoc(imported);
    const created = createDocument({ id: "new", title: "New", canonical: canonical("new") });
    await s.finalizeDoc(created, null, false);
    await s.finalizeDoc(createDocument({ id: "session", canonical: canonical("s") }), null, true); // not persisted
    await s.deleteDoc("imp", null);
    await settle();
    const y = records.get("y");
    expect(posted).toEqual([
      { type: "doc", id: "y", updated: expect.any(String) },
      { type: "doc", id: "y", updated: expect.any(String) },
      // `updated` did not move: `meta` tells the receiver to re-read metadata.
      { type: "doc", id: "y", updated: y.updated, meta: true },
      { type: "doc", id: dup.id, updated: records.get(dup.id).updated },
      { type: "doc", id: "imp", updated: expect.any(String) },
      { type: "doc", id: "new", updated: records.get("new").updated },
      { type: "deleted", id: "imp" },
    ]);
    expect(records.has("session")).toBe(false);
  });

  it("a delete is announced only once the record is gone", async () => {
    const seen = [];
    _resetTabSyncForTests({
      channel: "pf-tab-sync:test",
      factory: () => ({ post: (m) => seen.push(m.events.map((e) => [e.type, records.has(e.id)])), close: () => {} }),
    });
    startTabSync(() => {});
    await useDocumentStore.getState().deleteDoc("y", null);
    await settle();
    expect(seen).toEqual([[["deleted", false]]]);
  });

  it("a refused content patch announces nothing", async () => {
    otherTabWrites("x", "their work", "2026-01-01T00:00:30.000Z", { silent: true });
    await expect(useDocumentStore.getState().patchDocById("x", { canonical: canonical("mine") })).rejects.toBeInstanceOf(ConflictError);
    await settle();
    expect(posted).toEqual([]);
  });

  it("erasing everything tells the other tabs", async () => {
    await clearLocalData();
    await settle();
    expect(posted).toEqual([{ type: "cleared" }]);
  });
});

describe("what other tabs announce reaches the save guard", () => {
  // 400ms after this tab's base: inside the drift check's 2s tolerance.
  const CLOSE = "2026-01-01T00:00:00.400Z";

  it("a write another tab ANNOUNCED is never overwritten, however close in time", async () => {
    otherTabWrites("x", "their work", CLOSE);
    await expect(useDocumentStore.getState().saveActiveDoc(editor)).rejects.toBeInstanceOf(ConflictError);
    expect(text(records.get("x").canonical)).toContain("their work");
    expect(useDocumentStore.getState().saveStatus).toBe("conflict");
    expect(isOvertaken("x", CLOSE, T0)).toBe(true);
  });

  it("[control] the same write, unannounced, is what the tolerance let through", async () => {
    otherTabWrites("x", "their work", CLOSE, { silent: true });
    expect(await useDocumentStore.getState().saveActiveDoc(editor)).toBe(true);
    expect(text(records.get("x").canonical)).toContain("this tab's edit");
  });

  it("covers a content patch too (a card saved from a stale copy)", async () => {
    otherTabWrites("y", "their y", CLOSE);
    await expect(
      useDocumentStore.getState().patchDocById("y", { canonical: canonical("card edit"), expectedUpdated: T0 })
    ).rejects.toBeInstanceOf(ConflictError);
    expect(text(records.get("y").canonical)).toContain("their y");
  });
});

describe("a document deleted in another tab is never written back", () => {
  it("the save is refused, terminal, and what this tab held is kept in Version history", async () => {
    records.delete("x");
    markDeletedElsewhere("x");
    expect(await useDocumentStore.getState().saveActiveDoc(editor)).toBe(false);
    expect(records.has("x")).toBe(false);
    const s = useDocumentStore.getState();
    expect(s.saveStatus).toBe("conflict");
    expect(s.saveError).toBe("Deleted in another tab");
    expect(snapshotStore.record).toHaveBeenCalledWith("x", "X", editor.json, "pre-delete");
    expect(describeUncommittedSave(s).message).toMatch(/deleted in another tab/);
    await settle();
    expect(posted).toEqual([]);
  });

  it("[control] without the mark, the same save resurrects it — the defect this closes", async () => {
    records.delete("x");
    expect(await useDocumentStore.getState().saveActiveDoc(editor)).toBe(true);
    expect(records.has("x")).toBe(true);
  });

  it("a document brought back under the same id saves normally", async () => {
    markDeletedElsewhere("x");
    expect(await useDocumentStore.getState().saveActiveDoc(editor)).toBe(true);
    expect(text(records.get("x").canonical)).toContain("this tab's edit");
  });
});

describe("the actions live sync uses", () => {
  it("refreshLibrary publishes only a listing that changed", async () => {
    const s = useDocumentStore.getState();
    await s.refreshLibrary();
    const first = useDocumentStore.getState().documents;
    expect(first.map((d) => d.id)).toEqual(["x", "y"]);
    await s.refreshLibrary();
    expect(useDocumentStore.getState().documents).toBe(first); // same content: same reference
    records.delete("y");
    await s.refreshLibrary();
    expect(useDocumentStore.getState().documents.map((d) => d.id)).toEqual(["x"]);
  });

  it("adoptStoredRevision takes the stored record as the base, clean", async () => {
    useDocumentStore.getState().cacheUnsavedEdit("x", canonical("a stale draft"));
    otherTabWrites("x", "their work", "2026-01-01T00:00:30.000Z");
    const rec = await adapter.get("x");
    useDocumentStore.getState().adoptStoredRevision(rec);
    const s = useDocumentStore.getState();
    expect(s.activeDoc.updated).toBe("2026-01-01T00:00:30.000Z");
    expect(text(s.activeDoc.canonical)).toContain("their work");
    expect(s.saveStatus).toBe("ready");
    expect(s.getUnsavedEdit("x")).toBeUndefined();
    // …so the next save is based on it, and goes through.
    editor.json = canonical("their work, then mine");
    expect(await s.saveActiveDoc(editor)).toBe(true);
  });

  it("adoptStoredRevision leaves a different open document alone", () => {
    const before = useDocumentStore.getState().activeDoc;
    useDocumentStore.getState().adoptStoredRevision(createDocument({ id: "y", canonical: canonical("y") }));
    expect(useDocumentStore.getState().activeDoc).toBe(before);
  });

  it("consentToRevision lets exactly that overwrite through — Keep mine", async () => {
    otherTabWrites("x", "their work", "2026-01-01T00:00:30.000Z");
    await expect(useDocumentStore.getState().saveActiveDoc(editor)).rejects.toBeInstanceOf(ConflictError);
    useDocumentStore.getState()._draftBases.set("x", T0);
    useDocumentStore.getState().consentToRevision("x", "2026-01-01T00:00:30.000Z");
    expect(useDocumentStore.getState()._draftBases.get("x")).toBe("2026-01-01T00:00:30.000Z");
    expect(await useDocumentStore.getState().saveActiveDoc(editor)).toBe(true);
    expect(text(records.get("x").canonical)).toContain("this tab's edit");
  });

  it("consent to one revision is not consent to the next", async () => {
    otherTabWrites("x", "their work", "2026-01-01T00:00:30.000Z");
    useDocumentStore.getState().consentToRevision("x", "2026-01-01T00:00:30.000Z");
    otherTabWrites("x", "their newer work", "2026-01-01T00:00:30.500Z");
    await expect(useDocumentStore.getState().saveActiveDoc(editor)).rejects.toBeInstanceOf(ConflictError);
    expect(text(records.get("x").canonical)).toContain("their newer work");
  });

  it("markConflict parks the terminal status for the open document only", () => {
    const s = useDocumentStore.getState();
    s.markConflict("y", "changed");
    expect(useDocumentStore.getState().saveStatus).toBe("editing");
    s.markConflict("x", "changed");
    expect(useDocumentStore.getState()).toMatchObject({ saveStatus: "conflict", saveError: "Changed in another tab" });
    s.markConflict("x", "deleted");
    expect(useDocumentStore.getState().saveError).toBe("Deleted in another tab");
  });

  it("adoptStoredMetadata takes a pin another tab set, so this tab's save keeps it", async () => {
    await useDocumentStore.getState().refreshLibrary();
    records.set("x", { ...records.get("x"), metadata: { cardPinned: true } });
    useDocumentStore.getState().adoptStoredMetadata("x", { cardPinned: true });
    expect(await useDocumentStore.getState().saveActiveDoc(editor)).toBe(true);
    expect(records.get("x").metadata.cardPinned).toBe(true);
  });
});
