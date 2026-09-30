/**
 * Renaming a heading keeps the links to it working (backlog #122).
 *
 * `[[Doc#Heading]]` and `[[#Heading]]` resolve by the heading's TEXT
 * (findHeadingByAnchor), so renaming a heading silently broke every link that
 * pointed at it. This module is the pure half of the fix:
 *
 *   1. `alignHeadingRenames` — which headings of a document were RENAMED,
 *      comparing the heading list the document was opened with against the
 *      current one;
 *   2. `countHeadingLinks` — how many links in a document point at those old
 *      headings, judged by THE resolver (createWikiResolver) so a link is
 *      counted exactly when a click on it would have gone there;
 *   3. `rewriteHeadingLinks` / `buildHeadingLinkTransaction` — retarget those
 *      links, in a stored document's canonical JSON or as one undoable
 *      ProseMirror transaction in the live editor.
 *
 * Nothing here decides WHEN to rewrite; the editor asks first
 * (editor/useHeadingRenameLinks.ts). Both link forms are handled, because
 * scanWikiLinks reads both: rendered link marks (`docLink` / `anchor` attrs)
 * and literal `[[…]]` text that has not been rendered.
 */
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { normalizeHeadingAnchor } from "./doc-outline";
import type { WikiResolution } from "./link-index";
import { parseWikiInner } from "../engine/wiki-link-marked";

export interface HeadingInfo {
  level: number;
  text: string;
}

export interface HeadingRename {
  /** The heading's text when the document was opened (what links point at). */
  oldText: string;
  /** Its text now — the anchor the links are retargeted to. */
  newText: string;
  level: number;
  /** Positions in the two heading lists (document order). */
  oldIndex: number;
  newIndex: number;
}

// ─── Anchors ──────────────────────────────────────────────────────────────────

/**
 * The identity a link anchor and a heading share when findHeadingByAnchor
 * would match them: the normalised anchor, or — for text with no letters or
 * digits at all, which normalises to "" — the exact (NFKC, trimmed) text. ""
 * means "matches nothing".
 */
export function headingAnchorKey(text: string): string {
  const n = normalizeHeadingAnchor(text);
  if (n) return `n:${n}`;
  const raw = text.normalize("NFKC").trim();
  return raw ? `r:${raw}` : "";
}

/**
 * Whether a link can carry `text` as its anchor. `[[Doc#A|B]]` splits at the
 * first pipe and `[[…]]` cannot contain brackets or a line break — the same
 * reason titles holding `|` or `]` cannot be linked. Such a rename is never
 * offered: the rewritten link would not survive its next markdown round trip.
 */
export function isLinkableAnchor(text: string): boolean {
  return !!headingAnchorKey(text) && !/[[\]|\n\r]/.test(text);
}

// ─── Heading lists ───────────────────────────────────────────────────────────

interface JsonNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: JsonMark[];
  content?: JsonNode[];
}
interface JsonMark {
  type?: string;
  attrs?: Record<string, unknown>;
}

function jsonText(node: JsonNode): string {
  if (typeof node.text === "string") return node.text;
  return Array.isArray(node.content) ? node.content.map(jsonText).join("") : "";
}

const levelOf = (v: unknown) => Math.min(6, Math.max(1, Number(v) || 1));

/**
 * Headings of a canonical (PM JSON) document, in document order — the same
 * walk as extractHeadings, but with the RAW text: extractHeadings shows an
 * empty heading as "(untitled)", which a real heading could also be called.
 */
export function headingsFromCanonical(canonical: unknown): HeadingInfo[] {
  const out: HeadingInfo[] = [];
  const visit = (nodes: JsonNode[] | undefined) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (node?.type === "heading") out.push({ level: levelOf(node.attrs?.["level"]), text: jsonText(node).trim() });
      else visit(node?.content);
    }
  };
  visit((canonical as JsonNode | null)?.content);
  return out;
}

