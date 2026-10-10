import { type MutableRefObject, useCallback, useMemo, useRef } from "react";
import { headingLinkHtml } from "../formatting/heading-link";
import { promptImage } from "../formatting/image-insert";
import { extractHeadings } from "../store/documents/doc-outline";
import { useUIStore } from "../store/preferences/uiStore";
import { t } from "../i18n";
import type {
  CmRef, EquationPrompt, FormatDispatcher, Lifecycle, PromptText, SyncEngine, TiptapRef, Toast, UIStore,
} from "./types";

interface PaneCommandsParams {
  cmRef: CmRef;
  tiptapRef: TiptapRef;
  mode: UIStore["mode"];
  /** True once the boot sequence has put a document into the editor. */
  initDoneRef: MutableRefObject<boolean>;
  getCanonical: SyncEngine["getCanonical"];
  /** The pane change handlers (they also emit the host's onContentChange). */
  handleMdChange: () => void;
  handleHtmlChange: () => void;
  flushPendingSync: Lifecycle["flushPendingSync"];
  dispatch: FormatDispatcher["dispatch"];
  setFocusedPane: FormatDispatcher["setFocusedPane"];
  promptText: PromptText;
  equationPrompt: EquationPrompt;
  toast: Toast;
}

/**
 * Commands that act on "the pane you are in": the right-click menu's API
 * (headings, heading-anchor links, clipboard, the ask-then-insert items), the
 * link prompts, and the pane focus handlers. In split view that pane is the one
 * that last had the caret, which `lastFocusedPaneRef` remembers — Find &
 * Replace opens on it too.
 */
