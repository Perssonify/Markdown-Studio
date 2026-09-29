// Turndown configuration rules
import TurndownService from "turndown";
import { matchBlockMath, matchInlineDisplay, matchInlineMath } from "./math-marked";
import { isCurlyGroup } from "./preprocessor";

// Minimal interface for TurndownService (package has no types)
interface TurndownInstance {
  addRule(
    name: string,
    rule: {
      filter: string | string[] | ((node: Node) => boolean);
      replacement: (content: string, node?: Node) => string;
    }
  ): TurndownInstance;
  turndown(input: string | Node): string;
}

interface FieldEntry {
  key: string;
  value?: string;
}

/**
 * Turndown's own block-element list (`blockElements` in turndown.es.js), plus
 * <details>, which it omits but which the Details node renders as a block.
 * Kept identical to turndown's notion of a block so that decisions made here
 * (list-item looseness, where the linear converter may split a document)
 * agree with how turndown itself separates the output.
 */
export const BLOCK_ELEMENTS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "AUDIO", "BLOCKQUOTE", "BODY", "CANVAS", "CENTER",
  "DD", "DIR", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM",
  "FRAMESET", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HGROUP", "HR", "HTML",
  "ISINDEX", "LI", "MAIN", "MENU", "NAV", "NOFRAMES", "NOSCRIPT", "OL", "OUTPUT", "P",
  "PRE", "SECTION", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
]);
const isBlockElement = (el: Element): boolean =>
  BLOCK_ELEMENTS.has(el.nodeName) || el.nodeName === "DETAILS";

/** Boundary markers for turndownLinear (see there); never part of the output. */
const SEAM_OPEN = "";
const SEAM_CLOSE = "";

const VOID_ELEMENTS = new Set([
  "AREA", "BASE", "BR", "COL", "COMMAND", "EMBED", "HR", "IMG", "INPUT", "KEYGEN",
  "LINK", "META", "PARAM", "SOURCE", "TRACK", "WBR",
]);

/**
 * The top-level elements of SERIALIZED markup (the output of innerHTML /
 * getHTML: every non-void element closed, `<` escaped in text), as
 * [start, end) offsets — or null if the markup is not plainly well-formed, in
 * which case the caller converts it whole. Attribute values may hold `>` and
 * even `</p>` (serialization does not escape those), so tags are scanned
 * quote-aware.
 */
function topLevelElements(html: string): Array<{ start: number; end: number; tag: string }> | null {
  const out: Array<{ start: number; end: number; tag: string }> = [];
  let depth = 0;
  let open: { start: number; tag: string } | null = null;
  let i = 0;
  for (;;) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end === -1) return null;
      i = end + 3;
      continue;
    }
    const m = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)/.exec(html.slice(lt, lt + 80));
    if (!m) return null;
    let j = lt + m[0].length;
    let quote = "";
    for (; j < html.length; j++) {
      const c = html[j];
      if (quote) { if (c === quote) quote = ""; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    if (j >= html.length) return null;
    const tag = m[2]!.toUpperCase();
    if (m[1]) {
      if (--depth < 0) return null;
      if (depth === 0) {
        if (!open || open.tag !== tag) return null;
        out.push({ start: open.start, end: j + 1, tag });
        open = null;
      }
    } else if (!VOID_ELEMENTS.has(tag) && html[j - 1] !== "/") {
      if (depth === 0) open = { start: lt, tag };
      depth++;
    } else if (depth === 0) {
      out.push({ start: lt, end: j + 1, tag });
    }
    i = j + 1;
  }
  return depth === 0 ? out : null;
}

/**
 * `td.turndown(html)`, in linear time.
 *
 * Turndown folds a node's children into one string with `join(output, next)`,
 * and every join reads the last characters of the accumulated output — which
 * makes V8 flatten the whole string it has built so far. At the root of a
 * large document (thousands of top-level blocks) that is quadratic, and the
 * conversion runs on every rich→markdown projection.
 *
 * So the top level is converted in runs of `chunk` blocks and the runs joined
 * here with turndown's OWN separator rule: the seam gets max(newlines ending
 * the left run, newlines starting the right run), at most two. Each run is
 * bracketed by a sentinel character, so turndown's final trim cannot eat the
 * newlines a seam needs to see. Runs split only between two elements turndown
 * itself treats as blocks, with nothing but whitespace between them — where
 * its whitespace pass removes that whitespace anyway — so the output is
 * byte-identical to the plain conversion (`converter-linear.test.js`). The
 * split is made on the markup STRING: taking the nodes out of one parsed tree
 * costs more than it saves wherever child lists are arrays (jsdom measured
 * slower than doing nothing at all). Small documents take the plain path.
 */
