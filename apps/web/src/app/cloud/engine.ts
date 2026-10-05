import { collectAssetRefs } from "../../store/asset-refs";
import { sha256Hex } from "../../store/asset-store";
import type { DocumentRecord } from "../../store/document";
import type { SnapshotReason } from "../../store/snapshot-store";
import type { StorageAdapter } from "../../store/storage-adapter";
import type { TabSyncEvent } from "../../store/tab-sync";
import type { CloudApi, PresignedTransfer, ServerState } from "./api";
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

/** The ids the account accepts (apps/api/src/routes/sync.ts DOC_ID). */
export const SYNCABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const BATCH = 100;

const freshState = (): PersistedState => ({ v: 1, docs: {}, tree: { base: null, server: null }, uploaded: [], assetRetry: [] });
const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Local writes first (so pushes see the merged library), the account's last. */
const ORDER: Record<SyncAction["kind"], number> = { pull: 0, deleteLocal: 0, conflict: 1, markSynced: 2, forget: 2, push: 3, deleteRemote: 3 };

export class SyncEngine {
  private readonly now: () => string;
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
  }

  async cycle(progress?: (done: number, total: number) => void): Promise<CycleResult> {
    const state = this.load();
    const pending = this.loadPending();
    const server: ServerState = await this.d.api.state();
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
      await this.apply(a, state, pending, result, uploaded, retry);
      state.uploaded = [...uploaded];
      state.assetRetry = [...retry];
      this.save(state);
      this.savePending(pending);
      progress?.(++done, actions.length);
    }

    await this.syncTree(state, server.library, result);
    if (retry.size) await this.downloadAssets([...retry], uploaded, retry);
    state.uploaded = [...uploaded];
    state.assetRetry = [...retry];
    this.save(state);
    return result;
  }

  private async apply(
    a: SyncAction,
    state: PersistedState,
    pending: Record<string, string>,
    r: CycleResult,
    uploaded: Set<string>,
    retry: Set<string>,
  ): Promise<void> {
    switch (a.kind) {
      case "markSynced":
        state.docs[a.id] = { local: a.revision, server: a.revision };
        return;
      case "forget":
        delete state.docs[a.id];
        delete pending[a.id];
        return;
      case "pull":
        if (await this.pull(a.id, state, uploaded, retry, false)) r.pulled++;
        delete pending[a.id];
        return;
      case "push":
        if (await this.push(a.id, a.base, state, uploaded)) r.pushed++;
        else r.again = true;
        return;
      case "deleteLocal":
        await this.deleteLocal(a.id, state);
        r.deletedHere++;
        return;
      case "deleteRemote": {
        const res = await this.d.api.deleteDocument(a.id, a.base, a.at);
        if (res.ok) {
          delete state.docs[a.id];
          delete pending[a.id];
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
          await this.deleteLocal(a.id, state);
          r.deletedHere++;
        } else {
          const mine = await this.readLocal(a.id);
          if (mine) await this.d.snapshots.record(a.id, mine.title, mine.canonical, "cloud-sync");
          if (await this.pull(a.id, state, uploaded, retry, true)) r.pulled++;
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

  /** The account's version replaces (or creates) the local one. False when the account has none any more. */
  private async pull(id: string, state: PersistedState, uploaded: Set<string>, retry: Set<string>, snapshotTaken: boolean): Promise<boolean> {
    const rec = await this.d.api.getDocument(id);
    if (!rec) return false; // deleted meanwhile: the next cycle sees the tombstone
    if (rec.id !== id || typeof rec.updated !== "string" || (rec.canonical as { type?: unknown } | undefined)?.type !== "doc") {
      throw new Error(`the account returned a malformed document for ${id}`);
    }
    const existing = snapshotTaken ? null : await this.readLocal(id);
    if (existing && JSON.stringify(existing.canonical) !== JSON.stringify(rec.canonical)) {
      await this.d.snapshots.record(id, existing.title, existing.canonical, "cloud-sync");
    }
    // Images first, so the editor finds them when it shows the note.
    await this.downloadAssets([...collectAssetRefs(rec.canonical)], uploaded, retry);
    await this.d.storage.save({ ...rec, _preserveUpdated: true } as DocumentRecord);
    state.docs[id] = { local: rec.updated, server: rec.updated };
    this.d.announce([{ type: "doc", id, updated: rec.updated }]);
    return true;
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

  private async deleteLocal(id: string, state: PersistedState): Promise<void> {
    const existing = await this.readLocal(id);
    if (existing) await this.d.snapshots.record(id, existing.title, existing.canonical, "pre-delete");
    await this.d.storage.delete(id);
    delete state.docs[id];
    this.d.announce([{ type: "deleted", id }]);
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
