/**
 * Live sync between tabs.
 *
 * Two tabs on the same library used to learn about each other only when one of
 * them tried to SAVE: the multi-tab guard in `saveActiveDoc` refused the write
 * and parked a terminal "conflict". Safe, but the library list, Cards and the
 * map showed stale data until a reload, and a tab found out it had been
 * overtaken only after the user had typed into it.
 *
 * Every committed write now tells the other tabs about it. The message carries
 * IDS AND REVISIONS ONLY (`updated`), never content: a receiver reads what it
 * needs from storage, so a message is a hint, never a source of truth, and a
 * stale or forged one can at worst cause a re-read.
 *
 * This module is the transport and the pure decisions. What a tab DOES with a
 * message — refresh the library, reload an open document, park a conflict and
 * offer the three ways out — is `editor/useTabSync.ts`.
 *
 * It must not import the document store (the store imports it, to announce its
 * commits and to consult what other tabs have announced); `SaveStatus` is a
 * type-only import.
 */
import { create } from "zustand";
import type { SaveStatus } from "./documentStore";
import { safeStorage } from "../utils/safe-storage";

// ─── Messages ────────────────────────────────────────────────────────────────

export type TabSyncEvent =
  /** A document was written (saved, renamed, patched, created, imported,
   *  duplicated). `meta` marks a presentation-only patch that kept `updated`. */
  | { type: "doc"; id: string; updated: string; meta?: boolean }
  /** A document was deleted. */
  | { type: "deleted"; id: string }
  /** The folder tree (or another library-wide preference) changed. */
  | { type: "library" }
  /** Everything was erased (`clearLocalData`). */
  | { type: "cleared" };

export interface TabSyncMessage {
  v: 1;
  /** The sending tab. A tab ignores its own messages. */
  from: string;
  events: TabSyncEvent[];
}

const MAX_EVENTS = 1000;
const MAX_ID_LENGTH = 256;

/** This tab. Random per page load, so a reloaded tab is a new tab. */
export const TAB_ID: string = (() => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* fall through */ }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
})();

/**
 * A message from another tab, validated, or null. Same-origin tabs are not
 * adversaries, but a message is still input: only the fields a receiver acts
 * on survive, with the types it expects.
 */
export function parseTabSyncMessage(raw: unknown): TabSyncMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as { v?: unknown; from?: unknown; events?: unknown };
  if (m.v !== 1 || typeof m.from !== "string" || !Array.isArray(m.events)) return null;
  const events: TabSyncEvent[] = [];
  type RawEvent = { type?: unknown; id?: unknown; updated?: unknown; meta?: unknown };
  for (const e of m.events.slice(0, MAX_EVENTS) as Array<RawEvent | null>) {
    if (!e || typeof e !== "object") continue;
    const id = typeof e.id === "string" && e.id.length > 0 && e.id.length <= MAX_ID_LENGTH ? e.id : null;
    switch (e.type) {
      case "doc":
        if (id && typeof e.updated === "string" && !Number.isNaN(Date.parse(e.updated))) {
          events.push({ type: "doc", id, updated: e.updated, ...(e.meta === true ? { meta: true } : {}) });
        }
        break;
      case "deleted":
        if (id) events.push({ type: "deleted", id });
        break;
      case "library":
        events.push({ type: "library" });
        break;
      case "cleared":
        events.push({ type: "cleared" });
        break;
    }
  }
  return { v: 1, from: m.from, events };
}

/** A batch of events, coalesced: the newest revision per document, deletions
 *  in the order they happened relative to writes. */
export interface TabSyncSummary {
  changed: Map<string, { updated: string; meta: boolean }>;
  deleted: Set<string>;
  library: boolean;
  cleared: boolean;
}

