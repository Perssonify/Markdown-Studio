// `bun run storage:setup` (from the repo root or apps/api): gets the bucket
// in apps/api/.env ready for sync and checks it can take the editor's uploads.
// Works with Amazon S3 and any S3-compatible server; safe to run again.
import { loadEnv } from "../src/config/env/index.ts";
import { setupStorage } from "../src/lib/storage/setup.ts";

const env = loadEnv();
if (!env.S3_BUCKET) {
  console.error("storage: S3_BUCKET is not set in apps/api/.env (cp apps/api/.env.example apps/api/.env to start from the local defaults)");
  process.exit(1);
}

const origins = [...new Set([...env.CORS_ORIGINS, new URL(env.PUBLIC_URL).origin])];
console.log(`storage: ${env.S3_BUCKET} on ${env.S3_ENDPOINT ?? `Amazon S3 (${env.S3_REGION})`}\n`);

const results = await setupStorage({
  bucket: env.S3_BUCKET,
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials:
    env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
      ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
      : undefined,
  origins,
});

const mark = { ok: "✓", warn: "!", fail: "✗" } as const;
for (const r of results) console.log(`  ${mark[r.status]} ${r.step.padEnd(14)} ${r.detail}`);

const failed = results.some((r) => r.status === "fail");
console.log(failed ? "\nstorage: not ready. Fix the ✗ above and run this again." : "\nstorage: ready. Start the app with `bun run dev`.");
process.exit(failed ? 1 : 0);
