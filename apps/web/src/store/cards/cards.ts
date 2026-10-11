/**
 * Cards view — pure helpers.
 *
 * The Cards view is a Google-Keep-style board over the WHOLE library: every
 * document is a card. This module holds the logic (preview extraction,
 * checklist extraction, colour/pin metadata, sort/filter) with NO React and no
 * store access, so it is unit-testable and cheap to call while rendering.
 *
 * Per-card presentation state lives in `DocumentRecord.metadata` under the
 * reserved keys below — deliberately NOT new top-level record fields, so the
 * document schema, the storage adapter, and the save path stay untouched.
 */

import { t } from "@/i18n/core";

/** Metadata keys owned by the Cards view. */
export const CARD_COLOR_KEY = "cardColor";
export const CARD_PINNED_KEY = "cardPinned";

export type CardColorId =
  | "default"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "teal"
  | "blue"
  | "purple"
  | "pink";

/**
 * Keep-style note colours. Each entry carries an explicit light and dark value
 * rather than one colour at low opacity: a translucent tint would collapse to
 * the page background in the old in-app WebViews that don't support
 * `color-mix`/alpha compositing predictably (see the styles.css fallback), and
 * these cards must stay readable there — a first-time user often sees the app
 * inside WhatsApp/Slack/Telegram.
 */
export const CARD_COLORS: {
  id: CardColorId;
  label: string;
  light: string;
  dark: string;
}[] = [
  { id: "default", get label() { return t("cards.colorDefault"); }, light: "", dark: "" },
  { id: "red", get label() { return t("cards.colorCoral"); }, light: "#faafa8", dark: "#77172e" },
  { id: "orange", get label() { return t("cards.colorPeach"); }, light: "#f39f76", dark: "#692b17" },
  { id: "yellow", get label() { return t("cards.colorSand"); }, light: "#fff8b8", dark: "#7c4a03" },
  { id: "green", get label() { return t("cards.colorSage"); }, light: "#e2f6d3", dark: "#264d3b" },
  { id: "teal", get label() { return t("cards.colorMint"); }, light: "#b4ddd3", dark: "#0c625d" },
  { id: "blue", get label() { return t("cards.colorFog"); }, light: "#d4e4ed", dark: "#256377" },
  { id: "purple", get label() { return t("cards.colorDusk"); }, light: "#d3bfdb", dark: "#472e5b" },
  { id: "pink", get label() { return t("cards.colorBlossom"); }, light: "#f6e2dd", dark: "#6c394f" },
];

const COLOR_IDS = new Set(CARD_COLORS.map((c) => c.id));

export interface CardDocLike {
  id: string;
  title?: string;
  updated?: string;
  created?: string;
  metadata?: Record<string, unknown> | null;
}

/** The card's colour id, defaulting (and self-healing from bad data) to "default". */
export function getCardColor(doc: CardDocLike | null | undefined): CardColorId {
  const raw = doc?.metadata?.[CARD_COLOR_KEY];
  return typeof raw === "string" && COLOR_IDS.has(raw as CardColorId)
    ? (raw as CardColorId)
    : "default";
}

/** Resolve a colour id to a concrete CSS colour, or "" for the default surface. */
export function cardColorValue(id: CardColorId, isDark: boolean): string {
  const entry = CARD_COLORS.find((c) => c.id === id);
  if (!entry) return "";
  return isDark ? entry.dark : entry.light;
}

export function isCardPinned(doc: CardDocLike | null | undefined): boolean {
  return doc?.metadata?.[CARD_PINNED_KEY] === true;
}

// ── Content extraction ───────────────────────────────────────────────────────

interface PMMarkLike {
  type?: string;
  attrs?: Record<string, unknown> | null;
}

interface PMNodeLike {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown> | null;
  marks?: PMMarkLike[] | null;
  content?: PMNodeLike[] | null;
}

/** Concatenate the text of a ProseMirror subtree. */
function nodeText(node: PMNodeLike | null | undefined): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  const kids = node.content;
  if (!Array.isArray(kids)) return "";
  let out = "";
  let pendingSep = false;
  for (const k of kids) {
    const isText = typeof k?.text === "string";
    const t = nodeText(k);
    if (!t) {
      // A node that carries no text of its own can still SEPARATE text — a
      // hardBreak is the line break between "line1" and "line2". Without this
      // a three-line note previewed as "line1line2line3".
      if (!isText && out) pendingSep = true;
      continue;
    }
    // Adjacent TEXT nodes are one run of prose ("Hello " + "world") and must
    // not gain a space. Nested BLOCKS are separate lines and must — without
    // this a four-item list previewed as "milkeggsbreadcoffee".
    if (out && (pendingSep || !isText)) out += " ";
    pendingSep = false;
    out += t;
  }
  return out;
}

