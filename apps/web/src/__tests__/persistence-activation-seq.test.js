/**
 * A032 — every path that ACTIVATES a document must claim the store's switch
 * sequence, or a slower in-flight `switchToDoc` settles on top of it.
 *
 * `switchToDoc` re-checks `switchSeq` after its storage read so a superseded
 * switch cannot re-activate its target. `finalizeDoc` (New document, import,
 * restore-as-new) and `closeTab`'s "nothing left open" branch both changed
 * `activeDocId` WITHOUT bumping it, so the stale switch's completion landed
 * afterwards: activeDocId on the switch's target, hydratedDocId on the new
 * document — every save refused, and leaving the document cached nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "../store/documents/documentStore";
import { createDocument } from "../store/documents/document";

vi.mock("../store/history/snapshot-store", () => ({
  snapshotStore: { maybeRecordOnSave: vi.fn(), record: vi.fn(async () => null) },
}));

const canonical = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** Storage whose read of `slowId` waits until the test opens the gate. */
function gatedStorage(docs, slowId) {
  let open;
  const gate = new Promise((r) => { open = r; });
  useDocumentStore.getState().initStorage({
    list: async () => Object.values(docs),
    get: async (id) => { if (id === slowId) await gate; return docs[id] ? { ...docs[id] } : null; },
    save: async (d) => { docs[d.id] = { ...d }; },
    delete: async (id) => { delete docs[id]; },
    search: async () => [], getPrefs: async () => ({}), setPrefs: async () => {},
  });
  return () => open();
}

let x, y;
beforeEach(() => {
  x = createDocument({ id: "x", title: "X", canonical: canonical("x body") });
  y = createDocument({ id: "y", title: "Y", canonical: canonical("y body") });
  useDocumentStore.setState({
    activeDoc: x, activeDocId: "x", hydratedDocId: "x", openTabs: [{ id: "x", title: "X" }],
    saveStatus: "ready", saveError: null, _unsavedEdits: new Map(), _draftBases: new Map(),
  });
});

describe("A032: a pending switch cannot settle over a newer activation", () => {
  it("New document (finalizeDoc) during a slow switch keeps the new document active AND hydrated", async () => {
    const open = gatedStorage({ x, y }, "y");
    const store = useDocumentStore.getState();
    const pending = store.switchToDoc("y", null);       // the user clicked Y…
    const fresh = createDocument({ id: "new", title: "Untitled", canonical: canonical("") });
    // …and pressed ⌘N before Y's read came back. finalizeDoc with an editor
    // captures and marks the new document hydrated.
    await store.finalizeDoc(fresh, { getJSON: () => canonical("") }, true);
    open();
    await pending;

    const s = useDocumentStore.getState();
    expect(s.activeDocId).toBe("new");
    expect(s.hydratedDocId).toBe("new");                 // the two agree — saves allowed
  });

  it("closing the last tab during a slow switch does not resurrect the switch's target", async () => {
    const open = gatedStorage({ x, y }, "y");
    useDocumentStore.setState({ openTabs: [] });
    const store = useDocumentStore.getState();
    const pending = store.switchToDoc("y", null);        // optimistic: activeDocId = y
    await store.closeTab("y", null);                     // nothing else open → nothing active
    open();
    await pending;

    const s = useDocumentStore.getState();
    expect(s.activeDocId).toBeNull();
    expect(s.hydratedDocId).toBeNull();
  });
});
