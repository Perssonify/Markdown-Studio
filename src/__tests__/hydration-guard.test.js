import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useDocumentStore } from "../store/documentStore";

/**
 * Regression tests for the hydratedDocId data-integrity chokepoint:
 * saveActiveDoc must refuse to persist when the live editor's content does not
 * belong to the active document (un-hydrated after a switch / during init).
 * Without this, several code paths could write doc A's content into doc B or
 * persist an empty editor over real content.
 */

const fakeEditor = (json = { type: "doc", content: [{ type: "paragraph" }] }) => ({
  getJSON: () => json,
});

const fakeDoc = (id) => ({
  _ingestHtml: "",
  id,
  userTitle: null,
  title: `Doc ${id}`,
  origin: { format: "markdown", source: "user-typed", timestamp: "", raw: "" },
  canonical: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "stored" }] }] },
  residuals: [],
  ingestReport: null,
  markdownCache: null,
  htmlCache: null,
  fidelityReport: null,
  metadata: {},
  tags: [],
  created: "2026-01-01T00:00:00.000Z",
  updated: "2026-01-01T00:00:00.000Z",
});

describe("hydratedDocId save guard", () => {
  beforeEach(() => {
    useDocumentStore.setState({
      activeDoc: fakeDoc("doc-a"),
      activeDocId: "doc-a",
      hydratedDocId: null,
      saveStatus: "ready",
    });
  });

  it("blocks saveActiveDoc when the editor is not hydrated for the active doc", async () => {
    await expect(
      useDocumentStore.getState().saveActiveDoc(fakeEditor())
    ).rejects.toThrow(/not hydrated/i);
  });

  it("blocks saveActiveDoc when the editor holds a DIFFERENT doc's content", async () => {
    useDocumentStore.getState().markHydrated("doc-b");
    await expect(
      useDocumentStore.getState().saveActiveDoc(fakeEditor())
    ).rejects.toThrow(/not hydrated/i);
  });

  it("markHydrated sets the flag; a FAILED switch restores it (no session poisoning)", async () => {
    const store = useDocumentStore.getState();
    store.markHydrated("doc-a");
    expect(useDocumentStore.getState().hydratedDocId).toBe("doc-a");
    // switchToDoc to a nonexistent doc: the optimistic invalidation must be
    // rolled back when storage.get returns nothing — otherwise the editor
    // (still showing doc-a) would be save-blocked for the rest of the session.
    await store.switchToDoc("doc-missing", null).catch(() => {});
    expect(useDocumentStore.getState().hydratedDocId).toBe("doc-a");
    expect(useDocumentStore.getState().activeDocId).toBe("doc-a");
  });

  it("deleteDoc purges the doc's cached draft (no resurrection on re-import)", async () => {
    const store = useDocumentStore.getState();
    store.cacheUnsavedEdit("doc-a", { type: "doc", content: [] });
    expect(store.getUnsavedEdit("doc-a")).toBeTruthy();
    await store.deleteDoc("doc-a", null).catch(() => {});
    expect(useDocumentStore.getState().getUnsavedEdit("doc-a")).toBeUndefined();
  });
});

