import { collectAssetRefs } from "@/store/assets/asset-refs";
import { sha256Hex } from "@/store/assets/asset-store";
import type { DocumentRecord } from "@/store/documents/document";
import type { SnapshotReason } from "@/store/history/snapshot-store";
import type { StorageAdapter } from "@/store/persistence/storage-adapter";
import type { TabSyncEvent } from "@/store/persistence/tab-sync";
import { buildLiveDocument, type LiveDocument } from "@/store/documents/live-share";
import { isUnchanged, type CloudApi, type PresignedTransfer, type PublishedEntry, type ServerState } from "./api";
import { EMPTY_TREE, mergeTrees, syncedPart, treeSignature, type SyncedTree } from "./folder-merge";
import { planSync, type SyncAction, type SyncedRevision } from "./plan";

/**
 * One device's side of cloud sync: compare this browser's library with the
 * account's, then move what changed — documents, the images they use, and the
 * folder tree.
 *
 * It works the way ANOTHER TAB of the same library does: it reads and writes
 * the browser's document storage directly, and tells the editor what it
 * changed through the tab-sync channel (`announce`). So everything the editor
 * already does about a change from elsewhere applies unchanged: a closed note's
 * listing refreshes, an open note with no unsaved edits reloads, and an open
 * note WITH unsaved edits gets the "Keep mine / Use theirs / Save mine as a
 * copy" notice — the cloud can never type over what the user is writing.
 *
 * Nothing is lost on this side either: before a local copy is replaced or
 * deleted, it goes to Version history (`snapshots`); when the account's version
 * loses a conflict, it too is kept in this device's Version history.
 */

export interface AssetStoreLike {
  hasMany(hashes: Iterable<string>): Promise<Set<string>>;
  get(hash: string): Promise<{ mime: string; bytes: Uint8Array } | null>;
  put(bytes: Uint8Array, mime: string): Promise<string | null>;
}

export interface SnapshotsLike {
  record(docId: string, title: string, canonical: unknown, reason: SnapshotReason): Promise<unknown>;
}

export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): boolean | void;
}

export interface EngineDeps {
  userId: string;
  api: CloudApi;
  storage: StorageAdapter;
  snapshots: SnapshotsLike;
  assets: AssetStoreLike;
  /** Tell the editor (and other tabs) what changed — the tab-sync channel. */
  announce: (events: TabSyncEvent[]) => void;
  kv: KeyValue;
  now?: () => string;
  /**
   * Live shares (app/publish). The account lists the documents it publishes
   * and the revision each live copy holds; the engine publishes again any of
   * them that is newer here. (Deleting a note stops its share on the server,
   * in the deletion itself.)
   */
  publish?: {
    seen(entries: PublishedEntry[]): void;
    /** Update an EXISTING share — `id` is the one it must still have; the
     *  server refuses a share that was stopped meanwhile. */
    put(docId: string, live: LiveDocument, id: string): Promise<unknown>;
    /** Why a share is not keeping up (null: it is). */
    problem?(docId: string, problem: "too-large" | null): void;
  };
}

interface PersistedState {
  v: 1;
  docs: Record<string, SyncedRevision>;
  tree: { base: SyncedTree | null; server: string | null };
  /** Images the account is known to have. */
  uploaded: string[];
  /** Images a downloaded document needs that could not be fetched yet. */
  assetRetry: string[];
}

export interface CycleResult {
  pulled: number;
  pushed: number;
  deletedHere: number;
  deletedThere: number;
  conflicts: number;
  /** Something changed on the account meanwhile: run again soon. */
  again: boolean;
  /** Documents whose id the account cannot store (kept on this device only). */
  skipped: string[];
}

/** The ids the account accepts (apps/api/src/modules/sync/routes/index.ts DOC_ID). */
export const SYNCABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const BATCH = 100;

const freshState = (): PersistedState => ({ v: 1, docs: {}, tree: { base: null, server: null }, uploaded: [], assetRetry: [] });
const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Local writes first (so pushes see the merged library), the account's last. */
const ORDER: Record<SyncAction["kind"], number> = { pull: 0, deleteLocal: 0, conflict: 1, markSynced: 2, forget: 2, push: 3, deleteRemote: 3 };

