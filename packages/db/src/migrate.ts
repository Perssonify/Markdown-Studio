import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import type pg from "pg";

/** The SQL migrations drizzle-kit writes (`bun run db:generate`). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

// Any constant: it names the lock, it is not a secret.
const MIGRATION_LOCK = 4_271_903;

/**
 * Apply every pending migration, holding a Postgres advisory lock so two
 * runners (two deploys, or a deploy and a developer) cannot apply the same
 * migration at once. Safe to run repeatedly: applied migrations are recorded
 * in drizzle's own table and skipped.
 */
export async function runMigrations(pool: pg.Pool, migrationsFolder = MIGRATIONS_FOLDER): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
    try {
      await migrate(drizzle(client), { migrationsFolder });
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]);
    }
  } finally {
    client.release();
  }
}
