/**
 * Link Index — bidirectional document link graph.
 *
 * Scans PM JSON canonical content for wiki links ([[Title]] or [[id|Text]])
 * and maintains forward/reverse maps for backlink queries and graph export.
 *
 * The index is rebuilt from the document store on init, and updated
 * incrementally when individual documents are saved.
 */

import { extractText } from "./document";

// Wiki-link matcher, hoisted to module scope so a full library rebuild doesn't
// allocate a fresh RegExp per text node. Scanning is synchronous and
// non-reentrant, so the shared `lastIndex` is always reset before each use.
const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;

// --- Types ---

export interface WikiLink {
  raw: string;
  /** The DOCUMENT part of the reference — before any "#". */
  target: string;
  displayText: string;
  /** The heading part, after the first "#" (absent when there is none). The
   *  resolver tries `target#anchor` as a whole title first — see
   *  resolveWikiLink. */
  anchor?: string;
}

interface UnresolvedLink {
  target: string;
  displayText: string;
  anchor?: string;
}

export interface LinkIndex {
  forward: Map<string, Set<string>>;
  reverse: Map<string, Set<string>>;
  unresolved: Map<string, UnresolvedLink[]>;
  contexts: Map<string, string>;
}

export interface DocRecord {
  id: string;
  title?: string;
  canonical?: { type: string; content?: PMNode[] };
  tags?: string[];
  metadata?: Record<string, unknown>;
  created?: string;
  updated?: string;
  wordCount?: number;
}

interface PMMark {
  type?: string;
  attrs?: Record<string, unknown>;
}

interface PMNode {
  type?: string;
  text?: string;
  marks?: PMMark[];
  content?: PMNode[];
}

// --- Wiki link detection in PM JSON ---

/**
 * Scan a PM JSON document for wiki-link patterns in text nodes.
 * Returns array of { raw, target, displayText } for each [[...]] found.
 *
 * Patterns:
 *   [[Document Title]]        → target = "Document Title", displayText = "Document Title"
 *   [[doc-id|Display Text]]   → target = "doc-id", displayText = "Display Text"
 */
export function scanWikiLinks(
  canonical: { content?: PMNode[] } | null | undefined
): WikiLink[] {
  if (!canonical?.content) return [];
  const links: WikiLink[] = [];
  // Split a reference the way the renderer does (engine/preprocessor): the
  // document before the first "#", the heading after it. The graph/backlinks
  // connect DOCUMENTS, so the heading is carried beside the target rather than
  // being part of it.
  const splitRef = (ref: string): { target: string; anchor?: string } => {
    const h = ref.indexOf("#");
    if (h < 0) return { target: ref.trim() };
    const anchor = ref.slice(h + 1).trim();
    return anchor ? { target: ref.slice(0, h).trim(), anchor } : { target: ref.slice(0, h).trim() };
  };
  walkNodes(canonical as PMNode, (node: PMNode) => {
    // Rendered internal links: a text node carrying a link mark with a
    // data-doc-link (docLink) attribute. This is how wiki links / heading
    // anchors exist in the canonical once the renderer converts [[…]] → <a>.
    const linkMark = node.marks?.find(
      (m) => (m.type === "link" || m.type === "wikiLink") && m.attrs && "docLink" in m.attrs
    );
    if (linkMark) {
      const split = splitRef(String(linkMark.attrs?.["docLink"] ?? ""));
      const attrAnchor = String(linkMark.attrs?.["anchor"] ?? "").trim();
      const anchor = attrAnchor || split.anchor;
      if (split.target) {
        links.push({
          raw: `[[${split.target}]]`,
          target: split.target,
          displayText: node.text ?? split.target,
          ...(anchor ? { anchor } : {}),
        });
      }
      return; // don't also regex the display text of a rendered link
    }
    // Literal wiki-link syntax still in plain text (e.g. markdown-only docs, or
    // before the renderer runs). [[Doc#Heading]] indexes as a link to Doc;
    // [[#Heading]] (same-doc anchor) has no doc target and is skipped.
    //
    // CODE IS NOT A LINK. Text carrying a `code` mark (and anything inside a
    // fenced code block, filtered in the walk below) is documentation ABOUT the
    // syntax, not a use of it — the shipped welcome document explains
    // `[[Document title]]` in an inline code span, and indexing those made every
    // brand-new user open to a red "Broken (2)" tab listing the app's own
    // examples. Mirrors what case-transform.ts already does for "content only".
    if (node.marks?.some((m) => m.type === "code")) return;
    const text = node.type === "text" ? node.text : undefined;
    if (!text) return;
    const regex = WIKI_LINK_RE;
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const inner = match[1]!; // the one group is not optional
      const pipeIdx = inner.indexOf("|");
      const ref = pipeIdx >= 0 ? inner.slice(0, pipeIdx).trim() : inner.trim();
      const display = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : ref;
      const { target, anchor } = splitRef(ref);
      if (!target) continue; // pure same-doc anchor — not a document link
      links.push({ raw: match[0], target, displayText: display, ...(anchor ? { anchor } : {}) });
    }
  });
  return links;
}

