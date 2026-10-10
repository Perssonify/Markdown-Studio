import type { DocumentRecord } from "@/store/documents/document";
import type { SyncedTree } from "./folder-merge";

/** The account's view of one document (or its tombstone). */
export interface ServerDocument {
  id: string;
  title: string;
  updated: string;
  deleted: boolean;
  size: number;
}

export interface ServerState {
  documents: ServerDocument[];
  library: { tree: SyncedTree; updated: string } | null;
}

export type WriteResult = { ok: true } | { ok: false; current: { updated: string; deleted: boolean } | null };

export interface PresignedTransfer {
  hash: string;
  url: string;
  headers?: Record<string, string>;
  mime?: string;
}

/**
 * The account's side of sync (apps/api/src/modules/sync/routes/index.ts). An interface, so
 * the sync engine is tested against an in-memory account
 * (cloud-sync.test.js) and runs against the real one here.
 */
export interface CloudApi {
  state(): Promise<ServerState>;
  /** The document, or null when the account has none (or only a tombstone). */
  getDocument(id: string): Promise<DocumentRecord | null>;
  putDocument(id: string, base: string | null, record: DocumentRecord): Promise<WriteResult>;
  deleteDocument(id: string, base: string, at: string): Promise<WriteResult>;
  /** Store the folder tree; the account issues the new revision (`updated`). */
  putLibrary(base: string | null, tree: SyncedTree): Promise<{ ok: true; updated: string } | { ok: false }>;
  assetUploads(assets: { hash: string; mime: string; size: number }[]): Promise<{ uploads: PresignedTransfer[]; present: string[] }>;
  commitAssets(hashes: string[]): Promise<{ committed: string[]; missing: string[] }>;
  assetDownloads(hashes: string[]): Promise<{ downloads: PresignedTransfer[]; missing: string[] }>;
  /** Move bytes to / from a presigned URL (S3 directly, not the API). */
  putBytes(t: PresignedTransfer, bytes: Uint8Array): Promise<void>;
  getBytes(t: PresignedTransfer): Promise<Uint8Array>;
}

/** One past version of a note the account keeps (30 days). `latest` is the one synced now. */
export interface AccountVersionInfo {
  id: string;
  at: number;
  size: number;
  latest: boolean;
}

/** One day's full backup in the account. `date` is the day it is for (YYYY-MM-DD). */
export interface BackupInfo {
  date: string;
  size: number;
  at: number;
}

/**
 * What the account keeps beside the synced library: past versions of each
 * note, and a full backup a day. Not part of sync, so not on CloudApi.
 */
export interface AccountArchiveApi {
  listVersions(docId: string): Promise<AccountVersionInfo[]>;
  /** That version's document, or null when the account no longer has it. */
  getVersion(docId: string, versionId: string): Promise<DocumentRecord | null>;
  /** Where to upload that day's backup, or `exists` when it is already there (and not `force`). */
  backupUpload(b: { date: string; size: number; sha256: string; force?: boolean }): Promise<{ exists: true } | { exists: false; upload: PresignedTransfer }>;
  listBackups(): Promise<BackupInfo[]>;
  /** A short-lived download link for one backup. */
  backupDownloadUrl(date: string): Promise<string>;
  putBytes(t: PresignedTransfer, bytes: Uint8Array): Promise<void>;
}

/** A failed call. `offline` when the network itself failed (no response at all). */
export class CloudError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly offline = false,
  ) {
    super(message);
    this.name = "CloudError";
  }
}

const BASE = "/api/sync";
/** The API refuses writes without it: a cross-site page cannot set it. */
const WRITE_HEADERS = { "X-Requested-With": "markdown-studio" };

async function gzip(text: string): Promise<{ body: BodyInit; encoded: boolean }> {
  if (typeof CompressionStream === "undefined") return { body: text, encoded: false };
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return { body: await new Response(stream).arrayBuffer(), encoded: true };
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { credentials: "same-origin", cache: "no-store", ...init });
  } catch (e) {
    throw new CloudError(e instanceof Error ? e.message : "network error", 0, true);
  }
  return res;
}

