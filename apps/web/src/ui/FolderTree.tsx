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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { DocumentSummary } from "@/store/documents/document";
import { useUIStore } from "@/store/preferences/uiStore";
import {
  type BuiltTree,
  buildFolderTree,
  docOrderKey,
  type FolderRecord,
  useFolderStore,
} from "@/store/documents/folders";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  DownloadIcon,
  Edit2Icon,
  FileTextIcon,
  FolderDownIcon,
  FolderIcon,
  FolderPlusIcon,
  HashIcon,
  MoreVerticalIcon,
  Share2Icon,
  Trash2Icon,
} from "lucide-react";
import React, {
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  computeDropZone,
  type DropZone,
  getDragPayload,
  hasDragItem,
  setDragPayload,
  spliceOrder,
} from "./folder-dnd";
import { timeAgo } from "./relative-time";
import { useFocusRowAfterRender, useWindowedList } from "./use-windowed-list";
import { useT } from "../i18n";

export type ExportDocFormat = "md" | "html" | "docx" | "json";

interface FolderTreeProps {
  documents: DocumentSummary[];
  activeDocId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onExportFolder?: (folderId: string, opts?: { canonical?: boolean }) => void;
  /** Export a single document (active or not) as md/html/docx/json. */
  onExportDoc?: (docId: string, format: ExportDocFormat) => void;
  /** Copy a self-contained share link for one document / a folder subtree. */
  onShareDoc?: (docId: string) => void;
  onShareFolder?: (folderId: string) => void;
  /** Confirm before deleting a folder. Resolves true to proceed. When omitted,
   *  deletion proceeds without confirmation (kept optional for tests). */
  confirmDeleteFolder?: (name: string, itemCount: number) => Promise<boolean>;
  /** The element the tree scrolls inside, for windowing (A082). Without it the
   *  tree's own container is used. */
  scrollRef?: RefObject<HTMLElement | null>;
}

/**
 * A menu-primitive "family" so a single menu-body renderer can drive BOTH the
 * hover ⋮ dropdown and the right-click / long-press context menu without
 * duplicating item definitions (mirrors the SelectMenuContent pattern). The
 * dropdown and context primitives share an identical API by construction
 * (components/ui/context-menu.tsx is modeled on dropdown-menu.tsx).
 */
interface MenuFam {
  Item: React.ElementType;
  Sub: React.ElementType;
  SubTrigger: React.ElementType;
  SubContent: React.ElementType;
  Separator: React.ElementType;
}
const DROPDOWN_FAM: MenuFam = {
  Item: DropdownMenuItem,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
  Separator: DropdownMenuSeparator,
};
const CONTEXT_FAM: MenuFam = {
  Item: ContextMenuItem,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
  Separator: ContextMenuSeparator,
};

// ── The tree as a flat list of VISIBLE rows ────────────────────────────────

export type TreeRow =
  | {
      kind: "folder";
      key: string;
      id: string;
      folder: FolderRecord;
      depth: number;
      expanded: boolean;
      /** Child folders + documents, shown beside the name. */
      count: number;
      parentIndex: number | null;
      posinset: number;
      setsize: number;
      siblingFolderIds: string[];
    }
  | {
      kind: "doc";
      key: string;
      id: string;
      doc: DocumentSummary;
      depth: number;
      folderId: string | null;
      parentIndex: number | null;
      posinset: number;
      setsize: number;
      siblingDocIds: string[];
    };

export const folderRowKey = (id: string) => `f:${id}`;
export const docRowKey = (id: string) => `d:${id}`;

/**
 * Flatten the folder tree into the rows a user can currently SEE (children of
 * collapsed folders are omitted), in display order.
 *
 * A082/A094. The tree used to be nested DOM, which cannot be windowed and
 * which gave arrow-key navigation nothing to walk. A flat row list is both:
 * windowing renders a slice of it, and "next row" is `index + 1`. The
 * hierarchy survives as data — depth, parent, position among siblings — and
 * reaches assistive tech as aria-level / aria-posinset / aria-setsize, the
 * form ARIA specifies for a tree whose structure is not expressed by nesting.
 */
export function flattenTree(tree: BuiltTree, expanded: Record<string, boolean>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (
    folders: BuiltTree["rootFolders"],
    docs: DocumentSummary[],
    depth: number,
    parentIndex: number | null,
    parentFolderId: string | null,
  ) => {
    const setsize = folders.length + docs.length;
    const siblingFolderIds = folders.map((n) => n.folder.id);
    const siblingDocIds = docs.map((d) => d.id);
    folders.forEach((node, i) => {
      const isOpen = !!expanded[node.folder.id];
      const index = rows.length;
      rows.push({
        kind: "folder",
        key: folderRowKey(node.folder.id),
        id: node.folder.id,
        folder: node.folder,
        depth,
        expanded: isOpen,
        count: node.docs.length + node.children.length,
        parentIndex,
        posinset: i + 1,
        setsize,
        siblingFolderIds,
      });
      if (isOpen) walk(node.children, node.docs, depth + 1, index, node.folder.id);
    });
    docs.forEach((doc, i) => {
      rows.push({
        kind: "doc",
        key: docRowKey(doc.id),
        id: doc.id,
        doc,
        depth,
        folderId: parentFolderId,
        parentIndex,
        posinset: folders.length + i + 1,
        setsize,
        siblingDocIds,
      });
    });
  };
  walk(tree.rootFolders, tree.rootDocs, 0, null, null);
  return rows;
}

