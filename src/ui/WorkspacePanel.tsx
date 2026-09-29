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
import { useDocumentStore } from "@/store/documentStore";
import { useFolderStore } from "@/store/folders";
import type { OutlineHeading } from "@/store/doc-outline";
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
  SquareIcon,
  StickyNoteIcon,
  Trash2Icon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdUnit } from "./AdUnit";
import { useDialog } from "./DialogProvider";
import { FolderTree } from "./FolderTree";
import { TocList } from "./DocNavPanel";
import { DIVIDER_BASE_CLASS, DIVIDER_HIT_AREA, useDividerDrag } from "./use-divider-drag";
import { DOCNAV_WIDTH_MIN, docNavWidthMax } from "@/store/uiStore";

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
  onSearchBody?: (docId: string, lowerQuery: string) => boolean;

  // ── Outline ───────────────────────────────────────────────────────────────
  headings: OutlineHeading[];
  activeIndex: number | null;
  onNavigateHeading: (index: number) => void;
}

function timeAgo(date: Date | number | string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

const TABS: { id: WorkspaceTab; label: string; icon: typeof FolderTreeIcon }[] = [
  { id: "files", label: "Files", icon: FolderTreeIcon },
  { id: "outline", label: "Outline", icon: ListTreeIcon },
];

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
  onSearchBody,
  headings,
  activeIndex,
  onNavigateHeading,
}: WorkspacePanelProps) {
  const asideRef = useRef<HTMLElement>(null);

  // Left-edge resize — identity-stable drag callbacks (see DocNavPanel for the
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

  return (
    <aside
      ref={asideRef}
      data-tour="workspace"
      className={cn(
        "flex flex-col border-r border-border bg-card",
        "absolute inset-y-0 left-0 z-20 w-full max-w-sm shadow-xl",
        // md+: an in-flow docked column pinned to the LEFT of the editor
        // (order-first wins over the source position, which is after <main>).
        "md:relative md:z-auto md:order-first md:w-[var(--ws-w)] md:max-w-none md:shadow-none md:shrink-0"
      )}
      style={{ ["--ws-w" as string]: `${width}px` }}
      aria-label="Workspace"
    >
      {/* Right-edge resize handle (desktop only; the mobile drawer is full-width). */}
      <div
        onPointerDown={startDrag}
        onKeyDown={onDividerKeyDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize workspace panel"
        tabIndex={0}
        aria-valuenow={Math.round(width)}
        aria-valuemin={DOCNAV_WIDTH_MIN}
        aria-valuemax={docNavWidthMax()}
        aria-valuetext={`${Math.round(width)} pixels wide`}
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
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <Button
                key={t.id}
                data-slot="workspace-tab-button"
                variant={active ? "default" : "outline"}
                size="sm"
                onClick={() => onTabChange(t.id)}
                aria-pressed={active}
                title={t.label}
                className="flex-1 gap-1.5 pointer-coarse:min-h-9"
              >
                <Icon className="size-3.5" />
                <span className="text-xs">{t.label}</span>
              </Button>
            );
          })}
        </ButtonGroup>
        {onOpenCards && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onOpenCards}
            title="Cards board (⌘⇧K)"
            aria-label="Open the Cards board"
            className="shrink-0 text-muted-foreground pointer-coarse:size-9"
          >
            <StickyNoteIcon className="size-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          title="Close panel"
          aria-label="Close workspace panel"
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
  | "onSearchBody"
