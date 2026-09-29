/**
 * Wiki links and heading anchors as a marked INLINE extension:
 *
 *   [[Title]]                 → link to a document
 *   [[Title|Display]]         → link with custom text
 *   [[Title#Heading]]         → link to a heading within a document
 *   [[#Heading]]              → link to a heading in the CURRENT document
 *   [[Title#Heading|Display]] → any of the above with custom text
 *
 * Emitted as `<a data-doc-link data-anchor class="wiki-link" href="#">` — the
 * markup the WikiLink mark parses and the turndown `wikiLink` rule writes back.
 *
 * This used to be a regex pass in the preprocessor, which ran on the raw
 * source before marked and so could not know what marked would consider CODE:
 * it masked fenced blocks and backtick spans, but an INDENTED code block
 * (`    [[Doc]] in code`) had an `<a>` tag injected into it, and the next
 * rich-pane edit wrote that tag into the markdown for good. As an inline
 * extension it only ever runs where marked is lexing inline content —
 * paragraphs, headings, list items, table cells — never inside any kind of
 * code, and never inside an HTML tag's attributes.
 */
import { escapeAttr } from "./css-safety";

export interface WikiRef {
  /** Everything before the alias separator (target plus any #anchor). */
  ref: string;
  target: string;
  anchor: string;
  /** The alias after the separator, or null when there is none. */
  display: string | null;
}

/**
 * Split the inside of `[[…]]`. The alias separator is the first `|` — or
 * `\|`, the spelling a pipe must take inside a GFM table cell and the one our
 * own table serializer writes. Treating only a bare `|` as the separator made
 * a table-cell alias round-trip as target `Doc\` (a broken link in the graph)
 * and gain another backslash on every trip.
 */
export function parseWikiInner(inner: string): WikiRef {
  const sep = /\\?\|/.exec(inner);
  const ref = (sep ? inner.slice(0, sep.index) : inner).trim();
  const display = sep ? inner.slice(sep.index + sep[0].length).trim() : null;
  const hashIdx = ref.indexOf("#");
  return {
    ref,
    target: (hashIdx >= 0 ? ref.slice(0, hashIdx) : ref).trim(),
    anchor: hashIdx >= 0 ? ref.slice(hashIdx + 1).trim() : "",
    display,
  };
}

/** The `<a>` both the preprocessor pass and this extension emit. */
export function wikiLinkOpenTag(target: string, anchor: string): string {
  const anchorAttr = anchor ? ` data-anchor="${escapeAttr(anchor)}"` : "";
  return `<a data-doc-link="${escapeAttr(target)}"${anchorAttr} class="wiki-link" href="#">`;
}

interface WikiToken extends WikiRef {
  type: "wikiLink";
  raw: string;
  text: string;
  tokens?: unknown[];
}

export const wikiLinkExtension = {
  name: "wikiLink",
  level: "inline" as const,
  start(src: string) {
    const i = src.indexOf("[[");
    return i < 0 ? undefined : i;
  },
  tokenizer(this: { lexer: { inlineTokens(src: string): unknown[] } }, src: string): WikiToken | undefined {
    const m = /^\[\[([^[\]\n]+)\]\]/.exec(src);
    if (!m) return undefined;
    const ref = parseWikiInner(m[1]!);
    if (!ref.target && !ref.anchor) return undefined; // `[[ ]]`, `[[|x]]`: not a link
    const token: WikiToken = { type: "wikiLink", raw: m[0], text: ref.display ?? ref.ref, ...ref };
    // An alias is inline markdown (the rich→markdown rule writes formatted
    // link text that way); a bare reference is a TITLE and is shown verbatim,
    // so `[[My_Doc]]` or `[[a*b*]]` is never re-read as emphasis.
    if (ref.display !== null) token.tokens = this.lexer.inlineTokens(ref.display);
    return token;
  },
  renderer(this: { parser: { parseInline(tokens: unknown[]): string } }, token: WikiToken): string {
    const body = token.tokens ? this.parser.parseInline(token.tokens) : escapeAttr(token.text);
    return `${wikiLinkOpenTag(token.target, token.anchor)}${body}</a>`;
  },
};