export type TreeKeyAction =
  | { type: "focus"; index: number }
  | { type: "expand"; index: number }
  | { type: "collapse"; index: number }
  | { type: "activate"; index: number };

/**
 * The WAI-ARIA tree keyboard model over the flat rows (A094 — the tree claimed
 * role="tree" but the arrow keys did nothing).
 *  ↑ / ↓        previous / next visible row
 *  Home / End   first / last row
 *  →            closed folder: open it · open folder: first child
 *  ←            open folder: close it · anything else: its parent folder
 *  Enter/Space  open the document · toggle the folder
 */
export function treeKeyAction(rows: TreeRow[], index: number, key: string): TreeKeyAction | null {
  const row = rows[index];
  if (!row) return null;
  switch (key) {
    case "ArrowDown":
      return index + 1 < rows.length ? { type: "focus", index: index + 1 } : null;
    case "ArrowUp":
      return index > 0 ? { type: "focus", index: index - 1 } : null;
    case "Home":
      return index !== 0 ? { type: "focus", index: 0 } : null;
    case "End":
      return index !== rows.length - 1 ? { type: "focus", index: rows.length - 1 } : null;
    case "ArrowRight":
      if (row.kind !== "folder") return null;
      if (!row.expanded) return { type: "expand", index };
      return rows[index + 1]?.parentIndex === index ? { type: "focus", index: index + 1 } : null;
    case "ArrowLeft":
      if (row.kind === "folder" && row.expanded) return { type: "collapse", index };
      return row.parentIndex !== null ? { type: "focus", index: row.parentIndex } : null;
    case "Enter":
    case " ":
      return { type: "activate", index };
    default:
      return null;
  }
}

/**
 * Where a drag dropped on a DOCUMENT row goes. A doc is re-ordered among its
 * siblings. A FOLDER goes into the doc's folder (A066) — the same "this row's
 * container" rule a folder row applies to a dropped doc. It used to fall
 * through un-handled, bubble to the tree root's drop-to-root handler and land
 * at the TOP LEVEL, which is where the user had pointedly not dropped it.
 */
export function docRowDrop(
  payload: { kind: "doc" | "folder"; id: string },
  target: { docId: string; folderId: string | null; siblingDocIds: string[] },
  zone: DropZone | null,
):
  | { kind: "reorderDoc"; folderId: string | null; order: string[] }
  | { kind: "moveFolder"; parentId: string | null }
  | { kind: "none" } {
  if (payload.kind === "folder") return { kind: "moveFolder", parentId: target.folderId };
  if (payload.id === target.docId) return { kind: "none" };
  return {
    kind: "reorderDoc",
    folderId: target.folderId,
    order: spliceOrder(target.siblingDocIds, payload.id, target.docId, zone === "after" ? "after" : "before"),
  };
}

/** Re-render relative times ("5m ago") once a minute. Rows are memoized now,
 *  so they no longer refresh as a side effect of every autosave. */
function useMinuteTick(): number {
  const [tick, setTick] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    const t = setInterval(() => setTick(Math.floor(Date.now() / 60_000)), 60_000);
    return () => clearInterval(t);
  }, []);
  return tick;
}

// ── Menus: ONE of each for the whole tree (A082) ────────────────────────────

type RowMenuPayload =
  | { kind: "doc"; id: string; folderId: string | null }
  | { kind: "folder"; id: string };

function MoveToMenu({
  F,
  onMove,
  onNewFolderHere,
}: {
  F: MenuFam;
  onMove: (folderId: string | null) => void;
  onNewFolderHere: () => void;
}) {
  const t = useT();
  const folders = useFolderStore((s) => s.folders);
  return (
    <F.Sub>
      <F.SubTrigger>
        <FolderIcon className="mr-2 size-3.5" />
        {t("library.moveTo")}
      </F.SubTrigger>
      <F.SubContent className="max-h-64 overflow-y-auto">
        <F.Item onClick={onNewFolderHere}>
          <FolderPlusIcon className="mr-2 size-3.5" />
          {t("library.newFolderHere")}
        </F.Item>
        <F.Separator />
        <F.Item onClick={() => onMove(null)}>{t("library.root")}</F.Item>
        {folders.length > 0 && <F.Separator />}
        {folders.map((f: FolderRecord) => (
          <F.Item key={f.id} onClick={() => onMove(f.id)}>
            {f.name}
          </F.Item>
        ))}
      </F.SubContent>
    </F.Sub>
  );
}

