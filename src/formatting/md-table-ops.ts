/**
 * Markdown pipe table structural operations for CodeMirror 6.
 *
 * All functions take a CM6 EditorView, parse the pipe table at the cursor,
 * manipulate the grid, and dispatch the replacement text.
 *
 * Pure functions except for the view.dispatch calls.
 */

import type { EditorView } from "@codemirror/view";

// ---- Types ----

export interface ParsedTable {
  rows: string[][];
  alignments: string[];
  from: number;
  to: number;
  cursorRow: number;
  cursorCol: number;
  sepLineIdx: number;
  /** Leading whitespace of the table's first line. A table inside a list item
   *  is indented to the item's content column; re-rendering it flush-left
   *  pulled it out of the list. */
  indent: string;
}

// ---- Parser ----

/**
 * Parse the GFM pipe table surrounding the cursor.
 */
export function mdParseTableAtCursor(view: EditorView): ParsedTable | null {
  const state = view.state;
  const pos = state.selection.main.head;
  const cursorLine = state.doc.lineAt(pos);

  // Quick check: current line must look like a pipe table row
  if (!isPipeTableLine(cursorLine.text)) return null;

  // Walk upward to find the first line of the table
  let firstLine = cursorLine;
  while (firstLine.number > 1) {
    const prev = state.doc.line(firstLine.number - 1);
    if (!isPipeTableLine(prev.text)) break;
    firstLine = prev;
  }

  // Walk downward to find the last line of the table
  let lastLine = cursorLine;
  const lineCount = state.doc.lines;
  while (lastLine.number < lineCount) {
    const next = state.doc.line(lastLine.number + 1);
    if (!isPipeTableLine(next.text)) break;
    lastLine = next;
  }

  // Must have at least 3 lines (header + separator + 1 data row)
  const totalLines = lastLine.number - firstLine.number + 1;
  if (totalLines < 2) return null;

  // Parse all lines
  const lines: string[] = [];
  for (let n = firstLine.number; n <= lastLine.number; n++) {
    lines.push(state.doc.line(n).text);
  }

  // Identify separator line (must be line index 1 — right after header)
  const sepLineIdx = findSeparatorLineIdx(lines);
  if (sepLineIdx < 0) return null;

  // Parse alignments from separator
  const alignments = parseSeparator(lines[sepLineIdx]!);

  // Parse rows (skip separator)
  const rows: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === sepLineIdx) continue;
    rows.push(parsePipeRow(lines[i]!));
  }

  // Determine cursor position in the grid
  const cursorLineIdx = cursorLine.number - firstLine.number;
  // cursorRow: skip the separator in the row count
  let cursorRow = cursorLineIdx;
  if (cursorLineIdx > sepLineIdx) cursorRow--;
  if (cursorLineIdx === sepLineIdx) cursorRow = 0; // on separator → treat as header

  // cursorCol: count the CELL SEPARATORS before the cursor — not every "|",
  // which counted an escaped `\|` or a `[[Doc|Alias]]` pipe as a column too.
  const offsetInLine = pos - cursorLine.from;
  const before = cellSeparators(cursorLine.text).filter((i) => i < offsetInLine).length;
  const cursorCol = Math.max(0, before - 1);

  return {
    rows,
    alignments,
    from: firstLine.from,
    to: lastLine.to,
    cursorRow: Math.min(cursorRow, rows.length - 1),
    cursorCol: Math.min(cursorCol, (rows[0]?.length ?? 1) - 1),
    sepLineIdx,
    indent: /^[ \t]*/.exec(firstLine.text)?.[0] ?? "",
  };
}

// ---- Manipulation functions ----

export function mdAddRowAfter(view: EditorView): void {
  const table = mdParseTableAtCursor(view);
  if (!table) return;
  const { rows, cursorRow } = table;
  const colCount = rows[0]?.length ?? 1;
  const newRow = Array<string>(colCount).fill("");
  rows.splice(cursorRow + 1, 0, newRow);
  dispatchTable(view, table);
}

export function mdAddRowBefore(view: EditorView): void {
  const table = mdParseTableAtCursor(view);
  if (!table) return;
  const { rows, cursorRow } = table;
  const colCount = rows[0]?.length ?? 1;
  const newRow = Array<string>(colCount).fill("");
  // Don't insert before header (row 0) — insert after instead
  const insertIdx = cursorRow === 0 ? 1 : cursorRow;
  rows.splice(insertIdx, 0, newRow);
  dispatchTable(view, table);
}

