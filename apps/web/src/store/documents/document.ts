/**
 * Document model — three-layer architecture.
 *
 * Layer 1: Origin    — immutable raw input as received
 * Layer 2: Canonical — mutable ProseMirror JSON (what editors work with)
 * Layer 3: Residuals — what the ingest pipeline couldn't process
 *
 * Plus: ingest report, fidelity report, derived caches.
 */

import { canonicalJsonText } from "./canonical-json";
import { sanitizeCanonicalNode } from "./canonical-sanitize";
import type { ResidualItem } from "../importExport/ingest";
import { CURRENT_SCHEMA_VERSION } from "./schema-version";

// --- Types ---

export interface OriginRecord {
  format: string;
  raw: string | null;
  source: string;
  timestamp: string;
  alternates: Record<string, string> | null;
}

export interface PMNode {
  type?: string;
  text?: string;
  content?: PMNode[];
  attrs?: Record<string, unknown>;
}

export interface DocumentRecord {
  _ingestHtml: string;
  id: string;
  /** Explicit user-set title. When set, overrides content-derived title on save. */
  userTitle: string | null;
  /**
   * Provenance flag: `true` only when the CURRENT `userTitle` came from a real
   * user rename (renameDoc / an explicit userTitle patch / a backup-envelope
   * title), as opposed to a placeholder ("Untitled N") that older versions
   * pinned at creation. `resolveDocTitle` trusts this flag instead of
   * string-sniffing the title — so a user who deliberately names a doc
   * "Untitled 5" keeps it, and an accidental placeholder pin still heals.
   */
  titlePinnedByUser: boolean;
  title: string;
  origin: OriginRecord;
  canonical: PMNode & { type: "doc"; content: PMNode[] };
  residuals: ResidualItem[];
  ingestReport: unknown;
  markdownCache: string | null;
  htmlCache: string | null;
  fidelityReport: unknown;
  metadata: Record<string, unknown>;
  tags: string[];
  created: string;
  updated: string;
  /** The canonical format version the content was written in (see
   *  schema-version.ts). Absent on records older than the field. */
  schemaVersion?: number;
}

export interface CreateDocumentOpts {
  _ingestHtml?: string;
  id?: string;
  userTitle?: string | null;
  titlePinnedByUser?: boolean;
  title?: string;
  origin?: OriginRecord;
  canonical?: PMNode & { type?: string; content?: PMNode[] };
  residuals?: ResidualItem[];
  ingestReport?: unknown;
  markdownCache?: string | null;
  htmlCache?: string | null;
  fidelityReport?: unknown;
  metadata?: Record<string, unknown>;
  tags?: string[];
  created?: string;
  updated?: string;
  schemaVersion?: number;
}

export interface DocumentSummary {
  id: string;
  title: string;
  updated: string;
  created: string;
  wordCount: number;
  tags: string[];
  hasResiduals: boolean;
  originFormat: string;
}

let _counter = 0;

