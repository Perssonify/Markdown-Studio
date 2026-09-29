/**
 * Extract a heading outline from a document's canonical ProseMirror JSON.
 *
 * Used by the graph view to show a focused document's interior structure
 * (H1 → H2 → H3 …) as connected sub-nodes. Pure and dependency-free so it can
 * run in tests and in the render path cheaply.
 */

export interface OutlineHeading {
  /** Stable-within-doc id: index-based, so it survives identical heading text. */
  id: string;
  level: number;
  text: string;
}

export interface OutlineTreeNode extends OutlineHeading {
  /**
   * Position of this heading in the flat document-order list. Matches the index
   * of the corresponding heading element in the rendered editor DOM, so it can
   * be used to scroll the editor to this heading.
   */
  index: number;
  children: OutlineTreeNode[];
}

interface PMNode {
  type?: string;
  text?: string;
  attrs?: { level?: number; [k: string]: unknown };
  content?: PMNode[];
}

/** Concatenate all descendant text of a node (heading label). */
function textOf(node: PMNode): string {
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map(textOf).join("");
}

/**
 * Walk the top-level (and nested) blocks collecting heading nodes in document
 * order. Returns at most `limit` headings (default 40) to keep the graph legible.
 */
export function extractHeadings(canonical: unknown, limit = 40): OutlineHeading[] {
  const doc = canonical as PMNode | null | undefined;
  if (!doc || !Array.isArray(doc.content)) return [];

  const out: OutlineHeading[] = [];
  let i = 0;

  const visit = (nodes: PMNode[]) => {
    for (const node of nodes) {
      if (out.length >= limit) return;
      if (node?.type === "heading") {
        const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
        const text = textOf(node).trim();
        // Keep EMPTY headings too (as "(untitled)"): they still render as
        // <h*> elements, so skipping them here would shift every subsequent
        // outline index off by one relative to the DOM — heading clicks in the
        // graph would then scroll to the wrong section.
        out.push({ id: `h${i++}`, level, text: text || "(untitled)" });
      } else if (Array.isArray(node?.content)) {
        // Headings can be nested inside blockquotes, list items, etc.
        visit(node.content);
      }
    }
  };

  visit(doc.content);
  return out;
}

/**
 * Build a hierarchy from a flat, document-order heading list by nesting each
 * heading under the most recent heading of a lower level (a standard stack
 * walk). Level *gaps* (e.g. an H1 followed directly by an H3) do not create
 * empty intermediate nodes — the H3 simply nests under the H1 — so the tree
 * reflects real document structure rather than raw heading numbers.
 *
 * Returns the top-level nodes (there can be several, e.g. multiple H1s, or a
 * document that opens at H2). `index` is preserved from the flat list.
 */
export function buildHeadingTree(headings: OutlineHeading[]): OutlineTreeNode[] {
  const roots: OutlineTreeNode[] = [];
  const stack: OutlineTreeNode[] = [];

  headings.forEach((h, index) => {
    const node: OutlineTreeNode = { ...h, index, children: [] };
    // Pop until the stack top is a strictly-shallower heading (its parent).
    while (stack.length && stack[stack.length - 1]!.level >= h.level) stack.pop();
    if (stack.length) stack[stack.length - 1]!.children.push(node);
    else roots.push(node);
    stack.push(node);
  });

  return roots;
}

/**
 * Ancestor chain of the heading at `index` — the flat indices of each enclosing
 * heading from the ROOT down to (but not including) the target. Walks backward
 * to the nearest strictly-shallower heading, repeatedly. Used by the TOC to
 * highlight all parents of the active/selected heading up to the root, and to
 * render the sticky breadcrumb. Returns [] for an invalid index or a top-level
 * heading with no parent.
 */
export function ancestorHeadingIndices(
  headings: Pick<OutlineHeading, "level">[],
  index: number | null | undefined
): number[] {
  if (index == null || index < 0 || index >= headings.length) return [];
  const chain: number[] = [];
  let level = headings[index]!.level;
  for (let i = index - 1; i >= 0 && level > 1; i--) {
    if (headings[i]!.level < level) {
      chain.unshift(i);
      level = headings[i]!.level;
    }
  }
  return chain;
}