describe("saveActiveDoc integrity behaviors", () => {
  beforeEach(() => {
    useDocumentStore.setState({
      activeDoc: fakeDoc("doc-a"),
      activeDocId: "doc-a",
      hydratedDocId: "doc-a",
      saveStatus: "ready",
    });
  });

  it("strips the in-memory _persistedCanonical baseline before persisting", async () => {
    const saved = [];
    useDocumentStore.getState().initStorage({
      initialize: async () => {},
      list: async () => [],
      get: async () => null,
      save: async (doc) => { saved.push(doc); },
      delete: async () => {},
      getPrefs: async () => ({}),
      setPrefs: async () => {},
    });
    const doc = fakeDoc("doc-a");
    doc._persistedCanonical = { type: "doc", content: [] };
    useDocumentStore.setState({ activeDoc: doc, activeDocId: "doc-a", hydratedDocId: "doc-a" });
    await useDocumentStore.getState().saveActiveDoc(fakeEditor());
    expect(saved).toHaveLength(1);
    expect(saved[0]._persistedCanonical).toBeUndefined();
  });

  it("refuses to overwrite a version written by another tab (updated drift)", async () => {
    const newer = { ...fakeDoc("doc-a"), updated: new Date(Date.now() + 60_000).toISOString() };
    useDocumentStore.getState().initStorage({
      initialize: async () => {},
      list: async () => [],
      get: async () => newer,
      save: async () => {},
      delete: async () => {},
      getPrefs: async () => ({}),
      setPrefs: async () => {},
    });
    useDocumentStore.setState({ activeDoc: fakeDoc("doc-a"), activeDocId: "doc-a", hydratedDocId: "doc-a" });
    await expect(
      useDocumentStore.getState().saveActiveDoc(fakeEditor())
    ).rejects.toThrow(/another tab/i);
  });

  it("does not clobber 'editing' set by keystrokes that landed during the write", async () => {
    useDocumentStore.getState().initStorage({
      initialize: async () => {},
      list: async () => [],
      get: async () => null,
      save: async () => {
        // Simulate the user typing while the (async) write is in flight.
        useDocumentStore.getState().setDirty();
      },
      delete: async () => {},
      getPrefs: async () => ({}),
      setPrefs: async () => {},
    });
    useDocumentStore.setState({ activeDoc: fakeDoc("doc-a"), activeDocId: "doc-a", hydratedDocId: "doc-a" });
    await useDocumentStore.getState().saveActiveDoc(fakeEditor());
    // The snapshot that was saved does NOT include the mid-write keystrokes,
    // so the status must remain "editing" (dirty), not "saved".
    expect(useDocumentStore.getState().saveStatus).toBe("editing");
  });
});

describe("blank-canonical data-loss backstop", () => {
  const seed = (onSave) => {
    const storedDoc = fakeDoc("doc-a"); // canonical has real "stored" text
    useDocumentStore.getState().initStorage({
      initialize: async () => {},
      list: async () => [storedDoc],
      get: async () => storedDoc,
      save: async (d) => { onSave(d); },
      delete: async () => {},
      getPrefs: async () => ({}),
      setPrefs: async () => {},
    });
    useDocumentStore.setState({
      activeDoc: storedDoc, activeDocId: "doc-a", hydratedDocId: "doc-a", saveStatus: "editing",
    });
  };

  it("refuses to persist a BLANK editor over a non-empty stored doc (no write, status → blocked)", async () => {
    let saved = null;
    seed((d) => { saved = d; });
    // fakeEditor()'s default (single empty paragraph) is a blank canonical.
    await useDocumentStore.getState().saveActiveDoc(fakeEditor());
    expect(saved).toBeNull();                                   // nothing written to disk
    expect(useDocumentStore.getState().saveStatus).toBe("blocked"); // terminal, won't re-arm
  });

  it("allowBlankSaveOnce lets an explicit clear persist the blank (one-shot)", async () => {
    let saved = null;
    seed((d) => { saved = d; });
    useDocumentStore.getState().allowBlankSaveOnce();
    await useDocumentStore.getState().saveActiveDoc(fakeEditor());
    expect(saved).not.toBeNull();                              // persisted this time
    // and the permission is consumed — a second blank save is blocked again
    saved = null;
    useDocumentStore.setState({ saveStatus: "editing" });
    await useDocumentStore.getState().saveActiveDoc(fakeEditor());
    expect(saved).toBeNull();
    expect(useDocumentStore.getState().saveStatus).toBe("blocked");
  });

  it("still saves real content normally (backstop only trips on blank)", async () => {
    let saved = null;
    seed((d) => { saved = d; });
    await useDocumentStore.getState().saveActiveDoc(
      fakeEditor({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "new" }] }] })
    );
    expect(saved).not.toBeNull();
    expect(JSON.stringify(saved.canonical)).toContain("new");
  });
});

describe("switchToDoc out-of-order completion (rapid-switch desync guard)", () => {
  it("does not let an earlier switch's late storage.get clobber the newer active doc", async () => {
    const docs = {
      "doc-a": { ...fakeDoc("doc-a") },
      "doc-b": { ...fakeDoc("doc-b") },
    };
    // Controlled resolution: get('doc-a') resolves AFTER get('doc-b'), i.e. the
    // FIRST-called switch settles LAST (the exact out-of-order race).
    let resolveA;
    const gate = { a: new Promise((r) => { resolveA = r; }) };
    useDocumentStore.getState().initStorage({
      initialize: async () => {},
      list: async () => Object.values(docs).map((d) => ({ id: d.id, title: d.title })),
      get: async (id) => { if (id === "doc-a") { await gate.a; } return docs[id] ?? null; },
      save: async () => {},
      delete: async () => {},
      getPrefs: async () => ({}),
      setPrefs: async () => {},
    });
    useDocumentStore.setState({
      activeDoc: fakeDoc("doc-x"), activeDocId: "doc-x", hydratedDocId: "doc-x", saveStatus: "ready",
    });

    const store = useDocumentStore.getState();
    const pA = store.switchToDoc("doc-a", null); // called first, will settle last
    const pB = store.switchToDoc("doc-b", null); // called second, settles first
    await pB;                                    // B completes → active should be B
    expect(useDocumentStore.getState().activeDocId).toBe("doc-b");
    resolveA();                                  // now A's late get resolves
    await pA;
    // A was superseded: it must NOT have clobbered activeDocId back to doc-a.
    expect(useDocumentStore.getState().activeDocId).toBe("doc-b");
  });
});

