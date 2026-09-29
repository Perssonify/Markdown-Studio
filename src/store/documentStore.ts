/**
 * documentStore — Zustand store replacing the useDocumentStore hook.
 *
 * All document state (list, active doc, tabs, save status, counts, fidelity)
 * and CRUD operations live here. Components subscribe directly with no prop drilling.
 */

import { create } from "zustand";
import {
  computeCounts,
  createDocument,
  resolveDocTitle,
  syncFieldsToMetadata,
  type DocumentRecord,
  type DocumentSummary,
} from "./document";
import { computeFidelity, computeCanonicalStats, type FidelityReport } from "./fidelity";
import type { IngestFormat, IngestSource } from "./ingest";
import { completeIngest, ingest } from "./ingest";
import {
  StorageQuotaError,
  StorageReadError,
  createStorageAdapter,
  hasMetrics,
  IndexedDBStorageAdapter,
  type StorageAdapter,
  type IDBStorageConfig,
} from "./storage-adapter";
import type { StorageMetrics } from "./idb-storage-adapter";
import { snapshotStore } from "./snapshot-store";
import { takeStashed, type RecoveryEntry } from "./crash-recovery";

/**
 * A canonical doc is "blank" when it holds no real content — an empty/absent
 * content array, or a single empty paragraph (ProseMirror's default empty doc).
 * Used as a data-loss backstop: we never let a blank canonical overwrite a
 * stored document that has real content (that only happens by accident — a
 * stale/empty editor projected over the doc — and it was unrecoverable). A
 * genuine "start over" is deleting the doc, not silently persisting blankness.
 */
export function isBlankCanonical(c: any): boolean {
  if (!c || !Array.isArray(c.content) || c.content.length === 0) return true;
  if (c.content.length === 1) {
    const n = c.content[0];
    return !!n && n.type === "paragraph" && (!n.content || n.content.length === 0);
  }
  return false;
}

/**
 * How far the stored `updated` may run ahead of the revision this tab's content
 * is based on before it counts as ANOTHER tab's write. Absorbs same-tab stamp
 * wobble from adapters stamping `updated` on save.
 */
export const CONFLICT_TOLERANCE_MS = 2000;

/** True when `storedUpdated` is meaningfully newer than `baseUpdated` — i.e.
 *  somebody else wrote the record after the revision this content came from. */
export function isNewerThanBase(
  storedUpdated: string | null | undefined,
  baseUpdated: string | null | undefined
): boolean {
  if (!storedUpdated || !baseUpdated) return false;
  const drift = new Date(storedUpdated).getTime() - new Date(baseUpdated).getTime();
  return drift > CONFLICT_TOLERANCE_MS;
}

/** The saveError a document gets while it is locked read-only because its
 *  content does not fit this build (see schema-version.ts). */
export const SCHEMA_LOCK_ERROR = "Made by a newer version of the app — open read-only, not saving";

/** The message a refused multi-tab write carries (the UI matches on its start). */
export const CONFLICT_MESSAGE =
  "This document was changed in another tab or window. To avoid overwriting that work, this tab won't save — copy any changes you need, then reload.";

/** A write refused because another tab wrote the record after the revision
 *  this tab's content is based on. Carries CONFLICT_MESSAGE. */
export class ConflictError extends Error {
  constructor() {
    super(CONFLICT_MESSAGE);
    this.name = "ConflictError";
  }
}

/**
 * What an explicit save should tell the user when `saveActiveDoc` resolved
 * WITHOUT committing. ⌘S used to say "Changes saved" (and fire the host's
 * onSave) for every resolution — a refused blank write, a save aborted by a
 * document switch, a swallowed write error — none of which put anything on disk.
 */
export function describeUncommittedSave(
  s: Pick<DocumentState, "saveStatus" | "saveError">
): { message: string; type: "warning" | "error" } {
  switch (s.saveStatus) {
    case "blocked":
      return {
        message: "Not saved — the editor is empty but the stored document is not. Undo to restore it, or use Clear document if you meant to empty it.",
        type: "warning",
      };
    case "conflict":
      return { message: CONFLICT_MESSAGE, type: "warning" };
    case "full":
      return { message: "Not saved — storage is full. Delete documents or old versions to free space.", type: "error" };
    case "error":
      return { message: s.saveError ? `Save failed — ${s.saveError}` : "Save failed", type: "error" };
    default:
      // An ownership abort: the document changed under the save.
      return { message: "Save did not complete — try again", type: "warning" };
  }
}

/**
 * What the unload handler stashes (see crash-recovery.ts), as a pure function
 * of the store state and the live editor canonical, so the exact set a reload
 * will adopt can be tested without a page to unload.
 *
 * Every entry carries the revision it was written against (`base`). The active
 * document's is `activeDoc.updated` — the revision the editor content is based
 * on, which a refused conflict never advanced — and a parked draft's is its
 * `_draftBases` entry. `live` must already be the canonical of the document the
 * editor HOLDS (the caller checks `hydratedDocId`); a blank one is never
 * stashed, and a blank parked draft only when the stored copy is blank too.
 */
export function collectUnloadStash(
  s: Pick<
    DocumentState,
    "activeDocId" | "hydratedDocId" | "activeDoc" | "saveStatus" | "_unsavedEdits" | "_draftBases" | "documents"
  >,
  live: DocumentRecord["canonical"] | null,
  at: number
): RecoveryEntry[] {
  const stash: RecoveryEntry[] = [];
  const owns = !!s.activeDocId && s.hydratedDocId === s.activeDocId;
  if (s.activeDocId && owns && live && !isBlankCanonical(live)) {
    stash.push({
      docId: s.activeDocId,
      canonical: live,
      at,
      base: s.activeDoc?.id === s.activeDocId ? s.activeDoc.updated : undefined,
      ...(s.saveStatus === "conflict" ? { conflict: true } : {}),
    });
  }
  for (const [docId, canonical] of s._unsavedEdits) {
    if (docId === s.activeDocId) continue;
    // Honour the blank-over-content backstop here too. `patchDocById` has no
    // such guard (a host clearing a document through the bridge is a
    // legitimate write), so a blank canonical that `saveActiveDoc` had
    // deliberately REFUSED — parking a terminal "blocked" status — was cached
    // as that document's draft and then written to disk anyway on tab close,
    // with no pre-clear snapshot to recover from.
    if (isBlankCanonical(canonical)) {
      const stored = s.documents.find((d) => d.id === docId);
      // `documents` carries list summaries; a non-zero word count is proof
      // the stored document is not itself blank.
      if (!stored || (stored.wordCount ?? 0) > 0) continue;
    }
    stash.push({ docId, canonical, at, base: s._draftBases.get(docId) });
  }
  return stash;
}

//  Public types

export interface OpenTab {
  id: string;
  title: string;
}

export interface DocumentCounts {
  words: number;
  chars: number;
}

// "blocked" is a TERMINAL status: the last save was intentionally refused to
// prevent data loss (a blank editor over a stored non-empty doc). Unlike "error"
// it must NOT re-arm autosave (that would loop forever); a later real edit moves
// it back to "editing" and normal saving resumes.
// "conflict" is likewise TERMINAL: another tab/window wrote a newer version of
// the active doc, so this tab refused to save (last-writer-wins would clobber
// that tab's work). It must NOT re-arm autosave either (the conflict would just
// re-fire); a later real edit resumes saving (the user chose to keep editing).
// "full" is TERMINAL too: storage is out of room. Re-arming autosave against a
// full store just failed again every few seconds — the status bar read "Save
// failed — retrying" forever, with nothing telling the user what would help.
// Freeing space (a delete, erasing history or local data) or a real edit
// retries.
export type SaveStatus = "ready" | "editing" | "saving" | "saved" | "error" | "blocked" | "conflict" | "full";

export interface DocumentWithIngestHtml extends DocumentRecord {
  _ingestHtml: string;
}

export interface TiptapEditorLike {
  getJSON(): DocumentRecord["canonical"];
}

export interface MarkdownEngine {
  mdToHtml: (md: string) => string;
}

//  Store shape 