export function turndownLinear(td: TurndownInstance, html: string, chunk = 64): string {
  const elements = html.length > 4096 || chunk < 64 ? topLevelElements(html) : null;
  if (!elements) return td.turndown(html);

  // Run boundaries: the offsets where one run ends and the next begins.
  const cuts: Array<[number, number]> = [];
  let blocksInRun = 0;
  for (let k = 0; k < elements.length; k++) {
    const el = elements[k]!;
    const isBlock = BLOCK_ELEMENTS.has(el.tag);
    const prev = elements[k - 1];
    if (
      isBlock && prev && BLOCK_ELEMENTS.has(prev.tag) && blocksInRun >= chunk &&
      !/[^ \t\r\n]/.test(html.slice(prev.end, el.start))
    ) {
      cuts.push([prev.end, el.start]);
      blocksInRun = 0;
    }
    if (isBlock) blocksInRun++;
  }
  if (!cuts.length) return td.turndown(html);

  const parts: string[] = [];
  let pending = 0; // newlines owed after the text so far
  let started = false;
  for (let i = 0; i <= cuts.length; i++) {
    const from = i === 0 ? 0 : cuts[i - 1]![1];
    const to = i === cuts.length ? html.length : cuts[i]![0];
    const first = i === 0;
    const last = i === cuts.length;
    let out = td.turndown((first ? "" : SEAM_OPEN) + html.slice(from, to) + (last ? "" : SEAM_CLOSE));
    if (!first) {
      if (!out.startsWith(SEAM_OPEN)) return td.turndown(html);
      out = out.slice(1);
    }
    if (!last) {
      if (!out.endsWith(SEAM_CLOSE)) return td.turndown(html);
      out = out.slice(0, -1);
    }
    let lead = 0;
    while (lead < out.length && out[lead] === "\n") lead++;
    if (lead === out.length) {
      pending = Math.max(pending, lead);
      continue;
    }
    let trail = 0;
    while (out[out.length - 1 - trail] === "\n") trail++;
    if (started) parts.push("\n\n".slice(0, Math.min(2, Math.max(pending, lead))));
    parts.push(out.slice(lead, out.length - trail));
    started = true;
    pending = trail;
  }
  // turndown's own final trim, over the whole document.
  return parts.join("").replace(/^[\t\r\n]+/, "").replace(/[\t\r\n\s]+$/, "");
}

/**
 * `<a data-doc-link data-anchor>` → `[[target#anchor]]` / `[[target|alias]]`.
 *
 * Compares the link's TEXT with the reference, not turndown's escaped markdown
 * for it: `My_Doc` comes out of the escaper as `My\_Doc`, which never equals
 * the reference, so every such link was rewritten into the alias form
 * `[[My_Doc|My\_Doc]]`. A bare reference is shown verbatim by the wiki-link
 * extension, so it is written raw; an alias keeps its markdown (formatting
 * inside the link text survives that way).
 */
function wikiLinkMarkdown(content: string, el: Element): string {
  const target = el.getAttribute("data-doc-link") ?? "";
  const anchor = el.getAttribute("data-anchor") ?? "";
  const ref = anchor ? `${target}#${anchor}` : target;
  const text = (el.textContent ?? "").trim();
  if (text === ref && !el.querySelector("*")) return `[[${ref}]]`;
  return `[[${ref}|${content.trim()}]]`;
}

/**
 * What gives a character meaning on the way back in. Turndown's own escaper
 * knows CommonMark's core punctuation only; these are the constructs THIS
 * engine adds, each escaped only while its feature is on, so that ordinary
 * prose does not fill up with backslashes.
 */
export interface EscapeOptions {
  /** `$…$` / `$$…$$` is maths (the math feature). */
  math?: boolean;
  /** `~~…~~` is strikethrough (GFM + the strikethrough feature). */
  strikethrough?: boolean;
  /** `{key=val}…{/key}` is formatting (the curly-brace feature). */
  curly?: boolean;
}

const turndownEscape = (TurndownService.prototype as unknown as { escape(s: string): string }).escape;

/**
 * Where marked would open maths in this text, reading it left to right the
 * way its inline lexer does (a backslash escape consumes two characters; a
 * mid-line `$$…$$` is consumed whole as literal text), or -1.
 */
function firstMathOpener(s: string): number {
  for (let p = 0; p < s.length; p++) {
    const c = s[p];
    if (c === "\\") { p++; continue; }
    if (c !== "$") continue;
    const rest = s.slice(p);
    // Block maths needs a line start; the start of this text may be one.
    if ((p === 0 || s[p - 1] === "\n") && matchBlockMath(rest)) return p;
    const display = matchInlineDisplay(rest);
    if (display) { p += display.length - 1; continue; }
    if (matchInlineMath(rest)) return p;
  }
  return -1;
}

/**
 * Escape the dollars that would open maths, using the tokenizers' own rules.
 * Iterated to a fixpoint on the ESCAPED text: deciding each `$` independently
 * is unsound, because a backslash inserted before one `$` can let an earlier
 * one open a formula (`$$a$ b` escaped as `$\$a$ b` reads as maths `\$a`).
 * The fixpoint is what guarantees no maths remains; escaping the whole run of
 * dollars at once only keeps a pair readable (`\$\$`, not `$\$`).
 */