export class SyncEngine {
  private readonly now: () => string;
  /** The account's state as last read, with its `version`: while the account
   *  says it is unchanged, a cycle plans from this instead of reading it again. */
  private lastState: ServerState | null = null;
  /** docId → the revision that could not be published, so it is not rebuilt
   *  (every image read, encoded and compressed) on every cycle until it moves. */
  private readonly publishFailed = new Map<string, string>();
  constructor(private readonly d: EngineDeps) {
    this.now = d.now ?? (() => new Date().toISOString());
  }

  private get stateKey() {
    return `pf:cloud-sync:v1:${this.d.userId}`;
  }
  private get pendingKey() {
    return `pf:cloud-sync:v1:${this.d.userId}:deleted`;
  }

  private load(): PersistedState {
    try {
      const s = JSON.parse(this.d.kv.get(this.stateKey) ?? "null") as PersistedState | null;
      if (s && s.v === 1 && isMap(s.docs)) return { ...freshState(), ...s };
    } catch {
      /* unreadable: start over (a fresh state only ever re-downloads) */
    }
    return freshState();
  }
  private save(s: PersistedState) {
    this.d.kv.set(this.stateKey, JSON.stringify(s));
  }
  private loadPending(): Record<string, string> {
    try {
      const p = JSON.parse(this.d.kv.get(this.pendingKey) ?? "{}") as unknown;
      return isMap(p) ? (p as Record<string, string>) : {};
    } catch {
      return {};
    }
  }
  private savePending(p: Record<string, string>) {
    this.d.kv.set(this.pendingKey, JSON.stringify(p));
  }
  /**
   * Drop the deletions this cycle has finished with from the STORED list. A
   * cycle used to write back the copy it loaded when it started, so a note
   * deleted while it ran (recordLocalDelete, from the channel) was erased from
   * the list — and the next cycle, finding it missing here and present in the
   * account, downloaded it again.
   */
  private settlePending(done: ReadonlySet<string>) {
    if (!done.size) return;
    const stored = this.loadPending();
    let changed = false;
    for (const id of done) {
      if (id in stored) {
        delete stored[id];
        changed = true;
      }
    }
    if (changed) this.savePending(stored);
  }

  /** The account's state, read again only when it has changed since the last cycle. */
  private async serverState(): Promise<ServerState> {
    const since = this.lastState?.version ?? null;
    let reply = await this.d.api.state(since);
    if (isUnchanged(reply)) {
      if (this.lastState) return this.lastState;
      reply = await this.d.api.state(); // nothing to fall back on: read it all
      if (isUnchanged(reply)) throw new Error("the account answered unchanged to a full read");
    }
    this.lastState = reply.version ? reply : null;
    return reply;
  }

  /**
   * The editor deleted a document in this browser: delete it in the account at
   * the next cycle. This is the ONLY way a document is deleted there.
   */
  recordLocalDelete(id: string, at = this.now()): void {
    const p = this.loadPending();
    if (!p[id]) {
      p[id] = at;
      this.savePending(p);
    }
  }

  /** Forget everything this device knew about the account (local data was erased). */
  reset(): void {
    this.save(freshState());
    this.savePending({});
    this.lastState = null;
  }

