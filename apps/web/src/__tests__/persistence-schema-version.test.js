import "fake-indexeddb/auto";
import { act, renderHook } from "@testing-library/react";
import { Schema } from "@tiptap/pm/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CURRENT_SCHEMA_VERSION, canonicalMisfit, coerceToSchema, isNewerSchema,
} from "../store/documents/schema-version";
import { createDocument, deserializeFromStorage, serializeForStorage } from "../store/documents/document";
import { ingest } from "../store/importExport/ingest";
import { IndexedDBStorageAdapter } from "../store/persistence/idb-storage-adapter";
import { SCHEMA_LOCK_ERROR, useDocumentStore } from "../store/documents/documentStore";
import { useUIStore } from "../store/preferences/uiStore";
import { useDocumentLifecycle } from "../hooks/useDocumentLifecycle";

/**
 * A021 — content this build cannot represent must open READ-ONLY, never blank.
 *
 * TipTap's setContent, handed a node or mark type the schema lacks, loads an
 * EMPTY document — every paragraph gone, not just the unknown one (measured
 * against the real pane while fixing this). The next keystroke's autosave then
 * wrote that over the stored document. Records and exports now carry a
 * `schemaVersion`, and misfitting content is shown as a display copy that is
 * never marked hydrated, so nothing can save it.
 */

// A deliberately small schema: doc / paragraph / text + bold.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
  },
  marks: { bold: {} },
});
const para = (text, marks) => ({ type: "paragraph", content: [{ type: "text", text, ...(marks ? { marks } : {}) }] });
const fromTheFuture = {
  type: "doc",
  content: [
    para("kept words"),
    { type: "futureWidget", attrs: { x: 1 }, content: [para("inside the widget")] },
    para("glowing", [{ type: "sparkle" }, { type: "bold" }]),
  ],
};

describe("the schema check", () => {
  it("finds exactly what makes TipTap load an empty document", () => {
    expect(canonicalMisfit({ type: "doc", content: [para("fine")] }, schema)).toBeNull();
    expect(canonicalMisfit(fromTheFuture, schema)).toMatch(/futureWidget|sparkle/);
    expect(canonicalMisfit({ type: "doc", content: [para("x", [{ type: "sparkle" }])] }, schema)).toMatch(/sparkle/);
  });

  it("the display copy keeps every word and fits", () => {
    const shown = coerceToSchema(fromTheFuture, schema);
    expect(canonicalMisfit(shown, schema)).toBeNull();
    const text = JSON.stringify(shown);
    for (const w of ["kept words", "inside the widget", "glowing"]) expect(text).toContain(w);
    expect(text).toContain("bold");        // known marks survive
    expect(text).not.toContain("sparkle"); // unknown ones do not
  });

  it("recognises a newer schema version", () => {
    expect(isNewerSchema(CURRENT_SCHEMA_VERSION + 1)).toBe(true);
    expect(isNewerSchema(CURRENT_SCHEMA_VERSION)).toBe(false);
    expect(isNewerSchema(undefined)).toBe(false);
  });
});

