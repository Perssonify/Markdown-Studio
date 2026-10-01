/**
 * Prompt builder: formats documents as structured prompt blocks for LLM consumption.
 *
 * Output format:
 *   <documents>
 *     <document title="..." tags="..." id="..." updated="...">
 *       [content]
 *     </document>
 *   </documents>
 *
 * Includes metadata, fields, and relationship context when available.
 */

import { extractText, type DocumentRecord, type PMNode } from "../store/document";

// --- Types ---

export type PromptFormat = "markdown" | "text" | "json";

export interface FormatDocumentOpts {
  format?: PromptFormat;
  markdown?: string | null;
  relationships?: {
    forward?: { target?: string; targetTitle?: string; type?: string }[];
    backward?: { source?: string; sourceTitle?: string; type?: string }[];
  } | null;
}

export interface FormatDocumentsOpts {
  format?: PromptFormat;
  preamble?: string | null;
  graphSummary?: {
    nodeCount: number;
    edgeCount: number;
    clusters?: { name?: string; id?: string }[];
  } | null;
}

export interface PromptItem {
  doc: DocumentRecord;
  markdown?: string;
  relationships?: FormatDocumentOpts["relationships"];
}

export interface BuildContextOpts {
  format?: PromptFormat;
  mdConverter?: ((doc: DocumentRecord) => string) | null;
  includeBacklinks?: boolean;
  maxDocs?: number;
}

// --- Utils ---

