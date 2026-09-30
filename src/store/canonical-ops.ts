/**
 * Headless canonical (ProseMirror JSON) operations.
 *
 * The canonical source of truth is ProseMirror JSON living inside the live TipTap
 * editor; markdown is a projection. To edit a document that is NOT currently open
 * without churning the visible editor (see updateDocument / appendToDocument on the
 * host bridge), we convert HTML → PM JSON using the *live editor's real schema*.
 *
 * Borrowing the mounted editor's schema (rather than re-declaring the extension
 * list) guarantees the parsed nodes match exactly what the editor would produce —
 * custom nodes (math, field blocks, transclusions, emoji, …) included — so the
 * conversion never silently diverges when the extension set changes.
 */
import type { JSONContent } from "@tiptap/core";
import { DOMParser as PMDOMParser, type Schema } from "@tiptap/pm/model";

export interface CanonicalDoc {
  type: "doc";
  content: JSONContent[];
}

/** Parse an HTML string into a canonical `doc` node JSON using the given schema. */
export function htmlToCanonical(html: string, schema: Schema): CanonicalDoc {
  // Parse in an INERT document (DOMParser) rather than assigning innerHTML on a
  // live element. A live element would kick off resource loads (`<img
  // src=x onerror=…>`) and is a mutation-XSS surface; DOMParser's document is
  // never connected to a browsing context, so nothing loads or executes. The
  // ProseMirror schema then keeps only known nodes/marks/attrs.
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const node = PMDOMParser.fromSchema(schema).parse(parsed.body);
  const json = node.toJSON() as CanonicalDoc;
  if (!json || json.type !== "doc" || !Array.isArray(json.content)) {
    return { type: "doc", content: [] };
  }
  return json;
}

/** Normalize any stored canonical value into a `{type:"doc", content:[]}` shape. */
export function asCanonicalDoc(canonical: unknown): CanonicalDoc {
  const c = canonical as { type?: unknown; content?: unknown } | null | undefined;
  if (c && c.type === "doc" && Array.isArray(c.content)) {
    return canonical as CanonicalDoc;
  }
  return { type: "doc", content: [] };
}

/** Append the block content of `html` (parsed via `schema`) to an existing doc. */
export function appendHtmlToCanonical(
  existing: unknown,
  html: string,
  schema: Schema
): CanonicalDoc {
  const base = asCanonicalDoc(existing);
  const added = htmlToCanonical(html, schema);
  return { type: "doc", content: [...base.content, ...added.content] };
}
