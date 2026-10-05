// The `api` service's build on Vercel (root vercel.json → `bun run build:vercel`)
// ends here: apply pending migrations to the production database, so the
// tables exist before the new deployment takes traffic. Vercel's builds leave
// from the project's Static IPs, which the database admits.
//
// Production builds only: a preview build must never change the production
// database. A production build without DATABASE_URL fails — the deployment it
// would make could not sign anyone in.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const target = process.env.VERCEL_ENV;
if (target !== "production") {
  console.log(`migrate-on-vercel: skipped (VERCEL_ENV=${target ?? "unset"}, not production)`);
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.error("migrate-on-vercel: DATABASE_URL is not set for Production in the Vercel project");
  process.exit(1);
}
const cli = fileURLToPath(new URL("../../../packages/db/src/migrate-cli.ts", import.meta.url));
const run = spawnSync(process.execPath, [cli], { stdio: "inherit", env: process.env });
process.exit(run.status ?? 1);
