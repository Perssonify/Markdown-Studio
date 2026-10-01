import { EditorState } from "@codemirror/state";
import { createRef } from "react";
import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mdIndentable, useFormatDispatcher } from "../formatting/useFormatDispatcher";
import { TiptapPane } from "../ui/TiptapPane";

/**
 * Indent / outdent mean ONE thing in a markdown document: a list item's nesting
 * depth. There is no paragraph indent to represent, so both panes must refuse
 * the same cases — and the markdown side has a sharper reason than symmetry.
 * Four leading spaces on a paragraph is an INDENTED CODE BLOCK: measured in a
 * browser, two clicks of Indent turned a paragraph into `<pre>` in the rich
 * pane. A button labelled "Indent" must not silently change what a block IS.
 */

/** A minimal stand-in for the CM view: mdIndentable reads state.doc + selection. */
function view(text, cursorLine = 1, endLine = cursorLine) {
  const state = EditorState.create({ doc: text });
  const from = state.doc.line(cursorLine).from;
  const to = state.doc.line(endLine).to;
  return { state: { ...state, selection: { main: { from, to } }, doc: state.doc } };
}

describe("mdIndentable — where indentation carries meaning", () => {
  it("allows a bullet item", () => {
    expect(mdIndentable(view("- alpha\n- bravo", 2))).toBe(true);
  });

  it("allows the other bullet markers and ordered items", () => {
    for (const line of ["* a", "+ a", "1. a", "2) a"]) {
      expect(mdIndentable(view(`x\n${line}`, 2))).toBe(true);
    }
  });

  it("allows an already-indented nested item", () => {
    expect(mdIndentable(view("- alpha\n    - bravo", 2))).toBe(true);
  });

  it("REFUSES a plain paragraph — four spaces there is a code block", () => {
    expect(mdIndentable(view("Just some prose.", 1))).toBe(false);
  });

  it("refuses a heading and a blockquote line", () => {
    expect(mdIndentable(view("# Title", 1))).toBe(false);
    expect(mdIndentable(view("> quoted", 1))).toBe(false);
  });

  it("allows lines INSIDE a fenced block, where indentation is the code", () => {
    const doc = "text\n\n```js\nconst a = 1;\n```\n\nmore";
    expect(mdIndentable(view(doc, 4))).toBe(true);   // inside the fence
    expect(mdIndentable(view(doc, 7))).toBe(false);  // prose after it
  });

  it("counts fences so a line after a CLOSED block is not treated as code", () => {
    const doc = "```\ncode\n```\nprose";
    expect(mdIndentable(view(doc, 2))).toBe(true);
    expect(mdIndentable(view(doc, 4))).toBe(false);
  });

  it("blank lines inside a selection ride along", () => {
    expect(mdIndentable(view("- a\n\n- b", 1, 3))).toBe(true);
  });

  it("a multi-line selection is refused if ANY line is prose", () => {
    expect(mdIndentable(view("- a\nprose\n- b", 1, 3))).toBe(false);
  });
});

/**
 * The rich side. `sinkListItem("listItem")` was hardcoded, so indent did nothing
 * at all inside a TASK list — whose item node is `taskItem`, and which TaskItem
 * is configured to nest.
 */
describe("rich pane list nesting", () => {
  async function pane(html) {
    const ref = createRef();
    await act(async () => {
      render(<TiptapPane ref={ref} isDark={false} defaultValue={html} />);
    });
    return ref.current.getEditor();
  }
  const caretOn = (ed, text) => {
    let pos = null;
    ed.state.doc.descendants((n, p) => { if (n.isText && n.text === text) pos = p + 1; });
    ed.commands.setTextSelection(pos);
  };

  it("sinks a bullet item under its predecessor", async () => {
    const ed = await pane("<ul><li><p>alpha</p></li><li><p>bravo</p></li></ul>");
    caretOn(ed, "bravo");
    expect(ed.can().sinkListItem("listItem")).toBe(true);
  });

  it("sinks a TASK item — the case the hardcoded node name missed", async () => {
    const ed = await pane(
      '<ul data-type="taskList">' +
        '<li data-type="taskItem" data-checked="false"><p>one</p></li>' +
        '<li data-type="taskItem" data-checked="false"><p>two</p></li>' +
      "</ul>"
    );
    caretOn(ed, "two");
    expect(ed.isActive("taskItem")).toBe(true);
    // The name the dispatcher must choose from the selection.
    expect(ed.can().sinkListItem("taskItem")).toBe(true);
    // …and the one it used to hardcode, which cannot work here.
    expect(ed.can().sinkListItem("listItem")).toBe(false);
  });

  it("cannot sink a FIRST item — nothing to nest under, in any editor", async () => {
    const ed = await pane("<ul><li><p>alpha</p></li><li><p>bravo</p></li></ul>");
    caretOn(ed, "alpha");
    expect(ed.can().sinkListItem("listItem")).toBe(false);
  });

  it("has no paragraph indent to offer", async () => {
    const ed = await pane("<p>just prose</p>");
    caretOn(ed, "just prose");
    expect(ed.can().sinkListItem("listItem")).toBe(false);
  });
});