interface DocumentState {
  // Reactive state
  documents: DocumentSummary[];
  activeDoc: DocumentRecord | null;
  activeDocId: string | null;
  openTabs: OpenTab[];
  saveStatus: SaveStatus;
  /** Why saving last failed, or null when the last attempt succeeded.
   *  saveStatus alone is not enough to SHOW a failure: a failed autosave is
   *  routed error → editing after 3s so the retry effect re-arms, so for most
   *  of each retry cycle the status bar said "Unsaved changes" and nothing
   *  about the failure. This outlives the transition. */
  saveError: string | null;
  fidelityReport: FidelityReport | null;
  counts: DocumentCounts;
  storageMetrics: StorageMetrics | null;

  // Non-reactive internals (set once, never trigger re-renders)
  _engine: MarkdownEngine | null;
  _syncMode: string;
  _unsavedEdits: Map<string, DocumentRecord["canonical"]>; // In-memory cache for unsaved edits
  /**
   * For each cached draft, the `updated` stamp of the stored revision that
   * draft was written ON TOP OF — its provenance, not the latest one on disk.
   *
   * Without it the multi-tab conflict guard could be laundered by an ordinary
   * navigation: `switchToDoc` re-reads the record (carrying ANOTHER tab's
   * newer `updated`) and grafts the cached draft onto it, so the drift the
   * guard measures collapses to zero and the very write it had already refused
   * goes through on the next save. Detected once, then forgotten by switching
   * away and back.
   */
  _draftBases: Map<string, string>;

  /**
   * Which document's content the live TipTap editor currently holds, or null
   * when the editor has not been hydrated for the active document yet (during
   * init, right after a switch, etc.). saveActiveDoc REFUSES to write when this
   * doesn't match activeDocId — the single chokepoint that prevents saving one
   * document's content into another (or persisting an empty, un-hydrated
   * editor over real content).
   */
  hydratedDocId: string | null;
  /** Mark which document the editor holds. Refused (left null) for a document
   *  locked by `markIncompatible` — the editor only holds a display copy. */
  markHydrated: (docId: string | null) => void;

  /**
   * A document whose stored content does not fit the live editor schema, or
   * claims a newer schema version (see schema-version.ts). The editor shows a
   * best-effort READ-ONLY copy, so the document is never marked hydrated and
   * saveActiveDoc refuses it; renames and metadata changes keep the stored
   * content. Cleared when the document is next hydrated with content that fits.
   */
  schemaLock: { docId: string; reason: string } | null;
  markIncompatible: (docId: string, reason: string) => void;
  clearIncompatible: (docId: string) => void;
  isIncompatible: (docId: string) => boolean;

  /**
   * Register a getter that returns the LIVE TipTap editor's canonical for a
   * given docId (or null when the editor doesn't currently hold that doc's
   * content). The store's non-editor persist paths (renameDoc, patchDocById)
   * use it so a metadata-only change to the ACTIVE doc merges onto the live
   * editor content instead of the on-disk copy — which lags the editor by up
   * to one autosave interval. Without this, renaming a doc with unsaved edits
   * silently rewound those edits (a data-loss class outside the user's
   * control). PE registers this once on mount.
   */
  registerLiveCanonical: (
    fn: ((docId: string) => DocumentRecord["canonical"] | null) | null
  ) => void;

  // Actions
  setEngine: (engine: MarkdownEngine | null) => void;
  setSyncModeInternal: (mode: string) => void;
  getStorage: () => StorageAdapter;
  /**
   * Inject a custom StorageAdapter (or config for the built-in IDB adapter).
   * Must be called before initialize(). The editor calls this when a
   * storageAdapter or storageConfig prop is provided.
   */
  initStorage: (adapterOrConfig: StorageAdapter | IDBStorageConfig) => void;

  initialize: () => Promise<DocumentRecord | null>;
  createDoc: (
    raw: string,
    format: IngestFormat,
    source: IngestSource,
    opts?: Parameters<typeof ingest>[3]
  ) => DocumentWithIngestHtml | null;
  finalizeDoc: (doc: DocumentRecord, tiptapEditor: TiptapEditorLike | null, skipPersist?: boolean) => Promise<DocumentRecord>;
  /**
   * Persist a NEW document without activating it (import). Unlike finalizeDoc
   * it leaves the open document, the editor and the switch sequence alone, so
   * a long import never pulls the store off whatever the user opens meanwhile.
   */
  saveNewDoc: (doc: DocumentRecord) => Promise<void>;
  /**
   * Persist the live editor's content for the active document. Resolves
   * `true` ONLY when the write committed. Resolution is not a commit: the
   * blank-over-content refusal, an ownership abort (a switch or delete landed
   * during the pre-save read) and a caught non-quota write error all resolve
   * `false` — callers that report success (⌘S, a host's onSave) must check.
   * A multi-tab conflict and a quota error reject.
   */
  saveActiveDoc: (tiptapEditor: TiptapEditorLike | null) => Promise<boolean>;
  setDirty: () => void;
  /** Permit the NEXT save to persist a blank canonical over a non-empty stored
   *  doc (one-shot). Used only by the explicit "Clear document" command so the
   *  data-loss backstop doesn't block a deliberate clear. */
  allowBlankSaveOnce: () => void;
  /** Space was freed (a delete, erased history): a save parked on "full" may
   *  succeed now, so resume autosave. A no-op in any other status. */
  storageFreed: () => void;
  revertActiveDoc: () => Promise<DocumentRecord | null>;
  switchToDoc: (docId: string, tiptapEditor: TiptapEditorLike | null) => Promise<DocumentRecord | null>;
  closeTab: (docId: string, tiptapEditor: TiptapEditorLike | null) => Promise<DocumentRecord | null>;
  deleteDoc: (docId: string, tiptapEditor: TiptapEditorLike | null) => Promise<DocumentRecord | null>;
  renameDoc: (docId: string, newTitle: string) => Promise<void>;
  /** Patch an arbitrary document by id (may be non-active) and persist, without
   *  changing the active doc/editor. Used by the host bridge's updateDocument /
   *  appendToDocument so a host can edit a node's doc without churning the view. */
  patchDocById: (
    docId: string,
    patch: {
      canonical?: DocumentRecord["canonical"];
      title?: string;
      userTitle?: string | null;
      /** Shallow-merged into the record's metadata (used by the Cards view for
       *  per-doc presentation state: colour, pinned). */
      metadata?: Record<string, unknown>;
      /** Presentation-only patches (pin/colour) pass false so re-ordering by
       *  "recently edited" isn't disturbed by a non-edit. Defaults to true.
       *  `false` applies `metadata` ONLY, onto the freshest stored record —
       *  any canonical/title in the same patch is ignored. */
      touchUpdated?: boolean;
      /** The `updated` of the copy this patch's content was derived from (a
       *  card loaded earlier, say). A newer stored revision is another tab's
       *  write: a content patch is then refused with a ConflictError. The open
       *  document and a parked draft carry their own base automatically. */
      expectedUpdated?: string | null;
    }
  ) => Promise<DocumentRecord | null>;
  /** Duplicate `docId`, or the active document when omitted. */
  duplicateDoc: (docId?: string) => Promise<DocumentRecord | undefined>;
  updateFidelity: (canonical: DocumentRecord["canonical"]) => FidelityReport;
  updateCounts: (canonical: DocumentRecord["canonical"] | null) => void;
  /** Fidelity + counts from a single walk, publishing only what changed. */
  updateDerived: (canonical: DocumentRecord["canonical"] | null) => FidelityReport;
  getDocById: (id: string) => Promise<DocumentRecord | null>;
  getStorageMetrics: () => StorageMetrics | null;
  cacheUnsavedEdit: (docId: string, canonical: DocumentRecord["canonical"]) => void;
  clearUnsavedEdit: (docId: string) => void;
  getUnsavedEdit: (docId: string) => DocumentRecord["canonical"] | undefined;

