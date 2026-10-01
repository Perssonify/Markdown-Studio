/**
 * Markdown → rich, one run of top-level blocks at a time (A083).
 *
 * Every edit in the markdown pane used to re-run marked over the whole
 * document and hand TipTap the whole HTML: a 1.6 MB document took ~29 s per
 * keystroke at 4x CPU (most of it TipTap's own `elementFromString`, whose
 * whitespace pass is quadratic in top-level blocks, and a `querySelectorAll`
 * per table cell). This module keeps a MODEL of the markdown — the lengths of
 * the runs of top-level blocks the last projection cut it into, and how many
 * top-level ProseMirror nodes each run produced — and re-parses only the runs
 * an edit touched, replacing just their nodes in one transaction.
 *
 * The one property that matters is that the result is IDENTICAL (`Node.eq`) to
 * the whole-document path (`setContent(mdToHtml(md))`), and
 * `incremental-rich.test.js` checks it after every step of random edit walks.
 * It rests on a cut — a "boundary" — being placed only where the whole
 * pipeline is provably context-free:
 *
 *  - MARKDOWN: after a blank line (a `space` token) whose block cannot run on
 *    past it. Lists and indented code can (a loose list, a continuation
 *    paragraph, a second chunk of code), so no cut follows them; nothing can
 *    merge into the token after a blank line. Link reference definitions and
 *    footnotes are global, so a document holding either is never cut; nor is
 *    one holding an inline `<a>`/`<pre>`/`<code>`/`<kbd>`/`<script>` tag (they
 *    switch marked's inline state for every block after them).
 *  - HTML: after a run whose rendered HTML leaves the browser's parser exactly
 *    where it started — no open element, no pending formatting element to
 *    reconstruct, the tokenizer in its data state. Marked's own output always
 *    does; a run holding raw HTML is checked (`selfContainedHtml`, and for
 *    markup it has no rule for, a probe parse: `leavesParserClean`).
 *  - PROSEMIRROR: where the parser has no node open — checked from the parse
 *    itself (`findPositions`), never assumed.
 *
 * Anything else — front matter being edited, the curly-brace syntax, an alias
 * wiki link (the preprocessor rewrites its pipe), a document the model does not
 * describe — takes the whole-document path, which is always correct and only
 * slow, and which rebuilds the model as it goes. A wrong partial update would be
 * data corruption; a fallback is only a slow keystroke.
 *
 * The rich pane edited since the last projection is not a reason to fall back:
 * top-level nodes are immutable and shared, so the nodes it changed are found
 * by identity, and the runs that produced them are re-parsed along with the
 * edited markdown — exactly what the whole-document path would do to them.
 */
import { Lexer, Parser, type Marked, type MarkedOptions, type Token, type TokensList } from "marked";
import { DOMParser as PMDOMParser, Fragment, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { MarkdownFeatureSettings } from "../store/settings";
import { frontmatterLength, preprocessMarkdown, type PreprocessFeatures } from "./preprocessor";

// ─── HTML → ProseMirror, as TipTap's setContent does it ─────────────────────

/** `<body>`-wrapped parse — exactly `elementFromString` before its whitespace pass. */
function htmlBody(html: string): HTMLElement {
  return new window.DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
}

/** The text nodes TipTap's `elementFromString` removes: "\n", or "\n" and two more whitespace. */
const TIPTAP_WS = /^(\n\s\s|\n)$/;

/**
 * TipTap's `removeWhitespaces`, with the same result in linear time. TipTap
 * walks a LIVE `childNodes` list backwards while removing from it, and every
 * removal invalidates the list's cached position: the next index access walks
 * from the start again. With a text node between every pair of top-level
 * blocks that is quadratic — 33 of the 29 s-per-keystroke profile at 1.6 MB.
 */
export function removeTipTapWhitespace(node: Node): void {
  let child = node.lastChild;
  while (child) {
    const prev = child.previousSibling;
    if (child.nodeType === 3) {
      if (child.nodeValue && TIPTAP_WS.test(child.nodeValue)) node.removeChild(child);
    } else if (child.nodeType === 1) {
      removeTipTapWhitespace(child);
    }
    child = prev;
  }
}

/**
 * The document TipTap's `setContent(html)` builds — `DOMParser.parse` of
 * `elementFromString(html)` — without the quadratic whitespace pass.
 */
export function parseHtmlDoc(html: string, schema: Schema): PMNode {
  const body = htmlBody(html);
  removeTipTapWhitespace(body);
  return PMDOMParser.fromSchema(schema).parse(body);
}

// ─── Raw HTML that leaves the parser where it found it ──────────────────────

const VOID = new Set(["br", "img", "hr", "wbr", "source", "input"]);
/** Elements that hold phrasing content. `a` is further kept out of `a`. */
const PHRASING = new Set([
  "a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "del", "dfn", "em", "i", "ins", "kbd",
  "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var",
  "img", "br", "wbr", "input", "picture",
]);
/** Block elements whose children must be phrasing (the parser closes them around anything else). */
const PHRASING_ONLY = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "summary"]);
/** Block elements that may hold other blocks. */
const FLOW_BLOCKS = new Set([
  "div", "blockquote", "section", "article", "aside", "header", "footer", "nav", "main",
  "figure", "figcaption", "details", "hr", "ul", "ol", "table",
]);
/** Parent → the only children it may have (text between them whitespace only). */
const STRICT_CHILDREN: Record<string, Set<string>> = {
  ul: new Set(["li"]),
  ol: new Set(["li"]),
  picture: new Set(["source", "img"]),
  table: new Set(["thead", "tbody", "tfoot", "tr"]),
  thead: new Set(["tr"]),
  tbody: new Set(["tr"]),
  tfoot: new Set(["tr"]),
  tr: new Set(["th", "td"]),
};
/** Child → the only parents it may have. */
const STRICT_PARENT: Record<string, Set<string>> = {
  li: new Set(["ul", "ol"]),
  source: new Set(["picture"]),
  thead: new Set(["table"]),
  tbody: new Set(["table"]),
  tfoot: new Set(["table"]),
  tr: new Set(["table", "thead", "tbody", "tfoot"]),
  th: new Set(["tr"]),
  td: new Set(["tr"]),
  summary: new Set(["details"]),
};

