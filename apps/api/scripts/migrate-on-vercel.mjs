// The `api` service's build on Vercel (root vercel.json → `bun run build:vercel`)
// ends here: apply pending migrations to the production database, so the
// tables exist before the new deployment takes traffic.
//
// The database is Neon (Vercel Marketplace), which sets DATABASE_URL to its
// POOLED address and DATABASE_URL_UNPOOLED to the direct one. Migrations take
// a session-level advisory lock (packages/db/src/migrate.ts), which a
// transaction-mode pooler does not keep, so they use the direct address when
// there is one. The API itself runs on the pooled one.
//
// Production builds only: a preview build must never change the production
// database. A production build without a database fails — the deployment it
// would make could not sign anyone in.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const target = process.env.VERCEL_ENV;
if (target !== "production") {
  console.log(`migrate-on-vercel: skipped (VERCEL_ENV=${target ?? "unset"}, not production)`);
  process.exit(0);
}
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("migrate-on-vercel: DATABASE_URL is not set for Production in the Vercel project");
  process.exit(1);
}
console.log(`migrate-on-vercel: migrating over the ${process.env.DATABASE_URL_UNPOOLED ? "direct (unpooled)" : "DATABASE_URL"} connection`);
const cli = fileURLToPath(new URL("../../../packages/db/src/migrate-cli.ts", import.meta.url));
const run = spawnSync(process.execPath, [cli], { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
process.exit(run.status ?? 1);
