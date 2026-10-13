import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { gatedShareProps, ShareHelpIcon, ShareHint, useShareGate } from "@/editor/share-gate";
import { useDocumentStore } from "@/store/documents/documentStore";
import { useFolderStore } from "@/store/documents/folders";
import type { OutlineHeading } from "@/store/documents/doc-outline";
import {
  CheckSquareIcon,
  ClockIcon,
  CopyIcon,
  DownloadIcon,
  Edit2Icon,
  FileTextIcon,
  FolderPlusIcon,
  FolderTreeIcon,
  HashIcon,
  ListTreeIcon,
  MoreVerticalIcon,
  PanelLeftClose,
  PlusIcon,
  SearchIcon,
  Share2Icon,
  SquareIcon,
  StickyNoteIcon,
  Trash2Icon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type { DocumentSummary } from "@/store/documents/document";
import { AdUnit } from "@/ui/shared/adUnit";
import { useDialog } from "@/ui/dialogs/dialogProvider";
import { FolderTree } from "../folderTree";
import { timeAgo } from "../utils/relative-time";
import { TocList } from "../docNavPanel";
import { DIVIDER_BASE_CLASS, DIVIDER_HIT_AREA, useDividerDrag } from "@/ui/shared/hooks/use-divider-drag";
import { useFocusRowAfterRender, useWindowedList } from "../hooks/use-windowed-list";
import { DOCNAV_WIDTH_MIN, docNavWidthMax } from "@/store/preferences/uiStore";
import { t, useT } from "@/i18n";

/** Keyboard resize step for the panel separator. */
const WIDTH_STEP = 16;

export type WorkspaceTab = "files" | "outline";

export interface WorkspacePanelProps {
  /** Which tab is active. */
  tab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  /** Collapse the whole panel. */
  onClose: () => void;
  /** Open the full-screen Cards board.
   *
   *  A LAUNCHER, deliberately not a third tab: Cards is a whole-library board
   *  that needs the full canvas, and an earlier attempt to host an overlay-scale
   *  view (the Map tab) inside this narrow dock was tried and removed. This is
   *  the discoverable route from the library — the board was otherwise only
   *  reachable from the View menu or ⌘⇧K. */
  onOpenCards?: () => void;
  /** Docked width (px) + live resize. */
  width: number;
  onResize: (width: number) => void;

  // ── Files (library) ───────────────────────────────────────────────────────
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string, skipConfirm?: boolean) => void | Promise<void>;
  onRename: (id: string, newTitle: string) => void;
  onDuplicate: (id: string) => void;
  onFileDrop?: (files: FileList) => void;
  onExportFolder?: (folderId: string, opts?: { canonical?: boolean }) => void;
  onExportDocs?: (docIds: string[], zipName: string) => void;
  onExportDoc?: (docId: string, format: "md" | "html" | "docx" | "json") => void;
  onShareDoc?: (docId: string) => void;
  onShareFolder?: (folderId: string) => void;
  onSearchBody?: (docId: string, lowerQuery: string) => boolean;

  // ── Outline ───────────────────────────────────────────────────────────────
  headings: OutlineHeading[];
  activeIndex: number | null;
  onNavigateHeading: (index: number) => void;
}


/**
 * Is the panel the phone DRAWER right now? The same breakpoint as the aside's
 * own classes (below `md`, 768px, it is an absolute overlay). Guarded: an
 * environment without matchMedia gets the docked layout's behaviour.
 */
function useDrawerMode(): boolean {
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(max-width: 767px)");
    const update = () => setDrawer(mql.matches);
    update();
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, []);
  return drawer;
}

const TABS: { id: WorkspaceTab; label: string; icon: typeof FolderTreeIcon }[] = [
  { id: "files", get label() { return t("library.tabFiles"); }, icon: FolderTreeIcon },
  { id: "outline", get label() { return t("library.tabOutline"); }, icon: ListTreeIcon },
];

/** The editor's reopen button, found by its accessible name — which is
 *  translated where it is rendered, so the selector must be too. */
const reopenButtonSelector = () => `[aria-label="${t("app.openWorkspacePanel").replace(/["\\]/g, "\\$&")}"]`;

