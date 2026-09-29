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
import type { DocumentSummary } from "@/store/document";
import { useUIStore } from "@/store/uiStore";
import {
  buildFolderTree,
  docOrderKey,
  type FolderRecord,
  type FolderTreeNode,
  useFolderStore,
} from "@/store/folders";
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
  Trash2Icon,
} from "lucide-react";
import { type DragEvent as ReactDragEvent, type ReactNode, useEffect, useRef, useState } from "react";
import {
  computeDropZone,
  type DropZone,
  getDragPayload,
  hasDragItem,
  setDragPayload,
  spliceOrder,
} from "./folder-dnd";

function timeAgo(date: Date | number | string): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

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
  /** Confirm before deleting a folder. Resolves true to proceed. When omitted,
   *  deletion proceeds without confirmation (kept optional for tests). */
  confirmDeleteFolder?: (name: string, itemCount: number) => Promise<boolean>;
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

/** Wrap a library row so right-click / long-press opens `menu`. Honors the
 *  admin `contextMenuEnabled` flag (off → native browser menu). The trigger
 *  uses display:contents so it adds no box and leaves the row's own layout,
 *  ref, and drag handlers untouched. */
function RowContextMenu({ menu, children }: { menu: ReactNode; children: ReactNode }) {
  const enabled = useUIStore((s) => s.contextMenuEnabled);
  if (!enabled) return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div style={{ display: "contents" }} />}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">{menu}</ContextMenuContent>
    </ContextMenu>
  );
}

export function FolderTree(props: FolderTreeProps) {
  const folders = useFolderStore((s) => s.folders);
  const docParents = useFolderStore((s) => s.docParents);
  const docOrder = useFolderStore((s) => s.docOrder);
  const moveDoc = useFolderStore((s) => s.moveDoc);
  const moveFolder = useFolderStore((s) => s.moveFolder);
  const tree = buildFolderTree(props.documents, folders, docParents, docOrder);
  const [rootOver, setRootOver] = useState(false);

  const rootFolderIds = tree.rootFolders.map((n) => n.folder.id);
  const rootDocIds = tree.rootDocs.map((d) => d.id);

  const dropToRoot = (e: ReactDragEvent) => {
    const p = getDragPayload(e);
    setRootOver(false);
    if (!p) return;
    e.preventDefault();
    if (p.kind === "doc") moveDoc(p.id, null);
    else moveFolder(p.id, null);
  };

  return (
    <div
      role="tree"
      aria-label="Document folders"
      className="flex min-h-[80px] flex-col gap-0.5"
      onDragOver={(e) => {
        if (hasDragItem(e)) e.preventDefault();
      }}
      onDrop={dropToRoot}
      onDragEnd={() => setRootOver(false)}
    >
      {tree.rootFolders.map((node) => (
        <FolderNode
          key={node.folder.id}
          node={node}
          depth={0}
          siblingFolderIds={rootFolderIds}
          {...props}
        />
      ))}
      {tree.rootDocs.map((doc) => (
        <DocRow key={doc.id} doc={doc} depth={0} folderId={null} siblingDocIds={rootDocIds} {...props} />
      ))}
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
          "mt-1 flex-1 rounded-md border border-dashed border-transparent px-2 py-3 text-center text-[10px] text-muted-foreground/50 transition-colors",
          rootOver && "border-primary/50 bg-primary/5 text-muted-foreground"
        )}
      >
        {rootOver ? "Drop here to move to top level" : " "}
      </div>
    </div>
  );
}

