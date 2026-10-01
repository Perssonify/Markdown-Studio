/**
 * TransclusionBlock — custom Tiptap node for embedding content from another document.
 *
 * Canonical PM JSON form:
 * {
 * type: "transclusionBlock",
 * attrs: {
 * target: "doc-id-or-title",
 * section: "Heading Name" | null,
 * blockId: "^abc123" | null,
 * resolvedId: "actual-doc-id" | null,  // filled after resolution
 * cachedHtml: "<p>...</p>" | null,      // rendered content snapshot
 * error: null | "not-found" | "circular" | "load-failed"
 * }
 * }
 *
 * Markdown serialization:
 * ![[Document Title]]            — embed entire doc
 * ![[Document Title#Section]]    — embed section under heading
 * ![[doc-id#^block-abc]]         — embed specific block
 *
 * Rendering: shows the embedded content with a subtle border and source link.
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { DOMOutputSpec } from "prosemirror-model";

export interface TransclusionAttrs {
  target: string;
  section: string | null;
  blockId: string | null;
  resolvedId: string | null;
  cachedHtml: string | null;
  error: "not-found" | "circular" | "load-failed" | null;
}

export interface ProseMirrorJSONNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorJSONNode[];
  text?: string;
  [key: string]: unknown;
}

export interface CanonicalDocument {
  content?: ProseMirrorJSONNode[];
  [key: string]: unknown;
}

export interface DocumentRecord {
  id: string;
  canonical?: CanonicalDocument;
  [key: string]: unknown;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    transclusionBlock: {
      insertTransclusion: (target: string, section?: string | null, blockId?: string | null) => ReturnType;
    };
  }
}

export const TransclusionBlock = Node.create({
  name: "transclusionBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      target: { default: "" },
      section: { default: null },
      blockId: { default: null },
      resolvedId: { default: null },
      cachedHtml: { default: null },
      error: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="transclusion"]' }];
  },

  renderHTML({ HTMLAttributes }): DOMOutputSpec {
    const { target, section, blockId, cachedHtml, error } = HTMLAttributes as TransclusionAttrs;

    // Build reference string
    let ref = target || "?";
    if (section) ref += "#" + section;
    if (blockId) ref += "#^" + blockId;

    // Error states
    if (error === "not-found") {
      return [
        "div", 
        mergeAttributes(HTMLAttributes, {
          "data-type": "transclusion",
          class: "transclusion-block transclusion-error my-3 rounded-lg border border-dashed border-destructive/30 bg-destructive/5 p-3 px-4",
        }),
        ["div", { class: "mb-1 text-[10px] text-destructive/60" }, `⚠ Not found: ![[${ref}]]`],
        ["div", { class: "text-[0.85em] opacity-50 text-foreground" }, "The referenced document could not be resolved."],
      ];
    }

    if (error === "circular") {
      return [
        "div", 
        mergeAttributes(HTMLAttributes, {
          "data-type": "transclusion",
          class: "transclusion-block transclusion-error my-3 rounded-lg border border-dashed border-destructive/30 bg-destructive/5 p-3 px-4",
        }),
        ["div", { class: "text-[10px] text-destructive/60" }, `↻ Circular reference: ![[${ref}]]`],
      ];
    }

    // Normal rendering
    return [
      "div", 
      mergeAttributes(HTMLAttributes, {
        "data-type": "transclusion",
        class: "transclusion-block my-3 rounded-r-lg border-l-[3px] border-primary/30 bg-primary/5 py-2 px-4 text-foreground",
      }),
      [
        "div", 
        { class: "mb-1.5 flex items-center gap-1.5 text-[10px] text-primary/60" },
        ["span", {}, `📎 ![[${ref}]]`],
        ["span", { class: "text-[9px] opacity-50" }, "transcluded"],
      ],
      // Content placeholder — will be filled by the resolver
      ...(cachedHtml
        ? [["div", { class: "transclusion-content text-[0.9em]" }] as DOMOutputSpec]
        : [["div", { class: "text-[0.85em] italic opacity-40" }, "Loading..."] as DOMOutputSpec]
      ),
    ];
  },

  addCommands() {
    return {
      insertTransclusion: (target: string, section: string | null = null, blockId: string | null = null) => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs: { target, section, blockId },
        });
      },
    };
  },
});

/**
 * Resolve transclusions in a document.
 *
 * Walks the PM JSON tree, finds transclusionBlock nodes, resolves their targets,
 * extracts the relevant content, and returns an updated tree with cachedHtml filled in.
 *
 * @param canonical — PM JSON document
 * @param allDocs — all documents for resolution
 * @param resolveTarget — (target, docs) => docId | null
 * @param visitedIds — for circular reference detection
 * @returns updated PM JSON with resolved transclusions
 */
