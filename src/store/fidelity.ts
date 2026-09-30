/**
 * Fidelity reporter: compares canonical PM JSON → markdown round-trip.
 *
 * When we serialize PM JSON to markdown (via Tiptap HTML → Turndown), some
 * information is lost. This module computes exactly what's lost.
 *
 * The report is displayed in the status bar when the MD pane is active,
 * and included in export dialogs.
 */

import { newCountAcc, countTextRun, endWordRun, type CountAcc, type PMNode } from "./document";
import { t } from "../i18n/core";

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

  if (counts) {
    if (node.type === "text") {
      if (node.text) countTextRun(node.text, counts);
    } else {
      endWordRun(counts); // see endWordRun: only adjacent text continues a word
    }
  }

  ownLosses(node, syncMode, losses);

  const content = node.content;
  if (!content) return;
  for (const child of content) {
    collectLosses(child as PMNodeWithMarks, syncMode, losses, counts);
  }
  if (counts) endWordRun(counts);
}

/** The losses carried by `node` itself — its marks and attributes, not its
 *  children. */
function ownLosses(
  node: PMNodeWithMarks,
  syncMode: "clean" | "styled",
  losses: Map<string, FidelityLoss>
): void {
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
      parts.push(t("status.fidelityColors", { count: total }));
    }
    if (fontLosses.length) {
      const total = fontLosses.reduce((n, l) => n + l.count, 0);
      parts.push(t("status.fidelityFonts", { count: total }));
    }
    if (highlightLosses.length) {
      const total = highlightLosses.reduce((n, l) => n + l.count, 0);
      parts.push(t("status.fidelityHighlights", { count: total }));
    }
    if (alignLosses.length) {
      const total = alignLosses.reduce((n, l) => n + l.count, 0);
      parts.push(t("status.fidelityAlignments", { count: total }));
    }
    if (otherLosses.length) {
      const total = otherLosses.reduce((n, l) => n + l.count, 0);
      parts.push(t("status.fidelityOther", { count: total }));
    }

    // The status bar's amber badge: interface text, in the interface language.
    summary = t("status.fidelitySummary", { list: parts.join(t("status.listSeparator")) });
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
  const root = canonical as PMNodeWithMarks;
  const buckets = new Map<string, FidelityLoss>();
  if (root.type === "text" || !root.content) {
    const acc = newCountAcc();
    collectLosses(root, syncMode, buckets, acc);
    return { fidelity: summarizeLosses(Array.from(buckets.values())), counts: { chars: acc.chars, words: acc.words } };
  }
  // Per top-level block, from a cache (A083). Every node boundary ends a word
  // (endWordRun), so a block's counts and losses depend on nothing but the
  // block — and the sync engine hands over the SAME JSON object for every block
  // an edit did not touch (canonicalOf, useSyncEngine.ts). A keystroke therefore
  // walks one block, not the whole document: the full walk cost ~160 ms per
  // keystroke at 1.6 MB under a 4× CPU slowdown. Merging in block order keeps
  // the first-seen order (and the first value of an attribute loss) that one
  // walk of the whole document produces; `fidelity-block-cache.test.js`
  // compares the two.
  ownLosses(root, syncMode, buckets);
  let chars = 0;
  let words = 0;
  for (const block of root.content) {
    const stats = blockStats(block as PMNodeWithMarks, syncMode);
    chars += stats.chars;
    words += stats.words;
    for (const [key, loss] of stats.losses) {
      const existing = buckets.get(key);
      if (existing) existing.count += loss.count;
      else buckets.set(key, { ...loss }); // a copy: the cached entry is never handed out
    }
  }
  return {
    fidelity: summarizeLosses(Array.from(buckets.values())),
    counts: { chars, words },
  };
}

interface BlockStats {
  chars: number;
  words: number;
  /** In first-seen order. */
  losses: Array<[string, FidelityLoss]>;
}

/**
 * Keyed on the block's JSON OBJECT, so the canonical must be read, never
 * mutated in place — the same contract `canonicalOf`'s cache already relies
 * on. Losses depend on the sync mode; the counts do not, but live beside them.
 */
const blockStatsCache = new WeakMap<object, { clean?: BlockStats; styled?: BlockStats }>();

function blockStats(block: PMNodeWithMarks, syncMode: "clean" | "styled"): BlockStats {
  let slot = block && typeof block === "object" ? blockStatsCache.get(block) : undefined;
  const hit = slot?.[syncMode];
  if (hit) return hit;
  const buckets = new Map<string, FidelityLoss>();
  const acc = newCountAcc();
  collectLosses(block, syncMode, buckets, acc);
  const stats: BlockStats = { chars: acc.chars, words: acc.words, losses: Array.from(buckets) };
  if (block && typeof block === "object") {
    if (!slot) {
      slot = {};
      blockStatsCache.set(block, slot);
    }
    slot[syncMode] = stats;
  }
  return stats;
}