>) {
  const documents = useDocumentStore((s) => s.documents);
  const activeDocId = useDocumentStore((s) => s.activeDocId);
  const createFolder = useFolderStore((s) => s.createFolder);
  const { confirm } = useDialog();

  const [filter, setFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const editInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

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
    const q = filter.toLowerCase();
    if (q) {
      return documents.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          (d.tags || []).some((t: string) => t.toLowerCase().includes(q)) ||
          (onSearchBody ? onSearchBody(d.id, q) : false)
      );
    }
    return stableIds.flatMap((id) => {
      const d = docById.get(id);
      return d ? [d] : [];
    });
  }, [stableIds, docById, documents, filter, onSearchBody]);

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
  const toggleItem = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const allFilteredSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.id));
  const toggleSelectAll = () =>
    setSelected(allFilteredSelected ? new Set() : new Set(filtered.map((d) => d.id)));

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    const count = selected.size;
    const ok = await confirm({
      title: `Delete ${count} document${count > 1 ? "s" : ""}?`,
      // Each delete records a pre-delete snapshot (see deleteDoc), so this is
      // recoverable; the old "no undo" warning was wrong in the other direction.
      description: count > 1
        ? "They will be removed from your library. The last saved version of each stays in Tools ▸ Version history, where it can be restored as a new document."
        : "It will be removed from your library. Its last saved version stays in Tools ▸ Version history, where you can restore it as a new document.",
      confirmLabel: "Delete",
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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" {...dragEvents}>
      {isDragging && (
        <div className="absolute inset-2 z-50 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/40 bg-primary/10 backdrop-blur-md animate-in fade-in zoom-in duration-200">
          <UploadCloudIcon className="size-8 animate-bounce text-primary" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Drop to Import</span>
        </div>
      )}

      {/* Controls row */}
      <div className="flex items-center justify-between gap-1 px-2 pt-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Library</span>
        <div className="flex items-center gap-0.5">
          {selectMode ? (
            <>
              {selected.size > 0 && onExportDocs && (
                <Tooltip>
                  <TooltipTrigger render={
                    <Button variant="ghost" size="icon-sm" aria-label={`Export ${selected.size} selected as ZIP`}
                      onClick={() => onExportDocs([...selected], selected.size === 1 ? "document" : "documents")}>
                      <DownloadIcon data-icon />
                    </Button>
                  } />
                  <TooltipContent side="bottom" className="text-[10px] font-bold">Export {selected.size} selected</TooltipContent>
                </Tooltip>
              )}
              {selected.size > 0 && (
                <Tooltip>
                  <TooltipTrigger render={
                    <Button variant="destructive" size="icon-sm" aria-label={`Delete ${selected.size} selected`} onClick={handleBulkDelete}>
                      <Trash2Icon data-icon />
                    </Button>
                  } />
                  <TooltipContent side="bottom" className="text-[10px] font-bold">Delete {selected.size} selected</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger render={
                  <Button variant="ghost" size="sm" aria-label={allFilteredSelected ? "Deselect all" : "Select all"} onClick={toggleSelectAll}>
                    {allFilteredSelected ? <CheckSquareIcon data-icon /> : <SquareIcon data-icon />}
                    {selected.size > 0 && selected.size}
                  </Button>
                } />
                <TooltipContent side="bottom" className="text-[10px] font-bold">{allFilteredSelected ? "Deselect all" : "Select all"}</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <Tooltip>
              <TooltipTrigger render={
                <Button variant="ghost" size="icon-sm" aria-label="Select documents" onClick={toggleSelectMode}>
                  <CheckSquareIcon data-icon />
                </Button>
              } />
              <TooltipContent side="bottom" className="text-[10px] font-bold">Select for bulk actions</TooltipContent>
            </Tooltip>
          )}
          {!selectMode && (
            <Tooltip>
              <TooltipTrigger render={
                <Button variant="ghost" size="icon-sm" aria-label="New folder" onClick={() => createFolder("New Folder", null, { startNaming: true })}>
                  <FolderPlusIcon data-icon />
                </Button>
              } />
              <TooltipContent side="bottom" className="text-[10px] font-bold">New folder</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger render={
              <Button variant="ghost" size="icon-sm" aria-label={selectMode ? "Cancel selection" : "New document"} onClick={selectMode ? toggleSelectMode : onNew}>
                {selectMode ? <XIcon data-icon /> : <PlusIcon data-icon />}
              </Button>
            } />
            <TooltipContent side="bottom" className="text-[10px] font-bold">{selectMode ? "Cancel selection" : "New document"}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Search */}
      <div className="relative px-2 pt-2">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/50" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search titles & content…"
          className="h-7 pl-7 text-base md:text-xs"
        />
      </div>

      {/* List */}
      <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 pb-2">
        {filtered.length === 0 && (
          <span className="block px-2 py-4 text-center text-xs text-muted-foreground/50">
            {filter ? "No results" : "No documents"}
          </span>
        )}

        {/* No active search → nested folder tree; searching → flat results. */}
        {!filter && !selectMode && documents.length > 0 && (
          <FolderTree
            documents={documents}
            activeDocId={activeDocId ?? null}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={(id) => onDelete(id)}
            onDuplicate={onDuplicate}
            onExportFolder={onExportFolder}
            onExportDoc={onExportDoc}
            confirmDeleteFolder={(name, itemCount) =>
              confirm({
                title: `Delete folder "${name}"?`,
                description:
                  itemCount > 0
                    ? `Its ${itemCount} item${itemCount === 1 ? "" : "s"} will move up to the parent level. This cannot be undone.`
                    : "This cannot be undone.",
                confirmLabel: "Delete folder",
                destructive: true,
              })
            }
          />
        )}

        {(filter || selectMode) &&
          filtered.map((doc) => {
            const isActive = doc.id === activeDocId;
            const isEditing = doc.id === editingId;
            const isSelected = selected.has(doc.id);
            return (
              <div key={doc.id} className="group/menu-item relative">
                {isEditing ? (
                  <div className="flex flex-col gap-1 p-2 pl-3">
                    <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">Rename Document</span>
                    <Input
                      ref={editInputRef}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={handleRenameSubmit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameSubmit();
                        if (e.key === "Escape") { e.preventDefault(); setEditingId(null); }
                      }}
                      className="h-7 text-[12px]!"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    title={doc.title || "Untitled"}
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => { if (selectMode) { toggleItem(doc.id); return; } onSelect(doc.id); }}
                    className={cn(
                      "relative flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors",
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
                      <span className="mt-0.5 shrink-0">
                        {isSelected ? <CheckSquareIcon className="size-3.5 text-primary" /> : <SquareIcon className="size-3.5 text-muted-foreground/40" />}
                      </span>
                    ) : (
                      <FileTextIcon className={cn("mt-0.5 size-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground/50")} />
                    )}
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span title={doc.title || "Untitled"} className={cn("truncate text-xs leading-tight text-foreground", isActive ? "font-semibold" : "font-medium")}>{doc.title || "Untitled"}</span>
                      <span className="flex items-center gap-2 text-muted-foreground/75">
                        <span className="flex items-center gap-1 text-[10px]"><ClockIcon className="size-2.5!" />{timeAgo(doc.updated)}</span>
                        {doc.wordCount && doc.wordCount > 0 && (
                          <span className="flex items-center gap-1 text-[10px]"><HashIcon className="size-2.5!" />{doc.wordCount}</span>
                        )}
                      </span>
                    </span>
                  </button>
                )}

                {!selectMode && !isEditing && (
                  <DropdownMenu key={doc.id + "-menu"}>
                    <DropdownMenuTrigger render={
                      <button
                        onClick={(e) => e.stopPropagation()}
                        title="More options"
                        className="absolute right-1 top-1.5 flex size-5 items-center justify-center rounded p-0 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/menu-item:opacity-100 aria-expanded:opacity-100 focus-visible:opacity-100 focus-visible:outline-none pointer-coarse:size-8 pointer-coarse:opacity-100"
                      />
                    }>
                      <MoreVerticalIcon className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem onClick={() => { setEditingId(doc.id); setEditTitle(doc.title); }}>
                        <Edit2Icon />Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onDuplicate(doc.id)}><CopyIcon />Duplicate</DropdownMenuItem>
                      {onExportDoc && (
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger><DownloadIcon />Export</DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuItem onClick={() => onExportDoc(doc.id, "md")}>Markdown (.md)</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onExportDoc(doc.id, "html")}>HTML (.html)</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onExportDoc(doc.id, "docx")}>Word (.docx)</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onExportDoc(doc.id, "json")}>Backup (.json)</DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(doc.id)}>
                        <Trash2Icon />Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}

        <AdUnit variant="sidebar-inline" className="mx-1 mt-2" />
      </div>

      {/* Footer count */}
      <div className="flex shrink-0 items-center border-t border-border px-2 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
          {selectMode && selected.size > 0
            ? `${selected.size} selected`
            : `${documents.length} document${documents.length !== 1 ? "s" : ""}`}
        </span>
      </div>
    </div>
  );
}

// Memoized: it is a sibling of the editor inside the shell, so without this
// the whole library tree — search box, folder tree, outline — re-rendered on
// every render of PerssonifyEditor.
export const WorkspacePanel = React.memo(WorkspacePanelInner);
