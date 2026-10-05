// `bun run db:migrate`: apply pending migrations to DATABASE_URL (read from
// apps/api/.env when present). The AWS-hosted app's database is migrated by
// the migration Lambda that infra runs on every deploy; the Vercel one by
// this script, from the API's production build (apps/api/scripts/migrate-on-vercel.mjs).
import { createDatabase, type DatabaseSsl } from "./index.ts";
import { runMigrations } from "./migrate.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env, or export it.");
  process.exit(1);
}
const ssl = (process.env.DATABASE_SSL ?? "off") as DatabaseSsl;
// DATABASE_CA as the API reads it (config/env.ts): literal "\n"s are line breaks.
const ca = process.env.DATABASE_CA?.trim().replaceAll("\\n", "\n") || undefined;
const handle = createDatabase({ url, ssl, max: 1, ca });
try {
  await runMigrations(handle.pool);
  console.log("Migrations applied.");
} finally {
  await handle.close();
}
