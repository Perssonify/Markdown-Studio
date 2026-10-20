import { create } from "zustand";
import type { LiveShares } from "@/editor/props";
import { t } from "@/i18n";
import { assetStore } from "@/store/assets/asset-store";
import { prepareImportedDocAssets } from "@/store/assets/assets";
import { sanitizeCanonicalNode } from "@/store/documents/canonical-sanitize";
import type { DocumentRecord } from "@/store/documents/document";
import { useDocumentStore } from "@/store/documents/documentStore";
import { buildLiveDocument, LIVE_SHARE_KEY, liveShareOf, type LiveShareInfo } from "@/store/documents/live-share";
import { snapshotStore } from "@/store/history/snapshot-store";
import { isShareView, type SharePayload, type ShareView } from "@/store/importExport/share-link";
import { IndexedDBStorageAdapter } from "@/store/persistence/idb-storage-adapter";
import { tabSyncChannel, tabSyncChannelName, type TabSyncEvent } from "@/store/persistence/tab-sync";
import type { PublishedEntry } from "../cloud/api";
import { isPublishedId, publishDocument, PublishTooLargeError, readPublication, unpublishDocument, type Publication } from "./api";

/**
 * Live shares in the standalone app — a document its owner publishes
 * read-only, which the people who open its link FOLLOW: their copy is
 * replaced by the owner's next version.
 *
 *  - Owner: the Share dialog publishes it (`liveSharesApi`); afterwards every
 *    device of the owner's that syncs keeps it current (the sync engine
 *    republishes a document whose revision moved — app/cloud/engine.ts).
 *  - Follower: opening `/#live=<id>` adds the document to the library — or
 *    opens it, when it is followed here already (`prepareLiveLink`) — and
 *    `startFollowing` checks every followed copy for a new version: on load,
 *    when the page is shown again, and every few minutes while it is on screen.
 *    A check that finds nothing new costs a few bytes (`?since=`).
 *
 * The copy here is an ordinary document carrying `liveShare` in its metadata
 * (store/documents/live-share-meta.ts): the library marks it, the editor opens
 * it read-only, and "Stop following" makes it the user's own.
 */

// ── The owner's live shares ───────────────────────────────────────────────

interface PublishedState {
  /** docId → its live share's public id. */
  byDoc: Record<string, string>;
  /** docId → why its live copy is not keeping up with the note (the sync
   *  engine could not publish its latest revision). */
  problems: Record<string, "too-large">;
}

export const usePublished = create<PublishedState>(() => ({ byDoc: {}, problems: {} }));

/** The sync engine could (null) or could not publish a share's latest revision. */
export function notePublishProblem(docId: string, problem: "too-large" | null): void {
  usePublished.setState((s) => {
    const problems = { ...s.problems };
    if (problem) problems[docId] = problem;
    else delete problems[docId];
    return { problems };
  });
}

/** The account's list, as the sync engine reads it with the account's state. */
export function rememberPublished(entries: PublishedEntry[]): void {
  const byDoc: Record<string, string> = {};
  for (const e of entries) byDoc[e.docId] = e.id;
  const cur = usePublished.getState().byDoc;
  const same = Object.keys(cur).length === entries.length && entries.every((e) => cur[e.docId] === e.id);
  if (!same) usePublished.setState({ byDoc });
}

/** A live share's link: the app root, the id and the layout it opens in. */
export function liveLink(id: string, view?: ShareView): string {
  const root = typeof window !== "undefined" ? window.location.origin + "/" : "/";
  return `${root}#live=${id}${view ? `&view=${view}` : ""}`;
}

/** What the editor's Share dialog uses for live shares (PerssonifyEditorProps.liveShares). */
export const liveSharesApi: LiveShares = {
  async publish(docId, view) {
    const rec = await useDocumentStore.getState().getStorage().get(docId);
    if (!rec) throw new Error(t("editor.documentNotFound"));
    const live = await buildLiveDocument(rec, (hash) => assetStore.get(hash));
    let id: string;
    try {
      ({ id } = await publishDocument(docId, live));
    } catch (e) {
      throw new Error(e instanceof PublishTooLargeError ? t("dialogs.shareLiveTooLarge") : t("dialogs.shareLiveFailed"), { cause: e });
    }
    notePublishProblem(docId, null);
    usePublished.setState((s) => ({ byDoc: { ...s.byDoc, [docId]: id } }));
    return liveLink(id, view);
  },
  async unpublish(docId) {
    await unpublishDocument(docId);
    usePublished.setState((s) => {
      const byDoc = { ...s.byDoc };
      delete byDoc[docId];
      return { byDoc };
    });
  },
  linkFor(docId, view) {
    const id = usePublished.getState().byDoc[docId];
    return id ? liveLink(id, view) : null;
  },
  problemFor(docId) {
    return usePublished.getState().problems[docId] === "too-large" ? t("dialogs.shareLiveStale") : null;
  },
};