/**
 * Headings of the LIVE document. Descends only into containers (lists,
 * quotes, callouts, tables…) and never into a textblock's inline content, so
 * it costs one step per block, not per character.
 */
export function headingsFromDoc(doc: PMNode): HeadingInfo[] {
  const out: HeadingInfo[] = [];
  doc.descendants((node) => {
    if (node.type.name === "heading") {
      let text = "";
      node.descendants((n) => { if (n.isText) text += n.text; });
      out.push({ level: levelOf(node.attrs["level"]), text: text.trim() });
      return false;
    }
    return !node.isTextblock && !node.isLeaf;
  });
  return out;
}

// ─── Which headings were renamed ─────────────────────────────────────────────

/** Past this many cells in one comparison table, give up rather than stall
 *  the editor — a change that large is a rewrite, not a rename. */
const MAX_TABLE = 250_000;

/** Longest common subsequence of two key lists, as index pairs. */
function lcsPairs(a: string[], b: string[]): [number, number][] | null {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return [];
  if (n * m > MAX_TABLE) return null;
  // dp[i][j] = LCS length of a[i..] and b[j..], flattened.
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j]
        ? dp[(i + 1) * w + j + 1]! + 1
        : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!);
    }
  }
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++; }
    else if (dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!) i++;
    else j++;
  }
  return out;
}

/**
 * Which headings were renamed between `before` (the document as it was
 * opened) and `after` (now).
 *
 *  - Headings whose normalised anchor is unchanged are FIXED POINTS (the
 *    longest common subsequence of the two anchor lists), so headings added
 *    or deleted elsewhere do not shift what pairs with what.
 *  - Between two fixed points, the remaining old and new headings are paired
 *    IN ORDER, and only at the same level: an H2 becoming an H3 is a
 *    restructure, not a rename.
 *
 * A pair is a rename only when links to the old text would now be broken and
 * retargeting them would be correct:
 *  - the OLD anchor exists nowhere in the document any more (if it does, the
 *    links still resolve);
 *  - the old heading was the FIRST with that anchor (a link resolves to the
 *    first match, so only that one's rename moves where links go);
 *  - the NEW heading is the first with ITS anchor (otherwise a retargeted
 *    link would land on an earlier heading of the same name);
 *  - the new text can be written in a link (isLinkableAnchor).
 */
export function alignHeadingRenames(before: readonly HeadingInfo[], after: readonly HeadingInfo[]): HeadingRename[] {
  const bk = before.map((h) => headingAnchorKey(h.text));
  const ak = after.map((h) => headingAnchorKey(h.text));

  // Fixed points: the common prefix and suffix first (a rename leaves almost
  // every heading in place, so this usually leaves one heading on each side),
  // then the longest common subsequence of what remains.
  let lo = 0;
  while (lo < bk.length && lo < ak.length && bk[lo] === ak[lo]) lo++;
  let bEnd = bk.length;
  let aEnd = ak.length;
  while (bEnd > lo && aEnd > lo && bk[bEnd - 1] === ak[aEnd - 1]) { bEnd--; aEnd--; }
  const middle = lcsPairs(bk.slice(lo, bEnd), ak.slice(lo, aEnd));
  if (!middle) return [];
  const fixed: [number, number][] = [
    [lo - 1, lo - 1],
    ...middle.map(([i, j]) => [i + lo, j + lo] as [number, number]),
    [bEnd, aEnd],
  ];

  const pairs: [number, number][] = [];
  for (let f = 0; f + 1 < fixed.length; f++) {
    const [bi, ai] = fixed[f]!;
    const [bNext, aNext] = fixed[f + 1]!;
    let next = ai + 1;
    for (let i = bi + 1; i < bNext; i++) {
      const level = before[i]!.level;
      for (let j = next; j < aNext; j++) {
        if (after[j]!.level === level) { pairs.push([i, j]); next = j + 1; break; }
      }
    }
  }

  const afterKeys = new Set(ak);
  const firstBefore = new Map<string, number>();
  bk.forEach((k, i) => { if (!firstBefore.has(k)) firstBefore.set(k, i); });
  const firstAfter = new Map<string, number>();
  ak.forEach((k, j) => { if (!firstAfter.has(k)) firstAfter.set(k, j); });

  const out: HeadingRename[] = [];
  for (const [i, j] of pairs) {
    const oldKey = bk[i]!;
    const newKey = ak[j]!;
    if (!oldKey || oldKey === newKey) continue;
    if (afterKeys.has(oldKey)) continue;
    if (firstBefore.get(oldKey) !== i || firstAfter.get(newKey) !== j) continue;
    if (!isLinkableAnchor(after[j]!.text)) continue;
    out.push({ oldText: before[i]!.text, newText: after[j]!.text, level: after[j]!.level, oldIndex: i, newIndex: j });
  }
  return out;
}