export function summarizeEvents(events: readonly TabSyncEvent[]): TabSyncSummary {
  const out: TabSyncSummary = { changed: new Map(), deleted: new Set(), library: false, cleared: false };
  for (const e of events) {
    switch (e.type) {
      case "doc": {
        // A write after a deletion is the document again (an import that
        // reused the id): it is not deleted any more.
        out.deleted.delete(e.id);
        const prev = out.changed.get(e.id);
        const meta = !!e.meta && (prev ? prev.meta : true);
        const updated = prev && !isStrictlyNewer(e.updated, prev.updated) ? prev.updated : e.updated;
        out.changed.set(e.id, { updated, meta });
        break;
      }
      case "deleted":
        out.changed.delete(e.id);
        out.deleted.add(e.id);
        break;
      case "library":
        out.library = true;
        break;
      case "cleared":
        out.cleared = true;
        out.library = true;
        break;
    }
  }
  return out;
}

/**
 * `a` is a LATER revision than `b`. Strict, with no tolerance: unlike the save
 * guard's 2s window (which absorbs this tab's own stamp wobble), a revision
 * another tab announced is another tab's write by construction, however close
 * in time it is.
 */
export function isStrictlyNewer(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a) return false;
  const ta = Date.parse(a);
  if (Number.isNaN(ta)) return false;
  if (!b) return true;
  const tb = Date.parse(b);
  return Number.isNaN(tb) ? true : ta > tb;
}

// ─── Deciding what to do about the OPEN document ────────────────────────────

/** Statuses that mean the open document holds work that is not on disk. */
export const UNSAVED_STATUSES: ReadonlySet<SaveStatus> = new Set<SaveStatus>([
  "editing", "error", "blocked", "full", "conflict",
]);

export function hasUnsavedWork(status: SaveStatus, hasDraft: boolean): boolean {
  return hasDraft || UNSAVED_STATUSES.has(status);
}

/** What the receiver knows about its own open document, read synchronously. */
export interface OpenDocState {
  activeDocId: string | null;
  hydratedDocId: string | null;
  /** The revision the open content is based on (`activeDoc.updated`). */
  base: string | null | undefined;
  saveStatus: SaveStatus;
  /** A parked draft exists for the open document. */
  hasDraft: boolean;
  /** An IME / dictation composition is live in either pane. */
  composing: boolean;
  /** A cross-pane projection is still scheduled. */
  pendingProjection: boolean;
  /** The editor shows a read-only display copy (content from a newer build). */
  schemaLocked: boolean;
}

export type OpenDocDecision =
  /** Not open here, or not newer than what this tab holds. */
  | "ignore"
  /** Something is in flight (a switch, a save, a composition, a projection):
   *  look again once it settles. */
  | "defer"
  /** Clean: reload it through the hydration ritual. */
  | "reload"
  /** This tab holds unsaved work: park the conflict and ask. */
  | "conflict";

/**
 * Another tab wrote revision `theirs` of `docId`. What should THIS tab do?
 *
 * The order matters. Unsaved work wins over everything that is merely in
 * flight — a composition implies typing, and parking a conflict touches no
 * pane — while a clean document waits for a composition or projection to
 * settle before anything is hydrated over it.
 */
export function decideOpenDocChange(docId: string, theirs: string | null | undefined, s: OpenDocState): OpenDocDecision {
  if (!docId || s.activeDocId !== docId) return "ignore";
  if (s.schemaLocked) return "ignore";
  if (!isStrictlyNewer(theirs, s.base)) return "ignore";
  // Active but not hydrated: a switch or boot is still putting it in the
  // editor. Its own read may already have the new revision; look again after.
  if (s.hydratedDocId !== docId) return "defer";
  // Our own save is in flight: it either lands (and becomes the base) or is
  // refused as a conflict. Either way the answer is clearer afterwards.
  if (s.saveStatus === "saving") return "defer";
  if (hasUnsavedWork(s.saveStatus, s.hasDraft)) return "conflict";
  if (s.composing || s.pendingProjection) return "defer";
  return "reload";
}

// ─── What other tabs have announced (consulted by the save guard) ────────────

const MAX_FOREIGN_PER_DOC = 16;
const foreignRevisions = new Map<string, string[]>();
const deletedElsewhere = new Set<string>();

/** Record a revision another tab announced for `docId`. */
export function noteForeignRevision(docId: string, updated: string): void {
  const list = foreignRevisions.get(docId) ?? [];
  if (list.includes(updated)) return;
  list.push(updated);
  if (list.length > MAX_FOREIGN_PER_DOC) list.shift();
  foreignRevisions.set(docId, list);
}

