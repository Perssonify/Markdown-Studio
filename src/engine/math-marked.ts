/**
 * Lightweight marked extensions that turn `$…$` / `$$…$$` into data-attribute
 * placeholders (NOT rendered KaTeX). The actual rendering happens in the TipTap
 * MathInline/MathBlock node views (lazy KaTeX), so:
 *   - math renders live in the rich pane,
 *   - the LaTeX source round-trips to Markdown (turndown rules restore `$…$`),
 *   - KaTeX loads on demand instead of at parse time.
 *
 * The delimiter rules are exported (`matchInlineMath`, `matchBlockMath`) so the
 * markdown escaper decides what needs a backslash with EXACTLY the rules the
 * tokenizers use — a `$` is escaped when, and only when, it would otherwise
 * start maths.
 *
 * No lookbehind anywhere in this file. A lookbehind assertion in a regex
 * LITERAL is a parse-time SyntaxError on Safari/iOS before 16.4, and this
 * module ships in the entry chunk: one assertion blanked the whole app there
 * (converter-escape.test.js scans the source for them).
 */

function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Inline math, after Pandoc: the opening `$` is followed by a non-space, the
 * closing `$` is preceded by a non-space, and the content is one line. So
 * `$5 and $10` stays prose (the closer is preceded by a space).
 *
 * Pandoc also refuses a closer followed by a digit, which is what keeps
 * `$5-$10` prose — it used to render `5-` as a formula. That guard applies
 * here only when the content itself STARTS with a digit (i.e. looks like
 * money): applied unconditionally it would also refuse `$x$1`, which is how
 * the serializer writes a formula that is directly followed by a digit, and
 * every such formula would fall apart into text on its next round trip.
 */
const INLINE_MATH = /^\$(?!\$)(?=\S)((?:\\.|[^$\\\n])*?(?:\\.|[^$\\\s]))\$/;

export function matchInlineMath(src: string): { raw: string; text: string } | null {
  const m = INLINE_MATH.exec(src);
  if (!m) return null;
  // The content cannot contain a `$`, so this closer is the only candidate.
  if (/^\d/.test(m[1]!) && /^\d/.test(src.charAt(m[0].length))) return null;
  return { raw: m[0], text: m[1]! };
}

/**
 * Block math: `$$` at the START of a line (up to three spaces in), closed by a
 * `$$` that ENDS its line, with no blank line in between. A `$$…$$` in the
 * middle of a paragraph used to open a block and split the paragraph into
 * three ("The formula $$x^2$$ inline." became three blocks, and one rich-pane
 * edit rewrote the source that way).
 */
const BLOCK_MATH = /^ {0,3}\$\$((?:(?!\n[ \t]*\n)[\s\S])+?)\$\$[ \t]*(?:\n|$)/;

export function matchBlockMath(src: string): { raw: string; text: string } | null {
  const m = BLOCK_MATH.exec(src);
  if (!m || !m[1]!.trim()) return null;
  return { raw: m[0], text: m[1]!.trim() };
}

/** `$$…$$` in the middle of a line: not maths in this dialect, kept as text. */
const INLINE_DISPLAY = /^\$\$(?=\S)[^\n]*?\S\$\$/;

export function matchInlineDisplay(src: string): string | null {
  const m = INLINE_DISPLAY.exec(src);
  return m ? m[0] : null;
}

export const mathBlockExtension = {
  name: "mathBlock",
  level: "block" as const,
  /**
   * Where the paragraph being read must stop for a block to begin. marked asks
   * this once per paragraph with the REST OF THE DOCUMENT, and the old answer
   * — `src.indexOf("$$")` — scanned all of it every time: rendering was
   * quadratic in document length (258 of 314 ms at 1.6 MB). Only a `$$` that
   * starts a line can open a block, and a paragraph ends at its first blank
   * line, so nothing past that line can matter to the question being asked.
   */
  start(src: string) {
    let lineStart = src.indexOf("\n");
    while (lineStart !== -1) {
      const from = lineStart + 1;
      let i = from;
      while (i < from + 3 && src.charCodeAt(i) === 32) i++;
      if (src.charCodeAt(i) === 36 && src.charCodeAt(i + 1) === 36) return i;
      const next = src.indexOf("\n", from);
      const line = src.slice(from, next === -1 ? src.length : next);
      if (!line.trim()) return undefined;
      lineStart = next;
    }
    return undefined;
  },
  tokenizer(src: string) {
    const m = matchBlockMath(src);
    return m ? { type: "mathBlock", raw: m.raw, text: m.text } : undefined;
  },
  renderer(token: { text: string }) {
    // Text content (not just the attr) keeps the element non-blank so the
    // HTML→MD turndown rule fires even before a TipTap round-trip.
    return `<div data-math-block="${escAttr(token.text)}">${escAttr(token.text)}</div>`;
  },
};

export const mathInlineExtension = {
  name: "mathInline",
  level: "inline" as const,
  start(src: string) {
    const i = src.indexOf("$");
    return i < 0 ? undefined : i;
  },
  tokenizer(src: string) {
    // `$$…$$` mid-line is consumed as literal TEXT, so that neither of its
    // dollars can pair up as inline maths (`$$x^2$$` would otherwise render as
    // `$` + x^2 + `$`).
    const display = matchInlineDisplay(src);
    if (display) return { type: "text", raw: display, text: escAttr(display) };
    const m = matchInlineMath(src);
    if (m) return { type: "mathInline", raw: m.raw, text: m.text };
    return undefined;
  },
  renderer(token: { text: string }) {
    return `<span data-math-inline="${escAttr(token.text)}">${escAttr(token.text)}</span>`;
  },
};
