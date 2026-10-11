import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Editor } from "@tiptap/core";
import { Color } from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BackgroundColor } from "../extensions/BackgroundColor";
import { __resetFindWorkerForTests, __setFindWorkerFactoryForTests, findWorkerSource } from "../formatting/find-worker";
import { FindReplaceBar } from "../ui/find/findReplace";

/**
 * The Find & Replace panel against a REAL CodeMirror view and a REAL TipTap
 * editor. There was no functional test of it at all.
 *
 * A060 — regex replacements re-ran the pattern on the isolated match, so
 *        lookaround patterns were counted but never replaced.
 * A061 — a user regex could freeze the tab (see find-engine.test.js for the
 *        worker; here: the panel reports it instead of hanging).
 * A067 — no `m` flag in the markdown pane; highlights ignored case/whole-word
 *        and misaligned after "İ"; single rich Replace inserted HTML;
 *        zero-length matches never advanced; Highlight wiped colour;
 *        find-as-you-type jumped ahead.
 * A098 — whole word was ASCII-only.
 * A096 — the Find box was labelled only by its placeholder.
 */

beforeAll(() => {
  // jsdom has no Range geometry; CodeMirror and ProseMirror measure when a
  // selection is scrolled into view.
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getClientRects ??= () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
  Range.prototype.getBoundingClientRect ??= () => rect;
});

const cleanups = [];
beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  __setFindWorkerFactoryForTests(null); // the main-thread fallback, as in any Worker-less host
});
afterEach(() => {
  cleanup();
  while (cleanups.length) cleanups.pop()();
  __resetFindWorkerForTests();
});

function mdPane(doc) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [EditorState.allowMultipleSelections.of(true)] }),
    parent,
  });
  const highlights = [];
  cleanups.push(() => { view.destroy(); parent.remove(); });
  return {
    view,
    highlights,
    ref: {
      current: {
        getView: () => view,
        setSearchHighlight: (spec) => highlights.push(spec),
        clearSearchHighlight: () => highlights.push(null),
      },
    },
  };
}

function richPane(html) {
  const editor = new Editor({ extensions: [StarterKit, TextStyle, Color, BackgroundColor], content: html });
  const highlights = [];
  cleanups.push(() => editor.destroy());
  return {
    editor,
    highlights,
    ref: {
      current: {
        getEditor: () => editor,
        setSearchHighlight: (spec) => highlights.push(spec),
        clearSearchHighlight: () => highlights.push(null),
      },
    },
  };
}

const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
const lastSpec = (pane) => [...pane.highlights].reverse().find((h) => h) ?? null;

async function open({ md, rich, target = "md", mode = "split", panelMode = "find", onSync = vi.fn(), syncHtmlToMd = vi.fn() }) {
  const utils = render(
    <FindReplaceBar
      sourceRef={md?.ref ?? { current: null }}
      previewRef={rich?.ref ?? { current: null }}
      mode={mode}
      onSync={onSync}
      syncHtmlToMd={syncHtmlToMd}
      onClose={vi.fn()}
      initialMode={panelMode}
      initialTarget={target}
    />
  );
  await settle();
  const find = screen.getByLabelText(target === "md" ? "Find in Markdown" : "Find in Rich Text");
  return { ...utils, find, onSync, syncHtmlToMd };
}
async function type(input, value) {
  await act(async () => { fireEvent.change(input, { target: { value } }); });
  await settle();
}
async function click(label) {
  await act(async () => { fireEvent.click(screen.getByTitle(label)); });
  await settle();
}
const count = (find) => document.getElementById(find.getAttribute("aria-describedby")).textContent;

describe("the Find box has a real label (A096)", () => {
  it("is named, and described by its match count", async () => {
    const md = mdPane("a b a");
    const { find } = await open({ md, panelMode: "replace" });
    await type(find, "a");
    expect(find.getAttribute("aria-label")).toBe("Find in Markdown");
    expect(count(find)).toBe("1/2");
    expect(screen.getByLabelText("Replace with")).toBeTruthy();
  });
});

