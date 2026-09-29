import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLinkIndex } from "../hooks/useLinkIndex";
import { useDocumentStore } from "../store/documentStore";
import { useEditorStore } from "../store/editorStore";

/**
 * The link index's HOOK — the half that decides HOW to update.
 *
 * `link-index.test.js` beside this file covers the pure store functions
 * (scanning, resolving, splicing). What had no coverage is the classification
 * this hook performs on every `documents` change, and it is the one that costs:
 * a full rebuild re-reads and re-scans the WHOLE library, so it must be reserved
 * for membership changes and renames (a rename can re-resolve other documents'
 * wiki links, which a single-doc pass cannot see), while an ordinary content
 * edit takes the incremental path. Classify a rename as an edit and links go
 * quietly stale; classify every edit as a rename and every autosave re-reads the
 * library.
 *
 * The click handler is here too: it is the only route a `[[wiki link]]` has to
 * actually navigate.
 */

const doc = (id, { title = id, updated = "2024-01-01T00:00:00.000Z", links = [] } = {}) => ({
  id,
  title,
  updated,
  canonical: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: links.map((l) => `[[${l}]]`).join(" ") || "body" }],
      },
    ],
  },
});

/** A storage adapter over a plain array, counting reads so the hot path is
 *  measurable rather than merely asserted. */
function fakeStorage(docs) {
  const map = new Map(docs.map((d) => [d.id, d]));
  return {
    reads: 0,
    listCalls: 0,
    async list() { this.listCalls++; return [...map.values()].map((d) => ({ id: d.id })); },
    async get(id) { this.reads++; return map.get(id) ?? null; },
    put(d) { map.set(d.id, d); },
  };
}

let storage;
function setup(docs, params = {}) {
  storage = fakeStorage(docs);
  useDocumentStore.setState({
    getStorage: () => storage,
    documents: docs.map((d) => ({ id: d.id, title: d.title, updated: d.updated })),
    activeDocId: docs[0]?.id ?? null,
  });
  const toast = { show: vi.fn() };
  const handleSwitchDoc = vi.fn();
  const view = renderHook(() =>
    useLinkIndex({
      tiptapRef: { current: null },
      handleSwitchDoc,
      toast,
      editorReady: true,
      ...params,
    })
  );
  return { view, toast, handleSwitchDoc };
}

/** Publish a new `documents` list the way the store does after a save. */
async function publish(docs) {
  await act(async () => {
    useDocumentStore.setState({
      documents: docs.map((d) => ({ id: d.id, title: d.title, updated: d.updated })),
    });
  });
}

/** Let the 600 ms debounce fire and its async work settle. */
async function flushDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(600);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  useEditorStore.setState({ linkIndex: { forward: new Map(), reverse: new Map(), unresolved: new Map() } });
});
afterEach(() => {
  vi.useRealTimers();
  useDocumentStore.setState({ documents: [], activeDocId: null });
});

describe("useLinkIndex — first run", () => {
  it("builds the whole index once, reading every document", async () => {
    setup([doc("a", { links: ["b"] }), doc("b")]);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(storage.listCalls).toBe(1);
    expect(storage.reads).toBe(2);
    const idx = useEditorStore.getState().linkIndex;
    expect([...idx.forward.get("a")]).toEqual(["b"]);
    expect([...idx.reverse.get("b")]).toEqual(["a"]);
  });
});