export function mdDeleteRow(view: EditorView): void {
  const table = mdParseTableAtCursor(view);
  if (!table) return;
  const { rows, cursorRow } = table;
  if (rows.length <= 1) {
    // Only header left — delete entire table
    mdDeleteTable(view);
    return;
  }
  // Don't delete header row (row 0)
  if (cursorRow === 0 && rows.length > 1) {
    rows.splice(1, 1); // delete first data row instead
  } else {
    rows.splice(cursorRow, 1);
  }
  dispatchTable(view, table);
}

export function mdAddColumnAfter(view: EditorView): void {
  const table = mdParseTableAtCursor(view);
  if (!table) return;
  const { rows, alignments, cursorCol } = table;
  const insertIdx = cursorCol + 1;
  for (const row of rows) {
    row.splice(insertIdx, 0, "");
  }
  alignments.splice(insertIdx, 0, "");
  dispatchTable(view, table);
}

export function mdAddColumnBefore(view: EditorView): void {
  const table = mdParseTableAtCursor(view);
  if (!table) return;
  const { rows, alignments, cursorCol } = table;
  for (const row of rows) {
    row.splice(cursorCol, 0, "");
  }
  alignments.splice(cursorCol, 0, "");
  dispatchTable(view, table);
}

export function mdDeleteColumn(view: EditorView): void {
  const table = mdParseTableAtCursor(view);
  if (!table) return;
  const { rows, alignments, cursorCol } = table;
  if ((rows[0]?.length ?? 0) <= 1) {
    // Single column — delete entire table
    mdDeleteTable(view);
    return;
  }
  for (const row of rows) {
    row.splice(cursorCol, 1);
  }
  alignments.splice(cursorCol, 1);
  dispatchTable(view, table);
}

export function mdDeleteTable(view: EditorView): void {
  const table = mdParseTableAtCursor(view);
  if (!table) return;
  const { from, to } = table;
  // Remove the table and any trailing newline
  const doc = view.state.doc;
  const deleteTo =
    to < doc.length && doc.sliceString(to, to + 1) === "\n" ? to + 1 : to;
  const deleteFrom =
    from > 0 && doc.sliceString(from - 1, from) === "\n" ? from - 1 : from;
  view.dispatch({ changes: { from: deleteFrom, to: deleteTo, insert: "" } });
}

// ---- Helpers (exported for testing) ----

/** Check if a line looks like a pipe table row */
export function isPipeTableLine(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.length >= 3
  );
}

/** Find the separator line index (the one with only |, -, :, spaces) */
export function findSeparatorLineIdx(lines: string[]): number {
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    if (isSeparatorLine(lines[i]!)) return i;
  }
  return -1;
}

/** Check if a line is a separator (|---|---|) */
export function isSeparatorLine(text: string): boolean {
  return /^\|[\s:|-]+\|$/.test(text.trim());
}

/** A `[[…]]` wiki link starting exactly at `lastIndex` (sticky). */
const WIKI_AT = /\[\[[^\]]+\]\]/y;

/**
 * Offsets of the pipes in `text` that DELIMIT cells.
 *
 * `split("|")` treated every pipe as a column boundary, so adding one row to a
 * two-column table holding `x \| y` and `[[Doc|Alias]]` rewrote it as FOUR
 * columns — splitting the escaped pipe and the wiki link, and persisting it.
 * This follows what actually renders the table:
 *  - an ESCAPED pipe (`\|`, odd run of backslashes) is cell content;
 *  - a `[[…]]` wiki link is one unit: the preprocessor turns it into a link
 *    BEFORE marked splits the row, so its alias pipe never reaches marked;
 *  - a pipe inside a backtick code span still DELIMITS. GFM splits a row into
 *    cells before any inline parsing, and the marked build the preview uses
 *    renders "| `a|b` |" as two cells — treating it as content would make the
 *    table ops disagree with the table the user sees. (That is also why a
 *    `[[…]]` inside a code span is NOT a unit: the preprocessor masks code, so
 *    the link is never converted and marked splits it.)
 */
