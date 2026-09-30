/**
 * Rich → markdown, one top-level block at a time (A083).
 *
 * The rich→markdown projection runs on every rich-pane edit, and converting the
 * whole document each time — serialize, clean, turndown, normalize — cost
 * seconds on a large one. ProseMirror nodes are immutable: an edit replaces the
 * top-level blocks it touches and SHARES every other one with the previous
 * document. So each top-level block's serialized and cleaned HTML is cached on
 * its node (a WeakMap — an entry goes when its node leaves every live
 * document), and so is the block's turndown output; a projection converts only
 * the blocks that changed and joins the rest from the cache.
 *
 * The result is BYTE-IDENTICAL to `htmlToMd(editor.getHTML())`, which rests on
 * four facts, and `incremental-md.test.js` checks the whole claim against the
 * full conversion after every step of random edit sequences:
 *  - `getHTML()` is the concatenation of each top-level node serialized alone
 *    (ProseMirror serializes a block that carries no marks in isolation);
 *  - `cleanHtmlForTurndown` works inside elements, never across two top-level
 *    ones, so cleaning the whole is concatenating the cleaned pieces;
 *  - turndown's output for a run cut at a block|block seam does not depend on
 *    its neighbours, and `joinRuns` joins runs as turndown joins blocks
 *    (turndown-rules.ts — the same machinery `turndownLinear` uses);
 *  - the whitespace pass (`normalizeMarkdown`) works within lines and fences,
 *    so each run's body can be normalized in place and cached too
 *    (normalizeBody); where a body could reach past its seam — an open fence,
 *    text spelling the pass's fence placeholder — the pass runs over the
 *    joined whole instead, as it always did.
 *
 * The content hash the sync engine gates on — `quickHash(getHTML())` — is kept
 * per block too, and combined into exactly that number (htmlHash), so the
 * gate's semantics do not change either.
 */
import { DOMSerializer, type Node as PMNode } from "@tiptap/pm/model";
import { quickHash } from "../utils/index";
import { cleanHtmlForTurndown } from "./html-cleaner";
import { findFencedCodeRanges } from "./preprocessor";
import {
  BLOCK_ELEMENTS,
  convertRun,
  convertRuns,
  holdsNextSibling,
  joinRuns,
  topLevelElements,
  turndownLinear,
  type RunOutput,
} from "./turndown-rules";

/** What `convertRuns` needs of a TurndownService. */
type Converter = Parameters<typeof convertRuns>[0];

interface CachedRun {
  /** The escape settings it was converted under (see IncrementalOptions). */
  sig: string;
  run: RunOutput;
  /** Its body as the whitespace pass leaves it in place (normalizeBody), or
   *  null where that cannot be decided from the body alone. Computed on demand,
   *  with its quickHash and 31^length (see htmlHash). */
  normalized?: string | null;
  normalizedHash?: number;
  normalizedPow?: number;
}

interface Piece {
  /** quickHash of the node's serialized HTML, and 31^length mod 2^32 — the two
   *  numbers that combine per-node hashes into the whole document's. */
  hash: number;
  pow: number;
  /** Its slice of cleanHtmlForTurndown(getHTML()); "" when cleaning removes it. */
  cleaned: string;
  /** Exactly one element, and one turndown treats as a block: a seam may fall
   *  on either side of it. Anything else joins its neighbours' run. */
  block: boolean;
  /** No seam may follow it (holdsNextSibling). */
  holds: boolean;
  /** The piece converted as a run of its own, per converter. */
  runs: Array<CachedRun | undefined>;
}

export interface IncrementalOptions {
  /** The converters, by mode — the same TurndownService instances the whole-document path uses. */
  converters: { styled: Converter; clean: Converter };
  /** Identifies everything else a conversion depends on (the escaper's settings);
   *  a cached run converted under a different value is converted again. */
  signature: () => string;
  /** The whitespace pass over turndown's output (normalizeMarkdown). */
  normalize: (md: string) => string;
}

export interface IncrementalConverter {
  /** `quickHash(getHTML())` of the document, computed per block. */
  htmlHash(doc: PMNode): number;
  /** `htmlToMd` / `htmlToCleanMd` of the document's HTML, re-converting only
   *  the top-level blocks that changed since they were last converted. */
  toMarkdown(doc: PMNode, mode: "styled" | "clean"): string;
  /** `quickHash(md)` when `md` is the markdown toMarkdown last returned and it
   *  was joined from its pieces (their hashes combine into it); else null. */
  markdownHash(md: string): number | null;
}

/** Separates nodes in one batched clean; see cleanPieces. */
const NODE_SEP = "\uE002";