describe("useLinkIndex — classification", () => {
  it("a content edit reads ONLY the edited document", async () => {
    const docs = [doc("a", { links: ["b"] }), doc("b"), doc("c")];
    setup(docs);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const readsAfterBuild = storage.reads;

    storage.put({ ...doc("b", { updated: "2024-06-01T00:00:00.000Z", links: ["c"] }) });
    await publish([docs[0], { ...docs[1], updated: "2024-06-01T00:00:00.000Z" }, docs[2]]);
    await flushDebounce();

    expect(storage.reads - readsAfterBuild).toBe(1);
    expect(storage.listCalls).toBe(1); // no second full pass
    expect([...useEditorStore.getState().linkIndex.forward.get("b")]).toEqual(["c"]);
  });

  it("a RENAME rebuilds everything — it can re-resolve other documents' links", async () => {
    // "a" links to [[Renamed]], which resolves to nothing until "b" is renamed.
    // Only a full rebuild re-scans "a", so an incremental pass would leave the
    // link permanently broken.
    const docs = [doc("a", { links: ["Renamed"] }), doc("b", { title: "b" })];
    setup(docs);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(useEditorStore.getState().linkIndex.unresolved.get("a").map((u) => u.target)).toEqual(["Renamed"]);

    storage.put({ ...docs[1], title: "Renamed", updated: "2024-06-01T00:00:00.000Z" });
    await publish([docs[0], { ...docs[1], title: "Renamed", updated: "2024-06-01T00:00:00.000Z" }]);
    await flushDebounce();

    expect(storage.listCalls).toBe(2); // a second full pass
    expect([...useEditorStore.getState().linkIndex.forward.get("a")]).toEqual(["b"]);
    expect(useEditorStore.getState().linkIndex.unresolved.get("a") ?? []).toEqual([]);
  });

  it("adding a document rebuilds IMMEDIATELY, without waiting for the debounce", async () => {
    // The panels populate from this index; a new note that stays invisible for
    // 600 ms reads as a lost note.
    const docs = [doc("a")];
    setup(docs);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    storage.put(doc("b"));
    await publish([docs[0], doc("b")]);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(storage.listCalls).toBe(2);
  });

  it("removing a document rebuilds too", async () => {
    const docs = [doc("a"), doc("b")];
    setup(docs);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await publish([docs[0]]);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(storage.listCalls).toBe(2);
  });

  it("coalesces a burst of edits into one incremental pass", async () => {
    const docs = [doc("a"), doc("b")];
    setup(docs);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const before = storage.reads;

    for (const t of ["2024-06-01", "2024-06-02", "2024-06-03"]) {
      await publish([{ ...docs[0], updated: `${t}T00:00:00.000Z` }, docs[1]]);
      await act(async () => { vi.advanceTimersByTime(100); });
    }
    await flushDebounce();
    expect(storage.reads - before).toBe(1);
  });

  it("does not strand queued ids when `documents` changes with no content diff", async () => {
    // The effect's cleanup clears the debounce timer on every re-run, so a
    // re-publish with identical timestamps must re-schedule the pending set
    // rather than drop it — otherwise the edit is never indexed at all.
    const docs = [doc("a"), doc("b")];
    setup(docs);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const before = storage.reads;

    const edited = { ...docs[0], updated: "2024-06-01T00:00:00.000Z" };
    storage.put(doc("a", { updated: "2024-06-01T00:00:00.000Z", links: ["b"] }));
    await publish([edited, docs[1]]);
    await act(async () => { vi.advanceTimersByTime(100); });
    await publish([edited, docs[1]]); // identical content, new array identity
    await flushDebounce();

    expect(storage.reads - before).toBe(1);
    expect([...useEditorStore.getState().linkIndex.forward.get("a")]).toEqual(["b"]);
  });
});

