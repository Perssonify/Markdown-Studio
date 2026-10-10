/**
 * Pure full-text search across documents. Ranks title matches first, then by the
 * number of body occurrences, and returns a single highlighted snippet around the
 * first body match. UI-agnostic and easily testable; the editor supplies the doc
 * list (id, title, plain-text body) and renders the results.
 */

export interface SearchDoc {
  id: string;
  title: string;
  text: string;
}

export interface SearchSnippet {
  before: string;
  match: string;
  after: string;
}

export interface SearchResult {
  id: string;
  title: string;
  titleMatch: boolean;
  count: number;
  snippet: SearchSnippet | null;
}

const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 90;

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function makeSnippet(text: string, lowerText: string, lowerQuery: string): SearchSnippet | null {
  const at = lowerText.indexOf(lowerQuery);
  if (at === -1) return null;
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(text.length, at + lowerQuery.length + SNIPPET_AFTER);
  const before = (start > 0 ? "…" : "") + text.slice(start, at).replace(/\s+/g, " ");
  const match = text.slice(at, at + lowerQuery.length);
  const after = text.slice(at + lowerQuery.length, end).replace(/\s+/g, " ") + (end < text.length ? "…" : "");
  return { before, match, after };
}

export function searchDocuments(
  docs: SearchDoc[],
  query: string,
  limit = 50
): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results: SearchResult[] = [];
  for (const doc of docs) {
    const title = doc.title || "Untitled";
    const titleMatch = title.toLowerCase().includes(q);
    const text = doc.text || "";
    const lowerText = text.toLowerCase();
    const count = countOccurrences(lowerText, q);
    if (!titleMatch && count === 0) continue;
    results.push({
      id: doc.id,
      title,
      titleMatch,
      count,
      snippet: makeSnippet(text, lowerText, q),
    });
  }

  results.sort((a, b) => {
    // Title matches rank first, then more body hits, then title A→Z.
    if (a.titleMatch !== b.titleMatch) return a.titleMatch ? -1 : 1;
    if (b.count !== a.count) return b.count - a.count;
    return a.title.localeCompare(b.title);
  });

  return results.slice(0, limit);
}