async function ok<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new CloudError(`${what} failed (${res.status})`, res.status);
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { ...WRITE_HEADERS, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** What leaves the browser: the stored record, minus the original import text (as in exports). */
export function outgoingRecord(record: DocumentRecord): DocumentRecord {
  return { ...record, origin: record.origin ? { ...record.origin, raw: null, alternates: null } : record.origin };
}

/** Upload straight to S3 with a presigned URL (the API never carries the bytes). */
async function putBytes(t: PresignedTransfer, bytes: Uint8Array): Promise<void> {
  let res: Response;
  try {
    res = await fetch(t.url, { method: "PUT", headers: t.headers, body: bytes as BufferSource });
  } catch (e) {
    throw new CloudError(e instanceof Error ? e.message : "network error", 0, true);
  }
  if (!res.ok) throw new CloudError(`upload failed (${res.status})`, res.status);
}

export const httpCloudApi: CloudApi = {
  async state() {
    return ok<ServerState>(await call("/state"), "sync state");
  },
  async getDocument(id) {
    const res = await call(`/documents/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    return ok<DocumentRecord>(res, "download");
  },
  async putDocument(id, base, record) {
    const { body, encoded } = await gzip(JSON.stringify({ base, record: outgoingRecord(record) }));
    const res = await call(`/documents/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { ...WRITE_HEADERS, "Content-Type": "application/json", ...(encoded ? { "Content-Encoding": "gzip" } : {}) },
      body,
    });
    if (res.status === 409) return { ok: false, current: ((await res.json()) as { current: { updated: string; deleted: boolean } | null }).current };
    await ok(res, "upload");
    return { ok: true };
  },
  async deleteDocument(id, base, at) {
    const q = `base=${encodeURIComponent(base)}&at=${encodeURIComponent(at)}`;
    const res = await call(`/documents/${encodeURIComponent(id)}?${q}`, { method: "DELETE", headers: WRITE_HEADERS });
    if (res.status === 409) return { ok: false, current: ((await res.json()) as { current: { updated: string; deleted: boolean } | null }).current };
    await ok(res, "delete");
    return { ok: true };
  },
  async putLibrary(base, tree) {
    const res = await call("/library", { ...json({ base, tree }), method: "PUT" });
    if (res.status === 409) return { ok: false };
    const { updated } = await ok<{ updated: string }>(res, "folder sync");
    return { ok: true, updated };
  },
  async assetUploads(assets) {
    return ok(await call("/assets/upload", json({ assets })), "image upload links");
  },
  async commitAssets(hashes) {
    return ok(await call("/assets/commit", json({ hashes })), "image commit");
  },
  async assetDownloads(hashes) {
    return ok(await call("/assets/download", json({ hashes })), "image download links");
  },
  putBytes,
  async getBytes(t) {
    let res: Response;
    try {
      res = await fetch(t.url);
    } catch (e) {
      throw new CloudError(e instanceof Error ? e.message : "network error", 0, true);
    }
    if (!res.ok) throw new CloudError(`image download failed (${res.status})`, res.status);
    return new Uint8Array(await res.arrayBuffer());
  },
};

export const httpAccountArchive: AccountArchiveApi = {
  async listVersions(docId) {
    const { versions } = await ok<{ versions: AccountVersionInfo[] }>(await call(`/documents/${encodeURIComponent(docId)}/versions`), "versions");
    return versions;
  },
  async getVersion(docId, versionId) {
    const res = await call(`/documents/${encodeURIComponent(docId)}/versions/${encodeURIComponent(versionId)}`);
    if (res.status === 404) return null;
    return ok<DocumentRecord>(res, "version");
  },
  async backupUpload(b) {
    return ok(await call("/backups/upload", json(b)), "backup upload link");
  },
  async listBackups() {
    const { backups } = await ok<{ backups: BackupInfo[] }>(await call("/backups"), "backups");
    return backups;
  },
  async backupDownloadUrl(date) {
    const { url } = await ok<{ url: string }>(await call(`/backups/${encodeURIComponent(date)}`), "backup download link");
    return url;
  },
  putBytes,
};