describe("regex replacements see their context (A060)", () => {
  it("Replace All with a lookahead — markdown pane", async () => {
    const md = mdPane("width: 12px; margin: 5em; top: 7px");
    const { find } = await open({ md, panelMode: "replace" });
    await click("Toggle Regular Expression Search");
    await type(find, "\\d+(?=px)");
    await type(screen.getByLabelText("Replace with"), "N");
    await click("Replace All");
    expect(md.view.state.doc.toString()).toBe("width: Npx; margin: 5em; top: Npx");
  });

  it("single Replace with a lookahead — markdown pane", async () => {
    const md = mdPane("a 12px b 34px");
    const { find } = await open({ md, panelMode: "replace" });
    await click("Toggle Regular Expression Search");
    await type(find, "\\d+(?=px)");
    await type(screen.getByLabelText("Replace with"), "<$&>");
    await click("Replace"); // the first match is already selected by find-as-you-type
    expect(md.view.state.doc.toString()).toBe("a <12>px b 34px");
  });

  it("Replace All with a lookbehind — rich pane", async () => {
    const rich = richPane("<p>cost $40, or 40</p>");
    const { find } = await open({ rich, target: "richtext", panelMode: "replace" });
    await click("Toggle Regular Expression Search");
    await type(find, "(?<=\\$)\\d+");
    await type(screen.getByLabelText("Replace with"), "50");
    await click("Replace All");
    expect(rich.editor.getText()).toBe("cost $50, or 40");
  });

  it("scoped Replace All touches exactly the matches the count shows", async () => {
    const md = mdPane("# Title 10px\n\nbody 10px");
    const { find } = await open({ md, panelMode: "replace" });
    await click("Toggle Regular Expression Search");
    await click("Scope filter — search only in, or exclude, headings / code / links / emphasis");
    await act(async () => { fireEvent.click(screen.getByText("Headings")); });
    await settle();
    await type(find, "\\d+(?=px)");
    expect(count(find)).toMatch(/\/1$/);
    await type(screen.getByLabelText("Replace with"), "N");
    await click("Replace All");
    expect(md.view.state.doc.toString()).toBe("# Title Npx\n\nbody 10px");
  });
});

describe("smaller Find & Replace defects (A067)", () => {
  it("^ is a LINE anchor in the markdown pane", async () => {
    const md = mdPane("- one\n- two\ntext - three");
    const { find } = await open({ md });
    await click("Toggle Regular Expression Search");
    await type(find, "^- ");
    expect(count(find)).toBe("1/2");
  });

  it("Next advances through zero-length matches", async () => {
    const md = mdPane("a\nb\nc");
    const { find } = await open({ md });
    await click("Toggle Regular Expression Search");
    await type(find, "^");
    const heads = [md.view.state.selection.main.head];
    for (let i = 0; i < 3; i++) {
      await act(async () => { fireEvent.click(screen.getByLabelText("Next match")); });
      await settle();
      heads.push(md.view.state.selection.main.head);
    }
    expect(heads).toEqual([0, 2, 4, 0]);
  });

  it("highlights exactly what is counted — Match case honoured", async () => {
    const md = mdPane("foo Foo FOO");
    const { find } = await open({ md });
    await click("Match case");
    await type(find, "Foo");
    expect(count(find)).toBe("1/1");
    expect(lastSpec(md).ranges.map((r) => [r.from, r.to])).toEqual([[4, 7]]);
  });

  it("highlights stay aligned after an 'İ' (which lower-cases to two code units)", async () => {
    const doc = "İstanbul İzmir foo";
    const md = mdPane(doc);
    const { find } = await open({ md });
    await type(find, "foo");
    expect(lastSpec(md).ranges.map((r) => doc.slice(r.from, r.to))).toEqual(["foo"]);
  });

  it("find-as-you-type does not jump ahead as the query grows", async () => {
    const md = mdPane("ab xx ab");
    const { find } = await open({ md });
    await type(find, "a");
    expect(md.view.state.selection.main.from).toBe(0);
    await type(find, "ab");
    const { from, to } = md.view.state.selection.main;
    expect([from, to]).toEqual([0, 2]);
  });

  it("a single rich-pane Replace inserts TEXT, not HTML", async () => {
    const rich = richPane("<p>replace me here</p>");
    const { find } = await open({ rich, target: "richtext", panelMode: "replace" });
    await type(find, "me");
    await type(screen.getByLabelText("Replace with"), "<b>x</b>");
    await click("Replace");
    expect(rich.editor.getText()).toBe("replace <b>x</b> here");
    expect(rich.editor.getHTML()).not.toContain("<strong>");
  });

  it("Format matches ▸ Highlight keeps the colour a word already had", async () => {
    const rich = richPane('<p><span style="color: #ff0000">red word</span> plain word</p>');
    const { find } = await open({ rich, target: "richtext", panelMode: "replace" });
    await type(find, "word");
    await act(async () => { fireEvent.click(screen.getByTitle("Highlight")); });
    await settle();
    const styles = [];
    rich.editor.state.doc.descendants((n) => {
      if (n.isText && n.text === "word") styles.push(n.marks.find((m) => m.type.name === "textStyle")?.attrs);
    });
    expect(styles).toHaveLength(2);
    expect(styles[0]).toMatchObject({ color: "#ff0000", backgroundColor: "#fef08a" });
    expect(styles[1]).toMatchObject({ backgroundColor: "#fef08a" });
  });

  it("replace-mode previews come from the original match", async () => {
    const md = mdPane("a 12px");
    const { find } = await open({ md, panelMode: "replace" });
    await click("Toggle Regular Expression Search");
    await type(find, "\\d+(?=px)");
    await type(screen.getByLabelText("Replace with"), "[$&]");
    const spec = lastSpec(md);
    expect(spec.replaceMode).toBe(true);
    expect(spec.ranges[0].preview).toBe("[12]");
  });
});

