import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { marked } from "marked";
import { afterEach, describe, expect, it } from "vitest";
import { preprocessMarkdown } from "../engine/preprocessor";
import {
  cellSeparators,
  mdAddColumnAfter,
  mdAddRowAfter,
  mdDeleteColumn,
  mdParseTableAtCursor,
  parsePipeRow,
  parseSeparator,
  renderTable,
} from "../formatting/md-table-ops";

/**
 * A053. Rows were split with a naive split("|"): adding ONE row to a
 * two-column table holding `x \| y` and `[[Doc|Alias]]` rewrote it as four
 * columns (reproduced, and persisted). `:---` was dropped, and a table inside a
 * list item was re-rendered flush-left, out of the list.
 */

const views = [];
afterEach(() => { while (views.length) views.pop().destroy(); });

/** A real CodeMirror view with the caret at the first occurrence of `marker`
 *  (the marker is removed from the text). */
function viewWithCaret(textWithMarker, marker = "¦") {
  const at = textWithMarker.indexOf(marker);
  const doc = textWithMarker.replace(marker, "");
  const view = new EditorView({
    state: EditorState.create({ doc, selection: EditorSelection.cursor(at) }),
    parent: document.body.appendChild(document.createElement("div")),
  });
  views.push(view);
  return view;
}

/** Cells as the PREVIEW sees them: the app's own order — the preprocessor
 *  converts wiki links, THEN marked splits the table — reading one body row. */
function renderedRow(md, row = 0) {
  const div = document.createElement("div");
  div.innerHTML = marked.parse(preprocessMarkdown(md, { wikiLinks: true }));
  const tr = div.querySelectorAll("tbody tr")[row];
  return tr ? [...tr.querySelectorAll("td")].map((td) => td.textContent) : null;
}

describe("cell splitting follows the renderer", () => {
  it("keeps an escaped pipe inside its cell", () => {
    expect(parsePipeRow("| x \\| y | z |")).toEqual(["x \\| y", "z"]);
  });

  it("keeps a [[Doc|Alias]] wiki link in one cell", () => {
    expect(parsePipeRow("| [[Doc|Alias]] | z |")).toEqual(["[[Doc|Alias]]", "z"]);
  });

  it("splits on an even run of backslashes (the pipe is NOT escaped)", () => {
    expect(parsePipeRow("| a\\\\| b |")).toEqual(["a\\\\", "b"]);
  });

  it("splits a pipe inside a code span, exactly as marked does", () => {
    // GFM splits a row into cells before any inline parsing.
    expect(parsePipeRow("| `a|b` | z |")).toEqual(["`a", "b`", "z"]);
    expect(renderedRow("| h1 | h2 | h3 |\n|---|---|---|\n| `a|b` | z |")).toEqual(["`a", "b`", "z"]);
  });

  it("does not treat a wiki link inside a code span as a unit (it is never converted)", () => {
    expect(parsePipeRow("| `[[a|b]]` | z |")).toEqual(["`[[a", "b]]`", "z"]);
  });

  it("reports delimiter offsets only", () => {
    expect(cellSeparators("| a \\| b | [[c|d]] |")).toEqual([0, 9, 19]);
  });
});

describe("table operations keep the table the user wrote", () => {
  it("adding a row to a table with `x \\| y` and [[Doc|Alias]] keeps TWO columns (the reported repro)", () => {
    const view = viewWithCaret("| A | B |\n| --- | --- |\n| x \\| y | [[Doc|Alias]]¦ |");
    mdAddRowAfter(view);
    const out = view.state.doc.toString();
    const lines = out.split("\n");
    expect(lines).toHaveLength(4);
    for (const line of lines) expect(parsePipeRow(line)).toHaveLength(2);
    expect(parsePipeRow(lines[2])).toEqual(["x \\| y", "[[Doc|Alias]]"]);
    // …and the preview agrees: two cells, the escaped pipe and the link intact.
    expect(renderedRow(out)).toEqual(["x | y", "Alias"]);
  });

  it("puts the new column after the cell the caret is in, counting only real delimiters", () => {
    // An escaped pipe BEFORE the caret used to shift the column index by one.
    const view = viewWithCaret("| A | B | C |\n| --- | --- | --- |\n| x \\| y | q¦ | r |");
    expect(mdParseTableAtCursor(view).cursorCol).toBe(1);
    mdAddColumnAfter(view);
    const lines = view.state.doc.toString().split("\n");
    expect(parsePipeRow(lines[0])).toEqual(["A", "B", "", "C"]);
    expect(parsePipeRow(lines[2])).toEqual(["x \\| y", "q", "", "r"]);
  });

  it("keeps an explicit :--- left alignment", () => {
    expect(parseSeparator("| :--- | --- | :---: | ---: |")).toEqual(["left", "", "center", "right"]);
    const view = viewWithCaret("| A | B |\n| :--- | ---: |\n| 1¦ | 2 |");
    mdAddRowAfter(view);
    const sep = parsePipeRow(view.state.doc.toString().split("\n")[1]);
    expect(sep[0].startsWith(":") && !sep[0].endsWith(":")).toBe(true);
    expect(sep[1].endsWith(":") && !sep[1].startsWith(":")).toBe(true);
    // marked agrees it is still an explicit left.
    expect(marked.parse(view.state.doc.toString())).toContain('align="left"');
  });

  it("renders a left alignment as :---", () => {
    expect(renderTable([["A"], ["1"]], ["left"]).split("\n")[1]).toBe("| :-- |");
  });

  it("keeps a table inside a list item inside the list", () => {
    const md = "- item\n\n  | A | B |\n  | --- | --- |\n  | 1¦ | 2 |\n";
    const view = viewWithCaret(md);
    mdAddRowAfter(view);
    const out = view.state.doc.toString();
    for (const line of out.split("\n").filter((l) => l.includes("|"))) {
      expect(line.startsWith("  |")).toBe(true);
    }
    const div = document.createElement("div");
    div.innerHTML = marked.parse(out);
    expect(div.querySelector("li table")).not.toBeNull();
    expect(div.querySelectorAll("li table tbody tr")).toHaveLength(2);
  });

  it("deleting a column keeps the wiki link intact", () => {
    const view = viewWithCaret("| A | B | C |\n| --- | --- | --- |\n| [[Doc|Alias]] | x¦ | y |");
    mdDeleteColumn(view);
    expect(parsePipeRow(view.state.doc.toString().split("\n")[2])).toEqual(["[[Doc|Alias]]", "y"]);
  });
});
