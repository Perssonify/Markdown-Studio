import { extractText, type PMNode } from "./document";

/**
 * Plain-text body of a document for searching/filtering.
 *
 * Prefers the cached markdown (cheap); otherwise derives text from the canonical
 * ProseMirror JSON and memoizes it, keyed by document id + `updated`, so repeated
 * searches over an unchanged library (e.g. every keystroke in the search box)
 * don't re-walk the same canonical trees. Purely in-memory; no I/O.
 */

interface SearchableDoc {
  id: string;
  updated?: string;
  markdownCache?: string | null;
  canonical?: unknown;
}

const cache = new Map<string, { sig: string; text: string; lower?: string }>();

export function docSearchText(doc: SearchableDoc): string {
  const md = doc.markdownCache;
  if (md && md.length) return md;

  const sig = String(doc.updated ?? "");
  const hit = cache.get(doc.id);
  if (hit && hit.sig === sig) return hit.text;

  const text = extractText(doc.canonical as PMNode) ?? "";
  cache.set(doc.id, { sig, text });
  return text;
}

/**
 * Lower-cased body text, memoized alongside the plain text.
 *
 * The library filter compared `docSearchText(d).toLowerCase()` per document per
 * keystroke: the TEXT was cached but the lower-casing was not, so every keypress
 * re-allocated a lower-cased copy of every document body in the library — the
 * one genuinely per-keystroke cost in that path.
 */
export function docSearchTextLower(doc: SearchableDoc): string {
  const text = docSearchText(doc);
  const sig = String(doc.updated ?? "");
  const hit = cache.get(doc.id);
  if (hit && hit.sig === sig && hit.lower !== undefined) return hit.lower;
  const lower = text.toLowerCase();
  // A markdownCache hit skips the text cache entirely, so seed an entry for it.
  cache.set(doc.id, { sig, text, lower });
  return lower;
}