/** Export submenu for a single document, shared by the ⋮ dropdown and the
 *  right-click context menu. Formats derive from stored canonical, so they work
 *  whether or not the doc is the one currently open in the editor. */
function ExportDocSubmenu({
  F,
  docId,
  onExportDoc,
}: {
  F: MenuFam;
  docId: string;
  onExportDoc: (docId: string, format: ExportDocFormat) => void;
}) {
  const t = useT();
  return (
    <F.Sub>
      <F.SubTrigger>
        <DownloadIcon className="mr-2 size-3.5" />
        {t("common.export")}
      </F.SubTrigger>
      <F.SubContent>
        <F.Item onClick={() => onExportDoc(docId, "md")}>{t("library.exportMarkdown")}</F.Item>
        <F.Item onClick={() => onExportDoc(docId, "html")}>{t("library.exportHtml")}</F.Item>
        <F.Item onClick={() => onExportDoc(docId, "docx")}>{t("library.exportWord")}</F.Item>
        <F.Item onClick={() => onExportDoc(docId, "json")}>{t("library.exportBackupJson")}</F.Item>
      </F.SubContent>
    </F.Sub>
  );
}

/** Document row menu items, rendered into either primitive family. */
function DocMenuBody({
  F,
  docId,
  folderId,
  startRename,
  onDuplicate,
  onDelete,
  onExportDoc,
  onShareDoc,
}: {
  F: MenuFam;
  docId: string;
  folderId: string | null;
  startRename: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onExportDoc?: (docId: string, format: ExportDocFormat) => void;
  onShareDoc?: (docId: string) => void;
}) {
  const t = useT();
  const moveDoc = useFolderStore((s) => s.moveDoc);
  const createFolder = useFolderStore((s) => s.createFolder);
  return (
    <>
      <F.Item onClick={startRename}>
        <Edit2Icon className="mr-2 size-3.5" />
        {t("common.rename")}
      </F.Item>
      <F.Item onClick={() => onDuplicate(docId)}>{t("library.duplicate")}</F.Item>
      <MoveToMenu
        F={F}
        onMove={(fid) => moveDoc(docId, fid)}
        onNewFolderHere={() => {
          const id = createFolder("New Folder", folderId, { startNaming: true });
          moveDoc(docId, id);
        }}
      />
      {onExportDoc && <ExportDocSubmenu F={F} docId={docId} onExportDoc={onExportDoc} />}
      {onShareDoc && (
        <F.Item onClick={() => onShareDoc(docId)}>
          <Share2Icon className="mr-2 size-3.5" />
          {t("library.shareLink")}
        </F.Item>
      )}
      <F.Separator />
      <F.Item className="text-destructive focus:text-destructive" onClick={() => onDelete(docId)}>
        <Trash2Icon className="mr-2 size-3.5" />
        {t("common.delete")}
      </F.Item>
    </>
  );
}

/** Folder row menu items, rendered into either primitive family. */
function FolderMenuBody({
  F,
  folder,
  count,
  startRename,
  onExportFolder,
  onShareFolder,
  confirmDeleteFolder,
}: {
  F: MenuFam;
  folder: FolderRecord;
  count: number;
  startRename: () => void;
  onExportFolder?: (folderId: string, opts?: { canonical?: boolean }) => void;
  onShareFolder?: (folderId: string) => void;
  confirmDeleteFolder?: (name: string, itemCount: number) => Promise<boolean>;
}) {
  const t = useT();
  const createFolder = useFolderStore((s) => s.createFolder);
  const moveFolder = useFolderStore((s) => s.moveFolder);
  const deleteFolder = useFolderStore((s) => s.deleteFolder);
  return (
    <>
      <F.Item onClick={() => createFolder("New Folder", folder.id, { startNaming: true })}>
        <FolderPlusIcon className="mr-2 size-3.5" />
        {t("library.newSubfolder")}
      </F.Item>
      <F.Item onClick={startRename}>
        <Edit2Icon className="mr-2 size-3.5" />
        {t("common.rename")}
      </F.Item>
      <MoveToMenu
        F={F}
        onMove={(pid) => moveFolder(folder.id, pid)}
        onNewFolderHere={() => {
          const id = createFolder("New Folder", folder.parentId, { startNaming: true });
          moveFolder(folder.id, id);
        }}
      />
      {onExportFolder && (
        <>
          <F.Item onClick={() => onExportFolder(folder.id)}>
            <FolderDownIcon className="mr-2 size-3.5" />
            {t("library.exportAsZip")}
          </F.Item>
          <F.Item onClick={() => onExportFolder(folder.id, { canonical: true })}>
            <ArchiveIcon className="mr-2 size-3.5" />
            {t("library.fullBackupZip")}
          </F.Item>
        </>
      )}
      {onShareFolder && (
        <F.Item onClick={() => onShareFolder(folder.id)}>
          <Share2Icon className="mr-2 size-3.5" />
          {t("library.shareLink")}
        </F.Item>
      )}
      <F.Separator />
      <F.Item
        className="text-destructive focus:text-destructive"
        onClick={async () => {
          const ok = confirmDeleteFolder ? await confirmDeleteFolder(folder.name, count) : true;
          if (ok) deleteFolder(folder.id);
        }}
      >
        <Trash2Icon className="mr-2 size-3.5" />
        {t("library.deleteFolder")}
      </F.Item>
    </>
  );
}

