# packages/db — schema and migrations

PostgreSQL 17 through [Drizzle ORM](https://orm.drizzle.team/).

- `src/schema/` — the tables. Today: accounts only — `user`, `session`,
  `account` (the Google link), `verification` — the shape Better Auth reads
  and writes (`apps/api/src/modules/auth/services/index.ts`). Documents come with the sync
  feature.
- `drizzle/` — the SQL migrations, committed. Never edit an applied one; change
  the schema and generate the next.
- `src/migrate.ts` — `runMigrations(pool)`: applies what is pending, under a
  Postgres advisory lock so two runners cannot collide. Used by
  `bun run db:migrate` locally and by the migration Lambda on every deploy.
- `src/testing.ts` — `freshTestDatabase()`: an empty database per test suite.

## Changing the schema

```bash
# edit src/schema/*.ts, then
bun run db:generate        # writes drizzle/NNNN_*.sql (no database needed)
bun run db:migrate         # applies it to DATABASE_URL (apps/api/.env)
```

`test/migrations.test.ts` fails if a table or column in the schema has no
migration, and (with `TEST_DATABASE_URL`) applies every migration to an empty
database and compares the result with the schema.