describe("getLifecycleState (read-only observability seam)", () => {
  it("reports the store-owned lifecycle flags as one object", () => {
    useDocumentStore.setState({
      activeDoc: fakeDoc("doc-a"), activeDocId: "doc-a", hydratedDocId: "doc-a",
      saveStatus: "editing", documents: [{ id: "doc-a", title: "Doc doc-a" }],
    });
    const st = useDocumentStore.getState().getLifecycleState();
    expect(st.activeDocId).toBe("doc-a");
    expect(st.hydrated).toBe(true);
    expect(st.saveStatus).toBe("editing");
    expect(st.hasActiveDoc).toBe(true);
    expect(typeof st.unsavedDraftCount).toBe("number");
  });

  it("hydrated is false when the editor holds a different doc", () => {
    useDocumentStore.setState({ activeDocId: "doc-a", hydratedDocId: "doc-b" });
    expect(useDocumentStore.getState().getLifecycleState().hydrated).toBe(false);
  });
});

describe("stale-overwrite prevention (live-canonical provider)", () => {
  const liveContent = (text) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

  const seed = (onSave) => {
    const storedDoc = fakeDoc("doc-a"); // stored canonical = "stored"
    useDocumentStore.getState().initStorage({
      initialize: async () => {},
      list: async () => [storedDoc],
      get: async () => storedDoc,
      save: async (d) => { onSave(d); },
      delete: async () => {},
      getPrefs: async () => ({}),
      setPrefs: async () => {},
    });
    useDocumentStore.setState({
      activeDoc: storedDoc, activeDocId: "doc-a", hydratedDocId: "doc-a", saveStatus: "ready",
    });
  };

  afterEach(() => {
    // Never leak a provider between tests.
    useDocumentStore.getState().registerLiveCanonical(null);
  });

  it("renameDoc persists the LIVE editor content, not the stale stored copy", async () => {
    let saved = null;
    seed((d) => { saved = d; });
    // Live editor holds unsaved edits ("live edits") that lag disk ("stored").
    useDocumentStore.getState().registerLiveCanonical((id) =>
      id === "doc-a" ? liveContent("live edits") : null
    );
    await useDocumentStore.getState().renameDoc("doc-a", "New Title");
    expect(saved).not.toBeNull();
    expect(saved.title).toBe("New Title");
    // The rename must NOT rewind to the on-disk "stored" content.
    expect(JSON.stringify(saved.canonical)).toContain("live edits");
    expect(JSON.stringify(saved.canonical)).not.toContain("stored");
  });

  it("renameDoc never injects a BLANK live canonical over stored content", async () => {
    let saved = null;
    seed((d) => { saved = d; });
    // Live editor momentarily blank — must be ignored, disk content preserved.
    useDocumentStore.getState().registerLiveCanonical(() => ({
      type: "doc", content: [{ type: "paragraph" }],
    }));
    await useDocumentStore.getState().renameDoc("doc-a", "New Title");
    expect(saved).not.toBeNull();
    expect(JSON.stringify(saved.canonical)).toContain("stored");
  });

  it("patchDocById (title-only) merges onto the live canonical for the active doc", async () => {
    let saved = null;
    seed((d) => { saved = d; });
    useDocumentStore.getState().registerLiveCanonical((id) =>
      id === "doc-a" ? liveContent("live edits") : null
    );
    await useDocumentStore.getState().patchDocById("doc-a", { title: "Host Title", userTitle: "Host Title" });
    expect(saved).not.toBeNull();
    expect(saved.title).toBe("Host Title");
    expect(JSON.stringify(saved.canonical)).toContain("live edits");
  });
});