/**
 * The WIRING, not just the pieces.
 *
 * The two tests above hold `mdIndentable` and the rich pane's capability, and
 * both survived a mutation that removed the dispatcher's use of them — the
 * exact vacuous shape this suite exists to avoid. These drive `dispatch` itself
 * with real editors behind the refs, so the guard has to be CALLED to pass.
 */
describe("dispatch('indent') wiring", () => {
  const mdView = (doc) => {
    const state = EditorState.create({
      doc,
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });
    let cur = state;
    return {
      getView: () => ({
        get state() { return cur; },
        dispatch(spec) { cur = cur.update(spec).state; },
        focus() {},
      }),
      text: () => cur.doc.toString(),
      setCaret(n) {
        const p = cur.doc.line(n).from;
        cur = cur.update({ selection: { anchor: p } }).state;
      },
    };
  };

  async function rig({ doc = "", mode = "md", richHtml = "<p>x</p>" } = {}) {
    const cm = mdView(doc);
    const ref = createRef();
    await act(async () => {
      render(<TiptapPane ref={ref} isDark={false} defaultValue={richHtml} />);
    });
    const hook = renderHook(() =>
      useFormatDispatcher({
        cmRef: { current: cm },
        tiptapRef: { current: ref.current },
        mode,
        syncMdToHtml: () => {},
        syncHtmlToMd: () => {},
        scheduleAutosave: () => {},
        onFormatsChange: () => {},
      })
    );
    return { cm, editor: ref.current.getEditor(), dispatch: hook.result.current.dispatch };
  }

  it("does NOT indent a paragraph in the markdown pane", async () => {
    const { cm, dispatch } = await rig({ doc: "Just prose." });
    cm.setCaret(1);
    await act(async () => { dispatch("indent"); });
    expect(cm.text()).toBe("Just prose.");
  });

  it("DOES indent a list item in the markdown pane", async () => {
    const { cm, dispatch } = await rig({ doc: "- alpha\n- bravo" });
    cm.setCaret(2);
    await act(async () => { dispatch("indent"); });
    expect(cm.text().split("\n")[1]).toMatch(/^\s+- bravo$/);
  });

  it("indents a TASK item in the rich pane", async () => {
    const { editor, dispatch } = await rig({
      mode: "html",
      richHtml:
        '<ul data-type="taskList">' +
          '<li data-type="taskItem" data-checked="false"><p>one</p></li>' +
          '<li data-type="taskItem" data-checked="false"><p>two</p></li>' +
        "</ul>",
    });
    let pos = null;
    editor.state.doc.descendants((n, p) => { if (n.isText && n.text === "two") pos = p + 1; });
    editor.commands.setTextSelection(pos);
    await act(async () => { dispatch("indent"); });
    expect(editor.getHTML()).toMatch(/<li[^>]*>[\s\S]*<ul/);
  });

  it("indents a bullet item in the rich pane", async () => {
    const { editor, dispatch } = await rig({
      mode: "html",
      richHtml: "<ul><li><p>alpha</p></li><li><p>bravo</p></li></ul>",
    });
    let pos = null;
    editor.state.doc.descendants((n, p) => { if (n.isText && n.text === "bravo") pos = p + 1; });
    editor.commands.setTextSelection(pos);
    await act(async () => { dispatch("indent"); });
    expect(editor.getHTML()).toMatch(/<li[^>]*>[\s\S]*<ul/);
  });
});
