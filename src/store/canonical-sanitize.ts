import type { PMNode } from "./document";
import { isDangerousUrl } from "../utils/url-safety";
import { sanitizeCssColor, sanitizeFontFamily, sanitizeTextAlign } from "../engine/css-safety";

// Compared lower-cased. `lightsrc`/`darksrc` are the themeImage node's two
// image URLs: they render as <img src> and <source srcset>.
const URL_ATTRS = new Set(["href", "src", "xlink:href", "lightsrc", "darksrc"]);

/**
 * Attributes the editor's extensions interpolate into a `style` attribute:
 * `color` / `backgroundColor` / `fontFamily` on the textStyle mark,
 * `textAlign` on paragraphs and headings, `align` on table cells, and the
 * cell column widths the table view writes into `<col style="width: …">`.
 * ProseMirror trusts JSON attrs verbatim and those renderers concatenate them
 * unchecked, so a crafted `.json`/backup import or a host update could carry
 * `color: "red; position: fixed; inset: 0; …"` and render a full-screen
 * overlay (with a link mark on it, one that redirects every click). A value
 * that is not the kind of value its attribute holds is dropped — the schema
 * default (no style) takes its place.
 */
function sanitizeStyleAttr(key: string, value: unknown): { keep: boolean; value?: unknown } {
  if (value == null) return { keep: true, value };
  switch (key) {
    case "color":
    case "backgroundColor": {
      const v = sanitizeCssColor(String(value));
      return v ? { keep: true, value: v } : { keep: false };
    }
    case "fontFamily": {
      const v = sanitizeFontFamily(value);
      return v ? { keep: true, value: v } : { keep: false };
    }
    case "textAlign":
    case "align": {
      const v = sanitizeTextAlign(value);
      return v ? { keep: true, value: v } : { keep: false };
    }
    case "colwidth":
      return Array.isArray(value) && value.every((w) => typeof w === "number" && Number.isFinite(w))
        ? { keep: true, value }
        : { keep: false };
    default:
      return { keep: true, value };
  }
}

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
        continue;
      }
      const styled = sanitizeStyleAttr(key, attrs[key]);
      if (!styled.keep) delete attrs[key];
      else attrs[key] = styled.value;
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