  /**
   * Read-only snapshot of the document-lifecycle flags as ONE object — the safe,
   * low-risk slice of the "explicit state machine" idea (see docs/backlog.md).
   * Purely observational (no write path touched): for debugging and a future
   * `diag.*` console tab. `hydrated` is the derived invariant the save-path
   * chokepoint enforces (`hydratedDocId === activeDocId`).
   */
  getLifecycleState: () => {
    activeDocId: string | null;
    hydratedDocId: string | null;
    hydrated: boolean;
    saveStatus: SaveStatus;
    hasActiveDoc: boolean;
    unsavedDraftCount: number;
    docCount: number;
  };
}

// ─── Module-level singletons (not reactive) ──────────────────────────────────

let storage: StorageAdapter = createStorageAdapter();
let initialized = false;
// One-shot permission for the next save to persist a blank canonical over a
// non-empty stored doc (set by the explicit "Clear document" command). Module
// scope keeps it out of the reactive store state.
//
// Bound to the DOCUMENT it was granted for. Unbound, a permission granted by a
// clear whose save never happened (the user discarded on close, or deleted the
// doc, or the save aborted at a guard) stayed armed indefinitely, and the next
// save of ANY document consumed it — silently disarming the blank-over-content
// backstop exactly once, for a document nobody had cleared.
let blankSaveAllowedFor: string | null = null;

// Documents whose delete is in flight. `deleteDoc` awaits a snapshot, the
// delete itself and a re-list before `closeTab` finally clears activeDocId /
// hydratedDocId — a window in which a concurrently running `saveActiveDoc`
// still passes its hydration chokepoint and writes the record straight back,
// resurrecting a document the user just deleted. Consulted by the save path.
const deletingDocs = new Set<string>();

// Documents locked read-only because their content does not fit this build
// (see `schemaLock`). Module scope, like `deletingDocs`: the save path consults
// it synchronously.
const incompatibleDocs = new Map<string, string>();

// Getter for the LIVE editor canonical of a doc (registered by PE). Returns the
// current TipTap JSON when the editor holds that doc's content, else null. Kept
// at module scope so non-editor persist paths (renameDoc/patchDocById) can reach
// the freshest content without threading the editor ref through every caller.
let liveCanonicalProvider:
  | ((docId: string) => DocumentRecord["canonical"] | null)
  | null = null;

// Monotonic sequence for switchToDoc calls. switchToDoc is async (awaits
// storage.get) and mutates activeDocId both optimistically AND at completion; if
// a newer switch supersedes an older one whose storage read is still in flight,
// the older completion must NOT clobber the newer switch's activeDocId. Each call
// captures its sequence and only applies its completion/revert when still current.
// (The hook's switchGenRef guards the EDITOR hydration; this guards the STORE's
// activeDocId — both are needed, and out-of-order storage completion otherwise
// left activeDocId and hydratedDocId pointing at different docs = save-blocked +
// cross-doc draft contamination.)
let switchSeq = 0;

/**
 * The freshest canonical for `docId` from the live editor, or null when the
 * editor doesn't hold it. Never returns a BLANK canonical: injecting blankness
 * into a rename/patch is the job of the explicit-clear + blank backstop, not an
 * incidental metadata change — so a rename can never wipe content even if the
 * live editor is momentarily empty.
 */
function liveCanonicalFor(docId: string): DocumentRecord["canonical"] | null {
  try {
    const live = liveCanonicalProvider?.(docId) ?? null;
    if (live && !isBlankCanonical(live)) return live;
  } catch (e) {
    console.warn("[documentStore] liveCanonicalProvider threw:", e);
  }
  return null;
}

/**
 * The revision THIS tab's copy of `docId` is based on — what a write must not
 * overwrite a newer version of. For the open document that is
 * `activeDoc.updated` (the same base saveActiveDoc checks); for a background
 * document it is its parked draft's base, if any. `extra` is a caller's own
 * provenance (a card loaded earlier); the OLDEST candidate wins. Null means the
 * tab holds no copy of its own, so there is nothing to conflict with.
 */
function baseRevisionFor(docId: string, extra?: string | null): string | null {
  const s = useDocumentStore.getState();
  const own = s.activeDoc?.id === docId ? s.activeDoc.updated : s._draftBases.get(docId);
  const candidates = [own, extra].filter((v): v is string => !!v);
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
}

/**
 * Apply a title/metadata patch to the STORED record of a document another tab
 * has overtaken, leaving this tab's content and its base untouched (see
 * renameDoc for why both matter).
 */
async function applyTitleOnly(
  set: (partial: Partial<DocumentState> | ((s: DocumentState) => Partial<DocumentState>)) => void,
  get: () => DocumentState,
  docId: string,
  stored: DocumentRecord,
  patch: { title?: string; userTitle?: string | null; metadata?: Record<string, unknown> }
): Promise<DocumentRecord> {
  if (patch.userTitle !== undefined) {
    stored.userTitle = patch.userTitle;
    stored.titlePinnedByUser = patch.userTitle != null;
  }
  if (patch.title !== undefined) stored.title = patch.title;
  stored.updated = new Date().toISOString();
  syncFieldsToMetadata(stored);
  if (patch.metadata) stored.metadata = { ...stored.metadata, ...patch.metadata };
  await storage.save(stored);
  const list = await storage.list();
  set((s) => ({
    documents: list,
    openTabs: s.openTabs.map((t) => (t.id === docId ? { ...t, title: stored.title } : t)),
    activeDoc:
      s.activeDoc?.id === docId
        ? {
            ...s.activeDoc,
            title: stored.title,
            userTitle: stored.userTitle,
            titlePinnedByUser: stored.titlePinnedByUser,
            ...(patch.metadata ? { metadata: { ...s.activeDoc.metadata, ...patch.metadata } } : {}),
          }
        : s.activeDoc,
  }));
  refreshMetrics(set, get);
  return stored;
}

// ─── Metrics refresh helper ───────────────────────────────────────────────────

export function sameMetrics(a: StorageMetrics | null, b: StorageMetrics | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.usedBytes === b.usedBytes &&
    a.maxBytes === b.maxBytes &&
    a.pct === b.pct &&
    a.docCount === b.docCount &&
    a.available === b.available &&
    a.limitKnown === b.limitKnown
  );
}

/**
 * Value equality for two fidelity reports.
 *
 * `computeFidelity` builds a fresh report on every projection, so publishing it
 * unconditionally gave every subscriber a new reference per keystroke-batch.
 * The overwhelmingly common case — a lossless document — settles in the first
 * comparison; a lossy one compares a handful of buckets.
 */
export function sameFidelity(a: FidelityReport | null, b: FidelityReport | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    a.lossless !== b.lossless ||
    a.totalLossCount !== b.totalLossCount ||
    a.summary !== b.summary ||
    a.losses.length !== b.losses.length
  ) return false;
  for (let i = 0; i < a.losses.length; i++) {
    const x = a.losses[i]!;
    const y = b.losses[i]!;
    if (
      x.kind !== y.kind || x.type !== y.type || x.node !== y.node ||
      x.attr !== y.attr || x.count !== y.count || x.value !== y.value
    ) return false;
    if (x.attrs !== y.attrs && JSON.stringify(x.attrs) !== JSON.stringify(y.attrs)) return false;
  }
  return true;
}

/**
 * Recompute storage metrics, but only push a NEW object into the store when a
 * value actually changed. `storage.getMetrics()` returns a fresh object every
 * call, so setting it unconditionally on every save/patch/delete/rename churned
 * a new reference through Zustand and re-rendered every `storageMetrics`
 * subscriber (the status bar) even when nothing moved. The value-equality guard
 * keeps the reference stable across no-op refreshes.
 */
function refreshMetrics(
  set: (partial: Partial<DocumentState>) => void,
  get: () => DocumentState
): void {
  if (hasMetrics(storage)) {
    const next = storage.getMetrics();
    if (!sameMetrics(get().storageMetrics, next)) {
      set({ storageMetrics: next });
    }
  }
}

// ─── Store ───────────────────────────────────────────────────────────────────

/**
 * Pending "saved → ready" reset timer. Kept at module scope so it can be
 * cancelled: without this, a save arms a 2s timer that would later force
 * saveStatus back to "ready" even if the user edited in the meantime —
 * clobbering the dirty flag and letting a tab close without the unsaved-changes
 * prompt (silent data loss).
 */
