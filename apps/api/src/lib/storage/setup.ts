import { createHash } from "node:crypto";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  PutBucketVersioningCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { BACKUP_TAGGING } from "../../modules/sync/index.ts";
import { createStorage, type StorageOptions } from "./index.ts";

/**
 * Gets any S3-compatible bucket ready for the API (`bun run storage:setup`):
 * Amazon S3, MinIO, Cloudflare R2, Backblaze B2, a local container. The same
 * settings infra gives the production bucket (infra/lib/files-stack.ts), plus
 * a real signed upload, so a provider that cannot take one fails here and not
 * on a user's first image.
 *
 * Every step reports instead of throwing. Only the bucket and the image-style
 * upload are required; the rest switch on extras (version history in the
 * account, browser CORS, expiry, tagged backups), and a provider without one
 * of them still works without that extra.
 */
export type StepStatus = "ok" | "warn" | "fail";

export interface StepResult {
  step: string;
  status: StepStatus;
  detail: string;
}

export interface SetupOptions extends StorageOptions {
  /** Browser origins the editor runs on: they upload and download files with signed URLs. */
  origins: string[];
}

const errorCode = (err: unknown) => {
  const e = err as { name?: string; Code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  return e.name ?? e.Code ?? `HTTP ${e.$metadata?.httpStatusCode ?? "?"}`;
};

const DAYS = 30;

export async function setupStorage(o: SetupOptions): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const add = (step: string, status: StepStatus, detail: string) => results.push({ step, status, detail });
  const client = new S3Client({
    region: o.region,
    endpoint: o.endpoint,
    forcePathStyle: o.forcePathStyle,
    credentials: o.credentials,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  // 1. The bucket. Required.
  try {
    await client.send(new HeadBucketCommand({ Bucket: o.bucket }));
    add("Bucket", "ok", `${o.bucket} exists`);
  } catch (err) {
    if (!["NotFound", "NoSuchBucket"].includes(errorCode(err))) {
      add("Bucket", "fail", `cannot reach ${o.bucket} (${errorCode(err)}): check S3_ENDPOINT, S3_REGION and the keys`);
      return results;
    }
    try {
      // Amazon S3 outside us-east-1 needs the region named; other servers take the default.
      const named = !o.endpoint && o.region !== "us-east-1";
      await client.send(
        new CreateBucketCommand({
          Bucket: o.bucket,
          ...(named ? { CreateBucketConfiguration: { LocationConstraint: o.region as never } } : {}),
        }),
      );
      add("Bucket", "ok", `created ${o.bucket}`);
    } catch (createErr) {
      add("Bucket", "fail", `${o.bucket} does not exist and could not be created (${errorCode(createErr)}): create it in your provider's console`);
      return results;
    }
  }

  // 2. Versioning: the "In your account" versions in Version history.
  try {
    await client.send(new PutBucketVersioningCommand({ Bucket: o.bucket, VersioningConfiguration: { Status: "Enabled" } }));
    add("Versioning", "ok", "on: past versions are kept in the account");
  } catch (err) {
    add("Versioning", "warn", `not supported here (${errorCode(err)}): Version history shows only the versions saved in the browser`);
  }

  // 3. CORS: the browser PUTs and GETs files on signed URLs.
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: o.bucket,
        CORSConfiguration: {
          CORSRules: [
            { AllowedOrigins: o.origins, AllowedMethods: ["GET", "PUT", "HEAD"], AllowedHeaders: ["*"], ExposeHeaders: ["ETag"], MaxAgeSeconds: 3000 },
          ],
        },
      }),
    );
    add("CORS", "ok", `allows ${o.origins.join(", ")}`);
  } catch (err) {
    add("CORS", "warn", `not set (${errorCode(err)}): make sure the server lets ${o.origins.join(", ")} send GET, PUT and HEAD (MinIO and local mocks allow every origin by default)`);
  }

  // 4. Expiry: replaced files and daily backups go after 30 days, as in production.
  try {
    await client.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: o.bucket,
        LifecycleConfiguration: {
          Rules: [
            { ID: "ExpireOldVersions", Status: "Enabled", Filter: { Prefix: "" }, NoncurrentVersionExpiration: { NoncurrentDays: DAYS } },
            { ID: "ExpireBackups", Status: "Enabled", Filter: { Tag: { Key: "kind", Value: "backup" } }, Expiration: { Days: DAYS } },
          ],
        },
      }),
    );
    add("Expiry", "ok", `old versions and backups are removed after ${DAYS} days`);
  } catch (err) {
    add("Expiry", "warn", `not set (${errorCode(err)}): old versions and backups are kept until you delete them`);
  }

  // 5. A real signed upload, as the editor sends an image: the body is checked against its SHA-256. Required.
  const storage = createStorage(o);
  const upload = async (key: string, tagging?: string) => {
    const body = new TextEncoder().encode(`markdown-studio storage check ${Date.now()}`);
    const sha256 = createHash("sha256").update(body).digest("base64");
    const { url, headers } = await storage.presignPut(key, { contentType: "text/plain", sha256, tagging, expiresIn: 60 });
    const res = await fetch(url, { method: "PUT", headers, body });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const head = await storage.head(key);
    await storage.remove(key);
    if (!head) throw new Error("the upload did not arrive");
  };
  try {
    await upload("storage-check/image.txt");
    add("Signed upload", "ok", "images and notes can sync");
  } catch (err) {
    add("Signed upload", "fail", `the server refused a checksummed signed upload (${(err as Error).message}): sync will not work with this provider`);
    return results;
  }

  // 6. The same with the backup tag.
  try {
    await upload("storage-check/backup.txt", BACKUP_TAGGING);
    add("Tagged upload", "ok", "daily backups can be stored");
  } catch (err) {
    add("Tagged upload", "warn", `object tags are not supported (${(err as Error).message}): daily backups will fail; everything else works`);
  }

  return results;
}