function MoveToMenu({
  F,
  onMove,
  onNewFolderHere,
}: {
  F: MenuFam;
  onMove: (folderId: string | null) => void;
  onNewFolderHere: () => void;
}) {
  const folders = useFolderStore((s) => s.folders);
  return (
    <F.Sub>
      <F.SubTrigger>
        <FolderIcon className="mr-2 size-3.5" />
        Move to
      </F.SubTrigger>
      <F.SubContent className="max-h-64 overflow-y-auto">
        <F.Item onClick={onNewFolderHere}>
          <FolderPlusIcon className="mr-2 size-3.5" />
          New folder here…
        </F.Item>
        <F.Separator />
        <F.Item onClick={() => onMove(null)}>Root</F.Item>
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
  return (
    <F.Sub>
      <F.SubTrigger>
        <DownloadIcon className="mr-2 size-3.5" />
        Export
      </F.SubTrigger>
      <F.SubContent>
        <F.Item onClick={() => onExportDoc(docId, "md")}>Markdown (.md)</F.Item>
        <F.Item onClick={() => onExportDoc(docId, "html")}>HTML (.html)</F.Item>
        <F.Item onClick={() => onExportDoc(docId, "docx")}>Word (.docx)</F.Item>
        <F.Item onClick={() => onExportDoc(docId, "json")}>Backup (.json)</F.Item>
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
}: {
  F: MenuFam;
  docId: string;
  folderId: string | null;
  startRename: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onExportDoc?: (docId: string, format: ExportDocFormat) => void;
}) {
  const moveDoc = useFolderStore((s) => s.moveDoc);
  const createFolder = useFolderStore((s) => s.createFolder);
  return (
    <>
      <F.Item onClick={startRename}>
        <Edit2Icon className="mr-2 size-3.5" />
        Rename
      </F.Item>
      <F.Item onClick={() => onDuplicate(docId)}>Duplicate</F.Item>
      <MoveToMenu
        F={F}
        onMove={(fid) => moveDoc(docId, fid)}
        onNewFolderHere={() => {
          const id = createFolder("New Folder", folderId, { startNaming: true });
          moveDoc(docId, id);
        }}
      />
      {onExportDoc && <ExportDocSubmenu F={F} docId={docId} onExportDoc={onExportDoc} />}
      <F.Separator />
      <F.Item className="text-destructive focus:text-destructive" onClick={() => onDelete(docId)}>
        <Trash2Icon className="mr-2 size-3.5" />
        Delete
      </F.Item>
    </>
  );
}

/** Folder row menu items, rendered into either primitive family. */
function FolderMenuBody({
  F,
  node,
  count,
  startRename,
  onExportFolder,
  confirmDeleteFolder,
}: {
  F: MenuFam;
  node: FolderTreeNode;
  count: number;
  startRename: () => void;
  onExportFolder?: (folderId: string, opts?: { canonical?: boolean }) => void;
  confirmDeleteFolder?: (name: string, itemCount: number) => Promise<boolean>;
}) {
  const createFolder = useFolderStore((s) => s.createFolder);
  const moveFolder = useFolderStore((s) => s.moveFolder);
  const deleteFolder = useFolderStore((s) => s.deleteFolder);
  return (
    <>
      <F.Item onClick={() => createFolder("New Folder", node.folder.id, { startNaming: true })}>
        <FolderPlusIcon className="mr-2 size-3.5" />
        New subfolder
      </F.Item>
      <F.Item onClick={startRename}>
        <Edit2Icon className="mr-2 size-3.5" />
        Rename
      </F.Item>
      <MoveToMenu
        F={F}
        onMove={(pid) => moveFolder(node.folder.id, pid)}
        onNewFolderHere={() => {
          const id = createFolder("New Folder", node.folder.parentId, { startNaming: true });
          moveFolder(node.folder.id, id);
        }}
      />
      {onExportFolder && (
        <>
          <F.Item onClick={() => onExportFolder(node.folder.id)}>
            <FolderDownIcon className="mr-2 size-3.5" />
            Export as ZIP
          </F.Item>
          <F.Item onClick={() => onExportFolder(node.folder.id, { canonical: true })}>
            <ArchiveIcon className="mr-2 size-3.5" />
            Full backup (.zip)
          </F.Item>
        </>
      )}
      <F.Separator />
      <F.Item
        className="text-destructive focus:text-destructive"
        onClick={async () => {
          const ok = confirmDeleteFolder ? await confirmDeleteFolder(node.folder.name, count) : true;
          if (ok) deleteFolder(node.folder.id);
        }}
      >
        <Trash2Icon className="mr-2 size-3.5" />
        Delete folder
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

function FolderNode({
  node,
  depth,
  siblingFolderIds,
  ...props
}: { node: FolderTreeNode; depth: number; siblingFolderIds: string[] } & FolderTreeProps) {
  const expanded = useFolderStore((s) => s.expanded[node.folder.id] ?? false);
  const toggleExpanded = useFolderStore((s) => s.toggleExpanded);
  const renameFolder = useFolderStore((s) => s.renameFolder);
  const moveFolder = useFolderStore((s) => s.moveFolder);
  const moveDoc = useFolderStore((s) => s.moveDoc);
  const setFolderOrder = useFolderStore((s) => s.setFolderOrder);
  const lastCreatedFolderId = useFolderStore((s) => s.lastCreatedFolderId);
  const consumeLastCreatedFolder = useFolderStore((s) => s.consumeLastCreatedFolder);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(node.folder.name);
  const [zone, setZone] = useState<DropZone | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const count = node.docs.length + node.children.length;
  const startRename = () => {
    setName(node.folder.name);
    setEditing(true);
  };
  const menuBody = (F: MenuFam) => (
    <FolderMenuBody
      F={F}
      node={node}
      count={count}
      startRename={startRename}
      onExportFolder={props.onExportFolder}
      confirmDeleteFolder={props.confirmDeleteFolder}
    />
  );

  useEffect(() => {
    if (lastCreatedFolderId === node.folder.id) {
      setName(node.folder.name);
      setEditing(true);
      consumeLastCreatedFolder();
    }
  }, [lastCreatedFolderId, node.folder.id, node.folder.name, consumeLastCreatedFolder]);

  return (
    /* `aria-level` is required on a treeitem whose depth is expressed by
       styling rather than by DOM nesting of groups. */
    <div role="treeitem" aria-expanded={expanded} aria-level={depth + 1} aria-label={node.folder.name}>
      <RowContextMenu menu={menuBody(CONTEXT_FAM)}>
      <div
        ref={rowRef}
        draggable={!editing}
        onDragStart={(e) => {
          e.stopPropagation();
          setDragPayload(e, { kind: "folder", id: node.folder.id });
        }}
        onDragOver={(e) => {
          if (!hasDragItem(e) || !rowRef.current) return;
          e.preventDefault();
          e.stopPropagation();
          // Drag kind isn't readable during dragover (protected mode), so show the
          // 3-zone folder indicator; a doc drop is coerced to "into" in onDrop.
          setZone(computeDropZone(e, rowRef.current, true));
        }}
        onDragLeave={() => setZone(null)}
        onDrop={(e) => {
          const p = getDragPayload(e);
          const z = zone;
          setZone(null);
          if (!p) return;
          e.preventDefault();
          e.stopPropagation();
          if (p.kind === "doc") {
            // Docs always drop INTO the folder (reordering happens among doc rows).
            moveDoc(p.id, node.folder.id);
            return;
          }
          // Folder payload
          if (p.id === node.folder.id) return;
          if (z === "into") {
            moveFolder(p.id, node.folder.id);
          } else {
            // Reorder before/after this folder within its sibling group.
            moveFolder(p.id, node.folder.parentId);
            setFolderOrder(spliceOrder(siblingFolderIds, p.id, node.folder.id, z === "after" ? "after" : "before"));
          }
        }}
        className={cn(
          "group/folder flex select-none items-center gap-1 rounded-md px-1 py-1 hover:bg-sidebar-accent",
          !editing && "cursor-grab active:cursor-grabbing",
          dropClasses(zone)
        )}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        <button
          type="button"
          onClick={() => toggleExpanded(node.folder.id)}
          className="flex size-4 items-center justify-center text-muted-foreground"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronRightIcon className="size-3.5" />
          )}
        </button>
        <FolderIcon className="size-3.5 shrink-0 text-primary/70" />
        {editing ? (
          <Input
            autoFocus
            onFocus={(e) => e.target.select()}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              renameFolder(node.folder.id, name);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                renameFolder(node.folder.id, name);
                setEditing(false);
              }
              if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
            }}
            className="h-6 flex-1 text-[12px]!"
          />
        ) : (
          <button
            type="button"
            onClick={() => toggleExpanded(node.folder.id)}
            // A5: `truncate` with no `title` leaves a clipped name unreadable —
            // and folder names nest, so the deeper ones are clipped soonest.
            title={node.folder.name}
            className="flex-1 truncate text-left text-xs font-medium text-foreground"
          >
            {node.folder.name}
            <span className="ml-1.5 text-[10px] text-muted-foreground/70">
              {count || ""}
            </span>
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                title="Folder options"
                className="flex size-5 items-center justify-center rounded p-0 text-muted-foreground opacity-0 hover:bg-sidebar-accent group-hover/folder:opacity-100 pointer-coarse:size-8 pointer-coarse:opacity-100"
              />
            }
          >
            <MoreVerticalIcon className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {menuBody(DROPDOWN_FAM)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </RowContextMenu>
      {expanded && (
        /* role="group" is REQUIRED between a treeitem and its child treeitems.
           Without it the children were direct descendants of the item, so the
           tree reported a flat list of siblings and the folder structure — the
           only reason this is a tree at all — was invisible to a screen reader. */
        <div role="group">
          {node.children.map((child) => (
            <FolderNode
              key={child.folder.id}
              node={child}
              depth={depth + 1}
              siblingFolderIds={node.children.map((c) => c.folder.id)}
              {...props}
            />
          ))}
          {node.docs.map((doc) => (
            <DocRow
              key={doc.id}
              doc={doc}
              depth={depth + 1}
              folderId={node.folder.id}
              siblingDocIds={node.docs.map((d) => d.id)}
              {...props}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DocRow({
  doc,
  depth,
  folderId,
  siblingDocIds,
  activeDocId,
  onSelect,
  onRename,
  onDelete,
  onDuplicate,
  onExportDoc,
}: {
  doc: DocumentSummary;
  depth: number;
  folderId: string | null;
  siblingDocIds: string[];
} & FolderTreeProps) {
  const moveDoc = useFolderStore((s) => s.moveDoc);
  const setDocOrder = useFolderStore((s) => s.setDocOrder);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(doc.title);
  const [zone, setZone] = useState<DropZone | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const isActive = doc.id === activeDocId;
  const startRename = () => {
    setTitle(doc.title);
    setEditing(true);
  };
  /**
   * Commit an inline rename, ignoring an empty one.
   *
   * `renameDoc("")` sets `userTitle = ""` AND `titlePinnedByUser = true`, and
   * `resolveDocTitle` honours a flagged pin verbatim — so clearing the box and
   * pressing Enter (or just tabbing away) pinned a permanently blank title that
   * no heading could ever heal. The flat list in WorkspacePanel and
   * `renameFolder` both already guard this; only this row did not.
   */
  const commitRename = () => {
    const next = title.trim();
    if (next && next !== doc.title) onRename(doc.id, next);
    else setTitle(doc.title);
    setEditing(false);
  };
  const menuBody = (F: MenuFam) => (
    <DocMenuBody
      F={F}
      docId={doc.id}
      folderId={folderId}
      startRename={startRename}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
      onExportDoc={onExportDoc}
    />
  );

  return (
    <RowContextMenu menu={menuBody(CONTEXT_FAM)}>
    <div
      ref={rowRef}
      role="treeitem"
      aria-level={depth + 1}
      /* Both, deliberately. Inside a `role="tree"` the open document IS the
         tree's selection, so `aria-selected` is what an AT user hears on the
         row; `aria-current` is kept to match the flat list in WorkspacePanel,
         which is an ordinary list where `aria-current` is the right attribute
         (CLAUDE.md: keep the two library lists in sync). */
      aria-selected={isActive}
      aria-current={isActive ? "true" : undefined}
      draggable={!editing}
      onDragStart={(e) => {
        e.stopPropagation();
        setDragPayload(e, { kind: "doc", id: doc.id });
      }}
      onDragOver={(e) => {
        if (!hasDragItem(e) || !rowRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        setZone(computeDropZone(e, rowRef.current, false));
      }}
      onDragLeave={() => setZone(null)}
      onDrop={(e) => {
        const p = getDragPayload(e);
        const z = zone;
        setZone(null);
        if (!p || p.kind !== "doc") return; // only docs reorder among doc rows
        e.preventDefault();
        e.stopPropagation();
        if (p.id === doc.id) return;
        moveDoc(p.id, folderId); // ensure same folder, then position
        setDocOrder(docOrderKey(folderId), spliceOrder(siblingDocIds, p.id, doc.id, z === "after" ? "after" : "before"));
      }}
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
        className={cn("size-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground/50")}
      />
      {editing ? (
        <Input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            commitRename();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitRename();
            }
            if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
          }}
          className="h-6 flex-1 text-[12px]!"
        />
      ) : (
        <button
          type="button"
          onClick={() => onSelect(doc.id)}
          className="flex min-w-0 flex-1 flex-col items-start text-left"
        >
          <span
            title={doc.title || "Untitled"}
            className={cn("w-full truncate text-xs text-foreground", isActive && "font-semibold")}
          >
            {doc.title || "Untitled"}
          </span>
          <span className="flex items-center gap-2 text-muted-foreground/75">
            <span className="flex items-center gap-1 text-[10px]">
              <ClockIcon className="size-2.5!" />
              {timeAgo(doc.updated)}
            </span>
            {doc.wordCount != null && doc.wordCount > 0 && (
              <span
                className="flex items-center gap-1 text-[10px]"
                title={`${doc.wordCount.toLocaleString()} words (last saved)`}
              >
                <HashIcon className="size-2.5!" />
                {doc.wordCount.toLocaleString()} words
              </span>
            )}
          </span>
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              title="Document options"
              className="flex size-5 items-center justify-center rounded p-0 text-muted-foreground opacity-0 hover:bg-sidebar-accent group-hover/doc:opacity-100 pointer-coarse:size-8 pointer-coarse:opacity-100"
            />
          }
        >
          <MoreVerticalIcon className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {menuBody(DROPDOWN_FAM)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    </RowContextMenu>
  );
}
