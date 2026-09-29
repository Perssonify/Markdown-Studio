/**
 * Fidelity reporter: compares canonical PM JSON → markdown round-trip.
 *
 * When we serialize PM JSON to markdown (via Tiptap HTML → Turndown), some
 * information is lost. This module computes exactly what's lost.
 *
 * The report is displayed in the status bar when the MD pane is active,
 * and included in export dialogs.
 */

import { newCountAcc, countTextRun, type CountAcc, type PMNode } from "./document";

// --- Types ---

interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface PMNodeWithMarks extends PMNode {
  marks?: PMMark[];
}

export interface FidelityLoss {
  kind: "mark" | "attr";
  type?: string;
  attrs?: Record<string, unknown>;
  node?: string;
  attr?: string;
  value?: unknown;
  count: number;
}

export interface FidelityReport {
  lossless: boolean;
  losses: FidelityLoss[];
  summary: string;
  totalLossCount: number;
}

/**
 * Marks that ALWAYS survive a round-trip, so the badge must never count them.
 *
 * Two groups, both carried in Clean *and* Styled:
 *  - genuine markdown syntax (bold, italic, strike, code, link);
 *  - inline HTML written by rules in `addBaseRules` (turndown-rules.ts), which
 *    BOTH turndown instances get — `underline` → `<u>`, `subscript` → `<sub>`,
 *    `superscript` → `<sup>`.
 *
 * The name matters — these are not all "native markdown", and while this set was
 * called that, `underline`/`subscript`/`superscript` sat in the styled-only set
 * instead, so in Clean mode the status bar warned about three formats Clean does
 * not touch. Only `addInlineStyleRule` — the `<span style="…">` carrier — is
 * actually mode-dependent. Pinned by `clean-vs-styled.test.js` (which measures
 * the real turndown output) and `fidelity.test.js`.
 */
const MD_ALWAYS_CARRIED_MARKS = new Set([
  "bold",
  "italic",
  "strike",
  "code",
  "link",
  "underline",
  "subscript",
  "superscript",
]);

/** Marks carried ONLY by the styled-mode `<span style="…">` rule. */
const MD_STYLED_ONLY_MARKS = new Set([
  "textStyle",
  "highlight",
]);

/**
 * Walk the PM JSON tree once, bucketing every lossy feature as it is found.
 *
 * This used to be two passes with an array between them: `collectFeatures`
 * allocated one object per mark and per notable attribute in the whole
 * document, then the caller de-duplicated that array with a linear `find` that
 * ran `JSON.stringify` on both sides — quadratic in the number of distinct
 * losses, with two fresh JSON strings per comparison. The bucket key does the
 * same comparison once, at first sight, and the Map preserves first-seen order
 * so the resulting `losses` array is identical to what the array version built.
 */
function collectLosses(
  node: PMNodeWithMarks | null | undefined,
  syncMode: "clean" | "styled",
  losses: Map<string, FidelityLoss>,
  counts: CountAcc | null
): void {
  if (!node) return;

  if (counts && node.type === "text" && node.text) countTextRun(node.text, counts);

  const marks = node.marks;
  if (marks) {
    for (const mark of marks) {
      const type = mark.type;
      if (MD_ALWAYS_CARRIED_MARKS.has(type ?? "")) continue;
      if (syncMode === "styled" && MD_STYLED_ONLY_MARKS.has(type ?? "")) continue;
      const attrs = mark.attrs ?? {};
      const key = "m\u0000" + (type ?? "") + "\u0000" + JSON.stringify(attrs);
      const existing = losses.get(key);
      if (existing) existing.count++;
      else losses.set(key, { kind: "mark", type: type ?? "", attrs, count: 1 });
    }
  }

  const attrs = node.attrs as Record<string, unknown> | undefined;
  if (attrs) {
    // An image's width/height are NOT a loss: the `sizedImage` turndown rule
    // (addBaseRules, so both modes) serializes a sized image as an `<img …
    // width="…">` tag precisely so the size survives. Counting them meant the
    // shipped Welcome document — which carries one sized logo — greeted every
    // new user with an amber "1 other not in MD". Same lesson as the residual
    // list: a warning that flags our own renderer's output is worse than none.
    if (node.type === "heading" || node.type === "paragraph") {
      const align = attrs["textAlign"];
      if (align && align !== "left") addAttrLoss(losses, node.type, "textAlign", align);
    }
    // A GFM table cell is one line of inline content. Merged cells, and any
    // block structure inside a cell (a list, a second paragraph, a code block)
    // are flattened by the table serializer — text kept, structure not.
    if (node.type === "tableCell" || node.type === "tableHeader") {
      if (Number(attrs["colspan"] ?? 1) > 1 || Number(attrs["rowspan"] ?? 1) > 1) {
        addAttrLoss(losses, node.type, "span", "merged");
      }
      const blocks = node.content ?? [];
      if (blocks.length > 1 || blocks.some((b) => b.type !== "paragraph")) {
        addAttrLoss(losses, node.type, "blocks", "structure");
      }
    }
  }

  const content = node.content;
  if (!content) return;
  for (const child of content) {
    collectLosses(child as PMNodeWithMarks, syncMode, losses, counts);
  }
}

