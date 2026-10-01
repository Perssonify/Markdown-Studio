import { create } from "zustand";
import type { DocumentSummary } from "./document";

/**
 * Folder organization overlay.
 *
 * Folders are an organizational layer on top of the (flat) document store:
 * documents stay flat in storage, and their tree position is metadata persisted
 * under `__prefs.folderTree`. This keeps the delicate document save-path and the
 * IndexedDB schema untouched while giving first-class nested folders, move, and
 * zip import/export.
 */

export interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
  /** Manual sort position within the sibling group. Undefined ⇒ not yet
   *  manually ordered (falls back to name sort, after ordered siblings). */
  order?: number;
}

/**
 * Group a set of document ids by their (immediate) folder, for the graph's
 * folder containers. Only folders that actually contain one of the given docs
 * are returned, each with its display name and member ids. Pure so it can be
 * unit-tested and memoized.
 */
export function groupDocsByFolder(
  docIds: string[],
  folders: FolderRecord[],
  docParents: Record<string, string>
): { id: string; name: string; docIds: string[] }[] {
  const nameById = new Map(folders.map((f) => [f.id, f.name]));
  const groups = new Map<string, { id: string; name: string; docIds: string[] }>();
  for (const id of docIds) {
    const fid = docParents[id];
    const name = fid ? nameById.get(fid) : undefined;
    if (!fid || !name) continue;
    let g = groups.get(fid);
    if (!g) { g = { id: fid, name, docIds: [] }; groups.set(fid, g); }
    g.docIds.push(id);
  }
  return Array.from(groups.values());
}

/** Key for the per-folder document-order map; root docs use "root". */
export function docOrderKey(folderId: string | null): string {
  return folderId ?? "root";
}

export interface FolderTreeData {
  folders: FolderRecord[];
  /** docId → folderId. Absent ⇒ document lives at the root. */
  docParents: Record<string, string>;
  /** folderId (or "root") → manually-ordered docId list. Docs not listed fall
   *  back to most-recently-updated order, after the listed ones. */
  docOrder: Record<string, string[]>;
  /** folderId → expanded. */
  expanded: Record<string, boolean>;
}

export interface FolderTreeNode {
  folder: FolderRecord;
  children: FolderTreeNode[];
  docs: DocumentSummary[];
}

export interface BuiltTree {
  rootFolders: FolderTreeNode[];
  rootDocs: DocumentSummary[];
}

/**
 * Build a nested tree from flat documents + folders + docParents. Documents
 * whose parent folder is missing fall back to the root. Folders are sorted by
 * name; documents by most-recently-updated.
 */
