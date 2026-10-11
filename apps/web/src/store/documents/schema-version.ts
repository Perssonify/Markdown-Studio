/**
 * Content schema versioning — what stops a document written by a NEWER build
 * from opening blank (and then being overwritten) in an older one.
 *
 * The canonical is ProseMirror JSON, and the live editor loads it with
 * `setContent`. Handed a node or mark type its schema does not have, TipTap
 * does not skip the unknown part: `schema.nodeFromJSON` throws, TipTap logs a
 * warning and loads an EMPTY document instead — every paragraph gone, not just
 * the unknown one (measured). Then the next keystroke's autosave wrote that
 * near-empty editor over the stored document. That happens after a deploy
 * rollback, with an old tab open beside a new one, or on importing JSON
 * exported by a newer version.
 *
 * So: records and exports carry `schemaVersion`; content that does not fit
 * the live schema, or claims a newer version than this build's, is shown as a
 * best-effort READ-ONLY copy and never marked hydrated (so no save path can
 * write the display copy over the real thing).
 */
import type { Schema } from "@tiptap/pm/model";

/**
 * The canonical format this build writes. Bump it when a change makes stored
 * content unreadable to OLDER builds — a node or mark they do not have, or an
 * attribute whose meaning changes — so those builds open it read-only instead
 * of blank.
 */
export const CURRENT_SCHEMA_VERSION = 1;

/** Does a record or export claim a schema newer than this build understands? */
export function isNewerSchema(version: unknown): boolean {
  return typeof version === "number" && Number.isFinite(version) && version > CURRENT_SCHEMA_VERSION;
}

/**
 * Why `canonical` cannot be loaded into `schema` as it is, or null when it
 * can. This is exactly the check TipTap's `setContent` performs before it
 * falls back to an empty document (`nodeFromJSON`); content-expression
 * validity (`node.check()`) is deliberately NOT required, because TipTap never
 * required it either and existing documents that are loose on that point open
 * fine today.
 */
export function canonicalMisfit(canonical: unknown, schema: Schema): string | null {
  try {
    schema.nodeFromJSON(canonical as Parameters<Schema["nodeFromJSON"]>[0]);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

interface JsonNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  content?: JsonNode[];
}

/**
 * A DISPLAY copy of content that does not fit `schema`: marks the schema lacks
 * are dropped, and a node type it lacks is replaced by its children (or, for a
 * leaf, its text in a paragraph) — so the words stay readable. Never persisted:
 * the original stays on disk untouched.
 */
export function coerceToSchema(canonical: unknown, schema: Schema): JsonNode {
  const fixMarks = (marks: JsonNode["marks"]) =>
    marks?.filter((m) => !!m?.type && !!schema.marks[m.type]);

  const walk = (node: JsonNode): JsonNode[] => {
    if (!node || typeof node !== "object") return [];
    if (node.type === "text") {
      if (!node.text) return [];
      const marks = fixMarks(node.marks);
      return [{ ...node, ...(marks && marks.length ? { marks } : { marks: undefined }) }];
    }
    const children = (node.content ?? []).flatMap(walk);
    if (!node.type || !schema.nodes[node.type]) {
      // Unknown node: keep what it contains. A block wrapper's children are
      // blocks already; a leaf with text becomes a paragraph of that text.
      if (children.length) return children;
      const text = typeof node.text === "string" ? node.text : "";
      return text ? [{ type: "paragraph", content: [{ type: "text", text }] }] : [];
    }
    const marks = fixMarks(node.marks);
    return [{
      ...node,
      ...(node.content ? { content: children } : {}),
      ...(marks ? { marks } : {}),
    }];
  };

  const root = (canonical ?? {}) as JsonNode;
  const content = (root.content ?? []).flatMap(walk);
  const candidate: JsonNode = { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
  // Whatever still refuses to load (a known node missing a required attribute,
  // say) degrades to its plain text rather than to nothing at all.
  if (!canonicalMisfit(candidate, schema)) return candidate;
  const text: string[] = [];
  const collect = (n: JsonNode) => {
    if (n?.type === "text" && n.text) text.push(n.text);
    (n?.content ?? []).forEach(collect);
  };
  collect(root);
  return {
    type: "doc",
    content: text.length
      ? text.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] }))
      : [{ type: "paragraph" }],
  };
}