  async cycle(progress?: (done: number, total: number) => void): Promise<CycleResult> {
    const state = this.load();
    const pending = this.loadPending();
    const server = await this.serverState();
    const result: CycleResult = { pulled: 0, pushed: 0, deletedHere: 0, deletedThere: 0, conflicts: 0, again: false, skipped: [] };

    const local = new Map<string, { updated: string }>();
    for (const s of await this.d.storage.list()) {
      if (SYNCABLE_ID.test(s.id)) local.set(s.id, { updated: s.updated });
      else result.skipped.push(s.id);
    }
    const serverMap = new Map(server.documents.map((d) => [d.id, { updated: d.updated, deleted: d.deleted }]));
    const actions = planSync({ local, server: serverMap, synced: state.docs, pendingDeletes: pending }).sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
    const uploaded = new Set(state.uploaded);
    const retry = new Set(state.assetRetry);

    let done = 0;
    progress?.(0, actions.length);
    for (const a of actions) {
      const settled = new Set<string>();
      await this.apply(a, state, settled, result, uploaded, retry, local.get(a.id)?.updated ?? null);
      state.uploaded = [...uploaded];
      state.assetRetry = [...retry];
      this.save(state);
      this.settlePending(settled);
      progress?.(++done, actions.length);
    }

    await this.syncTree(state, server.library, result);
    await this.syncPublished(server.published ?? [], local);
    if (retry.size) await this.downloadAssets([...retry], uploaded, retry);
    state.uploaded = [...uploaded];
    state.assetRetry = [...retry];
    this.save(state);
    return result;
  }

  /**
   * `planned` is the local revision the plan was made from (null: none here).
   * Anything that replaces or removes the local copy first checks it is still
   * that one: the user may have saved a newer one — in this tab or another —
   * while the account was being read, and that save must not be written over.
   */
  private async apply(
    a: SyncAction,
    state: PersistedState,
    settled: Set<string>,
    r: CycleResult,
    uploaded: Set<string>,
    retry: Set<string>,
    planned: string | null,
  ): Promise<void> {
    switch (a.kind) {
      case "markSynced":
        state.docs[a.id] = { local: a.revision, server: a.revision };
        return;
      case "forget":
        delete state.docs[a.id];
        settled.add(a.id);
        return;
      case "pull": {
        const outcome = await this.pull(a.id, state, uploaded, retry, false, planned);
        if (outcome === "pulled") r.pulled++;
        if (outcome === "changed") r.again = true;
        else settled.add(a.id);
        return;
      }
      case "push":
        if (await this.push(a.id, a.base, state, uploaded)) r.pushed++;
        else r.again = true;
        return;
      case "deleteLocal":
        if (await this.deleteLocal(a.id, state, planned)) r.deletedHere++;
        else r.again = true;
        return;
      case "deleteRemote": {
        const res = await this.d.api.deleteDocument(a.id, a.base, a.at);
        if (res.ok) {
          delete state.docs[a.id];
          settled.add(a.id);
          r.deletedThere++;
        } else r.again = true;
        return;
      }
      case "conflict": {
        r.conflicts++;
        if (a.winner === "local") {
          if (!a.server.deleted) {
            const theirs = await this.d.api.getDocument(a.id);
            if (theirs) await this.d.snapshots.record(a.id, theirs.title, theirs.canonical, "cloud-sync");
          }
          if (await this.push(a.id, a.server.updated, state, uploaded)) r.pushed++;
          else r.again = true;
        } else if (a.server.deleted) {
          if (await this.deleteLocal(a.id, state, planned)) r.deletedHere++;
          else r.again = true;
        } else {
          const mine = await this.readLocal(a.id);
          if (mine) await this.d.snapshots.record(a.id, mine.title, mine.canonical, "cloud-sync");
          const outcome = await this.pull(a.id, state, uploaded, retry, true, planned);
          if (outcome === "pulled") r.pulled++;
          if (outcome === "changed") r.again = true;
        }
        return;
      }
    }
  }

  private async readLocal(id: string): Promise<DocumentRecord | null> {
    try {
      return await this.d.storage.get(id);
    } catch {
      return null; // unreadable here: the account's copy replaces it
    }
  }

  /**
   * Is the local copy still the revision the plan was made from? An unreadable
   * one counts as unchanged — the account's copy is what repairs it, so refusing
   * here would leave it broken (and the cycle re-running for ever).
   */
  private async stillPlanned(id: string, planned: string | null): Promise<boolean> {
    try {
      return ((await this.d.storage.get(id))?.updated ?? null) === planned;
    } catch {
      return true;
    }
  }

