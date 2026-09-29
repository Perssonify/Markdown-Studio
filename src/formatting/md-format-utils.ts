/**
 * Pure formatting utilities for CM6 markdown editing.
 *
 * Extracted from useFormatDispatcher to enable unit testing.
 * These functions take a CM6 EditorView directly (no React refs).
 */

import type { EditorView } from "@codemirror/view";

/**
 * Wrap or unwrap the current selection with markdown markers.
 *
 * Toggle behavior:
 *   - If selection is already wrapped with the markers, unwrap
 *   - Otherwise, wrap the selection
 *
 * Submarker detection:
 *   For single-char markers (* _ `), checks if the detected marker is
 *   actually part of a longer marker (e.g., * inside ** for bold).
 *   Uses run-counting: run=1 → standalone, run=2 → part of **, run=3+ → nested.
 *
 * @param view — CM6 editor view
 * @param before — opening marker (e.g., "**", "*", "~~")
 * @param after — closing marker
 */
// Markers that follow CommonMark's left/right flanking rules — spaces inside
// the delimiter boundary will break emphasis, so we must hoist them outside.
// IMPORTANT: Do not include backticks (`) here — code spans do not use flanking rules.
const FLANKING_MARKERS = new Set(["*", "**", "***", "_", "__", "~~"]);

export function mdWrap(
  view: EditorView,
  before: string,
  after: string
): void {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);

  const beforeLen = before.length;
  const afterLen = after.length;

  // Check if already wrapped — unwrap if so
  if (from >= beforeLen && to + afterLen <= view.state.doc.length) {
    const outerBefore = view.state.sliceDoc(from - beforeLen, from);
    const outerAfter = view.state.sliceDoc(to, to + afterLen);
    if (outerBefore === before && outerAfter === after) {
      // Submarker check for single-char markers
      if (!isSubmarker(view, from, to, before, after)) {
        // Unwrap
        view.dispatch({
          changes: [
            { from: from - beforeLen, to: from, insert: "" },
            { from: to, to: to + afterLen, insert: "" },
          ],
          selection: { anchor: from - beforeLen, head: to - beforeLen },
        });
        return;
      }
    }
  }

  // For CommonMark flanking markers, hoist leading/trailing spaces outside
  // the delimiters so they don't break the flanking-delimiter rules.
  // e.g. "Hi   " → "*Hi*   " instead of "*Hi   *"
  let leadingSpaces = "";
  let trailingSpaces = "";
  let inner = selected;

  if (FLANKING_MARKERS.has(before)) {
    const leadMatch = inner.match(/^(\s+)/);
    if (leadMatch) {
      leadingSpaces = leadMatch[1]!;
      inner = inner.slice(leadingSpaces.length);
    }
    const trailMatch = inner.match(/(\s+)$/);
    if (trailMatch) {
      trailingSpaces = trailMatch[1]!;
      inner = inner.slice(0, inner.length - trailingSpaces.length);
    }
  }

  // If the entire selection was whitespace, wrap it as-is (nothing to format)
  if (inner === "") {
    view.dispatch({
      changes: { from, to, insert: before + selected + after },
      selection: { anchor: from + beforeLen, head: to + beforeLen },
    });
    return;
  }

  const insert = leadingSpaces + before + inner + after + trailingSpaces;
  view.dispatch({
    changes: { from, to, insert },
    // Place selection over the wrapped inner content
    selection: {
      anchor: from + leadingSpaces.length + beforeLen,
      head: from + leadingSpaces.length + beforeLen + inner.length,
    },
  });
}

/**
 * Check if the selection is currently wrapped with the given markers.
 *
 * Mirrors mdWrap's unwrap detection exactly so that the toolbar state
 * matches what mdWrap would do (toggle ↔ indicator consistency).
 *
 * @param view — CM6 editor view
 * @param before — opening marker
 * @param after — closing marker
 * @returns whether selection is wrapped
 */
export function isWrapped(
  view: EditorView,
  before: string,
  after: string
): boolean {
  const { from, to } = view.state.selection.main;
  const bLen = before.length;
  const aLen = after.length;
  const docLen = view.state.doc.length;

  if (from < bLen || to + aLen > docLen) return false;

  const outerBefore = view.state.sliceDoc(from - bLen, from);
  const outerAfter = view.state.sliceDoc(to, to + aLen);
  if (outerBefore !== before || outerAfter !== after) return false;

  // Submarker check
  return !isSubmarker(view, from, to, before, after);
}

/**
 * Check if a single-char marker at the selection boundary is actually
 * part of a multi-char marker (e.g., * inside ** for bold).
 *
 * @internal
 */
function isSubmarker(
  view: EditorView,
  from: number,
  to: number,
  before: string,
  after: string
): boolean {
  if (before.length !== 1) return false;

  let runBefore = 0;
  let p = from - 1;
  while (p >= 0 && view.state.sliceDoc(p, p + 1) === before) {
    runBefore++;
    p--;
  }

  let runAfter = 0;
  p = to;
  while (
    p < view.state.doc.length &&
    view.state.sliceDoc(p, p + 1) === after
  ) {
    runAfter++;
    p++;
  }

  // run=2 means the single char is part of a ** double marker
  return runBefore === 2 || runAfter === 2;
}