describe("records and exports carry the version", () => {
  it("serializeForStorage stamps it, and never downgrades a newer one", () => {
    const mine = JSON.parse(serializeForStorage(createDocument({ id: "a" })));
    expect(mine.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const theirs = createDocument({ id: "b", schemaVersion: CURRENT_SCHEMA_VERSION + 3 });
    expect(JSON.parse(serializeForStorage(theirs)).schemaVersion).toBe(CURRENT_SCHEMA_VERSION + 3);
    expect(deserializeFromStorage(serializeForStorage(theirs)).schemaVersion).toBe(CURRENT_SCHEMA_VERSION + 3);
  });

  it("an imported envelope keeps the version it was exported with", () => {
    const env = JSON.stringify({ _format: "perssonify-document", schemaVersion: 9, id: "z", title: "Z", canonical: { type: "doc", content: [para("x")] } });
    expect(ingest(env, "pmjson", "file-import", {}).doc.schemaVersion).toBe(9);
  });
});

describe("hydration of content that does not fit", () => {
  function mount() {
    const shown = [];
    const params = {
      tiptapRef: { current: { getEditor: () => ({ schema }), getEditorState: () => null, endComposition: vi.fn(), resetHistory: vi.fn() } },
      cmRef: { current: { endComposition: vi.fn(), resetHistory: vi.fn(), getValue: () => "" } },
      engine: {}, syncMdToHtml: vi.fn(() => true), syncHtmlToMd: vi.fn(() => true),
      forceSyncMdToHtml: vi.fn(), forceSyncHtmlToMd: vi.fn(), resetHashes: vi.fn(),
      setCanonical: vi.fn((c) => { shown.push(c); }), setFromHtml: vi.fn(), switchToDoc: vi.fn(), closeTab: vi.fn(),
      createDoc: vi.fn(), deleteDoc: vi.fn(), finalizeDoc: vi.fn(), revertActiveDoc: vi.fn(),
      saveActiveDoc: vi.fn(), setDirty: vi.fn(), handleCanonicalChange: vi.fn(),
      pasteStyled: true, setPasteStyled: vi.fn(), syncMode: "styled", setSyncMode: vi.fn(),
      toast: { show: vi.fn() }, confirm: vi.fn(async () => true), confirmUnsaved: vi.fn(),
    };
    return { ...renderHook(() => useDocumentLifecycle(params)), params, shown };
  }

  let saved;
  beforeEach(() => {
    saved = [];
    useUIStore.setState({ readOnly: false });
    useDocumentStore.getState().initStorage({
      list: async () => [], get: async () => null, save: async (d) => { saved.push(d); },
      delete: async () => {}, search: async () => [], getPrefs: async () => ({}), setPrefs: async () => {},
    });
    useDocumentStore.setState({
      activeDocId: "f", activeDoc: createDocument({ id: "f", title: "Future", canonical: fromTheFuture }),
      hydratedDocId: null, saveStatus: "ready", saveError: null, schemaLock: null,
    });
  });
  afterEach(() => {
    useUIStore.setState({ readOnly: false });
    useDocumentStore.getState().clearIncompatible("f");
  });

  it("shows the words read-only, never an empty document, and never marks it hydrated", () => {
    const { result, params, shown } = mount();
    act(() => { result.current.hydrateEditorWithDoc("f", fromTheFuture); });
    expect(JSON.stringify(shown[0])).toContain("kept words");   // not blank
    expect(canonicalMisfit(shown[0], schema)).toBeNull();       // what the editor got loads
    const s = useDocumentStore.getState();
    expect(s.hydratedDocId).toBeNull();                         // no save path may write it
    expect(s.schemaLock?.docId).toBe("f");
    expect(useUIStore.getState().readOnly).toBe(true);          // and it says so
    expect(params.toast.show).toHaveBeenCalledWith(expect.stringMatching(/newer version/), "warning");
  });

  it("no save can write the display copy over the stored document", async () => {
    const { result } = mount();
    act(() => { result.current.hydrateEditorWithDoc("f", fromTheFuture); });
    useDocumentStore.getState().markHydrated("f");              // e.g. a markdown keystroke's repair
    expect(useDocumentStore.getState().hydratedDocId).toBeNull();
    const committed = await useDocumentStore.getState().saveActiveDoc({ getJSON: () => ({ type: "doc", content: [para("typed")] }) });
    expect(committed).toBe(false);
    expect(saved).toHaveLength(0);
    expect(useDocumentStore.getState().saveError).toBe(SCHEMA_LOCK_ERROR);
  });

  it("a document from a newer version opens read-only even when its nodes happen to fit", () => {
    useDocumentStore.setState({
      activeDoc: createDocument({ id: "f", canonical: { type: "doc", content: [para("plain")] }, schemaVersion: CURRENT_SCHEMA_VERSION + 1 }),
    });
    const { result } = mount();
    act(() => { result.current.hydrateEditorWithDoc("f", { type: "doc", content: [para("plain")] }); });
    expect(useDocumentStore.getState().hydratedDocId).toBeNull();
    expect(useUIStore.getState().readOnly).toBe(true);
  });

  it("leaving by a path that bypasses the ritual (New document) still lifts the forced read-only", () => {
    const { result } = mount();
    act(() => { result.current.hydrateEditorWithDoc("f", fromTheFuture); });
    expect(useUIStore.getState().readOnly).toBe(true);
    // handleNewDoc / quick capture: finalizeDoc marks the new document hydrated.
    act(() => { useDocumentStore.setState({ activeDocId: "new" }); useDocumentStore.getState().markHydrated("new"); });
    expect(useUIStore.getState().readOnly).toBe(false);
  });

  it("restoring over a locked document keeps its REAL content as the pre-restore copy", async () => {
    const { snapshotStore } = await import("../store/history/snapshot-store");
    snapshotStore._resetForTests();
    await snapshotStore.record("f", "Future", { type: "doc", content: [para("an old version")] }, "manual");
    const [old] = await snapshotStore.listForDoc("f");
    const { result } = mount();
    act(() => { result.current.hydrateEditorWithDoc("f", fromTheFuture); });
    useUIStore.setState({ readOnly: false });                    // the user switched read-only off
    await act(async () => { await result.current.restoreSnapshotInPlace(old.id); });
    const pre = (await snapshotStore.listForDoc("f")).find((s) => s.reason === "pre-restore");
    // Not the lossy display copy the editor showed — the stored content.
    expect(JSON.stringify(await snapshotStore.getCanonical(pre.id))).toContain("futureWidget");
  });

  it("opening a document that fits afterwards unlocks it and restores read-only", () => {
    const { result } = mount();
    act(() => { result.current.hydrateEditorWithDoc("f", fromTheFuture); });
    useDocumentStore.setState({ activeDocId: "ok", activeDoc: createDocument({ id: "ok" }) });
    act(() => { result.current.hydrateEditorWithDoc("ok", { type: "doc", content: [para("ordinary")] }); });
    expect(useDocumentStore.getState().hydratedDocId).toBe("ok");
    expect(useUIStore.getState().readOnly).toBe(false);          // the user's own setting is back
  });
});

describe("IndexedDB version changes", () => {
  let warn;
  beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { warn.mockRestore(); });

  it("does not block a newer build's upgrade from another tab", async () => {
    const name = `a021-upgrade-${Math.random()}`;
    const a = new IndexedDBStorageAdapter({ dbName: name });
    await a.isReady();
    await a.save(createDocument({ id: "d" }));
    // Another tab opens the same database at a higher version.
    const upgraded = await new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 2);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("BLOCKED by the older tab's open connection"));
    });
    upgraded.close();
    // …and this tab now says so instead of wedging it.
    await expect(a.save(createDocument({ id: "e" }))).rejects.toThrow(/reload/i);
  });

  it("opens a database a newer build has already upgraded, instead of failing to start", async () => {
    const name = `a021-newer-${Math.random()}`;
    await new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 3);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("documents");
        req.result.createObjectStore("meta");
        req.result.createObjectStore("somethingNew");
      };
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });
    const a = new IndexedDBStorageAdapter({ dbName: name });
    await a.isReady();
    await a.save(createDocument({ id: "d" }));
    expect((await a.list()).map((d) => d.id)).toEqual(["d"]);
  });
});
