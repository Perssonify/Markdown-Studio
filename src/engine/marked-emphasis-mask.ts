/**
 * A correction to how marked decides which `*` / `_` can close emphasis.
 *
 * Before it tokenises a run of inline text, marked builds a MASK of the run —
 * code spans, links and HTML blanked out — so a delimiter inside one of them
 * is never paired with one outside. Since marked 15.0.8 the mask blanks
 * backslash escapes BEFORE it looks for code spans. Inside a code span a
 * backslash is literal (CommonMark), so a span that ENDS in one — `C:\`, `\`,
 * `Mod-Alt-\` — has its closing backtick read as escaped: the opening backtick
 * then pairs with the next backtick in the paragraph, and every delimiter in
 * between is hidden. "`\` then **bold**, and `x`" rendered the bold as
 * literal asterisks (marked 12 masked code spans first and rendered it bold).
 * The lexer still tokenises the code span itself correctly — only the mask is
 * wrong — and CLAUDE.md contained exactly this paragraph.
 *
 * `emStrongMaskFix` hands marked's own emStrong the mask it would have built
 * with code spans and escapes found in ONE left-to-right pass: a code span
 * keeps its backslashes, and an escaped backtick outside a span still cannot
 * open one (the case 15.0.8 fixed). It only steps in for a run that contains a
 * backslash directly before a backtick; every other run keeps marked's mask.
 *
 * Known gap, left as marked has it: the run is judged from marked's first
 * emStrong ask in it, which is the run's start unless the run OPENS with a
 * link, tag, escape or extension token — so such a code span inside the text
 * of a link that begins the paragraph is not seen.
 */
import { Tokenizer, type Lexer, type TokenizerObject } from "marked";

/** CommonMark's label normalisation, as marked applies it to reference links. */
const normalizeLabel = (label: string): string => label.trim().toLowerCase().toUpperCase().toLowerCase();

const combined = new WeakMap<RegExp, RegExp>();

/**
 * marked's own escape rule, with a code span as the other alternative. A code
 * span's content has no backticks, exactly as in marked's `blockSkip`, and a
 * backtick run that finds no closer is consumed whole so it is never split.
 */
function escapeOrCodeRule(anyPunctuation: RegExp): RegExp {
  let re = combined.get(anyPunctuation);
  if (!re) {
    re = new RegExp(`${anyPunctuation.source}|(?<pfTicks>\`+)(?:[^\`]+\\k<pfTicks>(?!\`))?`, "gu");
    combined.set(anyPunctuation, re);
  }
  return re;
}

/** The mask for `src`, built as marked builds it but with code spans first. */
function maskOf(tokenizer: Tokenizer, src: string): string {
  const lexer = tokenizer.lexer;
  const inline = tokenizer.rules.inline;
  let masked = src;

  // Reference links, as marked masks them.
  const links = lexer.tokens.links;
  if (links && masked.includes("[")) {
    const linkInText = (text: string): boolean =>
      (lexer as unknown as { linkInText?: (t: string) => boolean }).linkInText?.(text) ?? false;
    const maskReflink = (m0: string): string => {
      const refStart = m0.lastIndexOf("[");
      if (!Object.hasOwn(links, normalizeLabel(m0.slice(refStart + 1, -1)))) return m0;
      if (refStart > 1 && m0.charAt(0) !== "!") {
        const text = m0.slice(1, refStart - 1);
        if (linkInText(text)) {
          return "[" + text.replace(inline.reflinkSearch, maskReflink) + "][" + "a".repeat(m0.length - refStart - 2) + "]";
        }
      }
      return "[" + "a".repeat(m0.length - 2) + "]";
    };
    masked = masked.replace(inline.reflinkSearch, maskReflink);
  }

  // Escapes and code spans together, left to right.
  masked = masked.replace(escapeOrCodeRule(inline.anyPunctuation), (m0: string, ...rest: unknown[]) => {
    const ticks = (rest[rest.length - 1] as { pfTicks?: string }).pfTicks;
    if (ticks === undefined) return "+".repeat(m0.length); // an escape
    return m0.length === ticks.length ? m0 : "[" + "a".repeat(m0.length - 2) + "]";
  });

  // Links and HTML, as marked masks them.
  masked = masked.replace(inline.blockSkip, (m0: string, _link: string, context: string) => {
    const offset = context ? context.length : 0;
    return m0.slice(0, offset) + "[" + "a".repeat(m0.length - offset - 2) + "]";
  });

  return lexer.options.hooks?.emStrongMask?.call({ lexer }, masked) ?? masked;
}

interface Run {
  /** The run as first seen here: the rest of it at marked's first ask. */
  src: string;
  /** Its corrected mask, or null when the run needs none. */
  mask: string | null;
}

// Keyed by marked's mask for the run, per lexer (one lexer per parse). marked
// asks emStrong at nearly every token boundary, so the decision is made once
// per run: on the FIRST ask — usually the run's start, before any code span
// has been consumed — not the first delimiter, by which point the backslash
// may already be behind the lexer.
const runs = new WeakMap<Lexer, Map<string, Run>>();

export const emStrongMaskFix: TokenizerObject = {
  emStrong(src, maskedSrc, prevChar) {
    let seen = runs.get(this.lexer);
    if (!seen) runs.set(this.lexer, (seen = new Map()));
    let run = seen.get(maskedSrc);
    if (!run) {
      run = { src, mask: src.includes("\\`") ? maskOf(this, src) : null };
      seen.set(maskedSrc, run);
    }
    if (run.mask === null) return false; // marked's own mask is right
    const first = src.charCodeAt(0);
    if (first !== 42 /* * */ && first !== 95 /* _ */) return false; // not a delimiter

    // The lexer only moves forward, so `src` is a tail of the run as first
    // seen and its mask is the tail of that mask — as marked slices its own.
    // Two different runs can share marked's mask, hence the check.
    const mask =
      run.src.length >= src.length && run.src.endsWith(src)
        ? run.mask.slice(run.mask.length - src.length)
        : maskOf(this, src);
    return Tokenizer.prototype.emStrong.call(this, src, mask, prevChar);
  },
};
