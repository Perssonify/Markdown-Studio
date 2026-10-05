import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "../config/env.ts";

export interface StorageOptions {
  bucket: string;
  region: string;
  /** An S3-compatible server (local development); omit for Amazon S3. */
  endpoint?: string;
  forcePathStyle?: boolean;
  /** Explicit keys (local development). Omitted on AWS: the Lambda's role is used. */
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

export interface StoredObject {
  body: Uint8Array;
  contentType: string | null;
  contentEncoding: string | null;
}

export interface PutOptions {
  contentType?: string;
  /** e.g. "gzip": the bytes are stored compressed and served with that encoding. */
  contentEncoding?: string;
}

/** A presigned upload: PUT the bytes to `url` with exactly these headers. */
export interface PresignedUpload {
  url: string;
  headers: Record<string, string>;
}

/**
 * Files in one S3 bucket (users' documents and images). Browsers move image
 * bytes directly with presigned URLs; documents go through the API, which
 * checks each write against the database first (routes/sync.ts).
 */
export interface Storage {
  readonly bucket: string;
  /** One round trip to the bucket, bounded by `timeoutMs`. Throws when it is unreachable. */
  ping(timeoutMs?: number): Promise<void>;
  put(key: string, body: Uint8Array | string, contentType?: string | PutOptions): Promise<void>;
  /** The object (or one past `versionId` of it), or null when there is none. */
  get(key: string, versionId?: string): Promise<StoredObject | null>;
  /** The stored versions of one key (up to about `max`), newest first (delete markers left out). */
  listVersions(key: string, max?: number): Promise<{ versionId: string; lastModified: number; size: number; isLatest: boolean }[]>;
  /** Objects under a prefix (at most 1000), with their sizes. */
  list(prefix: string): Promise<{ key: string; lastModified: number; size: number }[]>;
  /** Size and type, or null when there is none under `key`. */
  head(key: string): Promise<{ size: number; contentType: string | null; sha256: string | null } | null>;
  /** Deletes the object; deleting a key that does not exist is not an error (S3 semantics). */
  remove(key: string): Promise<void>;
  /**
   * A URL to upload ONE object, valid `expiresIn` seconds. With `sha256`
   * (base64 of the SHA-256 of the bytes), S3 itself refuses any upload whose
   * bytes do not match — the content-address cannot be forged.
   */
  presignPut(key: string, o: { contentType: string; sha256?: string; tagging?: string; expiresIn?: number }): Promise<PresignedUpload>;
  /** A URL to download ONE object, valid `expiresIn` seconds; `filename` makes the browser save it under that name. */
  presignGet(key: string, o?: { expiresIn?: number; filename?: string }): Promise<string>;
}

/**
 * Keys are `/`-separated paths that cannot climb or start at a root: what a
 * caller builds from user input (an id, a filename) must not reach another
 * user's prefix by way of `..`.
 */
export function assertKey(key: string): void {
  if (!key || key.length > 1024) throw new Error("storage key must be 1–1024 characters");
  if (key.startsWith("/") || key.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`storage key is not a plain path: ${JSON.stringify(key)}`);
  }
}

const notFound = (err: unknown) =>
  err instanceof NoSuchKey || err instanceof NotFound || ["NoSuchKey", "NotFound"].includes((err as { name?: string }).name ?? "");