function escapeAttr(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXml(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Format a single document as a prompt block.
 */
export function formatDocumentForPrompt(
  doc: DocumentRecord,
  opts: FormatDocumentOpts = {}
): string {
  const { format = "markdown", markdown = null, relationships = null } = opts;

  const attrs: string[] = [`title="${escapeAttr(doc.title)}"`];
  if (doc.id) attrs.push(`id="${escapeAttr(doc.id)}"`);
  if (doc.tags?.length) attrs.push(`tags="${doc.tags.join(",")}"`);
  if (doc.updated) attrs.push(`updated="${doc.updated}"`);
  if (doc.origin?.format) attrs.push(`origin_format="${doc.origin.format}"`);

  let content: string;
  switch (format) {
    case "markdown":
      content = markdown ?? extractText(doc.canonical as PMNode);
      break;
    case "text":
      content = extractText(doc.canonical as PMNode);
      break;
    case "json":
      content = JSON.stringify(doc.canonical, null, 2);
      break;
    default:
      content = extractText(doc.canonical as PMNode);
  }

  const metaLines: string[] = [];
  if (doc.metadata && Object.keys(doc.metadata).length > 0) {
    metaLines.push("<metadata>");
    for (const [key, value] of Object.entries(doc.metadata)) {
      metaLines.push(
        `  <field key="${escapeAttr(key)}">${escapeXml(String(value))}</field>`
      );
    }
    metaLines.push("</metadata>");
  }

  const relLines: string[] = [];
  if (relationships) {
    if (
      (relationships.forward?.length ?? 0) > 0 ||
      (relationships.backward?.length ?? 0) > 0
    ) {
      relLines.push("<relationships>");
      for (const link of relationships.forward ?? []) {
        relLines.push(
          `  <link direction="outgoing" target="${escapeAttr(link.targetTitle ?? link.target ?? "")}" type="${link.type ?? "wiki-link"}" />`
        );
      }
      for (const link of relationships.backward ?? []) {
        relLines.push(
          `  <link direction="incoming" source="${escapeAttr(link.sourceTitle ?? link.source ?? "")}" type="${link.type ?? "wiki-link"}" />`
        );
      }
      relLines.push("</relationships>");
    }
  }

  const residualLines: string[] = [];
  if ((doc.residuals?.length ?? 0) > 0) {
    const residuals = doc.residuals as { type?: string }[];
    residualLines.push(`<processing_notes>`);
    residualLines.push(
      `  ${residuals.length} element(s) from original input could not be fully processed.`
    );
    const types = [...new Set(residuals.map((r) => r.type))];
    residualLines.push(`  Types: ${types.join(", ")}`);
    residualLines.push(`</processing_notes>`);
  }

  const parts: string[] = [`<document ${attrs.join(" ")}>`];
  if (metaLines.length) parts.push(metaLines.join("\n"));
  if (relLines.length) parts.push(relLines.join("\n"));
  if (residualLines.length) parts.push(residualLines.join("\n"));
  parts.push(content);
  parts.push("</document>");

  return parts.join("\n");
}

/**
 * Format multiple documents as a prompt block.
 */
export function formatDocumentsForPrompt(
  items: PromptItem[],
  opts: FormatDocumentsOpts = {}
): string {
  const { format = "markdown", preamble = null, graphSummary = null } = opts;

  const parts: string[] = [];

  if (preamble) {
    parts.push(preamble);
    parts.push("");
  }

  if (graphSummary) {
    parts.push("<knowledge_graph_summary>");
    parts.push(`  Documents: ${graphSummary.nodeCount}`);
    parts.push(`  Links: ${graphSummary.edgeCount}`);
    if (graphSummary.clusters) {
      parts.push(
        `  Clusters: ${graphSummary.clusters.map((c) => c.name ?? c.id ?? "").join(", ")}`
      );
    }
    parts.push("</knowledge_graph_summary>");
    parts.push("");
  }

  parts.push("<documents>");

  for (const item of items) {
    parts.push(
      formatDocumentForPrompt(item.doc, {
        format,
        markdown: item.markdown ?? null,
        relationships: item.relationships ?? null,
      })
    );
  }

  parts.push("</documents>");

  return parts.join("\n");
}

/**
 * The documents linked to `activeId` in either direction, as prompt items.
 *
 * `getDocById` is asynchronous (it reads storage). The integration's
 * copyAsPrompt used to call it without `await`, so each "linked document" it
 * handed the formatter was a pending Promise — truthy, with no title or
 * content. A document that fails to load is skipped, not fatal: an unreadable
 * record now throws (A029) rather than reading as missing.
 */
export async function linkedPromptItems(
  edges: { source: string; target: string }[],
  activeId: string,
  getDocById: (id: string) => Promise<DocumentRecord | null> | DocumentRecord | null | undefined
): Promise<PromptItem[]> {
  const ids = new Set<string>();
  for (const edge of edges) {
    if (edge.source === activeId && edge.target !== activeId) ids.add(edge.target);
    if (edge.target === activeId && edge.source !== activeId) ids.add(edge.source);
  }
  const items: PromptItem[] = [];
  for (const id of ids) {
    try {
      const doc = await getDocById(id);
      if (doc) items.push({ doc });
    } catch {
      /* unreadable — leave it out of the prompt */
    }
  }
  return items;
}

/**
 * Build a prompt from the active document and its linked neighbors.
 */
export async function buildContextPrompt(
  activeDoc: DocumentRecord,
  docStore: { get: (id: string) => Promise<DocumentRecord | null> },
  linkIndex: { forward?: Map<string, Set<string>>; reverse?: Map<string, Set<string>> },
  opts: BuildContextOpts = {}
): Promise<string> {
  const {
    format = "markdown",
    mdConverter = null,
    includeBacklinks = true,
    maxDocs = 20,
  } = opts;

  const items: PromptItem[] = [];
  const seen = new Set<string>();

  const addDoc = async (docId: string): Promise<void> => {
    if (seen.has(docId) || items.length >= maxDocs) return;
    seen.add(docId);
    const doc = await docStore.get(docId);
    if (!doc) return;

    const forward = linkIndex.forward?.get(docId);
    const backward = linkIndex.reverse?.get(docId);
    items.push({
      doc,
      markdown: mdConverter ? mdConverter(doc) : undefined,
      relationships: {
        forward: forward
          ? [...forward].map((id) => ({ target: id, targetTitle: id }))
          : [],
        backward: backward
          ? [...backward].map((id) => ({ source: id, sourceTitle: id }))
          : [],
      },
    });
  };

  await addDoc(activeDoc.id);

  const forward = linkIndex.forward?.get(activeDoc.id);
  if (forward) {
    for (const targetId of forward) {
      await addDoc(targetId);
    }
  }

  if (includeBacklinks) {
    const backward = linkIndex.reverse?.get(activeDoc.id);
    if (backward) {
      for (const sourceId of backward) {
        await addDoc(sourceId);
      }
    }
  }

  return formatDocumentsForPrompt(items, {
    format,
    preamble: `The following documents are from a knowledge base. The primary document is "${activeDoc.title}".`,
    graphSummary: {
      nodeCount: items.length,
      edgeCount: items.reduce(
        (n, item) =>
          n +
          (item.relationships?.forward?.length ?? 0) +
          (item.relationships?.backward?.length ?? 0),
        0
      ),
    },
  });
}
