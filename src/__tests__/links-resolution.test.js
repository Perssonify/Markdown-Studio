import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setWikiLinkLibrary, UnresolvedWikiLinks } from "../extensions/UnresolvedWikiLinks";
import { WikiLink } from "../extensions/WikiLink";
import { useLinkIndex } from "../hooks/useLinkIndex";
import { buildLinkIndex, resolveWikiLink, scanWikiLinks } from "../store/link-index";
import { useDocumentStore } from "../store/documentStore";
import { useEditorStore } from "../store/editorStore";

const para = (...content) => ({ type: "paragraph", content });
const text = (t, marks) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });
const wiki = (docLink, anchor) => ({ type: "link", attrs: { docLink, anchor: anchor ?? null, href: "#" } });
const doc = (id, title, ...blocks) => ({ id, title, canonical: { type: "doc", content: blocks.length ? blocks : [para(text("body"))] } });

/**
 * A059. Resolution sent links to the wrong document: partial `includes`
 * matching made `[[C# Tips]]` — which the renderer splits into docLink "C" +
 * anchor "Tips" — resolve to "Changelog" in the graph and backlinks, while a
 * click on the same link said "Document not found". Titles containing "#"
 * could not be linked at all.
 */
describe("one resolver for every consumer (A059)", () => {
  const library = [doc("chg", "Changelog"), doc("cs", "C# Tips"), doc("c", "C")];

  it("tries the WHOLE reference as a title before splitting it on '#'", () => {
    expect(resolveWikiLink("C", "Tips", library)).toEqual({ id: "cs", anchor: null });
  });

  it("falls back to document + heading when no title has the '#'", () => {
    expect(resolveWikiLink("C", "Setup", library)).toEqual({ id: "c", anchor: "Setup" });
  });

  it("never resolves a fragment of a title", () => {
    const onlyChangelog = [doc("chg", "Changelog")];
    expect(resolveWikiLink("C", "Tips", onlyChangelog)).toBeNull();
    expect(resolveWikiLink("Change", null, onlyChangelog)).toBeNull();
  });

  it("is case- and NFKC-insensitive on exact titles", () => {
    expect(resolveWikiLink("c# TIPS", null, library)).toEqual({ id: "cs", anchor: null });
    expect(resolveWikiLink("Café", null, [doc("x", "Café")])).toEqual({ id: "x", anchor: null });
  });

  it("the index sends [[C# Tips]] to 'C# Tips' — rendered mark and literal text alike", () => {
    const src = doc(
      "src", "Source",
      para(text("C# Tips", [wiki("C", "Tips")])),
      para(text("see [[C# Tips]] too"))
    );
    const links = scanWikiLinks(src.canonical);
    expect(links.map((l) => [l.target, l.anchor])).toEqual([["C", "Tips"], ["C", "Tips"]]);
    const idx = buildLinkIndex([...library, src]);
    expect([...idx.forward.get("src")]).toEqual(["cs"]);
    expect(idx.reverse.get("chg")).toBeUndefined();
  });

  it("a partial-only target is UNRESOLVED in the index (and carries its anchor)", () => {
    const src = doc("src", "Source", para(text("C# Tips", [wiki("C", "Tips")])));
    const idx = buildLinkIndex([doc("chg", "Changelog"), src]);
    expect(idx.forward.get("src")).toBeUndefined();
    expect(idx.unresolved.get("src")).toEqual([{ target: "C", displayText: "C# Tips", anchor: "Tips" }]);
  });
});

// ── The rich pane: clicks (A059 + A064) ─────────────────────────────────────

function fakeStorage(docs) {
  const map = new Map(docs.map((d) => [d.id, d]));
  return {
    async list() { return [...map.values()].map((d) => ({ id: d.id })); },
    async get(id) { return map.get(id) ?? null; },
  };
}

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

function mountHook(docs, tiptapRef) {
  useDocumentStore.setState({
    getStorage: () => fakeStorage(docs),
    documents: docs.map((d) => ({ id: d.id, title: d.title, updated: "2024-01-01T00:00:00.000Z" })),
    activeDocId: docs[0]?.id ?? null,
  });
  const calls = { handleSwitchDoc: vi.fn(), onAnchorNavigate: vi.fn(), toast: { show: vi.fn() } };
  const view = renderHook(() =>
    useLinkIndex({ tiptapRef, handleSwitchDoc: calls.handleSwitchDoc, toast: calls.toast, editorReady: true, onAnchorNavigate: calls.onAnchorNavigate })
  );
  return { ...calls, view };
}

function paneWithLink(attrs) {
  const dom = document.createElement("div");
  dom.innerHTML = `<a ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ")}>link</a>`;
  document.body.appendChild(dom);
  return dom;
}
const clickLink = (dom) => {
  const e = new MouseEvent("click", { bubbles: true, cancelable: true });
  dom.querySelector("a").dispatchEvent(e);
  return e;
};

