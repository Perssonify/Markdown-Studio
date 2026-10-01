/**
 * The editor's document as canonical JSON, and that JSON as TEXT, built from
 * caches kept per top-level block (A083).
 *
 * ProseMirror nodes are immutable, so an unchanged block's JSON — and its
 * JSON text — is the one built last time. `editor.getJSON()` rebuilt every
 * block of the document on every projection, and every save then stringified
 * all of it again: at 4 MB, ~0.2 s and ~0.6 s of each autosave under a 4x CPU
 * slowdown, for a document of which a keystroke changed one block.
 *
 * Read, never mutate: the block objects are shared by every canonical built
 * from the same nodes (the stores, the word-count and fidelity caches, the
 * serialized text). Like getJSON()'s — which already shares each node's attrs
 * object with the live document.
 */
import type { Node as PMNode } from "@tiptap/pm/model";

const blockJSON = new WeakMap<PMNode, unknown>();
const blockText = new WeakMap<PMNode, string>();
/** Canonical objects built by canonicalOf → the nodes their `content` was built from. */
const builtFrom = new WeakMap<object, readonly PMNode[]>();

function jsonOfBlock(node: PMNode): unknown {
  let j = blockJSON.get(node);
  if (j === undefined) {
    j = node.toJSON();
    blockJSON.set(node, j);
  }
  return j;
}

/**
 * `editor.getJSON()`, deep-equal (it follows Node.toJSON: type, attrs,
 * content, marks, in that order), with each top-level block's JSON cached on
 * its node. An editor without a document to read (a test's, a host's) gives
 * its own getJSON(). A node's JSON depends on nothing but the node, so one
 * cache serves every editor.
 */
export function canonicalOf(editor: { state?: { doc?: unknown } | null; getJSON(): unknown }): unknown {
  const doc = editor.state?.doc as PMNode | null | undefined;
  if (!doc || typeof doc.forEach !== "function") return editor.getJSON();
  const json: { type: string; attrs?: unknown; content?: unknown[]; marks?: unknown[] } = { type: doc.type.name };
  // (The editor's document has no attributes today, so this cannot be
  // observed; it keeps the JSON Node.toJSON's for any schema.)
  for (const _ in doc.attrs) {
    json.attrs = doc.attrs;
    break;
  }
  if (doc.content.size) {
    const content: unknown[] = [];
    const nodes: PMNode[] = [];
    doc.forEach((child) => {
      content.push(jsonOfBlock(child));
      nodes.push(child);
    });
    json.content = content;
    builtFrom.set(json, nodes);
  }
  if (doc.marks.length) json.marks = doc.marks.map((m) => m.toJSON());
  return json;
}

/**
 * `JSON.stringify(canonical)`, byte for byte — from each block's cached text
 * when `canonical` came from canonicalOf and still holds exactly the blocks it
 * was built with (checked by identity, block by block); otherwise the plain
 * stringify. `canonical-json.test.js` holds the two equal.
 */
export function canonicalJsonText(canonical: unknown): string {
  const c = canonical as { type?: unknown; attrs?: unknown; content?: unknown[]; marks?: unknown } | null;
  const nodes = c && typeof c === "object" ? builtFrom.get(c) : undefined;
  const content = c?.content;
  if (!nodes || !Array.isArray(content) || content.length !== nodes.length) return JSON.stringify(canonical);
  for (let k = 0; k < nodes.length; k++) if (content[k] !== blockJSON.get(nodes[k]!)) return JSON.stringify(canonical);
  // …and no key added since: exactly canonicalOf's, in its order.
  const keys = Object.keys(c!).join();
  const expected = `type${c!.attrs !== undefined ? ",attrs" : ""},content${c!.marks !== undefined ? ",marks" : ""}`;
  if (keys !== expected) return JSON.stringify(canonical);
  const parts: string[] = [];
  for (const node of nodes) {
    let text = blockText.get(node);
    if (text === undefined) {
      text = JSON.stringify(jsonOfBlock(node));
      blockText.set(node, text);
    }
    parts.push(text);
  }
  // The keys canonicalOf sets, in its order — and JSON.stringify's rule that a
  // key whose value has no JSON form is left out.
  let out = `{"type":${JSON.stringify(c!.type)}`;
  if (c!.attrs !== undefined) out += `,"attrs":${JSON.stringify(c!.attrs)}`;
  out += `,"content":[${parts.join(",")}]`;
  if (c!.marks !== undefined) out += `,"marks":${JSON.stringify(c!.marks)}`;
  return out + "}";
}