/**
 * The two guards that exist for races landing DURING `await storage.get` inside
 * saveActiveDoc (the entry hydration check above is stale by then):
 *   1. the hydration/delete RE-ASSERT — a switch or delete mid-await must make
 *      the save write NOTHING (no cross-document overwrite, no resurrection);
 *   2. the freshest-activeDoc RE-READ — a rename mid-await must not be reverted
 *      by the pre-await title snapshot.
 * Same promise-gate technique as the switchToDoc out-of-order test above.
 */
describe("saveActiveDoc post-await race guards", () => {
  const liveJson = (text) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

  /**
   * Storage whose FIRST `get` suspends on a gate we open by hand, so another
   * operation can land while saveActiveDoc sits inside its `await storage.get`.
   * The read returns a SNAPSHOT captured when the call was issued — a read
   * already in flight cannot observe a write that happens after it started.
   */
  const gatedStorage = ({ docs, saved, deleted = [], onDelete }) => {
    let open;
    const gate = new Promise((r) => { open = r; });
    let firstGet = true;
    useDocumentStore.getState().initStorage({
      initialize: async () => {},
      list: async () => Object.values(docs).map((d) => ({ id: d.id, title: d.title })),
      get: async (id) => {
        const snap = docs[id] ? { ...docs[id] } : null;
        if (firstGet) { firstGet = false; await gate; }
        return snap;
      },
      save: async (d) => { saved.push({ ...d }); },
      delete: async (id) => {
        deleted.push(id);
        delete docs[id];
        if (onDelete) await onDelete(id);
      },
      getPrefs: async () => ({}),
      setPrefs: async () => {},
    });
    return { open: () => open() };
  };

  beforeEach(() => {
    useDocumentStore.getState().registerLiveCanonical(null);
  });

  it("writes NOTHING when a doc SWITCH lands during the await (no cross-doc overwrite)", async () => {
    const docs = { "doc-a": fakeDoc("doc-a"), "doc-b": fakeDoc("doc-b") };
    const saved = [];
    const { open } = gatedStorage({ docs, saved });
    useDocumentStore.setState({
      activeDoc: docs["doc-a"], activeDocId: "doc-a", hydratedDocId: "doc-a", saveStatus: "editing",
    });

    // Save starts for doc-a and suspends inside `await storage.get`.
    const p = useDocumentStore.getState().saveActiveDoc(fakeEditor(liveJson("doc-b content")));
    // …the user switches; the editor now holds doc-b's content.
    useDocumentStore.setState({ activeDoc: docs["doc-b"], activeDocId: "doc-b" });
    useDocumentStore.getState().markHydrated("doc-b");
    open();
    await p;

    // Writing here would put doc-b's content into doc-a's record.
    expect(saved).toHaveLength(0);
    expect(useDocumentStore.getState().saveStatus).not.toBe("saved");
    // …and the switch itself is untouched.
    expect(useDocumentStore.getState().activeDocId).toBe("doc-b");
    expect(useDocumentStore.getState().hydratedDocId).toBe("doc-b");
  });

  it("writes NOTHING when a DELETE claims the doc during the await (no resurrection)", async () => {
    const docs = { "doc-a": fakeDoc("doc-a") };
    const saved = [];
    const deleted = [];
    let savePromise = null;
    const { open } = gatedStorage({
      docs, saved, deleted,
      // Suspend INSIDE storage.delete: the deletion is committed but deleteDoc
      // has not reached closeTab yet, so activeDocId/hydratedDocId still point
      // at doc-a — only the in-flight-delete claim distinguishes this window.
      onDelete: async () => { open(); await savePromise; },
    });
    useDocumentStore.setState({
      activeDoc: docs["doc-a"], activeDocId: "doc-a", hydratedDocId: "doc-a", saveStatus: "editing",
    });

    savePromise = useDocumentStore.getState().saveActiveDoc(fakeEditor(liveJson("still typing")));
    await useDocumentStore.getState().deleteDoc("doc-a", null);
    await savePromise;

    expect(deleted).toEqual(["doc-a"]);
    // A write here would re-create the record storage.delete just removed.
    expect(saved).toHaveLength(0);
  });

  it("does not clobber a RENAME that landed during the await (freshest-activeDoc re-read)", async () => {
    const docs = { "doc-a": fakeDoc("doc-a") };
    const saved = [];
    const { open } = gatedStorage({ docs, saved });
    useDocumentStore.setState({
      activeDoc: docs["doc-a"], activeDocId: "doc-a", hydratedDocId: "doc-a", saveStatus: "editing",
    });

    // Save starts (pre-await snapshot still has the old title "Doc doc-a")…
    const p = useDocumentStore.getState().saveActiveDoc(fakeEditor(liveJson("live edits")));
    // …the rename lands and completes while the read is in flight…
    await useDocumentStore.getState().renameDoc("doc-a", "Renamed By User");
    open();
    await p;

    const last = saved[saved.length - 1];
    // The save must carry the RENAME (title + provenance pin), not the stale
    // pre-await snapshot, while still persisting the editor's live canonical.
    expect(last.title).toBe("Renamed By User");
    expect(last.userTitle).toBe("Renamed By User");
    expect(last.titlePinnedByUser).toBe(true);
    expect(JSON.stringify(last.canonical)).toContain("live edits");
  });
});

