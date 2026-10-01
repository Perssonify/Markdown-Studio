import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

// Tests never load a developer's .env wholesale (its DATABASE_URL and Google
// keys must not leak into a test) — only TEST_DATABASE_URL, so `bun run test`
// runs the real-database cases once `bun run db:up` is running.
const dotenv = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {};
const testDb = process.env.TEST_DATABASE_URL ?? dotenv.TEST_DATABASE_URL;

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: { NODE_ENV: "test", ...(testDb ? { TEST_DATABASE_URL: testDb } : {}) },
  },
});
