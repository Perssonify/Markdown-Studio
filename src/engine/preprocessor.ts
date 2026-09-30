// Extended markdown preprocessor: front matter, field blocks, transclusions,
// block ids, wiki links and the opt-in `{attr=val}content{/attr}` syntax →
// HTML placeholders the editor schema parses. Runs on the source BEFORE marked.
import {
  escapeAttr,
  sanitizeCssColor,
  sanitizeFontFamily,
  sanitizeStyleDeclarations,
  sanitizeTextAlign,
} from "./css-safety";
import { parseWikiInner, wikiLinkOpenTag } from "./wiki-link-marked";

export interface PreprocessFeatures {
  frontmatter?: boolean;
  fieldBlocks?: boolean;
  transclusions?: boolean;
  blockIds?: boolean;
  /** Convert `[[…]]` here, before marked. The engine renders wiki links with
   *  a marked extension instead (wiki-link-marked.ts) and leaves this off. */
  wikiLinks?: boolean;
  /**
   * Rewrite the `|` inside `[[Doc|Alias]]` as `\|`. A GFM table splits its
   * cells on every unescaped pipe BEFORE any inline syntax is read, so an
   * alias in a table cell was cut in two and the second half dropped as an
   * excess cell. `\|` is the spelling GFM (and Obsidian) require there, and the
   * wiki-link extension reads it as the separator everywhere else.
   */
  wikiLinkTablePipes?: boolean;
  taskLists?: boolean;
  /**
   * `{color=red}text{/color}` and `## Heading {size=large}`. Undocumented and
   * OFF unless a caller asks for it: while it defaulted to on, any braces in
   * prose were at risk — `## Returns {Promise}` rendered as `## Returns`, and
   * `{id}…{/id}` swallowed its delimiters. When it is on, a construct is only
   * rendered when EVERY key in it is one this syntax knows and every value is
   * safe; anything else stays exactly as written.
   */
  curlyBraceFormatting?: boolean;
}

interface FieldEntry {
  key: string;
  value: string;
}

/** Parse key: value lines into field array (inlined from FieldBlock for zero-dep import) */
function parseFieldLines(text: string): FieldEntry[] {
  const lines = text.trim().split("\n");
  const fields: FieldEntry[] = [];
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) fields.push({ key, value });
  }
  return fields;
}

// HTML attribute escape (`&` first — see the front matter note below).
const esc = escapeAttr;

/**
 * YAML front matter starts with a key (or a comment) on the line right after
 * the opening `---`. Without this check a document that merely BEGINS with a
 * thematic break — `---`, a blank line, prose, `---` — had that prose
 * swallowed into a read-only front-matter card.
 */
