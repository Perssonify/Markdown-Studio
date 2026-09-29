// Structured "Select" engine for the Select ▸ … submenu (Edit tab + right-click).
//
// Select is SELECTION-ONLY: each entry places a real editor selection. "Current
// block" selects a single range; scattered scopes (all headings, all code blocks,
// …) place a MULTI-range selection in the Markdown pane, which CodeMirror supports
// natively (EditorState.allowMultipleSelections is enabled on the CM pane). Acting
// on the selection afterwards is done with the normal toolbar / menus / Find▸Format.

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

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

/** Every range matching `scope` in the raw Markdown text, in document order. */
function mdScopeRanges(doc: string, scope: string): Range[] {
  const lines = doc.split("\n");
  const starts: number[] = [];
  let off = 0;
  for (const l of lines) { starts.push(off); off += l.length + 1; }
  const lineRange = (i: number): Range => ({ from: starts[i]!, to: starts[i]! + lines[i]!.length });
  const out: Range[] = [];
  const headingLevel = /^h([1-6])$/.exec(scope);

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

    if (scope === "headings" && /^#{1,6}\s/.test(line)) out.push(lineRange(i));
    else if (headingLevel && new RegExp(`^#{${headingLevel[1]}}\\s`).test(line)) out.push(lineRange(i));
    else if (scope === "blockquote" && /^>\s?/.test(line)) out.push(lineRange(i));
    else if (scope === "taskList" && /^\s*[-*+]\s+\[[ xX]\]/.test(line)) out.push(lineRange(i));
    else if (scope === "bulletList" && /^\s*[-*+]\s+/.test(line) && !/^\s*[-*+]\s+\[[ xX]\]/.test(line)) out.push(lineRange(i));
    else if (scope === "orderedList" && /^\s*\d+\.\s+/.test(line)) out.push(lineRange(i));
    else if (scope === "table" && /^\s*\|.*\|\s*$/.test(line)) out.push(lineRange(i));
    else if (scope === "paragraphs" && line.trim() && !/^(#{1,6}\s|>|\s*[-*+]\s|\s*\d+\.\s|\s*\||\s{0,3}(```|~~~))/.test(line)) out.push(lineRange(i));
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