/**
 * WorkspacePanel — the unified LEFT-docked navigator that consolidates the
 * document library and the document outline into one tabbed tray. Document-first:
 * the Files tab is the single library; selecting a doc updates the Outline live.
 *
 *  • Files   — the folder tree / library (search, new doc/folder, select mode,
 *              bulk export/delete, drag-to-import, per-doc export, context menu).
 *  • Outline — live table of contents for the active doc (reuses TocList).
 *
 * The knowledge graph is NOT here — it lives as the full-screen relationship-map
 * overlay toggled from the View menu / graph button (see PE `graphVisible`).
 *
 * Shell copies the proven DocNavPanel idiom: an in-flow docked column on md+ (at
 * the persisted width, right-edge resizable) and a left-overlay drawer on phones.
 */
function WorkspacePanelInner({
  tab,
  onTabChange,
  onOpenCards,
  onClose,
  width,
  onResize,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onDuplicate,
  onFileDrop,
  onExportFolder,
  onExportDocs,
  onExportDoc,
  onShareDoc,
  onShareFolder,
  onSearchBody,
  headings,
  activeIndex,
  onNavigateHeading,
}: WorkspacePanelProps) {
  const t = useT();
  const asideRef = useRef<HTMLElement>(null);

  // Right-edge resize — identity-stable drag callbacks (see DocNavPanel for the
  // mid-drag-teardown rationale); read onResize through a ref.
  const onResizeRef = useRef(onResize);
  useEffect(() => { onResizeRef.current = onResize; }, [onResize]);
  const onDividerMove = useCallback((e: PointerEvent) => {
    if (!asideRef.current || !onResizeRef.current) return;
    // Left-docked panel: width grows as the pointer moves right of the panel's
    // own left edge (mirror of the DocNavPanel right-edge idiom).
    const leftEdge = asideRef.current.getBoundingClientRect().left;
    onResizeRef.current(e.clientX - leftEdge);
  }, []);

  // Arrows resize by WIDTH_STEP, Home/End go to the clamps. The setter
  // (`setDocNavWidth`) re-clamps, so overshooting the bounds here is harmless
  // and the real viewport-relative maximum stays in one place.
  const onWidthKey = useCallback((dir: -1 | 1, toEnd: boolean) => {
    if (!onResizeRef.current) return;
    onResizeRef.current(toEnd ? (dir < 0 ? DOCNAV_WIDTH_MIN : docNavWidthMax()) : width + dir * WIDTH_STEP);
  }, [width]);

  // C2. `setDocNavWidth` clamps, and the persisted value is clamped on load —
  // so the localStorage-poisoning path is closed. What was still open is the
  // LIVE one: drag the panel wide on a maximised window, restore the window to
  // 800px, and the panel stays at its old width with an ~80px editor beside it
  // until the divider is dragged again. Re-applying the current width on resize
  // is enough, because the setter re-clamps against the new viewport.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResizeWindow = () => onResizeRef.current?.(width);
    window.addEventListener("resize", onResizeWindow);
    return () => window.removeEventListener("resize", onResizeWindow);
  }, [width]);

  const { onPointerDown: startDrag, onKeyDown: onDividerKeyDown } = useDividerDrag({
    onMove: onDividerMove,
    orientation: "vertical",
    onKeyAdjust: onWidthKey,
  });

  // A094 — the phone DRAWER (below md the panel overlays the editor). It used
  // to open with focus still on whatever opened it, so a keyboard or screen-
  // reader user stayed behind it, addressing controls it covered; and nothing
  // closed it from the keyboard. It now takes focus when it opens, closes on
  // Escape, and hands focus back when it closes. The docked desktop column is
  // an ordinary region beside the editor and does neither.
  const isDrawer = useDrawerMode();
  useEffect(() => {
    if (!isDrawer) return;
    const opener = document.activeElement as HTMLElement | null;
    const aside = asideRef.current;
    if (aside && !aside.contains(opener)) aside.focus();
    return () => {
      if (opener && opener.isConnected && opener !== document.body) opener.focus();
      // The usual opener — the editor's "Open workspace panel" button — only
      // exists while the panel is CLOSED, so it was unmounted when the drawer
      // opened. Its replacement mounts in the same commit that unmounts the
      // drawer, which this passive cleanup runs after: land there instead of
      // on <body>.
      else document.querySelector<HTMLElement>(reopenButtonSelector())?.focus();
    };
  }, [isDrawer]);
  const onAsideKeyDown = useCallback((e: React.KeyboardEvent) => {
    // A rename box or menu that handled Escape itself calls preventDefault.
    if (e.key !== "Escape" || !isDrawer || e.defaultPrevented) return;
    e.preventDefault();
    onClose();
  }, [isDrawer, onClose]);

  return (
    <aside
      ref={asideRef}
      data-tour="workspace"
      data-print-hide
      // Programmatic focus target for the drawer (not a tab stop).
      tabIndex={-1}
      onKeyDown={onAsideKeyDown}
      className={cn(
        "flex flex-col border-r border-border bg-card outline-none",
        "absolute inset-y-0 left-0 z-20 w-full max-w-sm shadow-xl",
        // md+: an in-flow docked column on the LEFT of the editor. It is FIRST
        // in the DOM now (A094); it used to render after <main> and be pulled
        // left with order-first, so the library came last in the Tab order.
        "md:relative md:z-auto md:w-[var(--ws-w)] md:max-w-none md:shadow-none md:shrink-0"
      )}
      style={{ ["--ws-w" as string]: `${width}px` }}
      aria-label={t("library.workspace")}
    >
      {/* Right-edge resize handle (desktop only; the mobile drawer is full-width). */}
      <div
        onPointerDown={startDrag}
        onKeyDown={onDividerKeyDown}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("library.resizeWorkspacePanel")}
        tabIndex={0}
        aria-valuenow={Math.round(width)}
        aria-valuemin={DOCNAV_WIDTH_MIN}
        aria-valuemax={docNavWidthMax()}
        aria-valuetext={t("library.widthValueText", { count: Math.round(width) })}
        className={cn(
          "absolute inset-y-0 -right-1 z-10 hidden w-2 cursor-col-resize md:block hover:bg-primary/20",
          DIVIDER_BASE_CLASS,
          DIVIDER_HIT_AREA.vertical
        )}
      />

      {/* Header: a Files|Outline segmented control (same idiom as the MD/HTML/
          Split ModeSwitcher — ButtonGroup + default/outline Buttons) + close. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border p-1.5">
        <ButtonGroup className="w-full">
          {TABS.map((tabDef) => {
            const Icon = tabDef.icon;
            const active = tab === tabDef.id;
            return (
              <Button
                key={tabDef.id}
                data-slot="workspace-tab-button"
                variant={active ? "default" : "outline"}
                size="sm"
                onClick={() => onTabChange(tabDef.id)}
                aria-pressed={active}
                title={tabDef.label}
                className="flex-1 gap-1.5 pointer-coarse:min-h-9"
              >
                <Icon className="size-3.5" />
                <span className="text-xs">{tabDef.label}</span>
              </Button>
            );
          })}
        </ButtonGroup>
        {onOpenCards && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onOpenCards}
            title={t("library.cardsBoardTitle", { keys: "⌘⇧K" })}
            aria-label={t("library.openTheCardsBoard")}
            className="shrink-0 text-muted-foreground pointer-coarse:size-9"
          >
            <StickyNoteIcon className="size-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          title={t("library.closePanel")}
          aria-label={t("library.closeWorkspacePanel")}
          className="shrink-0 text-muted-foreground pointer-coarse:size-9"
        >
          <PanelLeftClose className="size-3.5" />
        </Button>
      </div>

      {/* Tab bodies. All are mounted-then-hidden would be heavier; render the
          active one. Files reads the stores directly, so no state is lost when
          switching tabs (folder tree open/closed state lives in uiStore). */}
      {tab === "files" && (
        <FilesTab
          onSelect={onSelect}
          onNew={onNew}
          onDelete={onDelete}
          onRename={onRename}
          onDuplicate={onDuplicate}
          onFileDrop={onFileDrop}
          onExportFolder={onExportFolder}
          onExportDocs={onExportDocs}
          onExportDoc={onExportDoc}
          onShareDoc={onShareDoc}
          onShareFolder={onShareFolder}
          onSearchBody={onSearchBody}
        />
      )}

      {tab === "outline" && (
        <TocList headings={headings} activeIndex={activeIndex} onNavigate={onNavigateHeading} />
      )}
    </aside>
  );
}