/**
 * Walk all nodes in a PM JSON tree (so callers can inspect marks, not just
 * text — rendered wiki links live as link marks on text nodes).
 */
function walkNodes(
  node: PMNode | null | undefined,
  callback: (node: PMNode) => void
): void {
  if (!node) return;
  // A fenced code block's contents are literal sample text — never links.
  if (node.type === "codeBlock") return;
  callback(node);
  if (node.content) {
    for (const child of node.content) {
      walkNodes(child, callback);
    }
  }
}

/** A resolved wiki link: the document, and the heading to open it at (null
 *  when there is none — including when the "#" turned out to be part of the
 *  document's title). */
export interface WikiResolution {
  id: string;
  anchor: string | null;
}

/** Title comparison key: NFKC, case-insensitive, whitespace collapsed. */
const titleKey = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
/** The same, with the space around "#" dropped. The renderer TRIMS both halves
 *  of `[[C# Tips]]` ("C" / "Tips"), so a title can only be recognised from
 *  those halves if the spacing around its "#" is not significant. */
const hashKey = (s: string) => titleKey(s).replace(/\s*#\s*/g, "#");

/**
 * THE wiki-link resolver — used by the link index (graph, backlinks, the
 * broken-link list), the click handler and the broken-link decoration, so all
 * three always agree about where a link goes. Build it once per library.
 *
 * `docLink` / `anchor` are the two halves the renderer produces from
 * `[[docLink#anchor|display]]`. In order:
 *  1. with an anchor, the WHOLE reference as a title — `[[C# Tips]]` names the
 *     note "C# Tips"; splitting it first sent it to a note called "C" (or,
 *     worse, see 3) and made such titles unlinkable;
 *  2. an exact document id, then an exact title (case-insensitive, NFKC,
 *     whitespace-normalised); first match in library order wins;
 *  3. nothing else. There used to be a PARTIAL match (`title.includes(target)`):
 *     `[[C# Tips]]` resolved to "Changelog" in the graph and backlinks — the
 *     first title containing "c" — while a click on the same link said
 *     "Document not found".
 */
export function createWikiResolver(
  documents: DocRecord[]
): (docLink: string, anchor?: string | null) => WikiResolution | null {
  const byId = new Map<string, string>();
  const byTitle = new Map<string, string>();
  const byHashTitle = new Map<string, string>();
  for (const d of documents) {
    if (!byId.has(d.id)) byId.set(d.id, d.id);
    const t = d.title ?? "";
    if (!t) continue;
    const k = titleKey(t);
    if (!byTitle.has(k)) byTitle.set(k, d.id);
    if (t.includes("#")) {
      const hk = hashKey(t);
      if (!byHashTitle.has(hk)) byHashTitle.set(hk, d.id);
    }
  }
  return (docLink, anchor) => {
    const target = (docLink ?? "").trim();
    const heading = (anchor ?? "").trim();
    if (heading) {
      const whole = byHashTitle.get(hashKey(`${target}#${heading}`));
      if (whole) return { id: whole, anchor: null };
    }
    if (!target) return null; // a same-document anchor names no document
    const id = byId.get(target) ?? byTitle.get(titleKey(target));
    return id ? { id, anchor: heading || null } : null;
  };
}

/** One-off resolution (see createWikiResolver — prefer building it once). */
export function resolveWikiLink(
  docLink: string,
  anchor: string | null | undefined,
  documents: DocRecord[]
): WikiResolution | null {
  return createWikiResolver(documents)(docLink, anchor);
}

/**
 * Resolve a wiki-link target string to a document ID (no heading).
 * Kept for the store's public API; same rules as resolveWikiLink.
 */
export function resolveTarget(
  target: string,
  documents: DocRecord[]
): string | null {
  return resolveWikiLink(target, null, documents)?.id ?? null;
}

// --- Link Index ---

/**
 * Build a complete link index from a set of documents.
 */
export function buildLinkIndex(documents: DocRecord[]): LinkIndex {
  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  const unresolved = new Map<string, UnresolvedLink[]>();
  const contexts = new Map<string, string>();
  const resolve = createWikiResolver(documents);

  for (const doc of documents) {
    const links = scanWikiLinks(doc.canonical);
    const forwardSet = new Set<string>();
    const unresolvedList: UnresolvedLink[] = [];

    for (const link of links) {
      const targetId = resolve(link.target, link.anchor)?.id ?? null;
      if (targetId && targetId !== doc.id) {
        forwardSet.add(targetId);

        // Build reverse
        if (!reverse.has(targetId)) reverse.set(targetId, new Set());
        reverse.get(targetId)!.add(doc.id);

        // Store context (paragraph containing the link)
        const ctx = findLinkContext(doc.canonical, link.raw);
        if (ctx) {
          contexts.set(`${doc.id}→${targetId}`, ctx);
        }
      } else if (!targetId) {
        unresolvedList.push({
          target: link.target,
          displayText: link.displayText,
          ...(link.anchor ? { anchor: link.anchor } : {}),
        });
      }
    }

    if (forwardSet.size > 0) forward.set(doc.id, forwardSet);
    if (unresolvedList.length > 0) unresolved.set(doc.id, unresolvedList);
  }

  return { forward, reverse, unresolved, contexts };
}

/**
 * Update the link index for a single document (after save).
 */
export function updateDocInIndex(
  index: LinkIndex,
  doc: DocRecord,
  allDocuments: DocRecord[]
): LinkIndex {
  const { forward, reverse, unresolved, contexts } = index;

  // Remove old forward links from this doc
  const oldForward = forward.get(doc.id);
  if (oldForward) {
    for (const targetId of oldForward) {
      const revSet = reverse.get(targetId);
      if (revSet) {
        revSet.delete(doc.id);
        if (revSet.size === 0) reverse.delete(targetId);
      }
      contexts.delete(`${doc.id}→${targetId}`);
    }
  }

  // Scan new links
  const links = scanWikiLinks(doc.canonical);
  const newForward = new Set<string>();
  const newUnresolved: UnresolvedLink[] = [];
  const resolve = createWikiResolver(allDocuments);

  for (const link of links) {
    const targetId = resolve(link.target, link.anchor)?.id ?? null;
    if (targetId && targetId !== doc.id) {
      newForward.add(targetId);
      if (!reverse.has(targetId)) reverse.set(targetId, new Set());
      reverse.get(targetId)!.add(doc.id);

      const ctx = findLinkContext(doc.canonical, link.raw);
      if (ctx) contexts.set(`${doc.id}→${targetId}`, ctx);
    } else if (!targetId) {
      newUnresolved.push({
        target: link.target,
        displayText: link.displayText,
        ...(link.anchor ? { anchor: link.anchor } : {}),
      });
    }
  }

  if (newForward.size > 0) forward.set(doc.id, newForward);
  else forward.delete(doc.id);

  if (newUnresolved.length > 0) unresolved.set(doc.id, newUnresolved);
  else unresolved.delete(doc.id);

  return index;
}

/**
 * Get backlinks for a document.
 * Returns [{ docId, title, context }]
 */
export function getBacklinks(
  index: LinkIndex,
  docId: string,
  allDocuments: DocRecord[]
): { docId: string; title: string; context: string }[] {
  const sourceIds = index.reverse.get(docId);
  if (!sourceIds || sourceIds.size === 0) return [];

  return [...sourceIds].map((sourceId) => {
    const doc = allDocuments.find((d) => d.id === sourceId);
    return {
      docId: sourceId,
      title: doc?.title ?? "Untitled",
      context: index.contexts.get(`${sourceId}→${docId}`) ?? "",
    };
  });
}

/**
 * Get forward links from a document.
 */
export function getForwardLinks(
  index: LinkIndex,
  docId: string,
  allDocuments: DocRecord[]
): { docId: string; title: string }[] {
  const targetIds = index.forward.get(docId);
  if (!targetIds || targetIds.size === 0) return [];

  return [...targetIds].map((targetId) => {
    const doc = allDocuments.find((d) => d.id === targetId);
    return {
      docId: targetId,
      title: doc?.title ?? "Untitled",
    };
  });
}

// --- Graph export ---

export interface GraphNode {
  id: string;
  title: string;
  tags: string[];
  metadata: Record<string, unknown>;
  created?: string;
  updated?: string;
  wordCount: number;
  backlinks: number;
  forwardLinks: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  context: string;
}

/**
 * Export the full document graph as JSON.
 */
export function exportGraph(
  documents: DocRecord[],
  index: LinkIndex
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = documents.map((d) => ({
    id: d.id,
    title: d.title ?? "Untitled",
    tags: d.tags ?? [],
    metadata: d.metadata ?? {},
    created: d.created,
    updated: d.updated,
    wordCount: d.wordCount ?? 0,
    backlinks: index.reverse.get(d.id)?.size ?? 0,
    forwardLinks: index.forward.get(d.id)?.size ?? 0,
  }));

  const edges: GraphEdge[] = [];
  for (const [sourceId, targets] of index.forward) {
    for (const targetId of targets) {
      edges.push({
        source: sourceId,
        target: targetId,
        context: index.contexts.get(`${sourceId}→${targetId}`) ?? "",
      });
    }
  }

  return { nodes, edges };
}

// --- Helpers ---

/**
 * Find the text context around a wiki link in PM JSON.
 * Returns the paragraph text containing the link (trimmed to ~120 chars).
 */
function findLinkContext(
  canonical: { content?: PMNode[] } | null | undefined,
  rawLink: string
): string {
  if (!canonical?.content) return "";
  for (const node of canonical.content) {
    const text = extractText(node as PMNode);
    if (text.includes(rawLink.replace(/\[\[|\]\]/g, ""))) {
      // Return surrounding text, trimmed
      const clean = text.replace(/\s+/g, " ").trim();
      return clean.length > 120 ? clean.slice(0, 117) + "…" : clean;
    }
  }
  return "";
}