export function resolveTransclusions(
  canonical: CanonicalDocument | null | undefined,
  allDocs: DocumentRecord[],
  resolveTarget: (target: string, docs: DocumentRecord[]) => string | null,
  visitedIds: Set<string> = new Set()
): CanonicalDocument | null | undefined {
  if (!canonical?.content) return canonical;

  const resolved: CanonicalDocument = {
    ...canonical,
    content: canonical.content.map((node) => {
      if (node.type !== "transclusionBlock") return node;

      const { target, section, blockId } = (node.attrs || {}) as Partial<TransclusionAttrs>;
      const docId = resolveTarget(target as string, allDocs);

      if (!docId) {
        return { ...node, attrs: { ...node.attrs, error: "not-found" } };
      }

      // Circular reference check
      if (visitedIds.has(docId)) {
        return { ...node, attrs: { ...node.attrs, resolvedId: docId, error: "circular" } };
      }

      const sourceDoc = allDocs.find(d => d.id === docId);
      if (!sourceDoc?.canonical) {
        return { ...node, attrs: { ...node.attrs, resolvedId: docId, error: "load-failed" } };
      }

      // Extract the relevant section
      let content: ProseMirrorJSONNode[];
      if (section) {
        content = extractSection(sourceDoc.canonical, section);
      } else if (blockId) {
        content = extractBlock(sourceDoc.canonical, blockId);
      } else {
        content = sourceDoc.canonical.content || [];
      }

      // Recursively resolve nested transclusions (with cycle detection)
      const newVisited = new Set(visitedIds);
      newVisited.add(docId);
      
      const resolvedContent: CanonicalDocument = {
        type: "doc",
        content: content || [],
      };
      
      const deepResolved = resolveTransclusions(resolvedContent, allDocs, resolveTarget, newVisited);

      return {
        ...node,
        attrs: {
          ...node.attrs,
          resolvedId: docId,
          cachedHtml: JSON.stringify(deepResolved?.content || []),
          error: null,
        },
      };
    }),
  };

  return resolved;
}

/**
 * Extract content under a heading from PM JSON.
 */
function extractSection(canonical: CanonicalDocument, headingText: string): ProseMirrorJSONNode[] {
  if (!canonical?.content) return [];
  const nodes = canonical.content;
  let collecting = false;
  let level = 0;
  const result: ProseMirrorJSONNode[] = [];

  for (const node of nodes) {
    if (node.type === "heading") {
      const text = extractNodeText(node).trim().toLowerCase();
      if (!collecting && text === headingText.toLowerCase()) {
        collecting = true;
        level = Number(node.attrs?.["level"]) || 1;
        result.push(node);
        continue;
      }
      if (collecting && (Number(node.attrs?.["level"]) || 1) <= level) {
        break; // hit a same-level or higher heading — stop
      }
    }
    if (collecting) result.push(node);
  }

  return result;
}

/**
 * Extract a specific block by its blockId attribute.
 */
function extractBlock(canonical: CanonicalDocument, blockId: string): ProseMirrorJSONNode[] {
  if (!canonical?.content) return [];
  for (const node of canonical.content) {
    if (node.attrs?.["blockId"] === blockId) {
      return [node];
    }
  }
  return [];
}

/**
 * Recursively extract text from a node.
 */
function extractNodeText(node: ProseMirrorJSONNode | null | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (!node.content) return "";
  return node.content.map(extractNodeText).join("");
}

/**
 * Serialize a transclusion to markdown.
 */
export function serializeTransclusion(attrs?: Partial<TransclusionAttrs>): string {
  const { target, section, blockId } = attrs || {};
  let ref = target || "?";
  if (section) ref += "#" + section;
  if (blockId) ref += "#^" + blockId;
  return `![[${ref}]]`;
}