/** Shared visual for a reorder insertion line / into-highlight on a row. */
function dropClasses(zone: DropZone | null): string {
  if (zone === "into") return "bg-primary/10 outline outline-1 outline-primary/40";
  if (zone === "before") return "shadow-[inset_0_2px_0_0_var(--primary)]";
  if (zone === "after") return "shadow-[inset_0_-2px_0_0_var(--primary)]";
  return "";
}

/** Everything a row can ask of the tree. ONE object for every row, with a
 *  stable identity, so the memoized rows do not re-render when the tree does. */
interface RowHandlers {
  select: (docId: string) => void;
  toggle: (folderId: string) => void;
  renameDoc: (docId: string, title: string) => void;
  renameFolder: (folderId: string, name: string) => void;
  endRename: (key: string) => void;
  dragStart: (e: ReactDragEvent, kind: "doc" | "folder", id: string) => void;
  dropOnRow: (e: ReactDragEvent, key: string, zone: DropZone | null) => void;
  menuOpened: (key: string) => void;
  menuHandle: MenuPrimitive.Handle<RowMenuPayload>;
}

/** Drop-target plumbing shared by both row kinds: the zone indicator is local
 *  state, so only the row under the pointer re-renders during a drag. */
function useRowDrop(
  rowRef: RefObject<HTMLDivElement | null>,
  isFolder: boolean,
  onDrop: (e: ReactDragEvent, zone: DropZone | null) => void,
) {
  const [zone, setZone] = useState<DropZone | null>(null);
  const zoneRef = useRef<DropZone | null>(null);
  return {
    zone,
    dnd: {
      onDragOver: (e: ReactDragEvent) => {
        if (!hasDragItem(e) || !rowRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        // Drag kind isn't readable during dragover (protected mode); a folder
        // row shows the 3-zone indicator and a doc drop is coerced to "into".
        const z = computeDropZone(e, rowRef.current, isFolder);
        zoneRef.current = z;
        setZone(z);
      },
      onDragLeave: () => { zoneRef.current = null; setZone(null); },
      onDrop: (e: ReactDragEvent) => {
        const z = zoneRef.current;
        zoneRef.current = null;
        setZone(null);
        onDrop(e, z);
      },
    },
  };
}

interface FolderRowProps {
  rowKey: string;
  id: string;
  name: string;
  depth: number;
  expanded: boolean;
  count: number;
  posinset: number;
  setsize: number;
  tabbable: boolean;
  editing: boolean;
  handlers: RowHandlers;
}

const FolderRow = React.memo(function FolderRow({
  rowKey, id, name, depth, expanded, count, posinset, setsize, tabbable, editing, handlers,
}: FolderRowProps) {
  const t = useT();
  const rowRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(name);
  useEffect(() => { if (editing) setDraft(name); }, [editing, name]);
  const onDrop = useCallback(
    (e: ReactDragEvent, z: DropZone | null) => handlers.dropOnRow(e, rowKey, z),
    [handlers, rowKey],
  );
  const { zone, dnd } = useRowDrop(rowRef, true, onDrop);
  const commit = () => { handlers.renameFolder(id, draft); handlers.endRename(rowKey); };

  return (
    /* A flat treeitem: its depth is aria-level and its place among siblings is
       aria-posinset / aria-setsize — required when the hierarchy is not
       expressed by nesting role="group" elements, and a windowed list cannot
       nest (A082). */
    <div
      ref={rowRef}
      role="treeitem"
      data-key={rowKey}
      aria-level={depth + 1}
      aria-posinset={posinset}
      aria-setsize={setsize}
      aria-expanded={expanded}
      aria-label={name}
      tabIndex={tabbable ? 0 : -1}
      draggable={!editing}
      onDragStart={(e) => handlers.dragStart(e, "folder", id)}
      {...dnd}
      className={cn(
        "group/folder flex select-none items-center gap-1 rounded-md px-1 py-1 hover:bg-sidebar-accent",
        !editing && "cursor-grab active:cursor-grabbing",
        dropClasses(zone)
      )}
      style={{ paddingLeft: depth * 12 + 4 }}
    >
      {/* Pointer affordances only: inside a tree the ROW is the tab stop and
          the arrow keys expand/collapse, so these are not in the Tab order. */}
      <button
        type="button"
        tabIndex={-1}
        onClick={() => handlers.toggle(id)}
        className="flex size-4 items-center justify-center text-muted-foreground"
        aria-hidden
      >
        {expanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
      </button>
      <FolderIcon className="size-3.5 shrink-0 text-primary/70" />
      {editing ? (
        <Input
          autoFocus
          aria-label={t("library.folderName")}
          onFocus={(e) => e.target.select()}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { e.preventDefault(); handlers.endRename(rowKey); }
          }}
          className="h-6 flex-1 text-[12px]!"
        />
      ) : (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => handlers.toggle(id)}
          // A5: `truncate` with no `title` leaves a clipped name unreadable —
          // and folder names nest, so the deeper ones are clipped soonest.
          title={name}
          className="flex-1 truncate text-left text-xs font-medium text-foreground"
        >
          {name}
          <span className="ml-1.5 text-[10px] text-muted-foreground">
            {count || ""}
          </span>
        </button>
      )}
      <DropdownMenuTrigger
        handle={handlers.menuHandle}
        payload={{ kind: "folder", id }}
        id={`pf-row-menu-${rowKey}`}
        tabIndex={-1}
        onPointerDown={() => handlers.menuOpened(rowKey)}
        title={t("library.folderOptions")}
        aria-label={t("library.optionsFor", { name })}
        className="flex size-5 items-center justify-center rounded p-0 text-muted-foreground opacity-0 hover:bg-sidebar-accent group-hover/folder:opacity-100 group-focus-within/folder:opacity-100 aria-expanded:opacity-100 pointer-coarse:size-8 pointer-coarse:opacity-100"
      >
        <MoreVerticalIcon className="size-3.5" />
      </DropdownMenuTrigger>
    </div>
  );
});