/**
 * The baseline after `renames` were offered (accepted or not): each renamed
 * heading now counts as having its new text, so the same rename is never
 * offered twice — and a rename nobody was asked about still is.
 */
export function rebaselineHeadings(baseline: readonly HeadingInfo[], renames: readonly Pick<HeadingRename, "oldText" | "newText">[]): HeadingInfo[] {
  const next = baseline.map((h) => ({ ...h }));
  for (const r of renames) {
    const key = headingAnchorKey(r.oldText);
    const i = next.findIndex((h) => headingAnchorKey(h.text) === key);
    if (i >= 0) next[i] = { ...next[i]!, text: r.newText };
  }
  return next;
}

// ─── Links that point at a renamed heading ───────────────────────────────────

export interface HeadingLinkScope {
  /** The document being scanned — where a `[[#Heading]]` anchor points. */
  sourceDocId: string;
  /** The document whose headings were renamed. */
  subjectDocId: string;
  /** THE resolver (createWikiResolver) over the library. */
  resolve: (docLink: string, anchor?: string | null) => WikiResolution | null;
  /** Old anchor key (headingAnchorKey) → the heading's new text. */
  renames: ReadonlyMap<string, string>;
}

/** The renames as a scope's lookup table. */
export function renameTable(renames: readonly Pick<HeadingRename, "oldText" | "newText">[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of renames) {
    const key = headingAnchorKey(r.oldText);
    if (key && !map.has(key)) map.set(key, r.newText);
  }
  return map;
}

/**
 * Where a link to `docLink#anchor` found in the scope's source document
 * should now point — the renamed heading's new text — or null when it does
 * not point at a renamed heading of the subject. The resolver decides, so a
 * `[[C# Tips]]` that names a whole title is never mistaken for a heading link.
 */
function retarget(docLink: string, anchor: string, scope: HeadingLinkScope): { key: string; to: string } | null {
  const key = headingAnchorKey(anchor);
  const to = scope.renames.get(key);
  if (to === undefined) return null;
  if (!docLink.trim()) return scope.sourceDocId === scope.subjectDocId ? { key, to } : null;
  // `anchor: null` — the whole `docLink#anchor` is a title, not a heading.
  const r = scope.resolve(docLink, anchor);
  return r && r.id === scope.subjectDocId && r.anchor != null ? { key, to } : null;
}

/** A link mark that is a wiki link (a plain link carries `docLink: null`). */
function isWikiMark(m: JsonMark | undefined): m is JsonMark {
  if (!m || (m.type !== "link" && m.type !== "wikiLink") || !m.attrs) return false;
  const a = m.attrs;
  return a["docLink"] != null || (typeof a["anchor"] === "string" && a["anchor"] !== "");
}
const isAnyLinkMark = (m: JsonMark) => m.type === "link" || m.type === "wikiLink";
const sameMark = (a: JsonMark, b: JsonMark) => a.type === b.type && JSON.stringify(a.attrs) === JSON.stringify(b.attrs);

// The wiki-link tokenizer's own pattern (engine/wiki-link-marked.ts): what
// becomes a link when the markdown is rendered.
const LITERAL_RE = /\[\[([^[\]\n]+)\]\]/g;