describe("whole word, any script (A098)", () => {
  it("finds 'мир' but not inside 'миров'", async () => {
    const md = mdPane("мир миров мир");
    const { find } = await open({ md });
    await click("Whole word");
    await type(find, "мир");
    expect(count(find)).toBe("1/2");
  });
});

describe("a runaway regex cannot freeze the panel (A061)", () => {
  it("without a Worker, the catastrophic shape is refused and reported", async () => {
    const md = mdPane("a".repeat(28) + "!");
    const { find } = await open({ md });
    await click("Toggle Regular Expression Search");
    const t0 = Date.now();
    await type(find, "(a+)+$");
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(count(find)).toBe("ERR");
    expect(find.getAttribute("aria-invalid")).toBe("true");
  });

  it("with a Worker, a pattern that never returns times out into an error", async () => {
    // A stand-in worker that never answers, like one stuck in backtracking.
    const made = [];
    __setFindWorkerFactoryForTests(() => {
      const w = { onmessage: null, onerror: null, postMessage() {}, terminate() { w.dead = true; } };
      made.push(w);
      return w;
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const md = mdPane("aaaa!");
      const { find } = await open({ md });
      await click("Toggle Regular Expression Search");
      await type(find, "(a+)+$");
      expect(count(find)).toBe("…");
      await act(async () => { vi.advanceTimersByTime(2000); });
      await settle();
      expect(count(find)).toBe("ERR");
      expect(made.some((w) => w.dead)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("with a working Worker, results arrive asynchronously and are counted", async () => {
    __setFindWorkerFactoryForTests(() => {
      const w = {
        onmessage: null, onerror: null, terminate() {},
        postMessage(msg) {
          const scope = { postMessage: (m) => setTimeout(() => w.onmessage?.({ data: m }), 0) };
          new Function("self", findWorkerSource())(scope);
          scope.onmessage({ data: msg });
        },
      };
      return w;
    });
    const md = mdPane("x1 x22 x333");
    const { find } = await open({ md });
    await click("Toggle Regular Expression Search");
    await type(find, "\\d+");
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    await settle();
    expect(count(find)).toBe("1/3");
  });
});

describe("Find all", () => {
  it("selects every match in the markdown pane", async () => {
    const md = mdPane("one two one two one");
    const { find } = await open({ md });
    await type(find, "one");
    await act(async () => { fireEvent.click(screen.getByTitle("Find all — select every match")); });
    await settle();
    expect(md.view.state.selection.ranges.map((r) => [r.from, r.to])).toEqual([[0, 3], [8, 11], [16, 19]]);
  });
});

describe("live count follows the document", () => {
  it("recounts after an edit without moving the selection", async () => {
    const md = mdPane("cat dog cat");
    const { find } = await open({ md });
    await type(find, "cat");
    expect(count(find)).toBe("1/2");
    md.view.dispatch({ changes: { from: md.view.state.doc.length, insert: " cat" }, selection: EditorSelection.cursor(5) });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    await settle();
    expect(count(find)).toMatch(/\/3$/);
    expect(md.view.state.selection.main.head).toBe(5);
  });
});
