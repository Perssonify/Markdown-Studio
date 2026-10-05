import { Toaster } from "@/components/ui/sonner";
import React, { RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { toast as toastSonner } from "sonner";
import { useMarkdownEngine } from "./engine/useMarkdownEngine";
import { useSyncEngine } from "./engine/useSyncEngine";
import { useFormatDispatcher } from "./formatting/useFormatDispatcher";
import { useDocumentLifecycle } from "./hooks/useDocumentLifecycle";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts.js";
import { useLinkIndex } from "./hooks/useLinkIndex";
import { useDocumentStore } from "./store/documentStore";
import { computeFidelity } from "./store/fidelity";
import { useEditorStore } from "./store/editorStore";
import type { PerssonifyEditorProps } from "./editor/props";
import { useOverlayInert, useWorkspaceViews } from "./editor/useWorkspaceViews";
import { useAutosave } from "./editor/useAutosave";
import { useTabSync } from "./editor/useTabSync";
import { useCanonicalChangeHandler, useContentChangeEmitter } from "./editor/useChangeNotifications";
import { useHeadingNavigation, useOutline } from "./editor/useHeadingNavigation";
import { usePaneCommands } from "./editor/usePaneCommands";
import { useBottomTray, useConsoleContext, useTrayTabs } from "./editor/useBottomTray";
import { useImportPipeline } from "./editor/useImportPipeline";
import { useEditorBoot, usePersistPreferences } from "./editor/useEditorBoot";
import { useExportActions } from "./editor/useExportActions";
import { useEditorActions } from "./editor/useEditorActions";
import { useLibraryQueries } from "./editor/useLibraryQueries";
import { useCardHandlers } from "./editor/useCardHandlers";
import { useHostApi } from "./editor/useHostApi";
import { useHeadingRenameLinks } from "./editor/useHeadingRenameLinks";
import { MemorySheet } from "./ui/MemorySheet";
import { VersionHistorySheet } from "./ui/VersionHistorySheet";
import { LinkBuilderDialog } from "./ui/LinkBuilderDialog";
import { groupDocsByFolder, useFolderStore } from "./store/folders";
import { useUIStore } from "./store/uiStore";
import { MenuBar } from "./ui/MenuBar";
import { AdUnit } from "./ui/AdUnit";
import { DurabilityNotices } from "./ui/DurabilityNotices";
import { BottomTray } from "./ui/BottomTray";
import { EditorLayout } from "./ui/EditorPanes";
import { EditorContextMenu } from "./ui/EditorContextMenu";
import { Icons } from "./ui/Icons";
import { StatusBar } from "./ui/StatusBar";
import { ToastType, useToast } from "./ui/Toast";
import { EditorToolbar } from "./ui/Toolbar";

// Handle types for the sub-panes
import { FileTextIcon } from "lucide-react";
import { useIsMobile } from "./hooks/use-mobile";
import { Button } from "./components/ui/button";
import { PanelLeft } from "lucide-react";
import { TooltipProvider } from "./components/ui/tooltip";
import { CodeMirrorPaneHandle } from "./ui/CodeMirrorPane";
import { useConfirm, useUnsavedChangesConfirm } from "./ui/ConfirmDialog";
import { useDialogs } from "./hooks/useDialogs";
import { EquationDialog, PromptDialog } from "./ui/Dialogs";
import { UrlImportDialog } from "./ui/UrlImportDialog";
import { SearchPanel } from "./ui/SearchPanel";
import { DialogProvider, type DialogApi } from "./ui/DialogProvider";
import { SettingsSheet } from "./ui/SettingsSheet";
import { TiptapPaneHandle } from "./ui/TiptapPane";

// Lazy-loaded panels (bundle splitting - load only when feature is used)
import { LazyChunkBoundary } from "./ui/LazyChunkBoundary";
import { OneEditorPerPage } from "./ui/OneEditorPerPage";
import { useT } from "./i18n";
const FindReplaceBar = React.lazy(() => import("./ui/FindReplace").then((m) => ({ default: m.FindReplaceBar })));
const GraphView = React.lazy(() => import("./ui/GraphView").then((m) => ({ default: m.GraphView })));
const CardsView = React.lazy(() => import("./ui/CardsView").then((m) => ({ default: m.CardsView })));
const WorkspacePanel = React.lazy(() => import("./ui/WorkspacePanel").then((m) => ({ default: m.WorkspacePanel })));

/**
 * The dual-pane Markdown editor.
 *
 * ONE PER PAGE: its stores are module singletons (see `useDocumentStore`), so
 * a second instance mounted while one is running refuses to start and shows a
 * message instead (OneEditorPerPage, A106). Use one instance per page or per
 * iframe (the embed build). Unmounting and
 * remounting a single instance is supported; switching `storageAdapter` /
 * `storageConfig` needs a page load — use `clearLocalData()` for a logout.
 */
export function PerssonifyEditor(props: PerssonifyEditorProps) {
  return <OneEditorPerPage><PerssonifyEditorInstance {...props} /></OneEditorPerPage>;
}

function PerssonifyEditorInstance({
  _integrationRef,
  _onIntegrationChange,
  _onIntegrationLinkClick,
  _onIntegrationGraphUpdate,
  storageAdapter,
  storageConfig,
  onStorageMetricsChange,
  onStorageQuotaExceeded,
  onContentChange,
  onSave,
  initialMode = "split",
  chrome: chromeProp = "full",
  starterDocuments,
  initialDocument,
  onAbout,
  onHelp,
  onStartTour,
  accountControl,
  graphOpen,
  onGraphOpenChange,
  durabilityNotices = false,
  initialImportUrl,
  readOnly: readOnlyProp,
  fitParent = false,
}: PerssonifyEditorProps) {
  const t = useT();

  // Chrome level (host-controlled): drives which UI shells render. Seeded from
  // the prop; the imperative setChrome() can change it at runtime.
  const [chrome, setChrome] = useState<"full" | "minimal" | "none">(chromeProp);
  useEffect(() => { setChrome(chromeProp); }, [chromeProp]);
  // Session-only — see the prop docs.
  useEffect(() => {
    if (readOnlyProp === undefined) return;
    useUIStore.setState({ readOnly: readOnlyProp });
  }, [readOnlyProp]);
  const chromeMinimal = chrome === "minimal" || chrome === "none";


  // ── Stores ────────────────────────────────────────────────────────────────
  // Shallow selectors, NOT whole-store subscriptions: a bare useXStore() call
  // re-renders this whole component on EVERY store write — which meant ≥2
  // full re-renders per keystroke (setDirty, setActiveFormats, updateCounts…).
  // Zustand actions are stable references, so including them in the shallow
  // object is free; only the listed STATE fields trigger renders now.
  const {
    mode, showFindReplace, setMode, showGraph,
    syncMode, pasteStyled, editorReady,
    setShowFindReplace, toggleFindReplace,
    toggleSidebar, setShowGraph, showSidebar, setShowSidebar,
    setSyncMode, setPasteStyled, setEditorReady, setInitialSyncMode,
    markdownFeatures, setInitialMarkdownFeatures, readOnly, focusMode,
  } = useUIStore(
    useShallow((s) => ({
      mode: s.mode, showFindReplace: s.showFindReplace, setMode: s.setMode, showGraph: s.showGraph,
      syncMode: s.syncMode, pasteStyled: s.pasteStyled, editorReady: s.editorReady,
      setShowFindReplace: s.setShowFindReplace, toggleFindReplace: s.toggleFindReplace,
      toggleSidebar: s.toggleSidebar, setShowGraph: s.setShowGraph,
      showSidebar: s.showSidebar, setShowSidebar: s.setShowSidebar,
      setSyncMode: s.setSyncMode, setPasteStyled: s.setPasteStyled, setEditorReady: s.setEditorReady,
      setInitialSyncMode: s.setInitialSyncMode,
      markdownFeatures: s.markdownFeatures, setInitialMarkdownFeatures: s.setInitialMarkdownFeatures,
      readOnly: s.readOnly, focusMode: s.focusMode,
    }))
  );
  const consoleEnabled = useUIStore((s) => s.consoleEnabled);
  // Right-docked Workspace panel (Files / Outline / Map). `showSidebar` is its
  // open flag; width reuses the docnav width store slot.
  const workspaceTab = useUIStore((s) => s.workspaceTab);
  const setWorkspaceTab = useUIStore((s) => s.setWorkspaceTab);
  const isMobile = useIsMobile();
  const docNavWidth = useUIStore((s) => s.docNavWidth);
  const setDocNavWidth = useUIStore((s) => s.setDocNavWidth);

  const {
    documents, activeDoc, activeDocId,
    fidelityReport, storageMetrics, saveStatus,
    initialize, createDoc, finalizeDoc, saveNewDoc, saveActiveDoc,
    setDirty, revertActiveDoc, switchToDoc, closeTab,
    deleteDoc, renameDoc, duplicateDoc, patchDocById,
    updateDerived, setEngine, setSyncModeInternal,
    initStorage,
  } = useDocumentStore(
    useShallow((s) => ({
      documents: s.documents, activeDoc: s.activeDoc, activeDocId: s.activeDocId,
      fidelityReport: s.fidelityReport, storageMetrics: s.storageMetrics, saveStatus: s.saveStatus,
      initialize: s.initialize, createDoc: s.createDoc, finalizeDoc: s.finalizeDoc, saveNewDoc: s.saveNewDoc, saveActiveDoc: s.saveActiveDoc,
      setDirty: s.setDirty, revertActiveDoc: s.revertActiveDoc, switchToDoc: s.switchToDoc, closeTab: s.closeTab,
      deleteDoc: s.deleteDoc, renameDoc: s.renameDoc, duplicateDoc: s.duplicateDoc, patchDocById: s.patchDocById,
      updateDerived: s.updateDerived, setEngine: s.setEngine,
      setSyncModeInternal: s.setSyncModeInternal, initStorage: s.initStorage,
    }))
  );

  const { activeBacklinks, activeForwardLinks, activeUnresolved, graphData } = useEditorStore(
    useShallow((s) => ({
      activeBacklinks: s.activeBacklinks, activeForwardLinks: s.activeForwardLinks,
      activeUnresolved: s.activeUnresolved, graphData: s.graphData,
    }))
  );

  // The workspace surfaces — editor, relationship map, Cards — are ONE
  // exclusive selection (useWorkspaceViews). The graph half is routed through
  // the controlled setter, so the standalone app's /graph URL keeps driving it.
  const {
    graphVisible, cardsVisible, workspaceView, setWorkspaceView, handleSetMode, overlayRef,
    showMapView, showCardsView, showEditorView, toggleGraphCb, toggleCardsCb,
  } = useWorkspaceViews({ graphOpen, onGraphOpenChange, showGraph, setShowGraph, setMode });


  const [showSettings, setShowSettings] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showLinkBuilder, setShowLinkBuilder] = useState(false);
  // The importer opens PRE-FILLED from `initialImportUrl` (the app's
  // `?import_url=` deep link) and never fetches by itself — the visitor reviews
  // the URL and presses Fetch. Seeding the state at construction rather than in
  // an effect means the dialog's own open-effect sees the value on its first
  // render, instead of opening empty and filling in a frame later.
  const [showUrlImport, setShowUrlImport] = useState(() => !!initialImportUrl);
  const [importUrlSeed, setImportUrlSeed] = useState<string | null>(initialImportUrl ?? null);
  // A consumer that resolves the source asynchronously still gets the documented
  // behaviour: a later non-empty `initialImportUrl` opens the importer once.
  const seededImportRef = useRef(initialImportUrl ?? null);
  useEffect(() => {
    if (!initialImportUrl || initialImportUrl === seededImportRef.current) return;
    seededImportRef.current = initialImportUrl;
    setImportUrlSeed(initialImportUrl);
    setShowUrlImport(true);
  }, [initialImportUrl]);

  const [showSearch, setShowSearch] = useState(false);
  const [findSeed, setFindSeed] = useState("");
  // Stable indirection to the multi-doc zip exporter, so handleAction
  // (useEditorActions) can trigger "export all" / "full backup" without a
  // forward dependency: useExportActions, called after it, points this at
  // handleExportDocs on every render.
  const exportDocsRef = useRef<(ids: string[], zipName: string, opts?: { canonical?: boolean }) => Promise<number> | void>(() => {});

  // ── Engine
  const { ready: engineReady, engine, configVersion } = useMarkdownEngine();

  // Keep store in sync with engine and syncMode
  useEffect(() => { setEngine(engine); }, [engine, setEngine]);
  useEffect(() => { setSyncModeInternal(syncMode); }, [syncMode, setSyncModeInternal]);

  // Give the store a way to read the LIVE editor canonical for the active,
  // hydrated doc. Non-editor persist paths (renameDoc / patchDocById) use it so
  // a metadata-only change merges onto the live content instead of the on-disk
  // copy (which lags the editor by up to one autosave interval) — closing the
  // "renamed and lost my unsaved edits" data-loss class. Registered once.
  useEffect(() => {
    const store = useDocumentStore.getState();
    store.registerLiveCanonical((docId) => {
      const { activeDocId, hydratedDocId } = useDocumentStore.getState();
      if (activeDocId !== docId || hydratedDocId !== docId) return null;
      const ed = tiptapRef.current?.getEditor();
      return ed ? ed.getJSON() : null;
    });
    return () => store.registerLiveCanonical(null);
  }, []);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const cmRef = useRef<CodeMirrorPaneHandle>(null);
  const tiptapRef = useRef<TiptapPaneHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const initDoneRef = useRef(false);

  // Write preferences (view mode, markdown features, folder tree) back as they
  // change once boot has finished, and prune folder metadata for deleted
  // documents (usePersistPreferences). Called here because it needs
  // initDoneRef; nothing between the live-canonical registration above and
  // this call registers an effect, so its effects keep their original order.
  usePersistPreferences({ initDoneRef, mode, markdownFeatures, documents });

  // ── Misc hooks ────────────────────────────────────────────────────────────
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const { confirmUnsaved, UnsavedChangesDialog } = useUnsavedChangesConfirm();
  // A deleted document keeps a recoverable copy in version history. Say so,
  // and offer to erase that too — the only way it could otherwise go was to
  // wait out the snapshot age cap.
  const onDocDeleted = useCallback((docId: string, title: string) => {
    toastSonner(t("app.deletedRecoverableCopyKept"), {
      duration: 8000,
      action: {
        label: t("app.eraseHistory"),
        onClick: () => {
          void useDocumentStore.getState().purgeDocHistory(docId)
            .then(() => toastSonner.success(t("app.versionHistoryErased", { title })))
            .catch(() => toastSonner.error(t("app.versionHistoryCouldNotBeErased")));
        },
      },
    });
  }, [t]);
  const { prompt: promptText, promptState, handlePromptClose, equation: equationPrompt, equationState, handleEquationClose } = useDialogs();
  // Single dialog surface handed to all children via context (see DialogProvider).
  const dialogApi = React.useMemo<DialogApi>(
    () => ({ confirm, prompt: promptText, equation: equationPrompt, confirmUnsaved }),
    [confirm, promptText, equationPrompt, confirmUnsaved]
  );

  // ── Canonical change handler ──────────────────────────────────────────────
  // useSyncEngine's onCanonicalChange (useCanonicalChangeHandler). Its identity
  // is STABLE on purpose — see the hook.
  const handleCanonicalChange = useCanonicalChangeHandler({
    cmRef, tiptapRef, updateDerived, activeDoc, fidelityReport, _onIntegrationChange,
  });

  // ── Sync engine ───────────────────────────────────────────────────────────
  const {
    syncMdToHtml, syncHtmlToMd,
    forceSyncMdToHtml, forceSyncHtmlToMd,
    resetHashes, getCanonical, setCanonical, setFromHtml,
  } = useSyncEngine({
    cmRef, tiptapRef, engine, syncMode,
    onCanonicalChange: handleCanonicalChange,
  });

  // Re-render the preview when the markdown flavor / feature config changes,
  // so toggling (e.g.) tables or emoji re-parses the current source immediately.
  // syncHtmlToMd is called via a REF: sync callbacks must never enter effect
  // dep arrays (CLAUDE.md invariant — doing so loops via onCanonicalChange).
  const syncHtmlToMdRef2 = useRef(syncHtmlToMd);
  useEffect(() => { syncHtmlToMdRef2.current = syncHtmlToMd; }, [syncHtmlToMd]);
  useEffect(() => {
    if (!initDoneRef.current) return;
    // Flush any pending rich-pane edits into the md pane FIRST — the forced
    // md→html re-parse below replaces the rich pane wholesale, which would
    // discard whatever rich-pane typing has not been projected yet.
    syncHtmlToMdRef2.current();
    // …and the re-parse REPLACES the rich document with only what the markdown
    // projection carries. For a document holding something it cannot carry —
    // alignment always, colour/highlight/font in Clean mode — toggling ANY
    // markdown feature silently stripped it, and the next edit or switch made
    // that permanent. Such a document keeps its rich content; only the markdown
    // pane is re-projected. (Markdown typed afterwards re-parses as usual.)
    const live = tiptapRef.current?.getEditor?.()?.getJSON?.();
    const mode = useUIStore.getState().syncMode === "styled" ? "styled" : "clean";
    if (live && !computeFidelity(live, mode).lossless) {
      forceSyncHtmlToMd();
      return;
    }
    forceSyncMdToHtml();
  }, [configVersion, forceSyncMdToHtml, forceSyncHtmlToMd]);

  // ── Format dispatcher ─────────────────────────────────────────────────────
  const setActiveFormats = useEditorStore((s) => s.setActiveFormats);
  // Stable identity so useFormatDispatcher's updateFormats/effect deps don't
  // change every render (which re-subscribed document selectionchange/keyup
  // listeners on every render).
  const handleFormatsChange = useCallback(
    (formats: unknown) => setActiveFormats(formats as any),
    [setActiveFormats]
  );
  // The Toolbar is the ONLY consumer of editorStore.activeFormats, and it only
  // mounts under this exact condition (see the EditorToolbar render below). When
  // it is absent, withholding the callback makes `onFormatsChange?.(queryState())`
  // short-circuit, so the ~18 `isActive()` probes per rAF stop running for a value
  // with no reader. It is re-published the moment the toolbar comes back.
  const formatsWanted = !!activeDocId && !chromeMinimal && !readOnly;
  // Folder membership for the graph's folder grouping. Reactive so the graph's
  // folder hulls track renames/moves without a manual refresh.
  const folderState = useFolderStore(useShallow((s) => ({ folders: s.folders, docParents: s.docParents, docOrder: s.docOrder })));
  const graphFolders = useMemo(() => {
    const nodes = graphData?.nodes;
    if (!nodes?.length) return [];
    return groupDocsByFolder(nodes.map((n) => n.id), folderState.folders, folderState.docParents);
  }, [graphData, folderState]);
  const { dispatch, updateFormats, setFocusedPane } = useFormatDispatcher({
    cmRef, tiptapRef, mode,
    syncMdToHtml: forceSyncMdToHtml,
    syncHtmlToMd: forceSyncHtmlToMd,
    scheduleAutosave: setDirty,
    onFormatsChange: formatsWanted ? handleFormatsChange : undefined,
  });
  // Re-seed the toolbar when it (re)appears — while it was unmounted no formats
  // were published, so the store still holds the state from before it went away.
  useEffect(() => {
    if (formatsWanted) updateFormats(true);
  }, [formatsWanted, updateFormats]);

  // ── onContentChange debounced emitter ────────────────────────────────────
  // The host's realtime-sync callback, debounced (useContentChangeEmitter).
  const emitContentChange = useContentChangeEmitter({ cmRef, tiptapRef, activeDoc, getCanonical, onContentChange });

  // Renamed headings keep their links (useHeadingRenameLinks, below). The
  // leaving paths report the document they leave through this ref: the hook
  // needs the link index, which is created after the lifecycle.
  const headingLeaveRef = useRef<((docId: string) => void) | null>(null);
  const noteLeavingDoc = useCallback((docId: string) => { headingLeaveRef.current?.(docId); }, []);

  // ── Document lifecycle ────────────────────────────────────────────────────
  const {
    handleMdChange: _handleMdChange,
    handleHtmlChange: _handleHtmlChange,
    handleHtmlPaste,
    handleSyncModeChange, handleSwitchDoc, handleCloseTab, handleRevertDoc,
    handleNewDoc, handleDeleteDoc,
    prepareToLeaveActiveDoc, hydrateEditorWithDoc,
    restoreSnapshotInPlace, restoreSnapshotAsNew,
    cancelPendingSync, flushPendingSync, releaseEditor,
    endCompositions, claimEditorGeneration, isEditorGeneration, hasPendingProjection,
  } = useDocumentLifecycle({
    tiptapRef, cmRef, engine, syncMdToHtml, syncHtmlToMd, forceSyncMdToHtml, forceSyncHtmlToMd,
    resetHashes, setCanonical, setFromHtml, switchToDoc, closeTab,
    createDoc, deleteDoc, finalizeDoc, revertActiveDoc, saveActiveDoc,
    setDirty, handleCanonicalChange, pasteStyled, setPasteStyled,
    syncMode, setSyncMode, toast, confirm, confirmUnsaved, onDocDeleted, onLeavingDoc: noteLeavingDoc,
  });

  // Unmount is a document-leaving path (see releaseEditor). A LAYOUT cleanup,
  // not a passive one: React runs a component's layout cleanups before its
  // children's, so both panes — and the refs to them — still exist here; by
  // the time passive cleanups run, the pane handles have been detached.
  const releaseEditorRef = useRef(releaseEditor);
  useEffect(() => { releaseEditorRef.current = releaseEditor; }, [releaseEditor]);
  useLayoutEffect(() => () => { releaseEditorRef.current(); }, []);

  // Heading navigation (useHeadingNavigation): open a document at a heading by
  // index (the map's rail, the Outline) or by anchor text ([[Doc#Heading]]).
  const { scrollToHeading, scrollToHeadingByAnchor, handleNavigateHeading } = useHeadingNavigation({
    tiptapRef, activeDocId, mode, setMode, handleSwitchDoc, setWorkspaceView, toast,
  });

  // Wrap MD/HTML change handlers to also emit onContentChange
  const handleMdChange = useCallback(() => {
    _handleMdChange();
    emitContentChange();
  }, [_handleMdChange, emitContentChange]);

  const handleHtmlChange = useCallback(() => {
    _handleHtmlChange();
    emitContentChange();
  }, [_handleHtmlChange, emitContentChange]);

  // ── Pane commands ─────────────────────────────────────────────────────────
  // What acts on "the pane you are in" (usePaneCommands): the right-click
  // menu's API, clipboard, heading-anchor insertion, the insert prompts, and
  // the focus handlers that remember which pane last had the caret.
  const {
    lastFocusedPaneRef, contextMenuApi, handleClipboard,
    handleFocusMdPane, handleFocusHtmlPane, editLinkCb, promptLinkCb,
  } = usePaneCommands({
    cmRef, tiptapRef, mode, initDoneRef, getCanonical, handleMdChange, handleHtmlChange,
    flushPendingSync, dispatch, setFocusedPane, promptText, equationPrompt, toast,
  });
  // The Workspace panel's Outline: the TOC headings and which one the reader is
  // scrolled to (useOutline — the tracker is read-only and only runs while the
  // Outline tab is showing).
  const { activeHeadingIndex, docNavHeadings } = useOutline({
    tiptapRef, getCanonical, activeDocId, mode, showSidebar, workspaceTab,
  });

  // ── Stable callbacks for the memoized chrome ──────────────────────────────
  // MenuBar / StatusBar / BottomTray are React.memo'd, but every one of these
  // used to be an arrow function written inline at the JSX call site, so each
  // was a NEW prop value on every render of this component — which is to say on
  // every keystroke — and the memo never once bailed out. Same for the arrays
  // and objects below. Stabilise the props first; the memo is what makes it pay.
  const openSearchPanel = useCallback(() => setShowSearch(true), []);
  const closeSearchPanel = useCallback(() => setShowSearch(false), []);
  const openSettings = useCallback(() => setShowSettings(true), []);
  const openMemory = useCallback(() => setShowMemory(true), []);
  const openVersionHistory = useCallback(() => setShowVersionHistory(true), []);
  const openLinkBuilder = useCallback(() => setShowLinkBuilder(true), []);
  const openWorkspacePanel = useCallback(() => setShowSidebar(true), [setShowSidebar]);
  const showOutlineTab = useCallback(() => {
    setShowSidebar(true);
    setWorkspaceTab("outline");
  }, [setShowSidebar, setWorkspaceTab]);
  const closeFindReplace = useCallback(() => {
    setShowFindReplace(false);
    setFindSeed("");
  }, []);
  // The bottom tray (useBottomTray): open/tab state and both toggles, which
  // refuse to open it when the height would clip the app. Closing never is.
  const {
    trayOpen, trayTab, setTrayTab, trayRegionRef, toggleTray, toggleLinksTray, closeTray,
  } = useBottomTray({ toast });

  const navigateToDoc = useCallback((id: string) => { handleSwitchDoc(id); }, [handleSwitchDoc]);
  const closeWorkspacePanel = useCallback(() => setShowSidebar(false), [setShowSidebar]);
  const handleSelectDocFromPanel = useCallback((id: string) => {
    handleSwitchDoc(id);
    if (isMobile) setShowSidebar(false);
  }, [handleSwitchDoc, isMobile, setShowSidebar]);
  const handleRenameFromPanel = useCallback(async (id: string, title: string) => {
    try { await renameDoc(id, title); }
    catch { toastRef.current.show(t("app.renameCouldNotBeSaved"), "error"); }
  }, [renameDoc, t]);
  const handleDuplicateFromPanel = useCallback(async (docId?: string) => {
    // Forward the ROW's id. Dropping it made every per-row Duplicate copy
    // whichever document happened to be open — FolderTree passed the id, this
    // handler swallowed it, and the store did not accept one. Rename, right
    // beside it in the same menu, forwarded its id correctly all along.
    try { await duplicateDoc(docId); }
    catch { toastRef.current.show(t("app.duplicateCouldNotBeSaved"), "error"); }
  }, [duplicateDoc, t]);
  const closeActiveTab = useCallback(() => {
    if (activeDocId) handleCloseTab(activeDocId);
  }, [activeDocId, handleCloseTab]);

  // ── Link index ────────────────────────────────────────────────────────────
  // A stable adapter, not an object literal at the call site: this lands in the
  // deps of useLinkIndex's wiki-link DOM listener effect, so a fresh object
  // detached and re-attached that click listener on EVERY render.
  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; }, [toast]);
  const linkIndexToast = useMemo(
    () => ({ show: (msg: string, type?: string) => toastRef.current.show(msg, type as ToastType) }),
    []
  );
  const {
    linkIndex, handleGraphExport, fullDocsRef, rebuildLinks,
  } = useLinkIndex({
    handleSwitchDoc,
    toast: linkIndexToast,
    editorReady,
    graphVisible, // effective visibility (route-controlled in the app) — drives graph-data population
    onLinkClick: _onIntegrationLinkClick
      ? (p) => _onIntegrationLinkClick(p)
      : undefined,
    onAnchorNavigate: scrollToHeadingByAnchor,
    tiptapRef,
  });

  // The tray's tabs (Document Links, and the admin-gated diagnostics Console
  // with its read-only context). Both memoized — the tray is React.memo'd.
  const consoleCtx = useConsoleContext({ getCanonical, fullDocsRef });

  // Offer to retarget the links to a heading that was renamed.
  useHeadingRenameLinks({
    tiptapRef, cmRef, fullDocsRef, lastFocusedPaneRef, flushPendingSync, forceSyncHtmlToMd, setDirty,
    leaveRef: headingLeaveRef,
  });
  const trayTabs = useTrayTabs({
    activeBacklinks, activeForwardLinks, activeUnresolved, navigateToDoc, consoleEnabled, consoleCtx,
  });

  // ── Import pipeline ───────────────────────────────────────────────────────
  // Creating documents from outside (useImportPipeline): file, archive and URL
  // import, the activate-and-hydrate step the host bridge and Cards share, and
  // the post-await ownership check (isEditorTargeting) all of them rely on.
  const {
    waitForEditor, activateAndCapture, isEditorTargeting, importItems, handleImportUrl,
  } = useImportPipeline({
    tiptapRef, engine, createDoc, finalizeDoc, saveNewDoc,
    prepareToLeaveActiveDoc, hydrateEditorWithDoc, handleSwitchDoc, toast,
    setShowUrlImport, setImportUrlSeed,
  });

  // ── Boot ──────────────────────────────────────────────────────────────────
  // Storage injection (first render only), then — once the engine is ready —
  // the init sequence: preferences, the stored library, hydration or first-run
  // seeding, and the storage-metrics feed to the host (useEditorBoot). Its
  // effects run here, where they always ran: just before saving's.
  useEditorBoot({
    storageAdapter, storageConfig, initStorage,
    engineReady, engine, initDoneRef, cmRef,
    initialize, createDoc, finalizeDoc, setFromHtml,
    setInitialSyncMode, setInitialMarkdownFeatures, setMode, setEditorReady,
    initialMode, initialDocument, starterDocuments, durabilityNotices,
    waitForEditor, importItems, hydrateEditorWithDoc, handleSwitchDoc,
    storageMetrics, onStorageMetricsChange,
  });

  // ── Saving ────────────────────────────────────────────────────────────────
  // ⌘S, the idle autosave, the flush when a library surface opens, and the
  // unload safety net (useAutosave). Its effects run here, where they always
  // ran: after the boot sequence, before the keyboard shortcuts.
  const { handleSave, autosaveRef } = useAutosave({
    cmRef, tiptapRef, initDoneRef, activeDoc, saveStatus, saveActiveDoc, getCanonical,
    flushPendingSync, prepareToLeaveActiveDoc, graphVisible, cardsVisible, toast,
    onSave, onStorageQuotaExceeded,
  });

  // ── Live sync between tabs ────────────────────────────────────────────────
  // Other tabs' committed writes (useTabSync): the library refreshes, a clean
  // open document reloads, unsaved work parks a conflict with three choices.
  useTabSync({
    tiptapRef, cmRef, hydrateEditorWithDoc, claimEditorGeneration, isEditorGeneration,
    endCompositions, hasPendingProjection, flushPendingSync, cancelPendingSync, handleCloseTab, toast,
  });

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  // Find/Replace can open in two modes: ⌘F (find) and ⌘H (replace expanded).
  // `frWithReplace` seeds the panel's replace row; passed live so ⌘H expands it
  // even when the panel is already open.
  const [frMode, setFrMode] = useState<"find" | "replace">("find");
  const openFind = useCallback(() => {
    setFrMode("find");
    toggleFindReplace();
  }, [toggleFindReplace]);
  const openReplace = useCallback(() => {
    setFrMode("replace");
    setShowFindReplace(true);
  }, [setShowFindReplace]);
  // Hoisted, not inline: this and the two view toggles (toggleGraphCb /
  // toggleCardsCb, from useWorkspaceViews) are dependencies of the shortcut
  // hook's effect, which registers a CAPTURE-phase keydown listener on
  // `document`. As inline arrows they changed identity on every render of this
  // shell, so the listener was removed and re-added on the hottest path in the
  // app — once per keystroke-driven render. Every other callback at this call
  // site was already stabilised for the same reason.
  const openSearchCb = useCallback(() => setShowSearch(true), [setShowSearch]);
  useKeyboardShortcuts(containerRef as RefObject<HTMLElement>, {
    dispatch, updateFormats, save: handleSave, newDoc: handleNewDoc,
    toast, toggleFind: openFind, openReplace,
    openSearch: openSearchCb,
    toggleSidebar,
    toggleGraph: toggleGraphCb,
    toggleCards: toggleCardsCb,
    cancelPendingSync, tiptapRef,
    // Formatting chords need the caret in one of these panes AND the editor on
    // screen — typing ⌘B in the Cards composer used to bold the hidden doc.
    cmRef, workspaceView,
    // ⌘K now uses the styled prompt dialog instead of native window.prompt.
    promptLink: promptLinkCb,
  });

  // ── Actions ───────────────────────────────────────────────────────────────
  // The menu bar's action dispatcher (useEditorActions): copy as MD/HTML/JSON,
  // clear, file / drop / URL import, the File-menu exports, Copy as Prompt.
  const { handleAction, handleFileDropImport, handleBackupNow } = useEditorActions({
    cmRef, tiptapRef, activeDoc, engine, syncMode, linkIndex,
    getCanonical, resetHashes, setDirty, createDoc, importItems, handleSwitchDoc, handleGraphExport,
    exportDocsRef, setShowUrlImport, toast, confirm, promptText,
  });

  // ── Export ────────────────────────────────────────────────────────────────
  // Library exports (useExportActions): one document in any format, a folder,
  // a selection or everything as a ZIP. Also points exportDocsRef — which the
  // "export all" and "full backup" actions above call — at the ZIP exporter.
  const { handleExportFolder, handleExportDoc, handleExportDocs } = useExportActions({
    engine, syncMode, getCanonical, toast, toastRef, autosaveRef, exportDocsRef,
  });

  // ── Library queries ───────────────────────────────────────────────────────
  // Search, and the map's per-document headings, answered from what the link
  // index has already loaded (useLibraryQueries).
  const { headingsForDoc, searchDocBody, runSearch, handleOpenSearchResult } = useLibraryQueries({
    getCanonical, fullDocsRef, documents, handleSwitchDoc, setFindSeed, setShowFindReplace,
  });

  // ── Cards board ───────────────────────────────────────────────────────────
  // The board's handlers (useCardHandlers). It never writes the canonical
  // itself: card edits persist through patchDocById, and re-hydrate the editor
  // only after a post-await ownership check.
  const {
    cardLoadDoc, cardToMarkdown, cardRenderMarkdown,
    handleCardCreate, handleCardSave, handleCardMeta, cardFolderName,
  } = useCardHandlers({
    tiptapRef, engine, getCanonical, createDoc, patchDocById, folderState,
    prepareToLeaveActiveDoc, hydrateEditorWithDoc, handleSwitchDoc,
    activateAndCapture, isEditorTargeting, rebuildLinks, toast, toastRef,
  });

  // ── Host API ──────────────────────────────────────────────────────────────
  // The imperative handle the integration wrapper and the iframe host bridge
  // drive (useHostApi). Called after useEditorActions because exportAs goes
  // through handleAction; the handle is attached in the layout phase, after
  // the releaseEditor cleanup's layout effect, as it always was.
  useHostApi({
    _integrationRef, _onIntegrationGraphUpdate,
    cmRef, tiptapRef, engine, getCanonical, setFromHtml,
    fidelityReport, activeDoc, createDoc, switchToDoc, patchDocById,
    setMode, setChrome, fullDocsRef, rebuildLinks,
    handleSwitchDoc, hydrateEditorWithDoc, prepareToLeaveActiveDoc,
    activateAndCapture, isEditorTargeting, waitForEditor, handleAction,
  });

  // E4: focus + inert handling for the full-screen overlays (useOverlayInert).
  // Called LAST among the effects, where it always ran: when a surface opens it
  // captures the element to restore focus to AFTER the surface-open flush above.
  const anyOverlayOpen = workspaceView !== "editor";
  useOverlayInert(overlayRef, anyOverlayOpen);

  // A082. Without a `dir` prop, sonner's <Toaster> reads
  // getComputedStyle(document.documentElement).direction on EVERY render — and
  // it re-renders with this shell on every autosave, forcing a synchronous
  // style recalculation of the whole page each time. Read it once.
  const [toasterDir] = useState<"ltr" | "rtl">(() =>
    typeof document !== "undefined" && getComputedStyle(document.documentElement).direction === "rtl" ? "rtl" : "ltr"
  );

  if (!engineReady || !editorReady) {
    return (
      <div className={`flex ${fitParent ? "h-full" : "h-dvh"} flex-col items-center justify-center gap-4 bg-background`}>
        <Icons.Flask className="size-8 animate-pulse text-primary" />
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{t("app.initializingEngine")}</p>
      </div>
    );
  }

  return (

   <DialogProvider value={dialogApi}>
    <TooltipProvider>
      {/* `perssonify-editor` is the editor ROOT class. It is a styling hook, not
          decoration: the page-level rules in styles.css are scoped so they cannot
          repaint a library consumer's whole page, and this class is how the
          editor subtree still receives its border/outline tokens when there is no
          `.pf-app` shell around it. */}
      <div
        ref={containerRef}
        className={`perssonify-editor flex ${fitParent ? "h-full" : "h-dvh"} flex-col overflow-hidden bg-background text-foreground transition-colors duration-300${focusMode ? " pf-focus" : ""}`}
      >

        {chrome === "full" && (
          <MenuBar
            activeDocId={activeDocId}
            docTitle={activeDoc?.title || t("common.untitled")}
            mode={mode}
            setMode={handleSetMode}
            onAction={handleAction}
            dispatch={dispatch}
            onNew={handleNewDoc}
            onSave={handleSave}
            onRevert={handleRevertDoc}
            onClose={closeActiveTab}
            onToggleSidebar={toggleSidebar}
            onFindReplace={openFind}
            onReplace={openReplace}
            onClipboard={handleClipboard}
            onSearch={openSearchPanel}
            onSettings={openSettings}
            onGraph={showMapView}
            onCards={showCardsView}
            onEditor={showEditorView}
            cardsActive={workspaceView === "cards"}
            onOutline={showOutlineTab}
            graphActive={workspaceView === "map"}
            onMemory={openMemory}
            onVersionHistory={openVersionHistory}
            onLinkBuilder={openLinkBuilder}
            onAbout={onAbout}
            onHelp={onHelp}
            onStartTour={onStartTour}
            accountControl={accountControl}
          />
        )}

        {/* Minimal chrome: a slim title strip so the user knows which doc is
            open, without tabs/actions. "none" shows the document surface only. */}
        {chrome === "minimal" && activeDocId && (
          <div className="flex h-8 shrink-0 items-center border-b border-border bg-background px-3">
            <span className="truncate text-xs font-medium text-muted-foreground">
              {activeDoc?.title || t("common.untitled")}
            </span>
          </div>
        )}

        {activeDocId && !chromeMinimal && !readOnly && (
          <EditorToolbar
            toast={toast}
            mode={mode}
            dispatch={dispatch}
            updateFormats={updateFormats}
            setFocusedPane={setFocusedPane}
            showFindReplace={showFindReplace}
            toggleFindReplace={openFind}
            saveStatus={saveStatus}
            onSave={handleSave}
          />
        )}


        <div ref={trayRegionRef} className="pf-tray-region relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <SettingsSheet open={showSettings} onOpenChange={setShowSettings} onBackup={handleBackupNow} />
            <MemorySheet open={showMemory} onOpenChange={setShowMemory} />
            <VersionHistorySheet
              open={showVersionHistory}
              onOpenChange={setShowVersionHistory}
              activeDocId={activeDocId}
              onRestoreInPlace={restoreSnapshotInPlace}
              onRestoreAsNew={restoreSnapshotAsNew}
            />
            <LinkBuilderDialog open={showLinkBuilder} onOpenChange={setShowLinkBuilder} />


            {showFindReplace && (
              <LazyChunkBoundary label={t("app.findAndReplace")}>
                <React.Suspense fallback={null}>
                  <FindReplaceBar sourceRef={cmRef} previewRef={tiptapRef} mode={mode} onSync={forceSyncMdToHtml} syncHtmlToMd={forceSyncHtmlToMd} initialQuery={findSeed} initialMode={frMode} initialTarget={lastFocusedPaneRef.current === "md" ? "md" : "richtext"} onClose={closeFindReplace} />
                </React.Suspense>
              </LazyChunkBoundary>
            )}

            <SearchPanel
              open={showSearch}
              search={runSearch}
              onOpenResult={handleOpenSearchResult}
              onClose={closeSearchPanel}
            />

            <div className="pf-editor-row relative flex min-h-[10rem] flex-1 flex-row">
            {/* The workspace panel comes BEFORE <main> in the DOM (A094). It used to
                render after it and be pulled left with md:order-first, so visual
                order and tab order disagreed: the library was reached only after
                the toolbar and BOTH editors. The docked column is a plain flex
                item now; the phone drawer is absolutely positioned either way. */}
            {!chromeMinimal && showSidebar && (
              <React.Suspense
                fallback={<div className="hidden border-r border-border md:block md:w-[var(--ws-w)] md:shrink-0" style={{ ["--ws-w" as string]: `${docNavWidth}px` }} aria-hidden />}
              >
                <WorkspacePanel
                  tab={workspaceTab}
                  onTabChange={setWorkspaceTab}
                  onClose={closeWorkspacePanel}
                  onOpenCards={showCardsView}
                  width={docNavWidth}
                  onResize={setDocNavWidth}
                  onSelect={handleSelectDocFromPanel}
                  onNew={handleNewDoc}
                  onDelete={handleDeleteDoc}
                  onRename={handleRenameFromPanel}
                  onDuplicate={handleDuplicateFromPanel}
                  onFileDrop={handleFileDropImport}
                  onExportFolder={handleExportFolder}
                  onExportDocs={handleExportDocs}
                  onExportDoc={handleExportDoc}
                  onSearchBody={searchDocBody}
                  headings={docNavHeadings}
                  activeIndex={activeHeadingIndex}
                  onNavigateHeading={handleNavigateHeading}
                />
              </React.Suspense>
            )}
            {/* Reopen affordance when the panel is collapsed. */}
            {!chromeMinimal && !showSidebar && (
              <button
                type="button"
                onClick={openWorkspacePanel}
                title={t("app.openWorkspacePanel")}
                data-print-hide
                aria-label={t("app.openWorkspacePanel")}
                className="absolute left-1 top-1 z-10 flex size-8 items-center justify-center rounded-md border border-border bg-card/80 text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
              >
                <PanelLeft className="size-4" />
              </button>
            )}
            <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">

              {activeDocId ? (
                <>
                  <EditorContextMenu api={contextMenuApi}>
                  <EditorLayout
                    mode={mode} cmRef={cmRef} tiptapRef={tiptapRef}
                    onMdChange={handleMdChange} onHtmlChange={handleHtmlChange} onHtmlPaste={handleHtmlPaste}
                    syncMode={syncMode} onSyncModeChange={handleSyncModeChange}
                    pasteStyled={pasteStyled} setPasteStyled={setPasteStyled}
                    onFocusMd={handleFocusMdPane} onFocusHtml={handleFocusHtmlPane}
                    onFileDrop={handleFileDropImport}
                    onEditLink={editLinkCb}
                  />
                  </EditorContextMenu>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-foreground select-none">
                  <FileTextIcon className="size-8 opacity-60" />
                  <p className="text-sm font-medium opacity-60">{t("app.noDocumentOpen")}</p>
                  <p className="text-xs opacity-60">{t("app.noDocumentOpenHint")}</p>
                  <Button variant="default" size="lg" onClick={handleNewDoc}>{t("app.createNewDocument")}</Button>
                </div>
              )}

              {/* Graph renders as an OVERLAY above the editor — never in place of
                  it. The live TipTap editor is the canonical source of truth
                  (see CLAUDE.md); unmounting it while the graph was open made
                  getCanonical() read an empty editor ("no headings") and the
                  document render blank on return. Keep the editor mounted. */}
              {/* ONE overlay shell for both workspace surfaces. Rendering them
                  as two independent blocks let both mount at once — two
                  `aria-modal` dialogs at the same z-index, the map invisible
                  beneath Cards, and one `overlayRef` shared between them. The
                  exclusive `workspaceView` makes that unrepresentable. */}
              {workspaceView !== "editor" && (
                /* Deliberately NOT a modal dialog. This overlay covers
                   <main> only — the menu bar, the workspace panel and the
                   surface switcher stay visible and usable beside it BY DESIGN
                   (see CLAUDE.md), so claiming the rest of the page is inert was
                   simply false, and a screen reader was told to ignore controls
                   the design intends you to use. It is a labelled region that
                   swaps what <main> shows; the editor it covers is marked
                   `inert` by the effect above. */
                <div
                  ref={overlayRef}
                  tabIndex={-1}
                  data-workspace-overlay={workspaceView}
                  role="region"
                  aria-label={workspaceView === "map" ? t("app.overlayMap") : t("app.overlayCards")}
                  className="absolute inset-0 z-30 bg-background outline-none"
                >
                  <React.Suspense fallback={<div className="flex h-full items-center justify-center text-muted-foreground">{workspaceView === "map" ? t("app.loadingGraph") : t("app.loadingCards")}</div>}>
                    {workspaceView === "map" ? (
                      <GraphView
                        graph={graphData ?? { nodes: [], edges: [] }}
                        folders={graphFolders}
                        activeDocId={activeDocId}
                        unresolved={linkIndex?.unresolved}
                        onNavigate={(id) => { handleSwitchDoc(id); setWorkspaceView("editor"); }}
                        onExport={handleGraphExport}
                        headingsFor={headingsForDoc}
                        onOpenHeading={(id, index) => { void scrollToHeading(id, index); }}
                        onClose={() => setWorkspaceView("editor")}
                      />
                    ) : (
                      <CardsView
                        docs={documents}
                        activeDocId={activeDocId}
                        readOnly={readOnly}
                        loadDoc={cardLoadDoc}
                        toMarkdown={cardToMarkdown}
                        renderMarkdown={cardRenderMarkdown}
                        onCreate={handleCardCreate}
                        onSaveCard={handleCardSave}
                        onPatchMeta={handleCardMeta}
                        onDelete={handleDeleteDoc}
                        onOpenInEditor={(id) => { handleSwitchDoc(id); setWorkspaceView("editor"); }}
                        onClose={() => setWorkspaceView("editor")}
                        folderNameFor={cardFolderName}
                      />
                    )}
                  </React.Suspense>
                </div>
              )}
            </main>
            </div>

            {/* Storage-durability notices (A017/A022/A004): one slim strip in
                the flow above the status bar, never over the document. */}
            {chrome !== "none" && (
              <DurabilityNotices
                appNotices={durabilityNotices}
                checkStorage={!storageAdapter}
                onBackup={handleBackupNow}
                onImportFiles={handleFileDropImport}
                onOpenVersionHistory={openVersionHistory}
              />
            )}

            {/* B1: in FLOW above the tray/status bar. It used to be position:fixed
                bottom-0, which covered every status-bar control on phones and the
                last 100px of the document. */}
            {!chromeMinimal && <AdUnit variant="floating-bar" />}

            {!chromeMinimal && (
              <BottomTray
                open={trayOpen}
                activeTab={trayTab}
                onTabChange={setTrayTab}
                onClose={closeTray}
                tabs={trayTabs}
              />
            )}

            {!chromeMinimal && (
              <StatusBar
                onOpenMemory={openMemory}
                onToggleLinks={toggleLinksTray}
                linksActive={trayOpen && trayTab === "links"}
                trayOpen={trayOpen}
                onToggleTray={toggleTray}
              />
            )}

            {/* B2. The status bar is the app's bottom edge, and sonner's default
                offset puts a bottom-right toast straight over it — worst on a
                phone, where the bar is exactly where the save state and the
                fidelity warning live. Clear the bar's height plus a margin. */}
            <Toaster position="bottom-right" offset={48} expand={false} richColors closeButton dir={toasterDir} containerAriaLabel={t("app.notifications")} />
            {ConfirmDialog}
            {UnsavedChangesDialog}
            <PromptDialog
              open={promptState.open}
              title={promptState.title}
              description={promptState.description}
              placeholder={promptState.placeholder}
              defaultValue={promptState.defaultValue}
              type={promptState.type}
              onConfirm={(v) => handlePromptClose(v)}
              onCancel={() => handlePromptClose(null)}
            />
            <EquationDialog
              open={equationState.open}
              title={equationState.title}
              description={equationState.description}
              display={equationState.display}
              defaultValue={equationState.defaultValue}
              confirmLabel={equationState.confirmLabel}
              onConfirm={(v) => handleEquationClose(v)}
              onCancel={() => handleEquationClose(null)}
            />
            <UrlImportDialog
              open={showUrlImport}
              initialUrl={importUrlSeed ?? undefined}
              /* NEVER auto-start from a deep link — see `initialImportUrl`. */
              autoStart={false}
              onImport={handleImportUrl}
              onCancel={() => { setShowUrlImport(false); setImportUrlSeed(null); }}
            />
        </div>
      </div>
    </TooltipProvider>
   </DialogProvider>
  );
}
