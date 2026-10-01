// AWS entry for database migrations. infra runs this function once per
// deploy (a CDK trigger, before traffic reaches new code that might need the
// new tables); it applies packages/db/drizzle, which the bundle copies next to
// this file.
import { createDatabase } from "@markdown-studio/db";
import { runMigrations } from "@markdown-studio/db/migrate";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./config/env.ts";
import { resolveSecretsIntoEnv } from "./lib/aws-secrets.ts";

export async function handler(): Promise<{ migrated: true }> {
  await resolveSecretsIntoEnv(process.env);
  const env = loadEnv(process.env);
  if (!env.DATABASE_URL) throw new Error("migrate: no database configured (DB_SECRET_ARN is not set)");
  const database = createDatabase({ url: env.DATABASE_URL, ssl: env.DATABASE_SSL, max: 1 });
  try {
    await runMigrations(database.pool, fileURLToPath(new URL("./drizzle", import.meta.url)));
    console.log(JSON.stringify({ evt: "migrations_applied" }));
    return { migrated: true };
  } finally {
    await database.close();
  }
}