interface DocRowProps {
  rowKey: string;
  id: string;
  title: string;
  updated: string;
  wordCount: number | null | undefined;
  folderId: string | null;
  depth: number;
  posinset: number;
  setsize: number;
  isActive: boolean;
  tabbable: boolean;
  editing: boolean;
  /** Minute counter: re-renders the relative time once a minute. */
  tick: number;
  handlers: RowHandlers;
}

/**
 * A document row. MEMOIZED on primitives (A082): `storage.list()` hands back
 * a fresh summary object for every document on every save, so a memo keyed on
 * the summary object would never bail out — every save re-rendered every row.
 * Keyed on the fields it shows, a save re-renders the one row that changed.
 */
const DocRow = React.memo(function DocRow({
  rowKey, id, title, updated, wordCount, folderId, depth, posinset, setsize,
  isActive, tabbable, editing, handlers,
}: DocRowProps) {
  const t = useT();
  const rowRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(title);
  useEffect(() => { if (editing) setDraft(title); }, [editing, title]);
  const onDrop = useCallback(
    (e: ReactDragEvent, z: DropZone | null) => handlers.dropOnRow(e, rowKey, z),
    [handlers, rowKey],
  );
  const { zone, dnd } = useRowDrop(rowRef, false, onDrop);
  /**
   * Commit an inline rename, ignoring an empty one.
   *
   * `renameDoc("")` sets `userTitle = ""` AND `titlePinnedByUser = true`, and
   * `resolveDocTitle` honours a flagged pin verbatim — so clearing the box and
   * pressing Enter (or just tabbing away) pinned a permanently blank title that
   * no heading could ever heal. The flat list in WorkspacePanel and
   * `renameFolder` both already guard this; only this row did not.
   */
  const commit = () => {
    const next = draft.trim();
    if (next && next !== title) handlers.renameDoc(id, next);
    else setDraft(title);
    handlers.endRename(rowKey);
  };
  const shown = title || t("common.untitled");

  return (
    <div
      ref={rowRef}
      role="treeitem"
      data-key={rowKey}
      aria-level={depth + 1}
      aria-posinset={posinset}
      aria-setsize={setsize}
      /* Both, deliberately. Inside a `role="tree"` the open document IS the
         tree's selection, so `aria-selected` is what an AT user hears on the
         row; `aria-current` is kept to match the flat list in WorkspacePanel,
         which is an ordinary list where `aria-current` is the right attribute
         (CLAUDE.md: keep the two library lists in sync). */
      aria-selected={isActive}
      aria-current={isActive ? "true" : undefined}
      aria-label={shown}
      tabIndex={tabbable ? 0 : -1}
      draggable={!editing}
      onDragStart={(e) => handlers.dragStart(e, "doc", id)}
      {...dnd}
      className={cn(
        "group/doc relative flex select-none items-center gap-1 rounded-md px-1 py-1 hover:bg-sidebar-accent",
        !editing && "cursor-grab active:cursor-grabbing",
        // The open document. This used to be `bg-card` — the exact colour of
        // the panel behind it (the aside IS bg-card), so "which document am I
        // in?" was unanswerable from the library. Solid token + a primary edge
        // marker + weight, so it reads differently from a hover too.
        isActive && "bg-sidebar-accent",
        dropClasses(zone)
      )}
      style={{ paddingLeft: depth * 12 + 22 }}
    >
      {isActive && (
        <span
          aria-hidden
          className="absolute inset-y-1 left-0.5 w-[3px] rounded-full bg-primary"
        />
      )}
      <FileTextIcon
        className={cn("size-3.5 shrink-0", isActive ? "text-primary-strong" : "text-muted-foreground/50")}
      />
      {editing ? (
        <Input
          autoFocus
          aria-label={t("library.documentTitle")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { e.preventDefault(); setDraft(title); handlers.endRename(rowKey); }
          }}
          className="h-6 flex-1 text-[12px]!"
        />
      ) : (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => handlers.select(id)}
          className="flex min-w-0 flex-1 flex-col items-start text-left"
        >
          <span
            title={shown}
            className={cn("w-full truncate text-xs text-foreground", isActive && "font-semibold")}
          >
            {shown}
          </span>
          {/* A095: 10px metadata at the full --muted-foreground; the 75% alpha
              it used to carry measured 3.0:1. */}
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="flex items-center gap-1 text-[10px]">
              <ClockIcon className="size-2.5!" />
              {timeAgo(updated)}
            </span>
            {wordCount != null && wordCount > 0 && (
              <span
                className="flex items-center gap-1 text-[10px]"
                title={t("library.wordCountLastSaved", { count: wordCount, formatted: wordCount.toLocaleString() })}
              >
                <HashIcon className="size-2.5!" />
                {t("library.wordCount", { count: wordCount, formatted: wordCount.toLocaleString() })}
              </span>
            )}
          </span>
        </button>
      )}
      <DropdownMenuTrigger
        handle={handlers.menuHandle}
        payload={{ kind: "doc", id, folderId }}
        id={`pf-row-menu-${rowKey}`}
        tabIndex={-1}
        onPointerDown={() => handlers.menuOpened(rowKey)}
        title={t("library.documentOptions")}
        aria-label={t("library.optionsFor", { name: shown })}
        className="flex size-5 items-center justify-center rounded p-0 text-muted-foreground opacity-0 hover:bg-sidebar-accent group-hover/doc:opacity-100 group-focus-within/doc:opacity-100 aria-expanded:opacity-100 pointer-coarse:size-8 pointer-coarse:opacity-100"
      >
        <MoreVerticalIcon className="size-3.5" />
      </DropdownMenuTrigger>
    </div>
  );
});