// ── Following ─────────────────────────────────────────────────────────────

/** `#live=<id>&view=<layout>` — read during the first render, like `#share=`. */
export function readLiveSeed(hash?: string): { id: string; view?: ShareView } | null {
  const h = (hash ?? (typeof window !== "undefined" ? window.location.hash : "")).replace(/^#/, "");
  if (!h) return null;
  const params = new URLSearchParams(h);
  const id = params.get("live");
  if (!isPublishedId(id)) return null;
  const view = params.get("view");
  return { id, ...(isShareView(view) ? { view } : {}) };
}

/** The library's own database — like another tab, as the sync engine does. */
const openStorage = () => new IndexedDBStorageAdapter();

const SOURCE = `live-share:${Math.random().toString(36).slice(2)}`;

/** Tell the editor (and other tabs) what changed — the tab-sync channel. */
function announce(events: TabSyncEvent[]): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const ch = new BroadcastChannel(tabSyncChannel() ?? tabSyncChannelName("idb", "perssonify-docs"));
    ch.postMessage({ v: 1, from: SOURCE, events });
    ch.close();
  } catch {
    /* no channel: the editor picks it up when the document is next opened */
  }
}

const isNewer = (a: string, b: string) => (Date.parse(a) || 0) > (Date.parse(b) || 0);

/**
 * Put a new version of a followed document in place of the copy here. The
 * copy it replaces goes to Version history. Content from someone else is
 * cleaned exactly as an imported JSON document is (sanitizeCanonicalNode, the
 * images through the import path).
 */
async function applyPublication(storage: IndexedDBStorageAdapter, seen: DocumentRecord, pub: Publication, live: LiveShareInfo): Promise<boolean> {
  const env = pub.document as { canonical?: unknown; assets?: unknown };
  // (Every read from storage sanitises again — createDocument — so this is the
  // first of two layers, not the only one.)
  const canonical = sanitizeCanonicalNode(env.canonical as DocumentRecord["canonical"]);
  if (!canonical || (canonical as { type?: unknown }).type !== "doc") return false;
  // The owner's copy was being fetched: read the note again, and leave it
  // alone if it changed meanwhile — the user stopped following it, or typed
  // into it — rather than writing the copy fetched before over that.
  const rec = await stillFollowed(storage, seen, live);
  if (!rec) return false;
  try {
    await snapshotStore.record(rec.id, rec.title, rec.canonical, "live-update");
  } catch {
    /* history off or full: the update still lands */
  }
  const now = new Date().toISOString();
  // The owner's revision, so every device following it writes the same one
  // (and cloud sync sees nothing to reconcile) — unless the copy here is
  // somehow newer, when a revision that went backwards would be ignored.
  const updated = isNewer(pub.revision, rec.updated) ? pub.revision : now;
  const next = {
    ...rec,
    canonical,
    title: pub.title || rec.title,
    userTitle: pub.title || rec.userTitle,
    titlePinnedByUser: !!pub.title || rec.titlePinnedByUser,
    updated,
    metadata: { ...rec.metadata, [LIVE_SHARE_KEY]: { ...live, revision: pub.revision, unseen: true, ended: false, at: now } },
    _importAssets: env.assets,
    _preserveUpdated: true,
  } as DocumentRecord & { _importAssets?: unknown; _preserveUpdated: boolean };
  await prepareImportedDocAssets(next);
  await storage.save(next);
  announce([{ type: "doc", id: rec.id, updated }]);
  return true;
}

/** The owner stopped sharing it: no more updates, and it is the user's own now. */
async function markEnded(storage: IndexedDBStorageAdapter, seen: DocumentRecord, live: LiveShareInfo): Promise<boolean> {
  const rec = await stillFollowed(storage, seen, live);
  if (!rec) return false;
  const next = { ...rec, metadata: { ...rec.metadata, [LIVE_SHARE_KEY]: { ...live, ended: true, unseen: true } }, _preserveUpdated: true };
  await storage.save(next as DocumentRecord);
  announce([{ type: "doc", id: rec.id, updated: rec.updated, meta: true }]);
  return true;
}

/**
 * The note as it is NOW, if it is still the one a check started from: same
 * revision, still following the same share. Null when the user stopped
 * following it, typed into it or deleted it while the share was being read —
 * the check then leaves it alone rather than writing over that.
 */
