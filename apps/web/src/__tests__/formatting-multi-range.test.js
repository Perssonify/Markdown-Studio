import { renderHook } from "@testing-library/react";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { marked } from "marked";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMdFormatting } from "../formatting/md-format-utils";
import { useFormatDispatcher } from "../formatting/useFormatDispatcher";
import { useUIStore } from "../store/uiStore";

/**
 * A054 — Select ▸ All headings + Bold destroyed the first heading and ignored
 * the rest: the scope selected the `##` marker along with the text, and every
 * markdown formatter read only `selection.main`. `## Alpha` became
 * `**## Alpha**` (a paragraph) and the other headings were untouched — the
 * feature's documented purpose.
 *
 * A055 — markdown-pane Clear formatting DELETED content: images, autolinks,
 * list bullets, the `*` in `5 * 3 * 2`, the contents of code spans.
 */

const liveViews = [];
afterEach(() => { while (liveViews.length) liveViews.pop().destroy(); });

function cm(doc, ranges) {
  const state = EditorState.create({
    doc,
    selection: ranges ? EditorSelection.create(ranges.map(([a, b]) => EditorSelection.range(a, b))) : undefined,
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
  const view = new EditorView({ state, parent: document.createElement("div") });
  liveViews.push(view);
  return { view, ref: { current: { getView: () => view, getValue: () => view.state.doc.toString(), focus: () => {} } } };
}

function dispatcher(cmRef) {
  const { result } = renderHook(() =>
    useFormatDispatcher({ cmRef, tiptapRef: { current: null }, mode: "md", syncMdToHtml: vi.fn(), scheduleAutosave: vi.fn() })
  );
  return result.current.dispatch;
}

const text = (v) => v.state.doc.toString();
const selectedTexts = (v) => v.state.selection.ranges.map((r) => v.state.sliceDoc(r.from, r.to));

beforeEach(() => useUIStore.setState({ readOnly: false, caseContentOnly: true }));

describe("Select ▸ All headings, then format (A054)", () => {
  const DOC = "## Alpha\n\nprose\n\n## Beta\n\n### Gamma\n";

  it("bolds EVERY heading's text and leaves every heading a heading (the reported repro)", () => {
    const { view, ref } = cm(DOC);
    const dispatch = dispatcher(ref);
    dispatch("selectScope", { scope: "headings" });
    dispatch("bold");
    expect(text(view)).toBe("## **Alpha**\n\nprose\n\n## **Beta**\n\n### **Gamma**\n");
    const html = marked.parse(text(view));
    expect(html).toContain("<h2><strong>Alpha</strong></h2>");
    expect(html).toContain("<h2><strong>Beta</strong></h2>");
    expect(html).toContain("<h3><strong>Gamma</strong></h3>");
    // The selection still covers each heading's text, so the next command
    // (a second Bold, a case change) applies to all of them again.
    expect(selectedTexts(view)).toEqual(["Alpha", "Beta", "Gamma"]);
    dispatch("bold");
    expect(text(view)).toBe(DOC);
  });

  it("changes the case of every heading", () => {
    const { view, ref } = cm(DOC);
    const dispatch = dispatcher(ref);
    dispatch("selectScope", { scope: "headings" });
    dispatch("changeCase", "upper");
    expect(text(view)).toBe("## ALPHA\n\nprose\n\n## BETA\n\n### GAMMA\n");
  });

  it("re-levels every selected heading, rewriting only the marker", () => {
    const { view, ref } = cm(DOC);
    const dispatch = dispatcher(ref);
    dispatch("selectScope", { scope: "h2" });
    dispatch("heading", 4);
    expect(text(view)).toBe("#### Alpha\n\nprose\n\n#### Beta\n\n### Gamma\n");
    expect(selectedTexts(view)).toEqual(["Alpha", "Beta"]);
  });
});

describe("every markdown formatter applies to every range (A054)", () => {
  // Two ranges: "one" and "two".
  const DOC = "one and two";
  const RANGES = [[0, 3], [8, 11]];

  const CASES = [
    ["italic", undefined, "*one* and *two*"],
    ["strikethrough", undefined, "~~one~~ and ~~two~~"],
    ["underline", undefined, "<u>one</u> and <u>two</u>"],
    ["code", undefined, "`one` and `two`"],
    ["foreColor", "red", '<span style="color: red">one</span> and <span style="color: red">two</span>'],
  ];
  for (const [cmd, value, expected] of CASES) {
    it(`${cmd}`, () => {
      const { view, ref } = cm(DOC, RANGES);
      dispatcher(ref)(cmd, value);
      expect(text(view)).toBe(expected);
    });
  }

  it("line prefixes cover the lines of every range", () => {
    const { view, ref } = cm("a\nb\nc\nd", [[0, 1], [4, 5]]); // lines 1 and 3
    dispatcher(ref)("blockquote");
    expect(text(view)).toBe("> a\nb\n> c\nd");
  });

  it("task toggles cover the lines of every range", () => {
    const { view, ref } = cm("a\nb\nc", [[0, 1], [4, 5]]);
    dispatcher(ref)("taskList");
    expect(text(view)).toBe("- [ ] a\nb\n- [ ] c");
  });

  it("clearing a colour works on every range", () => {
    const doc = '<span style="color: red">one</span> and <span style="color: red">two</span>';
    const { view, ref } = cm(doc, [[0, 35], [40, doc.length]]);
    dispatcher(ref)("unsetColor");
    expect(text(view)).toBe("one and two");
  });

  it("a single range behaves exactly as before", () => {
    const { view, ref } = cm("hello world", [[0, 5]]);
    dispatcher(ref)("bold");
    expect(text(view)).toBe("**hello** world");
    expect(selectedTexts(view)).toEqual(["hello"]);
  });
});

describe("Clear formatting removes formatting, never content (A055)", () => {
  const cases = [
    ["emphasis and strike", "**bold** *it* _em_ __strong__ ~~gone~~ ***both***", "bold it em strong gone both"],
    ["arithmetic survives", "5 * 3 * 2 = 30", "5 * 3 * 2 = 30"],
    ["list bullets survive", "* item one\n* item two\n- dash", "* item one\n* item two\n- dash"],
    ["images survive", 'see ![alt *x*](a_b.png) and <img src="c.png" alt="*y*">', 'see ![alt *x*](a_b.png) and <img src="c.png" alt="*y*">'],
    ["autolinks survive", "go to <https://example.com/a_b_c> now", "go to <https://example.com/a_b_c> now"],
    ["bare URLs survive", "https://example.com/some_file_name.md is *here*", "https://example.com/some_file_name.md is here"],
    ["code contents survive", "run `a*b*c` and `x_y_z`", "run `a*b*c` and `x_y_z`"],
    ["snake_case survives", "call my_function_name()", "call my_function_name()"],
    ["formatting tags are unwrapped", '<u>under</u> <sub>2</sub> <span style="color: red">red</span>', "under 2 red"],
    ["structural tags survive", "<details>\n<summary>S</summary>\n</details>", "<details>\n<summary>S</summary>\n</details>"],
    ["links keep their URL", "a [**label**](https://x.io/a_b) b", "a [label](https://x.io/a_b) b"],
    ["an unmatched ** does not pair across lines", "**open\n\ntext **bold**", "**open\n\ntext bold"],
    ["horizontal rules survive", "***\n\n* * *", "***\n\n* * *"],
    ["intraword * is emphasis (as it renders)", "a*b*c", "abc"],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => expect(clearMdFormatting(input)).toBe(expected));
  }

  it("the command clears every range, and only the selected text", () => {
    const doc = "**one** **keep** **two**";
    const { view, ref } = cm(doc, [[0, 7], [17, 24]]);
    dispatcher(ref)("clearFormatting");
    expect(text(view)).toBe("one **keep** two");
  });

  it("the command itself never deletes content (the reported cases, through dispatch)", () => {
    const doc = "5 * 3 * 2 <img src=\"a.png\"> <https://x.io> `c*d*e` **bold**";
    const { view, ref } = cm(doc, [[0, doc.length]]);
    dispatcher(ref)("clearFormatting");
    expect(text(view)).toBe("5 * 3 * 2 <img src=\"a.png\"> <https://x.io> `c*d*e` bold");
  });

  it("dispatches nothing when there is nothing to clear", () => {
    const { view, ref } = cm("plain text", [[0, 5]]);
    const before = view.state;
    dispatcher(ref)("removeFormat");
    expect(view.state).toBe(before);
  });
});