export function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${ts}-${rand}-${(++_counter).toString(36)}`;
}

/**
 * Create an empty origin record.
 */
export function createOrigin(
  format: string,
  raw: string | null,
  source: string,
  alternates: Record<string, string> | null = null
): OriginRecord {
  return {
    format,
    raw,
    source,
    timestamp: new Date().toISOString(),
    alternates,
  };
}

/**
 * Create a new document with all three layers.
 */
export function createDocument(opts: CreateDocumentOpts = {}): DocumentRecord {
  const now = new Date().toISOString();
  return {
    _ingestHtml: opts._ingestHtml ?? "",
    id: opts.id ?? generateId(),
    userTitle: opts.userTitle ?? null,
    // Migration for docs that predate the provenance flag (loaded via
    // deserializeFromStorage → createDocument): a non-placeholder pin is treated
    // as a genuine rename, a placeholder ("Untitled N") pin is not (so it still
    // heals). New writers pass the flag explicitly.
    titlePinnedByUser:
      opts.titlePinnedByUser ??
      (opts.userTitle != null && !/^Untitled( \d+)?$/.test(opts.userTitle)),
    title: opts.title ?? "Untitled",

    // Layer 1: origin (immutable after creation)
    origin:
      opts.origin ?? createOrigin("user-typed", null, "user-typed"),

    // Layer 2: canonical (ProseMirror JSON — the editable tree)
    canonical: sanitizeCanonicalNode(
      (opts.canonical ?? {
        type: "doc",
        content: [{ type: "paragraph" }],
      }) as PMNode & {
        type: "doc";
        content: PMNode[];
      }
    ),

    // Layer 3: residuals (computed on ingest)
    residuals: opts.residuals ?? [],

    // Processing log
    ingestReport: opts.ingestReport ?? null,

    // Derived caches (regenerated on demand)
    markdownCache: opts.markdownCache ?? null,
    htmlCache: opts.htmlCache ?? null,
    fidelityReport: opts.fidelityReport ?? null,

    // Metadata
    metadata: opts.metadata ?? {},
    tags: opts.tags ?? [],
    created: opts.created ?? now,
    updated: opts.updated ?? now,
    ...(typeof opts.schemaVersion === "number" ? { schemaVersion: opts.schemaVersion } : {}),
  };
}

/**
 * Derive a title from canonical PM JSON content.
 * Finds the first heading node and extracts its text.
 */
export function deriveTitleFromCanonical(
  canonical: PMNode | null | undefined
): string {
  if (!canonical?.content) return "Untitled";
  for (const node of canonical.content) {
    if (node.type === "heading") {
      return extractText(node) || "Untitled";
    }
  }
  // No heading — use first 60 chars of first paragraph
  for (const node of canonical.content) {
    if (node.type === "paragraph") {
      const text = extractText(node);
      if (text) return text.length > 60 ? text.slice(0, 57) + "…" : text;
    }
  }
  return "Untitled";
}

/**
 * Resolve a document's title (and userTitle pin) against its content.
 *
 * Precedence:
 *  1. A genuine user rename (`titlePinnedByUser`) always wins — even a title
 *     that happens to read "Untitled 5". The provenance flag replaces the old
 *     string-sniffing that mis-cleared such deliberate names.
 *  2. Legacy fallback (docs predating the flag, defended in depth): honor a
 *     non-placeholder pin, but treat an "Untitled N" pin as a placeholder so it
 *     still HEALS (older versions pinned that at creation, killing derivation).
 *  3. Real content (first heading, else first paragraph) names the doc —
 *     typing "# Project Alpha" retitles it and clears any placeholder pin.
 *  4. No content yet: keep the current display title, preserving the unique
 *     "Untitled 2" / "Untitled 3" placeholders for empty docs.
 */
export function resolveDocTitle(
  doc: { title: string; userTitle: string | null; titlePinnedByUser?: boolean },
  canonical: PMNode | null | undefined
): { title: string; userTitle: string | null; titlePinnedByUser: boolean } {
  if (doc.titlePinnedByUser && doc.userTitle != null) {
    return { title: doc.userTitle, userTitle: doc.userTitle, titlePinnedByUser: true };
  }
  const isPlaceholderPin =
    doc.userTitle != null && /^Untitled( \d+)?$/.test(doc.userTitle);
  if (doc.userTitle != null && !isPlaceholderPin) {
    return { title: doc.userTitle, userTitle: doc.userTitle, titlePinnedByUser: true };
  }
  const derived = deriveTitleFromCanonical(canonical);
  if (derived !== "Untitled") return { title: derived, userTitle: null, titlePinnedByUser: false };
  return { title: doc.title || "Untitled", userTitle: doc.userTitle, titlePinnedByUser: false };
}

/**
 * Extract plain text from a PM JSON node (recursive).
 */
export function extractText(node: PMNode | null | undefined): string {
  const parts: string[] = [];
  pushText(node, parts);
  return parts.join("");
}

/** Depth-first text collector. One array, one join — the recursive
 *  `.map().join("")` allocated an array AND a joined string at every level of
 *  the tree, so a deep document paid for its own text many times over. */
function pushText(node: PMNode | null | undefined, out: string[]): void {
  if (!node) return;
  if (node.type === "text") {
    if (node.text) out.push(node.text);
    return;
  }
  const content = node.content;
  if (!content) return;
  for (const child of content) pushText(child, out);
}

/** True for the characters `/\s/` matches — the class `computeCounts` has
 *  always split on, kept in one place so the streaming counter and the
 *  string-building one can be proven equivalent. */
const WHITESPACE = /\s/;

/** Streaming word/char counter.
 *
 *  Counts maximal non-whitespace runs across the CONCATENATION of the text
 *  nodes, exactly as `text.trim().split(/\s+/).filter(Boolean)` did — two
 *  adjacent text nodes "foo" and "bar" are one word, not two — but without
 *  materialising the document's text. On the sync path this ran on every
 *  projection, building a full copy of the document as a string each time.
 *
 *  Scripts written WITHOUT spaces between words (Chinese, Japanese, Thai, Lao,
 *  Khmer, Myanmar) broke that rule completely: a whole Japanese paragraph is
 *  one whitespace-delimited run, so it counted as ONE word. A run containing
 *  such a character is segmented with `Intl.Segmenter` (dictionary word
 *  boundaries — 東京は日本の首都です is six words); every other run still counts
 *  as one, so counts in space-delimited languages are unchanged. The optional
 *  fields carry that run across text-node boundaries.
 */
export interface CountAcc {
  chars: number;
  words: number;
  inWord: boolean;
  /** Text of the current run seen in EARLIER text nodes (see countTextRun). */
  head?: string;
  /** The current run contains a character from a no-space script. */
  seg?: boolean;
  /** Words currently credited to the current run (1 until it is segmented). */
  credit?: number;
}

/** A fresh accumulator for `countTextRun`. */
export const newCountAcc = (): CountAcc => ({ chars: 0, words: 0, inWord: false, head: "", seg: false, credit: 0 });

/** Scripts whose words are not separated by spaces. Korean is NOT one of them —
 *  Hangul text is spaced, so the whitespace rule is already right for it. */
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
/** Han and kana, for the no-Segmenter fallback. */
const HAN_KANA = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

type WordSegmenter = { segment(input: string): Iterable<{ isWordLike?: boolean }> };
let _segmenter: WordSegmenter | null | undefined;
function wordSegmenter(): WordSegmenter | null {
  if (_segmenter === undefined) {
    try {
      const S = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => WordSegmenter }).Segmenter;
      _segmenter = S ? new S(undefined, { granularity: "word" }) : null;
    } catch {
      _segmenter = null;
    }
  }
  return _segmenter;
}
/** Tests: force the fallback (`null`) or restore detection (`undefined`). */
export function __setWordSegmenterForTests(seg: WordSegmenter | null | undefined): void {
  _segmenter = seg;
  _segCache.clear();
}

// Counting runs on every projection; an unchanged paragraph should not be
// re-segmented each time. Bounded, and simply dropped when full.
const _segCache = new Map<string, number>();

/** Words in one whitespace-free run that contains a no-space-script character. */
function unspacedWordCount(run: string): number {
  const hit = _segCache.get(run);
  if (hit !== undefined) return hit;
  let n = 0;
  const seg = wordSegmenter();
  if (seg) {
    for (const s of seg.segment(run)) if (s.isWordLike) n++;
  } else {
    // No Segmenter (older engines): each Han/kana character is a word — the
    // convention word processors use for East Asian text — and every other
    // stretch of letters or digits between them one more.
    let inOther = false;
    for (const ch of run) {
      if (HAN_KANA.test(ch)) { n++; inOther = false; }
      else if (/[\p{L}\p{N}]/u.test(ch)) { if (!inOther) { n++; inOther = true; } }
      else inOther = false;
    }
  }
  n = Math.max(1, n);
  if (_segCache.size >= 512) _segCache.clear();
  _segCache.set(run, n);
  return n;
}

/** Re-credit the current run with its segmented word count. */
function recredit(acc: CountAcc, run: string): void {
  const n = unspacedWordCount(run);
  acc.words += n - (acc.credit ?? 1);
  acc.credit = n;
}

/** Fold one text run into the accumulator. Exported so that anything already
 *  walking the document (see `computeCanonicalStats`) can count as it goes
 *  rather than walking a second time — and so the whitespace rule lives in
 *  exactly one place. `acc.words` is correct after EVERY call (a run that
 *  continues into the next text node is provisionally counted), because
 *  callers read it straight after their walk. */
export function countTextRun(text: string, acc: CountAcc): void {
  acc.chars += text.length;
  let runStart = acc.inWord ? 0 : -1; // where the current run began in THIS text
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // Fast path for the characters that actually occur in prose.
    const ws = c === 32 || c === 10 || c === 9 || c === 13
      ? true
      : c < 128
        ? c === 11 || c === 12
        : WHITESPACE.test(text[i]!);
    if (ws) {
      if (acc.inWord && acc.seg) recredit(acc, (acc.head ?? "") + text.slice(runStart, i));
      acc.inWord = false;
    } else {
      if (!acc.inWord) {
        acc.inWord = true;
        acc.words++;
        acc.head = "";
        acc.seg = false;
        acc.credit = 1;
        runStart = i;
      }
      // No-space scripts all live above U+0E00, so ASCII and Latin-1 never pay.
      // A high surrogate is tested as its whole code point (CJK Extension B+).
      if (!acc.seg && c >= 0x0e00) {
        const ch = c >= 0xd800 && c <= 0xdbff ? String.fromCodePoint(text.codePointAt(i)!) : text[i]!;
        if (UNSPACED_SCRIPT.test(ch)) acc.seg = true;
      }
    }
  }
  if (acc.inWord) {
    // The run continues into the next text node (or the document ends here):
    // keep its text so far, and credit it provisionally if it needs segmenting.
    acc.head = (acc.head ?? "") + text.slice(runStart);
    if (acc.seg) recredit(acc, acc.head);
  }
}

/**
 * End the current word at a node boundary. Only adjacent TEXT nodes continue a
 * word — they differ only in their marks, so `un**believ**able` is one word.
 * Any other node boundary ends it: a paragraph, heading, list item, table cell
 * or hard break. Without this the last word of every block ran into the first
 * word of the next, so a four-item list counted as ONE word. A segmented run
 * is already credited (countTextRun credits provisionally), so ending it is
 * just leaving it.
 */
export function endWordRun(acc: CountAcc): void {
  acc.inWord = false;
  acc.head = "";
}

function countInto(node: PMNode | null | undefined, acc: CountAcc): void {
  if (!node) return;
  if (node.type === "text") {
    if (node.text) countTextRun(node.text, acc);
    return;
  }
  endWordRun(acc);
  const content = node.content;
  if (!content) return;
  for (const child of content) countInto(child, acc);
  endWordRun(acc);
}

/** Each top-level block's counts, keyed on the block's JSON object (see computeCounts). */
const blockCounts = new WeakMap<object, { chars: number; words: number }>();

/**
 * Compute word and character counts from canonical PM JSON.
 *
 * Per top-level block, from a cache (A083): every node boundary ends a word
 * (endWordRun), so a block's counts depend on nothing but the block, and the
 * canonical the editor hands over (canonicalOf) is made of the SAME object for
 * every block an edit did not touch. A save of a 4 MB document walked all of
 * it two or three times (its own counts, the snapshot check, the library
 * summary). Read, never mutate: a block edited in place would keep its old
 * counts. Top-level text — which no schema here produces — takes the walk.
 */
export function computeCounts(
  canonical: PMNode | null | undefined
): { chars: number; words: number } {
  const content = canonical && canonical.type !== "text" ? canonical.content : undefined;
  if (Array.isArray(content) && content.every((b) => b && typeof b === "object" && b.type !== "text")) {
    let chars = 0;
    let words = 0;
    for (const block of content) {
      let c = blockCounts.get(block);
      if (!c) {
        const acc = newCountAcc();
        countInto(block, acc);
        c = { chars: acc.chars, words: acc.words };
        blockCounts.set(block, c);
      }
      chars += c.chars;
      words += c.words;
    }
    return { chars, words };
  }
  const acc = newCountAcc();
  countInto(canonical, acc);
  return { chars: acc.chars, words: acc.words };
}

/**
 * Serialize a document for storage (strips derived caches to save space).
 *
 * Byte for byte `JSON.stringify` of the record's stored fields, in this order
 * (`updated` and `schemaVersion` LAST — the IndexedDB adapter reads a save's
 * revision off the end, see `readRevision`), a field with no JSON form left
 * out, as JSON.stringify leaves it out. The canonical's text comes from
 * `canonicalJsonText`, which reuses each unchanged block's text (A083).
 * `document-serialize.test.js` holds it to the plain stringify.
 */
export function serializeForStorage(doc: DocumentRecord): string {
  const fields: Array<[string, unknown]> = [
    ["id", doc.id],
    ["userTitle", doc.userTitle ?? null],
    ["titlePinnedByUser", doc.titlePinnedByUser],
    ["title", doc.title],
    ["origin", doc.origin],
    ["canonical", doc.canonical],
    ["residuals", doc.residuals],
    ["ingestReport", doc.ingestReport],
    ["metadata", doc.metadata],
    ["tags", doc.tags],
    ["created", doc.created],
    ["updated", doc.updated],
    // Never DOWNGRADE the stamp: a record written by a newer build is only
    // ever re-serialized here for a rename or a metadata change (its content
    // is locked read-only), and its content is still the newer format.
    ["schemaVersion", Math.max(doc.schemaVersion ?? 0, CURRENT_SCHEMA_VERSION)],
    // Caches are excluded — regenerated on load
  ];
  let out = "";
  for (const [key, value] of fields) {
    const text = key === "canonical" && value !== undefined ? canonicalJsonText(value) : JSON.stringify(value);
    if (text === undefined) continue;
    out += `${out ? "," : "{"}"${key}":${text}`;
  }
  return out ? `${out}}` : "{}";
}

/**
 * Deserialize a document from storage.
 */
export function deserializeFromStorage(
  json: string | Record<string, unknown>
): DocumentRecord | null {
  try {
    const raw =
      typeof json === "string"
        ? (JSON.parse(json) as Record<string, unknown>)
        : json;
    return createDocument(raw as CreateDocumentOpts);
  } catch (e) {
    console.error("[Document] Failed to deserialize:", e);
    return null;
  }
}

/**
 * Create a document summary (for sidebar listing).
 */
export function toSummary(doc: DocumentRecord): DocumentSummary {
  const counts = computeCounts(doc.canonical);
  return {
    id: doc.id,
    title: doc.title,
    updated: doc.updated,
    created: doc.created,
    wordCount: counts.words,
    tags: doc.tags,
    hasResiduals: doc.residuals.length > 0,
    originFormat: doc.origin?.format ?? "unknown",
  };
}

/**
 * Extract field data from canonical PM JSON.
 * Finds all fieldBlock nodes and merges their fields into a single object.
 * Returns { key: value } map.
 */
export function extractFields(
  canonical: PMNode | null | undefined
): Record<string, string> {
  if (!canonical?.content) return {};
  const fields: Record<string, string> = {};
  for (const node of canonical.content) {
    if (node.type === "fieldBlock" && node.attrs) {
      const fieldsArr = node.attrs['fields'] as { key: string; value?: string }[] | undefined;
      if (fieldsArr) {
        for (const f of fieldsArr) {
          fields[f.key] = f.value ?? "";
        }
      }
    }
  }
  return fields;
}

/**
 * Extract tags from field blocks (looks for "tags" field with comma-separated values).
 */
export function extractTags(
  canonical: PMNode | null | undefined
): string[] {
  const fields = extractFields(canonical);
  if (fields["tags"]) {
    return fields["tags"]
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Sync metadata from field blocks into document.metadata on save.
 */
export function syncFieldsToMetadata(
  doc: DocumentRecord
): DocumentRecord {
  if (!doc?.canonical) return doc;
  const fields = extractFields(doc.canonical);
  doc.metadata = { ...doc.metadata, ...fields };
  const tags = extractTags(doc.canonical);
  if (tags.length > 0) doc.tags = tags;
  return doc;
}

/**
 * Stamp `updated` unless the caller deliberately preserved it.
 *
 * `patchDocById(..., { touchUpdated: false })` exists so a presentation-only
 * change (a card's colour or pin) does not re-sort the board as if the note had
 * been edited. Every StorageAdapter's `save()` overwrote `updated` with "now"
 * regardless, so that flag never actually did anything — the board re-sorted on
 * every recolour and every pin. Adapters call this instead.
 */
export function stampUpdated(doc: DocumentRecord & { _preserveUpdated?: boolean }): void {
  if (doc._preserveUpdated) {
    delete doc._preserveUpdated;
    return;
  }
  doc.updated = new Date().toISOString();
}