let readyResetTimer: ReturnType<typeof setTimeout> | null = null;
function cancelReadyReset() {
  if (readyResetTimer) {
    clearTimeout(readyResetTimer);
    readyResetTimer = null;
  }
}
function scheduleReadyReset(
  set: (fn: (s: DocumentState) => Partial<DocumentState>) => void,
  from: SaveStatus,
  delay: number,
  to: SaveStatus = "ready"
) {
  cancelReadyReset();
  readyResetTimer = setTimeout(() => {
    readyResetTimer = null;
    // Only downgrade the specific transient status we set; never overwrite a
    // status the user's activity has since moved to (editing/saving/error).
    set((s) => (s.saveStatus === from ? { saveStatus: to } : {}));
  }, delay);
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  activeDoc: null,
  activeDocId: null,
  openTabs: [],
  saveStatus: "ready",
  saveError: null,
  fidelityReport: null,
  counts: { words: 0, chars: 0 },
  storageMetrics: null,

  _engine: null,
  _syncMode: "clean",
  _unsavedEdits: new Map(),
  _draftBases: new Map(),
  hydratedDocId: null,
  markHydrated: (docId) => set({ hydratedDocId: docId && incompatibleDocs.has(docId) ? null : docId }),
  schemaLock: null,
  markIncompatible: (docId, reason) => {
    incompatibleDocs.set(docId, reason);
    set((s) => ({
      schemaLock: { docId, reason },
      hydratedDocId: s.hydratedDocId === docId ? null : s.hydratedDocId,
    }));
  },
  clearIncompatible: (docId) => {
    if (!incompatibleDocs.delete(docId)) return;
    set((s) => (s.schemaLock?.docId === docId ? { schemaLock: null } : {}));
  },
  isIncompatible: (docId) => incompatibleDocs.has(docId),
  registerLiveCanonical: (fn) => { liveCanonicalProvider = fn; },

  setEngine: (engine) => set({ _engine: engine }),
  setSyncModeInternal: (mode) => set({ _syncMode: mode }),
  getStorage: () => storage,

  initStorage: (adapterOrConfig) => {
    if (initialized) {
      console.warn("[documentStore] initStorage() called after initialize() — adapter swap ignored.");
      return;
    }
    // If it looks like a StorageAdapter (has list/get/save methods), use it directly.
    // Otherwise treat it as an IDBStorageConfig and create an IDB adapter.
    if (
      typeof (adapterOrConfig as StorageAdapter).list === "function" &&
      typeof (adapterOrConfig as StorageAdapter).get === "function"
    ) {
      storage = adapterOrConfig as StorageAdapter;
    } else {
      storage = new IndexedDBStorageAdapter(adapterOrConfig as IDBStorageConfig);
    }
  },

  // ── Initialize ─────────────────────────────────────────────────────────────
  initialize: async () => {
    // A SECOND call is a remount — a host unmounting the editor and mounting
    // it again. This store is a module singleton and survives the unmount, but
    // the new editor instance starts EMPTY. This used to return null: the
    // editor then seeded `initialDocument` again (one more copy per remount),
    // or, with no seed, kept saying document X was active AND hydrated over an
    // empty editor, so the first keystroke saved over X. A remount now
    // re-activates the current document, UNHYDRATED, for the new editor to
    // hydrate exactly as a fresh boot does. (The unload stash is one-shot per
    // page load and is not taken again.)
    const firstBoot = !initialized;
    initialized = true;

    const list = await storage.list();
    set({ documents: list });

    // Adopt anything the last unload stashed. IndexedDB cannot be awaited while
    // a page is being torn down, so edits typed inside the autosave window are
    // written synchronously to localStorage instead (see crash-recovery.ts) and
    // picked up here — BEFORE any document is activated, so the ordinary
    // cached-draft path below treats them exactly like an unsaved edit parked
    // by a document switch. Only for documents that still exist.
    // Only for documents that still exist, and only when the stash is NEWER
    // than what is on disk. `pagehide` also writes it, and that fires on a
    // bfcache navigation the page can come back from — so a stash can outlive
    // saves that happened after it was written, and adopting one then would
    // restore older content over newer as a "draft".
    const storedAt = new Map(list.map((d) => [d.id, Date.parse(d.updated) || 0]));
    const titleOf = new Map(list.map((d) => [d.id, d.title]));
    for (const entry of firstBoot ? takeStashed() : []) {
      if (!storedAt.has(entry.docId)) continue;
      if (entry.at <= (storedAt.get(entry.docId) ?? 0)) {
        // Older than disk. A stash that was already in CONFLICT when it was
        // written is the one version of that text that exists anywhere: the
        // tab had refused to save it. Keep it recoverable in Version history
        // rather than dropping it on the floor. Best effort, never awaited.
        if (entry.conflict) {
          void snapshotStore
            .record(entry.docId, titleOf.get(entry.docId) ?? "Untitled", entry.canonical, "autosave")
            ?.catch?.(() => {});
        }
        continue;
      }
      get().cacheUnsavedEdit(entry.docId, entry.canonical as DocumentRecord["canonical"]);
      // Restore the revision the draft was written against. Adopting it
      // WITHOUT its base let `activate` below take `updated` from the record
      // now on disk — another tab's — so the multi-tab guard saw zero drift and
      // the first autosave silently replaced that tab's work.
      if (entry.base) get()._draftBases.set(entry.docId, entry.base);
    }

    const prefs = await storage.getPrefs();
    const lastDocId = prefs["lastActiveDocId"] as string | undefined;
    // On a remount, the document that was open stays the one that opens.
    const current = firstBoot ? null : get().activeDocId;

    // Activating a document at boot must honour a recovered draft the same way
    // switchToDoc does, or the stash above would be adopted and then ignored.
    const activate = (doc: DocumentRecord): DocumentRecord => {
      const draft = get().getUnsavedEdit(doc.id);
      const canonical = draft ?? doc.canonical;
      // A recovered draft keeps its OWN provenance (see switchToDoc): the
      // record's `updated` may be another tab's write.
      const draftBase = draft ? get()._draftBases.get(doc.id) : undefined;
      // Already known to conflict: saving could only be refused again, so say
      // so now instead of arming an autosave to discover it.
      const conflicted = !!draft && isNewerThanBase(doc.updated, draftBase);
      const record: DocumentRecord = draft
        ? ({
            ...doc,
            canonical,
            updated: draftBase ?? doc.updated,
            _persistedCanonical: doc.canonical,
          } as DocumentRecord)
        : doc;
      ++switchSeq; // an activation, like finalizeDoc — see there
      set({
        activeDoc: record,
        activeDocId: doc.id,
        // Nothing is in the editor yet — the caller hydrates it.
        hydratedDocId: null,
        openTabs: [{ id: doc.id, title: doc.title }],
        counts: computeCounts(canonical),
        saveStatus: conflicted ? "conflict" : draft ? "editing" : "ready",
        saveError: conflicted ? "Changed in another tab" : null,
      });
      return record;
    };

    // The last-open document first, then the library in order. A document that
    // cannot be READ is skipped rather than taking the whole boot down with it;
    // if none can be read, the failure is reported (an empty result would read
    // as "no documents yet").
    const candidates = [...new Set([
      ...(current && list.some((d) => d.id === current) ? [current] : []),
      ...(lastDocId && list.some((d) => d.id === lastDocId) ? [lastDocId] : []),
      ...list.map((d) => d.id),
    ])];
    let readError: unknown = null;
    for (const id of candidates) {
      try {
        const doc = await storage.get(id);
        if (doc) return activate(doc);
      } catch (e) {
        console.warn(`[documentStore] Could not open ${id} at startup:`, e);
        readError ??= e;
      }
    }
    if (readError) throw readError;

    // Nothing to open. On a remount, whatever the store still claimed is stale.
    if (!firstBoot) {
      set({ activeDoc: null, activeDocId: null, hydratedDocId: null, openTabs: [], saveStatus: "ready", saveError: null });
    }
    return null;
  },

  // ── Create ─────────────────────────────────────────────────────────────────
  createDoc: (raw, format, source, opts = {}) => {
    // Use the engine already registered in the store, or fall back to whatever
    // mdToHtml was supplied via opts (callers that have a fresh engine reference
    // can pass it explicitly to avoid the useEffect timing gap).
    const storeEngine = get()._engine;
    const mdToHtml = opts.mdToHtml ?? storeEngine?.mdToHtml;
    if (!mdToHtml) return null;

    const result = ingest(raw, format, source, { ...opts, mdToHtml });
    const doc = result.doc as DocumentWithIngestHtml;
    doc._ingestHtml = result.html ?? "";

    // Importing a previously-exported .json embeds the original doc id. If that
    // id still exists in the library, keep BOTH: mint a fresh id for the import
    // instead of silently overwriting the (possibly newer) stored document.
    if (source === "file-import") {
      const collision = get().documents.some((d) => d.id === doc.id);
      if (collision) {
        doc.id = typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `doc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }
    }
    return doc;
  },

  // ── Finalize ───────────────────────────────────────────────────────────────
  finalizeDoc: async (doc, tiptapEditor, skipPersist = false) => {
    if (!doc) return doc;

    // completeIngest is a no-op when tiptapEditor is null — that's fine here
    // because handleNewDoc calls finalizeDoc before the editor is mounted so
    // the store activates the doc (which causes EditorLayout to mount), and
    // then sets the HTML content once the editor is ready.
    completeIngest(doc, tiptapEditor);

    // Optimistically activate and open the tab before async storage write.
    // When an editor instance was provided, its content IS this doc's canonical
    // (completeIngest captured it) — mark hydrated; otherwise leave hydration
    // to whoever pushes content into the editor later.
    //
    // Claim the switch sequence: this is an activation, and a switchToDoc whose
    // storage read is still in flight must not settle on top of it. Without
    // the bump, New document during a slow switch left activeDocId on the
    // switch's target and hydratedDocId on the new document — every save
    // refused, and leaving the document cached nothing.
    ++switchSeq;
    set((s) => ({
      activeDoc: { ...doc },
      activeDocId: doc.id,
      ...(tiptapEditor ? { hydratedDocId: doc.id } : {}),
      counts: computeCounts(doc.canonical),
      openTabs: s.openTabs.some((t) => t.id === doc.id)
        ? s.openTabs.map((t) => (t.id === doc.id ? { ...t, title: doc.title } : t))
        : [...s.openTabs, { id: doc.id, title: doc.title }],
    }));

    if (!skipPersist) {
      try {
        await storage.save(doc);
        const list = await storage.list();
        // Adapters stamp doc.updated during save — sync it onto the (already
        // optimistically-set) activeDoc so later conflict checks don't misfire.
        set((s) => ({
          documents: list,
          activeDoc: s.activeDoc?.id === doc.id ? { ...s.activeDoc, updated: doc.updated } : s.activeDoc,
        }));
        refreshMetrics(set, get);
        storage.setPrefs({ lastActiveDocId: doc.id }).catch(() => {});
      } catch (e) {
        // Do NOT swallow: callers (imports, new-doc) were reporting success
        // for documents that never reached storage and vanished on reload.
        console.warn("[documentStore] finalizeDoc persist failed:", e);
        throw e;
      }
    }

    return doc;
  },

  saveNewDoc: async (doc) => {
    await storage.save(doc);
    const list = await storage.list();
    set({ documents: list });
    refreshMetrics(set, get);
  },

  // ── Save ───────────────────────────────────────────────────────────────────
  saveActiveDoc: async (tiptapEditor) => {
    const { activeDoc, hydratedDocId } = get();
    if (!activeDoc || !tiptapEditor) return false;

    // Locked read-only (content from a newer build): the editor holds a display
    // copy, and writing it would replace the real content with a lossy one.
    // TERMINAL like the blank backstop — retrying cannot help.
    if (incompatibleDocs.has(activeDoc.id)) {
      set({ saveStatus: "blocked", saveError: SCHEMA_LOCK_ERROR });
      return false;
    }

    // Data-integrity chokepoint: the editor's content must belong to the
    // active document. If a code path switched documents without hydrating
    // the editor, saving here would write doc A's content into doc B (or
    // persist an empty editor over real content). Refuse loudly instead.
    if (hydratedDocId !== activeDoc.id) {
      console.warn(
        `[documentStore] Save blocked: editor holds ${hydratedDocId ?? "no"} content but active doc is ${activeDoc.id}`
      );
      throw new Error("Save blocked: editor is not hydrated for the active document");
    }

    // Multi-tab guard: if storage holds a MEANINGFULLY newer version than the
    // one this tab loaded/last saved, another tab has written in between —
    // a blind write here would overwrite that tab's work (classic last-writer-
    // wins data loss). Refuse and tell the user. The 2s tolerance absorbs
    // same-tab timestamp wobble from adapters stamping `updated` on save.
    let stored: DocumentRecord | null | undefined;
    let storedReadFailed = false;
    let storedCorrupt = false;
    try {
      stored = await storage.get(activeDoc.id);
      if (isNewerThanBase(stored?.updated, activeDoc.updated)) {
        // Park a TERMINAL "conflict" status so the UI can surface it
        // persistently (the status bar) instead of it flickering through the
        // generic transient "error". Set before throwing so it survives the
        // caller's catch. A later real edit (setDirty → "editing") resumes.
        set({ saveStatus: "conflict", saveError: "Changed in another tab" });
        throw new ConflictError();
      }
    } catch (e) {
      if (e instanceof ConflictError) throw e;
      // The stored copy could not be read (adapters REJECT on a failed read;
      // null means absent — see StorageAdapter). Decided below, once we know
      // this save still owns the editor.
      storedReadFailed = true;
      storedCorrupt = e instanceof StorageReadError && e.corrupt;
      console.warn("[documentStore] Could not read the stored copy before saving:", e);
    }

    // Re-assert the hydration chokepoint AFTER the await: a doc switch or delete
    // may have landed during `await storage.get` above, re-hydrating the editor
    // with a DIFFERENT doc (or removing this one). The entry check at the top is
    // stale now. Without this, `tiptapEditor.getJSON()` below would read the new
    // doc's content and `storage.save` would write it into THIS (old) doc's
    // record — a cross-document overwrite — or resurrect a just-deleted doc. This
    // is the save-side analogue of the switchGenRef/switchSeq hydration guards.
    // Dropping the ≤one-interval of keystrokes typed during the read is safe:
    // setDirty re-arms the next autosave.
    {
      const s = get();
      if (s.activeDocId !== activeDoc.id || s.hydratedDocId !== activeDoc.id) {
        return false;
      }
      // A delete claimed this document while we were reading. `deleteDoc` only
      // clears activeDocId/hydratedDocId at the very end (via closeTab), so the
      // two checks above still pass mid-delete — and the write below would put
      // the record straight back after `storage.delete` removed it.
      if (deletingDocs.has(activeDoc.id)) return false;
    }

    // FAIL CLOSED on a storage that did not answer: it cannot prove there is no
    // newer version (another tab's) and no content to protect, so nothing is
    // written and autosave retries. A record that is present but CORRUPT is the
    // one exception — it cannot be anybody's readable work and the editor holds
    // the only good copy, so a non-blank save may repair it (the blank backstop
    // below still refuses a blank one).
    if (storedReadFailed && !storedCorrupt) {
      set({ saveStatus: "error", saveError: "Couldn't read the saved copy to check it is safe to overwrite" });
      scheduleReadyReset((fn) => set(fn), "error", 3000, "editing");
      return false;
    }

    set({ saveStatus: "saving" });
    try {
      const canonical = tiptapEditor.getJSON();

      // DATA-LOSS BACKSTOP: never let a BLANK editor overwrite a stored document
      // that has real content. A blank canonical over real content is never a
      // deliberate save — it's a stale/empty editor projected onto the doc (the
      // exact "my file got wiped and I can't get it back" failure). Refuse the
      // destructive write so the on-disk content survives and a reload recovers
      // it. The ONLY sanctioned blank persist is the explicit "Clear document"
      // command, which arms a one-shot permission FOR THAT DOCUMENT. Fail CLOSED when
      // the pre-save read failed (we can't prove the stored doc is empty).
      const blankOverContent = isBlankCanonical(canonical) &&
        (storedReadFailed || (!!stored && !isBlankCanonical(stored.canonical)));
      const blankAllowedHere = blankSaveAllowedFor === activeDoc.id;
      if (blankOverContent && !blankAllowedHere) {
        console.warn(
          `[documentStore] Save blocked: refusing to overwrite non-empty doc ${activeDoc.id} with a blank editor (data-loss guard).`
        );
        // TERMINAL status — "blocked" does NOT re-arm autosave (unlike "editing"/
        // "error"), so this can't spin the save loop. A later real edit sets
        // "editing" and normal saving resumes.
        set({ saveStatus: "blocked", saveError: "Refused to overwrite this document with an empty one" });
        return false;
      }
      // Consume the one-shot clear permission whether or not it was needed.
      if (blankAllowedHere) blankSaveAllowedFor = null;

      // RECOVERABLE SNAPSHOT NET: before this save overwrites the stored content,
      // capture the OLD version so any overwrite — including an explicit clear or
      // a bug we haven't found — stays recoverable after a reload. Throttled on
      // ordinary autosaves; a large shrink (the "got wiped" signature) always
      // snapshots. Fire-and-forget so it never blocks or fails the save.
      if (stored) {
        snapshotStore.maybeRecordOnSave(activeDoc.id, stored.title || activeDoc.title, stored.canonical, canonical);
      }

      // Re-read the FRESHEST active doc: a rename/patch (renameDoc / patchDocById)
      // may have landed on this same doc DURING the awaits above. Those paths
      // update the store's activeDoc (title / userTitle / titlePinnedByUser) but
      // this function captured `activeDoc` before its awaits. Building the record
      // from that stale snapshot would silently REVERT the rename and clear its
      // provenance pin (a real, if narrow, data-loss race). Merge title/metadata
      // from the current copy while still persisting the editor's live canonical.
      const current = get().activeDoc;
      const base = current && current.id === activeDoc.id ? current : activeDoc;
      const resolvedTitle = resolveDocTitle(base, canonical);
      const updatedDoc: DocumentRecord = {
        ...base,
        canonical,
        ...resolvedTitle,
        updated: new Date().toISOString(),
      };
      // The in-memory dirty-check baseline must never be persisted: it would
      // double the stored record size and, worse, remain the comparison
      // baseline after this save — making byte-identical content register as
      // "changed" (spurious drafts + lying dirty flag).
      delete (updatedDoc as { _persistedCanonical?: unknown })._persistedCanonical;
      syncFieldsToMetadata(updatedDoc);

      await storage.save(updatedDoc);
      // The write has COMMITTED. A listing that fails now must not turn it
      // into a reported failure (and a retry loop) — keep the last listing.
      let list = get().documents;
      try {
        list = await storage.list();
      } catch (e) {
        console.warn("[documentStore] Listing after a save failed:", e);
      }

      // A switch can cache NEWER typing while this write/list is pending.
      // Retire only the draft whose content actually reached storage; an older
      // completion must not erase the fallback for a later failed leave-save.
      const cachedEdit = get().getUnsavedEdit(updatedDoc.id);
      if (cachedEdit && JSON.stringify(cachedEdit) === JSON.stringify(canonical)) {
        get().clearUnsavedEdit(updatedDoc.id);
      }

      set((s) => ({
        activeDoc: s.activeDoc?.id === updatedDoc.id ? updatedDoc : s.activeDoc,
        documents: list,
        openTabs: s.openTabs.map((t) =>
          t.id === updatedDoc.id ? { ...t, title: updatedDoc.title } : t
        ),
        counts: computeCounts(canonical),
        // Keystrokes typed DURING the async write set saveStatus back to
        // "editing" — that content is NOT in the snapshot we just persisted,
        // so we must not overwrite the dirty flag (doing so disarmed the
        // close-tab prompt and beforeunload guard for those keystrokes).
        saveStatus: s.saveStatus === "saving" ? "saved" : s.saveStatus,
        saveError: null, // this write landed — stop reporting the last failure
      }));
      refreshMetrics(set, get);

      scheduleReadyReset((fn) => set(fn), "saved", 2000);
      return true;
    } catch (e) {
      console.warn("[documentStore] Save failed:", e);
      if (e instanceof StorageQuotaError) {
        // TERMINAL — see SaveStatus "full". Rethrown so the host's
        // onStorageQuotaExceeded and the editor's own message can fire.
        cancelReadyReset();
        set({ saveStatus: "full", saveError: e.message });
        throw e;
      }
      // After showing the transient error, return to "editing" — NOT "ready" —
      // because the content is still unsaved. Downgrading to "ready" here used
      // to disarm the unsaved-changes prompt, silently losing edits on close.
      set({ saveStatus: "error", saveError: e instanceof Error ? e.message : "Save failed" });
      scheduleReadyReset((fn) => set(fn), "error", 3000, "editing");
      return false;
    }
  },

  // ── Dirty flag ─────────────────────────────────────────────────────────────
  setDirty: () => {
    // Cancel any pending "saved → ready" reset so it can't later clobber the
    // dirty status we're setting here.
    cancelReadyReset();
    set({ saveStatus: "editing" });
  },

  allowBlankSaveOnce: () => {
    // Scoped to the document being cleared — see `blankSaveAllowedFor`.
    blankSaveAllowedFor = get().activeDocId;
  },

  storageFreed: () => {
    if (get().saveStatus === "full") set({ saveStatus: "editing" });
  },

  // ── Revert ─────────────────────────────────────────────────────────────────
  revertActiveDoc: async () => {
    const { activeDocId } = get();
    if (!activeDocId) return null;
    const doc = await storage.get(activeDocId);
    if (!doc) return null;
    
    // Clear the cached unsaved edit since we're reverting
    get().clearUnsavedEdit(activeDocId);
    
    set((s) => ({
      activeDoc: s.activeDoc?.id === doc.id ? { ...doc } : s.activeDoc,
      counts: computeCounts(doc.canonical),
      saveStatus: "ready",
    }));
    return doc;
  },

  // ── Switch ─────────────────────────────────────────────────────────────────
  switchToDoc: async (docId, _tiptapEditor) => {
    const { activeDocId, activeDoc, hydratedDocId: prevHydrated, saveStatus: prevStatus, saveError: prevError } = get();
    if (docId === activeDocId) return null;

    const mySeq = ++switchSeq;

    // Optimistically update activeDocId immediately so the sidebar highlights
    // the selected document without waiting for storage. The editor no longer
    // holds this document's content until a caller hydrates it (setCanonical),
    // so invalidate hydratedDocId — saveActiveDoc refuses until re-marked.
    // saveError is per-document: leaving a failed save behind and carrying its
    // message onto the next document would report a failure that never happened
    // there (the status bar reads it whenever the doc is dirty).
    set({ activeDocId: docId, saveStatus: "ready", saveError: null, hydratedDocId: null });

    let doc: DocumentRecord | null = null;
    try {
      doc = await storage.get(docId);
    } catch (e) {
      // Unreadable is handled like missing: the revert below keeps the user on
      // the document the editor still shows. (The adapter REJECTS rather than
      // returning null, so the save path can tell the two apart.)
      console.warn(`[documentStore] Could not open ${docId}:`, e);
    }

    // Superseded: a newer switch started while our storage read was in flight.
    // Do NOT apply our completion (or revert) — that would clobber the newer
    // switch's activeDocId and desync it from the editor's hydration. The newer
    // switch owns the state now.
    if (switchSeq !== mySeq) return null;

    if (!doc) {
      // Revert the FULL optimistic update if the doc wasn't found (deleted in
      // another tab, transient storage error). Restoring hydratedDocId matters:
      // the editor still shows the old doc, and leaving it null would poison
      // the rest of the session — every save/draft-cache blocked.
      set({ activeDocId: activeDoc?.id ?? null, hydratedDocId: prevHydrated, saveStatus: prevStatus, saveError: prevError });
      return null;
    }

    // Check if there's an unsaved edit cached for this document
    const cachedEdit = get().getUnsavedEdit(docId);
    const canonicalToUse = cachedEdit || doc.canonical;

    // Reactivating a draft must not rebase it. `doc` is the CURRENT record, so
    // its `updated` may belong to another tab's write; the draft was authored
    // against `_draftBases`. Keeping the record's stamp here is what let a
    // detected conflict be forgotten by switching away and back (the guard in
    // `saveActiveDoc` then measured zero drift). A draft with no recorded base
    // — one adopted from a crash stash written before this existed — keeps the
    // old behaviour rather than being dropped or blocked.
    const draftBase = cachedEdit ? get()._draftBases.get(docId) : undefined;
    set((s) => ({
      activeDoc: { 
        ...doc, 
        canonical: canonicalToUse,
        updated: draftBase ?? doc.updated,
        // Store the persisted baseline when using a cached edit for dirty-check comparison
        _persistedCanonical: cachedEdit ? doc.canonical : undefined
      },
      activeDocId: doc.id,
      counts: computeCounts(canonicalToUse),
      saveStatus: cachedEdit ? "editing" : "ready", // Set to editing if using cached edit
      openTabs: s.openTabs.some((t) => t.id === doc.id)
        ? s.openTabs
        : [...s.openTabs, { id: doc.id, title: doc.title }],
    }));

    storage.setPrefs({ lastActiveDocId: doc.id }).catch(() => {});
    return { ...doc, canonical: canonicalToUse };
  },

  // ── Close tab ──────────────────────────────────────────────────────────────
  closeTab: async (docId, tiptapEditor) => {
    const { activeDocId, openTabs, switchToDoc } = get();
    set((s) => ({ openTabs: s.openTabs.filter((t) => t.id !== docId) }));

    if (docId === activeDocId) {
      const remaining = openTabs.filter((t) => t.id !== docId);
      if (remaining.length > 0) {
        return await switchToDoc(remaining[remaining.length - 1]?.id ?? "", tiptapEditor);
      } else {
        // No document remains — the editor holds nothing meaningful, so the
        // hydration mark must not linger (stale marks are guard landmines).
        // Claim the switch sequence too (see finalizeDoc): a pending switch
        // settling after this would re-activate a document nobody hydrates.
        ++switchSeq;
        set({ activeDoc: null, activeDocId: null, saveStatus: "ready", saveError: null, hydratedDocId: null });
      }
    }
    return null;
  },

  // ── Delete ─────────────────────────────────────────────────────────────────
  deleteDoc: async (docId, tiptapEditor) => {
    // Claim the deletion up front so an autosave that is already suspended on
    // its own `await storage.get` cannot write this document back after
    // `storage.delete` commits. Cleared in `finally` once the tab is closed.
    deletingDocs.add(docId);
    try {
    // Snapshot the doc's content BEFORE deleting it, so a deleted document is
    // recoverable from the version-history dialog (restore as a new document).
    try {
      const doomed = await storage.get(docId);
      if (doomed) await snapshotStore.record(docId, doomed.title, doomed.canonical, "pre-delete");
    } catch { /* best effort — never block a delete on the snapshot net */ }
    await storage.delete(docId);
    get().clearIncompatible(docId);
    // Purge any cached draft for the deleted doc: a later import that reuses
    // the same id (e.g. restoring an exported .json) would otherwise resurrect
    // the dead doc's draft over the freshly imported content.
    get().clearUnsavedEdit(docId);
    const list = await storage.list();
    set({ documents: list });
    refreshMetrics(set, get);
    // The delete freed space: an open document parked on "full" may fit now.
    get().storageFreed();
    return await get().closeTab(docId, tiptapEditor);
    } finally {
      deletingDocs.delete(docId);
    }
  },

  // ── Rename ─────────────────────────────────────────────────────────────────
  renameDoc: async (docId, newTitle) => {
    // Load the target doc — may not be the active doc (sidebar lets you rename
    // any document, not just the one currently open).
    const target = await storage.get(docId);
    if (!target) return;

    // Another tab wrote this document after the revision this tab's copy is
    // based on. The rename still lands — a title is not content — but ONLY on
    // the stored record: merging this tab's live content into it would replace
    // the other tab's work, and stamping it into the store's activeDoc would
    // launder the conflict so the next autosave saw no drift at all.
    const conflicted = isNewerThanBase(target.updated, baseRevisionFor(docId));

    // If the live editor currently holds this doc, its on-disk canonical lags the
    // editor by up to one autosave interval. Persist the LIVE content alongside
    // the new title so a rename can never rewind unsaved edits (the "renamed and
    // lost my changes" data-loss class the user hit). liveCanonicalFor refuses a
    // blank, so a rename never wipes content either.
    const live = conflicted ? null : liveCanonicalFor(docId);
    if (live) target.canonical = live;

    // Store as an explicit user title — this takes priority over content-derived
    // title on every subsequent save, so the rename is never overwritten. The
    // provenance flag marks it a genuine rename so resolveDocTitle honors it
    // verbatim (even if the user typed "Untitled 5") instead of string-sniffing.
    target.userTitle = newTitle;
    target.titlePinnedByUser = true;
    target.title = newTitle;
    target.updated = new Date().toISOString();
    syncFieldsToMetadata(target);

    await storage.save(target);
    const list = await storage.list();
    // A draft may have advanced while the rename's write/list was pending.
    // Only the live content captured for THIS write is known to be on disk.
    const cachedEdit = get().getUnsavedEdit(docId);
    if (live && cachedEdit && JSON.stringify(cachedEdit) === JSON.stringify(live)) {
      get().clearUnsavedEdit(docId);
    } else if (!conflicted && get()._draftBases.has(docId)) {
      // A parked draft of a document renamed WITHOUT a conflict is still based
      // on the same content — the new stamp is this tab's own write. Left on
      // the old stamp, the draft's next save measured its own rename as
      // "another tab" and refused.
      get()._draftBases.set(docId, target.updated);
    }

    set((s) => ({
      documents: list,
      openTabs: s.openTabs.map((t) =>
        t.id === docId ? { ...t, title: newTitle } : t
      ),
      // Update activeDoc in-place if this is the currently open doc so the
      // editor header and tab bar reflect the change without a reload. In a
      // conflict only the title moves; the content base stays where it was.
      activeDoc:
        s.activeDoc?.id !== docId
          ? s.activeDoc
          : conflicted
            ? { ...s.activeDoc, title: target.title, userTitle: target.userTitle, titlePinnedByUser: true }
            : { ...target },
      counts:
        s.activeDoc?.id === docId && !conflicted ? computeCounts(target.canonical) : s.counts,
    }));
    refreshMetrics(set, get);
  },

  // ── Patch by id (non-active safe) ────────────────────────────────────────────
  patchDocById: async (docId, patch) => {
    // Presentation-only (a card's colour or pin): METADATA onto the freshest
    // stored copy, with `updated` untouched — nothing else. It used to write
    // the store's copy of the document (for the active one, with the live
    // editor content merged in) under the OLD timestamp, which put new content
    // on disk looking older than it was: another tab's newer version was
    // overwritten and its conflict check then saw nothing, so two tabs
    // ping-ponged last-writer-wins.
    if (patch.touchUpdated === false) {
      const stored = await storage.get(docId);
      if (!stored) return null;
      if (patch.metadata) stored.metadata = { ...stored.metadata, ...patch.metadata };
      // Tell the adapter's save() to leave `updated` alone — see stampUpdated.
      (stored as DocumentRecord & { _preserveUpdated?: boolean })._preserveUpdated = true;
      await storage.save(stored);
      const list = await storage.list();
      set((s) => ({
        documents: list,
        // The open document picks up the metadata only; its content and the
        // revision its content is based on are not this patch's business.
        activeDoc:
          s.activeDoc?.id === docId && patch.metadata
            ? { ...s.activeDoc, metadata: { ...s.activeDoc.metadata, ...patch.metadata } }
            : s.activeDoc,
      }));
      refreshMetrics(set, get);
      return stored;
    }

    // Load from storage so we can patch a doc that isn't currently open. Prefer
    // the live activeDoc copy if it's the target (it may hold unsaved canonical).
    const { activeDoc: liveActive } = get();
    const stored = await storage.get(docId);
    const target = liveActive?.id === docId ? { ...liveActive } : stored;
    if (!target) return null;

    // The same multi-tab check saveActiveDoc makes. The base is the OLDEST
    // revision this write's content derives from: the open document's, a
    // parked draft's, or the one the caller read it from (a card).
    const conflicted = !!stored && isNewerThanBase(stored.updated, baseRevisionFor(docId, patch.expectedUpdated));
    if (conflicted) {
      // Replacing content would overwrite the other tab's work: refuse.
      if (patch.canonical !== undefined) throw new ConflictError();
      // A title is not content: apply it to the stored record only (see renameDoc).
      return applyTitleOnly(set, get, docId, stored!, patch);
    }

    if (patch.canonical !== undefined) {
      target.canonical = patch.canonical;
    } else {
      // No explicit canonical: for the doc the live editor holds, the on-disk /
      // store copy lags the editor. Merge onto the LIVE content so a metadata-
      // only patch (e.g. a host title change) can't rewind unsaved edits.
      const live = liveCanonicalFor(docId);
      if (live) target.canonical = live;
    }
    if (patch.userTitle !== undefined) {
      target.userTitle = patch.userTitle;
      // An explicit userTitle patch is a genuine pin; clearing it (null) drops
      // the provenance so content derivation resumes.
      target.titlePinnedByUser = patch.userTitle != null;
    }
    // Title precedence: an explicit userTitle (existing or just-set) always wins;
    // otherwise re-derive from the (possibly new) canonical so headings stay in sync.
    if (patch.title !== undefined) {
      target.title = patch.title;
    } else if (patch.canonical !== undefined) {
      const resolved = resolveDocTitle(target, target.canonical);
      target.title = resolved.title;
      target.userTitle = resolved.userTitle;
      target.titlePinnedByUser = resolved.titlePinnedByUser;
    }
    target.updated = new Date().toISOString();
    syncFieldsToMetadata(target);
    // Merged AFTER syncFieldsToMetadata: that call re-spreads metadata with the
    // doc's `:::fields:::` values, so merging earlier would let a same-named
    // field silently clobber the patch.
    if (patch.metadata) {
      target.metadata = { ...target.metadata, ...patch.metadata };
    }
    delete (target as { _persistedCanonical?: unknown })._persistedCanonical;

    await storage.save(target);
    const list = await storage.list();
    // A title-only patch of a document with a parked draft moved its stamp by
    // this tab's own write — rebase the draft, as renameDoc does.
    if (patch.canonical === undefined && liveActive?.id !== docId && get()._draftBases.has(docId)) {
      get()._draftBases.set(docId, target.updated);
    }
    set((s) => ({
      documents: list,
      openTabs: s.openTabs.map((t) =>
        t.id === docId ? { ...t, title: target.title } : t
      ),
      activeDoc: s.activeDoc?.id === docId ? { ...target } : s.activeDoc,
      counts: s.activeDoc?.id === docId ? computeCounts(target.canonical) : s.counts,
    }));
    refreshMetrics(set, get);
    return target;
  },

  // ── Duplicate ──────────────────────────────────────────────────────────────
  duplicateDoc: async (docId) => {
    // `docId` is the row the user actually clicked. Without it the per-row
    // "Duplicate" in the library silently copied whichever document happened to
    // be OPEN — the id was passed by FolderTree, dropped by the editor's
    // handler, and never accepted here. Rename, right beside it, forwarded its
    // id correctly, which is what made the omission look deliberate.
    const { activeDoc } = get();
    const source = docId && docId !== activeDoc?.id ? await storage.get(docId) : activeDoc;
    if (!source) return undefined;
    // Prefer the LIVE editor canonical when it holds this doc — the stored
    // activeDoc.canonical lags the editor by up to one autosave interval, so
    // duplicating right after typing would otherwise fork a copy missing the
    // latest keystrokes. liveCanonicalFor refuses a blank, so the copy can't
    // come out empty. (Mirrors renameDoc / patchDocById.)
    const live = liveCanonicalFor(source.id);
    const dup = createDocument({
      ...source,
      canonical: live ?? source.canonical,
      id: undefined,
      title: source.title + " (copy)",
      // Pin the copy's title as an explicit userTitle when the source had one,
      // otherwise the next save re-derives the title from content and drops the
      // "(copy)" suffix.
      userTitle: source.userTitle ? source.title + " (copy)" : null,
      titlePinnedByUser: !!source.userTitle,
      created: undefined,
      updated: undefined,
    });
    await storage.save(dup);
    const list = await storage.list();
    set({ documents: list });
    refreshMetrics(set, get);
    return dup;
  },

  // ── Fidelity & Counts ──────────────────────────────────────────────────────
  updateFidelity: (canonical) => {
    const report = computeFidelity(
      canonical,
      get()._syncMode === "styled" ? "styled" : "clean"
    );
    const prev = get().fidelityReport;
    if (prev && sameFidelity(prev, report)) return prev;
    set({ fidelityReport: report });
    return report;
  },

  updateCounts: (canonical) => {
    if (!canonical) return;
    const next = computeCounts(canonical);
    const prev = get().counts;
    if (prev.chars === next.chars && prev.words === next.words) return;
    set({ counts: next });
  },

  // One walk of the canonical for BOTH derived values, and no new object
  // handed to subscribers unless something actually changed. This runs on
  // every cross-pane projection: it used to walk the document twice and then
  // publish two freshly-allocated objects regardless, which defeated every
  // `useShallow` selector downstream and re-rendered the shell on each sync.
  updateDerived: (canonical) => {
    const { fidelity, counts } = computeCanonicalStats(
      canonical,
      get()._syncMode === "styled" ? "styled" : "clean"
    );
    const state = get();
    const prevFidelity = state.fidelityReport;
    const nextFidelity =
      prevFidelity && sameFidelity(prevFidelity, fidelity) ? prevFidelity : fidelity;
    const countsChanged =
      state.counts.chars !== counts.chars || state.counts.words !== counts.words;
    if (nextFidelity !== prevFidelity || countsChanged) {
      set({
        fidelityReport: nextFidelity,
        counts: countsChanged ? counts : state.counts,
      });
    }
    return nextFidelity;
  },

  getDocById: async (id) => storage.get(id),

  // ── Storage Metrics ────────────────────────────────────────────────────────
  getStorageMetrics: () => {
    refreshMetrics(set, get);
    return get().storageMetrics;
  },

  // ── Unsaved Edits Cache ────────────────────────────────────────────────────
  cacheUnsavedEdit: (docId, canonical) => {
    const s = get();
    s._unsavedEdits.set(docId, canonical);
    // Record the revision this draft is based on the FIRST time it is cached,
    // and never advance it on re-cache: typing more into an already-dirty
    // document does not rebase that document onto whatever another tab has
    // since written. Only a save (or an explicit discard) retires a draft, and
    // both clear the base with it.
    //
    // The `has` check is deliberate but NOT independently observable today:
    // mutation-tested by always overwriting the base, and no case went red,
    // because every path that re-caches a live draft leaves `activeDoc.updated`
    // already equal to the base. It encodes the rule the guard depends on, so
    // a future path that does move that stamp cannot silently rebase a draft.
    // Documented rather than covered by a test that would pass either way.
    if (!s._draftBases.has(docId)) {
      const base = s.activeDocId === docId ? s.activeDoc?.updated : undefined;
      if (base) s._draftBases.set(docId, base);
    }
  },

  clearUnsavedEdit: (docId) => {
    get()._unsavedEdits.delete(docId);
    get()._draftBases.delete(docId);
  },

  getUnsavedEdit: (docId) => {
    return get()._unsavedEdits.get(docId);
  },

  getLifecycleState: () => {
    const s = get();
    return {
      activeDocId: s.activeDocId,
      hydratedDocId: s.hydratedDocId,
      hydrated: s.activeDocId != null && s.hydratedDocId === s.activeDocId,
      saveStatus: s.saveStatus,
      hasActiveDoc: !!s.activeDoc,
      unsavedDraftCount: s._unsavedEdits.size,
      docCount: s.documents.length,
    };
  },
}));