describe("useLinkIndex — fullDocsRef identity", () => {
  it("hands back a NEW array after an incremental update", async () => {
    // Consumers treat this array's identity as "has the library changed?" — the
    // library body-search caches an id→doc map on it. Mutating in place left
    // that cache serving the pre-edit record.
    const docs = [doc("a"), doc("b")];
    const { view } = setup(docs);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const first = view.result.current.fullDocsRef.current;

    storage.put(doc("a", { updated: "2024-06-01T00:00:00.000Z", links: ["b"] }));
    await publish([{ ...docs[0], updated: "2024-06-01T00:00:00.000Z" }, docs[1]]);
    await flushDebounce();

    const second = view.result.current.fullDocsRef.current;
    expect(second).not.toBe(first);
    expect(JSON.stringify(second.find((d) => d.id === "a"))).toContain("[[b]]");
  });

  it("keeps the edited document in its original position", async () => {
    const docs = [doc("a"), doc("b"), doc("c")];
    const { view } = setup(docs);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    storage.put(doc("b", { updated: "2024-06-01T00:00:00.000Z" }));
    await publish([docs[0], { ...docs[1], updated: "2024-06-01T00:00:00.000Z" }, docs[2]]);
    await flushDebounce();

    expect(view.result.current.fullDocsRef.current.map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("falls back to a full rebuild when an incremental read throws", async () => {
    const docs = [doc("a"), doc("b")];
    setup(docs);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const realGet = storage.get.bind(storage);
    let thrown = false;
    storage.get = async (id) => {
      if (!thrown) { thrown = true; throw new Error("read failed"); }
      return realGet(id);
    };
    await publish([{ ...docs[0], updated: "2024-06-01T00:00:00.000Z" }, docs[1]]);
    await flushDebounce();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(storage.listCalls).toBe(2);
    warn.mockRestore();
  });
});

describe("useLinkIndex — active document derivation", () => {
  it("publishes backlinks, forward links and unresolved for the active doc", async () => {
    setup([doc("a", { links: ["b", "ghost"] }), doc("b", { links: ["a"] })]);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const st = useEditorStore.getState();
    expect(st.activeForwardLinks.map((l) => l.docId)).toEqual(["b"]);
    expect(st.activeBacklinks.map((l) => l.docId)).toEqual(["b"]);
    expect(st.activeUnresolved.map((u) => u.target)).toEqual(["ghost"]);
  });

  it("clears them when no document is active", async () => {
    setup([doc("a", { links: ["b"] }), doc("b")]);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { useDocumentStore.setState({ activeDocId: null }); });

    const st = useEditorStore.getState();
    expect(st.activeForwardLinks).toEqual([]);
    expect(st.activeBacklinks).toEqual([]);
    expect(st.activeUnresolved).toEqual([]);
  });
});

describe("useLinkIndex — graph data", () => {
  it("is populated only while the graph is visible", async () => {
    // `graphVisible` is the EFFECTIVE visibility (route-driven in the standalone
    // app); keying on the store flag alone left the routed graph empty.
    const docs = [doc("a", { links: ["b"] }), doc("b")];
    storage = fakeStorage(docs);
    useDocumentStore.setState({
      getStorage: () => storage,
      documents: docs.map((d) => ({ id: d.id, title: d.title, updated: d.updated })),
      activeDocId: "a",
    });
    const view = renderHook(
      ({ graphVisible }) =>
        useLinkIndex({
          tiptapRef: { current: null },
          handleSwitchDoc: vi.fn(),
          toast: { show: vi.fn() },
          editorReady: true,
          graphVisible,
        }),
      { initialProps: { graphVisible: false } }
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(useEditorStore.getState().graphData).toBeNull();

    await act(async () => { view.rerender({ graphVisible: true }); });
    const g = useEditorStore.getState().graphData;
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(g.edges).toHaveLength(1);

    await act(async () => { view.rerender({ graphVisible: false }); });
    expect(useEditorStore.getState().graphData).toBeNull();
  });
});

describe("useLinkIndex — link activation", () => {
  /** Mount the hook over a real DOM node standing in for the rich pane, and
   *  return a click() that dispatches on an anchor inside it. */
  function withPane(docs, params = {}) {
    storage = fakeStorage(docs);
    useDocumentStore.setState({
      getStorage: () => storage,
      documents: docs.map((d) => ({ id: d.id, title: d.title, updated: d.updated })),
      activeDocId: docs[0]?.id ?? null,
    });
    const dom = document.createElement("div");
    document.body.appendChild(dom);
    const toast = { show: vi.fn() };
    const handleSwitchDoc = vi.fn();
    const onAnchorNavigate = vi.fn();
    const view = renderHook(() =>
      useLinkIndex({
        tiptapRef: { current: { getEditor: () => ({ view: { dom } }) } },
        handleSwitchDoc,
        toast,
        editorReady: true,
        onAnchorNavigate,
        ...params,
      })
    );
    const click = (attrs, inner = "link") => {
      dom.innerHTML = `<a ${Object.entries(attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ")}>${inner}</a>`;
      const a = dom.querySelector("a");
      const e = new MouseEvent("click", { bubbles: true, cancelable: true });
      a.dispatchEvent(e);
      return e;
    };
    return { view, dom, toast, handleSwitchDoc, onAnchorNavigate, click };
  }

  afterEach(() => {
    for (const d of [...document.body.children]) d.remove();
  });

  it("switches to the document a wiki link names, matching on title", async () => {
    const rig = withPane([doc("a"), doc("b", { title: "Meeting Notes" })]);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const e = rig.click({ "data-doc-link": "meeting notes" });
    expect(rig.handleSwitchDoc).toHaveBeenCalledWith("b");
    expect(e.defaultPrevented).toBe(true);
  });

  it("scrolls without switching for a same-document anchor", async () => {
    // `[[#Heading]]` renders as data-doc-link="" — empty, not absent — so the
    // handler has to distinguish "no target" from "not a wiki link".
    const rig = withPane([doc("a")]);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    rig.click({ "data-doc-link": "", "data-anchor": "Setup" });
    expect(rig.onAnchorNavigate).toHaveBeenCalledWith(null, "Setup");
    expect(rig.handleSwitchDoc).not.toHaveBeenCalled();
  });

  it("navigates to a heading in ANOTHER document without a bare switch", async () => {
    const rig = withPane([doc("a"), doc("b", { title: "Guide" })]);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    rig.click({ "data-doc-link": "Guide", "data-anchor": "Install" });
    expect(rig.onAnchorNavigate).toHaveBeenCalledWith("b", "Install");
    expect(rig.handleSwitchDoc).not.toHaveBeenCalled();
  });

  it("says so when the target does not exist", async () => {
    const rig = withPane([doc("a")]);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    rig.click({ "data-doc-link": "Nowhere" });
    expect(rig.handleSwitchDoc).not.toHaveBeenCalled();
    expect(rig.toast.show.mock.calls[0][0]).toContain("Nowhere");
  });

  it("opens an external link in a new tab, with noopener", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const rig = withPane([doc("a")]);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    rig.click({ href: "https://example.com/page" });
    expect(open).toHaveBeenCalledWith("https://example.com/page", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("never opens a javascript: href", async () => {
    // NOTE: two guards stop this and no test can tell them apart —
    // `isExternalHref` allows only http/https/mailto/tel, and `isDangerousUrl`
    // rejects javascript:/vbscript:/unsafe data:. The two sets are DISJOINT
    // today, so the second check is unreachable belt-and-braces; it earns its
    // place only if the external allow-list ever widens. What is held here is
    // the outcome: nothing navigates.

    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const rig = withPane([doc("a")]);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    rig.click({ href: "javascript:alert(1)" });
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("lets a host take over navigation by returning true", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const onLinkClick = vi.fn(() => true);
    const rig = withPane([doc("a"), doc("b", { title: "Target" })], { onLinkClick });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    rig.click({ href: "https://example.com" });
    expect(open).not.toHaveBeenCalled();

    rig.click({ "data-doc-link": "Target" });
    expect(rig.handleSwitchDoc).not.toHaveBeenCalled();
    expect(onLinkClick).toHaveBeenCalledTimes(2);
    open.mockRestore();
  });

  it("ignores a click that is not on a link, and a bare '#' href", async () => {
    const rig = withPane([doc("a")]);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    rig.dom.innerHTML = "<p>just text</p>";
    rig.dom.querySelector("p").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const e = rig.click({ href: "#" });
    expect(e.defaultPrevented).toBe(false);
    expect(rig.handleSwitchDoc).not.toHaveBeenCalled();
  });
});