export function cellSeparators(text: string): number[] {
  const out: number[] = [];
  // marked's rule, verbatim: a pipe is escaped when an ODD run of backslashes
  // precedes it — inside a code span too.
  const escaped = (i: number) => {
    let n = 0;
    for (let j = i - 1; j >= 0 && text[j] === "\\"; j--) n++;
    return n % 2 === 1;
  };
  let codeTicks = 0; // length of the backtick run that opened the current code span
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "|") {
      if (!escaped(i)) out.push(i);
      continue;
    }
    if (ch === "`") {
      if (!codeTicks && escaped(i)) continue; // a literal backtick opens nothing
      let n = 1;
      while (text[i + n] === "`") n++;
      if (!codeTicks) codeTicks = n;
      else if (n === codeTicks) codeTicks = 0;
      i += n - 1;
      continue;
    }
    if (!codeTicks && ch === "[" && text[i + 1] === "[") {
      // The preprocessor's own wiki-link pattern, so "one unit" means exactly
      // what it will convert.
      WIKI_AT.lastIndex = i;
      const m = WIKI_AT.exec(text);
      if (m) { i += m[0].length - 1; continue; }
    }
  }
  return out;
}

/** Parse a pipe row into cell strings (trimmed; leading/trailing pipe optional). */
export function parsePipeRow(text: string): string[] {
  const trimmed = text.trim();
  const seps = cellSeparators(trimmed);
  const bounds = [-1, ...seps, trimmed.length];
  const cells: string[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    cells.push(trimmed.slice(bounds[i]! + 1, bounds[i + 1]!).trim());
  }
  // The outer pipes delimit nothing on their far side.
  if (seps[0] === 0) cells.shift();
  if (seps.length && seps[seps.length - 1] === trimmed.length - 1) cells.pop();
  return cells;
}

/**
 * Parse separator line for alignments.
 *
 * `:---` is an EXPLICIT left alignment and is kept as "left". It used to be
 * folded into the unmarked default, so any table operation silently rewrote
 * the user's `:---` as `---` — and the two are not the same table: marked emits
 * `align="left"` for one and nothing for the other.
 */
export function parseSeparator(text: string): string[] {
  const cells = parsePipeRow(text);
  return cells.map((cell) => {
    const c = cell.trim();
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "";
  });
}

/** Render a 2D grid + alignments back to GFM pipe table text */
export function renderTable(
  rows: string[][],
  alignments: string[]
): string {
  if (!rows.length) return "";
  const colCount = Math.max(...rows.map((r) => r.length), alignments.length);

  // Normalize: ensure all rows have colCount cells
  const normalized = rows.map((r) => {
    const nr = [...r];
    while (nr.length < colCount) nr.push("");
    return nr;
  });
  while (alignments.length < colCount) alignments.push("");

  // Column widths (minimum 3 for separator dashes)
  const widths = new Array<number>(colCount).fill(3);
  for (const row of normalized) {
    for (let i = 0; i < colCount; i++) {
      widths[i] = Math.max(widths[i] ?? 0, (row[i] ?? "").length);
    }
  }

  const pad = (text: string, w: number): string =>
    text + " ".repeat(Math.max(0, w - text.length));

  // Header row
  const headerCells = normalized[0]?.map((c, i) => pad(c, widths[i] ?? 0)) ?? [];
  const header = "| " + headerCells.join(" | ") + " |";

  // Separator row
  const sep = alignments.map((a, i) => {
    const w = widths[i];
    if (a === "center") return ":" + "-".repeat(Math.max(1, w! - 2)) + ":";
    if (a === "right") return "-".repeat(Math.max(1, w! - 1)) + ":";
    if (a === "left") return ":" + "-".repeat(Math.max(1, w! - 1));
    return "-".repeat(w!);
  });
  const sepLine = "| " + sep.join(" | ") + " |";

  // Data rows
  const dataLines = normalized.slice(1).map((row) => {
    const cells = row.map((c, i) => pad(c, widths[i] ?? 0));
    return "| " + cells.join(" | ") + " |";
  });

  return [header, sepLine, ...dataLines].join("\n");
}

// ---- Internal ----

function dispatchTable(view: EditorView, table: ParsedTable): void {
  const { rows, alignments, from, to, indent } = table;
  // Re-indent every line to where the table was: a table inside a list item
  // lives at the item's content column, and rendering it flush-left moved it
  // out of the list.
  const text = renderTable(rows, alignments)
    .split("\n")
    .map((line) => indent + line)
    .join("\n");
  view.dispatch({ changes: { from, to, insert: text } });
}
