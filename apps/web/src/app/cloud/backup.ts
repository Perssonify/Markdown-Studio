import { sha256Hex } from "@/store/assets/asset-store";
import { buildBackupZip, type BackupSources } from "../../utils/emergency-backup";
import type { AccountArchiveApi } from "./api";

/**
 * A full backup a day in the account: the same archive File ▸ Export ▸ Full
 * backup makes (documents in their folders, and their images), which Import
 * restores. The browser builds it and uploads it straight to S3; the account
 * keeps 30 days of them (the bucket's lifecycle rule, infra FilesStack).
 *
 * Once a day per account: the first device to sync that day stores it, and
 * every other device sees it is there.
 */

/** The API's limit on one backup (apps/api/src/modules/sync/routes/index.ts). */
export const MAX_BACKUP_BYTES = 1024 * 1024 * 1024;

const doneKey = (userId: string) => `pf:cloud-backup:${userId}`;

/** The day a backup is for: the user's own calendar day, YYYY-MM-DD. */
export function backupDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface BackupDeps {
  api: AccountArchiveApi;
  sources: () => BackupSources;
  kv: { get(key: string): string | null; set(key: string, value: string): void };
  /** Told when the account holds today's backup (the "back up your notes" reminder). */
  backedUp?: () => void;
  now?: () => Date;
}

export type BackupOutcome = "stored" | "exists" | "empty" | "too-large" | "unavailable";

/** Whether today's backup is already known to be in the account. */
export function backedUpToday(userId: string, deps: Pick<BackupDeps, "kv" | "now">): boolean {
  return deps.kv.get(doneKey(userId)) === backupDay((deps.now ?? (() => new Date()))());
}

/**
 * Store today's backup in the account, unless it already has one. `force`
 * (Back up now) replaces today's with the library as it is now.
 */
export async function backUpToAccount(userId: string, deps: BackupDeps, { force = false } = {}): Promise<BackupOutcome> {
  if (!force && backedUpToday(userId, deps)) return "exists";
  const date = backupDay((deps.now ?? (() => new Date()))());
  const { zip, count } = await buildBackupZip(deps.sources());
  if (!count) return "empty";
  if (zip.length > MAX_BACKUP_BYTES) return "too-large";
  const sha256 = await sha256Hex(zip);
  if (!sha256) return "unavailable"; // no WebCrypto (an insecure context)
  const r = await deps.api.backupUpload({ date, size: zip.length, sha256, force });
  if (!r.exists) await deps.api.putBytes(r.upload, zip);
  deps.kv.set(doneKey(userId), date);
  deps.backedUp?.();
  return r.exists ? "exists" : "stored";
}
