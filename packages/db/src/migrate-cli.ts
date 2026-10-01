// `bun run db:migrate`: apply pending migrations to DATABASE_URL (read from
// apps/api/.env when present). Deployed databases are migrated by the
// migration Lambda that infra runs on every deploy, not by this script.
import { createDatabase, type DatabaseSsl } from "./index.ts";
import { runMigrations } from "./migrate.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env, or export it.");
  process.exit(1);
}
const ssl = (process.env.DATABASE_SSL ?? "off") as DatabaseSsl;
const handle = createDatabase({ url, ssl, max: 1 });
try {
  await runMigrations(handle.pool);
  console.log("Migrations applied.");
} finally {
  await handle.close();
}