export function usePaneCommands({
  cmRef, tiptapRef, mode, initDoneRef, getCanonical, handleMdChange, handleHtmlChange,
  flushPendingSync, dispatch, setFocusedPane, promptText, equationPrompt, toast,
}: PaneCommandsParams) {
  // ── Context menu: headings + heading-anchor insertion ───────────────────────
  // Tracks which pane the caret was last in, so an inserted anchor link lands
  // in the pane the user is actually working in (split view).
  const lastFocusedPaneRef = useRef<"md" | "html">("html");
  const getContextHeadings = useCallback(
    () => extractHeadings(getCanonical()).map((h) => ({ level: h.level, text: h.text })),
    [getCanonical]
  );

  const insertHeadingLink = useCallback((anchor: string) => {
    if (useUIStore.getState().readOnly) return; // read-only: don't mutate the doc
    // Same-document anchor link: [[#Heading]]. Insert into whichever pane is
    // active — the markdown pane gets the raw syntax; the rich pane gets a real
    // anchor <a> (WikiLink preserves data-doc-link / data-anchor) so it renders
    // and round-trips immediately.
    const pane = mode === "md" ? "md" : mode === "html" ? "html" : lastFocusedPaneRef.current;
    if (pane === "md") {
      cmRef.current?.insertAtCursor(`[[#${anchor}]]`);
      handleMdChange();
    } else {
      const editor = tiptapRef.current?.getEditor?.();
      if (!editor) return;
      editor.chain().focus().insertContent(
        headingLinkHtml(anchor)
      ).run();
      handleHtmlChange();
    }
  }, [mode, cmRef, tiptapRef, handleMdChange, handleHtmlChange]);

  // Clipboard + select-all for the right-click menu. Pane-aware (markdown pane
  // = CodeMirror, rich pane = TipTap). cut/copy run on the live selection via
  // execCommand (the menu click is a user gesture, so the browser allows it);
  // paste reads the async clipboard and inserts into the focused pane.
  const handleClipboard = useCallback(async (action: "cut" | "copy" | "paste" | "selectAll") => {
    // Cut and paste mutate the document — block them in read-only mode (copy and
    // select-all are non-destructive and stay available).
    if ((action === "cut" || action === "paste") && useUIStore.getState().readOnly) return;
    const pane = mode === "md" ? "md" : mode === "html" ? "html" : lastFocusedPaneRef.current;
    if (action === "selectAll") {
      if (pane === "md") {
        const v = cmRef.current?.getView();
        if (v) { v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }); v.focus(); }
      } else {
        tiptapRef.current?.getEditor?.()?.chain().focus().selectAll().run();
      }
      return;
    }
    if (action === "paste") {
      try {
        const text = await navigator.clipboard.readText();
        if (!text) return;
        if (pane === "md") { cmRef.current?.insertAtCursor(text); handleMdChange(); }
        else { tiptapRef.current?.getEditor?.()?.chain().focus().insertContent(text).run(); handleHtmlChange(); }
      } catch {
        toast.show(t("editor.clipboardBlocked"), "info");
      }
      return;
    }
    // cut / copy — focus the pane, then run the native command on its selection.
    const dom = pane === "md"
      ? cmRef.current?.getView()?.dom
      : (tiptapRef.current?.getEditor?.()?.view?.dom as HTMLElement | undefined);
    dom?.focus?.();
    try { document.execCommand(action); } catch { /* no-op */ }
    if (action === "cut") { if (pane === "md") handleMdChange(); else handleHtmlChange(); }
  }, [mode, cmRef, tiptapRef, handleMdChange, handleHtmlChange, toast]);

  const handleFocusMdPane = useCallback(() => {
    if (initDoneRef.current) flushPendingSync();
    lastFocusedPaneRef.current = "md";
    setFocusedPane("md");
  }, [flushPendingSync, setFocusedPane]);
  const handleFocusHtmlPane = useCallback(() => {
    if (initDoneRef.current) flushPendingSync();
    lastFocusedPaneRef.current = "html";
    setFocusedPane("html");
  }, [flushPendingSync, setFocusedPane]);

  /**
   * The right-click menu's "ask, then insert" items. It used to dispatch these
   * four commands with no value at all, and the dispatcher guards each on
   * `if (value)` — so Inline formula and Formula block did nothing in either
   * pane, and Add link / Image did nothing in the rich pane. The toolbar and the
   * menu bar have always prompted first; this is the same call, in one place.
   */
  const promptInsert = useCallback(async (kind: "link" | "image" | "mathInline" | "mathBlock") => {
    if (kind === "link") {
      const url = await promptText(t("editor.insertLink"), {
        placeholder: t("editor.linkUrlPlaceholder"), description: t("editor.insertLinkDescription"),
      });
      if (url) dispatch("createLink", url);
      return;
    }
    if (kind === "image") {
      const img = await promptImage(promptText);
      if (img) dispatch("insertImage", img);
      return;
    }
    const block = kind === "mathBlock";
    const latex = await equationPrompt(block ? t("editor.insertFormulaBlock") : t("editor.insertInlineFormula"), {
      display: block ? "block" : "inline",
      description: block ? t("editor.formulaBlockDescription") : t("editor.inlineFormulaDescription"),
    });
    if (latex && latex.trim()) dispatch(block ? "insertMathBlock" : "insertMathInline", latex);
  }, [promptText, equationPrompt, dispatch]);

  const contextMenuApi = useMemo(
    () => ({ dispatch, getHeadings: getContextHeadings, insertHeadingLink, clipboard: handleClipboard, promptInsert }),
    [dispatch, getContextHeadings, insertHeadingLink, handleClipboard, promptInsert]
  );

  /** The link bubble menu's "Edit" — through the styled dialog, not window.prompt. */
  const editLinkCb = useCallback(
    (currentUrl: string) => promptText(t("editor.editLink"), {
      placeholder: t("editor.linkUrlPlaceholder"),
      description: t("editor.editLinkDescription"),
      defaultValue: currentUrl,
    }),
    [promptText]
  );
  const promptLinkCb = useCallback(
    () => promptText(t("editor.insertLink"), {
      placeholder: t("editor.linkUrlPlaceholder"),
      description: t("editor.insertLinkDescription"),
    }),
    [promptText]
  );

  return {
    lastFocusedPaneRef, contextMenuApi, handleClipboard,
    handleFocusMdPane, handleFocusHtmlPane, editLinkCb, promptLinkCb,
  };
}