/** 31^n mod 2^32 as a signed 32-bit integer — the weight quickHash gives a prefix. */
function pow31(n: number): number {
  let result = 1;
  let base = 31;
  while (n > 0) {
    if (n & 1) result = Math.imul(result, base);
    base = Math.imul(base, base);
    n >>>= 1;
  }
  return result;
}

/**
 * Clean many nodes' HTML. One parse for all of them when there are several:
 * the pieces are separated by a character that becomes a text node between two
 * top-level elements, which no step of the cleaner reads or changes. Markup
 * that already holds the separator is cleaned piece by piece. (The scan and
 * the count check each cover for the other — removing either alone changes
 * nothing observable; removing both, `converter-incremental.test.js` sees.)
 */
function cleanPieces(htmls: string[]): string[] {
  if (htmls.length === 1) return [cleanHtmlForTurndown(htmls[0]!)];
  if (htmls.every((h) => h.indexOf(NODE_SEP) === -1)) {
    const parts = cleanHtmlForTurndown(htmls.join(NODE_SEP)).split(NODE_SEP);
    if (parts.length === htmls.length) return parts;
  }
  return htmls.map(cleanHtmlForTurndown);
}

/** Brackets a body for normalizeBody; never part of the output. */
const EDGE = "\uE006";
/** normalizeMarkdown's placeholder for fenced code (preprocessor.ts) — text that
 *  spells one is replaced by the fence of that NUMBER, which differs between
 *  the whole document and a body. Pinned to the source by the test suite. */
const FENCE_PLACEHOLDER = /@@PFNORMCODE\d+@@/;
/**
 * Whether a fence is still open where `body` ends (it would run on into the
 * next body in the whole document). The body is scanned with one more line
 * after it: a line quoted deeper than any line of the body, so it closes no
 * fence — an open one runs on into it. (A shallower line would close a QUOTED
 * fence, which the blank line of a two-newline seam also does; only a
 * one-newline seam could carry it on, and the editor's content puts none
 * there. The deeper line is the conservative answer, not a tested one.) Its
 * markers are written WITHOUT spaces between them: the scanner's fence pattern
 * can split `> > >` between its repetitions in exponentially many ways before
 * failing, and a marker run has only one.
 */
function fenceOpenAtEnd(body: string): boolean {
  if (body.indexOf("```") === -1 && body.indexOf("~~~") === -1) return false;
  let depth = 0;
  for (const line of body.split("\n")) {
    let d = 0;
    for (let i = 0; i < line.length && (line[i] === ">" || line[i] === " " || line[i] === "\t"); i++) if (line[i] === ">") d++;
    if (d > depth) depth = d;
  }
  const ranges = findFencedCodeRanges(body + "\n" + ">".repeat(depth + 1) + EDGE);
  return ranges.length > 0 && ranges[ranges.length - 1]![1] > body.length;
}

/**
 * What the whitespace pass makes of a run's body IN PLACE — inside a larger
 * document, so without the pass's two document-edge steps (leading newlines
 * dropped, trailing ones reduced to one): the body is bracketed by lines the
 * pass leaves alone, and they are cut off again.
 *
 * Every other step of normalizeMarkdown works within a line, or on a run of
 * newlines that cannot cross from one body into the next (a seam is at most
 * two newlines, and no body starts or ends with one), or on fenced code — so
 * normalizing the bodies one by one equals normalizing the whole, provided no
 * fence is left open across a seam and no text spells a fence placeholder.
 * Null for those bodies: the caller then normalizes the whole document.
 */
function normalizeBody(normalize: (md: string) => string, body: string): string | null {
  if (FENCE_PLACEHOLDER.test(body) || fenceOpenAtEnd(body)) return null;
  // Most bodies hold nothing the pass would change — no run of three
  // newlines, no whitespace ending a line, no escaped wiki-link opener (fences
  // it only masks and restores) — and are their own normalized form. A load
  // converts every block at once, and one pass per block was the cost of it.
  if (body.indexOf("\n\n\n") === -1 && !/[ \t](?:\n|$)/.test(body) && body.indexOf("\\[\\[") === -1) return body;
  // (The body may hold EDGE itself: only the first and last two characters
  // are cut, and the pass treats the character as text wherever it is.)
  const out = normalize(EDGE + "\n" + body + "\n" + EDGE);
  return out.startsWith(EDGE + "\n") && out.endsWith("\n" + EDGE) ? out.slice(2, out.length - 2) : null;
}

/**
 * The document nodes are serialized INTO: an inert one, never the page's. An
 * element created in the live document loads its resources at once, attached
 * or not — every serialized <img> started fetching its src, so a stored image's
 * `pf-asset:` reference was a CSP violation (and an unknown-scheme error), and
 * a remote image was requested behind the user's back. TipTap's own getHTML()
 * serializes into an inert document for the same reason.
 */
