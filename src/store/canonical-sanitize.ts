import type { PMNode } from "./document";
import { isDangerousUrl } from "../utils/url-safety";

const URL_ATTRS = new Set(["href", "src", "xlink:href"]);

/** Deeper than any real ProseMirror document; guards against a hostile,
 *  pathologically-nested pmjson import overflowing the recursion stack. */
const MAX_CANONICAL_DEPTH = 200;

export function sanitizeCanonicalNode<T extends PMNode | null | undefined>(node: T, depth = 0): T {
  if (!node || typeof node !== "object") return node;

  const next: PMNode = { ...node };

  if (depth > MAX_CANONICAL_DEPTH) {
    // Drop content below the limit rather than recurse into a stack overflow.
    delete (next as { content?: unknown }).content;
    return next as T;
  }

  const sanitizeAttrs = (input: unknown): Record<string, unknown> | undefined => {
    if (!input || typeof input !== "object") return input as undefined;
    const attrs: Record<string, unknown> = { ...(input as Record<string, unknown>) };
    for (const key of Object.keys(attrs)) {
      if (URL_ATTRS.has(key.toLowerCase()) && isDangerousUrl(attrs[key])) {
        delete attrs[key];
      }
    }
    return attrs;
  };

  if (next.attrs && typeof next.attrs === "object") {
    next.attrs = sanitizeAttrs(next.attrs) as PMNode["attrs"];
  }

  // Marks carry their own attrs — a link's href lives on a mark, not the node,
  // so it must be sanitized too (ProseMirror's Node.fromJSON trusts these).
  if (Array.isArray((next as { marks?: unknown[] }).marks)) {
    (next as { marks: Array<{ attrs?: unknown }> }).marks = (
      next as { marks: Array<{ attrs?: unknown }> }
    ).marks.map((mark) =>
      mark && typeof mark === "object" && mark.attrs
        ? { ...mark, attrs: sanitizeAttrs(mark.attrs) }
        : mark
    );
  }

  if (Array.isArray(next.content)) {
    next.content = next.content.map((child) => sanitizeCanonicalNode(child, depth + 1));
  }

  return next as T;
}