interface InlineResult {
  content: JsonNode[];
  /** Links rewritten (or that would be, when counting), by old anchor key. */
  byKey: Map<string, number>;
}

/**
 * Rewrite the links in one inline content array (a textblock's children).
 * Returns null when nothing in it points at a renamed heading.
 */
function rewriteInline(content: JsonNode[], scope: HeadingLinkScope): InlineResult | null {
  const byKey = new Map<string, number>();
  const bump = (k: string) => byKey.set(k, (byKey.get(k) ?? 0) + 1);
  const out: JsonNode[] = [];
  let changed = false;

  for (let i = 0; i < content.length; i++) {
    const node = content[i]!;
    if (node.type !== "text" || typeof node.text !== "string") { out.push(node); continue; }
    const link = node.marks?.find(isWikiMark);

    if (link) {
      // One link is the run of adjacent text nodes carrying the same mark
      // (part of its text may be bold, say).
      let end = i + 1;
      while (end < content.length) {
        const n = content[end]!;
        if (n.type !== "text" || !n.marks?.some((m) => sameMark(m, link))) break;
        end++;
      }
      const run = content.slice(i, end);
      i = end - 1;
      const attrs = link.attrs!;
      const docLinkAttr = attrs["docLink"] == null ? "" : String(attrs["docLink"]);
      const anchorAttr = typeof attrs["anchor"] === "string" ? attrs["anchor"].trim() : "";
      // A `docLink` holding "#" and no anchor (not what the renderer writes,
      // but what scanWikiLinks accepts) is split the way the renderer would.
      let target = docLinkAttr;
      let anchor = anchorAttr;
      if (!anchor && target.includes("#")) {
        const h = target.indexOf("#");
        anchor = target.slice(h + 1).trim();
        target = target.slice(0, h).trim();
      }
      const hit = retarget(target, anchor, scope);
      if (!hit) { out.push(...run); continue; }
      bump(hit.key);
      changed = true;
      const newDocLink = anchorAttr ? docLinkAttr : target;
      const nextMark: JsonMark = { ...link, attrs: { ...attrs, docLink: newDocLink, anchor: hit.to } };
      // The visible text follows the target only when it IS the target: the
      // turndown wikiLink rule writes `[[ref]]` exactly when the link's text
      // equals `docLink#anchor` and carries no other formatting — that is an
      // alias-less link. Anything else is an alias, and aliases are the
      // author's words.
      const ref = anchorAttr ? `${docLinkAttr}#${anchorAttr}` : docLinkAttr;
      const text = run.map((n) => n.text ?? "").join("");
      const isDefault = text.trim() === ref && run.every((n) => n.marks?.length === 1);
      if (isDefault) {
        out.push({ type: "text", text: `${newDocLink}#${hit.to}`, marks: [nextMark] });
      } else {
        for (const n of run) out.push({ ...n, marks: n.marks!.map((m) => (sameMark(m, link) ? nextMark : m)) });
      }
      continue;
    }

    // Literal `[[…]]` in plain text. Never inside code (documentation ABOUT
    // the syntax, as scanWikiLinks rules) or inside another link's text.
    if (node.marks?.some((m) => m.type === "code" || isAnyLinkMark(m)) || !node.text.includes("[[")) {
      out.push(node);
      continue;
    }
    let hits = 0;
    const text = node.text.replace(LITERAL_RE, (whole, inner: string) => {
      const parsed = parseWikiInner(inner);
      const hit = retarget(parsed.target, parsed.anchor, scope);
      if (!hit) return whole;
      hits++;
      bump(hit.key);
      // Keep what surrounds the anchor exactly as written: the target before
      // the "#", and the alias with its separator (`|` or a table's `\|`).
      const sep = /\\?\|/.exec(inner);
      const refPart = sep ? inner.slice(0, sep.index) : inner;
      const rest = sep ? inner.slice(sep.index) : "";
      return `[[${refPart.slice(0, refPart.indexOf("#") + 1)}${hit.to}${rest}]]`;
    });
    if (hits) { changed = true; out.push({ ...node, text }); }
    else out.push(node);
  }
  return changed ? { content: out, byKey } : null;
}

