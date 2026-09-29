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
  target: string;
  displayText: string;
}

interface UnresolvedLink {
  target: string;
  displayText: string;
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
  // Strip a "#heading" anchor from a reference so the graph/backlinks connect
  // documents, not doc#heading pseudo-targets.
  const docOf = (ref: string) => {
    const h = ref.indexOf("#");
    return (h >= 0 ? ref.slice(0, h) : ref).trim();
  };
  walkNodes(canonical as PMNode, (node: PMNode) => {
    // Rendered internal links: a text node carrying a link mark with a
    // data-doc-link (docLink) attribute. This is how wiki links / heading
    // anchors exist in the canonical once the renderer converts [[…]] → <a>.
    const linkMark = node.marks?.find(
      (m) => (m.type === "link" || m.type === "wikiLink") && m.attrs && "docLink" in m.attrs
    );
    if (linkMark) {
      const target = docOf(String(linkMark.attrs?.["docLink"] ?? ""));
      if (target) {
        links.push({ raw: `[[${target}]]`, target, displayText: node.text ?? target });
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
      const inner = match[1];
      const pipeIdx = inner.indexOf("|");
      const ref = pipeIdx >= 0 ? inner.slice(0, pipeIdx).trim() : inner.trim();
      const display = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : ref;
      const target = docOf(ref);
      if (!target) continue; // pure same-doc anchor — not a document link
      links.push({ raw: match[0], target, displayText: display });
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

/**
 * Resolve a wiki-link target string to a document ID.
 * Tries: exact ID match, then title match (case-insensitive).
 */
export function resolveTarget(
  target: string,
  documents: DocRecord[]
): string | null {
  // Exact ID match
  const byId = documents.find((d) => d.id === target);
  if (byId) return byId.id;

  // Title match (case-insensitive)
  const lower = target.toLowerCase();
  const byTitle = documents.find(
    (d) => (d.title ?? "").toLowerCase() === lower
  );
  if (byTitle) return byTitle.id;

  // Partial title match
  const byPartial = documents.find((d) =>
    (d.title ?? "").toLowerCase().includes(lower)
  );
  if (byPartial) return byPartial.id;

  return null; // unresolved
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

  for (const doc of documents) {
    const links = scanWikiLinks(doc.canonical);
    const forwardSet = new Set<string>();
    const unresolvedList: UnresolvedLink[] = [];

    for (const link of links) {
      const targetId = resolveTarget(link.target, documents);
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

  for (const link of links) {
    const targetId = resolveTarget(link.target, allDocuments);
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
