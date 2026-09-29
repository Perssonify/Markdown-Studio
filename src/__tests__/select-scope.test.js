import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { SCOPE_GROUPS, SCOPE_TYPES, selectScopeCM } from "../formatting/select-scope";

/**
 * The Select… ▸ engine had no tests, and it is a live menu with seventeen
 * entries whose behaviour is entirely regex — which line is a task item and
 * which is a bullet, what counts as a paragraph, and what is inside a fence and
 * must be left alone. A wrong range here does not throw: it silently selects the
 * wrong text, and whatever the user does next (Format matches, a case change,
 * typing) lands on it.
 */

/** A real EditorState with multi-range selection enabled, plus the two methods
 *  selectScopeCM calls on the view. The transaction is APPLIED, so an invalid
 *  selection fails here exactly as it would in the pane. */
function viewOf(text) {
  let state = EditorState.create({
    doc: text,
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
  return {
    get state() { return state; },
    dispatch(spec) { state = state.update(spec).state; },
    focus() {},
    /** The selected text of each range, in order. */
    selected() {
      return state.selection.ranges.map((r) => state.doc.sliceString(r.from, r.to));
    },
  };
}

describe("SCOPE_TYPES", () => {
  it("has unique ids", () => {
    const ids = SCOPE_TYPES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only uses groups the menu renders", () => {
    for (const s of SCOPE_TYPES) expect(SCOPE_GROUPS).toContain(s.group);
  });

  it("every group has at least one entry (no empty menu section)", () => {
    for (const g of SCOPE_GROUPS) {
      expect(SCOPE_TYPES.some((s) => s.group === g)).toBe(true);
    }
  });
});

describe("selectScopeCM — headings", () => {
  const doc = [
    "# Title",
    "",
    "Some prose.",
    "",
    "## Section",
    "",
    "### Deeper",
    "",
    "#NotAHeading",
  ].join("\n");

  it("selects every heading", () => {
    const v = viewOf(doc);
    expect(selectScopeCM(v, "headings")).toBe(3);
    expect(v.selected()).toEqual(["# Title", "## Section", "### Deeper"]);
  });

  it("selects one level at a time", () => {
    const v = viewOf(doc);
    expect(selectScopeCM(v, "h2")).toBe(1);
    expect(v.selected()).toEqual(["## Section"]);
  });

  it("requires the space after the hashes", () => {
    const v = viewOf(doc);
    selectScopeCM(v, "headings");
    expect(v.selected().join(" ")).not.toContain("NotAHeading");
  });

  it("returns 0 and leaves the selection alone when nothing matches", () => {
    const v = viewOf("just prose, no headings");
    const before = v.selected();
    expect(selectScopeCM(v, "h4")).toBe(0);
    expect(v.selected()).toEqual(before);
  });
});

describe("selectScopeCM — lists", () => {
  const doc = [
    "- plain bullet",
    "- [ ] unchecked task",
    "- [x] checked task",
    "* another bullet",
    "1. first",
    "2. second",
  ].join("\n");

  it("does not count task items as bullets", () => {
    // `- [ ] x` matches the bullet pattern too; the bullet branch has to exclude
    // it or every task item is selected twice over, under two different scopes.
    const v = viewOf(doc);
    expect(selectScopeCM(v, "bulletList")).toBe(2);
    expect(v.selected()).toEqual(["- plain bullet", "* another bullet"]);
  });

  it("selects task items, checked and unchecked alike", () => {
    const v = viewOf(doc);
    expect(selectScopeCM(v, "taskList")).toBe(2);
    expect(v.selected()).toEqual(["- [ ] unchecked task", "- [x] checked task"]);
  });

  it("selects numbered items", () => {
    const v = viewOf(doc);
    expect(selectScopeCM(v, "orderedList")).toBe(2);
    expect(v.selected()).toEqual(["1. first", "2. second"]);
  });
});

describe("selectScopeCM — fenced code", () => {
  const doc = [
    "Intro paragraph.",
    "",
    "```js",
    "# not a heading, it is a comment",
    "- not a bullet",
    "```",
    "",
    "## Real heading",
  ].join("\n");

  it("ignores markdown-looking lines inside a fence", () => {
    const v = viewOf(doc);
    expect(selectScopeCM(v, "headings")).toBe(1);
    expect(v.selected()).toEqual(["## Real heading"]);
    expect(selectScopeCM(v, "bulletList")).toBe(0);
  });

  it("selects the fence itself, delimiters included, for codeBlock", () => {
    const v = viewOf(doc);
    expect(selectScopeCM(v, "codeBlock")).toBe(1);
    const [block] = v.selected();
    expect(block.startsWith("```js")).toBe(true);
    expect(block.endsWith("```")).toBe(true);
    expect(block).toContain("not a bullet");
  });

  it("handles ~~~ fences and does not close one fence with the other marker", () => {
    const v = viewOf(["~~~", "```", "text", "~~~", "# after"].join("\n"));
    expect(selectScopeCM(v, "codeBlock")).toBe(1);
    expect(v.selected()[0]).toBe("~~~\n```\ntext\n~~~");
    expect(selectScopeCM(v, "headings")).toBe(1);
  });

  it("excludes fenced lines from paragraphs", () => {
    const v = viewOf(doc);
    selectScopeCM(v, "paragraphs");
    expect(v.selected()).toEqual(["Intro paragraph."]);
  });
});

describe("selectScopeCM — paragraphs and tables", () => {
  it("skips blank lines and every other block marker", () => {
    const v = viewOf([
      "Real paragraph.",
      "",
      "# Heading",
      "> quote",
      "- bullet",
      "1. numbered",
      "| a | b |",
      "",
      "Another paragraph.",
    ].join("\n"));
    expect(selectScopeCM(v, "paragraphs")).toBe(2);
    expect(v.selected()).toEqual(["Real paragraph.", "Another paragraph."]);
  });

  it("selects every table row, separator included", () => {
    const v = viewOf("| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter");
    expect(selectScopeCM(v, "table")).toBe(3);
  });

  it("selects blockquote lines", () => {
    const v = viewOf("> one\n> two\n\nnot a quote");
    expect(selectScopeCM(v, "blockquote")).toBe(2);
  });
});

describe("selectScopeCM — inline scopes", () => {
  it("selects inline code", () => {
    const v = viewOf("Use `npm run dev` and `bun test` here.");
    expect(selectScopeCM(v, "inlineCode")).toBe(2);
    expect(v.selected()).toEqual(["`npm run dev`", "`bun test`"]);
  });

  it("does not pair a stray backtick with one on another line", () => {
    // Two unpaired ticks on separate lines are prose, not a code span. Without
    // the newline exclusion the regex swallows the line break between them and
    // selects a paragraph and a half.
    const v = viewOf("A lone ` tick here\nand another ` tick there");
    expect(selectScopeCM(v, "inlineCode")).toBe(0);
  });

  it("selects links", () => {
    const v = viewOf("See [docs](https://example.com) and [more](/local).");
    expect(selectScopeCM(v, "link")).toBe(2);
    expect(v.selected()).toEqual(["[docs](https://example.com)", "[more](/local)"]);
  });

  it("selects images in both markdown and HTML form, but not plain links", () => {
    const v = viewOf('![alt](a.png) then [link](b) then <img src="c.png" alt="c">');
    const n = selectScopeCM(v, "image");
    expect(n).toBe(2);
    expect(v.selected()[0]).toBe("![alt](a.png)");
    expect(v.selected()[1]).toContain("<img");
  });

  // NOTE: `mdScopeRanges` sorts its output before building the selection, but
  // every scope in the current table yields either block ranges (already in line
  // order) or inline ranges (already in match order) — never both — so the sort
  // cannot change any result today and no test here can hold it. It is a real
  // guard for a future scope that mixes the two (CodeMirror's
  // EditorSelection.create REJECTS unsorted ranges), and is left in place; this
  // note is here so the next reader does not mistake it for tested behaviour.
});

describe("selectScopeCM — the selection it places", () => {
  it("is a genuine multi-range selection, not just the first match", () => {
    // Without EditorState.allowMultipleSelections this dispatch throws, which is
    // why the CM pane enables it (and why drawSelection() must stay: the native
    // DOM selection renders only one range).
    const v = viewOf("# One\n\n# Two\n\n# Three");
    selectScopeCM(v, "headings");
    expect(v.state.selection.ranges).toHaveLength(3);
  });

  it("puts the cursor on the FIRST match", () => {
    const v = viewOf("# One\n\n# Two");
    selectScopeCM(v, "headings");
    expect(v.state.selection.mainIndex).toBe(0);
  });

  it("replaces any previous selection rather than adding to it", () => {
    const v = viewOf("# One\n\n# Two\n\npara");
    v.dispatch({ selection: EditorSelection.single(0, 5) });
    selectScopeCM(v, "paragraphs");
    expect(v.selected()).toEqual(["para"]);
  });
});