export function buildFolderTree(
  documents: DocumentSummary[],
  folders: FolderRecord[],
  docParents: Record<string, string>,
  docOrder: Record<string, string[]> = {}
): BuiltTree {
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const childFolders = new Map<string | null, FolderRecord[]>();
  for (const f of folders) {
    const key = f.parentId && folderById.has(f.parentId) ? f.parentId : null;
    (childFolders.get(key) ?? childFolders.set(key, []).get(key)!).push(f);
  }
  const docsByFolder = new Map<string | null, DocumentSummary[]>();
  for (const d of documents) {
    const parent = docParents[d.id];
    const key = parent && folderById.has(parent) ? parent : null;
    (docsByFolder.get(key) ?? docsByFolder.set(key, []).get(key)!).push(d);
  }
  // Folders: manual `order` first (ascending), then un-ordered by name.
  const byOrderName = (a: FolderRecord, b: FolderRecord) => {
    const ao = a.order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.order ?? Number.MAX_SAFE_INTEGER;
    return ao !== bo ? ao - bo : a.name.localeCompare(b.name);
  };
  const byUpdated = (a: DocumentSummary, b: DocumentSummary) =>
    new Date(b.updated).getTime() - new Date(a.updated).getTime();

  // Docs: those listed in docOrder[key] first (in that order), then the rest by
  // most-recently-updated — so a manually reordered folder is stable while newly
  // created docs still surface near the top.
  const orderDocs = (folderId: string | null, docs: DocumentSummary[]): DocumentSummary[] => {
    const explicit = docOrder[docOrderKey(folderId)];
    if (!explicit || explicit.length === 0) return docs.slice().sort(byUpdated);
    const pos = new Map(explicit.map((id, i) => [id, i]));
    const listed = docs.filter((d) => pos.has(d.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
    const rest = docs.filter((d) => !pos.has(d.id)).sort(byUpdated);
    return [...listed, ...rest];
  };

  const build = (parentId: string | null): FolderTreeNode[] =>
    (childFolders.get(parentId) ?? [])
      .slice()
      .sort(byOrderName)
      .map((folder) => ({
        folder,
        children: build(folder.id),
        docs: orderDocs(folder.id, docsByFolder.get(folder.id) ?? []),
      }));

  return {
    rootFolders: build(null),
    rootDocs: orderDocs(null, docsByFolder.get(null) ?? []),
  };
}

/**
 * Collect all documents in a folder subtree with their directory path (relative
 * to the exported folder's parent, so the folder name is the top-level dir).
 */
export function collectFolderExport(
  rootId: string,
  folders: FolderRecord[],
  docParents: Record<string, string>
): { docId: string; dirSegments: string[] }[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const root = byId.get(rootId);
  if (!root) return [];

  const inSubtree = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of folders) {
      if (f.parentId && inSubtree.has(f.parentId) && !inSubtree.has(f.id)) {
        inSubtree.add(f.id);
        changed = true;
      }
    }
  }

  const pathOf = (id: string): string[] => {
    const segs: string[] = [];
    let cur: string | null | undefined = id;
    while (cur && cur !== root.parentId) {
      const f = byId.get(cur);
      if (!f) break;
      segs.unshift(f.name);
      cur = f.parentId;
    }
    return segs;
  };

  const out: { docId: string; dirSegments: string[] }[] = [];
  for (const [docId, folderId] of Object.entries(docParents)) {
    if (inSubtree.has(folderId)) out.push({ docId, dirSegments: pathOf(folderId) });
  }
  return out;
}

let _folderCounter = 0;
export function generateFolderId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `fld-${ts}-${rand}-${(++_folderCounter).toString(36)}`;
}

interface FolderState extends FolderTreeData {
  /** Id of a folder the USER just created from the New-folder action, so the
   *  tree can open it directly in rename mode instead of leaving an unnamed
   *  "New Folder". Consumed once.
   *
   *  Only set when `createFolder` is called with `{ startNaming: true }`.
   *  Programmatic creation — archive import, first-run seeding — must NOT set
   *  it: it opened a focused rename box on a folder the user never created,
   *  leaving a blinking caret in the library on first load. */
  lastCreatedFolderId: string | null;
  consumeLastCreatedFolder: () => void;
  createFolder: (
    name: string,
    parentId?: string | null,
    opts?: { startNaming?: boolean }
  ) => string;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  moveDoc: (docId: string, folderId: string | null) => void;
  moveFolder: (id: string, parentId: string | null) => void;
  /** Set the manual order of a folder sibling group (ids in desired order). */
  setFolderOrder: (orderedIds: string[]) => void;
  /** Set the manual order of documents within a folder (or "root"). */
  setDocOrder: (folderKey: string, orderedDocIds: string[]) => void;
  toggleExpanded: (id: string) => void;
  /** Seed from persisted prefs during mount. */
  setInitialTree: (data: Partial<FolderTreeData>) => void;
  /** Drop metadata for documents that no longer exist. */
  pruneOrphans: (existingDocIds: Set<string>) => void;
  serialize: () => FolderTreeData;
}