const START_TAG = /<([a-zA-Z][^\t\n\f\r />]*)((?:[\t\n\f\r ]+[^\t\n\f\r />"'=]+(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"[^"]*"|'[^']*'|[^\t\n\f\r "'=<>`]+))?)*)[\t\n\f\r ]*(\/?)>/y;
const END_TAG = /<\/([a-zA-Z][^\t\n\f\r />]*)[\t\n\f\r ]*>/y;

/**
 * Whether HTML parsed from a clean state leaves the parser clean: every element
 * explicitly closed, in order, and nested the way HTML's content model allows —
 * so the tree builder never closes an element implicitly (which is how a
 * formatting element is left in the "active" list to be re-created inside
 * whatever follows), never foster-parents, and never leaves the tokenizer in
 * RAWTEXT, RCDATA, a comment or a tag. Deliberately narrow: an element or
 * construct it does not know is a "no", which only costs a cut.
 */
export function selfContainedHtml(html: string): boolean {
  const stack: string[] = [];
  let inLink = 0;
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    const textEnd = lt === -1 ? n : lt;
    if (textEnd > i) {
      const top = stack[stack.length - 1];
      if (top && STRICT_CHILDREN[top] && /[^\t\n\f\r ]/.test(html.slice(i, textEnd))) return false;
    }
    if (lt === -1) break;
    const next = html.charCodeAt(lt + 1);
    const isAlpha = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    if (next === 47 /* / */) {
      if (!isAlpha(html.charCodeAt(lt + 2))) return false; // `</ ` opens a bogus comment
      END_TAG.lastIndex = lt;
      const m = END_TAG.exec(html);
      if (!m) return false;
      const name = m[1]!.toLowerCase();
      if (VOID.has(name) || stack.pop() !== name) return false;
      if (name === "a") inLink--;
      i = END_TAG.lastIndex;
      continue;
    }
    if (!isAlpha(next)) {
      if (html.startsWith("<!--", lt)) {
        // A comment ends at the first `-->` (or at once, `<!-->` / `<!--->`),
        // and leaves the parser as it found it. `--!>` also ends one; refused
        // rather than modelled.
        const body = lt + 4;
        const end = html.startsWith(">", body) ? body + 1 : html.startsWith("->", body) ? body + 2 : html.indexOf("-->", body) + 3;
        if (end < body || html.slice(body, end).includes("--!>")) return false;
        i = end;
        continue;
      }
      if (next === 33 /* ! */ || next === 63 /* ? */) return false; // doctype, CDATA, PI
      i = lt + 1; // a lone "<" is text
      continue;
    }
    START_TAG.lastIndex = lt;
    const m = START_TAG.exec(html);
    if (!m) return false;
    const name = m[1]!.toLowerCase();
    const selfClosing = m[3] === "/";
    const parent = stack[stack.length - 1];
    const needs = STRICT_PARENT[name];
    if (!needs && !PHRASING.has(name) && !PHRASING_ONLY.has(name) && !FLOW_BLOCKS.has(name)) return false;
    if (needs && (!parent || !needs.has(parent))) return false;
    if (parent && STRICT_CHILDREN[parent] && !STRICT_CHILDREN[parent]!.has(name)) return false;
    if (parent && (PHRASING_ONLY.has(parent) || (PHRASING.has(parent) && !STRICT_CHILDREN[parent])) && !PHRASING.has(name)) return false;
    if (name === "a" && inLink) return false;
    if (VOID.has(name)) {
      i = START_TAG.lastIndex;
      continue;
    }
    if (selfClosing) return false; // `<div/>` is a start tag in HTML
    stack.push(name);
    if (name === "a") inLink++;
    i = START_TAG.lastIndex;
  }
  return stack.length === 0;
}

/**
 * The slow, general answer for markup selfContainedHtml does not know (an
 * element it has no rule for, say): parse it followed by a probe `<span>` and
 * see where the probe lands. Parsed from a clean state, the probe is the last
 * child of <body>, holding exactly its text, only if the markup left nothing
 * open (it would be inside it — or before it, foster-parented out of a table),
 * no formatting element pending (its text would be re-wrapped in one) and the
 * tokenizer in its data state (it would be swallowed). Foreign content is the
 * one state a <span> escapes by itself, so SVG and MathML are refused outright.
 */
export function leavesParserClean(html: string): boolean {
  if (html.length > 65536 || /<(?:svg|math)[\s/>]/i.test(html)) return false;
  let probe = "pf-probe";
  while (html.includes(probe)) probe += "-";
  const last = htmlBody(`${html}<span>${probe}</span>`).lastChild as Element | null;
  return !!last && last.nodeType === 1 && last.localName === "span" && last.attributes.length === 0 &&
    last.childNodes.length === 1 && last.firstChild!.nodeType === 3 && last.textContent === probe;
}

// ─── Markdown: tokens and the places they can be cut ────────────────────────

/** Tokens that cannot run on past the blank line after them. */
function endsAtBlankLine(t: Token): boolean {
  switch (t.type) {
    case "paragraph":
    case "heading":
    case "hr":
    case "blockquote":
    case "table":
    case "html":
    case "mathBlock":
      return true;
    case "code":
      return (t as { codeBlockStyle?: string }).codeBlockStyle !== "indented";
    default:
      return false;
  }
}

/**
 * Marked's inline lexer carries state from block to block: an inline `<a …>`
 * tag sets `inLink` (no bare-URL autolinks until `</a>`), and `<pre>`, `<code>`,
 * `<kbd>`, `<script>` set `inRawBlock` (text is not escaped until they close) —
 * in every block after, until the closing tag. A cut is only made where that
 * state is known to be clear. Every inline tag token records the state after
 * it; nothing else changes the state except a link, which clears `inLink` when
 * its text is done (so a tag inside link text says nothing about the state
 * after the link: "unknown", which is not clear).
 *
 * Today selfContainedHtml refuses the same cuts — a tag left open is markup left
 * open — so no case can tell this check is there (mutation-tested: none does).
 * It states the markdown half of the rule on its own terms, so loosening the
 * HTML check cannot quietly make a cut the lexer's state forbids.
 */
type InlineState = "clear" | "set" | "unknown";

function stateAfter(token: unknown, state: InlineState, inLinkText = false): InlineState {
  if (!token || typeof token !== "object") return state;
  const t = token as { type?: string; block?: boolean; inLink?: boolean; inRawBlock?: boolean; tokens?: unknown[]; items?: unknown[]; header?: Array<{ tokens?: unknown[] }>; rows?: Array<Array<{ tokens?: unknown[] }>> };
  if (t.type === "html" && t.block === false) {
    return inLinkText ? "unknown" : t.inLink || t.inRawBlock ? "set" : "clear";
  }
  const inner = inLinkText || t.type === "link" || t.type === "image";
  const walk = (list: unknown[] | undefined) => {
    if (list) for (const x of list) state = stateAfter(x, state, inner);
  };
  // In the order marked lexes inline content: a table's header cells, then
  // its rows; a list's items; everything else's own tokens.
  if (t.type === "table") {
    for (const cell of t.header ?? []) walk(cell.tokens);
    for (const row of t.rows ?? []) for (const cell of row) walk(cell.tokens);
  } else if (t.type === "list") {
    walk(t.items);
  } else {
    walk(t.tokens);
  }
  return state;
}
const MAY_HOLD_STATE_TAG = /<\/?(?:a|pre|code|kbd|script)[\s>]/i;

/** `[[Doc|Alias]]` with a bare pipe: the preprocessor rewrites it, which the cut positions do not follow. */
const BARE_PIPE_WIKI = /\[\[(?:[^[\]\n\\|]|\\[^\n])*\|/;
const holdsBarePipe = (md: string): boolean => md.indexOf("[[") !== -1 && BARE_PIPE_WIKI.test(md);

/**
 * A block a link definition could still grow out of, past the blank line after
 * it. marked's label (`[^\[\]\\]` — newlines included) and its "…" and (…) titles may span blank
 * lines — CommonMark's may not — so `[x` or `[x]: /url "ti` lexes as a
 * paragraph until text AFTER a cut completes it, and then as a definition
 * reaching back across the cut: a window re-lexing only the later run never
 * sees it. Any block starting with an unclosed label, or with a label and its
 * colon (a definition that failed, perhaps on an open title), keeps the text
 * from being cut. Every other block tokenizer either stops at a blank line or
 * is recognised by its opener whatever follows (fences, HTML blocks).
 */
const DEF_MAY_CONTINUE = /^ {0,3}\[(?:\\[\s\S]|[^[\]\\])*$|^ {0,3}\[(?:\\[\s\S]|[^[\]\\])+\]:/;

/**
 * Raw HTML that can change how ProseMirror parses everything AFTER it. Inside a
 * `<pre>` — or an element whose style's white-space holds "pre" — the parser
 * marks every context it closes past as whitespace-preserving (`sync`, with
 * `localPreserveWS`), and when the pre's own context was closed early (a
 * raw `<pre>` holding a paragraph), that reaches the DOCUMENT's context: from
 * there on, whitespace is kept everywhere. Marked's own code blocks hold only
 * text and never do it; raw HTML is refused whole — any `<pre`, and a style
 * that mentions white-space or holds a CSS escape (`wh\69te-space`).
 */
const PRESERVES_WS = /<pre(?![\w-])|style[\s\S]*(?:white-space|\\)/i;

interface Lexed {
  opt: MarkedOptions;
  tokens: TokensList;
  /** The top-level tokens a cut may fall between — null when the text may not be cut at all. */
  top: Token[] | null;
  /** Whether marked's inline state is clear after each of them (see stateAfter). */
  clear: boolean[];
  /** …and after the whole text. */
  clearAtEnd: boolean;
  /** Why the text may not be cut. */
  why: string;
}

/**
 * `marked.parse`'s lexing half, exactly as its synchronous branch runs it
 * (the configuration installs no hooks — checked by the caller).
 */
function lex(m: Marked, src: string): Lexed {
  const opt = { ...m.defaults, async: false } as MarkedOptions;
  const lexer = new Lexer(opt);
  const tokens = lexer.lex(src);
  let preserves = false;
  const walk = opt.walkTokens;
  m.walkTokens(tokens, function (this: Marked, t: Token) {
    if (t.type === "html" && PRESERVES_WS.test(t.raw)) preserves = true;
    return walk ? walk.call(this as never, t) : undefined;
  });
  const no = (why: string): Lexed => ({ opt, tokens, top: null, clear: [], clearAtEnd: false, why });
  // Link reference definitions: every reference anywhere reads them.
  if (Object.keys(tokens.links).length) return no("link definitions");
  // ProseMirror keeps whitespace for the REST of the document after some raw
  // `<pre>` (see PRESERVES_WS): state no cut can carry.
  if (preserves) return no("raw <pre> or white-space");
  const top: Token[] = [];
  let sum = 0;
  let section = -1; // where marked-footnote's section token sits, in `top` terms
  let sectionAt = 0; // …and in the source
  for (const t of tokens) {
    // marked-footnote's section token: its `raw` is the section's title, not
    // source text, and it renders nothing while there are no definitions.
    if (t.type === "footnotes") {
      const f = t as { rawItems?: unknown[]; items?: unknown[] };
      if (f.rawItems?.length || f.items?.length) return no("footnotes");
      section = top.length;
      sectionAt = sum;
      continue;
    }
    // (A footnote definition is marked-footnote's own token, refused above.)
    if (t.type !== "footnote" && DEF_MAY_CONTINUE.test(t.raw)) return no("open link definition");
    sum += t.raw.length;
    top.push(t);
  }
  // The section token is pushed where the extension is first asked for a block
  // — the very start, as build-marked orders the extensions (were another
  // block extension asked first, after the block it claimed) — and a single
  // newline right there is appended to ITS raw (marked hands a one-newline
  // space to the token before it). Put it back where it was, as the nothing it
  // renders.
  if (section >= 0 && sum === src.length - 1 && src.charCodeAt(sectionAt) === 10) {
    top.splice(section, 0, { type: "space", raw: "\n" } as Token);
    sum++;
  }
  // Any other merge that rewrote a token's raw (marked adds a newline in
  // places): positions are not trustworthy.
  if (sum !== src.length) return no("raw length");
  const clear = new Array<boolean>(top.length).fill(true);
  if (MAY_HOLD_STATE_TAG.test(src)) {
    let state: InlineState = "clear";
    top.forEach((t, k) => {
      state = stateAfter(t, state);
      clear[k] = state === "clear";
    });
  }
  const st = (lexer as unknown as { state?: { inLink?: boolean; inRawBlock?: boolean } }).state;
  return { opt, tokens, top, clear, clearAtEnd: !st?.inLink && !st?.inRawBlock, why: "" };
}

interface Pieces {
  /** Source length of each piece. */
  lens: number[];
  html: string[];
  /** The text ends where a cut may fall (after a blank line nothing can run past). */
  endClean: boolean;
}

/**
 * Cut the text at the boundaries that are clean on the markdown and HTML side,
 * no closer together than `minLength` characters: every run costs a parse call
 * of its own, and an edit re-parses a run or two, so a few KB per run is the
 * cheaper end of both. Per-token HTML is `marked.parse`'s, since its parser
 * renders token by token.
 */
function cut(lexed: Lexed, src: string, style: (html: string) => string, minLength: number): Pieces {
  const top = lexed.top!;
  const parser = new Parser(lexed.opt);
  const tokHtml = top.map((t) => style(parser.parse([t]) as string));
  const lens: number[] = [];
  const html: string[] = [];
  let start = 0;
  let pieceStart = 0;
  let offset = 0;
  const neutral = (from: number, to: number, a: number, b: number): boolean => {
    if (src.slice(a, b).indexOf("<") === -1) return true;
    const html = tokHtml.slice(from, to).join("");
    return selfContainedHtml(html) || leavesParserClean(html);
  };
  // After a blank line that the block before it cannot run past, with marked's
  // inline state clear, and the HTML so far leaving the browser's parser clean.
  const cuttable = (k: number): boolean =>
    top[k]!.type === "space" && (k === 0 || endsAtBlankLine(top[k - 1]!)) && lexed.clear[k]!;
  for (let k = 0; k < top.length; k++) {
    offset += top[k]!.raw.length;
    if (k === top.length - 1) break;
    if (offset - pieceStart < minLength || !cuttable(k) || !neutral(start, k + 1, pieceStart, offset)) continue;
    lens.push(offset - pieceStart);
    html.push(tokHtml.slice(start, k + 1).join(""));
    start = k + 1;
    pieceStart = offset;
  }
  lens.push(src.length - pieceStart);
  html.push(tokHtml.slice(start).join(""));
  const endClean = top.length > 0 && cuttable(top.length - 1) && lexed.clearAtEnd &&
    neutral(start, top.length, pieceStart, src.length);
  return { lens, html, endClean };
}

// ─── The pieces' HTML → ProseMirror nodes, and which cuts survive ───────────

/**
 * Separates the pieces in one parse. A comment changes nothing the tree
 * builder does but split text. Its text is one the markup does not already
 * hold, so a document that happens to spell it is not refused for that.
 */
function markerFor(html: string[]): string {
  let mark = "pf-a083-cut";
  while (html.some((h) => h.includes(mark))) mark += "-";
  return mark;
}

/** The HTML parser's whitespace: tab, line feed, form feed, carriage return, space. */
const WS_CHAR = new Set([9, 10, 12, 13, 32]);

/**
 * The pieces with a marker between each two — placed BEFORE the whitespace a
 * piece ends with (a block's closing newline), not after it, so the node just
 * before the next piece is the one the whole document has there. That matters
 * to one parser: jsdom foster-parents text out of a table (`<table>text…`, an
 * unclosed raw table) to the END of the parent instead of before the table
 * whenever the node before the table is not Text (its `insertTextBefore` calls
 * `_append`, ignoring the reference node), so a marker right before `<table>`
 * moved the text to the end of the document. Browsers follow the spec, where
 * a comment there only keeps the text from merging — which the marker removal
 * handles. After a clean piece that whitespace is text in <body>, and leaving
 * the marker before it changes nothing else the tree builder does.
 */
function joinPieces(html: string[], marker: string): string {
  let out = "";
  for (let k = 0; k < html.length - 1; k++) {
    const h = html[k]!;
    const ws = h.length - trailingWs(h);
    out += h.slice(0, ws) + marker + h.slice(ws);
  }
  return out + (html[html.length - 1] ?? "");
}

/** Text that follows each run in its parse, to find out whether it ends clean (see parsePieces). */
const SENTINEL = "pf-a083-end";

/** How much whitespace a piece's markup ends with (the marker goes before it). */
function trailingWs(h: string): number {
  let ws = h.length;
  while (ws > 0 && WS_CHAR.has(h.charCodeAt(ws - 1))) ws--;
  return h.length - ws;
}

interface Parsed {
  nodes: PMNode[];
  /** Top-level node index at each cut between pieces; undefined where the cut was not kept. */
  at: Array<number | undefined>;
  /** No node open at the end of the text. */
  endClean: boolean;
  /** The markup starts with text, not a node (see the cut rule in parsePieces). */
  startsWithText: boolean;
}

/**
 * Where the parsed markup sits in the document: at its very start (the whole
 * of it, or a first run), or after at least one top-level node.
 */
type Placement = "start" | "after";

/**
 * Parse the pieces' markup as ONE DOM — the markup the whole-document path
 * parses, byte for byte, once the cut markers are out — and ProseMirror it one
 * run at a time, a run being the pieces between two cuts that hold.
 *
 * Runs are parsed on their own because reading positions out of one parse
 * costs a walk of every node before each (`findPositions`, via `currentPos`):
 * with a position per cut the first keystroke of a 1.6 MB document was
 * quadratic. A run parsed on its own is its slice of the whole document's
 * parse exactly when the parser has no node open where the run starts —
 * checked at the end of the run before, with one position — and the run is
 * parsed after a node, as it is in the document: ProseMirror keeps the
 * leading space of top-level text only when a node precedes it (`addTextNode`
 * strips it at the very start). So each run's DOM nodes are moved behind a
 * placeholder block (a leaf: the HTML parser closes nothing for it, and it
 * leaves nothing open) whose node is then dropped. A cut the parser leaves a
 * node open at joins its runs.
 */
function parsePieces(html: string[], schema: Schema, placement: Placement): Parsed | null {
  const mark = markerFor(html);
  const body = htmlBody(joinPieces(html, `<!--${mark}-->`));
  const markers: Comment[] = [];
  for (let c = body.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 8 && (c as Comment).data === mark) markers.push(c as Comment);
  }
  // Every marker must be a child of <body>: one swallowed by a tag, a comment
  // or raw text, or nested in an element, means the markup is not what the
  // cuts assumed — and a marker that stayed nested would split text the real
  // parse sees whole.
  if (markers.length !== html.length - 1) return null;
  // Every marker in the tree, too. The markup does not spell the marker
  // (markerFor), so this can only fire if a real one ended up nested — which
  // selfContainedHtml exists to prevent: unreachable while it is right, here
  // for the day it is not.
  const walker = body.ownerDocument.createTreeWalker(body, 128 /* SHOW_COMMENT */);
  let total = 0;
  while (walker.nextNode()) if ((walker.currentNode as Comment).data === mark) total++;
  if (total !== markers.length) return null;

  // Out with the markers, rejoining any text they split — the DOM is then the
  // one the whole-document path builds. startOf[k]: the first DOM node of piece
  // k (null: it is empty and at the end); undefined where the cut is not kept.
  //
  // A cut is kept only where the piece after it starts with a NODE. Text there
  // (an HTML block that opens with a tag the parser ignores, `</div>text`)
  // is one Text node with the whitespace the piece before ends with — or with
  // that piece's own last text — and a run parsed on its own would lose the
  // join. Holding every kept cut to this is what lets a window END at one
  // without looking past it; a window that STARTS at one checks its own first
  // node (startsWithText), since an edit can put text there.
  const startsWithText = body.firstChild?.nodeType === 3;
  const startOf: Array<Node | null | undefined> = new Array(html.length + 1);
  startOf[0] = null; // replaced below
  startOf[html.length] = null;
  for (let k = markers.length - 1; k >= 0; k--) {
    const mk = markers[k]!;
    const prev = mk.previousSibling;
    const next = mk.nextSibling;
    body.removeChild(mk);
    if (prev && next && prev.nodeType === 3 && next.nodeType === 3) {
      (prev as Text).appendData((next as Text).data);
      body.removeChild(next);
      startOf[k + 1] = undefined;
    } else if (next && next.nodeType === 3 && (next as Text).data.length !== trailingWs(html[k]!)) {
      // The marker sits before the piece's trailing whitespace: text after it
      // that is MORE than that whitespace is the next piece's, joined to it.
      startOf[k + 1] = undefined;
    } else {
      // The whitespace pass below removes some text nodes: the piece starts
      // with whatever survives it.
      let b: Node | null = next;
      while (b && b.nodeType === 3 && b.nodeValue && TIPTAP_WS.test(b.nodeValue)) b = b.nextSibling;
      startOf[k + 1] = b;
    }
  }
  removeTipTapWhitespace(body);
  startOf[0] = body.firstChild;

  // A run starts the top node's content where one block has already been
  // placed: every block fits there exactly as it does at the very start, and a
  // run that produces no block is not "filled" with the empty paragraph only
  // an empty DOCUMENT needs (the caller sees that case). ProseMirror reads
  // topMatch only beside an explicit topNode.
  const deflt = schema.topNodeType.contentMatch.defaultType;
  const topMatch = deflt && schema.topNodeType.contentMatch.matchType(deflt);
  if (!topMatch) return null;
  const parser = PMDOMParser.fromSchema(schema);
  const dom = body.ownerDocument;

  const pieces = html.length;
  const nextCut = (k: number): number => {
    while (k < pieces && startOf[k] === undefined) k++;
    return k;
  };
  const nodes: PMNode[] = [];
  const at = new Array<number | undefined>(pieces - 1).fill(undefined);
  let endClean = false;
  let cursor: ChildNode | null = body.firstChild;
  for (let start = 0; start < pieces;) {
    // After a NODE, not merely after a run: a run can make none (a comment),
    // and the text of the next is then at the document's start.
    const placeholder = nodes.length > 0 || placement === "after";
    const box = dom.createElement("body");
    if (placeholder) box.appendChild(dom.createElement("hr"));
    const take = (stop: Node | null | undefined) => {
      while (cursor && cursor !== stop) {
        const n: ChildNode | null = cursor.nextSibling;
        box.appendChild(cursor);
        cursor = n;
      }
    };
    // Whether the parser has a node open at the end of the run takes two
    // checks. The position there against the size of what was parsed catches
    // an open wrapper (an implicit list around a stray <li>) — but not an
    // implicit PARAGRAPH (top-level text) whose text ends in a space: closing
    // it strips that space, which shrinks it by exactly the one position being
    // inside it adds. So a text node follows the run: it joins whatever
    // textblock is open, and makes a paragraph of its own only after a clean
    // end. (A run that is then parsed alone is the one place a following block
    // would have closed that paragraph — a <pre> keeps its trailing space.)
    const parseRun = (last: boolean): { nodes: PMNode[]; clean: boolean } => {
      const probe: { node: Node; offset: number; pos?: number } = { node: box, offset: box.childNodes.length };
      const sentinel = box.appendChild(dom.createTextNode(SENTINEL));
      const doc = parser.parse(box, { findPositions: [probe], topNode: schema.topNodeType.create(), topMatch });
      box.removeChild(sentinel);
      const out: PMNode[] = [];
      let size = 0;
      doc.forEach((n) => {
        out.push(n);
        size += n.nodeSize;
      });
      const tail = out[out.length - 1];
      const own = !!tail && tail.isTextblock && tail.childCount === 1 && tail.firstChild!.isText &&
        tail.firstChild!.text === SENTINEL && !tail.firstChild!.marks.length;
      if (own) {
        out.pop();
        size -= tail!.nodeSize;
        if (probe.pos === size) return { nodes: out, clean: true };
      }
      // Not clean. At the end of the text that stands (endClean says so), but
      // the nodes must be the ones the markup makes without the sentinel.
      if (!last) return { nodes: out, clean: false };
      return { nodes: childrenOf(parser.parse(box, { topNode: schema.topNodeType.create(), topMatch })), clean: false };
    };
    // The run ends at the next cut; while the parser is left with a node open
    // there, take in more (doubling, so a long unclean stretch costs a
    // constant factor, not a square).
    let end = nextCut(start + 1);
    take(startOf[end]);
    let run = parseRun(end === pieces);
    for (let more = 1; !run.clean && end < pieces; more *= 2) {
      for (let m = 0; m < more && end < pieces; m++) end = nextCut(end + 1);
      take(startOf[end]);
      run = parseRun(end === pieces);
    }
    if (placeholder) {
      // The placeholder came through as a node of its own, first, or nothing
      // here is what it seems.
      if (run.nodes[0]?.type.name !== "horizontalRule") return null;
      run.nodes.shift();
    }
    for (const n of run.nodes) nodes.push(n);
    if (end < pieces) at[end - 1] = nodes.length;
    endClean = run.clean;
    start = end;
  }
  return { nodes, at, endClean, startsWithText };
}

// ─── The model and the projection ───────────────────────────────────────────

interface Model {
  marked: Marked;
  schema: Schema;
  /** The markdown it describes, and the document the editor settled on for it. */
  md: string;
  doc: PMNode;
  /** Source length and top-level node count of each run, in order. After
   *  them, `doc` may end in nodes no run produced: TipTap's TrailingNode
   *  appends an empty paragraph after a closing list, quote, table… — and the
   *  whole-document path gets it the same way. */
  lens: number[];
  counts: number[];
  /** Length of the front matter at the start of `md` (it is never re-parsed on its own). */
  fm: number;
}

export interface RichPlan {
  /** What to dispatch — null when the editor already holds this markdown's parse. */
  tr: Transaction | null;
  /** Hand over the editor's document once the transaction has been applied (or not). */
  commit(doc: PMNode): void;
}

/**
 * How the last plan was made: `incremental` re-parsed runs of the document,
 * `build` parsed all of it and made a model, `whole` parsed all of it and
 * could not (the reason says why) — as does a `build` that was not first.
 */
export interface RichPath {
  path: "incremental" | "build" | "whole" | "none";
  reason: string;
}

export interface RichProjector {
  plan(md: string, state: EditorState): RichPlan;
  /** Drop the model (a different document was loaded). */
  forget(): void;
  /** For tests and diagnostics. */
  readonly last: RichPath;
}

export interface RichProjectorOptions {
  marked: () => Marked;
  features: () => MarkdownFeatureSettings;
  /** The options `mdToHtml` preprocesses with. */
  preprocess: (f: MarkdownFeatureSettings) => PreprocessFeatures;
  /** `mdToHtml` — the whole-document path, for what cannot be cut. */
  mdToHtml: (md: string) => string;
  /** `mdToHtml`'s pass over rendered lists, applied piece by piece. */
  style: (html: string) => string;
  /** The fewest characters of markdown a run holds before it may be cut (see cut). */
  runLength?: number;
}

/** Length of the common prefix of two strings. */
function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  // Block compares first: V8 compares flat strings with memcmp.
  while (i + 1024 <= n && a.substr(i, 1024) === b.substr(i, 1024)) i += 1024;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/** Length of the common suffix, at most `max`. */
function commonSuffix(a: string, b: string, max: number): number {
  let i = 0;
  while (i + 1024 <= max && a.substr(a.length - i - 1024, 1024) === b.substr(b.length - i - 1024, 1024)) i += 1024;
  while (i < max && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++;
  return i;
}

/** Whether the editor runs TipTap's TrailingNode plugin (StarterKit's default). */
const hasTrailingNode = (state: EditorState): boolean =>
  state.plugins.some((p) => String((p as unknown as { key?: unknown }).key).startsWith("trailingNode$"));

/** The node TrailingNode appends: its type's default, created bare. */
const isTrailingNode = (node: PMNode, schema: Schema): boolean => {
  const para = schema.topNodeType.contentMatch.defaultType;
  return !!para && node.type === para && node.content.size === 0 && node.marks.length === 0 &&
    node.sameMarkup(para.create());
};

const eqNode = (a: PMNode, b: PMNode): boolean => a === b || a.eq(b);

/**
 * The first `count` top-level nodes of `after` are those of `planned`, the
 * same objects — except a table fixTables mended, still a table in its place.
 * Only runs when an appended transaction changed the document, which is rare.
 */
function sameNodes(planned: PMNode, after: PMNode, count: number): boolean {
  if (planned.childCount < count || after.childCount < count) return false;
  for (let k = 0; k < count; k++) {
    const a = planned.child(k);
    const b = after.child(k);
    if (a !== b && !(a.type === b.type && a.type.spec["tableRole"] === "table")) return false;
  }
  return true;
}

/**
 * Replace top-level nodes [from, to) of the document with `nodes`, keeping the
 * ones at either end that are equal (so their objects, their node views and
 * everything cached on them survive, and the selection maps through untouched
 * content).
 *
 * The projection is not a user edit, and the transaction says so as
 * setContent's did: no update event (the rich pane must not echo it back as a
 * rich edit). It also asks for no autolinking. TipTap's autolink plugin reads
 * every document-changing transaction, and after setContent's — which changes
 * everything — it linked a bare domain ending the document's FIRST paragraph
 * (`Visit example.com`) on every markdown keystroke, a mark no markdown in the
 * pane asked for. A partial transaction would have linked different text (the
 * edited block's), so neither is kept: the rich pane shows what the markdown says.
 */
function replaceRange(state: EditorState, from: number, to: number, nodes: PMNode[]): Transaction | null {
  const doc = state.doc;
  let a = from;
  let b = to;
  let na = 0;
  let nb = nodes.length;
  while (a < b && na < nb && eqNode(doc.child(a), nodes[na]!)) { a++; na++; }
  while (a < b && na < nb && eqNode(doc.child(b - 1), nodes[nb - 1]!)) { b--; nb--; }
  // TipTap's TrailingNode appends an empty paragraph whenever the document
  // ends in anything else. When the range runs through such a paragraph at the
  // end, and the new content ends in the very block it follows now, the
  // document's end does not change — so neither does the plugin's decision:
  // keep the paragraph rather than delete it and have it appended again. Only
  // then: whether the new content needs the paragraph at all is otherwise the
  // plugins' to decide (fixTables can remove the block that needed it), after
  // this transaction, exactly as they do after the whole-document one.
  const para = state.schema.topNodeType.contentMatch.defaultType;
  if (b === doc.childCount && b - a >= 2 && nb > na && hasTrailingNode(state) && isTrailingNode(doc.child(b - 1), state.schema)) {
    const before = doc.child(b - 2);
    if (before.type !== para && eqNode(before, nodes[nb - 1]!)) {
      b--;
      while (a < b && na < nb && eqNode(doc.child(b - 1), nodes[nb - 1]!)) { b--; nb--; }
    }
  }
  if (a === b && na === nb) return null;
  let start = 0;
  for (let k = 0; k < a; k++) start += doc.child(k).nodeSize;
  const tr = state.tr;
  // TrailingNode's paragraph at the end, with nothing to stand for in the new
  // content: compared as absent, and deleted (the plugin decides afresh).
  const tail = b === doc.childCount && b - a === nb - na + 1 && isTrailingNode(doc.child(b - 1), state.schema) ? 1 : 0;
  if (b - a - tail === nb - na) {
    // As many nodes as before: replace only the ones that differ, one step per
    // stretch of them, from the end so the positions before stay put. After a
    // load most of a document parses back to itself, but not all of it (a
    // code block gains the trailing newline marked writes), and one range from
    // the first difference to the last re-rendered everything between.
    const from: number[] = [];
    let pos = start;
    for (let k = a; k <= b; k++) {
      from.push(pos);
      if (k < b) pos += doc.child(k).nodeSize;
    }
    const n = b - a - tail;
    const same = (k: number) => eqNode(doc.child(a + k), nodes[na + k]!);
    // The tail goes with the last stretch when that stretch ends the range,
    // else on its own — first, being last in the document.
    const tailAlone = tail === 1 && (n === 0 || same(n - 1));
    if (tailAlone) tr.delete(from[n]!, from[n + 1]!);
    for (let k = n - 1; k >= 0;) {
      if (same(k)) { k--; continue; }
      const last = k;
      while (k >= 0 && !same(k)) k--;
      const end = last === n - 1 && tail && !tailAlone ? n + 1 : last + 1;
      tr.replaceWith(from[k + 1]!, from[end]!, Fragment.fromArray(nodes.slice(na + k + 1, na + last + 1)));
    }
  } else {
    let end = start;
    for (let k = a; k < b; k++) end += doc.child(k).nodeSize;
    tr.replaceWith(start, end, Fragment.fromArray(nodes.slice(na, nb)));
  }
  return tr.setMeta("preventUpdate", true).setMeta("preventAutolink", true);
}

/** A run of pieces merged at the cuts ProseMirror did not honour. */
function runsOf(pieces: Pieces, parsed: Parsed, keepTogether: (len: number) => boolean): { lens: number[]; counts: number[] } {
  const lens: number[] = [];
  const counts: number[] = [];
  let len = pieces.lens[0]!;
  let from = 0;
  for (let k = 0; k < parsed.at.length; k++) {
    const at = parsed.at[k];
    if (at === undefined || (lens.length === 0 && keepTogether(len))) {
      len += pieces.lens[k + 1]!;
      continue;
    }
    lens.push(len);
    counts.push(at - from);
    from = at;
    len = pieces.lens[k + 1]!;
  }
  lens.push(len);
  counts.push(parsed.nodes.length - from);
  return { lens, counts };
}

const childrenOf = (doc: PMNode): PMNode[] => {
  const nodes: PMNode[] = [];
  doc.forEach((n) => { nodes.push(n); });
  return nodes;
};

/** A run of about 2 KB of markdown: a keystroke re-parses one or two. */
const RUN_LENGTH = 2048;

export function createRichProjector(opts: RichProjectorOptions): RichProjector {
  const runLength = opts.runLength ?? RUN_LENGTH;
  let model: Model | null = null;
  let last: RichPath = { path: "none", reason: "" };

  /** `setContent(html)`'s document, with no model to show for it. */
  function whole(html: string, state: EditorState, reason: string): RichPlan {
    last = { path: "whole", reason };
    model = null;
    return { tr: replaceRange(state, 0, state.doc.childCount, childrenOf(parseHtmlDoc(html, state.schema))), commit: () => {} };
  }

  function planned(md: string, m: Marked, schema: Schema, fm: number, lens: number[], counts: number[], tr: Transaction | null): RichPlan {
    return {
      tr,
      commit(doc: PMNode) {
        let sum = 0;
        for (const c of counts) sum += c;
        // Appended transactions may have reshaped the document: fixTables mends
        // table cells (inside a node, which the model does not look into), and
        // TrailingNode appends an empty paragraph at the end. Anything else —
        // a model that no longer adds up — is dropped rather than trusted.
        let ok = sum <= doc.childCount;
        for (let k = sum; ok && k < doc.childCount; k++) ok = isTrailingNode(doc.child(k), schema);
        // Adding up is not enough: fixTables DELETES a table it cannot mend (a
        // raw `<table>` the browser left empty) and TrailingNode then appends
        // its paragraph — same count, every node after the table one place off.
        // So when anything changed the planned document, each counted node must
        // still be the planned one, or a table where a table was.
        const made = tr?.doc;
        if (ok && made && made !== doc) ok = sameNodes(made, doc, sum);
        model = ok ? { marked: m, schema, md, doc, lens, counts, fm } : null;
      },
    };
  }

  /** The whole document, cut: the model is rebuilt from scratch. */
  function build(md: string, state: EditorState, m: Marked, f: MarkdownFeatureSettings, reason: string): RichPlan {
    const schema = state.schema;
    if (holdsBarePipe(md)) return whole(opts.mdToHtml(md), state, "alias wiki link");
    const fm = frontmatterLength(md);
    const pre = opts.preprocess(f);
    let src = md;
    if (fm) src = preprocessMarkdown(md.slice(0, fm), pre) + md.slice(fm);
    const shift = src.length - md.length;
    // Whatever else the preprocessor does, it must do nothing here: the cut
    // positions are source positions.
    if (preprocessMarkdown(md, pre) !== src) return whole(opts.mdToHtml(md), state, "preprocessor");
    const lexed = lex(m, src);
    // Not cuttable, but lexed: rendered whole it is marked.parse's output, token for token.
    if (!lexed.top) return whole(opts.style(new Parser(lexed.opt).parse(lexed.tokens) as string), state, lexed.why);
    const pieces = cut(lexed, src, opts.style, runLength);
    const parsed = parsePieces(pieces.html, schema, "start");
    if (!parsed) return whole(pieces.html.join(""), state, "markers");
    // An empty document: the whole parse fills in its paragraph.
    if (!parsed.nodes.length) return whole(pieces.html.join(""), state, "empty");
    last = { path: "build", reason };
    // The front matter's replacement must lie inside the first run.
    const { lens, counts } = runsOf(pieces, parsed, (len) => len < shift + fm);
    lens[0] = lens[0]! - shift;
    return planned(md, m, schema, fm, lens, counts, replaceRange(state, 0, state.doc.childCount, parsed.nodes));
  }

  /** Re-parse only the runs the edit touched; a reason when that cannot be done. */
  function incremental(mdl: Model, md: string, state: EditorState, m: Marked, pre: PreprocessFeatures): RichPlan | string {
    const old = mdl.md;
    const live = state.doc;
    const n = mdl.lens.length;
    const starts = new Array<number>(n + 1);
    const nodeStarts = new Array<number>(n + 1);
    starts[0] = 0;
    nodeStarts[0] = 0;
    for (let k = 0; k < n; k++) {
      starts[k + 1] = starts[k]! + mdl.lens[k]!;
      nodeStarts[k + 1] = nodeStarts[k]! + mdl.counts[k]!;
    }
    const segAt = (offset: number): number => {
      for (let k = 0; k < n; k++) if (offset < starts[k + 1]!) return k;
      return n - 1;
    };
    const segOfNode = (idx: number): number => {
      for (let k = 0; k < n; k++) if (idx < nodeStarts[k + 1]!) return k;
      return n - 1;
    };

    let i = n;
    let j = 0;
    // The markdown that changed.
    const p = commonPrefix(old, md);
    if (p !== old.length || p !== md.length) {
      const q = old.length - commonSuffix(old, md, Math.min(old.length, md.length) - p);
      i = segAt(Math.max(0, p - 1));
      j = segAt(q > p ? q - 1 : Math.max(0, p - 1)) + 1;
    }
    // The nodes the rich pane changed since: their runs are re-parsed too,
    // which is what the whole-document path would do to them. Top-level nodes
    // are shared between the documents, so identity finds them.
    const docN = mdl.doc.childCount;
    if (live !== mdl.doc) {
      const min = Math.min(docN, live.childCount);
      let a = 0;
      while (a < min && mdl.doc.child(a) === live.child(a)) a++;
      let b = 0;
      while (b < min - a && mdl.doc.child(docN - 1 - b) === live.child(live.childCount - 1 - b)) b++;
      if (a < docN - b) {
        i = Math.min(i, segOfNode(a));
        j = Math.max(j, segOfNode(docN - b - 1) + 1);
      } else {
        // Nodes inserted between a - 1 and a: both neighbours' runs.
        i = Math.min(i, a > 0 ? segOfNode(a - 1) : 0);
        j = Math.max(j, a < docN ? segOfNode(a) + 1 : n);
      }
    }
    if (i >= j) {
      last = { path: "incremental", reason: "unchanged" };
      return planned(md, m, mdl.schema, mdl.fm, mdl.lens, mdl.counts, null);
    }
    const delta = md.length - old.length;
    // Front matter is replaced by the preprocessor, so the first run is never
    // re-parsed on its own while there is some; and an edit anywhere can make
    // some (a first `---` line gains its closing one) or unmake it.
    if (frontmatterLength(md) !== mdl.fm) return "front matter";
    if (mdl.fm && i === 0) return "front matter";
    for (;;) {
      if (i === 0 && j === n) return "whole window";
      const ws = starts[i]!;
      const we = starts[j]!;
      // The window must end where a line starts. Text typed at the very start
      // of the next run lands at the window's end, but it begins that run's
      // first line (a tab makes it code) — and marked, lexing the window on
      // its own, reads a trailing "\t" as a blank line and calls the end clean.
      if (j < n && md.charCodeAt(we + delta - 1) !== 10) {
        j++;
        continue;
      }
      const text = md.slice(ws, we + delta);
      // marked-footnote numbers references with a counter that only RENDERING
      // a reference resets: lexing a footnote here and then falling back would
      // start the real parse at the wrong number. (A document holding a
      // definition is never cut anyway; this keeps the lexer from ever seeing one.)
      if (text.indexOf("[^") !== -1) return "footnote syntax";
      if (holdsBarePipe(text)) return "alias wiki link";
      // The cuts are source positions, so the preprocessor must leave the text
      // as it is. The build checks the whole text; after that only the window
      // changes, and with alias pipes, front matter and the curly syntax
      // refused above, the preprocessor's code masking is a pure round trip.
      // This is a partial net for the day it is not: it sees what the window
      // alone brings in (a code-mask defect found by the random walks was
      // caught here for two of the three seeds that hit it, not the third,
      // whose mask spanned beyond the window) — unreachable today.
      if (preprocessMarkdown(text, pre) !== text) return "preprocessor";
      const lexed = lex(m, text);
      if (!lexed.top) return lexed.why;
      const pieces = cut(lexed, text, opts.style, runLength);
      // The window must end where a cut may fall, or the next run's lexing may
      // depend on it: take in more runs and try again.
      if (j < n && !pieces.endClean) {
        j = Math.min(n, j + Math.max(1, j - i));
        continue;
      }
      const parsed = parsePieces(pieces.html, mdl.schema, nodeStarts[i]! > 0 ? "after" : "start");
      if (!parsed) return "markers";
      // Text first, after a run: in the document it joins that run's last text.
      if (i > 0 && parsed.startsWithText) return "text at a run start";
      if (j < n && !parsed.endClean) {
        j = Math.min(n, j + Math.max(1, j - i));
        continue;
      }
      const runs = runsOf(pieces, parsed, () => false);
      const liveFrom = nodeStarts[i]!;
      // Through the last NODE, the appended tail goes too: whether it is needed
      // is decided again for the new last block, as the whole document's parse
      // would. (The runs after the window may make none — a comment left open
      // to the end — which puts the window at the end all the same.)
      const liveTo = nodeStarts[j] === nodeStarts[n] ? live.childCount : live.childCount - (docN - nodeStarts[j]!);
      // An empty document: the whole parse fills in its paragraph.
      if (liveFrom + parsed.nodes.length + (live.childCount - liveTo) === 0) return "empty";
      last = { path: "incremental", reason: `${j - i} of ${n} runs` };
      return planned(
        md, m, mdl.schema, mdl.fm,
        [...mdl.lens.slice(0, i), ...runs.lens, ...mdl.lens.slice(j)],
        [...mdl.counts.slice(0, i), ...runs.counts, ...mdl.counts.slice(j)],
        replaceRange(state, liveFrom, liveTo, parsed.nodes),
      );
    }
  }

  return {
    plan(md: string, state: EditorState): RichPlan {
      const m = opts.marked();
      const f = opts.features();
      // Configurations the cuts do not cover: the curly-brace syntax rewrites
      // across lines, hooks may rewrite anything, and "\r" moves every offset
      // (marked normalises line endings before it lexes).
      if (f.curlyBraceFormatting === true) return whole(opts.mdToHtml(md), state, "curly braces");
      if (m.defaults.hooks) return whole(opts.mdToHtml(md), state, "marked hooks");
      if (md.indexOf("\r") !== -1) return whole(opts.mdToHtml(md), state, "carriage return");
      const mdl = model && model.marked === m && model.schema === state.schema ? model : null;
      if (!mdl) return build(md, state, m, f, model ? "configuration" : "no model");
      const planned = incremental(mdl, md, state, m, opts.preprocess(f));
      return typeof planned === "string" ? build(md, state, m, f, planned) : planned;
    },
    forget() {
      model = null;
    },
    get last() {
      return last;
    },
  };
}