  /**
   * The account's version replaces (or creates) the local one. "gone" when the
   * account has none any more; "changed" when the local copy is no longer the
   * one the plan saw (`planned`) — it is left alone and the next cycle decides.
   */
  private async pull(
    id: string,
    state: PersistedState,
    uploaded: Set<string>,
    retry: Set<string>,
    snapshotTaken: boolean,
    planned: string | null,
  ): Promise<"pulled" | "gone" | "changed"> {
    const rec = await this.d.api.getDocument(id);
    if (!rec) return "gone"; // deleted meanwhile: the next cycle sees the tombstone
    if (rec.id !== id || typeof rec.updated !== "string" || (rec.canonical as { type?: unknown } | undefined)?.type !== "doc") {
      throw new Error(`the account returned a malformed document for ${id}`);
    }
    const existing = snapshotTaken ? null : await this.readLocal(id);
    if (existing && JSON.stringify(existing.canonical) !== JSON.stringify(rec.canonical)) {
      await this.d.snapshots.record(id, existing.title, existing.canonical, "cloud-sync");
    }
    // Images first, so the editor finds them when it shows the note.
    await this.downloadAssets([...collectAssetRefs(rec.canonical)], uploaded, retry);
    // Reading the account and its images took a while: if a newer local save
    // landed meanwhile, writing the account's copy now would silently undo it
    // (the editor ignores the announcement, its own revision being newer).
    if (!(await this.stillPlanned(id, planned))) return "changed";
    await this.d.storage.save({ ...rec, _preserveUpdated: true } as DocumentRecord);
    state.docs[id] = { local: rec.updated, server: rec.updated };
    this.d.announce([{ type: "doc", id, updated: rec.updated }]);
    return "pulled";
  }

  /** Upload the local version. False when the account changed meanwhile (the next cycle decides again). */
  private async push(id: string, base: string | null, state: PersistedState, uploaded: Set<string>): Promise<boolean> {
    const rec = await this.readLocal(id);
    if (!rec) return true; // deleted meanwhile: the delete event handles it
    await this.uploadAssets(rec, uploaded);
    const res = await this.d.api.putDocument(id, base, rec);
    if (!res.ok) return false;
    state.docs[id] = { local: rec.updated, server: rec.updated };
    return true;
  }

  /** The account deleted it: delete it here. False when it was edited here since the plan (kept). */
  private async deleteLocal(id: string, state: PersistedState, planned: string | null): Promise<boolean> {
    if (!(await this.stillPlanned(id, planned))) return false;
    const existing = await this.readLocal(id);
    if (existing) await this.d.snapshots.record(id, existing.title, existing.canonical, "pre-delete");
    await this.d.storage.delete(id);
    delete state.docs[id];
    this.d.announce([{ type: "deleted", id }]);
    return true;
  }

  private async uploadAssets(rec: DocumentRecord, uploaded: Set<string>): Promise<void> {
    const wanted = [...collectAssetRefs(rec.canonical)].filter((h) => !uploaded.has(h));
    if (!wanted.length) return;
    const items: { hash: string; mime: string; size: number; bytes: Uint8Array }[] = [];
    for (const hash of wanted) {
      const a = await this.d.assets.get(hash);
      // An image this browser does not have stays missing on other devices too.
      if (a) items.push({ hash, mime: a.mime, size: a.bytes.byteLength, bytes: a.bytes });
    }
    for (const batch of chunks(items, BATCH)) {
      const { uploads, present } = await this.d.api.assetUploads(batch.map(({ hash, mime, size }) => ({ hash, mime, size })));
      for (const h of present) uploaded.add(h);
      for (const u of uploads) await this.d.api.putBytes(u, batch.find((b) => b.hash === u.hash)!.bytes);
      if (uploads.length) {
        const { committed } = await this.d.api.commitAssets(uploads.map((u) => u.hash));
        for (const h of committed) uploaded.add(h);
      }
    }
  }

  private async downloadAssets(hashes: string[], uploaded: Set<string>, retry: Set<string>): Promise<void> {
    if (!hashes.length) return;
    const have = await this.d.assets.hasMany(hashes);
    const missing = hashes.filter((h) => !have.has(h));
    for (const h of hashes) if (have.has(h)) retry.delete(h);
    for (const batch of chunks(missing, BATCH)) {
      const { downloads, missing: notThere } = await this.d.api.assetDownloads(batch);
      for (const h of notThere) retry.delete(h); // the account never had it
      for (const t of downloads) await this.fetchAsset(t, uploaded, retry);
    }
  }

