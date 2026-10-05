import type { AccountVersionsProvider } from "../../store/account-versions";
import { resolveDocTitle } from "../../store/document";
import type { SnapshotReason } from "../../store/snapshot-store";
import type { AccountArchiveApi } from "./api";
import { SYNCABLE_ID } from "./engine";

interface SnapshotsLike {
  record(docId: string, title: string, canonical: unknown, reason: SnapshotReason): Promise<number | null>;
}

/**
 * The account's past versions of a note, for Version history. The bucket keeps
 * every replaced version of a synced note for 30 days; bringing one back stores
 * it as an "account-version" snapshot, so the editor restores it — in place or
 * as a new note — exactly as it restores any other version.
 */
export function accountVersionsProvider(api: AccountArchiveApi, snapshots: SnapshotsLike): AccountVersionsProvider {
  return {
    async list(docId) {
      if (!SYNCABLE_ID.test(docId)) return [];
      return (await api.listVersions(docId)).filter((v) => !v.latest).map(({ id, at }) => ({ id, at }));
    },
    async bringBack(docId, versionId) {
      const record = await api.getVersion(docId, versionId);
      if (!record || record.id !== docId || !record.canonical) return null;
      return snapshots.record(docId, resolveDocTitle(record, record.canonical).title, record.canonical, "account-version");
    },
  };
}
