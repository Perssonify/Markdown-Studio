import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

// The real-database cases need TEST_DATABASE_URL: from the environment (CI),
// else from apps/api/.env, the one local settings file (only that key is read).
const file = "../../apps/api/.env";
const dotenv = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
const testDb = process.env.TEST_DATABASE_URL ?? dotenv.TEST_DATABASE_URL;

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: testDb ? { TEST_DATABASE_URL: testDb } : {},
  },
});
