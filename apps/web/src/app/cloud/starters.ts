import { DEFAULT_CONTENT } from "@/constants";
import { STARTER_DOCUMENTS } from "@/data/starter-documents";

/**
 * The notes a first visit seeds (the welcome note, Getting started, the
 * Changelog), recognised in a library so they are not uploaded a second time.
 *
 * Signed-out visitors use the editor straight away, so every new browser seeds
 * its own copies before anyone signs in. Signing in there with an account that
 * already has notes would otherwise add another Welcome, Getting started and
 * Changelog to the account from every device. Pure, unit-tested
 * (cloud-starters.test.js).
 */

const firstHeading = (markdown: string) => /^#\s+(.+?)\s*$/m.exec(markdown)?.[1] ?? null;

/** The welcome note's title. It is always the first note a library gets. */
const WELCOME_TITLE = firstHeading(DEFAULT_CONTENT);

/** The titles the seeded notes get: their first heading. */
export const STARTER_TITLES: ReadonlySet<string> = new Set(
  [DEFAULT_CONTENT, ...STARTER_DOCUMENTS.map((d) => d.markdown)].map(firstHeading).filter((t): t is string => !!t),
);

/** The folders the seeded notes are filed under ("Guides"). */
export const STARTER_FOLDERS: ReadonlySet<string> = new Set(STARTER_DOCUMENTS.flatMap((d) => d.folderPath));

/** Seeding writes every note within a second or two of the first one. */
const SEED_WINDOW_MS = 30_000;
/** A note nobody touched keeps the `updated` it was written with. */
const UNCHANGED_MS = 5_000;

export interface DocTimes {
  id: string;
  title: string;
  created: string;
  updated: string;
}

const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
};

/**
 * The ids of the notes that are still exactly as a first visit seeded them: a
 * starter title, created together with the welcome note that opened the
 * library, and never changed since. A note the visitor wrote, imported or
 * edited is never one. When the library's first note is not the welcome note
 * (it was deleted), nothing is recognised: keeping a copy too many is the safe
 * side, removing a visitor's note is not.
 */
export function untouchedStarterIds(docs: readonly DocTimes[]): Set<string> {
  const ids = new Set<string>();
  const dated = docs.filter((d) => Number.isFinite(time(d.created)));
  if (dated.length === 0) return ids;
  const first = dated.reduce((a, b) => (time(b.created) < time(a.created) ? b : a));
  if (first.title !== WELCOME_TITLE) return ids;
  const firstCreated = time(first.created);
  for (const d of docs) {
    const created = time(d.created);
    const updated = time(d.updated);
    if (!STARTER_TITLES.has(d.title) || !Number.isFinite(created) || !Number.isFinite(updated)) continue;
    if (created - firstCreated <= SEED_WINDOW_MS && updated - created <= UNCHANGED_MS) ids.add(d.id);
  }
  return ids;
}

interface StoredTree {
  folders?: unknown;
  docParents?: unknown;
  docOrder?: unknown;
  [k: string]: unknown;
}

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The stored folder tree without the removed notes, and without a starter
 * folder ("Guides") that is left empty by it. Anything the visitor put in a
 * folder keeps the folder.
 */
export function withoutNotes(raw: unknown, removed: ReadonlySet<string>): unknown {
  if (!isMap(raw)) return raw;
  const tree = raw as StoredTree;
  const docParents = isMap(tree.docParents)
    ? Object.fromEntries(Object.entries(tree.docParents).filter(([id]) => !removed.has(id)))
    : tree.docParents;
  const docOrder = isMap(tree.docOrder)
    ? Object.fromEntries(
        Object.entries(tree.docOrder).map(([k, v]) => [k, Array.isArray(v) ? v.filter((id) => !removed.has(id as string)) : v]),
      )
    : tree.docOrder;
  const folders = Array.isArray(tree.folders) ? (tree.folders as unknown[]) : null;
  if (!folders) return { ...tree, docParents, docOrder };
  const used = new Set(Object.values(isMap(docParents) ? docParents : {}));
  const parents = new Set(folders.map((f) => (isMap(f) ? f["parentId"] : null)).filter(Boolean));
  const kept = folders.filter((f) => {
    if (!isMap(f)) return true;
    const emptyStarter = typeof f["name"] === "string" && STARTER_FOLDERS.has(f["name"]) && !used.has(f["id"] as string) && !parents.has(f["id"]);
    return !emptyStarter;
  });
  return { ...tree, folders: kept, docParents, docOrder };
}
