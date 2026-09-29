// Structured "Select" engine for the Select ▸ … submenu (Edit tab + right-click).
//
// Select is SELECTION-ONLY: each entry places a real editor selection. "Current
// block" selects a single range; scattered scopes (all headings, all code blocks,
// …) place a MULTI-range selection in the Markdown pane, which CodeMirror supports
// natively (EditorState.allowMultipleSelections is enabled on the CM pane). Acting
// on the selection afterwards is done with the normal toolbar / menus / Find▸Format.

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { cellSeparators, isSeparatorLine } from "./md-table-ops";

export interface ScopeType {
  id: string;
  label: string;
  group: "Headings" | "Paragraphs & lists" | "Blocks" | "Inline";
}

// The menu is built from this table (grouped, folder-style). Order = display order.
export const SCOPE_TYPES: ScopeType[] = [
  { id: "headings", label: "All headings", group: "Headings" },
  { id: "h1", label: "Heading 1", group: "Headings" },
  { id: "h2", label: "Heading 2", group: "Headings" },
  { id: "h3", label: "Heading 3", group: "Headings" },
  { id: "h4", label: "Heading 4", group: "Headings" },
  { id: "h5", label: "Heading 5", group: "Headings" },
  { id: "h6", label: "Heading 6", group: "Headings" },
  { id: "paragraphs", label: "Paragraphs", group: "Paragraphs & lists" },
  { id: "bulletList", label: "Bulleted list items", group: "Paragraphs & lists" },
  { id: "orderedList", label: "Numbered list items", group: "Paragraphs & lists" },
  { id: "taskList", label: "Task list items", group: "Paragraphs & lists" },
  { id: "codeBlock", label: "Code blocks", group: "Blocks" },
  { id: "blockquote", label: "Blockquotes", group: "Blocks" },
  { id: "table", label: "Table rows", group: "Blocks" },
  { id: "image", label: "Images", group: "Blocks" },
  { id: "inlineCode", label: "Inline code", group: "Inline" },
  { id: "link", label: "Links", group: "Inline" },
];

export const SCOPE_GROUPS = ["Headings", "Paragraphs & lists", "Blocks", "Inline"] as const;

interface Range { from: number; to: number }

// Block markers, stripped from a line-scope selection (see contentOf).
const HEADING_MARK = /^ {0,3}#{1,6}(?:\s+|$)/;
const HEADING_CLOSE = /\s+#+\s*$/;              // optional closing sequence: "## Title ##"
const QUOTE_MARK = /^\s*(?:>\s?)+/;
const TASK_MARK = /^\s*[-*+]\s+\[[ xX]\]\s*/;
const BULLET_MARK = /^\s*[-*+]\s+/;
const ORDERED_MARK = /^\s*\d{1,9}[.)]\s+/;

/**
 * Every range matching `scope` in the raw Markdown text, in document order.
 *
 * Line scopes select the CONTENT of each line — after its block marker (`## `,
 * `- `, `1. `, `- [ ] `, `> `) and before trailing space. They used to select
 * the whole line, marker included, so the feature's documented use — Select ▸
 * All headings, then Bold — turned `## Alpha` into `**## Alpha**`, which is no
 * longer a heading at all. A table row selects each CELL's content (a row
 * wrapped as one unit breaks its pipes), and the delimiter row is not content.
 */