function addCounts(into: Map<string, number>, from: Map<string, number>) {
  for (const [k, n] of from) into.set(k, (into.get(k) ?? 0) + n);
}

/** Walk every inline content array outside code blocks. `visit` may return a
 *  replacement array. Returns the (possibly new) node. */
function mapInline(node: JsonNode, visit: (content: JsonNode[]) => JsonNode[] | null): JsonNode {
  if (node.type === "codeBlock" || !Array.isArray(node.content)) return node;
  let content = node.content;
  if (content.some((c) => c?.type === "text")) {
    const next = visit(content);
    if (next) content = next;
  }
  let copied = content !== node.content;
  for (let i = 0; i < content.length; i++) {
    const child = content[i]!;
    if (child?.type === "text") continue;
    const mapped = mapInline(child, visit);
    if (mapped !== child) {
      if (!copied) { content = content.slice(); copied = true; }
      content[i] = mapped;
    }
  }
  return copied ? { ...node, content } : node;
}

/** How many links in `canonical` point at a renamed heading, by old anchor key. */
export function countHeadingLinks(canonical: unknown, scope: HeadingLinkScope): Map<string, number> {
  const counts = new Map<string, number>();
  if (!canonical || typeof canonical !== "object") return counts;
  mapInline(canonical as JsonNode, (content) => {
    const r = rewriteInline(content, scope);
    if (r) addCounts(counts, r.byKey);
    return null;
  });
  return counts;
}

/**
 * `canonical` with every link to a renamed heading retargeted. Returns the
 * SAME object and a count of 0 when nothing points at one — the input is never
 * mutated.
 */
export function rewriteHeadingLinks(canonical: unknown, scope: HeadingLinkScope): { canonical: unknown; count: number } {
  if (!canonical || typeof canonical !== "object") return { canonical, count: 0 };
  let count = 0;
  const next = mapInline(canonical as JsonNode, (content) => {
    const r = rewriteInline(content, scope);
    if (!r) return null;
    for (const n of r.byKey.values()) count += n;
    return r.content;
  });
  return { canonical: count ? next : canonical, count };
}

/**
 * The same rewrite as ONE transaction on the live editor state, so ⌘Z takes it
 * back in one step. Only the changed stretch of each textblock is replaced
 * (a diff of old and new inline content), so the caret elsewhere in the
 * document stays where it was. Null when nothing points at a renamed heading.
 */
export function buildHeadingLinkTransaction(state: EditorState, scope: HeadingLinkScope): { tr: Transaction; count: number } | null {
  const edits: { from: number; to: number; content: Fragment }[] = [];
  let count = 0;
  state.doc.descendants((node, pos) => {
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return true;
    const json = node.content.toJSON() as JsonNode[] | null;
    const r = json ? rewriteInline(json, scope) : null;
    if (!r) return false;
    const next = Fragment.fromJSON(state.schema, r.content);
    const start = node.content.findDiffStart(next);
    if (start == null) return false;
    const end = node.content.findDiffEnd(next);
    let endA = end ? end.a : node.content.size;
    let endB = end ? end.b : next.size;
    // findDiffEnd may overlap findDiffStart when the change is a repeat of its
    // neighbour; widen both ends by the overlap, as ProseMirror's own diffing does.
    const overlap = start - Math.min(endA, endB);
    if (overlap > 0) { endA += overlap; endB += overlap; }
    for (const n of r.byKey.values()) count += n;
    edits.push({ from: pos + 1 + start, to: pos + 1 + endA, content: next.cut(start, endB) });
    return false;
  });
  if (!count) return null;
  const tr = state.tr;
  // Last edit first, so the earlier positions stay valid.
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i]!;
    tr.replaceWith(e.from, e.to, e.content);
  }
  return { tr, count };
}