/** The library — ported from the former left Sidebar, rendered with plain
 *  primitives so it lives inside the workspace tray (not shadcn Sidebar). */
function FilesTab({
  onSelect,
  onNew,
  onDelete,
  onRename,
  onDuplicate,
  onFileDrop,
  onExportFolder,
  onExportDocs,
  onExportDoc,
  onShareDoc,
  onShareFolder,
  onSearchBody,
}: Pick<
  WorkspacePanelProps,
  | "onSelect"
  | "onNew"
  | "onDelete"
  | "onRename"
  | "onDuplicate"
  | "onFileDrop"
  | "onExportFolder"
  | "onExportDocs"
  | "onExportDoc"
  | "onShareDoc"
  | "onShareFolder"
  | "onSearchBody"
>) {
  const t = useT();
  const documents = useDocumentStore((s) => s.documents);
  const activeDocId = useDocumentStore((s) => s.activeDocId);
  const createFolder = useFolderStore((s) => s.createFolder);
  const { confirm } = useDialog();

  const [filter, setFilter] = useState("");
  // A082: the search box must stay responsive at any library size. Each
  // keystroke re-filters every document — titles, tags and BODIES (via
  // onSearchBody) — so the list is filtered from a DEFERRED copy of the query,
  // which React renders at low priority and abandons for the next keystroke.
  const query = useDeferredValue(filter);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const editInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  /** The list's scroller: both lists are windowed against it (A082). */
  const listScrollRef = useRef<HTMLDivElement>(null);

  // Stable display order — positions change only on add/remove, not on saves.
  const stableIdsRef = useRef<string[]>([]);
  const docSet = useMemo(() => new Set(documents.map((d) => d.id)), [documents]);
  const membershipKey = [...docSet].sort().join(",");
  const stableIds = useMemo(() => {
    const surviving = stableIdsRef.current.filter((id) => docSet.has(id));
    const existingSet = new Set(surviving);
    const newIds = documents.map((d) => d.id).filter((id) => !existingSet.has(id));
    const next = [...newIds, ...surviving];
    stableIdsRef.current = next;
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membershipKey]);
  const docById = useMemo(() => new Map(documents.map((d) => [d.id, d])), [documents]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (q) {
      return documents.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          (d.tags || []).some((tag: string) => tag.toLowerCase().includes(q)) ||
          (onSearchBody ? onSearchBody(d.id, q) : false)
      );
    }
    return stableIds.flatMap((id) => {
      const d = docById.get(id);
      return d ? [d] : [];
    });
  }, [stableIds, docById, documents, query, onSearchBody]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleRenameSubmit = () => {
    if (editingId && editTitle.trim()) onRename(editingId, editTitle.trim());
    setEditingId(null);
  };

  const toggleSelectMode = () => {
    setSelectMode((v) => !v);
    setSelected(new Set());
  };
  const toggleItem = useCallback((id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    }), []);
  const allFilteredSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.id));
  const toggleSelectAll = () =>
    setSelected(allFilteredSelected ? new Set() : new Set(filtered.map((d) => d.id)));

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    const count = selected.size;
    const ok = await confirm({
      title: t("library.bulkDeleteTitle", { count }),
      // Each delete records a pre-delete snapshot (see deleteDoc), so this is
      // recoverable; the old "no undo" warning was wrong in the other direction.
      description: t("library.bulkDeleteDescription", { count }),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    // SEQUENTIAL, and awaited. Firing every delete at once let several async
    // `deleteDoc` chains interleave: one chain's `closeTab` would hand
    // `switchToDoc` a tab id another chain had already removed, and the
    // not-found branch then restored `activeDocId` to a DELETED document — which
    // the next save happily re-created.
    for (const id of selected) {
      try { await onDelete(id, true); } catch { /* keep deleting the rest */ }
    }
    setSelected(new Set());
    setSelectMode(false);
  };

  const deleteOne = useCallback((id: string) => { void onDelete(id); }, [onDelete]);
  const confirmDeleteFolder = useCallback((name: string, itemCount: number) =>
    confirm({
      title: t("library.deleteFolderTitle", { name }),
      description: t("library.deleteFolderDescription", { count: itemCount }),
      confirmLabel: t("library.deleteFolder"),
      destructive: true,
    }), [confirm, t]);
  const activateFlat = useCallback((id: string) => {
    if (selectMode) toggleItem(id);
    else onSelect(id);
  }, [selectMode, toggleItem, onSelect]);
  const startRename = useCallback((doc: DocumentSummary) => {
    setEditingId(doc.id);
    setEditTitle(doc.title);
  }, []);

  const dragEvents = {
    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault();
      dragCounterRef.current++;
      if (e.dataTransfer?.types?.includes("Files")) setIsDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) setIsDragging(false);
    },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragging(false);
      if (e.dataTransfer?.files?.length && onFileDrop) onFileDrop(e.dataTransfer.files);
    },
  };

  const selectAllLabel = allFilteredSelected ? t("library.deselectAll") : t("library.selectAll");

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" {...dragEvents}>
      {isDragging && (
        <div className="absolute inset-2 z-50 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/40 bg-primary/10 backdrop-blur-md animate-in fade-in zoom-in duration-200">
          <UploadCloudIcon className="size-8 animate-bounce text-primary" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-primary-strong">{t("library.dropToImport")}</span>
        </div>
      )}

      {/* Controls row */}
      <div className="flex items-center justify-between gap-1 px-2 pt-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{t("library.heading")}</span>
        <div className="flex items-center gap-0.5">
          {selectMode ? (
            <>
              {selected.size > 0 && onExportDocs && (
                <Tooltip>
                  <TooltipTrigger render={
                    <Button variant="ghost" size="icon-sm" aria-label={t("library.exportSelectedAsZip", { count: selected.size })}
                      onClick={() => onExportDocs([...selected], selected.size === 1 ? "document" : "documents")}>
                      <DownloadIcon data-icon />
                    </Button>
                  } />
                  <TooltipContent side="bottom" className="text-[10px] font-bold">{t("library.exportSelected", { count: selected.size })}</TooltipContent>
                </Tooltip>
              )}
              {selected.size > 0 && (
                <Tooltip>
                  <TooltipTrigger render={
                    <Button variant="destructive" size="icon-sm" aria-label={t("library.deleteSelected", { count: selected.size })} onClick={handleBulkDelete}>
                      <Trash2Icon data-icon />
                    </Button>
                  } />
                  <TooltipContent side="bottom" className="text-[10px] font-bold">{t("library.deleteSelected", { count: selected.size })}</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger render={
                  // A096 (label in name): the button SHOWS the selected count,
                  // so its name carries it too.
                  <Button variant="ghost" size="sm" aria-label={selected.size > 0 ? t(allFilteredSelected ? "library.deselectAllCount" : "library.selectAllCount", { count: selected.size }) : selectAllLabel} onClick={toggleSelectAll}>
                    {allFilteredSelected ? <CheckSquareIcon data-icon /> : <SquareIcon data-icon />}
                    {selected.size > 0 && selected.size}
                  </Button>
                } />
                <TooltipContent side="bottom" className="text-[10px] font-bold">{selectAllLabel}</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger render={
                <Button variant="ghost" size="icon-sm" aria-label={t("library.selectDocumentsButton")} onClick={toggleSelectMode}>
                  <CheckSquareIcon data-icon />
                </Button>
              } />
              <TooltipContent side="bottom" className="text-[10px] font-bold">{t("library.selectForBulkActions")}</TooltipContent>
            </Tooltip>
          )}
          {!selectMode && (
            <Tooltip>
              <TooltipTrigger render={
                <Button variant="ghost" size="icon-sm" aria-label={t("library.newFolder")} onClick={() => createFolder("New Folder", null, { startNaming: true })}>
                  <FolderPlusIcon data-icon />
                </Button>
              } />
              <TooltipContent side="bottom" className="text-[10px] font-bold">{t("library.newFolder")}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger render={
              <Button variant="ghost" size="icon-sm" aria-label={selectMode ? t("library.cancelSelection") : t("library.newDocument")} onClick={selectMode ? toggleSelectMode : onNew}>
                {selectMode ? <XIcon data-icon /> : <PlusIcon data-icon />}
              </Button>
            } />
            <TooltipContent side="bottom" className="text-[10px] font-bold">{selectMode ? t("library.cancelSelection") : t("library.newDocument")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Search */}
      <div className="relative px-2 pt-2">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/50" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("library.searchPlaceholder")}
          aria-label={t("library.searchDocuments")}
          className="h-7 pl-7 text-base md:text-xs"
        />
      </div>

      {/* List */}
      <div ref={listScrollRef} className="mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 pb-2">
        {filtered.length === 0 && (
          <span className="block px-2 py-4 text-center text-xs text-muted-foreground">
            {query ? t("library.noResults") : t("library.noDocuments")}
          </span>
        )}

        {/* No active search → nested folder tree; searching → flat results. */}
        {!query && !selectMode && documents.length > 0 && (
          <FolderTree
            documents={documents}
            activeDocId={activeDocId ?? null}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={deleteOne}
            onDuplicate={onDuplicate}
            onExportFolder={onExportFolder}
            onExportDoc={onExportDoc}
            onShareDoc={onShareDoc}
            onShareFolder={onShareFolder}
            confirmDeleteFolder={confirmDeleteFolder}
            scrollRef={listScrollRef}
          />
        )}

        {(query || selectMode) && filtered.length > 0 && (
          <FlatDocList
            docs={filtered}
            activeDocId={activeDocId ?? null}
            selectMode={selectMode}
            selected={selected}
            editingId={editingId}
            editTitle={editTitle}
            setEditTitle={setEditTitle}
            editInputRef={editInputRef}
            onRenameSubmit={handleRenameSubmit}
            onRenameCancel={() => setEditingId(null)}
            onStartRename={startRename}
            onActivate={activateFlat}
            onDuplicate={onDuplicate}
            onDelete={deleteOne}
            onExportDoc={onExportDoc}
            onShareDoc={onShareDoc}
            scrollRef={listScrollRef}
          />
        )}

        <AdUnit variant="sidebar-inline" className="mx-1 mt-2" />
      </div>

      {/* Footer count. A095: 10px at the full muted token (the 60% alpha it
          carried measured 2.3:1). */}
      <div className="flex shrink-0 items-center border-t border-border px-2 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          {selectMode && selected.size > 0
            ? t("library.selectedCount", { count: selected.size })
            : t("library.documentCount", { count: documents.length })}
        </span>
      </div>
    </div>
  );
}

interface FlatDocListProps {
  docs: DocumentSummary[];
  activeDocId: string | null;
  selectMode: boolean;
  selected: Set<string>;
  editingId: string | null;
  editTitle: string;
  setEditTitle: (v: string) => void;
  editInputRef: React.Ref<HTMLInputElement>;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onStartRename: (doc: DocumentSummary) => void;
  /** Open the document — or, in select mode, toggle its selection. */
  onActivate: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onExportDoc?: (docId: string, format: "md" | "html" | "docx" | "json") => void;
  onShareDoc?: (docId: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * The flat document list shown while searching or selecting — WINDOWED like
 * the tree (A082): "select" shows every document, so at 2,000 documents it was
 * 2,000 mounted rows, each with its own Base UI menu root.
 *
 * Windowing means rows that are scrolled away do not exist, so Tab could never
 * reach them; the list is therefore a `role="listbox"` with ONE tab stop and
 * arrow-key navigation (the same pattern as the tree), and the active row is
 * always kept mounted.
 */
function FlatDocList({
  docs,
  activeDocId,
  selectMode,
  selected,
  editingId,
  editTitle,
  setEditTitle,
  editInputRef,
  onRenameSubmit,
  onRenameCancel,
  onStartRename,
  onActivate,
  onDuplicate,
  onDelete,
  onExportDoc,
  onShareDoc,
  scrollRef,
}: FlatDocListProps) {
  const t = useT();
  const shareGate = useShareGate();
  const listRef = useRef<HTMLDivElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const indexOfId = useMemo(() => new Map(docs.map((d, i) => [d.id, i])), [docs]);
  const tabbableId =
    (focusId && indexOfId.has(focusId) ? focusId : null) ??
    (activeDocId && indexOfId.has(activeDocId) ? activeDocId : null) ??
    docs[0]?.id ??
    null;
  const pinned = [tabbableId, editingId, menuId]
    .map((id) => (id ? indexOfId.get(id) ?? -1 : -1))
    .filter((i) => i >= 0);
  const getKey = useCallback((i: number) => docs[i]!.id, [docs]);
  const estimateSize = useCallback((i: number) => (docs[i]!.id === editingId ? 64 : 48), [docs, editingId]);
  const { rows, totalSize, measureElement, scrollToIndex, rowKeyAttr } = useWindowedList({
    count: docs.length,
    getKey,
    estimateSize,
    scrollRef,
    listRef,
    pinned,
  });
  const focusRow = useFocusRowAfterRender(listRef);
  const menuHandle = useMemo(() => MenuPrimitive.createHandle<string>(), []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea")) return;
    const option = target.closest<HTMLElement>('[role="option"]');
    const id = option?.getAttribute("data-key");
    const index = id ? indexOfId.get(id) : undefined;
    if (!id || index === undefined) return;
    if (!selectMode && (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey))) {
      e.preventDefault();
      setMenuId(id);
      menuHandle.open(`pf-flat-menu-${id}`);
      return;
    }
    if (!selectMode && e.key === "F2") {
      e.preventDefault();
      onStartRename(docs[index]!);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      if (target !== option) return; // an inner control activates itself
      e.preventDefault();
      onActivate(id);
      return;
    }
    const next =
      e.key === "ArrowDown" ? index + 1
      : e.key === "ArrowUp" ? index - 1
      : e.key === "Home" ? 0
      : e.key === "End" ? docs.length - 1
      : null;
    if (next === null || next < 0 || next >= docs.length) return;
    e.preventDefault();
    const nextId = docs[next]!.id;
    setFocusId(nextId);
    scrollToIndex(next);
    focusRow(nextId);
  };

  const onFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const id = (e.target as HTMLElement).closest('[role="option"]')?.getAttribute("data-key");
    if (id && id !== focusId) setFocusId(id);
  };

  return (
    <>
      <div
        ref={listRef}
        role="listbox"
        aria-label={selectMode ? t("library.selectDocuments") : t("library.searchResults")}
        aria-multiselectable={selectMode || undefined}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        className="relative shrink-0"
        style={{ height: totalSize }}
      >
        {rows.map((w) => {
          const doc = docs[w.index]!;
          const isActive = doc.id === activeDocId;
          const isEditing = doc.id === editingId;
          const isSelected = selected.has(doc.id);
          return (
            <div
              key={doc.id}
              {...{ [rowKeyAttr]: doc.id }}
              ref={measureElement}
              className="group/menu-item absolute inset-x-0"
              style={{ top: w.start }}
            >
              {isEditing ? (
                <div className="flex flex-col gap-1 p-2 pl-3">
                  <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{t("library.renameDocument")}</span>
                  <Input
                    ref={editInputRef}
                    aria-label={t("library.documentTitle")}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => { onRenameSubmit(); focusRow(doc.id); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { onRenameSubmit(); focusRow(doc.id); }
                      if (e.key === "Escape") { e.preventDefault(); onRenameCancel(); focusRow(doc.id); }
                    }}
                    className="h-7 text-[12px]!"
                  />
                </div>
              ) : (
                <div
                  role="option"
                  data-key={doc.id}
                  tabIndex={doc.id === tabbableId ? 0 : -1}
                  title={doc.title || t("common.untitled")}
                  // Selecting (select mode) or the open document (search).
                  aria-selected={selectMode ? isSelected : isActive}
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => onActivate(doc.id)}
                  className={cn(
                    "relative flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-left transition-colors",
                    // Same open-document marker as the folder tree, so the
                    // answer to "which one am I in?" doesn't change with the
                    // list you happen to be looking at.
                    isActive ? "bg-sidebar-accent" : "hover:bg-accent/60"
                  )}
                >
                  {isActive && (
                    <span aria-hidden className="absolute inset-y-1 left-0.5 w-[3px] rounded-full bg-primary" />
                  )}
                  {selectMode ? (
                    <span className="mt-0.5 shrink-0" aria-hidden>
                      {isSelected ? <CheckSquareIcon className="size-3.5 text-primary-strong" /> : <SquareIcon className="size-3.5 text-muted-foreground" />}
                    </span>
                  ) : (
                    <FileTextIcon className={cn("mt-0.5 size-3.5 shrink-0", isActive ? "text-primary-strong" : "text-muted-foreground/50")} />
                  )}
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span title={doc.title || t("common.untitled")} className={cn("truncate text-xs leading-tight text-foreground", isActive ? "font-semibold" : "font-medium")}>{doc.title || t("common.untitled")}</span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span className="flex items-center gap-1 text-[10px]"><ClockIcon className="size-2.5!" />{timeAgo(doc.updated)}</span>
                      {doc.wordCount && doc.wordCount > 0 && (
                        <span className="flex items-center gap-1 text-[10px]"><HashIcon className="size-2.5!" />{doc.wordCount}</span>
                      )}
                    </span>
                  </span>
                </div>
              )}

              {!selectMode && !isEditing && (
                <DropdownMenuTrigger
                  handle={menuHandle}
                  payload={doc.id}
                  id={`pf-flat-menu-${doc.id}`}
                  tabIndex={-1}
                  onPointerDown={() => setMenuId(doc.id)}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  title={t("library.moreOptions")}
                  aria-label={t("library.optionsFor", { name: doc.title || t("common.untitled") })}
                  className="absolute right-1 top-1.5 flex size-5 items-center justify-center rounded p-0 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100 aria-expanded:opacity-100 pointer-coarse:size-8 pointer-coarse:opacity-100"
                >
                  <MoreVerticalIcon className="size-3.5" />
                </DropdownMenuTrigger>
              )}
            </div>
          );
        })}
      </div>

      {/* ONE menu for every row's ⋮ (A082): detached triggers, one root. */}
      <DropdownMenu handle={menuHandle} onOpenChange={(open) => { if (!open) setMenuId(null); }}>
        {({ payload }) => {
          const doc = typeof payload === "string" ? docs[indexOfId.get(payload) ?? -1] : undefined;
          if (!doc) return null;
          return (
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem onClick={() => onStartRename(doc)}>
                <Edit2Icon />{t("common.rename")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDuplicate(doc.id)}><CopyIcon />{t("library.duplicate")}</DropdownMenuItem>
              {onExportDoc && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger><DownloadIcon />{t("common.export")}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => onExportDoc(doc.id, "md")}>{t("library.exportMarkdown")}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onExportDoc(doc.id, "html")}>{t("library.exportHtml")}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onExportDoc(doc.id, "docx")}>{t("library.exportWord")}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onExportDoc(doc.id, "json")}>{t("library.exportBackupJson")}</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {onShareDoc && (
                <ShareHint text={shareGate} side="right">
                  <DropdownMenuItem className={cn(shareGate && "cursor-not-allowed")} {...gatedShareProps(shareGate)} onClick={() => onShareDoc(doc.id)}>
                    <Share2Icon className={cn(shareGate && "opacity-50")} />
                    <span className={cn(shareGate && "opacity-50")}>{t("library.shareLink")}</span>
                    {shareGate && <ShareHelpIcon className="ml-auto" />}
                  </DropdownMenuItem>
                </ShareHint>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(doc.id)}>
                <Trash2Icon />{t("common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          );
        }}
      </DropdownMenu>
    </>
  );
}

// Memoized: it is a sibling of the editor inside the shell, so without this
// the whole library tree — search box, folder tree, outline — re-rendered on
// every render of PerssonifyEditor.
export const WorkspacePanel = React.memo(WorkspacePanelInner);