export function FolderTree(props: FolderTreeProps) {
  const t = useT();
  const folders = useFolderStore((s) => s.folders);
  const docParents = useFolderStore((s) => s.docParents);
  const docOrder = useFolderStore((s) => s.docOrder);
  const expanded = useFolderStore((s) => s.expanded);
  const lastCreatedFolderId = useFolderStore((s) => s.lastCreatedFolderId);
  const consumeLastCreatedFolder = useFolderStore((s) => s.consumeLastCreatedFolder);
  const contextMenuEnabled = useUIStore((s) => s.contextMenuEnabled);
  const tick = useMinuteTick();

  const tree = useMemo(
    () => buildFolderTree(props.documents, folders, docParents, docOrder),
    [props.documents, folders, docParents, docOrder]
  );
  const rows = useMemo(() => flattenTree(tree, expanded), [tree, expanded]);

  // What the stable handlers read: always the latest render's.
  const latest = useRef({ rows, props });
  latest.current = { rows, props };

  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [ctxKey, setCtxKey] = useState<string | null>(null);
  const [rootOver, setRootOver] = useState(false);

  const indexOfKey = useMemo(() => new Map(rows.map((r, i) => [r.key, i])), [rows]);
  const activeKey = props.activeDocId ? docRowKey(props.activeDocId) : null;
  // The one row Tab lands on: the row the user was last on, else the open
  // document (when its folder is expanded), else the first row.
  const tabbableKey =
    (focusKey && indexOfKey.has(focusKey) ? focusKey : null) ??
    (activeKey && indexOfKey.has(activeKey) ? activeKey : null) ??
    rows[0]?.key ??
    null;
  // Rows that must stay mounted even when scrolled away: the tab stop (so
  // focus is never dropped on <body>), a rename in progress, an open menu.
  const pinned = [tabbableKey, renamingKey, menuKey, ctxKey]
    .map((k) => (k ? indexOfKey.get(k) ?? -1 : -1))
    .filter((i) => i >= 0);

  const ownScrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollRef = props.scrollRef ?? ownScrollRef;
  const getKey = useCallback((i: number) => rows[i]!.key, [rows]);
  const estimateSize = useCallback((i: number) => (rows[i]!.kind === "folder" ? 28 : 40), [rows]);
  const { rows: windowRows, totalSize, measureElement, scrollToIndex, rowKeyAttr } = useWindowedList({
    count: rows.length,
    getKey,
    estimateSize,
    scrollRef,
    listRef,
    pinned,
  });
  const focusRow = useFocusRowAfterRender(listRef);

  // A user-initiated "New folder" opens its rename box (createFolder's
  // `startNaming`). createFolder expands the parent, so the row exists; bring
  // it into the window and focus it.
  useEffect(() => {
    if (!lastCreatedFolderId) return;
    const key = folderRowKey(lastCreatedFolderId);
    const index = indexOfKey.get(key);
    if (index === undefined) return; // not in the rows yet — retried on the next change
    setRenamingKey(key);
    setFocusKey(key);
    scrollToIndex(index);
    consumeLastCreatedFolder();
  }, [lastCreatedFolderId, indexOfKey, scrollToIndex, consumeLastCreatedFolder]);

  const menuHandle = useMemo(() => MenuPrimitive.createHandle<RowMenuPayload>(), []);

  const handlers = useMemo<RowHandlers>(() => {
    const store = () => useFolderStore.getState();
    return {
      select: (docId) => latest.current.props.onSelect(docId),
      toggle: (folderId) => store().toggleExpanded(folderId),
      renameDoc: (docId, title) => latest.current.props.onRename(docId, title),
      renameFolder: (folderId, name) => store().renameFolder(folderId, name),
      endRename: (key) => {
        setRenamingKey((k) => (k === key ? null : k));
        focusRow(key); // back to the row, not lost on <body>
      },
      dragStart: (e, kind, id) => {
        e.stopPropagation();
        setDragPayload(e, { kind, id });
      },
      dropOnRow: (e, key, zone) => {
        const p = getDragPayload(e);
        const row = latest.current.rows.find((r) => r.key === key);
        if (!p || !row) return;
        // Every drop a row accepts is FINISHED here: nothing may bubble on to
        // the tree root's drop-to-root handler (that bubbling was A066).
        e.preventDefault();
        e.stopPropagation();
        const s = store();
        if (row.kind === "folder") {
          if (p.kind === "doc") {
            // Docs always drop INTO the folder (reordering happens among doc rows).
            s.moveDoc(p.id, row.id);
            return;
          }
          if (p.id === row.id) return;
          if (zone === "into") {
            s.moveFolder(p.id, row.id);
          } else {
            // Reorder before/after this folder within its sibling group.
            s.moveFolder(p.id, row.folder.parentId);
            s.setFolderOrder(spliceOrder(row.siblingFolderIds, p.id, row.id, zone === "after" ? "after" : "before"));
          }
          return;
        }
        const action = docRowDrop(p, { docId: row.id, folderId: row.folderId, siblingDocIds: row.siblingDocIds }, zone);
        if (action.kind === "moveFolder") s.moveFolder(p.id, action.parentId);
        else if (action.kind === "reorderDoc") {
          s.moveDoc(p.id, action.folderId); // ensure same folder, then position
          s.setDocOrder(docOrderKey(action.folderId), action.order);
        }
      },
      menuOpened: (key) => setMenuKey(key),
      menuHandle,
    };
  }, [menuHandle, focusRow]);

  const dropToRoot = (e: ReactDragEvent) => {
    const p = getDragPayload(e);
    setRootOver(false);
    if (!p) return;
    e.preventDefault();
    const s = useFolderStore.getState();
    if (p.kind === "doc") s.moveDoc(p.id, null);
    else s.moveFolder(p.id, null);
  };

  const onTreeKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea")) return; // the rename box keeps its keys
    const rowEl = target.closest<HTMLElement>('[role="treeitem"]');
    const key = rowEl?.getAttribute("data-key");
    const index = key ? indexOfKey.get(key) : undefined;
    if (index === undefined) return;
    const row = rows[index]!;
    // The row's menu from the keyboard: the context-menu key or Shift+F10
    // open the SAME shared menu the ⋮ button does.
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      setMenuKey(row.key);
      menuHandle.open(`pf-row-menu-${row.key}`);
      return;
    }
    if (e.key === "F2") {
      e.preventDefault();
      setRenamingKey(row.key);
      return;
    }
    // Enter / Space on an inner button activate that button natively.
    if ((e.key === "Enter" || e.key === " ") && target !== rowEl) return;
    const action = treeKeyAction(rows, index, e.key);
    if (!action) return;
    e.preventDefault();
    const at = rows[action.index]!;
    if (action.type === "focus") {
      setFocusKey(at.key);
      scrollToIndex(action.index);
      focusRow(at.key);
    } else if (action.type === "expand" || action.type === "collapse" || at.kind === "folder") {
      useFolderStore.getState().toggleExpanded(at.id);
    } else {
      props.onSelect(at.id);
    }
  };

  // Clicking into a row (its title, its ⋮) makes it the tab stop.
  const onTreeFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const key = (e.target as HTMLElement).closest('[role="treeitem"]')?.getAttribute("data-key");
    if (key && key !== focusKey) setFocusKey(key);
  };

  // Right-click / long-press: remember WHICH row, so the shared context menu
  // renders that row's items. Runs in the same event as Base UI's handler.
  const recordCtxTarget = (e: React.SyntheticEvent) => {
    const key = (e.target as HTMLElement).closest(`[${rowKeyAttr}]`)?.getAttribute(rowKeyAttr) ?? null;
    setCtxKey(key);
  };

  const menuBody = (payload: RowMenuPayload | undefined, F: MenuFam) => {
    if (!payload) return null;
    if (payload.kind === "doc") {
      return (
        <DocMenuBody
          F={F}
          docId={payload.id}
          folderId={payload.folderId}
          startRename={() => setRenamingKey(docRowKey(payload.id))}
          onDuplicate={props.onDuplicate}
          onDelete={props.onDelete}
          onExportDoc={props.onExportDoc}
          onShareDoc={props.onShareDoc}
        />
      );
    }
    const row = rows[indexOfKey.get(folderRowKey(payload.id)) ?? -1];
    if (!row || row.kind !== "folder") return null;
    return (
      <FolderMenuBody
        F={F}
        folder={row.folder}
        count={row.count}
        startRename={() => setRenamingKey(folderRowKey(payload.id))}
        onExportFolder={props.onExportFolder}
        onShareFolder={props.onShareFolder}
        confirmDeleteFolder={props.confirmDeleteFolder}
      />
    );
  };

  const ctxRow = ctxKey !== null ? rows[indexOfKey.get(ctxKey) ?? -1] : undefined;
  const ctxPayload: RowMenuPayload | undefined = !ctxRow
    ? undefined
    : ctxRow.kind === "doc"
      ? { kind: "doc", id: ctxRow.id, folderId: ctxRow.folderId }
      : { kind: "folder", id: ctxRow.id };

  const treeProps = {
    ref: listRef,
    role: "tree",
    "aria-label": t("library.documentFolders"),
    onKeyDown: onTreeKeyDown,
    onFocus: onTreeFocus,
    className: "relative shrink-0",
    style: { height: totalSize },
  };

  const rowElements = windowRows.map((w) => {
    const row = rows[w.index]!;
    const tabbable = row.key === tabbableKey;
    const editing = row.key === renamingKey;
    return (
      <div
        key={row.key}
        {...{ [rowKeyAttr]: row.key }}
        ref={measureElement}
        className="absolute inset-x-0"
        style={{ top: w.start }}
      >
        {row.kind === "folder" ? (
          <FolderRow
            rowKey={row.key}
            id={row.id}
            name={row.folder.name}
            depth={row.depth}
            expanded={row.expanded}
            count={row.count}
            posinset={row.posinset}
            setsize={row.setsize}
            tabbable={tabbable}
            editing={editing}
            handlers={handlers}
          />
        ) : (
          <DocRow
            rowKey={row.key}
            id={row.id}
            title={row.doc.title}
            updated={row.doc.updated}
            wordCount={row.doc.wordCount}
            folderId={row.folderId}
            depth={row.depth}
            posinset={row.posinset}
            setsize={row.setsize}
            isActive={row.id === props.activeDocId}
            tabbable={tabbable}
            editing={editing}
            tick={tick}
            handlers={handlers}
          />
        )}
      </div>
    );
  });

  return (
    <div
      ref={props.scrollRef ? undefined : ownScrollRef}
      className="flex min-h-[80px] flex-col"
      onDragOver={(e) => {
        if (hasDragItem(e)) e.preventDefault();
      }}
      onDrop={dropToRoot}
      onDragEnd={() => setRootOver(false)}
    >
      {contextMenuEnabled ? (
        /* ONE context menu for the whole tree (A082), not a root per row.
           Base UI's trigger handles right-click and the touch long-press; the
           recorders say which row it was over. The honour of the admin flag is
           unchanged: off, there is no trigger and the native menu shows. */
        <ContextMenu onOpenChange={(open) => { if (!open) setCtxKey(null); }}>
          <ContextMenuTrigger
            render={<div {...treeProps} />}
            onContextMenu={recordCtxTarget}
            onTouchStart={recordCtxTarget}
          >
            {rowElements}
          </ContextMenuTrigger>
          <ContextMenuContent className="w-44">{menuBody(ctxPayload, CONTEXT_FAM)}</ContextMenuContent>
        </ContextMenu>
      ) : (
        <div {...treeProps}>{rowElements}</div>
      )}

      {/* ONE dropdown for every row's ⋮ button (A082). The triggers are
          detached (a Base UI handle + payload), so no row mounts a menu root,
          and the popup itself mounts only while open. */}
      <DropdownMenu handle={menuHandle} onOpenChange={(open) => { if (!open) setMenuKey(null); }}>
        {({ payload }) =>
          payload ? (
            <DropdownMenuContent align="end" className="w-44">
              {menuBody(payload as RowMenuPayload, DROPDOWN_FAM)}
            </DropdownMenuContent>
          ) : null
        }
      </DropdownMenu>

      {/* Always-available drop target so items can be dragged OUT to the top level. */}
      <div
        aria-hidden={!rootOver}
        onDragOver={(e) => {
          if (hasDragItem(e)) {
            e.preventDefault();
            e.stopPropagation();
            setRootOver(true);
          }
        }}
        onDragLeave={() => setRootOver(false)}
        onDrop={dropToRoot}
        className={cn(
          "mt-1 flex-1 rounded-md border border-dashed border-transparent px-2 py-3 text-center text-[10px] text-muted-foreground transition-colors",
          rootOver && "border-primary/50 bg-primary/5"
        )}
      >
        {rootOver ? t("library.dropToTopLevel") : " "}
      </div>
    </div>
  );
}