/**
 * patchDocById (card saves, host updates, retargeted heading links) reads a
 * document, awaits, then writes it. A delete landing in that await used to be
 * undone by the write: nothing told the patch the record was gone. It now
 * refuses a document deleted — or being deleted — since its read began.
 */
describe("patchDocById never writes back a deleted document", () => {
  const content = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  const gated = (docs, saved, deleted, { onDelete } = {}) => {
    let open;
    const gate = new Promise((r) => { open = r; });
    let firstGet = true;
    useDocumentStore.getState().initStorage({
      initialize: async () => {},
      list: async () => Object.values(docs).map((d) => ({ id: d.id, title: d.title })),
      get: async (id) => {
        const snap = docs[id] ? { ...docs[id] } : null;
        if (firstGet) { firstGet = false; await gate; }
        return snap;
      },
      save: async (d) => { saved.push({ ...d }); docs[d.id] = { ...d }; },
      delete: async (id) => { deleted.push(id); delete docs[id]; if (onDelete) await onDelete(id); },
      getPrefs: async () => ({}),
      setPrefs: async () => {},
    });
    return () => open();
  };
  beforeEach(() => {
    useDocumentStore.getState().registerLiveCanonical(null);
    // The patched document is NOT the open one.
    useDocumentStore.setState({ activeDoc: null, activeDocId: null, hydratedDocId: null, saveStatus: "saved" });
  });

  it("a delete that COMPLETES while the patch is reading", async () => {
    const docs = { "doc-b": fakeDoc("doc-b") };
    const saved = [], deleted = [];
    const open = gated(docs, saved, deleted);
    const patch = useDocumentStore.getState().patchDocById("doc-b", { canonical: content("retargeted") });
    await useDocumentStore.getState().deleteDoc("doc-b", null);
    open();
    expect(await patch).toBeNull();
    expect(deleted).toEqual(["doc-b"]);
    expect(saved).toHaveLength(0);
    expect(docs["doc-b"]).toBeUndefined();
  });

  it("a delete still IN FLIGHT when the read returns", async () => {
    const docs = { "doc-b": fakeDoc("doc-b") };
    const saved = [], deleted = [];
    let patch = null;
    const open = gated(docs, saved, deleted, {
      // The record is gone; deleteDoc has not finished. Let the patch run now.
      onDelete: async () => { open(); await patch; },
    });
    patch = useDocumentStore.getState().patchDocById("doc-b", { canonical: content("retargeted") });
    await useDocumentStore.getState().deleteDoc("doc-b", null);
    expect(await patch).toBeNull();
    expect(saved).toHaveLength(0);
  });

  it("metadata-only patches (card colour, pin) are guarded too", async () => {
    const docs = { "doc-b": fakeDoc("doc-b") };
    const saved = [], deleted = [];
    const open = gated(docs, saved, deleted);
    const patch = useDocumentStore.getState().patchDocById("doc-b", { metadata: { cardPinned: true }, touchUpdated: false });
    await useDocumentStore.getState().deleteDoc("doc-b", null);
    open();
    expect(await patch).toBeNull();
    expect(saved).toHaveLength(0);
  });

  it("control: with no delete the same patch writes", async () => {
    const docs = { "doc-b": fakeDoc("doc-b") };
    const saved = [], deleted = [];
    const open = gated(docs, saved, deleted);
    const patch = useDocumentStore.getState().patchDocById("doc-b", { canonical: content("retargeted") });
    open();
    expect(await patch).not.toBeNull();
    expect(saved).toHaveLength(1);
    expect(JSON.stringify(saved[0].canonical)).toContain("retargeted");
  });
});
