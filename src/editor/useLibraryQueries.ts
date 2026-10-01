import { useCallback, useRef } from "react";
import { extractHeadings } from "../store/doc-outline";
import { docSearchText, docSearchTextLower } from "../store/doc-text";
import { useDocumentStore } from "../store/documentStore";
import { searchDocuments } from "../store/search";
import { t } from "../i18n";
import type { DocStore, Lifecycle, LinkIndexApi, SyncEngine, UIStore } from "./types";

interface LibraryQueriesParams {
  getCanonical: SyncEngine["getCanonical"];
  /** The link index's already-loaded documents. */
  fullDocsRef: LinkIndexApi["fullDocsRef"];
  documents: DocStore["documents"];
  handleSwitchDoc: Lifecycle["handleSwitchDoc"];
  /** Opening a search result seeds and opens Find, so the match highlights. */
  setFindSeed: (query: string) => void;
  setShowFindReplace: UIStore["setShowFindReplace"];
}

/**
 * Questions about the whole library, answered without extra storage reads from
 * the documents the link index has already loaded: the Files panel's body
 * filter, the global search, and a document's headings for the relationship
 * map's rail (live for the document the editor holds, so unsaved headings show).
 */
export function useLibraryQueries({
  getCanonical, fullDocsRef, documents, handleSwitchDoc, setFindSeed, setShowFindReplace,
}: LibraryQueriesParams) {
  // Full-text body search for the sidebar filter. Reuses the link index's already
  // loaded full documents (fullDocsRef), so it costs no extra storage reads. Falls
  // back to canonical text when a doc has no markdown cache (rich-only edits).
  // Headings for a document, for the relationship map's detail panel. Reads the
  // LIVE canonical when the editor holds that doc (so unsaved headings show),
  // otherwise the copy the link index already loaded — no extra storage reads.
  const headingsForDoc = useCallback((id: string): { text: string; level: number }[] => {
    const store = useDocumentStore.getState();
    const canonical =
      store.hydratedDocId === id ? getCanonical() : fullDocsRef.current.find((x) => x.id === id)?.canonical;
    if (!canonical) return [];
    return extractHeadings(canonical).map((h) => ({ text: h.text, level: h.level }));
  }, [getCanonical, fullDocsRef]);

  /** id → doc lookup, rebuilt only when the underlying array is replaced. The
   *  filter calls this once per document per keystroke, so a linear `find` made
   *  the whole pass O(N²) in the size of the library. */
  const docLookupRef = useRef<{ src: unknown; map: Map<string, (typeof fullDocsRef.current)[number]> }>({
    src: null, map: new Map(),
  });
  const searchDocBody = useCallback((id: string, q: string): boolean => {
    const arr = fullDocsRef.current;
    if (docLookupRef.current.src !== arr) {
      docLookupRef.current = { src: arr, map: new Map(arr.map((d) => [d.id, d])) };
    }
    const d = docLookupRef.current.map.get(id);
    if (!d) return false;
    return docSearchTextLower(d).includes(q);
  }, [fullDocsRef]);

  // Global full-text search across all loaded documents (reuses the link index's
  // in-memory full docs; live titles come from the summary list; body text is
  // memoized per doc by docSearchText so typing doesn't re-walk every canonical).
  const runSearch = useCallback((query: string) => {
    const titleById = new Map(documents.map((s) => [s.id, s.title]));
    const docs = fullDocsRef.current.map((d) => ({
      id: d.id,
      title: titleById.get(d.id) ?? d.title ?? t("common.untitled"),
      text: docSearchText(d),
    }));
    return searchDocuments(docs, query);
  }, [documents, fullDocsRef]);

  const handleOpenSearchResult = useCallback((docId: string, query: string) => {
    // handleSwitchDoc hydrates the editor; the raw store switch left the
    // previous doc's content on screen (and saveable) under the new doc's id.
    void handleSwitchDoc(docId);
    // Seed and open the find bar so the match highlights and prev/next work.
    setFindSeed(query);
    setShowFindReplace(true);
  }, [handleSwitchDoc, setShowFindReplace]);

  return { headingsForDoc, searchDocBody, runSearch, handleOpenSearchResult };
}