/**
 * `stored` is a revision ANOTHER tab wrote, later than `base`. The save guard's
 * drift check tolerates 2s of stamp wobble, so a write another tab made within
 * two seconds of this tab's base went unnoticed and was overwritten. A revision
 * that arrived by message is known to be foreign, and needs no tolerance.
 */
export function isForeignRevision(docId: string, stored: string | null | undefined, base: string | null | undefined): boolean {
  if (!stored || stored === base) return false;
  return !!foreignRevisions.get(docId)?.includes(stored) && isStrictlyNewer(stored, base);
}

/** Another tab deleted `docId` while it was open here. */
export function markDeletedElsewhere(docId: string): void { deletedElsewhere.add(docId); }
export function isDeletedElsewhere(docId: string | null | undefined): boolean {
  return !!docId && deletedElsewhere.has(docId);
}

// ─── Transport ───────────────────────────────────────────────────────────────

export interface TabSyncTransport {
  post(msg: TabSyncMessage): void;
  close(): void;
}
export type TransportFactory = (name: string, onMessage: (raw: unknown) => void) => TabSyncTransport | null;

/** A BroadcastChannel, or null where there is none (or it cannot be opened —
 *  an opaque-origin sandbox throws). */
export const openBroadcastTransport: TransportFactory = (name, onMessage) => {
  if (typeof BroadcastChannel === "undefined") return null;
  let ch: BroadcastChannel;
  try {
    ch = new BroadcastChannel(name);
  } catch {
    return null;
  }
  ch.onmessage = (e: MessageEvent) => onMessage(e.data);
  // Node's implementation (the test runner) keeps the process alive while a
  // channel is open; a browser's has no such method.
  (ch as unknown as { unref?: () => void }).unref?.();
  return {
    post: (msg) => { try { ch.postMessage(msg); } catch { /* closed */ } },
    close: () => { try { ch.close(); } catch { /* already closed */ } },
  };
};

/**
 * The fallback where BroadcastChannel is missing: a `storage` event on one
 * localStorage key, which fires in every OTHER tab of the origin. Every access
 * goes through safeStorage — reading `localStorage` throws where a browser
 * blocks site data.
 */
export const openStorageTransport: TransportFactory = (name, onMessage) => {
  if (typeof window === "undefined" || !safeStorage.available()) return null;
  const key = `pf:tab-sync:${name}`;
  const handler = (e: StorageEvent) => {
    if (e.key !== key || !e.newValue) return;
    try { onMessage(JSON.parse(e.newValue)); } catch { /* not ours */ }
  };
  window.addEventListener("storage", handler);
  let n = 0;
  return {
    // The counter makes every value new, or two identical messages in a row
    // would not fire an event at all.
    post: (msg) => safeStorage.set(key, JSON.stringify({ ...msg, n: ++n })),
    close: () => window.removeEventListener("storage", handler),
  };
};

export const openTransport: TransportFactory = (name, onMessage) =>
  openBroadcastTransport(name, onMessage) ?? openStorageTransport(name, onMessage);

/**
 * The channel for a storage. Named after what the tabs SHARE — the built-in
 * database's name, or a host's namespace — so the app and the embed on the
 * app's own hosts (separate databases), or two host namespaces, never hear
 * each other, and two pages that share a database always do. A host adapter
 * that is not shared at all costs nothing but a re-read: every receiver checks
 * its own storage before it acts.
 */
export function tabSyncChannelName(kind: "idb" | "local" | "window" | "host", name?: string): string {
  return `pf-tab-sync:${kind}${name ? `:${name}` : ""}`;
}

let channelName: string | null = null;
let transportFactory: TransportFactory = openTransport;
let transport: TabSyncTransport | null = null;
let deliver: ((events: TabSyncEvent[]) => void) | null = null;
let outbox: TabSyncEvent[] = [];
let flushQueued = false;

