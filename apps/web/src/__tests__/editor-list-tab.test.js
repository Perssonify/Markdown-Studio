/**
 * Tab next to a list keeps its pre-3.31 meaning in the rich pane.
 *
 * Tiptap 3.31 (taken for its security fixes, A113) gave `ListKeymap` a Tab
 * binding: with the caret at the start of a paragraph that directly follows a
 * list, Tab moves the paragraph INTO the list's last item. In this editor
 * indent means list nesting only (a no-op on a paragraph), and outside a list
 * item Tab is a focus key, so the pane registers `ListKeymapNoTab` instead.
 * The first case proves the upstream behaviour is really there to suppress —
 * without it the pane case would pass whether or not the fix is wired.
 */
import { act, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { createElement, createRef } from "react";
import { describe, expect, it } from "vitest";
import { TiptapPane } from "../ui/panes/tiptapPane";

const tab = () => new KeyboardEvent("keydown", { key: "Tab", code: "Tab", bubbles: true, cancelable: true });
const LIST_THEN_PARA = "<ul><li><p>alpha</p></li></ul><p>bravo</p>";

/** Put the caret at the start of the first textblock whose text is `text`. */
function caretAtStartOf(editor, text) {
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (pos < 0 && node.isTextblock && node.textContent === text) pos = p + 1;
  });
  editor.commands.setTextSelection(pos);
}

describe("Tab after a list (rich pane)", () => {
  it("upstream: stock StarterKit moves the paragraph into the list", () => {
    const editor = new Editor({ extensions: [StarterKit], content: LIST_THEN_PARA });
    caretAtStartOf(editor, "bravo");
    const e = tab();
    editor.view.dom.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(editor.getHTML()).toBe("<ul><li><p>alpha</p><p>bravo</p></li></ul><p></p>");
    editor.destroy();
  });

  it("the pane leaves the paragraph where it is and does not take the Tab", async () => {
    const ref = createRef();
    let view;
    await act(async () => { view = render(createElement(TiptapPane, { ref, isDark: false, defaultValue: LIST_THEN_PARA })); });
    const editor = ref.current.getEditor();
    caretAtStartOf(editor, "bravo");
    const e = tab();
    editor.view.dom.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(editor.getHTML()).toBe(LIST_THEN_PARA);
    view.unmount();
  });

  it("Tab INSIDE a list item still nests it (the list item's own binding)", async () => {
    const ref = createRef();
    let view;
    await act(async () => {
      view = render(createElement(TiptapPane, { ref, isDark: false, defaultValue: "<ul><li><p>one</p></li><li><p>two</p></li></ul>" }));
    });
    const editor = ref.current.getEditor();
    caretAtStartOf(editor, "two");
    const e = tab();
    editor.view.dom.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    // (The pane keeps a trailing paragraph after a final list; not part of this.)
    expect(editor.getHTML().startsWith("<ul><li><p>one</p><ul><li><p>two</p></li></ul></li></ul>")).toBe(true);
    view.unmount();
  });
});