export function createStorage(o: StorageOptions): Storage {
  const client = new S3Client({
    region: o.region,
    endpoint: o.endpoint,
    forcePathStyle: o.forcePathStyle,
    credentials: o.credentials,
    // Checksums only where asked for: the SDK's default adds a CRC32 to every
    // upload, which a presigned URL would then demand from the browser.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return {
    bucket: o.bucket,
    async ping(timeoutMs = 2_000) {
      await client.send(new HeadBucketCommand({ Bucket: o.bucket }), { abortSignal: AbortSignal.timeout(timeoutMs) });
    },
    async put(key, body, opts) {
      assertKey(key);
      const { contentType, contentEncoding } = typeof opts === "string" ? { contentType: opts, contentEncoding: undefined } : (opts ?? {});
      await client.send(
        new PutObjectCommand({ Bucket: o.bucket, Key: key, Body: body, ContentType: contentType, ContentEncoding: contentEncoding }),
      );
    },
    async get(key, versionId) {
      assertKey(key);
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: o.bucket, Key: key, VersionId: versionId }));
        if (!out.Body) return null;
        return {
          body: await out.Body.transformToByteArray(),
          contentType: out.ContentType ?? null,
          contentEncoding: out.ContentEncoding ?? null,
        };
      } catch (err) {
        if (notFound(err)) return null;
        throw err;
      }
    },
    async listVersions(key, max = 10_000) {
      assertKey(key);
      const found: { versionId: string; lastModified: number; size: number; isLatest: boolean }[] = [];
      let keyMarker: string | undefined;
      let versionIdMarker: string | undefined;
      // A note synced as it is typed has a version per save: page through them.
      do {
        const out = await client.send(
          new ListObjectVersionsCommand({ Bucket: o.bucket, Prefix: key, KeyMarker: keyMarker, VersionIdMarker: versionIdMarker }),
        );
        for (const v of out.Versions ?? []) {
          if (v.Key !== key || !v.VersionId || v.VersionId === "null") continue;
          found.push({ versionId: v.VersionId, lastModified: v.LastModified?.getTime() ?? 0, size: v.Size ?? 0, isLatest: !!v.IsLatest });
        }
        keyMarker = out.IsTruncated ? out.NextKeyMarker : undefined;
        versionIdMarker = out.IsTruncated ? out.NextVersionIdMarker : undefined;
      } while (keyMarker && found.length < max);
      return found.sort((a, b) => b.lastModified - a.lastModified);
    },
    async list(prefix) {
      assertKey(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix);
      const out = await client.send(new ListObjectsV2Command({ Bucket: o.bucket, Prefix: prefix }));
      return (out.Contents ?? []).map((c) => ({ key: c.Key!, lastModified: c.LastModified?.getTime() ?? 0, size: c.Size ?? 0 }));
    },
    async head(key) {
      assertKey(key);
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: o.bucket, Key: key, ChecksumMode: "ENABLED" }));
        return { size: out.ContentLength ?? 0, contentType: out.ContentType ?? null, sha256: out.ChecksumSHA256 ?? null };
      } catch (err) {
        if (notFound(err)) return null;
        throw err;
      }
    },
    async remove(key) {
      assertKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: o.bucket, Key: key }));
    },
    async presignPut(key, p) {
      assertKey(key);
      const command = new PutObjectCommand({ Bucket: o.bucket, Key: key, ContentType: p.contentType, ChecksumSHA256: p.sha256, Tagging: p.tagging });
      // Kept as SIGNED HEADERS, not query parameters, so the browser must send
      // them and S3 checks the body against the checksum.
      const unhoistable = new Set(["content-type", ...(p.sha256 ? ["x-amz-checksum-sha256"] : []), ...(p.tagging ? ["x-amz-tagging"] : [])]);
      const url = await getSignedUrl(client, command, { expiresIn: p.expiresIn ?? 600, unhoistableHeaders: unhoistable, signableHeaders: unhoistable });
      const headers: Record<string, string> = { "Content-Type": p.contentType };
      if (p.sha256) headers["x-amz-checksum-sha256"] = p.sha256;
      if (p.tagging) headers["x-amz-tagging"] = p.tagging;
      return { url, headers };
    },
    async presignGet(key, p) {
      assertKey(key);
      const disposition = p?.filename ? `attachment; filename="${p.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"` : undefined;
      return getSignedUrl(client, new GetObjectCommand({ Bucket: o.bucket, Key: key, ResponseContentDisposition: disposition }), { expiresIn: p?.expiresIn ?? 600 });
    },
  };
}

/** Storage when S3_BUCKET is set, else null (/health then reports `not_configured`). */
export function storageFromEnv(env: Env): Storage | null {
  if (!env.S3_BUCKET) return null;
  return createStorage({
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials:
      env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
        : undefined,
  });
}