function mdScopeRanges(doc: string, scope: string): Range[] {
  const lines = doc.split("\n");
  const starts: number[] = [];
  let off = 0;
  for (const l of lines) { starts.push(off); off += l.length + 1; }
  const out: Range[] = [];
  const headingLevel = /^h([1-6])$/.exec(scope);
  /** Line `i` minus `marker` (and `closing`), trimmed; null when nothing is left. */
  const contentOf = (i: number, marker: RegExp | null, closing?: RegExp): Range | null => {
    const line = lines[i]!;
    let start = marker ? (marker.exec(line)?.[0].length ?? 0) : 0;
    let end = line.length;
    if (closing) {
      const c = closing.exec(line.slice(start));
      if (c) end = start + c.index;
    }
    while (start < end && /\s/.test(line[start]!)) start++;
    while (end > start && /\s/.test(line[end - 1]!)) end--;
    return end > start ? { from: starts[i]! + start, to: starts[i]! + end } : null;
  };
  const push = (r: Range | null) => { if (r) out.push(r); };

  // Line-based block scopes (skip inside fenced code, except when selecting code).
  let inFence = false, fenceStart = -1, fenceMark = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceM = line.match(/^(```|~~~)/);
    if (inFence) {
      if (fenceM && line.startsWith(fenceMark)) {
        if (scope === "codeBlock") out.push({ from: starts[fenceStart]!, to: starts[i]! + line.length });
        inFence = false;
      }
      continue;
    }
    if (fenceM) { inFence = true; fenceStart = i; fenceMark = fenceM[1]!; continue; }

    if (scope === "headings" && /^#{1,6}\s/.test(line)) push(contentOf(i, HEADING_MARK, HEADING_CLOSE));
    else if (headingLevel && new RegExp(`^#{${headingLevel[1]}}\\s`).test(line)) push(contentOf(i, HEADING_MARK, HEADING_CLOSE));
    else if (scope === "blockquote" && /^>\s?/.test(line)) push(contentOf(i, QUOTE_MARK));
    else if (scope === "taskList" && TASK_MARK.test(line)) push(contentOf(i, TASK_MARK));
    else if (scope === "bulletList" && BULLET_MARK.test(line) && !TASK_MARK.test(line)) push(contentOf(i, BULLET_MARK));
    else if (scope === "orderedList" && ORDERED_MARK.test(line)) push(contentOf(i, ORDERED_MARK));
    else if (scope === "table" && /^\s*\|.*\|\s*$/.test(line)) {
      if (isSeparatorLine(line)) continue;
      const seps = cellSeparators(line);
      for (let s = 0; s + 1 < seps.length; s++) {
        let a = seps[s]! + 1, b = seps[s + 1]!;
        while (a < b && /\s/.test(line[a]!)) a++;
        while (b > a && /\s/.test(line[b - 1]!)) b--;
        if (b > a) out.push({ from: starts[i]! + a, to: starts[i]! + b });
      }
    }
    else if (scope === "paragraphs" && line.trim() && !/^(#{1,6}\s|>|\s*[-*+]\s|\s*\d+\.\s|\s*\||\s{0,3}(```|~~~))/.test(line)) push(contentOf(i, null));
  }

  // Inline scopes via regex over the whole document.
  let m: RegExpExecArray | null;
  if (scope === "inlineCode") { const re = /`[^`\n]+`/g; while ((m = re.exec(doc))) out.push({ from: m.index, to: m.index + m[0].length }); }
  if (scope === "link") { const re = /\[[^\]]*\]\([^)]*\)/g; while ((m = re.exec(doc))) out.push({ from: m.index, to: m.index + m[0].length }); }
  if (scope === "image") { const re = /!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>/gi; while ((m = re.exec(doc))) out.push({ from: m.index, to: m.index + m[0].length }); }

  return out.sort((a, b) => a.from - b.from);
}

/** Place a (multi-range) selection over every instance of `scope` in the MD pane.
 *  Returns the number of ranges selected. */
export function selectScopeCM(view: EditorView, scope: string): number {
  const ranges = mdScopeRanges(view.state.doc.toString(), scope);
  if (!ranges.length) return 0;
  const sel = EditorSelection.create(ranges.map((r) => EditorSelection.range(r.from, r.to)), 0);
  view.dispatch({ selection: sel, scrollIntoView: true });
  view.focus();
  return ranges.length;
}

/** Select the block/node containing the cursor in the rich editor (contiguous). */
export function selectBlockRich(editor: any): boolean {
  const { state } = editor;
  const $from = state.selection.$from;
  const depth = $from.depth;
  if (depth < 1) return false;
  const from = $from.before(depth);
  const to = $from.after(depth);
  editor.chain().focus().setTextSelection({ from: from + 1, to: to - 1 }).run();
  return true;
}