/** Which channel this page's storage uses (documentStore sets it with the
 *  adapter). Takes effect at the next `startTabSync`. */
export function configureTabSync(name: string | null): void { channelName = name; }
export function tabSyncChannel(): string | null { return channelName; }

function receive(raw: unknown): void {
  const msg = parseTabSyncMessage(raw);
  if (!msg || msg.from === TAB_ID || !msg.events.length) return;
  // Noted on ARRIVAL, before any asynchronous handling: the save guard must
  // know about the other tab's revision from this moment on.
  for (const e of msg.events) {
    if (e.type === "doc" && !e.meta) noteForeignRevision(e.id, e.updated);
  }
  deliver?.(msg.events);
}

/**
 * Open the channel and deliver other tabs' events to `onEvents`. Returns the
 * stop function. Only a mounted editor listens — there is nothing to keep in
 * step without one — and a page with no shared storage has no channel at all.
 */
export function startTabSync(onEvents: (events: TabSyncEvent[]) => void): () => void {
  stopTabSync();
  if (!channelName) return () => {};
  const t = transportFactory(channelName, receive);
  if (!t) return () => {};
  transport = t;
  deliver = onEvents;
  const mine = t;
  return () => { if (transport === mine) stopTabSync(); };
}

function stopTabSync(): void {
  transport?.close();
  transport = null;
  deliver = null;
  outbox = [];
  flushQueued = false;
}

function flush(): void {
  flushQueued = false;
  const events = outbox;
  outbox = [];
  if (events.length && transport) transport.post({ v: 1, from: TAB_ID, events });
}

/**
 * Tell the other tabs about a write that has COMMITTED. Call it only after the
 * storage write resolved — never before, never for a refused write. Events of
 * one task go out as one message.
 */
export function announce(event: TabSyncEvent): void {
  if (!transport) return;
  outbox.push(event);
  if (flushQueued) return;
  flushQueued = true;
  Promise.resolve().then(flush);
}

// ─── The folder tree, applied from another tab ──────────────────────────────

let applyingRemote = 0;
/** Run `fn` as the application of what another tab already wrote. The folder
 *  tree's persistence skips it: writing it back could only race that tab's
 *  next change, and lose it. */
export function withRemoteApply(fn: () => void): void {
  applyingRemote++;
  try { fn(); } finally { applyingRemote--; }
}
export function isApplyingRemote(): boolean { return applyingRemote > 0; }

/** The part of the folder tree that describes the LIBRARY (not which folders
 *  this tab has expanded), as a comparable string. */
export function folderStructureSignature(tree: { folders?: unknown; docParents?: unknown; docOrder?: unknown } | null | undefined): string {
  return JSON.stringify([tree?.folders ?? [], tree?.docParents ?? {}, tree?.docOrder ?? {}]);
}

// ─── The notice ──────────────────────────────────────────────────────────────

export type TabNoticeKind = "changed" | "deleted";
export interface TabNotice { docId: string; kind: TabNoticeKind }

/** The notice's buttons, provided by `useTabSync` while an editor is mounted. */
export interface TabSyncActions {
  keepMine: () => Promise<void>;
  useTheirs: () => Promise<void>;
  saveCopy: () => Promise<void>;
  keepAsNew: () => Promise<void>;
  close: () => Promise<void>;
}

export interface TabSyncUIState {
  notice: TabNotice | null;
  /** An action is running; the buttons wait for it. */
  busy: boolean;
  actions: TabSyncActions | null;
}

export const useTabSyncStore = create<TabSyncUIState>(() => ({ notice: null, busy: false, actions: null }));

// ─── Tests ───────────────────────────────────────────────────────────────────

/** Reset the module (and optionally swap the transport) — tests only. */
export function _resetTabSyncForTests(opts: { factory?: TransportFactory; channel?: string | null } = {}): void {
  stopTabSync();
  transportFactory = opts.factory ?? openTransport;
  channelName = opts.channel === undefined ? channelName : opts.channel;
  foreignRevisions.clear();
  deletedElsewhere.clear();
  applyingRemote = 0;
  useTabSyncStore.setState({ notice: null, busy: false, actions: null });
}