function looksLikeFrontmatter(body: string): boolean {
  const first = body.split(/\r?\n/, 1)[0] ?? "";
  return /^[ \t]*(?:#|[^\s:#][^:\n]*:(?:[ \t]|$))/.test(first);
}

/** A leading `---` … `---` block (anchored, non-global: never a mid-document rule). */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * How many characters at the start of `md` the front matter pass replaces —
 * 0 when there is no front matter. The incremental markdown→rich projection
 * (incremental-rich.ts) uses it to keep that block out of a partial re-parse.
 */
export function frontmatterLength(md: string): number {
  if (!md.startsWith("---")) return 0;
  const m = FRONTMATTER.exec(md);
  return m && looksLikeFrontmatter(m[1]!) ? m[0].length : 0;
}

// ---------------------------------------------------------------------------
// Code detection, shared by the preprocessor's mask and normalizeMarkdown.
// ---------------------------------------------------------------------------

/** One source line analysed for a fence: blockquote depth, fence run, rest. */
const FENCE_LINE = /^((?:[ \t]{0,3}>[ \t]?)*)[ \t]*(`{3,}|~{3,})(.*)$/;
const QUOTE_PREFIX = /^(?:[ \t]{0,3}>[ \t]?)*/;
const quoteDepth = (prefix: string): number => (prefix.match(/>/g) ?? []).length;

/**
 * Fenced code blocks, found line by line the way CommonMark finds them: a fence
 * opens with three or more backticks or tildes and closes ONLY on a line of the
 * same character that is at least as long, with nothing after it but spaces.
 * A fence inside a blockquote ends with the blockquote.
 *
 * The old masks were `/```[\s\S]*?```/`-style: a fence closed at the first
 * line that ENDED in three backticks, so a ````-fence containing an example
 * ``` block was unmasked from that example onward, and a fence inside a
 * blockquote or callout (`> ````) was not recognised at all — the whitespace
 * passes then collapsed blank runs and stripped trailing spaces INSIDE the code.
 *
 * Returns [start, end) offsets from the opener's line start to the closer's
 * line end (an unclosed fence runs to the end of the document, as in marked).
 */
export function findFencedCodeRanges(md: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  if (md.indexOf("```") === -1 && md.indexOf("~~~") === -1) return ranges;
  let open: { char: string; len: number; start: number; depth: number } | null = null;
  let lineEnd = 0;
  for (let pos = 0; pos <= md.length; pos = lineEnd + 1) {
    lineEnd = md.indexOf("\n", pos);
    if (lineEnd === -1) lineEnd = md.length;
    const line = md.slice(pos, lineEnd).replace(/\r$/, "");
    if (open) {
      const depth = quoteDepth(QUOTE_PREFIX.exec(line)![0]);
      if (depth < open.depth) {
        // The blockquote holding the fence ended, and the fence with it.
        ranges.push([open.start, Math.max(open.start, pos - 1)]);
        open = null;
      } else {
        const f = FENCE_LINE.exec(line);
        if (f && f[2]![0] === open.char && f[2]!.length >= open.len && /^[ \t]*$/.test(f[3]!)) {
          ranges.push([open.start, lineEnd]);
          open = null;
        }
        if (lineEnd >= md.length) break;
        continue;
      }
    }
    const f = FENCE_LINE.exec(line);
    // A backtick fence's info string may not contain a backtick (that is an
    // inline code span that happens to start a line).
    if (f && !(f[2]![0] === "`" && f[3]!.includes("`"))) {
      open = { char: f[2]![0]!, len: f[2]!.length, start: pos, depth: quoteDepth(f[1]!) };
    }
    if (lineEnd >= md.length) break;
  }
  if (open) ranges.push([open.start, md.length]);
  return ranges;
}

/** Replace each [start, end) range with `mark(slice)`, in one linear pass. */
function replaceRanges(md: string, ranges: Array<[number, number]>, mark: (s: string) => string): string {
  if (!ranges.length) return md;
  let out = "";
  let at = 0;
  for (const [s, e] of ranges) {
    out += md.slice(at, s) + mark(md.slice(s, e));
    at = e;
  }
  return out + md.slice(at);
}

const indentWidth = (line: string): number => {
  let w = 0;
  for (const c of line) {
    if (c === " ") w++;
    else if (c === "\t") w += 4 - (w % 4);
    else break;
  }
  return w;
};
const LIST_ITEM = /^([ \t]*)([-+*]|\d{1,9}[.)])([ \t]+|$)/;

/**
 * Indented code blocks (CommonMark: four columns past the container, after a
 * blank line). List items move the container, so a line is code only when it
 * sits four columns past the current item's CONTENT column — `- item`, blank,
 * `    more` is a second paragraph of the item, not code. An approximation of
 * the block parser, erring toward treating text as code: the passes this mask
 * protects then simply leave that text alone.
 */
function maskIndentedCode(md: string, mark: (s: string) => string): string {
  if (!/(?:^|\n)(?: {4}|[ ]{0,3}\t)/.test(md)) return md;
  const lines = md.split("\n");
  const out: string[] = [];
  let listIndent = -1; // content column of the enclosing list item, if any
  let prevBlank = true; // the document start behaves like a blank line
  let code: string[] | null = null;
  let codeMin = 0;
  let trailingBlanks: string[] = [];
  const flush = () => {
    if (code) out.push(mark(code.join("\n")), ...trailingBlanks);
    code = null;
    trailingBlanks = [];
  };
  for (const line of lines) {
    const blank = /^[ \t]*\r?$/.test(line);
    if (code) {
      if (blank) { trailingBlanks.push(line); continue; }
      if (indentWidth(line) >= codeMin) {
        code.push(...trailingBlanks, line);
        trailingBlanks = [];
        continue;
      }
      const hadBlank = trailingBlanks.length > 0;
      flush();
      prevBlank = hadBlank;
    }
    if (blank) { out.push(line); prevBlank = true; continue; }
    const indent = indentWidth(line);
    const threshold = (listIndent >= 0 ? listIndent : 0) + 4;
    if (prevBlank && indent >= threshold) {
      code = [line];
      codeMin = threshold;
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const lead = indentWidth(item[1]!);
      const gap = item[3]!.length;
      listIndent = lead + item[2]!.length + (gap >= 1 && gap <= 4 ? gap : 1);
    } else if (prevBlank && listIndent >= 0 && indent < listIndent) {
      listIndent = -1; // a paragraph back at the margin ends the list
    }
    out.push(line);
    prevBlank = false;
  }
  flush();
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Curly-brace formatting
// ---------------------------------------------------------------------------

const NAMED_SIZES: Record<string, string> = {
  small: "12px",
  medium: "16px",
  large: "20px",
  "x-large": "24px",
  "xx-large": "32px",
};
const CSS_LENGTH = /^(?:0|(?:\d+|\d*\.\d+)(?:px|em|rem|%|pt|ch|ex|vh|vw))$/i;
const BLOCK_KEYS = new Set([
  "align",
  "line-height",
  "margin-top",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "padding",
]);

type CurlyPart = { style: string } | { attr: string };

/** One `key=value`, validated for its key; null means "not a construct". */
function curlyPart(key: string, val: string): CurlyPart | null {
  if (!val) return null;
  switch (key) {
    case "color": {
      const c = sanitizeCssColor(val);
      return c ? { style: `color: ${c}` } : null;
    }
    case "bg": {
      const c = sanitizeCssColor(val);
      return c ? { style: `background-color: ${c}` } : null;
    }
    case "size": {
      const named = NAMED_SIZES[val];
      if (named) return { style: `font-size: ${named}` };
      if (/^\d+(?:\.\d+)?$/.test(val)) return { style: `font-size: ${val}px` };
      return CSS_LENGTH.test(val) ? { style: `font-size: ${val}` } : null;
    }
    case "align": {
      const a = sanitizeTextAlign(val);
      return a ? { style: `text-align: ${a}` } : null;
    }
    case "line-height":
      return /^\d+(?:\.\d+)?$/.test(val) || CSS_LENGTH.test(val) ? { style: `line-height: ${val}` } : null;
    case "letter-spacing":
      return val === "normal" || CSS_LENGTH.test(val) ? { style: `letter-spacing: ${val}` } : null;
    case "margin-top":
    case "margin-bottom":
    case "margin-left":
    case "margin-right":
      return val === "auto" || CSS_LENGTH.test(val) ? { style: `${key}: ${val}` } : null;
    case "padding":
      return CSS_LENGTH.test(val) ? { style: `padding: ${val}` } : null;
    case "font": {
      const f = sanitizeFontFamily(val);
      return f ? { style: `font-family: ${f}` } : null;
    }
    case "style": {
      const s = sanitizeStyleDeclarations(val);
      return s ? { style: s } : null;
    }
    case "id":
    case "class":
      return /^[A-Za-z][\w-]{0,63}$/.test(val) ? { attr: `${key}="${esc(val)}"` } : null;
    default:
      // Only safe, non-event attributes; never `on*` handlers or arbitrary keys.
      return /^(?:data-[a-z0-9-]+|aria-[a-z]+|title|lang|dir|role)$/.test(key)
        ? { attr: `${key}="${esc(val)}"` }
        : null;
  }
}

interface CurlyAttrs {
  firstKey: string;
  style: string[];
  attrs: string[];
  block: boolean;
}

/** Parse `key=val key2=val2`. Null unless EVERY item is a known, valid key. */
function parseCurlyAttrs(attrString: string): CurlyAttrs | null {
  const items = attrString.trim().split(/\s+/).filter(Boolean);
  if (!items.length) return null;
  const parsed: CurlyAttrs = { firstKey: "", style: [], attrs: [], block: false };
  for (const item of items) {
    const eq = item.indexOf("=");
    // `{Promise}`, `{.lead}`, `{id}` — braces in prose, not this syntax.
    if (eq <= 0) return null;
    const key = item.slice(0, eq).trim().toLowerCase();
    let val = item.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(val)) val = val.slice(1, -1);
    const part = curlyPart(key, val);
    if (!part) return null;
    if (!parsed.firstKey) parsed.firstKey = key;
    if ("style" in part) parsed.style.push(part.style);
    else parsed.attrs.push(part.attr);
  }
  parsed.block = BLOCK_KEYS.has(parsed.firstKey);
  return parsed;
}

/**
 * Whether `{inner}` is something the curly syntax would act on: a recognised
 * opener or a `/name` closer. The markdown escaper uses this so literal braces
 * typed in the rich pane are escaped exactly when they would otherwise turn
 * into formatting — and not otherwise.
 */
export function isCurlyGroup(inner: string): boolean {
  return /^\/[a-zA-Z0-9-]+$/.test(inner) || parseCurlyAttrs(inner) !== null;
}

// Stand-ins while the curly passes run: escaped braces (`\{`, `\}`), and the
// braces of a group the syntax declined — taken out of play so the next pass
// can see the pairs around it, then restored verbatim.
const ESC_OPEN = "@@PFESCLB@@";
const ESC_CLOSE = "@@PFESCRB@@";
const HELD_OPEN = "@@PFLB@@";
const HELD_CLOSE = "@@PFRB@@";

function applyCurlyFormatting(md: string): string {
  md = md.replace(/\\([{}])/g, (_m, b: string) => (b === "{" ? ESC_OPEN : ESC_CLOSE));

  // Heading attributes: `## Title {size=large}` → `## {size=large}Title{/size}`.
  md = md.replace(
    /^(#{1,6})([ \t]+)([^\n{}]*[^\s{}])[ \t]*\{([^{}\n]+)\}[ \t]*$/gm,
    (whole: string, hashes: string, space: string, text: string, attrs: string) => {
      const parsed = parseCurlyAttrs(attrs);
      return parsed ? `${hashes}${space}{${attrs}}${text}{/${parsed.firstKey}}` : whole;
    }
  );

  // Spans and blocks, innermost first: the content may not contain a brace,
  // so each pass resolves one level of nesting.
  const span = /\{([^{}\n]+)\}([^{}]*)\{\/([a-zA-Z0-9-]+)\}/g;
  for (let pass = 0; pass < 32; pass++) {
    let matched = false;
    md = md.replace(span, (_whole: string, attrString: string, inner: string, closing: string) => {
      matched = true;
      const parsed = parseCurlyAttrs(attrString);
      if (!parsed || parsed.firstKey !== closing.toLowerCase()) {
        // Not a construct this syntax renders: keep every character.
        return `${HELD_OPEN}${attrString}${HELD_CLOSE}${inner}${HELD_OPEN}/${closing}${HELD_CLOSE}`;
      }
      const style = parsed.style.length ? ` style="${esc(parsed.style.join("; "))}"` : "";
      const attrs = parsed.attrs.map((a) => " " + a).join("");
      const tag = parsed.block ? "div" : "span";
      return `<${tag}${style}${attrs}>${inner}</${tag}>`;
    });
    if (!matched) break;
  }

  return md
    .split(HELD_OPEN).join("{")
    .split(HELD_CLOSE).join("}")
    .split(ESC_OPEN).join("\\{")
    .split(ESC_CLOSE).join("\\}");
}

export function preprocessMarkdown(
  md: string,
  features: PreprocessFeatures = {}
): string {
  const {
    frontmatter = false,
    fieldBlocks = false,
    transclusions = false,
    blockIds = false,
    wikiLinks = false,
    wikiLinkTablePipes = false,
    // taskLists: handled by the marked renderer override (build-marked.ts), not here.
    curlyBraceFormatting = false,
  } = features;

  // 0. YAML front matter: a leading ---\n…\n--- block → placeholder node. Only the
  // very first block at the document start is treated as front matter (anchored,
  // non-global) so it never captures a mid-document thematic break.
  if (frontmatter) {
    md = md.replace(
      FRONTMATTER,
      (whole: string, body: string) => {
        if (!looksLikeFrontmatter(body)) return whole;
        // The JSON goes through the FULL attribute escape, `&` first. Escaping
        // only the quotes let the HTML parser decode entities that were part of
        // the text: `title: Tom &amp; Jerry` came back as `Tom & Jerry`, and a
        // `&quot;` inside a value decoded into a raw quote that broke the JSON,
        // so JSON.parse failed and the whole block came back EMPTY.
        const json = esc(JSON.stringify(body));
        // Include the raw body as inner text so the element is never "blank"
        // (Turndown skips its custom rule for blank nodes) — the atom node ignores
        // this inner text on the way in and reads it back from the data attribute.
        // Collapse newlines in the inner text so a blank line inside the block
        // can't make marked split the HTML block; the data attribute keeps the
        // real (newline-preserving) body used for parsing and round-trip.
        return `<div data-type="frontmatter" data-frontmatter="${json}">${esc(body).replace(/\s*\n\s*/g, " ")}</div>\n\n`;
      }
    );
  }

  // 0a. Field blocks: :::fields ... ::: → HTML
  if (fieldBlocks) {
    md = md.replace(
      /^:::fields\n([\s\S]*?)^:::\s*$/gm,
      (_: string, body: string) => {
        const fields = parseFieldLines(body);
        return `<div data-type="field-block" data-fields="${esc(JSON.stringify(fields))}"></div>`;
      }
    );
  }

  // Mask code — fenced, indented and inline — so the semantic passes below
  // (transclusions, wiki links, block ids, curly-brace formatting) never
  // rewrite code content: `[[Doc]]` or `{color=red}` shown as code must stay
  // literal. Restored verbatim just before returning.
  const codeStore: string[] = [];
  const PLACEHOLDER = /@@PFCODE(\d+)@@/g;
  // A later mask can take in an earlier one's placeholder — a backtick run
  // across a fence that interrupts its paragraph (`` `a\n```\nx\n```\nb` ``),
  // say — and the one restore pass below expands each placeholder once, so the
  // inner one reached the document as the text "@@PFCODE0@@" (A083's random
  // walks found it). Each entry is stored with its own placeholders expanded.
  const stash = (m: string) =>
    `@@PFCODE${codeStore.push(m.replace(PLACEHOLDER, (p, i) => codeStore[Number(i)] ?? p)) - 1}@@`;
  // Only when a pass below can match: this runs on every md→rich projection,
  // and the engine always asks for the table-pipe pass.
  const hasWiki = md.indexOf("[[") !== -1;
  const needsMask =
    transclusions || blockIds ||
    ((wikiLinks || wikiLinkTablePipes) && hasWiki) ||
    (curlyBraceFormatting && md.indexOf("{") !== -1);
  if (needsMask) {
    // Keep a fence's own indentation in place: it is what tells the
    // indented-code scan that the lines around it are still inside a list.
    md = replaceRanges(md, findFencedCodeRanges(md), (s) => {
      const lead = /^[ \t]*/.exec(s)![0];
      return lead + stash(s.slice(lead.length));
    });
    md = maskIndentedCode(md, stash);
    // A code span cannot cross a blank line (it would be two paragraphs).
    if (md.indexOf("`") !== -1) {
      md = md.replace(/(`+)((?:(?!\n[ \t]*\n)[\s\S])+?)\1/g, stash);
    }
  }

  // 0b. Transclusion: ![[target]] or ![[target#section]] or ![[target#^blockId]]
  // Must run BEFORE wiki links since ![[]] contains [[]]
  if (transclusions) {
    md = md.replace(/!\[\[([^\]]+)\]\]/g, (_: string, inner: string) => {
      let target = inner;
      let section: string | null = null;
      let blockId: string | null = null;
      const hashIdx = inner.indexOf("#");
      if (hashIdx >= 0) {
        target = inner.slice(0, hashIdx).trim();
        const after = inner.slice(hashIdx + 1).trim();
        if (after.startsWith("^")) {
          blockId = after.slice(1);
        } else {
          section = after;
        }
      }
      const attrs = [
        `data-type="transclusion"`,
        `data-target="${esc(target)}"`,
        section ? `data-section="${esc(section)}"` : "",
        blockId ? `data-block-id="${esc(blockId)}"` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<div ${attrs}></div>`;
    });
  }

  // 0c. Block IDs: strip ^block-id from end of lines (store in data attr)
  if (blockIds) {
    md = md.replace(
      /^(.+?)\s+\^([a-z0-9]{4,12})\s*$/gm,
      (_: string, content: string, blockId: string) =>
        `${content}<!-- block-id:${blockId} -->`
    );
  }

  // 0d. Task lists: intentionally NOT preprocessed here. marked's gfm list
  // tokenizer detects `- [ ]`/`- [x]` natively and our renderer override
  // (build-marked.ts, gated on `taskLists`) emits TaskList/TaskItem-parseable
  // markup while preserving inline markdown in each item. A regex pass here
  // would strip the `[ ]` before marked ever sees it.

  // 1a. Wiki links + heading anchors (see wiki-link-marked.ts for the syntax).
  // Emitted as an <a> carrying data-doc-link (empty = current doc) and
  // data-anchor (the heading text).
  if (wikiLinks) {
    md = md.replace(/\[\[([^[\]\n]+)\]\]/g, (whole: string, inner: string) => {
      const { ref, target, anchor, display } = parseWikiInner(inner);
      if (!target && !anchor) return whole;
      return `${wikiLinkOpenTag(target, anchor)}${esc(display ?? ref)}</a>`;
    });
  } else if (wikiLinkTablePipes && md.indexOf("[[") !== -1) {
    md = md.replace(/\[\[([^[\]\n]+)\]\]/g, (_: string, inner: string) =>
      `[[${inner.replace(/\\?\|/g, (p) => (p === "|" ? "\\|" : p))}]]`
    );
  }

  // 1b+ Curly brace formatting (heading attrs + inline spans). The `indexOf`
  // is the point: these are whole-document scans and cannot match anything
  // without a brace in the text.
  if (curlyBraceFormatting && md.indexOf("{") !== -1) {
    md = applyCurlyFormatting(md);
  }

  // Restore masked code verbatim (see the mask step above).
  if (codeStore.length) {
    md = md.replace(PLACEHOLDER, (_m, i) => codeStore[Number(i)] ?? "");
  }

  return md;
}

// Whitespace normalizer for Turndown output.
//
// Fenced code is MASKED first, with the same line-based scanner the
// preprocessor uses. These passes collapse blank runs and strip trailing
// whitespace GLOBALLY, and they run on every rich→markdown projection — so
// without masking they quietly rewrote the user's code: blank lines inside a
// snippet collapsed, and trailing whitespace stripped from languages where it
// is significant (a Markdown two-space line break inside a fenced example, a
// diff/patch body, a here-doc). Code content must round-trip byte-for-byte.
export function normalizeMarkdown(md: string): string {
  const fences: string[] = [];
  const masked = replaceRanges(
    md,
    findFencedCodeRanges(md),
    (m) => `@@PFNORMCODE${fences.push(m) - 1}@@`
  );

  const out = masked
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "\n")
    .replace(/ {2}\n\n/g, "\n\n");

  // Turndown escapes every "[" / "]" it doesn't recognize, which mangles wiki
  // links into \[\[Doc Title\]\] — broken in the raw pane and not portable to
  // Obsidian/Logseq. Restore the [[…]] syntax verbatim. Guarded on the literal
  // escaped opener: the pattern cannot match without it, and this is another
  // whole-document scan on every projection.
  const unescaped = out.indexOf("\\[\\[") === -1
    ? out
    : out.replace(/\\\[\\\[([^[\]\\\n]+)\\?\]\\?\]/g, "[[$1]]");

  return fences.length
    ? unescaped.replace(/@@PFNORMCODE(\d+)@@/g, (_, i) => fences[Number(i)] ?? "")
    : unescaped;
}
