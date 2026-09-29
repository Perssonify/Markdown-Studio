import { Toaster } from "@/components/ui/sonner";
import React, { RefObject, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { toast as toastSonner } from "sonner";
import { useMarkdownEngine } from "./engine/useMarkdownEngine";
import { useSyncEngine } from "./engine/useSyncEngine";
import { useFormatDispatcher } from "./formatting/useFormatDispatcher";
import { useDocumentLifecycle } from "./hooks/useDocumentLifecycle";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts.js";
import { useLinkIndex, type LinkClickPayload } from "./hooks/useLinkIndex";
import { buildContextPrompt } from "./integration/prompt-builder";
import type { DocumentRecord } from "./store/document";
import { extractText, resolveDocTitle } from "./store/document";
import { AUTOSAVE_MS } from "./constants";
import { collectUnloadStash, ConflictError, describeUncommittedSave, isBlankCanonical, useDocumentStore } from "./store/documentStore";
import { snapshotStore } from "./store/snapshot-store";
import { stashUnsaved, type RecoveryEntry } from "./store/crash-recovery";
import { appendHtmlToCanonical, htmlToCanonical } from "./store/canonical-ops";
import { canonicalMisfit, CURRENT_SCHEMA_VERSION, isNewerSchema } from "./store/schema-version";
import { useEditorStore } from "./store/editorStore";
import type { IDBStorageConfig, StorageMetrics } from "./store/idb-storage-adapter";
import { downloadBlob, exportAsHtml, exportAsJson, exportAsMarkdown, exportTimestamp, getFileContentAndFormat } from "./store/import-export";
import { printHtmlDocument } from "./store/print-export";
import type { IngestFormat } from "./store/ingest";
import { sanitizeForIngest } from "./store/ingest";
import { exportGraph } from "./store/link-index";
import type { StorageAdapter } from "./store/storage-adapter";
import { StorageQuotaError } from "./store/storage-adapter";
import { canonicalToHtml, canonicalToMarkdown } from "./engine/serialize-doc";
import { extractHeadings } from "./store/doc-outline";
import { historyCache } from "./store/history-cache";
import { MemorySheet } from "./ui/MemorySheet";
import { VersionHistorySheet } from "./ui/VersionHistorySheet";
import { LinkBuilderDialog } from "./ui/LinkBuilderDialog";
import { ArchiveEncryptedError, ArchiveWrongPasswordError, archiveEntriesToItems, buildZip, extractArchive, isArchiveName, type ArchiveEntry } from "./store/archive";
import { collectFolderExport, groupDocsByFolder, useFolderStore } from "./store/folders";
import type { ImportResource } from "./store/url-import";
import { searchDocuments } from "./store/search";
import { docSearchText, docSearchTextLower } from "./store/doc-text";
import { normalizeMarkdownFeatures } from "./store/settings";
import { useUIStore } from "./store/uiStore";
import { MenuBar } from "./ui/MenuBar";
import { AdUnit } from "./ui/AdUnit";
import { BacklinksPanel } from "./ui/BacklinksPanel";
import { BottomTray } from "./ui/BottomTray";
import { trayFits } from "./ui/tray-fit";
import { EditorLayout } from "./ui/EditorPanes";
import { EditorContextMenu } from "./ui/EditorContextMenu";
import { Icons } from "./ui/Icons";
import { StatusBar } from "./ui/StatusBar";
import { ToastType, useToast } from "./ui/Toast";
import { EditorToolbar } from "./ui/Toolbar";
import { diagError } from "./utils/diag";

// Handle types for the sub-panes
import { FileTextIcon, Link as LinkIcon, TerminalSquare } from "lucide-react";
import { useActiveHeading } from "./hooks/useActiveHeading";
import { useIsMobile } from "./hooks/use-mobile";
import { ConsolePanel } from "./ui/ConsolePanel";
import { getBacklinks, getForwardLinks } from "./store/link-index";
import type { ConsoleContext } from "./store/console-commands";
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
const FindReplaceBar = React.lazy(() => import("./ui/FindReplace").then((m) => ({ default: m.FindReplaceBar })));
const GraphView = React.lazy(() => import("./ui/GraphView").then((m) => ({ default: m.GraphView })));
const CardsView = React.lazy(() => import("./ui/CardsView").then((m) => ({ default: m.CardsView })));
const WorkspacePanel = React.lazy(() => import("./ui/WorkspacePanel").then((m) => ({ default: m.WorkspacePanel })));

// Stable empty outline reference for when the nav panel is closed (avoids a
// fresh array identity churning DocNavPanel memoization).
const EMPTY_HEADINGS: ReturnType<typeof extractHeadings> = [];

/** What the user is told when autosave finds storage full — what happened
 *  and, more to the point, what would fix it. */
const STORAGE_FULL_MESSAGE =
  "Storage is full — your latest changes are NOT saved. Free space by deleting documents or old versions (Tools ▸ Version history), then keep typing to retry.";

interface PerssonifyEditorProps {
  _integrationRef?: RefObject<any>;
  _onIntegrationChange?: (payload: any) => void;
  _onIntegrationLinkClick?: (payload: LinkClickPayload) => boolean | void;
  _onIntegrationGraphUpdate?: (graph: any) => void;

  /**
   * Inject a fully custom StorageAdapter. When provided, the editor will not
   * touch localStorage or IndexedDB directly — all persistence is delegated
   * to this adapter.
   */
  storageAdapter?: StorageAdapter;

  /**
   * Configure the built-in IndexedDB adapter without providing a full adapter.
   * Ignored when storageAdapter is provided.
   */
  storageConfig?: IDBStorageConfig;

  /**
   * Called after every successful save or delete with updated storage metrics.
   * Only fires when the active adapter supports metrics (IndexedDBStorageAdapter).
   */
  onStorageMetricsChange?: (metrics: StorageMetrics) => void;

  /**
   * Called when a save is rejected because the configured storage quota would
   * be exceeded. Use this to show a custom error UI.
   */
  onStorageQuotaExceeded?: (err: StorageQuotaError) => void;

  /**
   * Called on every content change (debounced ~300ms). Use for realtime sync
   * to an external system without waiting for an explicit save.
   */
  onContentChange?: (payload: { docId: string; markdown: string; html: string; canonical: any }) => void;

  /**
   * Called after the user explicitly saves a document (Save button or Ctrl+S),
   * after the IndexedDB write has completed successfully.
   */
  onSave?: (payload: { docId: string; markdown: string; html: string; canonical: any }) => void;

  /**
   * Set the editor view mode on first render. One of "md" | "html" | "split".
   * If the user has a stored preference, that wins; initialMode is only used
   * if no preference has been saved yet (first launch or prefs key absent).
   * Subsequent mode changes by the user are not overridden.
   * Defaults to "split".
   */
  initialMode?: "md" | "html" | "split";

  /**
   * Chrome level for the editor UI. "full" (default) shows the tab bar,
   * formatting toolbar, and status bar. "minimal" keeps a slim title strip + the
   * document surface (no formatting toolbar / status bar / ads / backlinks) for a
   * small embedded panel. "none" shows the document surface only. Runtime
   * switchable via the imperative handle's setChrome().
   */
  chrome?: "full" | "minimal" | "none";

  /**
   * Markdown string used to seed a new document when no stored documents
   * exist. When the storage adapter already has documents this prop is
   * ignored so existing work is never overwritten.
   */
  /** Extra first-run documents, seeded ONLY when storage is empty and only
   *  after `initialDocument` is live in the editor. The standalone app uses
   *  this to ship a small linked set so the relationship map opens on a real
   *  graph instead of one unconnected dot; embedders get exactly the one
   *  `initialDocument` they asked for. */
  starterDocuments?: { markdown: string; folderPath?: string[] }[];
  initialDocument?: {
    /** Document title shown in the tab bar and sidebar. */
    title?: string;
    /** Raw markdown content of the document. */
    content: string;
  };

  /**
   * Standalone-app hooks. When the app provides these, About/Help open as
   * routed interior pages and the graph's open state is URL-controlled. When
   * omitted (library / iframe embed), the editor falls back to its built-in
   * dialogs and internal graph toggle, so embedders are unaffected.
   */
  onAbout?: () => void;
  onHelp?: () => void;
  onStartTour?: () => void;
  /** Controlled graph visibility (paired with onGraphOpenChange). */
  graphOpen?: boolean;
  onGraphOpenChange?: (open: boolean) => void;

  /**
   * Open the URL importer PRE-FILLED with this source (the standalone app
   * passes it from `?import_url=`). It never fetches on its own: the user
   * reviews the URL and presses Fetch, so a shared link cannot make the
   * visitor's browser hit an attacker-chosen address on load.
   *
   * The parameter was documented in Help and emitted by the share-link builder
   * for a long time while nothing read it — the seed state existed but was
   * never set, so every generated import link silently did nothing.
   */
  initialImportUrl?: string;

  /**
   * Open read-only: editing disabled, formatting toolbar hidden, view mode
   * locked. Applied for THIS SESSION only (never the persisting setter), so a
   * host embedding one read-only editor cannot leave the visitor's own saved
   * preference stuck read-only — the same rule `?readonly=` follows.
   *
   * The standalone app and the iframe embed both had this; a library consumer
   * had to import `useUIStore` from the `/store` subpath and poke it by hand.
   */
  readOnly?: boolean;

  /**
   * Size to the parent element (which must have a definite height) instead of
   * the viewport. The standalone app uses this to fit the editor under its
   * brand header — without it the editor is viewport-height and the page
   * scrolls by exactly the header height, drifting the chrome off-screen.
   * Library/iframe embedders keep the default viewport sizing.
   */
  fitParent?: boolean;
}

export function PerssonifyEditor({
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
  graphOpen,
  onGraphOpenChange,
  initialImportUrl,
  readOnly: readOnlyProp,
  fitParent = false,
}: PerssonifyEditorProps) {

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
  // re-renders this 1500-line component on EVERY store write — which meant ≥2
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
    initialize, createDoc, finalizeDoc, saveActiveDoc,
    setDirty, revertActiveDoc, switchToDoc, closeTab,
    deleteDoc, renameDoc, duplicateDoc, patchDocById,
    updateDerived, setEngine, setSyncModeInternal,
    initStorage,
  } = useDocumentStore(
    useShallow((s) => ({
      documents: s.documents, activeDoc: s.activeDoc, activeDocId: s.activeDocId,
      fidelityReport: s.fidelityReport, storageMetrics: s.storageMetrics, saveStatus: s.saveStatus,
      initialize: s.initialize, createDoc: s.createDoc, finalizeDoc: s.finalizeDoc, saveActiveDoc: s.saveActiveDoc,
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

  // Graph visibility: URL-controlled by the standalone app (onGraphOpenChange
  // provided) or falls back to the UI store's internal toggle for embedders.
  const graphControlled = onGraphOpenChange != null;
  const graphVisible = graphControlled ? !!graphOpen : showGraph;
  const setGraphVisible = useCallback((v: boolean) => {
    if (onGraphOpenChange) onGraphOpenChange(v);
    else setShowGraph(v);
  }, [onGraphOpenChange, setShowGraph]);

  // Cards board visibility. Local (not URL-controlled) so embedders get it for
  // free; like the graph it is an OVERLAY — the editor stays mounted beneath.
  const [cardsVisible, setCardsVisible] = useState(false);

  /** The workspace surface currently covering the editor.
   *
   *  Map and Cards are PEERS — two full-canvas views of the same library — so
   *  they are ONE exclusive selection, not two independent booleans. They used
   *  to be exactly that, and both could mount at once: two `aria-modal` dialogs
   *  stacked at the same z-index, the second one invisible underneath the first
   *  (opening the map while Cards was up looked like a dead menu item), sharing
   *  a single `overlayRef` so focus landed on whichever mounted last.
   *
   *  Route the graph through `setGraphVisible` (not `setShowGraph`) so the
   *  standalone app's /graph URL control keeps working. */
  const workspaceView: "editor" | "map" | "cards" =
    cardsVisible ? "cards" : graphVisible ? "map" : "editor";
  const setWorkspaceView = useCallback((view: "editor" | "map" | "cards") => {
    setCardsVisible(view === "cards");
    setGraphVisible(view === "map");
  }, [setGraphVisible]);
  /** Keyboard shortcuts stay TOGGLES — ⌘⇧K pressed twice should put you back —
   *  even though the on-screen control is a three-way radio where Editor is its
   *  own option rather than "the other two are off". */
  const toggleWorkspaceView = useCallback((view: "map" | "cards") => {
    setWorkspaceView(workspaceView === view ? "editor" : view);
  }, [setWorkspaceView, workspaceView]);

  /** Picking a layout (Markdown / Rich / Split) implies you want the editor:
   *  those panes are invisible under an overlay, so a mode change there would
   *  otherwise be a control that silently does nothing. */
  const handleSetMode = useCallback((m: string) => {
    setMode(m);
    setWorkspaceView("editor");
  }, [setMode, setWorkspaceView]);

  // Shared overlay shell for the graph / cards boards. Takes focus on mount,
  // keeps Tab inside, closes on Escape at the CAPTURE phase (ProseMirror marks
  // Escape defaultPrevented before it bubbles, which is why a plain bubble
  // listener never fired), and marks the editor behind it inert so its controls
  // are neither tabbable nor clickable while covered.
  const overlayRef = useRef<HTMLDivElement | null>(null);


  const [showSettings, setShowSettings] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showLinkBuilder, setShowLinkBuilder] = useState(false);
  // Expandable bottom tray (tabbed). Document Links is the first tab; a console /
  // diagnostics tab is planned (docs/backlog.md). Collapsed by default so it costs
  // no vertical space; the status-bar links chip / chevron toggle it.
  const [trayOpen, setTrayOpen] = useState(false);
  const [trayTab, setTrayTab] = useState("links");
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
  // Stable indirection to the multi-doc zip exporter (defined below handleAction),
  // so handleAction can trigger "export all" without a forward dependency.
  const exportDocsRef = useRef<(ids: string[], zipName: string, opts?: { canonical?: boolean }) => void>(() => {});

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

  // Persist mode preference whenever the user switches modes (after init)
  useEffect(() => {
    if (!initDoneRef.current) return;
    useDocumentStore.getState().getStorage().setPrefs({ editorMode: mode }).catch(() => { });
  }, [mode]);

  // Persist markdown feature/flavor settings whenever they change (after init)
  useEffect(() => {
    if (!initDoneRef.current) return;
    useDocumentStore.getState().getStorage().setPrefs({ markdownFeatures }).catch(() => { });
  }, [markdownFeatures]);

  // Persist the folder tree overlay whenever it changes (after init).
  useEffect(() => {
    return useFolderStore.subscribe((state) => {
      if (!initDoneRef.current) return;
      useDocumentStore
        .getState()
        .getStorage()
        .setPrefs({
          folderTree: {
            folders: state.folders,
            docParents: state.docParents,
            docOrder: state.docOrder,
            expanded: state.expanded,
          },
        })
        .catch(() => { });
    });
  }, []);

  // Drop folder metadata for documents that no longer exist.
  useEffect(() => {
    if (!initDoneRef.current) return;
    useFolderStore.getState().pruneOrphans(new Set(documents.map((d) => d.id)));
  }, [documents]);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const cmRef = useRef<CodeMirrorPaneHandle>(null);
  const tiptapRef = useRef<TiptapPaneHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const initDoneRef = useRef(false);
  const contentChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Misc hooks ────────────────────────────────────────────────────────────
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const { confirmUnsaved, UnsavedChangesDialog } = useUnsavedChangesConfirm();
  const { prompt: promptText, promptState, handlePromptClose, equation: equationPrompt, equationState, handleEquationClose } = useDialogs();
  // Single dialog surface handed to all children via context (see DialogProvider).
  const dialogApi = React.useMemo<DialogApi>(
    () => ({ confirm, prompt: promptText, equation: equationPrompt, confirmUnsaved }),
    [confirm, promptText, equationPrompt, confirmUnsaved]
  );

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
    forceSyncMdToHtml();
  }, [configVersion, forceSyncMdToHtml]);

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

  // ── Document lifecycle ────────────────────────────────────────────────────
  const {
    handleMdChange: _handleMdChange,
    handleHtmlChange: _handleHtmlChange,
    handleHtmlPaste,
    handleSyncModeChange, handleSwitchDoc, handleCloseTab, handleRevertDoc,
    handleNewDoc, handleDeleteDoc,
    prepareToLeaveActiveDoc, hydrateEditorWithDoc,
    restoreSnapshotInPlace, restoreSnapshotAsNew,
    cancelPendingSync, flushPendingSync,
  } = useDocumentLifecycle({
    tiptapRef, cmRef, engine, syncMdToHtml, syncHtmlToMd, forceSyncMdToHtml, forceSyncHtmlToMd,
    resetHashes, setCanonical, setFromHtml, switchToDoc, closeTab,
    createDoc, deleteDoc, finalizeDoc, revertActiveDoc, saveActiveDoc,
    setDirty, handleCanonicalChange, pasteStyled, setPasteStyled,
    syncMode, setSyncMode, toast, confirm, confirmUnsaved,
  });

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
        if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
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
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const wanted = norm(anchorText);
    if (targetId !== useDocumentStore.getState().activeDocId) await handleSwitchDoc(targetId);
    setWorkspaceView("editor");
    if (mode === "md") setMode("split");
    const attempt = (tries: number) => {
      const s = useDocumentStore.getState();
      if (s.activeDocId === targetId && s.hydratedDocId === targetId) {
        const dom = tiptapRef.current?.getEditor()?.view?.dom as HTMLElement | undefined;
        const headings = dom?.querySelectorAll("h1, h2, h3, h4, h5, h6");
        if (headings) {
          for (const h of Array.from(headings)) {
            if (norm(h.textContent || "") === wanted) {
              (h as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
              return;
            }
          }
          if (headings.length) { toast.show(`Heading not found: "${anchorText}"`, "info"); return; }
        }
      }
      if (tries > 0) setTimeout(() => attempt(tries - 1), 200);
    };
    requestAnimationFrame(() => attempt(12));
  }, [handleSwitchDoc, setWorkspaceView, mode, setMode, toast, tiptapRef]);

  // Wrap MD/HTML change handlers to also emit onContentChange
  const handleMdChange = useCallback(() => {
    _handleMdChange();
    emitContentChange();
  }, [_handleMdChange, emitContentChange]);

  const handleHtmlChange = useCallback(() => {
    _handleHtmlChange();
    emitContentChange();
  }, [_handleHtmlChange, emitContentChange]);

  // ── Context menu: headings + heading-anchor insertion ───────────────────────
  // Tracks which pane the caret was last in, so an inserted anchor link lands
  // in the pane the user is actually working in (split view).
  const lastFocusedPaneRef = useRef<"md" | "html">("html");
  const getContextHeadings = useCallback(
    () => extractHeadings(getCanonical()).map((h) => ({ level: h.level, text: h.text })),
    [getCanonical]
  );
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
  // Read-only context for the diagnostics console tray tab (admin-gated). Every
  // accessor reads LIVE store/editor state so results reflect the moment a
  // command runs, not a stale render. No write path is exposed (curated,
  // read-only registry — see console-commands.ts).
  const consoleCtx = useMemo<ConsoleContext>(() => ({
    getLifecycleState: () => useDocumentStore.getState().getLifecycleState(),
    getStorageMetrics: () => useDocumentStore.getState().getStorageMetrics(),
    listDocuments: () =>
      useDocumentStore.getState().documents.map((d) => ({
        id: d.id, title: d.title, updated: d.updated, tags: d.tags,
      })),
    getActiveDocId: () => useDocumentStore.getState().activeDocId,
    getActiveOutline: () => extractHeadings(getCanonical()).map((h) => ({ level: h.level, text: h.text })),
    getLinks: (docId) => {
      const idx = useEditorStore.getState().linkIndex;
      const docs = useDocumentStore.getState().documents;
      return {
        backlinks: getBacklinks(idx, docId, docs).map((b) => ({ id: b.docId, title: b.title })),
        forwardLinks: getForwardLinks(idx, docId, docs).map((f) => ({ id: f.docId, title: f.title })),
      };
    },
    getGraph: () => {
      const idx = useEditorStore.getState().linkIndex;
      const docs = useDocumentStore.getState().documents;
      const merged = fullDocsRef.current.map((d) => ({ ...d, ...docs.find((s) => s.id === d.id) }));
      return exportGraph(merged, idx);
    },
  }), [getCanonical]);
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
        `<a data-doc-link="" data-anchor="${anchor.replace(/"/g, "&quot;")}" class="wiki-link" href="#">${anchor}</a>`
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
        toast.show("Clipboard access was blocked by the browser", "info");
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
  const showMapView = useCallback(() => setWorkspaceView("map"), [setWorkspaceView]);
  const showCardsView = useCallback(() => setWorkspaceView("cards"), [setWorkspaceView]);
  const showEditorView = useCallback(() => setWorkspaceView("editor"), [setWorkspaceView]);
  const showOutlineTab = useCallback(() => {
    setShowSidebar(true);
    setWorkspaceTab("outline");
  }, [setShowSidebar, setWorkspaceTab]);
  const closeFindReplace = useCallback(() => {
    setShowFindReplace(false);
    setFindSeed("");
  }, []);
  // The tray and the editor share one `overflow-hidden` column, and the
  // editor's floor is not shrinkable — so on a short viewport opening the tray
  // does not squeeze the editor, it clips the tray and the status bar off the
  // bottom of the app. Refuse, and say why, rather than hand over a broken
  // layout. Closing is never blocked.
  const trayRegionRef = useRef<HTMLDivElement>(null);
  const refuseTrayIfCramped = useCallback(() => {
    const h = trayRegionRef.current?.clientHeight ?? 0;
    if (trayFits(h)) return false;
    toast.show("Not enough height for the panel — make the window taller", "warning");
    return true;
  }, [toast]);

  const toggleTray = useCallback(() => {
    setTrayOpen((v) => {
      if (v) return false;
      return refuseTrayIfCramped() ? false : true;
    });
  }, [refuseTrayIfCramped]);
  // The tray tab is read inside a stable callback, so it rides a ref rather
  // than the dep array — otherwise every tab change re-created the prop and
  // re-rendered the memoized status bar.
  const trayTabRef = useRef(trayTab);
  useEffect(() => { trayTabRef.current = trayTab; }, [trayTab]);
  const toggleLinksTray = useCallback(() => {
    setTrayTab("links");
    setTrayOpen((v) => {
      const closing = v && trayTabRef.current === "links";
      if (closing) return false;
      return refuseTrayIfCramped() ? false : true;
    });
  }, [refuseTrayIfCramped]);
  const closeTray = useCallback(() => setTrayOpen(false), []);

  const navigateToDoc = useCallback((id: string) => { handleSwitchDoc(id); }, [handleSwitchDoc]);
  const closeWorkspacePanel = useCallback(() => setShowSidebar(false), [setShowSidebar]);
  const handleSelectDocFromPanel = useCallback((id: string) => {
    handleSwitchDoc(id);
    if (isMobile) setShowSidebar(false);
  }, [handleSwitchDoc, isMobile, setShowSidebar]);
  const handleRenameFromPanel = useCallback(async (id: string, title: string) => {
    try { await renameDoc(id, title); }
    catch { toastRef.current.show("Rename could not be saved", "error"); }
  }, [renameDoc]);
  const handleDuplicateFromPanel = useCallback(async (docId?: string) => {
    // Forward the ROW's id. Dropping it made every per-row Duplicate copy
    // whichever document happened to be open — FolderTree passed the id, this
    // handler swallowed it, and the store did not accept one. Rename, right
    // beside it in the same menu, forwarded its id correctly all along.
    try { await duplicateDoc(docId); }
    catch { toastRef.current.show("Duplicate could not be saved — storage may be full", "error"); }
  }, [duplicateDoc]);
  const handleNavigateHeading = useCallback((i: number) => {
    if (activeDocId) scrollToHeading(activeDocId, i);
  }, [activeDocId, scrollToHeading]);
  const closeActiveTab = useCallback(() => {
    if (activeDocId) handleCloseTab(activeDocId);
  }, [activeDocId, handleCloseTab]);
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
      const url = await promptText("Insert Link", {
        placeholder: "https://example.com", description: "Enter the URL for the link.",
      });
      if (url) dispatch("createLink", url);
      return;
    }
    if (kind === "image") {
      const url = await promptText("Insert Image", {
        placeholder: "https://example.com/image.png",
        description: "Enter the URL of the image to insert.",
      });
      if (url) dispatch("insertImage", url);
      return;
    }
    const block = kind === "mathBlock";
    const latex = await equationPrompt(block ? "Insert Formula (block)" : "Insert inline formula", {
      display: block ? "block" : "inline",
      description: block ? "LaTeX rendered with KaTeX ($$…$$)." : "Inline LaTeX ($…$).",
    });
    if (latex && latex.trim()) dispatch(block ? "insertMathBlock" : "insertMathInline", latex);
  }, [promptText, equationPrompt, dispatch]);

  const contextMenuApi = useMemo(
    () => ({ dispatch, getHeadings: getContextHeadings, insertHeadingLink, clipboard: handleClipboard, promptInsert }),
    [dispatch, getContextHeadings, insertHeadingLink, handleClipboard, promptInsert]
  );
  // Freshly-built JSX in an array literal: every render handed the memoized
  // tray a brand-new tabs array containing brand-new elements.
  const trayTabs = useMemo(() => [
    {
      id: "links",
      label: "Document Links",
      icon: LinkIcon,
      content: (
        <BacklinksPanel
          hideHeader
          backlinks={activeBacklinks}
          forwardLinks={activeForwardLinks}
          unresolved={activeUnresolved}
          onNavigate={navigateToDoc}
        />
      ),
    },
    ...(consoleEnabled
      ? [{ id: "console", label: "Console", icon: TerminalSquare, content: <ConsolePanel ctx={consoleCtx} /> }]
      : []),
  ], [activeBacklinks, activeForwardLinks, activeUnresolved, navigateToDoc, consoleEnabled, consoleCtx]);

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

  const waitForEditor = useCallback((maxMs = 1500): Promise<any> => new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const ed = tiptapRef.current?.getEditor();
      if (ed) return resolve(ed);
      if (Date.now() - start > maxMs) return resolve(null);
      requestAnimationFrame(check);
    };
    check();
  }), []);

  /**
   * Activate a freshly created document, push its ingest HTML into the live
   * editor, and capture the resulting canonical — re-checking after EVERY yield
   * that the editor still holds THIS document.
   *
   * The rAF below is a real yield, and a loop over an archive of fifty notes
   * runs for seconds — long enough for the user to click a document in the
   * library. That switch hydrates the editor with THEIR document, and capturing
   * here would then persist that content as this entry's canonical (the file's
   * own content discarded) while yanking the store back mid-switch. Re-push and
   * re-check once; if the store still is not on this document, persist the
   * pre-Tiptap canonical rather than someone else's content.
   *
   * Checked on `activeDocId` ALONE, deliberately — not through
   * `isEditorTargeting`. `finalizeDoc(..., true)` activates without marking
   * hydrated (the capture is what establishes hydration), so requiring
   * `hydratedDocId` here is false on the normal path: it sent every markdown
   * import — including the first-run starter documents — down the no-editor
   * fallback, which persists the pre-Tiptap canonical and left them all titled
   * "Untitled".
   *
   * Extracted because THREE loops need it and only one had it: `importItems`
   * carried the guard, while `addDocumentsImpl` (the host bridge's
   * `addDocuments`) and `handleCardCreate` (quick capture on the Cards board)
   * ran the identical sequence — same awaits, same rAF — unguarded.
   */
  const activateAndCapture = useCallback(async (doc: DocumentRecord) => {
    if (!doc._ingestHtml) {
      await finalizeDoc(doc, null, false);   // pmjson: canonical already set
      return;
    }
    await finalizeDoc(doc, null, true);      // activate → mounts the editor
    const editor = await waitForEditor(2000);
    if (!editor) {
      await finalizeDoc(doc, null, false);
      return;
    }
    setFromHtml(doc._ingestHtml);
    await new Promise((r) => requestAnimationFrame(r));

    const stillOurs = () => useDocumentStore.getState().activeDocId === doc.id;
    if (!stillOurs()) {
      await finalizeDoc(doc, null, true);
      setFromHtml(doc._ingestHtml);
      await new Promise((r) => requestAnimationFrame(r));
    }
    if (stillOurs()) await finalizeDoc(doc, editor, false);
    else await finalizeDoc(doc, null, false);
  }, [finalizeDoc, setFromHtml, waitForEditor]);

  /**
   * Append documents to the store (persisted), non-destructively. Reuses the
   * same two-phase create path as "New document"/file import (activate → mount
   * editor → capture canonical → persist), so markdown docs get real PM-JSON
   * canonical (and their [[wiki-links]] show up in the graph). Idempotent by id.
   *
   * Hoisted out of the imperative handle so the deprecated `setDocuments` can
   * forward to it instead of re-implementing it (badly — its own version called
   * the store's PURE createDoc and threw the results away).
   */
  const addDocumentsImpl = useCallback(async (
    inputs: Array<{ id?: string; title?: string; markdown?: string; canonical?: any }>
  ): Promise<{ ids: string[] }> => {
    const ids: string[] = [];
    let createdCount = 0;

    // Adding documents ACTIVATES the last one created and overwrites both panes,
    // so — exactly like import — this is a document-leaving path and owes the
    // open document the same goodbye: flush the pending sync, cache the draft,
    // keep the undo stack, save. Without it a host calling addDocuments (or the
    // deprecated setDocuments, which now forwards here) destroyed whatever the
    // user had typed inside the current autosave window.
    await prepareToLeaveActiveDoc();

    for (const input of inputs ?? []) {
      // dedupe against the (synchronous) in-memory summary list
      if (input.id && useDocumentStore.getState().documents.some((d) => d.id === input.id)) {
        ids.push(input.id);
        continue;
      }
      const doc = input.canonical
        ? createDoc(
            typeof input.canonical === "string" ? input.canonical : JSON.stringify(input.canonical),
            "pmjson", "api",
            { mdToHtml: engine?.mdToHtml, id: input.id ?? null }
          )
        : createDoc(input.markdown ?? "", "markdown", "api",
            { mdToHtml: engine?.mdToHtml, id: input.id ?? null });
      if (!doc) continue;
      if (input.title) { doc.title = input.title; (doc as DocumentRecord).userTitle = input.title; }
      await activateAndCapture(doc as DocumentRecord);
      ids.push(doc.id);
      createdCount++;
    }
    // Leave the editor genuinely holding whatever the store says is active. An
    // input with no ingest HTML (a `canonical`/pmjson payload, or empty
    // markdown) takes the no-editor branch, which activates WITHOUT hydrating —
    // and an activeDocId/hydratedDocId split makes `saveActiveDoc` refuse every
    // save for the rest of the session. Same hand-off `importItems` performs.
    {
      const store = useDocumentStore.getState();
      const active = store.activeDocId;
      if (active && ids.includes(active) && store.hydratedDocId !== active) {
        const rec = await store.getDocById(active).catch(() => null);
        if (rec?.canonical) hydrateEditorWithDoc(active, rec.canonical);
      }
    }

    if (createdCount > 0) {
      try { await rebuildLinks(); } catch { /* ignore */ }
      try {
        const idx = useEditorStore.getState().linkIndex;
        const docs = useDocumentStore.getState().documents;
        const merged = fullDocsRef.current.map((d) => ({ ...d, ...docs.find((s) => s.id === d.id) }));
        _onIntegrationGraphUpdate?.(exportGraph(merged as Parameters<typeof exportGraph>[0], idx));
      } catch { /* ignore */ }
    }
    return { ids };
  }, [createDoc, engine, activateAndCapture, rebuildLinks,
      _onIntegrationGraphUpdate, prepareToLeaveActiveDoc, hydrateEditorWithDoc]);

  // ── Integration imperative API ────────────────────────────────────────────
  /**
   * Is THIS document the one the editor is showing (or switching to)?
   *
   * Must be evaluated AFTER every await, never captured before one. Persisting
   * goes through IndexedDB, which is slow enough that a document switch lands
   * mid-write routinely; a pre-await snapshot then authorises pushing document
   * A's content into an editor that now holds document B, and autosave writes it
   * into B's record. This is the same chokepoint `saveActiveDoc` re-asserts
   * after its own await (see CLAUDE.md).
   *
   * Deliberately checks `activeDocId` ONLY. Also requiring `hydratedDocId` was
   * too strict and swallowed a REPAIR: when a document is active but not yet
   * hydrated, pushing its freshly-written content into the editor and marking it
   * hydrated is exactly the right move — that is how `appendToDocument` rescued
   * an activated-but-unhydrated document, and demanding hydration up front
   * turned that rescue into a silent no-op that left every later save refused.
   */
  const isEditorTargeting = useCallback(
    (id: string) => useDocumentStore.getState().activeDocId === id,
    []
  );

  useImperativeHandle(_integrationRef, () => ({
    getCanonical: () => getCanonical(),
    getMarkdown: () => cmRef.current?.getValue() || "",
    getHTML: () => tiptapRef.current?.getHTML() || "",
    getFidelityReport: () => fidelityReport,
    getGraph: () => {
      try {
        // Read live state so a host that pulls getGraph() right after a mutation
        // (e.g. addDocuments) never sees a stale render's link index / doc list.
        const idx = useEditorStore.getState().linkIndex;
        const docs = useDocumentStore.getState().documents;
        const merged = fullDocsRef.current.map((d) => ({
          ...d,
          ...docs.find((s) => s.id === d.id),
        }));
        return exportGraph(merged, idx);
      } catch { return { nodes: [], edges: [] }; }
    },
    getDocuments: () => useDocumentStore.getState().documents,
    getActiveDocument: () => activeDoc,
    getDocById: (id: string) => useDocumentStore.getState().getDocById(id),
    importContent: async (content: string, format: string) => {
      const doc = createDoc(content, format as IngestFormat, "api", { mdToHtml: engine?.mdToHtml });
      if (doc?._ingestHtml) {
        setFromHtml(doc._ingestHtml);
        const editor = tiptapRef.current?.getEditor();
        if (editor) await finalizeDoc(doc as DocumentRecord, editor);
      }
      return doc;
    },
    /**
     * @deprecated Additive alias for {@link addDocuments}; prefer that directly.
     *
     * This did nothing at all. It called the store's PURE `createDoc` — which
     * runs ingest and RETURNS a record without persisting or activating
     * anything — and discarded every result, so a host that called it (over the
     * ref API or the postMessage bridge) got a success reply and an unchanged
     * library. It is now a thin forward to the working path rather than a
     * silent no-op; the old "destructive bulk-replace" wording was never true
     * of any shipped build, so nothing can depend on it and it does NOT delete
     * the user's existing documents.
     */
    setDocuments: async (docs: any[]): Promise<{ ids: string[] }> => {
      const inputs = (docs ?? []).map((d: any) =>
        typeof d === "string"
          ? { markdown: d }
          : { id: d?.id, title: d?.title, markdown: d?.markdown, canonical: d?.canonical }
      );
      return await addDocumentsImpl(inputs);
    },
    // Append documents to the store (persisted), non-destructively. Reuses the
    // same two-phase create path as "New document"/file import (activate → mount
    // editor → capture canonical → persist), so markdown docs get real PM-JSON
    // canonical (and their [[wiki-links]] show up in the graph). Idempotent by id.
    addDocuments: addDocumentsImpl,
    // Update an existing document by id (may be non-active), persisted. Title-only
    // edits use the churn-free rename path. A body edit (markdown/canonical)
    // converts markdown → PM-JSON via the live editor's real schema so a
    // non-active doc is replaced WITHOUT switching the visible editor; only if no
    // editor is mounted do we fall back to the switch+capture path. Emits
    // onGraphUpdate. Returns { id, updated:false } when the id is unknown (never
    // silently creates).
    updateDocument: async (
      id: string,
      patch: { title?: string; markdown?: string; canonical?: any } = {}
    ): Promise<{ id: string; updated: boolean }> => {
      if (!id) return { id, updated: false };
      const existing = await useDocumentStore.getState().getDocById(id);
      if (!existing) return { id, updated: false };

      const hasBody = patch.markdown != null || patch.canonical != null;
      if (!hasBody) {
        if (patch.title != null) {
          // A title-only update must not persist the store's lagging
          // `activeDoc.canonical`. patchDocById already merges the LIVE editor
          // content for the open document (liveCanonicalFor) — and, unlike a
          // canonical passed from here, it knows a title is not content: when
          // another tab has overtaken the document it renames the stored
          // record without writing this tab's content over that tab's work.
          await patchDocById(id, { title: patch.title, userTitle: patch.title });
          await emitGraphUpdate();
        }
        return { id, updated: true };
      }

      const editor = tiptapRef.current?.getEditor();
      let canonical: any = patch.canonical ?? null;
      if (canonical == null) {
        const html = engine?.mdToHtml ? engine.mdToHtml(patch.markdown ?? "") : (patch.markdown ?? "");
        if (editor?.schema) {
          canonical = htmlToCanonical(html, editor.schema);
        } else {
          // No mounted editor to borrow a schema from (empty embed) — fall back to
          // the switch+capture path (mounts the editor; briefly changes active doc).
          const res = await captureDocFromMarkdown(id, patch.markdown ?? "", patch.title);
          await emitGraphUpdate();
          return res;
        }
      }

      const patched = await patchDocById(id, {
        canonical,
        ...(patch.title != null ? { title: patch.title, userTitle: patch.title } : {}),
      });
      // Post-await check — a switch during the write must not redirect this
      // content into whatever document the editor now holds. Through the
      // hydration ritual, so host content that does not fit this build's
      // schema is shown read-only instead of loading as an empty document.
      if (patched?.canonical && isEditorTargeting(id)) {
        hydrateEditorWithDoc(id, patched.canonical);
      }
      await emitGraphUpdate();
      return { id, updated: !!patched };
    },
    // Append markdown to the end of an existing document by id (may be non-active),
    // persisted. Churn-free: parses the new markdown into PM-JSON via the live
    // editor's schema and appends to the stored canonical WITHOUT switching docs.
    // Emits onGraphUpdate. Returns { updated:false } when the id is unknown.
    appendToDocument: async (
      id: string,
      markdown: string
    ): Promise<{ id: string; updated: boolean }> => {
      if (!id) return { id, updated: false };
      const existing = await useDocumentStore.getState().getDocById(id);
      if (!existing) return { id, updated: false };

      const editor = tiptapRef.current?.getEditor();
      const html = engine?.mdToHtml ? engine.mdToHtml(markdown ?? "") : (markdown ?? "");
      if (!editor?.schema) {
        // No mounted editor — reconstruct existing markdown + appended and capture.
        const base = engine?.htmlToCleanMd
          ? (canonicalToMarkdown(existing.canonical, engine.htmlToCleanMd) ?? "")
          : "";
        const joined = base ? `${base}\n\n${markdown ?? ""}` : (markdown ?? "");
        const res = await captureDocFromMarkdown(id, joined);
        await emitGraphUpdate();
        return res;
      }
      // Append base: when the target is the ACTIVE, hydrated document, merge
      // against the LIVE editor content — the stored canonical can be up to an
      // autosave interval stale, and merging against it would wipe those
      // unsaved edits (and persist the wipe).
      const { activeDocId: curId, hydratedDocId: hydId } = useDocumentStore.getState();
      const isActive = curId === id;
      const base = isActive && hydId === id ? editor.getJSON() : existing.canonical;
      const merged = appendHtmlToCanonical(base, html, editor.schema);
      const patched = await patchDocById(id, { canonical: merged });
      // Post-await check, for the same reason as updateDocument above.
      if (patched?.canonical && isEditorTargeting(id)) {
        // Same-document content update: keep the user's undo history.
        hydrateEditorWithDoc(id, patched.canonical, { keepHistory: true });
      }
      await emitGraphUpdate();
      return { id, updated: !!patched };
    },
    setFieldSchemas: (schemas: any) => { (window as any).__perssonifyFieldSchemas = schemas; },
    setMode: (m: "md" | "html" | "split") => setMode(m),
    setChrome: (level: "full" | "minimal" | "none") => setChrome(level),
    // Route through handleSwitchDoc (not the raw store switchToDoc): it also
    // hydrates the editor with the target doc's canonical. A bare store switch
    // left the editor holding the PREVIOUS doc's content, which the next save
    // would have written into the newly-active doc.
    openDocument: (id: string) => handleSwitchDoc(id),
    exportAs: async (format: string) => handleAction?.(`export-${format}`),
  }), [getCanonical, fidelityReport, linkIndex, documents, activeDoc, createDoc, setFromHtml, finalizeDoc, engine, setMode, handleSwitchDoc, patchDocById, setCanonical, hydrateEditorWithDoc]);

  // ── Inject storage adapter before init (runs once, synchronously before engine) ──
  const storageInjectedRef = useRef(false);
  if (!storageInjectedRef.current) {
    storageInjectedRef.current = true;
    if (storageAdapter) {
      initStorage(storageAdapter);
    } else if (storageConfig) {
      initStorage(storageConfig);
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  // Rebuild the link index and push a fresh graph to the host after a document
  // mutation (add/update/append), reading live store state so the host sees the
  // new nodes/edges without a stale-render race.
  const emitGraphUpdate = useCallback(async () => {
    try { await rebuildLinks(); } catch { /* ignore */ }
    try {
      const idx = useEditorStore.getState().linkIndex;
      const docs = useDocumentStore.getState().documents;
      const merged = fullDocsRef.current.map((d) => ({ ...d, ...docs.find((s) => s.id === d.id) }));
      _onIntegrationGraphUpdate?.(exportGraph(merged as Parameters<typeof exportGraph>[0], idx));
    } catch { /* ignore */ }
  }, [rebuildLinks, _onIntegrationGraphUpdate, fullDocsRef]);

  // Fallback body-edit path used only when no editor is mounted (empty embed):
  // mount the target doc's editor, replace content from full markdown, capture
  // canonical, and persist. This one path does briefly switch the active doc.
  const captureDocFromMarkdown = useCallback(async (
    id: string,
    markdownFull: string,
    title?: string
  ): Promise<{ id: string; updated: boolean }> => {
    if (useDocumentStore.getState().activeDocId !== id) {
      await switchToDoc(id, tiptapRef.current?.getEditor() ?? null);
    }
    const editor = await waitForEditor(2000);
    if (!editor) return { id, updated: false };
    const html = engine?.mdToHtml ? engine.mdToHtml(markdownFull) : markdownFull;
    setFromHtml(html);
    await new Promise((r) => requestAnimationFrame(r));
    useDocumentStore.getState().markHydrated(id); // editor now holds this doc's content
    const canonical = editor.getJSON();
    await patchDocById(id, {
      canonical,
      ...(title != null ? { title, userTitle: title } : {}),
    });
    return { id, updated: true };
  }, [switchToDoc, waitForEditor, engine, setFromHtml, patchDocById]);

  // Create + persist a batch of import items (each with an optional in-archive
  // folder path), creating folders as needed. Shared by file-drop import and
  // URL import so both get identical folder handling and canonical capture.
  const importItems = useCallback(async (
    items: { raw: string; format: IngestFormat; folderPath: string[] }[]
  ): Promise<{ importedCount: number; failedCount: number; firstDocId: string | null }> => {
    let importedCount = 0;
    let failedCount = 0;
    let firstDocId: string | null = null;

    // Import ACTIVATES the first imported document and overwrites both panes, so
    // it is a document-leaving path like a switch or a close — and it was the
    // only one that never said goodbye to the document already open. Anything
    // typed in the current autosave window was destroyed outright: not on disk,
    // not in the draft cache, not in undo.
    await prepareToLeaveActiveDoc();

    const folderIdByPath = new Map<string, string>();
    const ensureFolder = (segments: string[]): string | null => {
      let parentId: string | null = null;
      let acc = "";
      for (const seg of segments) {
        acc = acc ? `${acc}/${seg}` : seg;
        let id = folderIdByPath.get(acc);
        if (!id) {
          // No `startNaming` — these folders are created FOR the user (archive
          // import, first-run seeding), not by them. Opting in here opened a
          // focused rename box on load, leaving a caret blinking in the library.
          id = useFolderStore.getState().createFolder(seg, parentId);
          folderIdByPath.set(acc, id);
        }
        parentId = id;
      }
      return parentId;
    };

    for (const item of items) {
      const doc = createDoc(item.raw, item.format, "file-import", { mdToHtml: engine?.mdToHtml });
      if (!doc) continue;
      if (!firstDocId) firstDocId = doc.id;
      const folderId = item.folderPath.length ? ensureFolder(item.folderPath) : null;

      // finalizeDoc rethrows persistence failures (quota, adapter errors) —
      // count them so callers can report the truth instead of "Imported N".
      try {
        if (doc._ingestHtml) {
          await finalizeDoc(doc as DocumentRecord, null, true);
          const editor = await waitForEditor(2000);
          if (editor) {
            setFromHtml(doc._ingestHtml);
            await new Promise((r) => requestAnimationFrame(r));
            // The rAF above is a real yield, and importing an archive of 50
            // notes keeps this loop running for seconds — long enough for the
            // user to click a document in the library. That switch hydrates the
            // editor with THEIR document, and capturing here would then persist
            // that document's content as this imported entry's canonical (the
            // file's actual content discarded) while yanking the store back
            // mid-switch. Re-push and re-check once; if the store still is not
            // on this import, persist the pre-Tiptap canonical rather than
            // someone else's content.
            //
            // Checked on `activeDocId` ALONE, deliberately — not through
            // `isEditorTargeting`. `finalizeDoc(..., true)` activates the document
            // without marking it hydrated (hydration is what the capture below
            // establishes), so requiring hydratedDocId here is false on the
            // normal path: it sent every markdown import — including the
            // first-run starter documents — down the no-editor fallback, which
            // persists the pre-Tiptap canonical and left them all titled
            // "Untitled".
            const stillOurs = () => useDocumentStore.getState().activeDocId === doc.id;
            if (!stillOurs()) {
              await finalizeDoc(doc as DocumentRecord, null, true);
              setFromHtml(doc._ingestHtml);
              await new Promise((r) => requestAnimationFrame(r));
            }
            if (stillOurs()) {
              await finalizeDoc(doc as DocumentRecord, editor, false);
            } else {
              await finalizeDoc(doc as DocumentRecord, null, false);
            }
          } else {
            await finalizeDoc(doc as DocumentRecord, null, false);
          }
        } else {
          await finalizeDoc(doc as DocumentRecord, null, false);
        }
      } catch (e) {
        console.warn("[importItems] Persist failed for imported doc:", e);
        failedCount++;
        continue;
      }
      if (folderId) useFolderStore.getState().moveDoc(doc.id, folderId);
      importedCount++;
    }

    // Leave the editor genuinely holding the document the store says is active.
    // A `pmjson` item has no ingest HTML, so its branch never pushes content
    // into the editor: `activeDocId` moved to the import while `hydratedDocId`
    // still pointed at the PREVIOUS document. The caller's `handleSwitchDoc`
    // could not repair it either — the ids already matched, so it returned
    // immediately — leaving the editor showing the old document's text under the
    // new document's identity, with every subsequent save refused for the rest
    // of the session ("editor is not hydrated for the active document").
    if (firstDocId) {
      const store = useDocumentStore.getState();
      if (store.activeDocId === firstDocId && store.hydratedDocId !== firstDocId) {
        const rec = await store.getDocById(firstDocId).catch(() => null);
        if (rec?.canonical) hydrateEditorWithDoc(firstDocId, rec.canonical);
      }
    }

    return { importedCount, failedCount, firstDocId };
  }, [createDoc, engine, finalizeDoc, waitForEditor, setFromHtml, prepareToLeaveActiveDoc, hydrateEditorWithDoc]);

  useEffect(() => {
    if (!engineReady || !engine || initDoneRef.current) return;
    (async () => {
      const loadingId = toastSonner.loading("Initializing editor…", { duration: Infinity });
      try {
        // Hydrate syncMode from storage prefs before rendering content
        const storage = useDocumentStore.getState().getStorage();
        // Load the per-doc history-cache config (enabled/limits) from prefs.
        void historyCache.init({
          getPrefs: () => storage.getPrefs(),
          setPrefs: (p) => storage.setPrefs(p),
        });
        const prefs = await storage.getPrefs();
        if (typeof prefs["syncMode"] === "string") {
          setInitialSyncMode(prefs["syncMode"]);
        }
        if (prefs["markdownFeatures"]) {
          setInitialMarkdownFeatures(
            normalizeMarkdownFeatures(prefs["markdownFeatures"])
          );
        }
        if (prefs["folderTree"] && typeof prefs["folderTree"] === "object") {
          useFolderStore.getState().setInitialTree(prefs["folderTree"] as any);
        }

        // A `?view_mode=` deep link (applied by App.tsx before this async init ran)
        // is authoritative for this session and must win over the persisted /
        // initialMode default — otherwise this prefs-load would clobber it. App.tsx
        // hands it off via sessionStorage because it strips the param from the URL
        // synchronously; consume it one-shot here.
        let urlMode: string | null = null;
        try {
          urlMode = sessionStorage.getItem("pf:session-view-mode");
          if (urlMode) sessionStorage.removeItem("pf:session-view-mode");
        } catch { /* ignore */ }
        if (urlMode === "md" || urlMode === "html" || urlMode === "split") {
          setMode(urlMode);
        } else if (!prefs["editorMode"]) {
          // Apply initialMode prop — only overrides if the user hasn't persisted
          // a mode preference yet (prefs key absent means first launch).
          setMode(initialMode);
        } else if (typeof prefs["editorMode"] === "string") {
          setMode(prefs["editorMode"] as "md" | "html" | "split");
        } else {
          setMode(initialMode);
        }

        const existingDoc = await initialize();
        
        if (existingDoc) {
          setEditorReady(true);
          const editor = await waitForEditor();
          if (existingDoc.canonical && editor) {
            // The hydration ritual — it also keeps a document from a newer
            // build (content this schema cannot load) read-only instead of
            // loading it as an empty editor that the next save would persist.
            hydrateEditorWithDoc(existingDoc.id, existingDoc.canonical);
          } else if (existingDoc.canonical && !editor) {
            // Editor slow to mount (cold load / slow device). Keep waiting in
            // the background and hydrate when it appears — WITHOUT this, the
            // editor stayed empty while looking "ready", and the next save
            // would have wiped the stored document. Saves stay blocked by the
            // hydratedDocId guard until hydration lands.
            void waitForEditor(60000).then((late) => {
              const s = useDocumentStore.getState();
              if (!late || s.hydratedDocId != null) return;
              const doc = s.activeDoc;
              if (!doc?.canonical) return;
              const editorEmpty = (late.getText?.() ?? "").trim().length === 0;
              if (editorEmpty) hydrateEditorWithDoc(doc.id, doc.canonical);
            });
            if (cmRef.current) {
              const html = existingDoc._ingestHtml || "";
              const md = html ? engine.htmlToMd(html) : "# " + (existingDoc.title || "Untitled") + "\n\n";
              cmRef.current.setValue(md);
            }
          } else if (cmRef.current) {
            const html = existingDoc._ingestHtml || "";
            const md = html ? engine.htmlToMd(html) : "# " + (existingDoc.title || "Untitled") + "\n\n";
            cmRef.current.setValue(md);
            // No stored canonical — PUSH the ingest content into the editor
            // before marking hydrated (setValue alone is update-suppressed, so
            // marking without pushing would let a save persist stale content).
            setFromHtml(html || engine.mdToHtml(md));
            useDocumentStore.getState().markHydrated(existingDoc.id);
          }
          toastSonner.success("Restored: " + existingDoc.title, { id: loadingId, duration: 3000 });
        } else if (initialDocument) {
          // No stored documents — seed with the provided initial document.
          let doc = createDoc(initialDocument.content, "markdown", "api", { mdToHtml: engine.mdToHtml });
          if (doc) {
            if (initialDocument.title) {
              // F4. `title` is the NAME TO FALL BACK TO, not a rename. Setting
              // `userTitle` here made seeding masquerade as a user action:
              // `resolveDocTitle` treats a non-placeholder `userTitle` as a pin,
              // so the welcome document was permanently called "Welcome" while
              // its own H1 read "Markdown Studio", and editing that heading
              // renamed nothing — alone among every document in the app. Same
              // principle as `createFolder`'s `startNaming`: a programmatic
              // creation must not leave traces only a user's action should.
              doc.title = initialDocument.title;
            }
            
            // Activate the doc in the store WITHOUT persisting (sets activeDocId)
            // This causes EditorLayout to mount and Tiptap to initialize
            await finalizeDoc(doc as any, null, true);
            
            // Set editor ready so EditorLayout mounts and Tiptap starts initializing
            setEditorReady(true);
            
            // Now wait for Tiptap to be ready with more generous timeout
            await new Promise((r) => setTimeout(r, 100)); // Give UI time to mount
            let editor = await waitForEditor(3000);

            // If we have an editor and HTML content, sync it in and persist
            if (editor && doc._ingestHtml) {
              setFromHtml(doc._ingestHtml);
              // Give Tiptap time to process the HTML
              await new Promise((r) => requestAnimationFrame(r));
              await new Promise((r) => requestAnimationFrame(r));
              // Now finalize with the editor instance to capture canonical and persist
              await finalizeDoc(doc as any, editor, false);
              // Seed the companion documents AFTER the initial doc is live, so
              // this reuses the ordinary import path (editor mounted → real
              // canonical captured) rather than a second, headless one. Then
              // return to the initial document so the user lands where they
              // expect. Best-effort: a failure here must not break startup.
              if (starterDocuments?.length) {
                try {
                  await importItems(
                    starterDocuments.map((d) => ({
                      raw: d.markdown,
                      format: "markdown" as IngestFormat,
                      folderPath: d.folderPath ?? [],
                    }))
                  );
                  await handleSwitchDoc(doc.id);
                } catch (e) {
                  diagError("initEffect.starterDocuments", e);
                }
              }
              toastSonner.success("Ready", { id: loadingId, duration: 3000 });
            } else if (cmRef.current && doc._ingestHtml) {
              // Fallback: if editor still not ready, set markdown and persist manually
              const md = engine.htmlToMd(doc._ingestHtml);
              cmRef.current.setValue(md);
              // Persist the doc with whatever canonical we have
              const storage = useDocumentStore.getState().getStorage();
              await storage.save(doc);
              const list = await storage.list();
              useDocumentStore.setState({ documents: list });
              // NOTE: deliberately NOT marking hydrated here — the editor never
              // mounted, so it holds nothing. The first md→html sync (user
              // typing) marks hydration; until then saves stay safely blocked.
              toastSonner.success("Ready", { id: loadingId, duration: 3000 });
            } else {
              toastSonner.dismiss(loadingId);
            }
          } else {
            setEditorReady(true);
            toastSonner.dismiss(loadingId);
          }
        } else {
          // No stored documents and no initialDocument — show empty state.
          setEditorReady(true);
          toastSonner.dismiss(loadingId);
        }
        initDoneRef.current = true;
      } catch (e: any) {
        setEditorReady(true); // Ensure the loading screen is dismissed
        // Optionally, store an error state if you want to display an error UI component
        // setInitError(e instanceof Error ? e : new Error(String(e)));
        toastSonner.error("Failed to initialize", { id: loadingId, duration: 4000 });
        diagError("initEffect.CRASHED", e);
      }
    })();
  }, [engineReady, engine]);

  // ── Propagate storage metrics to host 
  useEffect(() => {
    if (storageMetrics && onStorageMetricsChange) {
      onStorageMetricsChange(storageMetrics);
    }
  }, [storageMetrics, onStorageMetricsChange]);

  // ── Save handler ──────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const editor = tiptapRef.current?.getEditor();
    if (!editor) return;
    // Data-integrity guard: until initialization has pushed the document into
    // the editor, the editor is empty — saving then would overwrite the stored
    // canonical with nothing. Refuse instead of destroying content.
    if (!initDoneRef.current) return;
    // Flush any still-debounced markdown→HTML sync so the source-pane typing
    // that has not been projected yet is included in the save (the UI said
    // "Saved" while silently missing those keystrokes).
    flushPendingSync();
    try {
      // Resolution is not a commit (see saveActiveDoc): a refused blank write,
      // an ownership abort and a swallowed write error all resolve. Only a
      // committed write may say "Changes saved" or tell the host it happened.
      const committed = await saveActiveDoc(editor);
      if (!committed) {
        const { message, type } = describeUncommittedSave(useDocumentStore.getState());
        toast.show(message, type);
        return;
      }
      toast.show("Changes saved", "success");
      if (onSave && activeDoc) {
        const markdown = cmRef.current?.getValue() || "";
        const html = tiptapRef.current?.getHTML() || "";
        const canonical = getCanonical();
        onSave({ docId: activeDoc.id, markdown, html, canonical });
      }
    } catch (e) {
      if (e instanceof StorageQuotaError) {
        if (onStorageQuotaExceeded) {
          onStorageQuotaExceeded(e);
        } else {
          toast.show(e.message, "error");
        }
      } else {
        toast.show("Save failed", "error");
      }
    }
  }, [saveActiveDoc, toast, onStorageQuotaExceeded, onSave, activeDoc, getCanonical, flushPendingSync]);

  // ── Idle autosave ─────────────────────────────────────────────────────────
  // Persist the canonical PM JSON automatically after a short pause in editing.
  // Writing canonical is cheap (no markdown/HTML conversion happens here — that's
  // the sync engine's job, already debounced), so this stays responsive even for
  // large documents. Manual ⌘S / Save remains as a redundant affordance.
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorReArmRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutosaveToastRef = useRef(0);
  const autosave = useCallback(async () => {
    const editor = tiptapRef.current?.getEditor();
    if (!editor) return;
    if (!initDoneRef.current) return; // never autosave an uninitialized (empty) editor
    // Include the last ≤800ms of source-pane typing — without this flush the
    // write missed the still-debounced keystrokes while the UI said "Saved".
    flushPendingSync();
    try {
      // Autosave writes ONLY to browser storage (IndexedDB/localStorage via the
      // storage adapter). It deliberately does NOT invoke the host `onSave`
      // callback — automatic persistence stays local; sending content anywhere
      // else remains an explicit, user-initiated action (manual Save / export).
      await saveActiveDoc(editor);
      // The data-loss backstop refused to persist a blank editor over real
      // stored content (an accidental full-clear). Tell the user why it's "not
      // saving" and how to recover — otherwise it reads as a silent bug.
      if (useDocumentStore.getState().saveStatus === "blocked") {
        if (Date.now() - lastAutosaveToastRef.current > 30_000) {
          lastAutosaveToastRef.current = Date.now();
          toast.show("Document is empty — not saved. Undo to restore it, or delete the document to remove it.", "warning");
        }
      }
    } catch (e) {
      const isConflict = e instanceof Error && e.message.startsWith("This document was changed");
      if (e instanceof StorageQuotaError) {
        // saveActiveDoc parked the TERMINAL "full" status. Say what would help,
        // once per 30s — this used to toast the raw error on every retry, and
        // the retries never stopped. No re-arm: freeing space or typing retries.
        if (onStorageQuotaExceeded) onStorageQuotaExceeded(e);
        else if (Date.now() - lastAutosaveToastRef.current > 30_000) {
          lastAutosaveToastRef.current = Date.now();
          toast.show(STORAGE_FULL_MESSAGE, "error");
        }
        return;
      } else {
        // Any failed autosave means the user's latest edits are NOT persisted —
        // staying silent here let edits vanish on close with zero warning.
        // Throttle the toast (failures retry every few seconds — see below).
        const msg = isConflict
          ? e.message
          : "Autosave failed — your latest changes are not saved yet";
        if (Date.now() - lastAutosaveToastRef.current > 30_000) {
          lastAutosaveToastRef.current = Date.now();
          toast.show(msg, "warning");
        }
      }
      if (isConflict) {
        // saveActiveDoc parked a TERMINAL "conflict" status. Do NOT route it
        // through error→editing: that would re-arm autosave, which would just
        // re-detect the same conflict every few seconds (a toast + status loop).
        // Leave it visible in the status bar; the next real edit sets "editing"
        // and saving resumes (the user has chosen to keep working in this tab).
        return;
      }
      // Re-arm: the re-arm effect only fires on saveStatus TRANSITIONS, and a
      // guard-rejected save leaves the status stuck at "editing" — autosave
      // would silently die for the rest of the session. Route through a brief
      // "error" state so error→editing re-triggers the effect (and retries).
      useDocumentStore.setState({ saveStatus: "error" });
      if (errorReArmRef.current) clearTimeout(errorReArmRef.current);
      errorReArmRef.current = setTimeout(() => {
        errorReArmRef.current = null;
        if (useDocumentStore.getState().saveStatus === "error") {
          useDocumentStore.setState({ saveStatus: "editing" });
        }
      }, 3000);
    }
  }, [saveActiveDoc, onStorageQuotaExceeded, toast, flushPendingSync]);
  const autosaveRef = useRef(autosave);
  useEffect(() => { autosaveRef.current = autosave; }, [autosave]);
  // Cleared on unmount: the store is module-scoped, so a stray re-arm firing
  // after a library host unmounts the editor would resurrect a save status for
  // an editor that no longer exists.
  useEffect(() => () => {
    if (errorReArmRef.current) clearTimeout(errorReArmRef.current);
  }, []);
  // Mirrored for the unload handler, whose effect has empty deps (it must not
  // re-subscribe on every render of the shell).
  const getCanonicalRef = useRef(getCanonical);
  useEffect(() => { getCanonicalRef.current = getCanonical; }, [getCanonical]);

  // Opening the graph snapshots reality: persist in-flight edits first so the
  // link index, node sizes and doc/link counts reflect what was just typed —
  // otherwise the graph quietly renders the last-saved state and "lies".
  // Cards is the same kind of surface and needs the same treatment: it hydrates
  // every card from the STORED records, so without this the board opens showing
  // the last-saved text of the document being edited right now.
  useEffect(() => {
    const surfaceOpen = graphVisible || cardsVisible;
    if (!surfaceOpen || !initDoneRef.current) return;
    // "editing" alone is the wrong oracle for "there is unsaved work" — the
    // beforeunload handler below uses editing|saving|error|conflict, and it is
    // right. A document whose last autosave FAILED sits in "error" for up to 3s
    // per retry cycle, and one that lost a multi-tab race parks on "conflict"
    // terminally; both have unsaved content and neither was being flushed here.
    const status = useDocumentStore.getState().saveStatus;
    if (status === "editing" || status === "saving" || status === "error") {
      void autosaveRef.current();
    }
    // "conflict" and "full" are deliberately NOT re-saved (they would only be
    // refused again), but the draft must still be cached so a leaving path has
    // something to keep. prepareToLeaveActiveDoc caches it; its own save
    // attempt is refused the same way and changes nothing.
    if (status === "conflict" || status === "full") void prepareToLeaveActiveDoc();
  }, [graphVisible, cardsVisible, prepareToLeaveActiveDoc]);

  // Re-arm a debounced save whenever the document enters the "editing" state.
  useEffect(() => {
    if (saveStatus !== "editing") return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      autosaveRef.current();
    }, AUTOSAVE_MS);
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [saveStatus]);

  // ── Safety net before tab/window close ────────────────────────────────────
  // Autosave keeps the unsaved window small (≤ AUTOSAVE_MS); if a save is still
  // pending, fire one last best-effort write and warn so the last edits aren't
  // lost (IndexedDB can't be awaited during unload).
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = useDocumentStore.getState();
      // Unsaved work exists when: the active doc is dirty OR a save is in
      // flight OR the last save failed OR background docs hold cached drafts
      // (parked by doc switches — they live only in memory).
      const activeUnsaved = s.saveStatus === "editing" || s.saveStatus === "saving" || s.saveStatus === "error";
      // A conflict means this tab has unsaved edits it deliberately WON'T write
      // (another tab owns the newer version) — still warn on close, but do NOT
      // re-attempt the save (it would only re-refuse; never risk clobbering).
      // A full store is the same shape: unsaved, and a retry can only fail.
      const conflicted = s.saveStatus === "conflict" || s.saveStatus === "full";
      const drafts = s._unsavedEdits;
      if (!activeUnsaved && !conflicted && drafts.size === 0) return;

      // Best-effort persistence (IndexedDB can't be awaited during unload):
      // the active doc via a last autosave, and every parked draft directly.
      if (activeUnsaved) autosaveRef.current();

      // …and a SYNCHRONOUS stash, because "best-effort" measured out as "never"
      // on a reload: saveActiveDoc awaits a read before it writes, so the page
      // is gone before the write is even issued, and the in-memory draft cache
      // does not survive a reload either. Type a sentence and press ⌘R inside
      // the autosave window and it was on neither pane nor disk afterwards.
      // localStorage is the only store that completes while the page is being
      // torn down; documentStore.initialize adopts it on the next boot.
      // The editor's JSON belongs to hydratedDocId, not activeDocId — stashing
      // it under the wrong id is the cross-document overwrite every other path
      // in this file guards against.
      const owns = !!s.activeDocId && s.hydratedDocId === s.activeDocId;
      const live = owns ? getCanonicalRef.current() : null;
      // Which entries (and the revision each was written against — without it a
      // reload laundered a two-tab conflict) is decided by collectUnloadStash,
      // which also applies the blank-over-content backstop to parked drafts.
      const stash: RecoveryEntry[] = collectUnloadStash(
        s, live && !isBlankCanonical(live) ? live : null, Date.now()
      );
      for (const entry of stash) {
        if (entry.docId === s.activeDocId) continue;
        // Parked drafts are also written directly (best effort; the stash is
        // the copy that survives when this write does not land). patchDocById
        // measures drift against the draft's own base, so a draft another tab
        // has since overtaken is refused here rather than written over it.
        s.patchDocById(entry.docId, { canonical: entry.canonical as DocumentRecord["canonical"] }).catch(() => {});
      }
      stashUnsaved(stash);
      e.preventDefault();
    };
    // `pagehide` as well as `beforeunload`: iOS Safari does not fire
    // beforeunload at all when the tab is swiped away or the app is
    // backgrounded, and a bfcache eviction skips it too. The handler is
    // idempotent — the stash merges per document, the newest entry winning.
    const handlePageHide = () => handleBeforeUnload(new Event("pagehide") as BeforeUnloadEvent);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  /** The link bubble menu's "Edit" — through the styled dialog, not window.prompt. */
  const editLinkCb = useCallback(
    (currentUrl: string) => promptText("Edit link", {
      placeholder: "https://example.com",
      description: "Enter the URL for this link. Leave it empty to remove the link.",
      defaultValue: currentUrl,
    }),
    [promptText]
  );
  const promptLinkCb = useCallback(
    () => promptText("Insert Link", {
      placeholder: "https://example.com",
      description: "Enter the URL for the link.",
    }),
    [promptText]
  );
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
  // Hoisted, not inline: these three are dependencies of the shortcut hook's
  // effect, which registers a CAPTURE-phase keydown listener on `document`. As
  // inline arrows they changed identity on every render of this 2,500-line
  // shell, so the listener was removed and re-added on the hottest path in the
  // app — once per keystroke-driven render. Every other callback at this call
  // site was already stabilised for the same reason.
  const openSearchCb = useCallback(() => setShowSearch(true), [setShowSearch]);
  const toggleGraphCb = useCallback(() => toggleWorkspaceView("map"), [toggleWorkspaceView]);
  const toggleCardsCb = useCallback(() => toggleWorkspaceView("cards"), [toggleWorkspaceView]);
  useKeyboardShortcuts(containerRef as RefObject<HTMLElement>, {
    dispatch, updateFormats, save: handleSave, newDoc: handleNewDoc,
    toast, toggleFind: openFind, openReplace,
    openSearch: openSearchCb,
    toggleSidebar,
    toggleGraph: toggleGraphCb,
    toggleCards: toggleCardsCb,
    cancelPendingSync, tiptapRef,
    // ⌘K now uses the styled prompt dialog instead of native window.prompt.
    promptLink: promptLinkCb,
  });

  // ── Actions 
  const handleAction = useCallback(async (type: string, data?: any) => {
    if (type === "md" || type === "html" || type === "json") {
      const content = type === "md" ? cmRef.current?.getValue() : type === "html" ? tiptapRef.current?.getHTML() : JSON.stringify(getCanonical(), null, 2);
      navigator.clipboard.writeText(content || "").then(() => toast.show(`${type.toUpperCase()} copied!`, "success"));
      return;
    }
    if (type === "clear") {
      if (useUIStore.getState().readOnly) return; // read-only: don't wipe the doc
      const ok = await confirm({ title: "Clear document?", description: "All content will be removed. This cannot be undone.", confirmLabel: "Clear", destructive: true });
      if (!ok) return;
      cmRef.current?.setValue("");
      tiptapRef.current?.setHTML("");
      // Both set calls above are update-suppressed (no onChange), so without
      // this the clear was never marked dirty or persisted — reloading brought
      // the "cleared" content back. Reset hashes too, or retyping identical
      // content would hash-match stale state and skip syncing.
      resetHashes();
      // This is an EXPLICIT clear, so permit the next save to persist the blank
      // over the stored content — bypassing the data-loss backstop that refuses
      // an accidental/stale blank overwrite.
      useDocumentStore.getState().allowBlankSaveOnce();
      setDirty();
      toast.show("Content cleared", "info");
      return;
    }
    if (type === "export-graph") { handleGraphExport(); return; }
    if (type === "import-url") { setShowUrlImport(true); return; }
    if (type === "export-all-zip") {
      const ids = useDocumentStore.getState().documents.map((d) => d.id);
      exportDocsRef.current(ids, "all-documents");
      return;
    }
    if (type === "export-backup-zip") {
      // Full backup: canonical JSON per doc (styled content round-trips exactly),
      // in folders, timestamped. Re-import restores the same library state.
      const ids = useDocumentStore.getState().documents.map((d) => d.id);
      exportDocsRef.current(ids, "perssonify-backup", { canonical: true });
      return;
    }
    if (type === "export-pdf" && activeDoc) {
      const html = tiptapRef.current?.getHTML() ?? "";
      // Honor a user rename (pinned userTitle) over the content-derived heading —
      // resolveDocTitle applies the correct precedence (pin → userTitle → derived).
      const title = resolveDocTitle(activeDoc, getCanonical()).title;
      printHtmlDocument(title, html);
      return;
    }
    if (type === "prompt" && activeDoc) {
      try {
        const storage = useDocumentStore.getState().getStorage();
        // An unreadable linked document is left out of the prompt, not fatal to it.
        const docStoreGetter = { get: async (id: string) => (storage ? await storage.get(id).catch(() => null) : null) };
        const promptText = await buildContextPrompt(activeDoc, docStoreGetter, linkIndex, {
          format: "markdown",
          mdConverter: (d) => d.markdownCache ?? (engine?.htmlToMd && d.htmlCache ? engine.htmlToMd(d.htmlCache) : extractText(d.canonical)),
          includeBacklinks: true,
          maxDocs: 20,
        });
        await navigator.clipboard.writeText(promptText);
        toast.show("Prompt copied to clipboard", "success");
      } catch (e) {
        toast.show("Failed to build prompt", "error");
      }
      return;
    }
    if ((type === "export-md" || type === "export-html" || type === "export-json") && activeDoc) {
      const getHtml = () => tiptapRef.current?.getHTML() ?? "";
      // The live editor's content only when it genuinely holds this document —
      // a document locked read-only (content from a newer build) shows a
      // display copy, and exporting THAT as the JSON would lose what it lacks.
      const canonical = useDocumentStore.getState().hydratedDocId === activeDoc.id
        ? getCanonical()
        : activeDoc.canonical;
      const docForExport = {
        ...activeDoc,
        canonical,
        // Honor a user rename (pinned userTitle) over the content-derived heading.
        title: resolveDocTitle(activeDoc, canonical).title,
      };
      try {
        if (type === "export-md") {
          exportAsMarkdown(docForExport as DocumentRecord, {
            getHtml, htmlToMd: engine?.htmlToMd, htmlToCleanMd: engine?.htmlToCleanMd,
            syncMode: syncMode as "clean" | "styled",
          });
          toast.show("Markdown exported", "success");
        } else if (type === "export-html") {
          exportAsHtml(docForExport as DocumentRecord, { getHtml });
          toast.show("HTML exported", "success");
        } else if (type === "export-json") {
          exportAsJson(docForExport as DocumentRecord);
          toast.show("JSON exported", "success");
        }
      } catch (e) { toast.show("Export failed", "error"); }
      return;
    }
    if (type === "export-docx" && activeDoc) {
      try {
        const canonical = getCanonical();
        const md =
          activeDoc.markdownCache ??
          (engine?.htmlToCleanMd
            ? engine.htmlToCleanMd(tiptapRef.current?.getHTML() ?? "")
            : cmRef.current?.getValue() ?? "");
        const title = resolveDocTitle(activeDoc, canonical).title;
        const { exportAsDocx } = await import("./store/docx-export");
        await exportAsDocx(title, md);
        toast.show("Word document exported", "success");
      } catch { toast.show("Word export failed", "error"); }
      return;
    }
    if (type === "import" && data?.length) {
      const files = Array.from(data as FileList | File[]);
      const skipped: string[] = [];

      // Expand archives (zip/tar/tgz/gz) into per-entry items carrying their
      // in-archive folder path; regular files import at the root.
      const items: { raw: string; format: IngestFormat; folderPath: string[] }[] = [];
      for (const file of files) {
        if (file.type?.startsWith("image/")) continue;
        if (isArchiveName(file.name)) {
          // Password-protected ZIPs are detected inside extractArchive; prompt for
          // the password (masked) and retry, up to a few attempts on a wrong one.
          let extracted: ArchiveEntry[] | null = null;
          let password: string | undefined;
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              extracted = await extractArchive(file, password ? { password } : {});
              break;
            } catch (err) {
              if (err instanceof ArchiveEncryptedError || err instanceof ArchiveWrongPasswordError) {
                const pw = await promptText(
                  err instanceof ArchiveWrongPasswordError ? "Incorrect password — try again" : "Enter password",
                  { description: `"${file.name}" is password-protected.`, placeholder: "Password", type: "password" }
                );
                if (!pw) break; // cancelled
                password = pw;
                continue;
              }
              break; // other error → skip
            }
          }
          if (extracted) {
            for (const e of archiveEntriesToItems(extracted, file.name)) {
              items.push({ raw: e.text, format: e.format, folderPath: e.folderPath });
            }
          } else {
            skipped.push(file.name);
          }
          continue;
        }
        if ((file.size ?? 0) > 5_000_000) {
          skipped.push(file.name);
          continue;
        }
        // DOCX: a binary format — must NOT go through getFileContentAndFormat
        // (which readFileAsText's it into garbage). Convert to HTML first (lazy
        // mammoth) and feed the existing "html" ingest path (sanitize + analyze).
        if (/\.docx$/i.test(file.name)) {
          try {
            const { convertDocxToHtml } = await import("./store/docx-import");
            const { html } = await convertDocxToHtml(file);
            if (html.trim()) {
              items.push({ raw: html, format: "html", folderPath: [] });
            } else {
              skipped.push(file.name);
            }
          } catch {
            skipped.push(file.name);
          }
          continue;
        }
        const { raw, format } = await getFileContentAndFormat(file);
        items.push({ raw, format: format as IngestFormat, folderPath: [] });
      }

      try {
        const { importedCount, failedCount, firstDocId } = await importItems(items);
        if (skipped.length > 0) {
          toast.show(`Skipped ${skipped.length} file(s): ${skipped.join(", ")}`, "warning");
        }
        if (failedCount > 0) {
          toast.show(`${failedCount} file(s) could not be saved — storage may be full`, "error");
        }
        if (firstDocId) {
          // handleSwitchDoc hydrates the editor with the target's canonical —
          // a bare switchToDoc left the LAST imported file's content in the
          // editor while activating the FIRST, corrupting it on next save.
          await handleSwitchDoc(firstDocId);
          if (importedCount > 0) toast.show(`Imported ${importedCount} file(s)`, "success");
        } else if (importedCount === 0 && skipped.length === 0 && failedCount === 0) {
          toast.show("No supported files found", "warning");
        }
      } catch (e) { toast.show("Import failed", "error"); }
      return;
    }
  }, [toast, getCanonical, engine, activeDoc, syncMode, handleGraphExport, linkIndex, createDoc, importItems, handleSwitchDoc, confirm, promptText]);

  // Build a ZIP from a set of documents (each with an optional directory path)
  // and trigger a download. Markdown per doc, JSON fallback if canonical→markdown
  // serialization is unavailable. Shared by folder export and multi-select export.
  const exportDocsToZip = useCallback(
    async (
      entries: { docId: string; dirSegments: string[] }[],
      zipName: string,
      opts: { canonical?: boolean } = {}
    ): Promise<number> => {
      const storage = useDocumentStore.getState().getStorage();
      const sanitize = (s: string) =>
        s.replace(/[/\\:*?"<>|]+/g, "_").trim() || "untitled";
      const files: Record<string, string> = {};
      const used = new Set<string>();
      // Persist what is being edited RIGHT NOW before reading the library off
      // disk. Bulk and backup export sourced every document from storage alone,
      // so the open document's last autosave window — up to AUTOSAVE_MS plus the
      // pane-sync debounce — was silently missing from the ZIP. A backup that
      // quietly omits the paragraph you just typed is the worst kind.
      try { await autosaveRef.current(); } catch { /* fall through to stored copy */ }
      for (const { docId, dirSegments } of entries) {
        const rec = await storage.get(docId);
        if (!rec) continue;
        // Full backup: always write canonical ProseMirror JSON so styled content
        // (colors/highlights/fonts) round-trips exactly on re-import. Otherwise
        // prefer portable Markdown, falling back to JSON only when serialization fails.
        const md = opts.canonical
          ? null
          : (rec.markdownCache ?? (engine ? canonicalToMarkdown(rec.canonical, engine.htmlToCleanMd) : null));
        // Resolve the authoritative title (honors a pinned rename) for both the
        // filename and the backup envelope, so a renamed doc exports correctly.
        const resolvedTitle = resolveDocTitle(rec, rec.canonical).title;
        const dir = dirSegments.map(sanitize).join("/");
        const base = (dir ? dir + "/" : "") + sanitize(resolvedTitle || "untitled");
        const ext = md != null ? "md" : "json";
        let path = `${base}.${ext}`;
        let i = 1;
        while (used.has(path)) path = `${base} (${i++}).${ext}`;
        used.add(path);
        if (md != null) {
          files[path] = md;
        } else {
          // Full-fidelity backup entry: the `perssonify-document` envelope so
          // title/id/tags/metadata/created/updated all round-trip on re-import
          // (the pmjson ingest reads this envelope), not just the PM content.
          files[path] = JSON.stringify(
            {
              _format: "perssonify-document",
              _version: "1.1.0",
              // So a build OLDER than the one that wrote this opens it
              // read-only instead of blank (see schema-version.ts).
              schemaVersion: Math.max(rec.schemaVersion ?? 0, CURRENT_SCHEMA_VERSION),
              id: rec.id,
              title: resolvedTitle,
              canonical: rec.canonical,
              origin: rec.origin,
              residuals: rec.residuals,
              ingestReport: rec.ingestReport,
              metadata: rec.metadata,
              tags: rec.tags,
              created: rec.created,
              updated: rec.updated,
            },
            null,
            2
          );
        }
      }
      const count = Object.keys(files).length;
      if (count === 0) return 0;
      const zip = buildZip(files);
      // Timestamped filename (YYYYMMDD-HHMMSSmmm) so each export is implicitly
      // version-stamped — a rudimentary portability/backup system.
      const ts = exportTimestamp();
      downloadBlob(
        new Blob([zip as BlobPart], { type: "application/zip" }),
        `${sanitize(zipName)}-${ts}.zip`
      );
      return count;
    },
    [engine]
  );

  // Export a folder subtree as a ZIP of Markdown files (JSON fallback per doc
  // if canonical→markdown serialization fails).
  // Defined here rather than with the other panel callbacks: it closes over
  // handleAction, which is declared above this point.
  const handleFileDropImport = useCallback((files: FileList | File[]) => {
    handleAction("import", files);
  }, [handleAction]);

  const handleExportFolder = useCallback(async (folderId: string, opts: { canonical?: boolean } = {}) => {
    const { folders, docParents } = useFolderStore.getState();
    const root = folders.find((f) => f.id === folderId);
    const entries = collectFolderExport(folderId, folders, docParents);
    if (entries.length === 0) { toast.show("Folder has no documents", "warning"); return; }
    try {
      const count = await exportDocsToZip(entries, (root?.name || "folder") + (opts.canonical ? "-backup" : ""), opts);
      toast.show(`Exported ${count} document(s)`, "success");
    } catch { toast.show("Folder export failed", "error"); }
  }, [exportDocsToZip, toast]);

  // Export ONE library document (active or not) as a single file in the chosen
  // format. Reads the stored record and derives everything from its canonical via
  // serialize-doc helpers, so it never depends on that doc being loaded in the
  // live editor — the reusable path for a right-click "Export" on any list item.
  const handleExportDoc = useCallback(
    async (docId: string, format: "md" | "html" | "docx" | "json") => {
      try {
        const rec = await useDocumentStore.getState().getStorage().get(docId);
        if (!rec) { toast.show("Document not found", "error"); return; }
        // Prefer the LIVE canonical when this is the doc currently in the editor
        // (its stored copy can lag by up to one autosave interval).
        const live =
          useDocumentStore.getState().hydratedDocId === docId ? getCanonical() : null;
        const canonical = live ?? rec.canonical;
        // Derive the export title from the SAME canonical used for content, honoring
        // a pinned rename (resolveDocTitle) — otherwise a just-renamed or edited doc
        // exports its content under a stale filename / embedded title.
        const docForExport = {
          ...rec,
          canonical,
          title: resolveDocTitle(rec, canonical).title,
        } as DocumentRecord;
        const getHtml = () => canonicalToHtml(docForExport.canonical);
        if (format === "json") {
          exportAsJson(docForExport);
        } else if (format === "html") {
          exportAsHtml(docForExport, { getHtml });
        } else if (format === "md") {
          exportAsMarkdown(docForExport, {
            getHtml, htmlToMd: engine?.htmlToMd, htmlToCleanMd: engine?.htmlToCleanMd,
            syncMode: syncMode as "clean" | "styled",
          });
        } else {
          const md =
            docForExport.markdownCache ??
            (engine ? canonicalToMarkdown(docForExport.canonical, engine.htmlToCleanMd) : "") ?? "";
          const { exportAsDocx } = await import("./store/docx-export");
          await exportAsDocx(docForExport.title || "Untitled", md);
        }
        toast.show("Document exported", "success");
      } catch { toast.show("Export failed", "error"); }
    },
    [engine, syncMode, getCanonical, toast]
  );

  // Export an explicit set of document IDs (from sidebar multi-select, or all
  // documents) as a ZIP, preserving each doc's folder path within the archive.
  const handleExportDocs = useCallback(async (docIds: string[], zipName: string, opts: { canonical?: boolean } = {}) => {
    if (docIds.length === 0) { toast.show("No documents selected", "warning"); return; }
    const { folders, docParents } = useFolderStore.getState();
    const byId = new Map(folders.map((f) => [f.id, f]));
    const pathOf = (folderId: string | undefined): string[] => {
      const segs: string[] = [];
      let cur = folderId;
      while (cur) {
        const f = byId.get(cur);
        if (!f) break;
        segs.unshift(f.name);
        cur = f.parentId ?? undefined;
      }
      return segs;
    };
    const entries = docIds.map((docId) => ({
      docId,
      dirSegments: pathOf(docParents[docId]),
    }));
    try {
      const count = await exportDocsToZip(entries, zipName, opts);
      toast.show(`Exported ${count} document(s)`, "success");
    } catch { toast.show("Export failed", "error"); }
  }, [exportDocsToZip, toast]);
  exportDocsRef.current = handleExportDocs;

  // Create a document from URL-fetched (or pasted) content. Routes through the
  // same createDoc → ingest/sanitize → Tiptap path as file import, so remote
  // HTML is sanitized before it ever reaches the editor.
  const handleImportUrl = useCallback(async (resource: ImportResource, selectedPaths?: string[]) => {
    try {
      // Build import items from the fetched resource. Archives contribute one item
      // per selected entry (carrying its in-archive folder path); a single text
      // doc contributes one root item.
      let items: { raw: string; format: IngestFormat; folderPath: string[] }[];
      if (resource.kind === "archive") {
        const keep = selectedPaths ? new Set(selectedPaths) : null;
        const chosen = keep ? resource.entries.filter((e) => keep.has(e.path)) : resource.entries;
        items = archiveEntriesToItems(chosen, resource.name).map((e) => ({
          raw: e.text,
          format: e.format,
          folderPath: e.folderPath,
        }));
      } else {
        items = [{ raw: resource.text, format: resource.format, folderPath: [] }];
      }

      if (!items.length) { toast.show("Nothing selected to import", "warning"); return; }

      const { importedCount, failedCount, firstDocId } = await importItems(items);
      if (firstDocId) {
        await handleSwitchDoc(firstDocId); // hydrates the editor (see file-import path)
      }
      setShowUrlImport(false);
      setImportUrlSeed(null);
      if (failedCount > 0) {
        toast.show(`${failedCount} document(s) could not be saved — storage may be full`, "error");
      }
      if (importedCount > 0) {
        toast.show(
          importedCount > 1 ? `Imported ${importedCount} documents` : "Imported from URL",
          "success",
        );
      }
    } catch {
      toast.show("Import failed", "error");
    }
  }, [importItems, handleSwitchDoc, toast]);

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
      title: titleById.get(d.id) ?? d.title ?? "Untitled",
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

  // ── Loading state ─────────────────────────────────────────────────────────
  // ── Cards board handlers ───────────────────────────────────────────────────
  // The board never touches the canonical directly. Writes route through the
  // SAME guarded path the host bridge's updateDocument uses: parse markdown with
  // the live editor's schema, persist via patchDocById, and re-hydrate the live
  // editor when the edited doc is the active one — otherwise the editor would
  // keep (and later autosave) the pre-edit content over the change.
  // The revision each opened card was read from. A card edit is saved later,
  // after the board has closed it; if another tab wrote the note in between,
  // replacing the whole document with the card's text would overwrite that
  // tab's work — patchDocById refuses when the stored copy is newer than this.
  const cardBasesRef = useRef(new Map<string, string>());
  const cardLoadDoc = useCallback(async (id: string) => {
    const store = useDocumentStore.getState();
    const rec = await store.getDocById(id);
    if (!rec) return null;
    cardBasesRef.current.set(id, rec.updated);
    // Prefer the LIVE editor canonical for the document the editor currently
    // holds. Reading the stored copy meant a card opened during the autosave
    // window was seeded with pre-edit text, and saving that card wrote it back
    // over the newer content — the last few seconds of typing gone from disk AND
    // from the editor, with no snapshot and no undo. Unbounded, not bounded by
    // the autosave interval, whenever the save is parked in "blocked"/"conflict"
    // and the stored copy is therefore arbitrarily old. Same idiom as
    // `headingsForDoc` / `liveCanonicalFor`.
    const live = store.hydratedDocId === id ? getCanonical() : null;
    return {
      id: rec.id,
      title: rec.title,
      updated: rec.updated,
      created: rec.created,
      canonical: live ?? rec.canonical,
      metadata: rec.metadata || {},
    };
  }, [getCanonical]);

  const cardToMarkdown = useCallback(
    (canonical: unknown) =>
      (engine?.htmlToCleanMd ? canonicalToMarkdown(canonical, engine.htmlToCleanMd) : null) ?? "",
    [engine]
  );

  // Markdown → SANITISED HTML for the opened card's rendered view. Reuses the
  // exact markdown engine the rich pane is built from (so a card renders
  // identically) and the ingest sanitizer (so injected HTML can't carry a
  // script/handler). Returns "" when the engine isn't ready, which makes the
  // card editor fall back to markdown-only rather than showing nothing.
  const cardRenderMarkdown = useCallback(
    (markdown: string) => {
      if (!engine?.mdToHtml) return "";
      try { return sanitizeForIngest(engine.mdToHtml(markdown)); } catch { return ""; }
    },
    [engine]
  );

  const handleCardCreate = useCallback(async (markdown: string) => {
    const doc = createDoc(markdown, "markdown", "api", { mdToHtml: engine?.mdToHtml });
    if (!doc) { toast.show("Could not create the note", "error"); return; }
    // Quick capture ACTIVATES the new note and overwrites both panes (setFromHtml
    // also drops both undo stacks), so it is a document-LEAVING path and owes
    // the open document the same goodbye as import and addDocuments. It had
    // none. The surface-open flush above is not a substitute: it only fires on
    // saveStatus "editing", so a document whose last save FAILED or parked on
    // "conflict" was never flushed and never cached — its edits were on no disk,
    // in no draft, in no undo stack and in no snapshot.
    const previousDocId = useDocumentStore.getState().activeDocId;
    await prepareToLeaveActiveDoc();
    await activateAndCapture(doc as DocumentRecord);
    // …and go back where the user was. Capturing a note from the board is not a
    // request to open it; importItems switches back for the same reason.
    if (previousDocId && previousDocId !== doc.id) {
      await handleSwitchDoc(previousDocId);
    }
    try { await rebuildLinks(); } catch { /* index refresh is best-effort */ }
  }, [createDoc, engine, activateAndCapture, prepareToLeaveActiveDoc, handleSwitchDoc, rebuildLinks, toast]);

  const handleCardSave = useCallback(async (id: string, markdown: string) => {
    const editor = tiptapRef.current?.getEditor();
    if (!editor?.schema) { toast.show("Editor not ready — note not saved", "error"); return; }
    const html = engine?.mdToHtml ? engine.mdToHtml(markdown) : markdown;
    const canonical = htmlToCanonical(html, editor.schema);
    // A note from a newer build cannot be shown as a card (its source reads
    // back EMPTY), so saving the card would replace the whole note with only
    // what was typed. Refuse; keep the typing recoverable.
    const current = await useDocumentStore.getState().getDocById(id).catch(() => null);
    if (current && (isNewerSchema(current.schemaVersion) || canonicalMisfit(current.canonical, editor.schema))) {
      void snapshotStore.record(id, current.title || "Untitled", canonical, "manual").catch(() => {});
      toast.show("This note was made by a newer version of the app and can't be edited as a card — your typing is kept in Version history.", "warning");
      return;
    }
    let patched: DocumentRecord | null;
    try {
      patched = await patchDocById(id, { canonical, expectedUpdated: cardBasesRef.current.get(id) ?? null });
    } catch (e) {
      // Refused (another tab wrote this note after the card was opened) or the
      // write failed. The board has already closed the card, so its text exists
      // nowhere else: keep it recoverable in Version history, never drop it.
      const title = useDocumentStore.getState().documents.find((d) => d.id === id)?.title ?? "Untitled";
      void snapshotStore.record(id, title, canonical, "manual").catch(() => {});
      toast.show(
        e instanceof ConflictError
          ? "This note was changed in another tab — your card edit was not saved over it. It is kept in Version history."
          : "The note could not be saved — your card edit is kept in Version history.",
        "warning",
      );
      return;
    }
    if (patched) cardBasesRef.current.set(id, patched.updated);
    // Re-check AFTER the await, never before it. `patchDocById` writes to
    // IndexedDB, which is slow enough that a document switch routinely lands
    // during it — and a pre-await "is this the active doc?" snapshot would then
    // push THIS document's content into the editor now holding a DIFFERENT one,
    // which autosave duly persists under the other document's id. The save-side
    // analogue of `saveActiveDoc`'s post-await hydration re-assert.
    if (patched?.canonical && isEditorTargeting(id)) {
      hydrateEditorWithDoc(id, patched.canonical);
    }
    try { await rebuildLinks(); } catch { /* index refresh is best-effort */ }
  }, [engine, patchDocById, hydrateEditorWithDoc, rebuildLinks, toast, isEditorTargeting]);

  const handleCardMeta = useCallback(
    async (id: string, metadata: Record<string, unknown>) => {
      // Presentation-only: don't bump `updated`, or pinning a note would
      // re-sort the board as if it had been edited. touchUpdated:false writes
      // the metadata ONLY, onto the freshest stored copy.
      try {
        await patchDocById(id, { metadata, touchUpdated: false });
      } catch {
        toastRef.current.show("That change to the card could not be saved", "error");
      }
    },
    [patchDocById]
  );

  const cardFolderName = useCallback(
    (id: string) => {
      const parent = folderState.docParents?.[id];
      if (!parent) return null;
      return folderState.folders?.find((f) => f.id === parent)?.name ?? null;
    },
    [folderState]
  );


  // E4: focus + Escape + inert handling for the full-screen overlays.
  const anyOverlayOpen = workspaceView !== "editor";
  useEffect(() => {
    if (!anyOverlayOpen) return;
    const node = overlayRef.current;
    const restoreTo = document.activeElement as HTMLElement | null;
    node?.focus();

    // Make the COVERED editor genuinely unreachable. It stays mounted (a hard
    // invariant — the live TipTap editor is the canonical source of truth), so
    // without this its panes, bubble menus and buttons were still tabbable and
    // clickable underneath an opaque overlay: Tab from Cards walked the cursor
    // into an editor nobody could see. Applied imperatively to <main>'s other
    // children because React 18 does not pass `inert` through as a prop.
    const covered: Element[] = [];
    const main = node?.parentElement;
    if (main) {
      for (const child of Array.from(main.children)) {
        if (child === node) continue;
        child.setAttribute("inert", "");
        covered.push(child);
      }
    }

    const onKeyCapture = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Capture phase: ProseMirror would otherwise mark this defaultPrevented.
      const inOverlay = !!node && node.contains(document.activeElement);
      // Let the overlay's own Escape ladder (clear search first) run when focus
      // is genuinely inside it; only force-close when it can't hear the key.
      if (inOverlay) return;
      e.preventDefault();
      e.stopPropagation();
      setWorkspaceView("editor");
    };
    document.addEventListener("keydown", onKeyCapture, true);
    return () => {
      document.removeEventListener("keydown", onKeyCapture, true);
      for (const child of covered) child.removeAttribute("inert");
      if (restoreTo && document.body.contains(restoreTo)) restoreTo.focus?.();
    };
  }, [anyOverlayOpen, setWorkspaceView]);

  if (!engineReady || !editorReady) {
    return (
      <div className={`flex ${fitParent ? "h-full" : "h-dvh"} flex-col items-center justify-center gap-4 bg-background`}>
        <Icons.Flask className="size-8 animate-pulse text-primary" />
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Initializing Engine...</p>
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
            docTitle={activeDoc?.title || "Untitled"}
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
          />
        )}

        {/* Minimal chrome: a slim title strip so the user knows which doc is
            open, without tabs/actions. "none" shows the document surface only. */}
        {chrome === "minimal" && activeDocId && (
          <div className="flex h-8 shrink-0 items-center border-b border-border bg-background px-3">
            <span className="truncate text-xs font-medium text-muted-foreground">
              {activeDoc?.title || "Untitled"}
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


        <div ref={trayRegionRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <SettingsSheet open={showSettings} onOpenChange={setShowSettings} />
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
              <LazyChunkBoundary>
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

            <div className="relative flex min-h-[10rem] flex-1 flex-row">
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
                  <p className="text-sm font-medium opacity-60">No document open</p>
                  <p className="text-xs opacity-60">Select a document from the Files panel or create a new one</p>
                  <Button variant="default" size="lg" onClick={handleNewDoc}>Create New Document</Button>
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
                  aria-label={workspaceView === "map" ? "Relationship map" : "Cards"}
                  className="absolute inset-0 z-30 bg-background outline-none"
                >
                  <React.Suspense fallback={<div className="flex h-full items-center justify-center text-muted-foreground">Loading {workspaceView === "map" ? "graph" : "cards"}…</div>}>
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
            {!chromeMinimal && showSidebar && (
              <React.Suspense
                fallback={<div className="hidden border-r border-border md:order-first md:block md:w-[var(--ws-w)] md:shrink-0" style={{ ["--ws-w" as string]: `${docNavWidth}px` }} aria-hidden />}
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
                title="Open workspace panel"
                aria-label="Open workspace panel"
                className="absolute left-1 top-1 z-10 flex size-8 items-center justify-center rounded-md border border-border bg-card/80 text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
              >
                <PanelLeft className="size-4" />
              </button>
            )}
            </div>

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
            <Toaster position="bottom-right" offset={48} expand={false} richColors closeButton />
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