describe("link clicks", () => {
  beforeEach(() => {
    useEditorStore.setState({ linkIndex: { forward: new Map(), reverse: new Map(), unresolved: new Map(), contexts: new Map() } });
  });
  afterEach(() => {
    for (const el of [...document.body.children]) el.remove();
    useDocumentStore.setState({ documents: [], activeDocId: null });
    setWikiLinkLibrary(null);
  });

  it("a click on [[C# Tips]] opens 'C# Tips' — the same answer the graph gives (A059)", async () => {
    const dom = paneWithLink({ "data-doc-link": "C", "data-anchor": "Tips", href: "#" });
    const rig = mountHook([doc("chg", "Changelog"), doc("cs", "C# Tips")], { current: { getEditor: () => ({ view: { dom } }) } });
    await settle();
    clickLink(dom);
    expect(rig.handleSwitchDoc).toHaveBeenCalledWith("cs");
    expect(rig.onAnchorNavigate).not.toHaveBeenCalled(); // the "#" was part of the title
  });

  it("keeps working after the editor REMOUNTS — a new view.dom, same hook (A064)", async () => {
    // Closing the last document unmounts the editor; opening another mounts a
    // new one. The listener used to stay bound to the destroyed editor's DOM.
    let dom = paneWithLink({ "data-doc-link": "b", href: "#" });
    const ref = { current: { getEditor: () => ({ view: { dom } }) } };
    const rig = mountHook([doc("a", "A"), doc("b", "b")], ref);
    await settle();
    clickLink(dom);
    expect(rig.handleSwitchDoc).toHaveBeenCalledTimes(1);

    dom.remove();
    dom = paneWithLink({ "data-doc-link": "b", href: "#" }); // the remounted editor
    const e = clickLink(dom);
    expect(rig.handleSwitchDoc).toHaveBeenCalledTimes(2);
    expect(e.defaultPrevented).toBe(true); // and "#" did not navigate the page
  });

  it("ignores links that are not inside the editor (e.g. a card's rendered preview)", async () => {
    const editorDom = document.createElement("div");
    document.body.appendChild(editorDom);
    const elsewhere = paneWithLink({ "data-doc-link": "b", href: "#" });
    const rig = mountHook([doc("a", "A"), doc("b", "b")], { current: { getEditor: () => ({ view: { dom: editorDom } }) } });
    await settle();
    const e = clickLink(elsewhere);
    expect(rig.handleSwitchDoc).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });
});

// ── Broken-link marking (A058) ──────────────────────────────────────────────

describe("broken wiki links are marked (A058)", () => {
  let editor;
  const make = (html) => {
    editor = new Editor({
      extensions: [StarterKit.configure({ link: false }), WikiLink, UnresolvedWikiLinks],
      content: html,
    });
    return editor;
  };
  const brokenTexts = () =>
    [...editor.view.dom.querySelectorAll(".wiki-link-unresolved")].map((el) => el.textContent);
  afterEach(() => { editor?.destroy(); editor = null; setWikiLinkLibrary(null); });

  const HTML =
    '<p><a data-doc-link="Ghost" class="wiki-link" href="#">Ghost</a> · ' +
    '<a data-doc-link="Real" class="wiki-link" href="#">Real</a> · ' +
    '<a data-doc-link="" data-anchor="Top" class="wiki-link" href="#">Top</a> · ' +
    '<a data-doc-link="C" data-anchor="Tips" class="wiki-link" href="#">C# Tips</a></p>';

  it("marks exactly the links whose target does not exist", () => {
    make(HTML);
    setWikiLinkLibrary([doc("r", "Real"), doc("cs", "C# Tips")], editor);
    // Not "Real", not the same-document anchor, not the "#"-titled note.
    expect(brokenTexts()).toEqual(["Ghost"]);
    // Inside the link, where the stylesheet looks for it.
    expect(editor.view.dom.querySelector("a.wiki-link .wiki-link-unresolved")).not.toBeNull();
  });

  it("stays correct across an edit that shifts every position", () => {
    make(HTML);
    setWikiLinkLibrary([doc("r", "Real")], editor);
    editor.commands.insertContentAt(0, "<p>A new first paragraph</p>");
    expect(brokenTexts()).toEqual(["Ghost", "C# Tips"]);
  });

  it("judges a link the moment it is typed — not after the next save and re-index", () => {
    // The DOM-attribute version re-ran only when the INDEX changed.
    make("<p>start</p>");
    setWikiLinkLibrary([doc("r", "Real")], editor);
    editor.commands.insertContentAt(
      editor.state.doc.content.size,
      '<p><a data-doc-link="Nowhere" class="wiki-link" href="#">Nowhere</a></p>'
    );
    expect(brokenTexts()).toEqual(["Nowhere"]);
  });

  it("clears the mark once the missing document exists", () => {
    make(HTML);
    setWikiLinkLibrary([doc("r", "Real")], editor);
    expect(brokenTexts()).toContain("Ghost");
    setWikiLinkLibrary([doc("r", "Real"), doc("g", "Ghost"), doc("cs", "C# Tips")], editor);
    expect(brokenTexts()).toEqual([]);
  });

  it("marks nothing before a library has loaded (no cold-start flash)", () => {
    setWikiLinkLibrary(null);
    make(HTML);
    expect(brokenTexts()).toEqual([]);
  });

  it("a remounted editor starts from the current library", () => {
    setWikiLinkLibrary([doc("r", "Real"), doc("cs", "C# Tips")]);
    make(HTML);
    expect(brokenTexts()).toEqual(["Ghost"]);
  });

  it("is driven by the link-index hook once the library loads — and not before", async () => {
    make(HTML);
    const docs = [doc("r", "Real"), doc("cs", "C# Tips")];
    useEditorStore.setState({ linkIndex: { forward: new Map(), reverse: new Map(), unresolved: new Map(), contexts: new Map() } });
    mountHook(docs, { current: { getEditor: () => editor } });
    // Mounted, library not read yet: an empty list would call EVERY link broken.
    expect(brokenTexts()).toEqual([]);
    await settle();
    expect(brokenTexts()).toEqual(["Ghost"]);
    useDocumentStore.setState({ documents: [], activeDocId: null });
  });
});
