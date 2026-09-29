/**
 * What happens when the document changes: the store's derived values (word
 * counts, the fidelity report) are refreshed on every projection, and the host
 * is told — the integration wrapper on every canonical change, a library
 * host's `onContentChange` debounced.
 */
import { useCallback, useEffect, useRef } from "react";
import type { PerssonifyEditorProps } from "./props";
import type { CmRef, DocStore, SyncEngine, TiptapRef } from "./types";

interface CanonicalChangeParams {
  cmRef: CmRef;
  tiptapRef: TiptapRef;
  updateDerived: DocStore["updateDerived"];
  activeDoc: DocStore["activeDoc"];
  fidelityReport: DocStore["fidelityReport"];
  /** The integration wrapper's change listener (an internal prop). */
  _onIntegrationChange?: PerssonifyEditorProps["_onIntegrationChange"];
}

/** useSyncEngine's `onCanonicalChange` — with a STABLE identity (see below). */
export function useCanonicalChangeHandler({
  cmRef, tiptapRef, updateDerived, activeDoc, fidelityReport, _onIntegrationChange,
}: CanonicalChangeParams) {
  // ── Canonical change handler ──────────────────────────────────────────────
  // The BODY changes every render (it closes over activeDoc and the fidelity
  // report — which it produces itself), but the IDENTITY must not: it is
  // useSyncEngine's onCanonicalChange, so a new function re-creates
  // syncMdToHtml, then handleMdChange, then every pane prop, on every single
  // projection. Latest-body-through-a-stable-ref is the same idiom the sync
  // engine's own force* callbacks use, and for the same reason.
  const latestCanonicalChange = (pmJson: any) => {
    // NOT wrapped in startTransition. It was tried and measured: with the
    // derived values already reference-stable (Phase 2) and the chrome
    // memoized, deferring this re-render moved total blocking by less than the
    // run-to-run spread at 1KB and not at all at 10/50KB, while making the word
    // count and fidelity chip lag visibly under sustained typing. Not worth a
    // behaviour change for noise.
    updateDerived(pmJson);
    if (_onIntegrationChange && activeDoc) {
      const md = cmRef.current?.getValue() || "";
      const html = tiptapRef.current?.getHTML() || "";
      _onIntegrationChange({
        docId: activeDoc.id,
        canonical: pmJson,
        md,
        html,
        metadata: activeDoc.metadata || {},
        fidelity: fidelityReport,
      });
    }
  };
  // SEEDED with the real body, so there is no window in which a projection lands
  // on a no-op and the status bar silently shows no word count and no fidelity
  // report until the first edit. No path reaches onCanonicalChange that early
  // today, but a useLayoutEffect — or a synchronous setFromHtml from a child's
  // mount effect, which flushes before the parent's — is all it would take. With
  // the seed, the effect below is only ever a refresh.
  const canonicalChangeRef = useRef(latestCanonicalChange);
  // Refreshed in an EFFECT, not during render: with concurrent rendering React
  // may render with props it has not committed, and a projection landing in
  // that window would otherwise report against a document the user is not on
  // yet. Projections are always async (debounce or explicit command), so the
  // committed body is never stale by the time one runs.
  useEffect(() => { canonicalChangeRef.current = latestCanonicalChange; });
  const handleCanonicalChange = useCallback((pmJson: any) => {
    canonicalChangeRef.current(pmJson);
  }, []);

  return handleCanonicalChange;
}

interface ContentChangeParams {
  cmRef: CmRef;
  tiptapRef: TiptapRef;
  activeDoc: DocStore["activeDoc"];
  getCanonical: SyncEngine["getCanonical"];
  onContentChange?: PerssonifyEditorProps["onContentChange"];
}

/**
 * The host's `onContentChange`, debounced ~300ms. Returns the callback the
 * pane-change handlers call on every edit; the pending emit is cancelled on
 * unmount.
 */
export function useContentChangeEmitter({
  cmRef, tiptapRef, activeDoc, getCanonical, onContentChange,
}: ContentChangeParams) {
  const contentChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── onContentChange debounced emitter ────────────────────────────────────
  // Stable ref so the timeout closure always calls the latest callback.
  const onContentChangeRef = useRef(onContentChange);
  useEffect(() => { onContentChangeRef.current = onContentChange; }, [onContentChange]);

  // The active document is read through a REF, not a dependency. It is only used
  // for its id, but the store hands out a NEW activeDoc object on every save, so
  // depending on it churned this callback's identity once per autosave — and
  // through handleMdChange/handleHtmlChange that re-rendered the whole memoized
  // pane tree. Same `!activeDoc` guard as before, so the narrow window where an
  // id is active but its record is not yet loaded still emits nothing.
  const activeDocRef = useRef(activeDoc);
  useEffect(() => { activeDocRef.current = activeDoc; }, [activeDoc]);
  const emitContentChange = useCallback(() => {
    const doc = activeDocRef.current;
    if (!onContentChangeRef.current || !doc) return;
    if (contentChangeTimerRef.current) clearTimeout(contentChangeTimerRef.current);
    const docId = doc.id;
    contentChangeTimerRef.current = setTimeout(() => {
      const markdown = cmRef.current?.getValue() || "";
      const html = tiptapRef.current?.getHTML() || "";
      const canonical = getCanonical();
      onContentChangeRef.current?.({ docId, markdown, html, canonical });
    }, 300);
  }, [getCanonical]);

  // Clear the debounced onContentChange timer on unmount so it can't fire a
  // host callback against a torn-down editor (embed hosts mount/unmount PE).
  useEffect(() => {
    return () => {
      if (contentChangeTimerRef.current) clearTimeout(contentChangeTimerRef.current);
    };
  }, []);

  return emitContentChange;
}
