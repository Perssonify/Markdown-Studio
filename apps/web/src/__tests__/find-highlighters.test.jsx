import { createRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { CodeMirrorPane } from "../ui/CodeMirrorPane";
import { TiptapPane } from "../ui/TiptapPane";

/**
 * A067 / A061. Both panes' search highlighters used to re-run the query
 * themselves — with a hard-coded "gi" (ignoring Match case / Whole word),
 * `toLowerCase().indexOf` for literal text (misaligned after "İ"), and the
 * user's regex on the main thread again. They now draw exactly the ranges the
 * Find panel computed, and map them through edits until the panel resends.
 */

beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getClientRects ??= () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
  Range.prototype.getBoundingClientRect ??= () => rect;
});
afterEach(() => cleanup());

describe("markdown pane", () => {
  function mount(doc) {
    const ref = createRef();
    render(<CodeMirrorPane ref={ref} isDark={false} defaultValue={doc} />);
    return ref;
  }
  const texts = (ref, sel) => [...ref.current.getView().contentDOM.querySelectorAll(sel)].map((e) => e.textContent);

  it("draws the given ranges and their groups — nothing it was not given", () => {
    const ref = mount("Foo foo FOO");
    act(() => ref.current.setSearchHighlight({ ranges: [{ from: 0, to: 3, groups: [[1, 2]] }], replaceMode: false }));
    // Only the first "Foo" — the pane no longer decides for itself what matches.
    expect(texts(ref, ".cm-searchMatch").join("")).toBe("Foo");
    expect(texts(ref, ".cm-searchGroup-1")).toEqual(["o"]);
  });

  it("maps the highlight through an edit", () => {
    const ref = mount("foo bar");
    act(() => ref.current.setSearchHighlight({ ranges: [{ from: 4, to: 7 }], replaceMode: false }));
    act(() => ref.current.getView().dispatch({ changes: { from: 0, insert: "XX " } }));
    expect(texts(ref, ".cm-searchMatch").join("")).toBe("bar");
  });

  it("draws replace previews, and clears", () => {
    const ref = mount("a 12px");
    act(() => ref.current.setSearchHighlight({ ranges: [{ from: 2, to: 4, preview: "[12]" }], replaceMode: true }));
    expect(texts(ref, ".cm-replaceOld").join("")).toBe("12");
    expect(ref.current.getView().contentDOM.textContent).toContain("[12]");
    act(() => ref.current.clearSearchHighlight());
    expect(texts(ref, ".cm-replaceOld")).toEqual([]);
    expect(texts(ref, ".cm-searchMatch")).toEqual([]);
  });

  it("ignores zero-length and out-of-range entries instead of throwing", () => {
    const ref = mount("abc");
    expect(() =>
      act(() => ref.current.setSearchHighlight({ ranges: [{ from: 1, to: 1 }, { from: 2, to: 99 }], replaceMode: false }))
    ).not.toThrow();
    expect(texts(ref, ".cm-searchMatch")).toEqual([]);
  });
});

describe("rich pane", () => {
  async function mount(html) {
    const ref = createRef();
    await act(async () => { render(<TiptapPane ref={ref} isDark={false} defaultValue={html} />); });
    return ref;
  }
  const texts = (ref, sel) => [...ref.current.getEditor().view.dom.querySelectorAll(sel)].map((e) => e.textContent);

  it("draws the given ranges, maps them through an edit, and clears", async () => {
    const ref = await mount("<p>foo bar</p>");
    // "bar" is at PM positions 5..8 (1 for the paragraph opening).
    act(() => ref.current.setSearchHighlight({ ranges: [{ from: 5, to: 8 }], replaceMode: false }));
    expect(texts(ref, ".search-highlight")).toEqual(["bar"]);
    act(() => ref.current.getEditor().commands.insertContentAt(1, "XX "));
    expect(texts(ref, ".search-highlight")).toEqual(["bar"]);
    act(() => ref.current.clearSearchHighlight());
    expect(texts(ref, ".search-highlight")).toEqual([]);
  });

  it("draws replace previews", async () => {
    const ref = await mount("<p>a 12px</p>");
    act(() => ref.current.setSearchHighlight({ ranges: [{ from: 3, to: 5, preview: "[12]" }], replaceMode: true }));
    expect(texts(ref, ".replace-preview-old")).toEqual(["12"]);
    expect(ref.current.getEditor().view.dom.textContent).toContain("[12]");
  });
});