async function stillFollowed(storage: IndexedDBStorageAdapter, seen: DocumentRecord, live: LiveShareInfo): Promise<DocumentRecord | null> {
  const rec = await storage.get(seen.id);
  const current = rec ? liveShareOf(rec.metadata) : null;
  return rec && rec.updated === seen.updated && current?.id === live.id ? rec : null;
}

/** Check every followed copy here once. */
export async function refreshFollowed(storage: IndexedDBStorageAdapter = openStorage()): Promise<number> {
  let changed = 0;
  const followed = (await storage.list()).filter((s) => s.liveShare && !s.liveShare.ended);
  for (const s of followed) {
    try {
      const rec = await storage.get(s.id);
      const live = rec ? liveShareOf(rec.metadata) : null;
      if (!rec || !live || live.ended) continue;
      const reply = await readPublication(live.id, live.revision);
      if (reply.kind === "unchanged") continue;
      const done = reply.kind === "gone" ? await markEnded(storage, rec, live) : await applyPublication(storage, rec, reply.publication, live);
      if (done) changed++;
    } catch {
      /* offline, or the server is down: the next check tries again */
    }
  }
  return changed;
}

/** While the page is on screen, a followed document is checked this often. */
const FOLLOW_INTERVAL_MS = 3 * 60_000;
/** A visibility or focus wake this soon after a check is not worth another. */
const FOLLOW_WAKE_GAP_MS = 30_000;

/** Keep followed documents up to date for as long as the app is open. Returns the stop function. */
export function startFollowing(): () => void {
  const storage = openStorage();
  let stopped = false;
  let running = false;
  let lastRun = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      // One tab at a time checks (a Web Lock): every open tab runs this loop,
      // and two writing the same update would each keep a history copy.
      const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
      if (locks) await locks.request("pf-live-follow", { ifAvailable: true }, async (lock) => (lock ? refreshFollowed(storage) : undefined));
      else await refreshFollowed(storage);
    } catch {
      /* the next check tries again */
    } finally {
      running = false;
      lastRun = Date.now();
      schedule(FOLLOW_INTERVAL_MS);
    }
  };
  const schedule = (ms: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (document.visibilityState === "hidden") schedule(FOLLOW_INTERVAL_MS);
      else void run();
    }, ms);
  };
  const onWake = () => {
    if (document.visibilityState === "hidden" || Date.now() - lastRun < FOLLOW_WAKE_GAP_MS) return;
    schedule(0);
  };
  document.addEventListener("visibilitychange", onWake);
  window.addEventListener("focus", onWake);
  window.addEventListener("online", onWake);
  schedule(5_000); // let the editor open first
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener("visibilitychange", onWake);
    window.removeEventListener("focus", onWake);
    window.removeEventListener("online", onWake);
  };
}

export type LiveLinkOutcome =
  /** Not followed here yet: the editor imports it on boot (its `initialShare`). */
  | { kind: "import"; share: SharePayload }
  /** Followed here already: brought up to date, and opened. */
  | { kind: "open"; docId: string }
  /** No longer shared, or unreachable. */
  | { kind: "failed"; gone: boolean };

/**
 * Before the editor opens on a `#live=` link: fetch the live share, and either
 * hand it to the editor to import (a new follower) or bring the copy already
 * followed here up to date and make it the document the editor opens.
 */
export async function prepareLiveLink(id: string, view?: ShareView): Promise<LiveLinkOutcome> {
  let reply;
  try {
    reply = await readPublication(id);
  } catch {
    return { kind: "failed", gone: false };
  }
  if (reply.kind !== "publication") return { kind: "failed", gone: true };
  const pub = reply.publication;
  const storage = openStorage();
  try {
    const existing = (await storage.list()).find((s) => s.liveShare?.id === id);
    const rec = existing ? await storage.get(existing.id) : null;
    const live = rec ? liveShareOf(rec.metadata) : null;
    if (rec && live) {
      if (live.revision !== pub.revision || live.ended) await applyPublication(storage, rec, pub, { ...live, ended: false });
      await storage.setPrefs({ lastActiveDocId: rec.id });
      return { kind: "open", docId: rec.id };
    }
  } catch {
    /* the library cannot be read here: import it as new */
  }
  const info: LiveShareInfo = { id, revision: pub.revision, at: new Date().toISOString() };
  return {
    kind: "import",
    share: {
      v: 1,
      kind: "file",
      name: pub.title,
      docs: [{ path: [], title: pub.title, markdown: JSON.stringify(pub.document), format: "pmjson", metadata: { [LIVE_SHARE_KEY]: info } }],
      ...(view ? { view } : {}),
    },
  };
}
