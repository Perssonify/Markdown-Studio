/**
 * Finish an ingest WITHOUT the live editor.
 *
 * `ingest()` produces a document plus sanitised HTML, and the canonical used to
 * be captured by BORROWING the live editor: activate the new document, push the
 * HTML into the rich pane, yield a frame, read `getJSON()` back. Every one of
 * those steps can be overtaken by the user — a click in the library during the
 * yield hydrated THEIR document, and the fallback then persisted the file's
 * pre-editor canonical (an empty "Untitled") as a successful import. Parsing
 * the HTML against the schema directly produces the same ProseMirror JSON with
 * no editor, no yield and nothing to race.
 */
import type { Schema } from "@tiptap/pm/model";
import { htmlToCanonical } from "./canonical-ops";
import { completeIngest } from "./ingest";
import type { DocumentRecord } from "./document";

/** Set `doc.canonical` (and its title) from its ingest HTML, headlessly. A
 *  document with no ingest HTML (a `pmjson` payload) already has its canonical
 *  and is returned untouched. */
export function captureIngestHeadless<T extends DocumentRecord>(doc: T, schema: Schema): T {
  if (!doc._ingestHtml) return doc;
  const canonical = htmlToCanonical(doc._ingestHtml, schema);
  completeIngest(doc, { getJSON: () => canonical as DocumentRecord["canonical"] });
  return doc;
}