/**
 * A short plain-text preview of the document body.
 *
 * Skips the leading H1 when it is what the card is already showing as its
 * title, so the card doesn't print the same string twice. Blocks are joined
 * with a space and whitespace is collapsed, then hard-truncated at `maxChars`
 * on a word boundary where possible.
 *
 * `skipTasks` drops task lists, for the same don't-say-it-twice reason: a card
 * with a checklist renders the items as real tick-boxes, so repeating them as
 * a prose blob above is pure duplication. Search still wants the whole text,
 * so the board keeps an unfiltered copy for its haystack.
 */
export function cardPreview(
  canonical: unknown,
  title?: string,
  maxChars = 220,
  opts?: { skipTasks?: boolean }
): string {
  const root = canonical as PMNodeLike | null | undefined;
  const blocks = root?.content;
  if (!Array.isArray(blocks) || blocks.length === 0) return "";

  const parts: string[] = [];
  let skippedTitle = false;
  for (const block of blocks) {
    if (!block) continue;
    if (opts?.skipTasks && block.type === "taskList") continue;
    const text = nodeText(block).trim();
    if (!text) continue;
    if (
      !skippedTitle &&
      block.type === "heading" &&
      title &&
      text.toLowerCase() === title.trim().toLowerCase()
    ) {
      skippedTitle = true;
      continue;
    }
    parts.push(text);
    // Enough material to fill the preview — stop walking a 5000-block document.
    if (parts.join(" ").length > maxChars * 2) break;
  }

  const flat = parts.join("  ").replace(/\s+/g, " ").trim();
  if (flat.length <= maxChars) return flat;
  const cut = flat.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** The inline marks we render on a preview, mapped to a safe tag. `link` is
 *  rendered as an `<a>` with NO href — it takes the `[data-md-preview] a` colour
 *  but cannot navigate, which is what we want inside a card that is itself a
 *  button (a real href would steal the click). Anything else (textStyle colour,
 *  highlight, …) is ignored for the preview — it is a teaser, not the document. */
const MARK_TAG: Record<string, string> = {
  bold: "strong",
  strong: "strong",
  italic: "em",
  em: "em",
  code: "code",
  strike: "s",
  strikethrough: "s",
  underline: "u",
  link: "a",
};

/** Render a text node's marks around its (escaped) text. */
function inlineHtml(node: PMNodeLike): string {
  if (typeof node.text !== "string") {
    // A non-text inline node. If it carries text (emoji, inline math) keep it;
    // if it does not (a hardBreak), emit a SPACE — otherwise the words on either
    // side of a line break run together ("move" + <br> + "fast" → "movefast").
    const t = nodeText(node);
    return t ? escapeHtml(t) : " ";
  }
  let html = escapeHtml(node.text);
  const marks = node.marks;
  if (Array.isArray(marks)) {
    // Innermost first so nesting reads correctly (bold inside a link, etc.).
    for (const m of marks) {
      const tag = m?.type ? MARK_TAG[m.type] : undefined;
      if (tag) html = `<${tag}>${html}</${tag}>`;
    }
  }
  return html;
}

/** Render the inline children of a block. */
function inlineChildren(node: PMNodeLike): string {
  const kids = node.content;
  if (!Array.isArray(kids)) return "";
  return kids.map((k) => (k ? inlineHtml(k) : "")).join("");
}

/**
 * A RENDERED (not plain-text) preview of the document body, as a bounded,
 * self-contained HTML string.
 *
 * The card face used to print flat text — a heading, a bold word and a bullet
 * list all collapsed to one grey run — so a reader could not tell a title from a
 * paragraph from a list without opening the note. This walks the same top-level
 * blocks `cardPreview` does and emits real structure (headings, paragraphs,
 * lists, quotes, code) with inline marks, so the face reads like the document.
 *
 * It is PURE and CHEAP on purpose — no marked, no `generateHTML` (which would
 * build a ProseMirror schema per card, per search keystroke). The output is
 * meant to sit inside a `[data-md-preview]` container so it inherits the exact
 * heading/list/quote/code styling the rich pane's preview uses. Every text run
 * is escaped; the only tags emitted are a fixed structural whitelist.
 *
 * Bounded three ways: it skips the title heading and (optionally) task lists,
 * stops after `maxBlocks` blocks, and stops once the accumulated text passes
 * `maxChars` — so a 5000-block document costs a handful of nodes.
 */
export function cardPreviewHtml(
  canonical: unknown,
  title?: string,
  opts?: { skipTasks?: boolean; maxBlocks?: number; maxChars?: number }
): string {
  const root = canonical as PMNodeLike | null | undefined;
  const blocks = root?.content;
  if (!Array.isArray(blocks) || blocks.length === 0) return "";

  const maxBlocks = opts?.maxBlocks ?? 8;
  const maxChars = opts?.maxChars ?? 320;
  const out: string[] = [];
  let chars = 0;
  let skippedTitle = false;
  let emitted = 0;

  const listItems = (node: PMNodeLike, ordered: boolean): string => {
    const items = (node.content ?? [])
      .filter((li): li is PMNodeLike => !!li)
      .slice(0, 6)
      .map((li) => {
        // A list item's inline text lives in its child paragraph(s).
        const inner = (li.content ?? [])
          .map((child) => (child ? inlineChildren(child) : ""))
          .filter(Boolean)
          .join(" ");
        return `<li>${inner}</li>`;
      })
      .join("");
    return `<${ordered ? "ol" : "ul"}>${items}</${ordered ? "ol" : "ul"}>`;
  };

  for (const block of blocks) {
    if (!block) continue;
    if (emitted >= maxBlocks || chars > maxChars) break;
    const type = block.type;
    if (opts?.skipTasks && type === "taskList") continue;

    const text = nodeText(block).trim();
    if (!text && type !== "horizontalRule") continue;

    if (
      !skippedTitle &&
      type === "heading" &&
      title &&
      text.toLowerCase() === title.trim().toLowerCase()
    ) {
      skippedTitle = true;
      continue;
    }

    switch (type) {
      case "heading": {
        const level = Math.min(6, Math.max(1, Number(block.attrs?.["level"]) || 2));
        out.push(`<h${level}>${inlineChildren(block)}</h${level}>`);
        break;
      }
      case "bulletList":
        out.push(listItems(block, false));
        break;
      case "orderedList":
        out.push(listItems(block, true));
        break;
      case "taskList":
        // Rendered as a plain bullet list on the face; the real tick-boxes are
        // drawn by the card component from `cardChecklist`.
        out.push(listItems(block, false));
        break;
      case "blockquote":
        out.push(`<blockquote>${escapeHtml(text)}</blockquote>`);
        break;
      case "codeBlock":
        out.push(`<pre><code>${escapeHtml(text.slice(0, 200))}</code></pre>`);
        break;
      case "horizontalRule":
        out.push("<hr>");
        break;
      default:
        out.push(`<p>${inlineChildren(block) || escapeHtml(text)}</p>`);
    }
    emitted += 1;
    chars += text.length;
  }

  return out.join("");
}

export interface CardChecklistItem {
  text: string;
  checked: boolean;
}

export interface CardChecklist {
  items: CardChecklistItem[];
  /** Items beyond `max` that were not returned (rendered as "+N more"). */
  overflow: number;
  total: number;
  done: number;
}

/**
 * Extract task-list items so a to-do document renders as a real checklist on
 * its card (the thing that makes Keep feel like Keep). Walks the whole tree so
 * nested task lists and tasks inside other blocks are still found.
 */
export function cardChecklist(canonical: unknown, max = 6): CardChecklist {
  const found: CardChecklistItem[] = [];

  const walk = (node: PMNodeLike | null | undefined) => {
    if (!node) return;
    if (node.type === "taskItem") {
      found.push({
        text: nodeText(node).trim(),
        checked: node.attrs?.["checked"] === true,
      });
      // Keep walking: nested task items live inside this one.
    }
    const kids = node.content;
    if (Array.isArray(kids)) for (const k of kids) walk(k);
  };
  walk(canonical as PMNodeLike | null | undefined);

  const done = found.filter((i) => i.checked).length;
  const capped = max >= 0 ? found.slice(0, max) : found;
  return {
    items: capped,
    overflow: Math.max(0, found.length - capped.length),
    total: found.length,
    done,
  };
}

// ── Sorting & filtering ──────────────────────────────────────────────────────

function timeOf(doc: CardDocLike): number {
  const t = Date.parse(doc.updated || doc.created || "");
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Pinned cards first, then most-recently-updated. Stable for equal timestamps
 * (falls back to id) so the grid doesn't reshuffle between renders — a jumping
 * masonry board is disorienting and makes cards hard to click.
 */
export function sortCards<T extends CardDocLike>(docs: T[]): T[] {
  return [...docs].sort((a, b) => {
    const pa = isCardPinned(a) ? 1 : 0;
    const pb = isCardPinned(b) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const ta = timeOf(a);
    const tb = timeOf(b);
    if (ta !== tb) return tb - ta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Case-insensitive match over the card's visible text (title + whatever
 * preview/haystack the caller supplies). An empty/whitespace query matches
 * everything rather than nothing.
 */
export function filterCards<T extends CardDocLike>(
  docs: T[],
  query: string,
  haystackFor?: (doc: T) => string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return docs;
  return docs.filter((d) => {
    const extra = haystackFor ? haystackFor(d) : "";
    return ((d.title || "") + " " + extra).toLowerCase().includes(q);
  });
}

/** Split a sorted list into its pinned and unpinned sections for the board. */
export function partitionPinned<T extends CardDocLike>(
  docs: T[]
): { pinned: T[]; others: T[] } {
  const pinned: T[] = [];
  const others: T[] = [];
  for (const d of docs) (isCardPinned(d) ? pinned : others).push(d);
  return { pinned, others };
}

// ── Keeping the board in step with the library ───────────────────────────────

/**
 * What a card needs reloading on: its edit time AND the presentation metadata
 * the board draws. Pin and colour are written with `touchUpdated: false` (so a
 * pinned note does not jump the board as if it had been edited), which means
 * `updated` alone never changes for them — keyed on `id:updated`, the board
 * never noticed a pin or a colour change until it was reopened (A056). A
 * listing that carries no metadata simply contributes the defaults.
 */
export function cardSyncSignature(doc: CardDocLike): string {
  return `${doc.updated ?? ""}|${isCardPinned(doc) ? 1 : 0}|${getCardColor(doc)}`;
}

/**
 * Which cards to (re)load and which to drop, given the library listing and the
 * signature each loaded card was read at. The board used to reload EVERY
 * document on any change and blank itself to skeletons while it did (A087);
 * only new or changed cards are read now, and merged in place.
 */
export function planCardReload(
  docs: readonly CardDocLike[],
  loadedSignatures: ReadonlyMap<string, string>
): { load: string[]; drop: string[] } {
  const load: string[] = [];
  const present = new Set<string>();
  for (const d of docs) {
    present.add(d.id);
    if (loadedSignatures.get(d.id) !== cardSyncSignature(d)) load.push(d.id);
  }
  const drop = [...loadedSignatures.keys()].filter((id) => !present.has(id));
  return { load, drop };
}

// ── Quick capture ────────────────────────────────────────────────────────────

/**
 * Compose the markdown for a quick-captured note.
 *
 * The composer is deliberately low-ceremony: a title line and a body. The title
 * becomes an H1 so the existing title-derivation path (`resolveDocTitle` reading
 * the first heading) names the document — no separate rename call, and the note
 * reads correctly in the Markdown pane and every export.
 *
 * In list mode each non-empty body line becomes a `- [ ]` task so the card
 * immediately renders as a checklist.
 */
export function composeNoteMarkdown(
  title: string,
  body: string,
  asChecklist = false
): string {
  const t = title.trim();
  const lines = body.split("\n");
  let bodyOut: string;

  if (asChecklist) {
    bodyOut = lines
      .map((l) => {
        const s = l.trim();
        if (!s) return "";
        // Don't double-prefix a line the user already wrote as a task.
        return /^[-*]\s*\[[ xX]\]\s+/.test(s) ? s : `- [ ] ${s}`;
      })
      .filter(Boolean)
      .join("\n");
  } else {
    bodyOut = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  const parts: string[] = [];
  if (t) parts.push(`# ${t}`);
  if (bodyOut) parts.push(bodyOut);
  return parts.join("\n\n");
}

/** True when the composer holds nothing worth saving. */
export function isEmptyCapture(title: string, body: string): boolean {
  return !title.trim() && !body.trim();
}