function addAttrLoss(
  losses: Map<string, FidelityLoss>,
  node: string,
  attr: string,
  value: unknown
): void {
  // Keyed on node+attr only — the original de-duplicated attribute losses that
  // way too, keeping the FIRST value it saw.
  const key = "a\u0000" + node + "\u0000" + attr;
  const existing = losses.get(key);
  if (existing) existing.count++;
  else losses.set(key, { kind: "attr", node, attr, value, count: 1 });
}

/**
 * Compute fidelity report for canonical → markdown serialization.
 *
 * @param canonical — ProseMirror JSON document
 * @param syncMode — "clean" | "styled"
 */
export function computeFidelity(
  canonical: PMNode | null | undefined,
  syncMode: "clean" | "styled" = "clean"
): FidelityReport {
  if (!canonical) {
    return { lossless: true, losses: [], summary: "", totalLossCount: 0 };
  }

  const buckets = new Map<string, FidelityLoss>();
  collectLosses(canonical as PMNodeWithMarks, syncMode, buckets, null);
  const losses = Array.from(buckets.values());

  return summarizeLosses(losses);
}

/** Turn the bucketed losses into the report shape (shared by both entry
 *  points, so the summary wording can never drift between them). */
function summarizeLosses(losses: FidelityLoss[]): FidelityReport {
  let summary = "";
  if (losses.length > 0) {
    const parts: string[] = [];
    const colorLosses = losses.filter(
      (l) => l.type === "textStyle" && l.attrs?.["color"]
    );
    const fontLosses = losses.filter(
      (l) => l.type === "textStyle" && l.attrs?.["fontFamily"]
    );
    const highlightLosses = losses.filter((l) => l.type === "highlight");
    const alignLosses = losses.filter((l) => l.attr === "textAlign");
    const otherLosses = losses.filter(
      (l) =>
        !(
          l.type === "textStyle" ||
          l.type === "highlight" ||
          l.attr === "textAlign"
        )
    );

    if (colorLosses.length) {
      const total = colorLosses.reduce((n, l) => n + l.count, 0);
      parts.push(`${total} color${total > 1 ? "s" : ""}`);
    }
    if (fontLosses.length) {
      const total = fontLosses.reduce((n, l) => n + l.count, 0);
      parts.push(`${total} font${total > 1 ? "s" : ""}`);
    }
    if (highlightLosses.length) {
      const total = highlightLosses.reduce((n, l) => n + l.count, 0);
      parts.push(`${total} highlight${total > 1 ? "s" : ""}`);
    }
    if (alignLosses.length) {
      const total = alignLosses.reduce((n, l) => n + l.count, 0);
      parts.push(`${total} alignment${total > 1 ? "s" : ""}`);
    }
    if (otherLosses.length) {
      const total = otherLosses.reduce((n, l) => n + l.count, 0);
      parts.push(`${total} other`);
    }

    summary = parts.join(", ") + " not in MD";
  }

  return {
    lossless: losses.length === 0,
    losses,
    summary,
    totalLossCount: losses.reduce((n, l) => n + l.count, 0),
  };
}

/**
 * Fidelity report AND word/character counts from a SINGLE walk of the document.
 *
 * The sync path needs both on every projection and used to walk the whole
 * canonical twice, back to back, to get them. They are computed together here;
 * each is identical to what its own function returns.
 */
export function computeCanonicalStats(
  canonical: PMNode | null | undefined,
  syncMode: "clean" | "styled" = "clean"
): { fidelity: FidelityReport; counts: { chars: number; words: number } } {
  if (!canonical) {
    return {
      fidelity: { lossless: true, losses: [], summary: "", totalLossCount: 0 },
      counts: { chars: 0, words: 0 },
    };
  }
  const buckets = new Map<string, FidelityLoss>();
  const acc = newCountAcc();
  collectLosses(canonical as PMNodeWithMarks, syncMode, buckets, acc);
  return {
    fidelity: summarizeLosses(Array.from(buckets.values())),
    counts: { chars: acc.chars, words: acc.words },
  };
}
