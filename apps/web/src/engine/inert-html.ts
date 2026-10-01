import { DOMSerializer, type Fragment, type Schema } from "@tiptap/pm/model";

/**
 * Document content as HTML, serialized INTO an inert document — never the
 * page's.
 *
 * An element created by the live document loads its resources the moment it
 * gets them, attached or not. TipTap's `getHTML()` / `generateHTML()` call
 * ProseMirror's serializer with the page's document and only then move the
 * result into an inert one, so every `<img>` they build starts fetching its
 * `src`: a stored image's `pf-asset:` reference (A086) — which WebKit reports as
 * a failed load, and an enforced CSP as a violation — and a remote image the
 * user may have chosen to block, requested behind their back on an export.
 * The markup is identical; only the document the nodes are built in differs.
 */
let inertDoc: Document | null = null;

export function inertDocument(): Document {
  return (inertDoc ??= document.implementation.createHTMLDocument(""));
}

/** `getHTMLFromFragment`'s output, built in an inert document. */
export function fragmentToHtml(fragment: Fragment, schema: Schema): string {
  const doc = inertDocument();
  const dom = DOMSerializer.fromSchema(schema).serializeFragment(fragment, { document: doc });
  const box = doc.createElement("div");
  box.appendChild(dom);
  return box.innerHTML;
}
