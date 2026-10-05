/**
 * The folder tree across devices: a THREE-WAY merge — pure, unit-tested
 * (cloud-folder-merge.test.js).
 *
 * The tree (store/folders.ts) is folders, which folder each note is in
 * (`docParents`) and manual order (`docOrder`); which folders are EXPANDED is
 * each browser's own business and never synced. Last-writer-wins on the whole
 * tree would drop a folder made on one device whenever another device changed
 * anything, so each entry is merged on its own against the tree both sides last
 * agreed on (`base`): whichever side changed an entry wins it; when both
 * changed the same entry, the account's version does (both devices then
 * settle on the same tree). A deletion is a change like any other.
 */

export interface FolderLike {
  id: string;
  parentId?: string | null;
  [k: string]: unknown;
}

export interface SyncedTree {
  folders: FolderLike[];
  docParents: Record<string, string>;
  docOrder: Record<string, string[]>;
}

export const EMPTY_TREE: SyncedTree = { folders: [], docParents: {}, docOrder: {} };

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The synced part of a stored tree, normalised (anything malformed reads as empty). */
export function syncedPart(raw: unknown): SyncedTree {
  const t = isMap(raw) ? raw : {};
  const folders = Array.isArray(t["folders"])
    ? (t["folders"] as unknown[]).filter((f): f is FolderLike => isMap(f) && typeof f["id"] === "string")
    : [];
  const docParents: Record<string, string> = {};
  if (isMap(t["docParents"])) for (const [k, v] of Object.entries(t["docParents"])) if (typeof v === "string") docParents[k] = v;
  const docOrder: Record<string, string[]> = {};
  if (isMap(t["docOrder"])) {
    for (const [k, v] of Object.entries(t["docOrder"])) if (Array.isArray(v)) docOrder[k] = v.filter((x): x is string => typeof x === "string");
  }
  return { folders, docParents, docOrder };
}

/** A canonical string: equal trees compare equal regardless of key or folder order. */
export function treeSignature(t: SyncedTree): string {
  const folders = [...t.folders].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((f) => sortKeys(f));
  return JSON.stringify([folders, sortKeys(t.docParents), sortKeys(t.docOrder)]);
}

function sortKeys<T extends Record<string, unknown>>(o: T): Record<string, unknown> {
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a === undefined ? null : sortValue(a)) === JSON.stringify(b === undefined ? null : sortValue(b));
const sortValue = (v: unknown): unknown => (isMap(v) ? sortKeys(v) : v);

function mergeKeyed<V>(base: Record<string, V>, local: Record<string, V>, remote: Record<string, V>): Record<string, V> {
  const out: Record<string, V> = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const b = base[k];
    const l = local[k];
    const r = remote[k];
    const pick = same(l, b) ? r : same(r, b) ? l : r;
    if (pick !== undefined) out[k] = pick;
  }
  return out;
}

const byId = (folders: FolderLike[]) => Object.fromEntries(folders.map((f) => [f.id, f]));

export function mergeTrees(base: SyncedTree, local: SyncedTree, remote: SyncedTree): SyncedTree {
  const folderMap = mergeKeyed(byId(base.folders), byId(local.folders), byId(remote.folders));
  // A folder whose parent no longer exists moves to the top level rather than vanishing.
  const folders = Object.values(folderMap).map((f) => (f.parentId && !folderMap[f.parentId] ? { ...f, parentId: null } : f));
  const docParents = mergeKeyed(base.docParents, local.docParents, remote.docParents);
  // A note filed in a folder that no longer exists goes to the top level.
  for (const [doc, folder] of Object.entries(docParents)) if (!folderMap[folder]) delete docParents[doc];
  const docOrder = mergeKeyed(base.docOrder, local.docOrder, remote.docOrder);
  for (const key of Object.keys(docOrder)) if (key !== "root" && !folderMap[key]) delete docOrder[key];
  return { folders, docParents, docOrder };
}
