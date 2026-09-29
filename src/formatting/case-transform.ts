import type { EditorView } from "@codemirror/view";

/**
 * Case transforms (UPPERCASE / lowercase / Title Case) for both panes.
 *
 * "Content only" mode skips code-like structure so a transform never mangles
 * syntax the document depends on:
 *  - rich pane: text carrying the `code` mark and text inside a `codeBlock`;
 *  - markdown pane: fenced/inline code, HTML tags, and link/image URLs (the
 *    part after `](`), plus bare URLs. Markdown punctuation (`#`, `**`, `[`…)
 *    is non-alphabetic, so casing leaves it untouched either way.
 */

export type CaseMode = "upper" | "lower" | "title";

export function applyCase(text: string, mode: CaseMode): string {
  switch (mode) {
    case "upper":
      return text.toUpperCase();
    case "lower":
      return text.toLowerCase();
    case "title":
      // Capitalize the first letter of each word, lowercase the rest.
      return text.replace(/\p{L}[\p{L}\p{M}'’]*/gu, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  }
}

// ── Rich pane (TipTap / ProseMirror) ────────────────────────────────────────

interface TextEdit {
  from: number;
  to: number;
  text: string;
  marks: readonly unknown[];
}

/** Collect case edits for the text between [from,to), honoring contentOnly. */
function collectEdits(
  doc: any,
  from: number,
  to: number,
  mode: CaseMode,
  contentOnly: boolean
): TextEdit[] {
  const edits: TextEdit[] = [];
  doc.nodesBetween(from, to, (node: any, pos: number, parent: any) => {
    if (!node.isText) return;
    if (contentOnly) {
      if (parent?.type?.name === "codeBlock") return;
      if (node.marks?.some((m: any) => m.type.name === "code")) return;
    }
    const segFrom = Math.max(pos, from);
    const segTo = Math.min(pos + node.nodeSize, to);
    if (segFrom >= segTo) return;
    const original = node.text.slice(segFrom - pos, segTo - pos);
    const transformed = applyCase(original, mode);
    if (transformed !== original) {
      edits.push({ from: segFrom, to: segTo, text: transformed, marks: node.marks });
    }
  });
  return edits;
}

function applyEdits(editor: any, edits: TextEdit[]): boolean {
  if (!edits.length) return false;
  const { state } = editor;
  let tr = state.tr;
  // End-to-start so earlier positions stay valid.
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i]!;
    tr = tr.replaceWith(e.from, e.to, state.schema.text(e.text, e.marks as any));
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Transform the case of the current selection in the rich pane. */
export function transformCaseTiptap(editor: any, mode: CaseMode, contentOnly: boolean): void {
  const { from, to, empty } = editor.state.selection;
  if (empty) return;
  const edits = collectEdits(editor.state.doc, from, to, mode, contentOnly);
  if (applyEdits(editor, edits)) editor.view.focus();
}

/** Transform the case of the text of every heading in the rich pane. */
export function headingsCaseTiptap(editor: any, mode: CaseMode, contentOnly: boolean): void {
  const { doc } = editor.state;
  const all: TextEdit[] = [];
  doc.descendants((node: any, pos: number) => {
    if (node.type.name !== "heading") return;
    all.push(...collectEdits(doc, pos, pos + node.nodeSize, mode, contentOnly));
  });
  applyEdits(editor, all);
}

// ── Markdown pane (CodeMirror) ──────────────────────────────────────────────

// Private-use-area delimiters for masked spans: never appear in real text, are
// unaffected by case changes, and (unlike bare digits) can't collide with
// numbers already in the document on restore.
const M0 = "";
const M1 = "";

/** Case-transform a raw markdown string, optionally masking code/URLs. */
export function transformCaseMarkdown(src: string, mode: CaseMode, contentOnly: boolean): string {
  if (!contentOnly) return applyCase(src, mode);
  const store: string[] = [];
  const stash = (m: string) => M0 + (store.push(m) - 1) + M1;
  const masked = src
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, stash) // fenced code
    .replace(/(`+)[\s\S]*?\1/g, stash) // inline code
    .replace(/<[^>]+>/g, stash) // HTML tags
    .replace(/\]\(([^)]+)\)/g, stash) // link/image destination "](url)"
    .replace(/\bhttps?:\/\/\S+/g, stash); // bare URLs
  const cased = applyCase(masked, mode);
  return cased.replace(new RegExp(M0 + "(\\d+)" + M1, "g"), (_m, i) => store[Number(i)] ?? "");
}

/** Transform the case of the current selection in the markdown pane. */
export function transformCaseCM(view: EditorView, mode: CaseMode, contentOnly: boolean): void {
  const { from, to } = view.state.selection.main;
  if (from === to) return;
  const src = view.state.sliceDoc(from, to);
  const out = transformCaseMarkdown(src, mode, contentOnly);
  if (out !== src) {
    view.dispatch({ changes: { from, to, insert: out }, selection: { anchor: from, head: from + out.length } });
  }
}

/** Transform the case of every ATX heading line in the markdown pane. */
export function headingsCaseCM(view: EditorView, mode: CaseMode, contentOnly: boolean): void {
  const doc = view.state.doc;
  const changes: { from: number; to: number; insert: string }[] = [];
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const m = line.text.match(/^(#{1,6}\s+)(.*)$/);
    if (!m) continue;
    const content = m[2]!;
    const out = transformCaseMarkdown(content, mode, contentOnly);
    if (out !== content) {
      const start = line.from + m[1]!.length;
      changes.push({ from: start, to: line.to, insert: out });
    }
  }
  if (changes.length) view.dispatch({ changes });
}