/** Would moving `id` under `parentId` create a cycle? */
function isDescendant(
  folders: FolderRecord[],
  id: string,
  maybeAncestor: string
): boolean {
  let cur: string | null | undefined = maybeAncestor;
  const byId = new Map(folders.map((f) => [f.id, f]));
  while (cur) {
    if (cur === id) return true;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

export const useFolderStore = create<FolderState>((set, get) => ({
  folders: [],
  docParents: {},
  docOrder: {},
  expanded: {},
  lastCreatedFolderId: null,

  consumeLastCreatedFolder: () => set({ lastCreatedFolderId: null }),

  createFolder: (name, parentId = null, opts) => {
    const id = generateFolderId();
    set((s) => ({
      folders: [...s.folders, { id, name: name.trim() || "New Folder", parentId }],
      expanded: { ...s.expanded, ...(parentId ? { [parentId]: true } : {}) },
      // Opt-IN: only a user-initiated "New folder" wants the rename box open.
      ...(opts?.startNaming ? { lastCreatedFolderId: id } : {}),
    }));
    return id;
  },

  renameFolder: (id, name) =>
    set((s) => ({
      folders: s.folders.map((f) =>
        f.id === id ? { ...f, name: name.trim() || f.name } : f
      ),
    })),

  deleteFolder: (id) =>
    set((s) => {
      const target = s.folders.find((f) => f.id === id);
      const newParent = target?.parentId ?? null;
      // Reparent immediate child folders and documents up one level.
      const folders = s.folders
        .filter((f) => f.id !== id)
        .map((f) => (f.parentId === id ? { ...f, parentId: newParent } : f));
      const docParents: Record<string, string> = {};
      for (const [docId, folderId] of Object.entries(s.docParents)) {
        if (folderId === id) {
          if (newParent) docParents[docId] = newParent;
        } else {
          docParents[docId] = folderId;
        }
      }
      return { folders, docParents };
    }),

  moveDoc: (docId, folderId) =>
    set((s) => {
      const docParents = { ...s.docParents };
      if (folderId) docParents[docId] = folderId;
      else delete docParents[docId];
      return {
        docParents,
        expanded: folderId
          ? { ...s.expanded, [folderId]: true }
          : s.expanded,
      };
    }),

  moveFolder: (id, parentId) =>
    set((s) => {
      if (id === parentId) return s;
      if (parentId && isDescendant(s.folders, id, parentId)) return s; // no cycles
      return {
        folders: s.folders.map((f) =>
          f.id === id ? { ...f, parentId } : f
        ),
        expanded: parentId ? { ...s.expanded, [parentId]: true } : s.expanded,
      };
    }),

  setFolderOrder: (orderedIds) =>
    set((s) => {
      const pos = new Map(orderedIds.map((id, i) => [id, i]));
      return {
        folders: s.folders.map((f) => (pos.has(f.id) ? { ...f, order: pos.get(f.id) } : f)),
      };
    }),

  setDocOrder: (folderKey, orderedDocIds) =>
    set((s) => ({ docOrder: { ...s.docOrder, [folderKey]: orderedDocIds } })),

  toggleExpanded: (id) =>
    set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } })),

  setInitialTree: (data) =>
    set({
      folders: data.folders ?? [],
      docParents: data.docParents ?? {},
      docOrder: data.docOrder ?? {},
      expanded: data.expanded ?? {},
    }),

  pruneOrphans: (existingDocIds) =>
    set((s) => {
      // An EMPTY library listing while the tree still files documents is far
      // more likely a listing that failed (an unreadable document list, a
      // storage hiccup, a boot race) than every document deleted at once — and
      // pruning on it discarded every folder membership permanently, persisted
      // via the prefs. Keep the tree; stale entries for documents that really
      // are gone are harmless and are pruned by the next non-empty listing.
      if (existingDocIds.size === 0 && Object.keys(s.docParents).length > 0) return s;
      const docParents: Record<string, string> = {};
      for (const [docId, folderId] of Object.entries(s.docParents)) {
        if (existingDocIds.has(docId) && s.folders.some((f) => f.id === folderId)) {
          docParents[docId] = folderId;
        }
      }
      // Also drop deleted doc ids from every docOrder bucket — otherwise they
      // linger forever in persisted __prefs.folderTree and the pref grows
      // unbounded over the library's lifetime (the tree already filters them out
      // at render, so this is purely storage hygiene).
      const docOrder: Record<string, string[]> = {};
      for (const [key, ids] of Object.entries(s.docOrder)) {
        const kept = ids.filter((id) => existingDocIds.has(id));
        if (kept.length) docOrder[key] = kept;
      }
      return { docParents, docOrder };
    }),

  serialize: () => {
    const { folders, docParents, docOrder, expanded } = get();
    return { folders, docParents, docOrder, expanded };
  },
}));
