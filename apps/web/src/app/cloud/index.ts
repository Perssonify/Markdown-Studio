import { create } from "zustand";
import { setAccountVersions } from "@/store/history/account-versions";
import { assetStore } from "@/store/assets/asset-store";
import type { DocumentSummary } from "@/store/documents/document";
import { IndexedDBStorageAdapter } from "@/store/persistence/idb-storage-adapter";
import { snapshotStore } from "@/store/history/snapshot-store";
import { recordFullBackup } from "@/store/persistence/storage-durability";
import { parseTabSyncMessage, tabSyncChannel, tabSyncChannelName, type TabSyncEvent } from "@/store/persistence/tab-sync";
import { liveBackupSources } from "../../utils/emergency-backup";
import { safeStorage } from "../../utils/safe-storage";
import { CloudError, httpAccountArchive, httpCloudApi } from "./api";
import { backedUpToday, backUpToAccount, type BackupDeps, type BackupOutcome } from "./backup";
import { SyncEngine } from "./engine";
import { untouchedStarterIds, withoutNotes } from "./starters";
import { accountVersionsProvider } from "./versions";

/**
 * Cloud sync in the standalone app: one SyncEngine per signed-in session,
 * driven by what happens in the library.
 *
 *  - When: right away, a moment after any change in this browser's library
 *    (the editor's own tab-sync announcements), when the tab regains focus or
 *    the network returns, and every 30 s.
 *  - One tab at a time (a Web Lock), so two tabs never upload the same note.
 *  - One account per browser library: the first account to sync this browser's
 *    library owns it; another account signing in here does not sync — its
 *    notes would otherwise be mixed with the first person's in either account.
 *  - Beside sync: a full backup a day (backup.ts), a minute after the session
 *    starts, and the account's past versions in Version history (versions.ts).
 */

export type CloudPhase = "off" | "preparing" | "syncing" | "synced" | "offline" | "error" | "blocked";

export interface CloudStatus {
  phase: CloudPhase;
  lastSyncedAt: number | null;
}

export const useCloudStatus = create<CloudStatus>(() => ({ phase: "off", lastSyncedAt: null }));
const setPhase = (phase: CloudPhase, synced = false) =>
  useCloudStatus.setState((s) => ({ phase, lastSyncedAt: synced ? Date.now() : s.lastSyncedAt }));

const OWNER_KEY = "pf:cloud-owner";
const INTERVAL_MS = 30_000;
const SETTLE_MS = 1_500;
const SOURCE = `cloud-sync:${Math.random().toString(36).slice(2)}`;
/** The day's backup waits this long after sign-in, so it does not compete with opening the library. */
const BACKUP_DELAY_MS = 60_000;
/** After a failed (or impossible) backup, the next attempt waits this long. */
const BACKUP_RETRY_MS = 60 * 60_000;

const backupDeps: BackupDeps = { api: httpAccountArchive, sources: liveBackupSources, kv: safeStorage, backedUp: recordFullBackup };

/** "Back up now": replace today's backup in the account with the library as it is now. */
export function backUpNow(userId: string): Promise<BackupOutcome> {
  return backUpToAccount(userId, backupDeps, { force: true });
}

/** Which account this browser's library belongs to, if any has synced it. */
export function libraryOwner(): string | null {
  return safeStorage.get(OWNER_KEY);
}

function channelName(): string {
  return tabSyncChannel() ?? tabSyncChannelName("idb", "perssonify-docs");
}

function openChannel(onEvents: (events: TabSyncEvent[], fromSync: boolean) => void): { post: (e: TabSyncEvent[]) => void; close: () => void } {
  if (typeof BroadcastChannel === "undefined") return { post: () => {}, close: () => {} };
  const ch = new BroadcastChannel(channelName());
  ch.onmessage = (e: MessageEvent) => {
    const msg = parseTabSyncMessage(e.data);
    if (msg) onEvents(msg.events, msg.from.startsWith("cloud-sync:"));
  };
  return {
    // The editor's own channel object receives this as a change from another
    // tab, and reacts the way it always does to one.
    post: (events) => {
      try {
        ch.postMessage({ v: 1, from: SOURCE, events });
      } catch {
        /* closed */
      }
    },
    close: () => ch.close(),
  };
}

function makeEngine(userId: string, announce: (e: TabSyncEvent[]) => void): SyncEngine {
  return new SyncEngine({
    userId,
    api: httpCloudApi,
    // Its own connection to the app's library database — like another tab.
    storage: new IndexedDBStorageAdapter(),
    snapshots: snapshotStore,
    assets: assetStore,
    announce,
    kv: safeStorage,
  });
}

/**
 * The first sign-in in a browser that was used signed out: when the account
 * already has notes, the first-visit notes seeded here (still untouched) are
 * removed instead of uploaded, so each device does not add its own Welcome,
 * Getting started and Changelog to the account. They were never in the
 * account, so nothing is deleted there. Everything the visitor wrote stays and
 * syncs. Returns how many notes the library still holds.
 */
