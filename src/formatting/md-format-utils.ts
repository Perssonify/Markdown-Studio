/**
 * Pure formatting utilities for CM6 markdown editing.
 *
 * Extracted from useFormatDispatcher to enable unit testing.
 * These functions take a CM6 EditorView directly (no React refs).
 */

import { EditorSelection, type EditorState, type SelectionRange, type ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * Wrap or unwrap EVERY selected range with markdown markers.
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
  mdWrapBy(view, () => [before, after]);
}

/**
 * `mdWrap` with the markers chosen PER RANGE (inline code vs a fenced block
 * depends on whether that range spans lines).
 *
 * Every range of the selection is wrapped, not just `selection.main`. The
 * multi-range selections come from Select ▸ All headings / list items / Find
 * all, whose whole point is to format every match at once — and a formatter
 * that read only the main range bolded the first heading and silently ignored
 * the rest.
 */
export function mdWrapBy(
  view: EditorView,
  markersFor: (selected: string) => [string, string]
): void {
  const { state } = view;
  view.dispatch(
    state.changeByRange((range) => {
      const [before, after] = markersFor(state.sliceDoc(range.from, range.to));
      return wrapRange(state, range, before, after);
    })
  );
}

/** Wrap or unwrap ONE range. Changes are in the start document's coordinates;
 *  the returned range is in the coordinates this range's own change produces
 *  (CodeMirror maps it through the other ranges' changes). */