let inertDocument: Document | null = null;
const inert = (): Document => (inertDocument ??= document.implementation.createHTMLDocument(""));

function serialize(serializer: DOMSerializer, node: PMNode): string {
  const doc = inert();
  const dom = serializer.serializeNode(node, { document: doc });
  if ((dom as Element).nodeType === 1) return (dom as Element).outerHTML;
  const box = doc.createElement("div");
  box.appendChild(dom);
  return box.innerHTML;
}

export function createIncrementalConverter(opts: IncrementalOptions): IncrementalConverter {
  const pieces = new WeakMap<PMNode, Piece>();
  const converters = [opts.converters.styled, opts.converters.clean];
  // Runs of more than one piece (a heading held to the block after it, a block
  // turndown does not treat as one and its neighbours), keyed by their markup.
  // Rebuilt on every call, so it only ever holds the current document's.
  const multi: Array<Map<string, CachedRun>> = [new Map(), new Map()];
  // The last document's pieces: the sync engine asks for the hash and then the
  // markdown of the same document, and each walk is one lookup per block.
  let lastDoc: PMNode | null = null;
  let lastPieces: Piece[] = [];
  // The last markdown toMarkdown returned, and its hash when the pieces gave it.
  let lastMarkdown: string | null = null;
  let lastMarkdownHash: number | null = null;

  /** Make sure every top-level node has its piece, building the missing ones together. */
  function piecesOf(doc: PMNode): Piece[] {
    if (doc === lastDoc) return lastPieces;
    const out: Piece[] = new Array(doc.childCount);
    const missing: number[] = [];
    doc.forEach((child, _offset, i) => {
      const p = pieces.get(child);
      if (p) out[i] = p;
      else missing.push(i);
    });
    if (missing.length) buildPieces(doc, missing, out);
    lastDoc = doc;
    lastPieces = out;
    return out;
  }

  function buildPieces(doc: PMNode, missing: number[], out: Piece[]): void {
    const serializer = DOMSerializer.fromSchema(doc.type.schema);
    const htmls = missing.map((i) => serialize(serializer, doc.child(i)));
    const cleaned = cleanPieces(htmls);
    missing.forEach((i, k) => {
      const html = htmls[k]!;
      const c = cleaned[k]!;
      const els = c ? topLevelElements(c) : null;
      const only = els && els.length === 1 && els[0]!.start === 0 && els[0]!.end === c.length ? els[0]! : null;
      const piece: Piece = {
        hash: quickHash(html),
        pow: pow31(html.length),
        cleaned: c,
        block: !!only && BLOCK_ELEMENTS.has(only.tag),
        holds: !!only && holdsNextSibling(c, only),
        runs: [],
      };
      pieces.set(doc.child(i), piece);
      out[i] = piece;
    });
  }

  function htmlHash(doc: PMNode): number {
    let h = 0;
    for (const p of piecesOf(doc)) h = (Math.imul(h, p.pow) + p.hash) | 0;
    return h;
  }

  function toMarkdown(doc: PMNode, mode: "styled" | "clean"): string {
    const m = mode === "styled" ? 0 : 1;
    const td = converters[m]!;
    const sig = opts.signature();

    // Runs: cut between two pieces wherever turndownLinear could cut — both
    // blocks, and the first not a heading that reads what follows it. Pieces
    // cleaning removed contribute nothing and never decide a seam. Run i is
    // live[starts[i]] up to the next run's start.
    const live: Piece[] = [];
    const starts: number[] = [];
    let prev: Piece | null = null;
    for (const p of piecesOf(doc)) {
      if (!p.cleaned) continue;
      if (!prev || (prev.block && p.block && !prev.holds)) starts.push(live.length);
      live.push(p);
      prev = p;
    }
    const n = starts.length;
    const endOf = (i: number): number => (i + 1 < n ? starts[i + 1]! : live.length);
    const markup = (i: number): string =>
      endOf(i) - starts[i]! === 1 ? live[starts[i]!]!.cleaned : live.slice(starts[i], endOf(i)).map((p) => p.cleaned).join("");

    const entries: Array<CachedRun | undefined> = new Array(n);
    const keys: Array<string | null> = new Array(n);
    const nextMulti = new Map<string, CachedRun>();
    const todo: number[] = [];
    const edges: number[] = [];
    for (let i = 0; i < n; i++) {
      keys[i] = null;
      // A run that begins the document with something that is not a block, or
      // ends it with one, cannot be bracketed by sentinels (turndown would
      // join its text to them). Converted as turndownLinear converts its first
      // and last runs, and never cached: its output depends on where it is.
      if ((i === 0 && !live[0]!.block) || (i === n - 1 && !live[live.length - 1]!.block)) {
        edges.push(i);
        continue;
      }
      if (endOf(i) - starts[i]! === 1) {
        const hit = live[starts[i]!]!.runs[m];
        if (hit && hit.sig === sig) entries[i] = hit;
        else todo.push(i);
        continue;
      }
      const key = markup(i);
      keys[i] = key;
      const hit = multi[m]!.get(key) ?? nextMulti.get(key);
      if (hit && hit.sig === sig) {
        entries[i] = hit;
        nextMulti.set(key, hit);
      } else todo.push(i);
    }

    const runs = (): RunOutput[] => entries.map((e) => e!.run);
    if (todo.length) {
      const converted = convertRuns(td, todo.map((i) => keys[i] ?? markup(i)));
      if (!converted) return opts.normalize(wholeDocument(td, n, markup));
      todo.forEach((i, k) => {
        const entry: CachedRun = { sig, run: converted[k]! };
        entries[i] = entry;
        if (keys[i] !== null) nextMulti.set(keys[i]!, entry);
        else live[starts[i]!]!.runs[m] = entry;
      });
    }
    for (const i of edges) {
      const edge = convertRun(td, markup(i), i > 0, i < n - 1);
      if (!edge) return opts.normalize(wholeDocument(td, n, markup));
      entries[i] = { sig, run: edge };
    }
    multi[m] = nextMulti;
    const joined = joinNormalized(entries as CachedRun[]);
    lastMarkdown = joined ? joined.md : opts.normalize(joinRuns(runs()));
    lastMarkdownHash = joined ? joined.hash : null;
    return lastMarkdown;
  }

  function markdownHash(md: string): number | null {
    return md === lastMarkdown ? lastMarkdownHash : null;
  }

  /**
   * The runs joined as joinRuns joins them, from each run's body as the
   * whitespace pass leaves it in place (normalizeBody, cached with the run),
   * then the pass's document-edge steps over the whole — which is
   * `normalize(joinRuns(runs))` without passing the whole document through it.
   * Null wherever that equality cannot be read off the pieces: a body
   * normalizeBody declines, two bodies joined without a newline between them
   * (their lines would run together), or ends that joinRuns' final trim would
   * change. The last two do not arise from the editor's content — every block
   * ends in a newline, and turndown's whitespace pass leaves no tab at the
   * start of one — and are checked because the equality needs them.
   */
  function joinNormalized(entries: CachedRun[]): { md: string; hash: number } | null {
    const parts: string[] = [];
    let pending = 0;
    let last: string | null = null;
    let h = 0; // quickHash of the parts so far, combined as htmlHash combines pieces
    for (const e of entries) {
      const r = e.run;
      if (!r.body) {
        pending = Math.max(pending, r.lead);
        continue;
      }
      if (parts.length) {
        const k = Math.min(2, Math.max(pending, r.lead));
        if (k === 0) return null;
        parts.push(k === 1 ? "\n" : "\n\n");
        h = k === 1 ? (Math.imul(h, 31) + 10) | 0 : (Math.imul(h, 961) + 320) | 0;
      } else if (r.body[0] === "\t" || r.body[0] === "\r") {
        return null;
      }
      if (e.normalized === undefined) {
        e.normalized = normalizeBody(opts.normalize, r.body);
        if (e.normalized !== null) {
          e.normalizedHash = quickHash(e.normalized);
          e.normalizedPow = pow31(e.normalized.length);
        }
      }
      if (e.normalized === null) return null;
      parts.push(e.normalized);
      h = (Math.imul(h, e.normalizedPow!) + e.normalizedHash!) | 0;
      last = r.body;
      pending = r.trail;
    }
    if (last !== null && /\s$/.test(last)) return null;
    // normalizeMarkdown's leading-newline step. Its other edge step (trailing
    // newlines reduced to one) has nothing to do: the last body ends in a
    // character that is not whitespace, and the pass keeps it.
    const md = parts.join("");
    let a = 0;
    while (a < md.length && md[a] === "\n") a++;
    if (a === 0) return { md, hash: h };
    const out = md.slice(a);
    return { md: out, hash: quickHash(out) };
  }

  return { htmlHash, toMarkdown, markdownHash };
}

/** The whole-document conversion, for the should-not-happen case of a
 *  sentinel that did not come through. */
function wholeDocument(td: Converter, n: number, markup: (i: number) => string): string {
  let html = "";
  for (let i = 0; i < n; i++) html += markup(i);
  return turndownLinear(td, html);
}
