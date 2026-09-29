/**
 * A028 — rename, card pin/colour and bridge patches must respect the same
 * multi-tab conflict saveActiveDoc does.
 *
 * `renameDoc` and `patchDocById` merged this tab's LIVE editor content into
 * the record and saved it with no drift check, so a rename (or a host's title
 * patch) in a tab another tab had overtaken replaced that tab's work. Worse,
 * `touchUpdated: false` (a card's pin or colour) persisted the new content
 * UNDER THE OLD TIMESTAMP: the other tab's own guard then saw nothing, and the
 * two tabs ping-ponged last-writer-wins.
 *
 * "Another tab" here is a direct write to the shared records with a newer
 * `updated`, which is all a second tab is from this tab's point of view.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, useDocumentStore } from "../store/documentStore";
import { createDocument } from "../store/document";

vi.mock("../store/snapshot-store", () => ({
  snapshotStore: { maybeRecordOnSave: vi.fn(), record: vi.fn(async () => null) },
}));

const canonical = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const text = (c) => JSON.stringify(c);
const T0 = "2026-01-01T00:00:00.000Z";
const T_OTHER = "2026-01-01T00:00:30.000Z";   // the other tab's write, 30s later
const clone = (v) => JSON.parse(JSON.stringify(v));

let records, adapter;
function setup() {
  const x = createDocument({ id: "x", title: "X", canonical: canonical("x original"), updated: T0 });
  const y = createDocument({ id: "y", title: "Y", canonical: canonical("y original"), updated: T0 });
  records = new Map([["x", clone(x)], ["y", clone(y)]]);
  adapter = {
    list: async () => [...records.values()].map(clone),
    get: async (id) => (records.has(id) ? createDocument(clone(records.get(id))) : null),
    save: vi.fn(async (d) => {
      const copy = clone(d);
      if (d._preserveUpdated) delete copy._preserveUpdated;
      else copy.updated = new Date().toISOString();
      delete d._preserveUpdated;
      records.set(d.id, copy);
    }),
    delete: async (id) => { records.delete(id); },
    search: async () => [], getPrefs: async () => ({}), setPrefs: async () => {},
  };
  const store = useDocumentStore.getState();
  store.initStorage(adapter);
  // The open document in THIS tab: x, based on T0, with unsaved live edits.
  store.registerLiveCanonical((id) => (id === "x" ? canonical("this tab's live edit") : null));
  useDocumentStore.setState({
    activeDoc: createDocument(clone(records.get("x"))), activeDocId: "x", hydratedDocId: "x",
    openTabs: [{ id: "x", title: "X" }], saveStatus: "editing", saveError: null,
    _unsavedEdits: new Map(), _draftBases: new Map(), documents: [],
  });
}
/** The other tab writes `id`. */
function otherTabWrites(id, body) {
  records.set(id, { ...records.get(id), canonical: canonical(body), updated: T_OTHER });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:01:00.000Z"));
  setup();
});
afterEach(() => {
  useDocumentStore.getState().registerLiveCanonical(null);
  useDocumentStore.getState().setDirty();
  vi.useRealTimers();
});

describe("A028: rename after another tab wrote", () => {
  it("renames the stored record without writing this tab's content over the other tab's", async () => {
    otherTabWrites("x", "the other tab's work");
    await useDocumentStore.getState().renameDoc("x", "Renamed here");

    const disk = records.get("x");
    expect(disk.title).toBe("Renamed here");                     // the rename landed
    expect(text(disk.canonical)).toContain("the other tab's work");  // their content survived
    expect(text(disk.canonical)).not.toContain("live edit");
  });

  it("does not launder the conflict: the next save of this tab's content is still refused", async () => {
    otherTabWrites("x", "the other tab's work");
    await useDocumentStore.getState().renameDoc("x", "Renamed here");
    expect(useDocumentStore.getState().activeDoc.updated).toBe(T0);   // base unchanged
    await expect(
      useDocumentStore.getState().saveActiveDoc({ getJSON: () => canonical("this tab's live edit") })
    ).rejects.toThrow(/another tab/i);
    expect(text(records.get("x").canonical)).toContain("the other tab's work");
  });

  it("without a conflict it still persists the live content (no rewind)", async () => {
    await useDocumentStore.getState().renameDoc("x", "Renamed here");
    expect(text(records.get("x").canonical)).toContain("this tab's live edit");
  });

  it("rebases a parked draft by its own rename, so the draft does not later conflict with itself", async () => {
    const s = useDocumentStore.getState();
    s._unsavedEdits.set("y", canonical("parked y draft"));
    s._draftBases.set("y", T0);
    await s.renameDoc("y", "Y renamed");
    // Switch to y and save the draft: the only write since its base was ours.
    await s.switchToDoc("y", null);
    s.markHydrated("y");
    expect(await s.saveActiveDoc({ getJSON: () => canonical("parked y draft") })).toBe(true);
  });
});

describe("A028: a card's pin/colour (touchUpdated: false)", () => {
  it("writes the metadata ONLY, onto the other tab's version, and keeps its timestamp", async () => {
    otherTabWrites("x", "the other tab's work");
    await useDocumentStore.getState().patchDocById("x", { metadata: { cardPinned: true }, touchUpdated: false });

    const disk = records.get("x");
    expect(disk.metadata.cardPinned).toBe(true);
    expect(text(disk.canonical)).toContain("the other tab's work");   // not this tab's copy
    expect(disk.updated).toBe(T_OTHER);                               // not re-stamped
  });

  it("leaves the open document's base where it was, so its save still conflicts", async () => {
    otherTabWrites("x", "the other tab's work");
    await useDocumentStore.getState().patchDocById("x", { metadata: { cardColor: "amber" }, touchUpdated: false });
    const active = useDocumentStore.getState().activeDoc;
    expect(active.metadata.cardColor).toBe("amber");
    expect(active.updated).toBe(T0);
    await expect(
      useDocumentStore.getState().saveActiveDoc({ getJSON: () => canonical("mine") })
    ).rejects.toThrow(/another tab/i);
  });
});

describe("A028: content patches (bridge, cards)", () => {
  it("refuses to replace the open document's content once another tab has written it", async () => {
    otherTabWrites("x", "the other tab's work");
    await expect(
      useDocumentStore.getState().patchDocById("x", { canonical: canonical("appended by the host") })
    ).rejects.toBeInstanceOf(ConflictError);
    expect(text(records.get("x").canonical)).toContain("the other tab's work");
  });

  it("refuses a card edit derived from a copy older than the stored one", async () => {
    otherTabWrites("y", "the other tab's y");
    await expect(
      useDocumentStore.getState().patchDocById("y", { canonical: canonical("card edit"), expectedUpdated: T0 })
    ).rejects.toBeInstanceOf(ConflictError);
    expect(text(records.get("y").canonical)).toContain("the other tab's y");
  });

  it("a background document with no copy of this tab's is patched normally", async () => {
    otherTabWrites("y", "the other tab's y");
    await useDocumentStore.getState().patchDocById("y", { canonical: canonical("host replaced y") });
    expect(text(records.get("y").canonical)).toContain("host replaced y");
  });
});