function escapeMathDollars(s: string): string {
  for (let guard = 0; guard < 256; guard++) {
    const p = firstMathOpener(s);
    if (p < 0) return s;
    let end = p;
    while (s[end] === "$") end++;
    let start = p;
    while (start > 0 && s[start - 1] === "$") start--;
    s = s.slice(0, start) + "\\$".repeat(end - start) + s.slice(end);
  }
  return s;
}

/**
 * Turndown's escaper plus what it does not cover. A text node reaches this
 * function holding LITERAL text; anything that would become markup when the
 * markdown is read back is escaped, or the next projection turns the text into
 * that markup: `Use &lt;br&gt;` came back as a real line break, text about
 * the `<details>` element became a Details node, `\$x\$` became a formula and
 * `1\) text` an ordered list. Only characters that would actually start a
 * construct are touched: `a < b`, `Tom & Jerry` and `$5` stay as typed.
 *
 * Like turndown's own `^` escapes, the line-start ones apply at the start of
 * the text node, which is where a line of a paragraph begins in practice.
 * (Known limit: a `$…$` or `~~…~~` pair split across two text nodes — one
 * dollar in plain text, the other after a bold word — is not seen as a pair.)
 */
export function escapeMarkdownText(text: string, opts: EscapeOptions = {}): string {
  let s = turndownEscape(text);
  // `<` that could open a tag, closing tag, comment or autolink.
  if (s.indexOf("<") !== -1) s = s.replace(/<(?=[A-Za-z/!?])/g, "\\<");
  // `&` that spells a character reference (`&lt;`, `&#60;`, `&#x3c;`).
  if (s.indexOf("&") !== -1) {
    s = s.replace(/&(?=#\d{1,7};|#[xX][0-9a-fA-F]{1,6};|[A-Za-z][A-Za-z0-9]{1,31};)/g, "\\&");
  }
  // `1)` opens an ordered list exactly as `1.` does; turndown escapes only the dot.
  s = s.replace(/^(\d{1,9})\)(?=[ \t]|$)/, "$1\\)");
  if (opts.strikethrough && s.indexOf("~~") !== -1) {
    s = s.replace(/~{2,}/g, (run) => "\\~".repeat(run.length));
  }
  if (opts.math && s.indexOf("$") !== -1) s = escapeMathDollars(s);
  if (opts.curly && s.indexOf("{") !== -1) {
    s = s.replace(/\{([^{}\n]+)\}/g, (group: string, inner: string) => (isCurlyGroup(inner) ? "\\" + group : group));
  }
  return s;
}

/** Install the engine's escaper; options are read per call (settings can change). */
export function installEscape(td: TurndownInstance, getOptions: () => EscapeOptions): TurndownInstance {
  (td as unknown as { escape(s: string): string }).escape = (s: string) => escapeMarkdownText(s, getOptions());
  return td;
}

export function addBaseRules(td: TurndownInstance): TurndownInstance {
  // Math: <span data-math-inline="x"> → $x$ ; <div data-math-block="x"> → $$x$$.
  // What is written must parse back as maths under math-marked's rules:
  // inline maths may not open or close on a space, a block may not contain a
  // blank line, and an empty formula is no formula at all.
  td.addRule("mathInline", {
    filter: (node) => {
      const el = node as Element;
      return el.nodeName === "SPAN" && el.getAttribute?.("data-math-inline") !== null;
    },
    replacement: (_content: string, node?: Node): string => {
      const latex = ((node as Element).getAttribute("data-math-inline") ?? "").replace(/\s*\n\s*/g, " ").trim();
      if (!latex) return "";
      // `$2x$1` is refused as money (see matchInlineMath); an empty comment
      // keeps the formula a formula without changing a visible character.
      const next = (node as Element).nextSibling?.textContent ?? "";
      return `$${latex}$` + (/^\d/.test(latex) && /^\d/.test(next) ? "<!---->" : "");
    },
  });
  td.addRule("mathBlock", {
    filter: (node) => {
      const el = node as Element;
      return el.nodeName === "DIV" && el.getAttribute?.("data-math-block") !== null;
    },
    replacement: (_content: string, node?: Node): string => {
      const latex = ((node as Element).getAttribute("data-math-block") ?? "").replace(/\n[ \t]*(?=\n)/g, "").trim();
      return latex ? `\n\n$$${latex}$$\n\n` : "";
    },
  });
  // ATX headings, as turndown writes them — except that a heading whose text
  // ENDS in ` #` must escape it: CommonMark reads a trailing `#` run after a
  // space as the optional closing sequence and drops it, so `C #` came back
  // as `C`.
  td.addRule("atxHeading", {
    filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
    replacement: (content: string, node?: Node): string => {
      const level = Number((node as Element).nodeName.charAt(1));
      const text = content.replace(/(^|[ \t])#(#*[ \t]*)$/, "$1\\#$2");
      return `\n\n${"#".repeat(level)} ${text}\n\n`;
    },
  });
  // Emoji: <span data-emoji="name">😄</span> → :name: (round-trips the shortcode).
  td.addRule("emoji", {
    filter: (node) => {
      const el = node as Element;
      return el.nodeName === "SPAN" && !!el.getAttribute?.("data-emoji");
    },
    replacement: (_content: string, node?: Node): string => {
      const el = node as Element;
      return `:${el.getAttribute("data-emoji")}:`;
    },
  });
  // Theme-aware images: <picture> with prefers-color-scheme sources round-trips
  // as raw HTML so it stays a real <picture> in the Markdown (GitHub-compatible).
  td.addRule("themeImagePicture", {
    filter: (node) => (node as Element).nodeName === "PICTURE",
    replacement: (_content: string, node?: Node): string => {
      const el = node as Element;
      // A picture that shares its paragraph with other content is INLINE (the
      // themeImage node is an inline atom) and is written in place — putting it
      // on its own lines split the paragraph in three on every projection.
      // Alone in its paragraph, it goes on its own lines.
      const parent = el.parentNode as Element | null;
      const shared =
        !!parent &&
        parent.nodeName === "P" &&
        Array.from(parent.childNodes).some((n) => n !== el && (n.nodeType !== 3 || /\S/.test(n.textContent ?? "")));
      return shared ? el.outerHTML : `\n\n${el.outerHTML}\n\n`;
    },
  });
  // Sized images keep their dimensions by serializing to an <img> HTML tag
  // (Markdown's ![](…) can't carry width/height). Plain images fall through to
  // Turndown's default image rule.
  td.addRule("sizedImage", {
    filter: (node) => {
      const el = node as Element;
      return el.nodeName === "IMG" && !!(el.getAttribute?.("width") || el.getAttribute?.("height"));
    },
    replacement: (_content: string, node?: Node): string => (node as Element).outerHTML,
  });
  td.addRule("underline", {
    filter: "u",
    replacement: (c) => `<u>${c}</u>`,
  });
  // Serialize sub/superscript as HTML tags (mirrors the <u> underline rule and
  // the MD pane's own <sub>/<sup> insertion). The old `~x~` / `^x^` output
  // collided with marked's strikethrough tokenizer — a subscript round-tripped
  // into <del>, and any stray `~` in prose was rendered as strikethrough.
  td.addRule("subscript", {
    filter: "sub",
    replacement: (c) => `<sub>${c}</sub>`,
  });
  td.addRule("superscript", {
    filter: "sup",
    replacement: (c) => `<sup>${c}</sup>`,
  });
  // Strikethrough. Turndown's CORE has no rule for <s>/<del>/<strike> — that
  // lives in turndown-plugin-gfm, which this project does not load — so the
  // element fell through to the default "keep the text, drop the tag" and the
  // formatting was SILENTLY DESTROYED on every rich→markdown projection.
  // TipTap's Strike renders <s>, so the toolbar's Strike button, ⌘⇧X and
  // Format ▸ Strikethrough all disappeared the moment the panes synced, and
  // fidelity.ts lists strike among the NATIVE marks, so nothing warned either.
  //
  // `~~` (never a single `~`) matches build-marked.ts, which deliberately
  // narrows marked's `del` tokenizer to the GitHub rule so a stray tilde in
  // prose is not strikethrough. An empty or whitespace-only body emits nothing:
  // `~~~~` would otherwise read as a code fence.
  td.addRule("strikethrough", {
    filter: ["s", "del", "strike"] as unknown as string[],
    replacement: (c: string) => (c.trim() ? `~~${c}~~` : c),
  });

  // True only when the <li> is ITSELF a task item — NOT when it merely CONTAINS a
  // nested task list. `querySelector` is recursive, so a plain parent `<li>` with a
  // nested taskList would otherwise match (and get a `- [ ]` marker / be excluded
  // from the tight-list rule). Prefer the authoritative `data-type="taskItem"`;
  // for pasted GFM (bare `<li><input type=checkbox>`), require the checkbox's
  // nearest ancestor `<li>` to be THIS element.
  const isTaskLi = (el: Element): boolean => {
    if (el.nodeName !== "LI") return false;
    if (el.getAttribute && el.getAttribute("data-type") === "taskItem") return true;
    const cb = el.querySelector && el.querySelector('input[type="checkbox"]');
    if (!cb) return false;
    const owner = (cb as Element).closest ? (cb as Element).closest("li") : el;
    return owner === el;
  };

  // A list item's already-converted content, laid out under its marker.
  //
  // `contentWidth` is the item's CONTENT COLUMN — the width of `- ` or `12. `
  // — and every continuation line is indented by exactly that. It is not the
  // marker's printed width: a task item prints `- [ ] ` (6) but its content
  // column is still 2, because `[ ]` is part of the item's first paragraph.
  // Indenting a task item's nested list by 6 put it 4 columns past that
  // column, where CommonMark reads it as a lazy continuation of the paragraph:
  // after one markdown edit the nested `- [x] b` became escaped literal text,
  // and nested ordered lists and code blocks collapsed the same way.
  //
  // Tight vs loose. TipTap wraps every item's text in <p>, which turndown
  // would print as a loose list, so a simple item (one paragraph, optionally
  // followed by nested lists) is printed tight. Only the blank line turndown
  // put BETWEEN that paragraph and its nested list goes — this used to delete
  // every blank line in the item, which merged two paragraphs into one and
  // removed blank lines from the middle of fenced code. An item holding more
  // than one block (two paragraphs, a paragraph and a code block, …) keeps its
  // blank lines, which is what makes it that item again on the way back in.
  const itemBody = (el: Element): Element => {
    // A TaskItem renders `<li><label>…</label><div>…content…</div></li>`.
    if (isTaskLi(el)) {
      for (const c of Array.from(el.children)) if (c.nodeName === "DIV") return c;
    }
    return el;
  };
  const LIST_TAGS = new Set(["UL", "OL"]);
  // Each list item's converted content, before layout (the footnote rules
  // below re-shape definition items and need it raw).
  const listItemContent = new WeakMap<Node, string>();
  const NON_BLOCK_CHILDREN = new Set(["LABEL", "INPUT", "BR"]);
  const isLooseItem = (el: Element): boolean => {
    let blocks = 0;
    let afterList = false;
    for (const c of Array.from(itemBody(el).children)) {
      if (LIST_TAGS.has(c.nodeName)) { afterList = true; continue; }
      if (NON_BLOCK_CHILDREN.has(c.nodeName) || !isBlockElement(c)) continue;
      blocks++;
      if (afterList || blocks > 1) return true;
    }
    return false;
  };
  const layoutListItem = (el: Element, content: string, marker: string, contentWidth: number): string => {
    content = content.replace(/^\n+/, "").replace(/\n+$/, "");
    // Tight: drop only the paragraph → nested-list separator (the first blank
    // run — a paragraph's own markdown never contains a blank line). Anything
    // deeper belongs to the nested items, which laid themselves out already.
    if (!isLooseItem(el)) content = content.replace(/\n{2,}/, "\n");
    if (content.includes("\n")) {
      const indent = " ".repeat(contentWidth);
      // Blank lines stay blank (not dropped: inside a fence they are code).
      content = content
        .split("\n")
        .map((line, i) => (i === 0 || line === "" ? line : indent + line))
        .join("\n");
    }
    return marker + content + "\n";
  };

  // Tiptap wraps every <li> content in <p> tags, which Turndown treats as "loose" lists
  // (adding blank lines between items). This rule produces tight list output instead.
  td.addRule("tightListItem", {
    filter: function (node: Node) {
      return (node as Element).nodeName === "LI" && !isTaskLi(node as Element);
    },
    replacement: function (content: string, node?: Node): string {
      const el = node as Element;
      const parent = el.parentNode;
      let prefix = "- ";
      if (parent && (parent as Element).nodeName === "OL") {
        // Honor the list's `start` attribute so a list beginning at e.g. 5
        // round-trips as `5.` instead of resetting to `1.`.
        const startAttr = (parent as Element).getAttribute("start");
        const start = startAttr ? parseInt(startAttr, 10) : 1;
        const base = Number.isFinite(start) ? start : 1;
        const idx = Array.from((parent as Element).children).indexOf(el);
        prefix = base + idx + ". ";
      }
      listItemContent.set(el, content);
      return layoutListItem(el, content, prefix, prefix.length);
    },
  });

  // Plain divs (no style/class) → treat as line break, not paragraph break
  td.addRule("plainDiv", {
    filter: (node) => {
      const el = node as Element;
      return (
        el.nodeName === "DIV" &&
        !el.getAttribute("style") &&
        !el.getAttribute("class") &&
        el.getAttribute("data-math-block") === null
      );
    },
    replacement: (content) => content + "\n",
  });

  // Task lists: TipTap TaskItem renders `<li data-type="taskItem"
  // data-checked="true|false"><label><input …><span/></label><div>…</div></li>`.
  // Prefer the authoritative `data-checked` attribute; fall back to a bare
  // `input[type=checkbox]` (pasted GFM). Nested content is laid out under the
  // item's CONTENT column (2, the width of "- ") — see layoutListItem.
  td.addRule("taskListItem", {
    filter: (node) => isTaskLi(node as Element),
    replacement: (content: string, node?: Node): string => {
      const el = node as Element;
      const dataChecked = el.getAttribute("data-checked");
      const checkbox = el.querySelector('input[type="checkbox"]');
      const checked =
        dataChecked != null
          ? dataChecked === "true" || dataChecked === ""
          : Boolean(checkbox && (checkbox as HTMLInputElement).checked);
      const text = content.replace(/^\s*\[[ x]\]\s*/i, "");
      return layoutListItem(el, text, `- [${checked ? "x" : " "}] `, 2);
    },
  });

  // Callouts: <div data-type="callout" data-callout="note">…</div> → > [!NOTE]\n> …
  // Added AFTER plainDiv so LIFO gives it priority (a callout div has no style/class,
  // so plainDiv's filter would otherwise capture it). The body is recursively
  // converted, then each line is blockquote-prefixed.
  td.addRule("callout", {
    filter: (node) => {
      const el = node as Element;
      return el.nodeName === "DIV" && el.getAttribute("data-type") === "callout";
    },
    replacement: (content: string, node?: Node): string => {
      const el = node as Element;
      const type = (el.getAttribute("data-callout") || "note").toUpperCase();
      const body = content.replace(/^\n+/, "").replace(/\n+$/, "").replace(/\n{3,}/g, "\n\n");
      const quoted = body
        .split("\n")
        .map((line) => (line.length ? `> ${line}` : ">"))
        .join("\n");
      return `> [!${type}]\n${quoted}\n\n`;
    },
  });

  // Collapsible <details><summary> — not Markdown, so round-trip as raw HTML.
  // marked passes a block-level <details>…</details> through untouched and the
  // Details/Summary nodes re-parse it. We emit the element's outerHTML verbatim
  // (like the <picture>/sized-image rules) so the disclosure structure + open
  // state survive losslessly; the MD pane shows the raw HTML for this block.
  //
  // A blank line ENDS an HTML block in markdown, so a blank line anywhere in
  // that outerHTML — typically inside a code block in the body — cut the block
  // short and the rest was read as markdown. A newline that starts a blank line
  // is written as `&#10;`: the same character once parsed (inside <pre> it is
  // still a newline; elsewhere it is whitespace), but no longer a blank line.
  td.addRule("detailsBlock", {
    filter: "details",
    replacement: (_content: string, node?: Node): string => {
      const el = node as Element;
      const html = (el.outerHTML || "").replace(/\n(?=[ \t]*\n)/g, "&#10;");
      return `\n\n${html}\n\n`;
    },
  });

  // Ordered list type preservation: <ol type="a"> → 1. (with comment noting type)
  td.addRule("orderedListType", {
    filter: (node) => {
      const el = node as Element;
      return el.nodeName === "OL" && !!el.getAttribute("type");
    },
    replacement: (content: string, node?: Node): string => {
      const el = node as Element;
      const type = el.getAttribute("type");
      return `<!-- list-type: ${type} -->\n${content}\n`;
    },
  });

  // Wiki links: <a data-doc-link="target">text</a> → [[target]] or [[target|text]]
  td.addRule("wikiLink", {
    filter: (node) => {
      const el = node as Element;
      // Presence, not truthiness: a same-document anchor ([[#Heading]]) has
      // data-doc-link="" (empty target), which is falsy but still a wiki link.
      return el.nodeName === "A" && (el.hasAttribute("data-doc-link") || el.hasAttribute("data-anchor"));
    },
    replacement: (content: string, node?: Node): string => wikiLinkMarkdown(content, node as Element),
  });

  // Front matter: <div data-type="frontmatter" data-frontmatter="<json>"> → ---\n…\n---
  td.addRule("frontmatter", {
    filter: (node) => {
      const el = node as Element;
      return el.nodeName === "DIV" && el.getAttribute("data-type") === "frontmatter";
    },
    replacement: (_content: string, node?: Node): string => {
      const el = node as Element;
      let raw = "";
      try {
        const data = el.getAttribute("data-frontmatter");
        if (data) raw = JSON.parse(data) as string;
      } catch {
        // ignore
      }
      return `---\n${raw}\n---\n\n`;
    },
  });

  // Field blocks: <div data-type="field-block" data-fields="[...]"> → :::fields ... :::
  td.addRule("fieldBlock", {
    filter: (node) => {
      const el = node as Element;
      return (
        el.nodeName === "DIV" &&
        el.getAttribute("data-type") === "field-block"
      );
    },
    replacement: (_content: string, node?: Node): string => {
      const el = node as Element;
      let fields: FieldEntry[] = [];
      try {
        const raw = el.getAttribute("data-fields");
        if (raw) fields = JSON.parse(raw) as FieldEntry[];
      } catch {
        // ignore
      }
      if (!fields.length) return "\n\n:::fields\n:::\n\n";
      const lines = fields.map((f) => `${f.key}: ${f.value ?? ""}`);
      return "\n\n:::fields\n" + lines.join("\n") + "\n:::\n\n";
    },
  });

  // Transclusion: <div data-type="transclusion" data-target="..." ...> → ![[target#section]]
  td.addRule("transclusion", {
    filter: (node) => {
      const el = node as Element;
      return (
        el.nodeName === "DIV" &&
        el.getAttribute("data-type") === "transclusion"
      );
    },
    replacement: (_content: string, node?: Node): string => {
      const el = node as Element;
      const target =
        el.getAttribute("data-target") ??
        el.getAttribute("target") ??
        "?";
      const section =
        el.getAttribute("data-section") ?? el.getAttribute("section");
      const blockId =
        el.getAttribute("data-block-id") ?? el.getAttribute("blockid");
      let ref = target;
      if (section) ref += "#" + section;
      if (blockId) ref += "#^" + blockId;
      return "\n\n![[" + ref + "]]\n\n";
    },
  });

  // Block IDs in comments: <!-- block-id:xxx --> after content → append ^xxx
  td.addRule("blockIdComment", {
    filter: (node) => {
      if (node.nodeType === 8) {
        const data = (node as Comment).data?.trim() ?? "";
        return /^block-id:/.test(data);
      }
      return false;
    },
    replacement: (_content: string, node?: Node): string => {
      const data = (node as Comment).data ?? "";
      const id = data.replace("block-id:", "").trim();
      return id ? ` ^${id}` : "";
    },
  });

  // --- GFM TABLE RULES ---
  const getCellAlign = (node: Element): string => {
    const style = (node.getAttribute("style") ?? "").toLowerCase();
    const attr = (node.getAttribute("align") ?? "").toLowerCase();
    return (
      style.match(/text-align:\s*(left|center|right)/)?.[1] ?? attr ?? ""
    );
  };

  // A cell's markdown is the one THIS conversion already produced for it (the
  // `gfmTableCell` rule below records it), so a cell gets every rule the rest
  // of the document gets — strikethrough, sized images, maths, wiki links, the
  // escaper, and the styled-span rule only in Styled mode. Cells used to be
  // re-converted by a separate, smaller rule set that silently dropped
  // strikethrough and image sizes (and kept colour spans even in Clean mode)
  // while fidelity reported the table lossless.
  const cellMarkdown = new WeakMap<Node, string>();
  const cellLine = (cell: Element): string =>
    (cellMarkdown.get(cell) ?? cell.textContent ?? "")
      .trim()
      // A GFM cell is one line: hard breaks and paragraph breaks become <br>,
      // which reads back as a hard break inside the cell.
      .replace(/ {2}\n/g, "\n")
      .replace(/\n+/g, "<br>")
      // Every pipe, including one inside a wiki-link alias or a code span: GFM
      // splits cells before it reads any inline syntax.
      .replace(/\|/g, "\\|");

  td.addRule("gfmTable", {
    filter: "table",
    replacement: function (_content: string, node?: Node): string {
      const table = node as HTMLTableElement;
      const rows: string[][] = [];
      const alignments: string[] = [];

      // `rows` / `cells`, not querySelectorAll: a nested table's rows are not
      // this table's rows.
      Array.from(table.rows ?? table.querySelectorAll("tr")).forEach((tr, ri) => {
        const cells: string[] = [];
        Array.from((tr as HTMLTableRowElement).cells ?? tr.querySelectorAll("th, td")).forEach((cell, ci) => {
          cells.push(cellLine(cell));
          if (ri === 0) alignments[ci] = getCellAlign(cell);
        });
        if (cells.length) rows.push(cells);
      });

      if (!rows.length) return "";

      const colCount = Math.max(...rows.map((r) => r.length));
      rows.forEach((row) => {
        while (row.length < colCount) row.push("");
      });
      while (alignments.length < colCount) alignments.push("");

      const widths = new Array(colCount).fill(3);
      rows.forEach((row) =>
        row.forEach((c, i) => {
          widths[i] = Math.max(widths[i], c.length);
        })
      );

      const sep = alignments.map((a, i) => {
        const w = widths[i];
        if (a === "center") return ":" + "-".repeat(Math.max(1, w - 2)) + ":";
        if (a === "right") return "-".repeat(Math.max(1, w - 1)) + ":";
        // Explicit left (`:--`) is not the same source as no alignment (`---`).
        if (a === "left") return ":" + "-".repeat(Math.max(1, w - 1));
        return "-".repeat(w);
      });

      const pad = (t: string, w: number): string =>
        t + " ".repeat(Math.max(0, w - t.length));
      const fmtRow = (r: string[]): string =>
        "| " + r.map((c, i) => pad(c, widths[i])).join(" | ") + " |";

      const lines: string[] = [];
      lines.push(fmtRow(rows[0]!));
      lines.push("| " + sep.join(" | ") + " |");
      for (let i = 1; i < rows.length; i++) lines.push(fmtRow(rows[i]!));

      return "\n\n" + lines.join("\n") + "\n\n";
    },
  });

  td.addRule("gfmTableSection", {
    filter: ["thead", "tbody", "tfoot", "caption", "colgroup", "col"],
    replacement: (c) => c,
  });
  td.addRule("gfmTableRow", { filter: "tr", replacement: () => "" });
  td.addRule("gfmTableCell", {
    filter: ["th", "td"],
    replacement: (content: string, node?: Node): string => {
      if (node) cellMarkdown.set(node, content);
      return "";
    },
  });

  // --- FOOTNOTES (marked-footnote) ---
  //
  // `A claim[^note]` renders as a superscript link to `#footnote-note`, and the
  // definitions as a "Footnotes" heading over an ordered list whose items each
  // end in a back-link to `#footnote-ref-note`. None of that is a node in the
  // schema, so one rich-pane keystroke used to rewrite the source into
  // `[<sup>1</sup>](#footnote-1)`, `## Footnotes` and a numbered list — no
  // longer footnotes anywhere. Both halves carry the LABEL in their hrefs, so
  // the markdown can be written back as it was.
  const FOOTNOTE_REF = /^#footnote-(?!ref-)(.+)$/;
  const FOOTNOTE_BACKREF = /^#footnote-ref-(.+)$/;
  const decodeLabel = (s: string): string => {
    try { return decodeURIComponent(s); } catch { return s; }
  };
  const backrefOf = (li: Element): Element | null => {
    for (const a of Array.from(li.querySelectorAll("a[href]"))) {
      if (FOOTNOTE_BACKREF.test(a.getAttribute("href") ?? "")) return a;
    }
    return null;
  };
  /** An <ol> of footnote definitions: every item carries a back-link. */
  const isFootnoteList = (el: Element | null): boolean =>
    !!el && el.nodeName === "OL" && el.children.length > 0 &&
    Array.from(el.children).every((li) => li.nodeName === "LI" && !!backrefOf(li));

  td.addRule("footnoteRef", {
    filter: (node) => {
      const el = node as Element;
      return el.nodeName === "A" && FOOTNOTE_REF.test(el.getAttribute("href") ?? "");
    },
    replacement: (_content: string, node?: Node): string =>
      `[^${decodeLabel(FOOTNOTE_REF.exec((node as Element).getAttribute("href") ?? "")![1]!)}]`,
  });
  // marked's own shape is <sup><a …>1</a></sup>; the rich pane's is <a><sup>.
  td.addRule("footnoteRefSup", {
    filter: (node) => {
      const el = node as Element;
      return (
        el.nodeName === "SUP" && el.children.length === 1 && el.children[0]!.nodeName === "A" &&
        FOOTNOTE_REF.test(el.children[0]!.getAttribute("href") ?? "") &&
        (el.textContent ?? "").trim() === (el.children[0]!.textContent ?? "").trim()
      );
    },
    replacement: (content: string): string => content,
  });
  // The back-links are regenerated by the renderer: never written out.
  td.addRule("footnoteBackref", {
    filter: (node) => {
      const el = node as Element;
      return el.nodeName === "A" && FOOTNOTE_BACKREF.test(el.getAttribute("href") ?? "");
    },
    replacement: (): string => "",
  });
  // The generated heading goes with the list it introduces.
  td.addRule("footnoteHeading", {
    filter: (node) => {
      const el = node as Element;
      return el.nodeName === "H2" && (el.textContent ?? "").trim() === "Footnotes" &&
        isFootnoteList(el.nextElementSibling);
    },
    replacement: (): string => "",
  });
  td.addRule("footnoteDefinitions", {
    filter: (node) => isFootnoteList(node as Element),
    replacement: (_content: string, node?: Node): string => {
      const defs = Array.from((node as Element).children).map((li) => {
        const label = decodeLabel(FOOTNOTE_BACKREF.exec(backrefOf(li)!.getAttribute("href") ?? "")![1]!);
        const body = (listItemContent.get(li) ?? li.textContent ?? "").replace(/^\n+/, "").replace(/\s+$/, "");
        // Continuation lines of a definition are indented four spaces.
        const text = body
          .split("\n")
          .map((line, i) => (i === 0 || line === "" ? line : "    " + line))
          .join("\n");
        return `[^${label}]: ${text}`;
      });
      return "\n\n" + defs.join("\n") + "\n\n";
    },
  });

  return td;
}

/**
 * A style value, ready for a double-quoted attribute. The CSSOM serializes a
 * font name with DOUBLE quotes — `font-family: "Courier New", monospace`, the
 * toolbar's own Mono font — and interpolating that raw closed the attribute
 * early: the next pass showed the rest of the tag as text and the font was
 * gone. Inner double quotes become single quotes (the same CSS, and readable
 * in the markdown pane); `&quot;` only when the value already holds a `'`.
 */
export function styleAttrValue(style: string): string {
  const s = style.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return s.includes("'") ? s.replace(/"/g, "&quot;") : s.replace(/"/g, "'");
}

export function addInlineStyleRule(td: TurndownInstance): TurndownInstance {
  td.addRule("styledElementsInline", {
    filter: (node) => {
      const el = node as Element;
      return Boolean(
        (el.nodeName === "SPAN" || el.nodeName === "DIV") &&
        el.getAttribute?.("style")
      );
    },
    replacement: (content: string, node?: Node): string => {
      const el = node as Element;
      const tag = el.nodeName.toLowerCase();
      const style = styleAttrValue(el.getAttribute("style") ?? "");
      if (tag === "div")
        return `<div style="${style}">\n${content}\n</div>\n`;
      return `<span style="${style}">${content}</span>`;
    },
  });
  return td;
}
