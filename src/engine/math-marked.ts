/**
 * Lightweight marked extensions that turn `$…$` / `$$…$$` into data-attribute
 * placeholders (NOT rendered KaTeX). The actual rendering happens in the TipTap
 * MathInline/MathBlock node views (lazy KaTeX), so:
 *   - math renders live in the rich pane,
 *   - the LaTeX source round-trips to Markdown (turndown rules restore `$…$`),
 *   - KaTeX loads on demand instead of at parse time.
 */

function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const mathBlockExtension = {
  name: "mathBlock",
  level: "block" as const,
  start(src: string) {
    const i = src.indexOf("$$");
    return i < 0 ? undefined : i;
  },
  tokenizer(src: string) {
    const m = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (m) return { type: "mathBlock", raw: m[0], text: m[1]!.trim() };
    return undefined;
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
    // Require no whitespace directly inside the delimiters to avoid matching
    // prose like "$5 and $10".
    const m = /^\$(?!\$)(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$/.exec(src);
    if (m) return { type: "mathInline", raw: m[0], text: m[1]! };
    return undefined;
  },
  renderer(token: { text: string }) {
    return `<span data-math-inline="${escAttr(token.text)}">${escAttr(token.text)}</span>`;
  },
};