async function dropStarterCopies(storage: IndexedDBStorageAdapter, docs: DocumentSummary[]): Promise<number> {
  const starters = untouchedStarterIds(docs);
  if (starters.size === 0) return docs.length;
  try {
    const state = await httpCloudApi.state();
    if (!state.documents.some((d) => !d.deleted)) return docs.length; // the account's first device: keep them
    for (const id of starters) await storage.delete(id);
    const prefs = await storage.getPrefs();
    const active = prefs["lastActiveDocId"];
    await storage.setPrefs({
      folderTree: withoutNotes(prefs["folderTree"], starters),
      ...(typeof active === "string" && starters.has(active) ? { lastActiveDocId: null } : {}),
    });
    return docs.length - starters.size;
  } catch {
    return docs.length; // offline or failing: keep everything, sync merges later
  }
}

/**
 * Before the editor opens for a signed-in visitor: claim this browser's library
 * for the account (or refuse, if another account owns it), and when the
 * library here is EMPTY (a new device, or a browser that wiped its storage)
 * bring the account's documents down first, so the editor opens on them rather
 * than seeding the starter notes as if this were a first visit.
 */
export async function prepareCloudLibrary(userId: string): Promise<"ready" | "blocked"> {
  const owner = libraryOwner();
  if (owner && owner !== userId) {
    setPhase("blocked");
    return "blocked";
  }
  const storage = new IndexedDBStorageAdapter();
  let empty = false;
  try {
    const docs = await storage.list();
    empty = (owner ? docs.length : await dropStarterCopies(storage, docs)) === 0;
  } catch {
    /* unreadable: let the editor report it */
  }
  if (!owner) safeStorage.set(OWNER_KEY, userId);
  if (!empty) return "ready";
  setPhase("preparing");
  try {
    await makeEngine(userId, () => {}).cycle();
    setPhase("synced", true);
  } catch (e) {
    // Offline or failing: the editor opens anyway; the next cycle catches up.
    setPhase(e instanceof CloudError && e.offline ? "offline" : "error");
  }
  return "ready";
}

/** Run cloud sync for this session. Returns the stop function. */
export function startCloudSync(userId: string): () => void {
  if (libraryOwner() !== userId) {
    setPhase("blocked");
    return () => {};
  }
  let stopped = false;
  let paused = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let rerun = false;

  const channel = openChannel((events, fromSync) => {
    if (fromSync) return; // another tab's sync: nothing new in the library
    for (const e of events) {
      if (e.type === "deleted") engine.recordLocalDelete(e.id);
      if (e.type === "cleared") {
        // "Erase all local data": forget this device's sync state, and do not
        // download everything again in this page — that is what erasing asked for.
        engine.reset();
        paused = true;
        setPhase("off");
      }
    }
    schedule(SETTLE_MS);
  });
  const engine = makeEngine(userId, channel.post);
  const unregisterVersions = setAccountVersions(accountVersionsProvider(httpAccountArchive, snapshotStore));

  let nextBackupAt = Date.now() + BACKUP_DELAY_MS;
  const dailyBackup = async () => {
    if (Date.now() < nextBackupAt || backedUpToday(userId, backupDeps)) return;
    try {
      const outcome = await backUpToAccount(userId, backupDeps);
      // Nothing to back up, or it cannot be: not again on every cycle.
      if (outcome !== "stored" && outcome !== "exists") nextBackupAt = Date.now() + BACKUP_RETRY_MS;
    } catch {
      nextBackupAt = Date.now() + BACKUP_RETRY_MS; // never the sync's failure
    }
  };

  const run = async () => {
    if (stopped || paused) return;
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    setPhase("syncing");
    try {
      const work = async () => {
        const r = await engine.cycle();
        if (r.again) rerun = true;
        await dailyBackup();
      };
      const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
      if (locks) await locks.request(`pf-cloud-sync:${userId}`, { ifAvailable: true }, async (lock) => (lock ? work() : undefined));
      else await work();
      if (!stopped) setPhase("synced", true);
    } catch (e) {
      if (!stopped) setPhase(e instanceof CloudError && e.offline ? "offline" : "error");
    } finally {
      running = false;
      if (rerun && !stopped) {
        rerun = false;
        schedule(SETTLE_MS);
      }
    }
  };

  function schedule(ms: number) {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, ms);
  }

  const onWake = () => schedule(0);
  const interval = setInterval(() => void run(), INTERVAL_MS);
  window.addEventListener("focus", onWake);
  window.addEventListener("online", onWake);
  schedule(0);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    clearInterval(interval);
    window.removeEventListener("focus", onWake);
    window.removeEventListener("online", onWake);
    channel.close();
    unregisterVersions();
    setPhase("off");
  };
}