  private async fetchAsset(t: PresignedTransfer, uploaded: Set<string>, retry: Set<string>): Promise<void> {
    try {
      const bytes = await this.d.api.getBytes(t);
      // Content-addressed: bytes that do not hash to their name are not that image.
      if ((await sha256Hex(bytes)) !== t.hash) throw new Error("image does not match its hash");
      if ((await this.d.assets.put(bytes, t.mime ?? "")) !== t.hash) throw new Error("image was not stored");
      uploaded.add(t.hash);
      retry.delete(t.hash);
    } catch {
      retry.add(t.hash); // tried again next cycle
    }
  }

  /**
   * Keep this account's live shares current: publish again each one whose
   * document here is at a newer revision than its live copy (it was edited —
   * on this device or another). Update only, under the share's id, so a cycle
   * that read the list before "Stop sharing live" cannot revive it. A failure
   * never fails the sync: an offline one is tried next cycle; one too large to
   * publish is not tried again until the document changes, and is reported.
   */
  private async syncPublished(entries: PublishedEntry[], local: ReadonlyMap<string, { updated: string }>): Promise<void> {
    const pub = this.d.publish;
    if (!pub) return;
    pub.seen(entries);
    for (const e of entries) {
      // The listing read at the start of the cycle rules most out without a
      // read; a document pulled this cycle is read to be sure.
      if (local.get(e.docId)?.updated === e.revision) continue;
      let rec: DocumentRecord | null = null;
      try {
        rec = await this.readLocal(e.docId);
        if (!rec || rec.updated === e.revision || this.publishFailed.get(e.docId) === rec.updated) continue;
        await pub.put(e.docId, await buildLiveDocument(rec, (hash) => this.d.assets.get(hash)), e.id);
        if (this.publishFailed.delete(e.docId)) pub.problem?.(e.docId, null);
      } catch (err) {
        if (rec && err instanceof Error && err.name === "PublishTooLargeError") {
          this.publishFailed.set(e.docId, rec.updated);
          pub.problem?.(e.docId, "too-large");
        }
        /* otherwise offline or refused: next cycle */
      }
    }
  }

  private async syncTree(state: PersistedState, remote: ServerState["library"], r: CycleResult): Promise<void> {
    const prefs = await this.d.storage.getPrefs();
    const rawLocal = prefs["folderTree"];
    const local = syncedPart(rawLocal);
    const remoteTree = remote ? syncedPart(remote.tree) : EMPTY_TREE;
    const base = state.tree.base;
    // Changes are judged by CONTENT against the last agreement — a revision
    // string says only that something was written.
    const baseSig = base ? treeSignature(base) : null;
    const localChanged = treeSignature(local) !== baseSig;
    const remoteChanged = !remote || treeSignature(remoteTree) !== baseSig;
    if (!localChanged && !remoteChanged && remote?.updated === state.tree.server) return;

    const merged = mergeTrees(base ?? EMPTY_TREE, local, remoteTree);

    if (treeSignature(merged) !== treeSignature(local)) {
      // The editor may have just changed the tree itself: never write over that.
      const again = syncedPart((await this.d.storage.getPrefs())["folderTree"]);
      if (treeSignature(again) !== treeSignature(local)) {
        r.again = true;
        return;
      }
      await this.d.storage.setPrefs({ folderTree: { ...(isMap(rawLocal) ? rawLocal : {}), ...merged } });
      this.d.announce([{ type: "library" }]);
    }

    if (!remote || treeSignature(merged) !== treeSignature(remoteTree)) {
      const res = await this.d.api.putLibrary(remote?.updated ?? null, merged);
      if (res.ok) state.tree = { base: merged, server: res.updated };
      else r.again = true;
    } else {
      state.tree = { base: merged, server: remote.updated };
    }
  }
}
