import { useCallback, useMemo } from "react";
import { useActiveHeading } from "../hooks/useActiveHeading";
import { extractHeadings, findHeadingByAnchor } from "../store/doc-outline";
import { useDocumentStore } from "../store/documentStore";
import { scrollBehavior } from "../utils/reduced-motion";
import { t } from "../i18n";
import type { DocStore, Lifecycle, SyncEngine, TiptapRef, Toast, UIStore } from "./types";
import type { useWorkspaceViews } from "./useWorkspaceViews";

// Stable empty outline reference for when the nav panel is closed (avoids a
// fresh array identity churning DocNavPanel memoization).
const EMPTY_HEADINGS: ReturnType<typeof extractHeadings> = [];

interface HeadingNavigationParams {
  tiptapRef: TiptapRef;
  activeDocId: DocStore["activeDocId"];
  mode: UIStore["mode"];
  setMode: UIStore["setMode"];
  handleSwitchDoc: Lifecycle["handleSwitchDoc"];
  /** A heading is in the editor, so navigating leaves the map / Cards. */
  setWorkspaceView: ReturnType<typeof useWorkspaceViews>["setWorkspaceView"];
  toast: Toast;
}

/**
 * Open a document AT a heading — by document-order index (the map's rail, the
 * Outline) or by anchor text (`[[Doc#Heading]]` / `[[#Heading]]`). Both wait
 * until the store agrees the target is active AND hydrated before matching the
 * rendered headings, so they never stop on the previous document's DOM.
 */
export function useHeadingNavigation({
  tiptapRef, activeDocId, mode, setMode, handleSwitchDoc, setWorkspaceView, toast,
}: HeadingNavigationParams) {
  // Open a document scrolled to one of its headings (by document-order index),
  // used by the graph's document-structure view. Heading elements in the rich
  // pane render in the same order as extractHeadings(), so the index lines up.
  const scrollToHeading = useCallback(async (docId: string, index: number) => {
    // Await the switch so the editor is hydrated with the TARGET doc before we
    // start matching headings — otherwise the retry loop could match (and stop
    // on) the OLD document's DOM.
    if (docId !== activeDocId) await handleSwitchDoc(docId);
    setWorkspaceView("editor");
    if (mode === "md") setMode("split"); // ensure the rich pane (which we scroll) is visible
    const attempt = (tries: number) => {
      // Only match once the store agrees the target doc is active AND hydrated.
      const s = useDocumentStore.getState();
      if (s.activeDocId === docId && s.hydratedDocId === docId) {
        const editor = tiptapRef.current?.getEditor();
        const dom = editor?.view?.dom as HTMLElement | undefined;
        const headings = dom?.querySelectorAll("h1, h2, h3, h4, h5, h6");
        const el = headings?.[index] as HTMLElement | undefined;
        if (el) { el.scrollIntoView({ behavior: scrollBehavior(), block: "start" }); return; }
      }
      if (tries > 0) setTimeout(() => attempt(tries - 1), 200);
    };
    requestAnimationFrame(() => attempt(12));
  }, [activeDocId, handleSwitchDoc, setWorkspaceView, mode, setMode]);

  // Navigate a heading ANCHOR link ([[Doc#Heading]] / [[#Heading]]): switch to
  // the target doc if needed, then scroll to the heading whose text matches the
  // anchor. Matching is normalized (case/punctuation/spacing-insensitive) so it
  // tolerates the small text variations that "auto-updating" links rely on.
  const scrollToHeadingByAnchor = useCallback(async (docId: string | null, anchorText: string) => {
    const targetId = docId ?? useDocumentStore.getState().activeDocId;
    if (!targetId) return;
    if (targetId !== useDocumentStore.getState().activeDocId) await handleSwitchDoc(targetId);
    setWorkspaceView("editor");
    if (mode === "md") setMode("split");
    const attempt = (tries: number) => {
      const s = useDocumentStore.getState();
      if (s.activeDocId === targetId && s.hydratedDocId === targetId) {
        const dom = tiptapRef.current?.getEditor()?.view?.dom as HTMLElement | undefined;
        const headings = dom?.querySelectorAll("h1, h2, h3, h4, h5, h6");
        if (headings) {
          // The ONE anchor matcher (doc-outline). Its old inline normaliser,
          // `[^a-z0-9]`, erased every non-Latin heading to "", so an anchor to
          // any of them jumped to the FIRST non-Latin heading in the document.
          const i = findHeadingByAnchor(Array.from(headings, (h) => h.textContent || ""), anchorText);
          if (i >= 0) {
            (headings[i] as HTMLElement).scrollIntoView({ behavior: scrollBehavior(), block: "start" });
            return;
          }
          if (headings.length) { toast.show(t("editor.headingNotFound", { heading: anchorText }), "info"); return; }
        }
      }
      if (tries > 0) setTimeout(() => attempt(tries - 1), 200);
    };
    requestAnimationFrame(() => attempt(12));
  }, [handleSwitchDoc, setWorkspaceView, mode, setMode, toast, tiptapRef]);

  const handleNavigateHeading = useCallback((i: number) => {
    if (activeDocId) scrollToHeading(activeDocId, i);
  }, [activeDocId, scrollToHeading]);

  return { scrollToHeading, scrollToHeadingByAnchor, handleNavigateHeading };
}

interface OutlineParams {
  tiptapRef: TiptapRef;
  getCanonical: SyncEngine["getCanonical"];
  activeDocId: DocStore["activeDocId"];
  mode: UIStore["mode"];
  showSidebar: boolean;
  workspaceTab: UIStore["workspaceTab"];
}

/**
 * The Workspace panel's Outline tab: the headings of the open document and the
 * one the reader is currently scrolled to. Both are computed only while the
 * Outline is showing.
 */
export function useOutline({
  tiptapRef, getCanonical, activeDocId, mode, showSidebar, workspaceTab,
}: OutlineParams) {
  // Live outline for the in-editor Outline tray tab. The array index is the
  // document-order heading index (matches the rendered DOM order), so it feeds
  // scrollToHeading directly — same data path the graph uses.
  // Which heading the reader is currently scrolled to in the rich pane — drives
  // the DocNavPanel's live TOC highlight. READ-ONLY tracker (never writes
  // scrollTop). Only runs while the panel is open AND the rich pane is visible
  // (md-only mode has no .ProseMirror to observe). Re-attaches on doc/mode change.
  const activeHeadingIndex = useActiveHeading({
    getEditorDom: () => tiptapRef.current?.getEditor()?.view?.dom as HTMLElement | undefined,
    active: showSidebar && workspaceTab === "outline" && mode !== "md" && !!activeDocId,
    revision: `${activeDocId}:${mode}`,
  });
  // Headings for the DocNavPanel TOC — recomputed only when the doc content
  // actually changes (counts is bumped by updateCounts on each edit) or on doc
  // switch, NOT on every scroll re-render, so buildHeadingTree stays cached
  // while the reader scrolls.
  const docCounts = useDocumentStore((s) => s.counts);
  // Only the Workspace panel's Outline/Map tabs consume this. Gate the compute on
  // that being visible so we don't run a full editor.getJSON() + extractHeadings
  // walk on EVERY keystroke while it's not shown (the counts path already walks
  // the doc once per edit — this avoids a second serialization).
  const navOpen = showSidebar && workspaceTab === "outline";
  const docNavHeadings = useMemo(
    () => (navOpen ? extractHeadings(getCanonical()) : EMPTY_HEADINGS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navOpen, getCanonical, activeDocId, docCounts]
  );

  return { activeHeadingIndex, docNavHeadings };
}