function wrapRange(
  state: EditorState,
  range: SelectionRange,
  before: string,
  after: string
): { changes: ChangeSpec; range: SelectionRange } {
  const { from, to } = range;
  const selected = state.sliceDoc(from, to);

  const beforeLen = before.length;
  const afterLen = after.length;

  // Check if already wrapped — unwrap if so
  if (from >= beforeLen && to + afterLen <= state.doc.length) {
    const outerBefore = state.sliceDoc(from - beforeLen, from);
    const outerAfter = state.sliceDoc(to, to + afterLen);
    if (outerBefore === before && outerAfter === after) {
      // Submarker check for single-char markers
      if (!isSubmarker(state, from, to, before, after)) {
        // Unwrap
        return {
          changes: [
            { from: from - beforeLen, to: from, insert: "" },
            { from: to, to: to + afterLen, insert: "" },
          ],
          range: EditorSelection.range(from - beforeLen, to - beforeLen),
        };
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
    return {
      changes: { from, to, insert: before + selected + after },
      range: EditorSelection.range(from + beforeLen, to + beforeLen),
    };
  }

  const insert = leadingSpaces + before + inner + after + trailingSpaces;
  const innerFrom = from + leadingSpaces.length + beforeLen;
  return {
    changes: { from, to, insert },
    // Place selection over the wrapped inner content
    range: EditorSelection.range(innerFrom, innerFrom + inner.length),
  };
}

// Private-use delimiters for masked spans (as in case-transform.ts): never in
// real text, and unlike bare digits they cannot collide with numbers on restore.
const M0 = "";
const M1 = "";

/** Inline FORMATTING tags — unwrapped, their text kept. Anything else (img,
 *  br, details, picture, a…) is content or structure and is left alone. */
const FORMAT_TAG = /<\/?(?:u|sub|sup|s|del|strike|mark|b|strong|i|em|span)(?:\s[^>]*)?>/gi;

let cachedPasses: [RegExp, string][] | null = null;

/**
 * The emphasis-stripping passes for clearMdFormatting. Three of them need the
 * delimiter's LEFT neighbour. As a lookbehind in a regex LITERAL that is a
 * parse-time SyntaxError on Safari/iOS before 16.4, and this module is in the
 * entry chunk, so one literal would blank the whole app (A097). So they are
 * compiled from strings at runtime; where lookbehind is unsupported the same
 * check runs as a CAPTURED left neighbour that the replacement puts back.
 * `lookbehind` is a parameter so the fallback can be tested where it isn't needed.
 */
export function emphasisPasses(lookbehind = supportsLookbehind()): [RegExp, string][] {
  if (lookbehind && cachedPasses) return cachedPasses;
  const strong: [RegExp, string] = [/\*\*(?![\s*])([^\n]*?[^\s*])\*\*/g, "$1"];
  const strike: [RegExp, string] = [/~~(?!\s)([^\n]*?\S)~~/g, "$1"];
  if (lookbehind) {
    cachedPasses = [
      strong,
      [new RegExp("(?<![\\p{L}\\p{N}_])__(?![\\s_])([^\\n]*?[^\\s_])__(?![\\p{L}\\p{N}_])", "gu"), "$1"],
      strike,
      [new RegExp("(?<!\\*)\\*(?![\\s*])([^\\n*]*?[^\\s*])\\*(?!\\*)", "g"), "$1"],
      [new RegExp("(?<![\\p{L}\\p{N}_])_(?![\\s_])([^\\n_]*?[^\\s_])_(?![\\p{L}\\p{N}_])", "gu"), "$1"],
    ];
    return cachedPasses;
  }
  return [
    strong,
    [/(^|[^\p{L}\p{N}_])__(?![\s_])([^\n]*?[^\s_])__(?![\p{L}\p{N}_])/gu, "$1$2"],
    strike,
    [/(^|[^*])\*(?![\s*])([^\n*]*?[^\s*])\*(?!\*)/g, "$1$2"],
    [/(^|[^\p{L}\p{N}_])_(?![\s_])([^\n_]*?[^\s_])_(?![\p{L}\p{N}_])/gu, "$1$2"],
  ];
}

function supportsLookbehind(): boolean {
  try {
    new RegExp("(?<!a)b");
    return true;
  } catch {
    return false;
  }
}

/**
 * Markdown-pane "Clear formatting": remove emphasis, strikethrough and the
 * inline formatting tags from `src`, and nothing else.
 *
 * It used to be five regexes run over the raw text, the last of which was
 * `<[^>]+>` → "": it DELETED `<img>` tags, `<https://…>` autolinks and every
 * other tag, and `\*(.+?)\*` ate the multiplication signs in `5 * 3 * 2`,
 * list bullets, and the contents of code spans. The rich pane's version only
 * removes marks; this one now only removes formatting:
 *  - code spans, images, link destinations, autolinks, bare URLs, inline math
 *    and every non-formatting tag are masked first, so nothing inside them can
 *    be read as a delimiter (and none of them is removed);
 *  - emphasis must be BALANCED and flanking the CommonMark way: `* 3 *` (a
 *    delimiter followed by a space) is not emphasis, `snake_case_name` is not,
 *    a list bullet is not;
 *  - it works line by line — an unmatched `**` cannot pair with one on a later
 *    line and strip everything in between.
 * Code spans are kept (unwrapping one could turn its literal `*a*` into
 * emphasis — clearing formatting must not create it), and so are links (the
 * URL is content).
 */
export function clearMdFormatting(src: string): string {
  const store: string[] = [];
  const stash = (m: string) => M0 + (store.push(m) - 1) + M1;
  let t = src
    .replace(/(`+)[\s\S]*?\1/g, stash)                         // code spans
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, stash)                // images, whole
    .replace(/\]\([^)\n]*\)/g, stash)                           // link destinations
    .replace(/<(?:https?:\/\/|mailto:)[^>\s]+>/gi, stash)       // autolinks
    .replace(/\bhttps?:\/\/[^\s<>)]+/g, stash)                  // bare URLs
    .replace(/\$[^$\n]+\$/g, stash);                            // inline math
  t = t.replace(FORMAT_TAG, "").replace(/<[^>\n]+>/g, stash);   // unwrap formatting, keep the rest

  const passes = emphasisPasses();
  // `***x***` peels one layer per round.
  for (let round = 0; round < 6; round++) {
    const before = t;
    for (const [re, rep] of passes) t = t.replace(re, rep);
    if (t === before) break;
  }
  const unmask = new RegExp(`${M0}(\\d+)${M1}`, "g");
  // Masks can nest (a code span inside a link destination), so restore to a fixpoint.
  for (let round = 0; round < 4 && t.includes(M0); round++) {
    t = t.replace(unmask, (_m, i) => store[Number(i)] ?? "");
  }
  return t;
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
  return !isSubmarker(view.state, from, to, before, after);
}

/**
 * Check if a single-char marker at the selection boundary is actually
 * part of a multi-char marker (e.g., * inside ** for bold).
 *
 * @internal
 */
function isSubmarker(
  state: EditorState,
  from: number,
  to: number,
  before: string,
  after: string
): boolean {
  if (before.length !== 1) return false;

  let runBefore = 0;
  let p = from - 1;
  while (p >= 0 && state.sliceDoc(p, p + 1) === before) {
    runBefore++;
    p--;
  }

  let runAfter = 0;
  p = to;
  while (
    p < state.doc.length &&
    state.sliceDoc(p, p + 1) === after
  ) {
    runAfter++;
    p++;
  }

  // run=2 means the single char is part of a ** double marker
  return runBefore === 2 || runAfter === 2;
}
