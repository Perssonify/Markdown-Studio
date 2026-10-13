import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

// Tests never load a developer's .env wholesale (its DATABASE_URL and Google
// keys must not leak into a test): only TEST_DATABASE_URL and the TEST_S3_* settings,
// so `bun run test` runs the real-database and real-S3 cases once
// `bun run db:up` is running.
const dotenv = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {};
const testDb = process.env.TEST_DATABASE_URL ?? dotenv.TEST_DATABASE_URL;
const testS3 = process.env.TEST_S3_ENDPOINT ?? dotenv.TEST_S3_ENDPOINT;
const testS3Key = process.env.TEST_S3_ACCESS_KEY_ID ?? dotenv.TEST_S3_ACCESS_KEY_ID;
const testS3Secret = process.env.TEST_S3_SECRET_ACCESS_KEY ?? dotenv.TEST_S3_SECRET_ACCESS_KEY;

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      ...(testDb ? { TEST_DATABASE_URL: testDb } : {}),
      ...(testS3 ? { TEST_S3_ENDPOINT: testS3 } : {}),
      ...(testS3Key ? { TEST_S3_ACCESS_KEY_ID: testS3Key } : {}),
      ...(testS3Secret ? { TEST_S3_SECRET_ACCESS_KEY: testS3Secret } : {}),
    },
  },
});
