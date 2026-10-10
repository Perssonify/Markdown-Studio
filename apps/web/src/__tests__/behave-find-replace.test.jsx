/**
 * A108 — Find & Replace (`ui/find/findReplace/index.tsx`) as a user drives it, against a
 * REAL CodeMirror view and a REAL TipTap editor: moving through matches in
 * both panes, regex groups and lookarounds, case and whole word, Replace and
 * Replace All (with the scope filter), Format matches in both panes, the
 * headings-only affordance, the Worker path and its fallbacks, read-only, the
 * panel's own keys, dragging it and where it reopens, and the scrollbar ticks.
 *
 * find-replace-panel.test.jsx pins the audit's specific defects (A060, A061,
 * A067, A098); this file covers the rest of the panel's behaviour.
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Editor } from "@tiptap/core";
import { Color } from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BackgroundColor } from "../extensions/BackgroundColor";
import { __resetFindWorkerForTests, __setFindWorkerFactoryForTests, findWorkerSource } from "../formatting/find-worker";
import { MAX_FIND_MATCHES } from "../formatting/find-engine";
import { useUIStore } from "../store/preferences/uiStore";
import { FindReplaceBar } from "../ui/find/findReplace";

beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getClientRects ??= () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
  Range.prototype.getBoundingClientRect ??= () => rect;
});

const cleanups = [];
beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  __setFindWorkerFactoryForTests(null); // main-thread fallback unless a case installs a Worker
  useUIStore.setState({ readOnly: false });
});
afterEach(() => {
  cleanup();
  while (cleanups.length) cleanups.pop()();
  __resetFindWorkerForTests();
  useUIStore.setState({ readOnly: false });
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
    text: () => view.state.doc.toString(),
    sel: () => [view.state.selection.main.from, view.state.selection.main.to],
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
  // Mounted inside the wrapper the panel looks for when it measures ticks.
  const host = document.createElement("div");
  const content = document.createElement("div");
  content.className = "tiptap-editor-content";
  host.appendChild(content);
  document.body.appendChild(host);
  const editor = new Editor({ element: content, extensions: [StarterKit, Underline, TextStyle, Color, BackgroundColor], content: html });
  const highlights = [];
  cleanups.push(() => { editor.destroy(); host.remove(); });
  return {
    editor,
    highlights,
    text: () => editor.getText(),
    sel: () => [editor.state.selection.from, editor.state.selection.to],
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
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function open({ md, rich, target = "md", mode = "split", panelMode = "find", onClose = vi.fn() } = {}) {
  const onSync = vi.fn();
  const syncHtmlToMd = vi.fn();
  const props = {
    sourceRef: md?.ref ?? { current: null },
    previewRef: rich?.ref ?? { current: null },
    mode, onSync, syncHtmlToMd, onClose,
    initialMode: panelMode, initialTarget: target,
  };
  const utils = render(<FindReplaceBar {...props} />);
  await settle();
  const find = () => screen.getByLabelText(/^Find in (Markdown|Rich Text)$/);
  return { ...utils, props, find, onSync, syncHtmlToMd, onClose };
}
async function type(input, value) {
  await act(async () => { fireEvent.change(input, { target: { value } }); });
  await settle();
}
async function press(title) {
  await act(async () => { fireEvent.click(screen.getByTitle(title)); });
  await settle();
}
const count = (find) => document.getElementById(find.getAttribute("aria-describedby")).textContent;
const replaceBox = () => screen.getByLabelText("Replace with");

describe("moving through matches", () => {
  it("Enter / Shift+Enter walk the RICH pane's matches and wrap around", async () => {
    const rich = richPane("<p>one fish two fish red fish</p>");
    const { find } = await open({ rich, target: "richtext" });
    await type(find(), "fish");
    expect(count(find())).toBe("1/3");
    const first = rich.sel();
    await act(async () => { fireEvent.keyDown(find(), { key: "Enter" }); });
    await settle();
    expect(count(find())).toBe("2/3");
    await act(async () => { fireEvent.keyDown(find(), { key: "Enter" }); });
    await act(async () => { fireEvent.keyDown(find(), { key: "Enter" }); });
    await settle();
    expect(count(find())).toBe("1/3"); // wrapped
    expect(rich.sel()).toEqual(first);
    await act(async () => { fireEvent.keyDown(find(), { key: "Enter", shiftKey: true }); });
    await settle();
    expect(count(find())).toBe("3/3"); // backwards wraps to the last
    const [from, to] = rich.sel();
    expect(rich.editor.state.doc.textBetween(from, to)).toBe("fish");
  });

  it("the arrow buttons do the same in the markdown pane", async () => {
    const md = mdPane("ab ab ab");
    const { find } = await open({ md });
    await type(find(), "ab");
    await press("Next (Enter)");
    expect(md.sel()).toEqual([3, 5]);
    await press("Previous (Shift+Enter)");
    expect(md.sel()).toEqual([0, 2]);
  });

  it("Find all in the rich pane selects the match at the caret and keeps the count", async () => {
    const rich = richPane("<p>a cat, a cat, a cat</p>");
    const { find } = await open({ rich, target: "richtext" });
    await type(find(), "cat");
    await press("Find all — select every match");
    expect(count(find())).toBe("1/3");
    const [from, to] = rich.sel();
    expect(rich.editor.state.doc.textBetween(from, to)).toBe("cat");
  });
});

describe("what counts as a match", () => {
  it("Match case and Whole word narrow the count, and are remembered", async () => {
    const md = mdPane("Word word words WORD");
    const { find, unmount } = await open({ md });
    await type(find(), "word");
    expect(count(find())).toBe("1/4");
    await press("Match case");
    expect(count(find())).toBe("1/2");
    await press("Whole word");
    expect(count(find())).toBe("1/1");
    unmount();
    // Reopened: both options are still on.
    const again = await open({ md });
    await type(again.find(), "word");
    expect(screen.getByTitle("Match case").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTitle("Whole word").getAttribute("aria-pressed")).toBe("true");
    expect(count(again.find())).toBe("1/1");
  });

  it("an invalid pattern reads ERR and names the error; turning regex off clears it", async () => {
    const md = mdPane("a (b) c");
    const { find } = await open({ md });
    await press("Toggle Regular Expression Search");
    await type(find(), "(b");
    expect(count(find())).toBe("ERR");
    expect(find().getAttribute("aria-invalid")).toBe("true");
    await press("Toggle Regular Expression Search");
    await settle();
    expect(count(find())).toBe("1/1"); // "(b" is literal text now
    expect(find().getAttribute("aria-invalid")).toBeNull();
  });

  it(`stops counting at ${MAX_FIND_MATCHES} and says there are more`, async () => {
    const md = mdPane("x".repeat(MAX_FIND_MATCHES + 5));
    const { find } = await open({ md });
    await type(find(), "x");
    expect(count(find())).toBe(`1/${MAX_FIND_MATCHES}+`);
  });

  it("an empty query clears the count and every highlight", async () => {
    const md = mdPane("aaa");
    const { find } = await open({ md });
    await type(find(), "a");
    expect(count(find())).toBe("1/3");
    await type(find(), "");
    expect(count(find())).toBe("");
    await wait(150);
    expect(md.highlights.at(-1)).toBeNull();
  });
});

describe("replacing", () => {
  it("regex replacements expand numbered and named groups", async () => {
    const md = mdPane("due 2026-09 and 2027-01");
    const { find } = await open({ md, panelMode: "replace" });
    await press("Toggle Regular Expression Search");
    await type(find(), "(?<y>\\d{4})-(?<m>\\d{2})");
    await type(replaceBox(), "$<m>/$<y>");
    await press("Replace All");
    expect(md.text()).toBe("due 09/2026 and 01/2027");
    await type(find(), "(\\d+)/(\\d+)");
    await type(replaceBox(), "$2.$1");
    await press("Replace All");
    expect(md.text()).toBe("due 2026.09 and 2027.01");
  });

  it("Replace with nothing selected first FINDS a match, then replaces it on the next press", async () => {
    const md = mdPane("tea, tea");
    const { find, onSync } = await open({ md, panelMode: "replace" });
    await type(find(), "tea");
    // Move the caret off the match that find-as-you-type selected.
    await act(async () => { md.view.dispatch({ selection: { anchor: 4 } }); });
    await type(replaceBox(), "coffee");
    await press("Replace");
    expect(md.text()).toBe("tea, tea"); // it only selected
    expect(md.sel()).toEqual([5, 8]);
    await press("Replace");
    expect(md.text()).toBe("tea, coffee");
    expect(onSync).toHaveBeenCalled();
    // Enter in the replace box replaces too.
    await act(async () => { md.view.dispatch({ selection: { anchor: 0, head: 3 } }); });
    await act(async () => { fireEvent.keyDown(replaceBox(), { key: "Enter" }); });
    await settle();
    expect(md.text()).toBe("coffee, coffee");
  });

  it("Replace All with an empty replacement deletes every match in the rich pane", async () => {
    const rich = richPane("<p>keep TODO this TODO text</p>");
    const { find, syncHtmlToMd } = await open({ rich, target: "richtext", panelMode: "replace" });
    await type(find(), "TODO ");
    await press("Replace All");
    expect(rich.text()).toBe("keep this text");
    expect(syncHtmlToMd).toHaveBeenCalled();
    expect(count(find())).toBe("0");
  });

  it("the scope filter can EXCLUDE code, and Replace All leaves the excluded region alone", async () => {
    const md = mdPane("use foo here\n\n```\nfoo()\n```\n\nand `foo` inline, and [foo](https://foo.example)");
    const { find } = await open({ md, panelMode: "replace" });
    await press("Scope filter — search only in, or exclude, headings / code / links / emphasis");
    const code = screen.getByText("Code").closest("button");
    await act(async () => { fireEvent.click(code); }); // off → only
    await act(async () => { fireEvent.click(code); }); // only → exclude
    await settle();
    expect(code.getAttribute("aria-pressed")).toBe("true");
    const links = screen.getByText("Links / URLs").closest("button");
    await act(async () => { fireEvent.click(links); fireEvent.click(links); }); // exclude links too
    await settle();
    await type(find(), "foo");
    expect(count(find())).toMatch(/\/2$/); // "use foo" and the link TEXT; code and URL excluded
    await type(replaceBox(), "bar");
    await press("Replace All");
    expect(md.text()).toBe("use bar here\n\n```\nfoo()\n```\n\nand `foo` inline, and [bar](https://foo.example)");
    // The filter is remembered.
    expect(JSON.parse(localStorage.getItem("pf:fr-scope"))).toMatchObject({ code: "exclude", links: "exclude" });
  });

  it("the emphasis scopes find matches only inside bold, italic, strikethrough or highlight", async () => {
    const md = mdPane("x **x** *x* ~~x~~ ==x== x");
    const { find } = await open({ md });
    await press("Scope filter — search only in, or exclude, headings / code / links / emphasis");
    await type(find(), "x");
    expect(count(find())).toMatch(/\/6$/);
    for (const [label, expected] of [["Bold", 1], ["Italic", 1], ["Strikethrough", 1], ["Highlight", 1]]) {
      const chip = screen.getByText(label).closest("button");
      await act(async () => { fireEvent.click(chip); }); // only
      await settle();
      expect(count(find())).toMatch(new RegExp(`/${expected}$`));
      await act(async () => { fireEvent.click(chip); fireEvent.click(chip); }); // exclude → off
      await settle();
    }
    expect(count(find())).toMatch(/\/6$/);
  });
});

describe("Format matches (Replace mode)", () => {
  it("wraps every markdown-pane match in bold, italic, underline or a highlight", async () => {
    const md = mdPane("cat dog cat");
    const { find, onSync } = await open({ md, panelMode: "replace" });
    await type(find(), "cat");
    await press("Bold");
    expect(md.text()).toBe("**cat** dog **cat**");
    expect(onSync).toHaveBeenCalled();
    await type(find(), "dog");
    await press("Italicize");
    expect(md.text()).toBe("**cat** *dog* **cat**");
    await press("Underline");
    expect(md.text()).toBe("**cat** *<u>dog</u>* **cat**");
    await press("Highlight");
    expect(md.text()).toContain('<span style="background-color: #fef08a">dog</span>');
  });

  it("changes the case of every match in either pane, keeping the rich pane's marks", async () => {
    const md = mdPane("hello world, hello");
    const m = await open({ md, panelMode: "replace" });
    await type(m.find(), "hello");
    await press("UPPERCASE");
    expect(md.text()).toBe("HELLO world, HELLO");
    m.unmount();

    const rich = richPane("<p><strong>big news</strong> and big plans</p>");
    const r = await open({ rich, target: "richtext", panelMode: "replace" });
    await type(r.find(), "big");
    await press("Title Case");
    expect(rich.text()).toBe("Big news and Big plans");
    // The first "Big" is still bold.
    expect(rich.editor.getHTML()).toContain("<strong>Big news</strong>");
    await type(r.find(), "BIG");
    await press("lowercase");
    expect(rich.text()).toBe("big news and big plans");
  });

  it("adds a real mark to every rich-pane match", async () => {
    const rich = richPane("<p>alpha beta alpha</p>");
    const { find, syncHtmlToMd } = await open({ rich, target: "richtext", panelMode: "replace" });
    await type(find(), "alpha");
    await press("Bold");
    expect(rich.editor.getHTML()).toBe("<p><strong>alpha</strong> beta <strong>alpha</strong></p>");
    await press("Italicize");
    await press("Underline");
    expect(rich.editor.getHTML()).toContain("<u>alpha</u>");
    expect(syncHtmlToMd).toHaveBeenCalled();
  });

  it("with Headings = only and no query, formats EVERY heading", async () => {
    const md = mdPane("# One\n\nbody\n\n## Two");
    await open({ md, panelMode: "replace" });
    await press("Scope filter — search only in, or exclude, headings / code / links / emphasis");
    await act(async () => { fireEvent.click(screen.getByText("Headings").closest("button")); });
    await settle();
    expect(screen.getByText("Format all headings (2):")).toBeTruthy();
    await press("Bold");
    expect(md.text()).toBe("# **One**\n\nbody\n\n## **Two**");

    cleanup();
    const rich = richPane("<h1>First</h1><p>body</p><h2>Second</h2>");
    await open({ rich, target: "richtext", panelMode: "replace" });
    expect(screen.getByText("Format all headings (2):")).toBeTruthy();
    await press("UPPERCASE");
    expect(rich.text().trim()).toBe("FIRST\n\nbody\n\nSECOND"); // (StarterKit adds a trailing paragraph)
  });

  it("is disabled when nothing matches, and absent in Find mode", async () => {
    const md = mdPane("abc");
    const { find } = await open({ md, panelMode: "replace" });
    await type(find(), "zzz");
    expect(screen.getByTitle("Bold").disabled).toBe(true);
    await act(async () => { fireEvent.click(screen.getByText("Find", { selector: "button" })); });
    expect(screen.queryByTitle("Bold")).toBeNull();
  });
});

describe("read-only", () => {
  it("keeps Find, and removes every way to change the document", async () => {
    useUIStore.setState({ readOnly: true });
    const md = mdPane("abc abc");
    const { find } = await open({ md, panelMode: "replace" });
    await type(find(), "abc");
    expect(count(find())).toBe("1/2");
    expect(screen.queryByLabelText("Replace with")).toBeNull();
    expect(screen.queryByTitle("Replace All")).toBeNull();
    expect(screen.queryByTitle("Bold")).toBeNull();
    const replaceTab = screen.getByText("Replace", { selector: "button" });
    expect(replaceTab.disabled).toBe(true);
    // ⌘H inside the panel cannot switch to Replace either.
    await act(async () => { fireEvent.keyDown(find(), { key: "h", ctrlKey: true }); });
    expect(screen.queryByLabelText("Replace with")).toBeNull();
    expect(md.text()).toBe("abc abc");
  });
});

describe("the panel's own keys and controls", () => {
  it("⌘H / ⌘F switch modes inside the panel, and Escape closes it and clears highlights", async () => {
    const md = mdPane("abc");
    const { find, onClose } = await open({ md });
    await type(find(), "b");
    expect(screen.queryByLabelText("Replace with")).toBeNull();
    await act(async () => { fireEvent.keyDown(find(), { key: "h", ctrlKey: true }); });
    await settle();
    expect(screen.getByLabelText("Replace with")).toBeTruthy();
    await act(async () => { fireEvent.keyDown(find(), { key: "f", metaKey: true }); });
    await settle();
    expect(screen.queryByLabelText("Replace with")).toBeNull();
    await act(async () => { fireEvent.keyDown(find(), { key: "Escape" }); });
    // Exactly once: the input and the panel both used to close on one Escape.
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(md.highlights.at(-1)).toBeNull();
  });

  it("Escape in the Replace box closes once too", async () => {
    const md = mdPane("abc");
    const { find, onClose } = await open({ md });
    await act(async () => { fireEvent.keyDown(find(), { key: "h", ctrlKey: true }); });
    await settle();
    await act(async () => { fireEvent.keyDown(screen.getByLabelText("Replace with"), { key: "Escape" }); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the close button closes; AltGr (Ctrl+Alt) never switches modes", async () => {
    const md = mdPane("abc");
    const { onClose } = await open({ md });
    const dialog = screen.getByRole("dialog", { name: "Find and replace" });
    await act(async () => { fireEvent.keyDown(dialog, { key: "h", ctrlKey: true, altKey: true }); });
    expect(screen.queryByLabelText("Replace with")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByLabelText("Close find and replace")); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("MD and Rich Text choose the pane, and a pane that is not on screen cannot be chosen", async () => {
    const md = mdPane("pane pane");
    const rich = richPane("<p>pane</p>");
    const { find, rerender, props } = await open({ md, rich, target: "md" });
    await type(find(), "pane");
    expect(count(find())).toBe("1/2");
    await act(async () => { fireEvent.click(screen.getByTitle("Search Rich Text pane")); });
    await settle();
    expect(find().getAttribute("aria-label")).toBe("Find in Rich Text");
    expect(count(find())).toBe("1/1");
    // The view switches to Markdown only: the rich pane is gone, so is the target.
    await act(async () => { rerender(<FindReplaceBar {...props} mode="md" />); });
    await settle();
    expect(find().getAttribute("aria-label")).toBe("Find in Markdown");
    await act(async () => { fireEvent.click(screen.getByTitle("Rich Text pane not visible")); });
    expect(find().getAttribute("aria-label")).toBe("Find in Markdown");
  });

  it("drags by its header, remembers where, and reopens there — clamped on screen", async () => {
    const md = mdPane("x");
    const { unmount } = await open({ md });
    const dialog = screen.getByRole("dialog", { name: "Find and replace" });
    const handle = screen.getByText("Find & Replace").parentElement;
    await act(async () => {
      fireEvent.pointerDown(handle, { clientX: 10, clientY: 10, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientX: 210, clientY: 110, pointerId: 1 });
    });
    expect(dialog.getAttribute("data-dragging")).toBe("true");
    await act(async () => { fireEvent.pointerUp(handle, { clientX: 210, clientY: 110, pointerId: 1 }); });
    expect(dialog.style.left).toBe("200px");
    expect(dialog.style.top).toBe("100px");
    expect(JSON.parse(localStorage.getItem("pf:fr-pos"))).toBeTruthy();
    unmount();

    localStorage.setItem("pf:fr-pos", JSON.stringify({ x: 99999, y: -50 }));
    await open({ md });
    const reopened = screen.getByRole("dialog", { name: "Find and replace" });
    expect(parseFloat(reopened.style.left)).toBeLessThanOrEqual(window.innerWidth);
    expect(parseFloat(reopened.style.top)).toBe(4); // clamped back on screen
    // A smaller window re-clamps it.
    const w = window.innerWidth;
    window.innerWidth = 300;
    await act(async () => { window.dispatchEvent(new Event("resize")); });
    expect(parseFloat(reopened.style.left)).toBeLessThanOrEqual(300);
    window.innerWidth = w;
  });

  it("draws a tick over the scrollbar for every match", async () => {
    const md = mdPane("m\nm\nm\nm");
    const { find } = await open({ md });
    await type(find(), "m");
    await wait(200);
    const ticks = document.querySelector("[data-pf-portal]");
    expect(ticks).not.toBeNull();
    expect(ticks.children).toHaveLength(4);
    await type(find(), "");
    await wait(200);
    expect(document.querySelector("[data-pf-portal]")).toBeNull();
  });
});

describe("a regex runs in a Worker, and survives one that fails", () => {
  function workerFactory({ failFirst = false, dieAfterFirst = false } = {}) {
    let jobs = 0;
    return () => {
      const w = {
        onmessage: null, onerror: null, terminate() { w.dead = true; },
        postMessage(msg) {
          jobs++;
          if ((failFirst && jobs === 1) || (dieAfterFirst && jobs > 1)) {
            setTimeout(() => w.onerror?.(new Event("error")), 0);
            return;
          }
          const scope = { postMessage: (m) => setTimeout(() => w.onmessage?.({ data: m }), 0) };
          new Function("self", findWorkerSource())(scope);
          scope.onmessage({ data: msg });
        },
      };
      return w;
    };
  }

  it("a Worker that cannot start is replaced by the main thread, with the same answer", async () => {
    __setFindWorkerFactoryForTests(workerFactory({ failFirst: true }));
    const md = mdPane("a1 b22 c333");
    const { find } = await open({ md });
    await press("Toggle Regular Expression Search");
    await type(find(), "\\d+");
    await wait(20);
    await settle();
    expect(count(find())).toBe("1/3");
  });

  it("a Worker that dies on a pattern after it has worked is REPORTED, never re-run on the page", async () => {
    __setFindWorkerFactoryForTests(workerFactory({ dieAfterFirst: true }));
    const md = mdPane("a1 b22 c333");
    const { find } = await open({ md });
    await press("Toggle Regular Expression Search");
    await type(find(), "\\d");
    await wait(20);
    await settle();
    expect(count(find())).toBe("1/6"); // the Worker answered once
    await type(find(), "\\d+");
    await wait(20);
    await settle();
    expect(count(find())).toBe("ERR");
    const counter = document.getElementById(find().getAttribute("aria-describedby"));
    expect(counter.getAttribute("title")).toMatch(/could not be run on this document/);
  });
});
