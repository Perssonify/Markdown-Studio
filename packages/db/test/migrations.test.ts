import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseHandle } from "../src/index.ts";
import { MIGRATIONS_FOLDER, runMigrations } from "../src/migrate.ts";
import * as schema from "../src/schema/index.ts";
import { freshTestDatabase } from "../src/testing.ts";

const tables = Object.values(schema).map((t) => getTableConfig(t as PgTable));
const migrationSql = readdirSync(MIGRATIONS_FOLDER)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(MIGRATIONS_FOLDER, f), "utf8"))
  .join("\n");

describe("the committed migrations cover the schema", () => {
  it("finds the schema's tables (the check is not vacuous)", () => {
    expect(tables.map((t) => t.name).sort()).toEqual(["account", "session", "sync_asset", "sync_document", "sync_library", "user", "verification"]);
  });

  // A schema edit without `bun run db:generate` ships a table or column the
  // deployed database does not have.
  it.each(tables.map((t) => [t.name, t] as const))("%s and each of its columns is created by a migration", (name, t) => {
    expect(migrationSql).toContain(`CREATE TABLE "${name}"`);
    for (const column of t.columns) expect(migrationSql).toContain(`"${column.name}"`);
  });
});

// Against a real Postgres: CI's api job provides one, and locally `bun run
// db:up` starts the Docker one (TEST_DATABASE_URL in apps/api/.env.example).
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("migrations against a real database", () => {
  let handle: DatabaseHandle;

  beforeAll(async () => {
    handle = createDatabase({ url: await freshTestDatabase(url!, "markdown_studio_test_db"), max: 2 });
  });
  afterAll(() => handle?.close());

  it("apply to an empty database, and a second run is a no-op", async () => {
    await runMigrations(handle.pool);
    await runMigrations(handle.pool);
    const { rows } = await handle.pool.query<{ table_name: string; column_name: string }>(
      "select table_name, column_name from information_schema.columns where table_schema = 'public'",
    );
    for (const t of tables) {
      const columns = rows.filter((r) => r.table_name === t.name).map((r) => r.column_name).sort();
      expect(columns, t.name).toEqual(t.columns.map((c) => c.name).sort());
    }
  });

  it("two runners at once do not collide (the advisory lock)", async () => {
    await Promise.all([runMigrations(handle.pool), runMigrations(handle.pool)]);
    const { rows } = await handle.pool.query<{ n: string }>("select count(*)::text as n from drizzle.__drizzle_migrations");
    expect(Number(rows[0]!.n)).toBe(readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith(".sql")).length);
  });

  it("ping answers", async () => {
    await expect(handle.ping()).resolves.toBeUndefined();
  });
});
