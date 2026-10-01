# Markdown Studio — monorepo

The editor at [markdownstudio.com](https://markdownstudio.com), its backend,
and the AWS infrastructure both run on — one Turborepo, one Bun lockfile.

| Path | What it is | Docs |
| --- | --- | --- |
| [`apps/web`](apps/web) | The editor: the standalone app, the iframe embed and the npm library `@perssonify/editor` (Vite + React). Moved in unchanged. | [README](apps/web/README.md) · [CLAUDE.md](apps/web/CLAUDE.md) · [docs/](apps/web/docs/README.md) |
| [`apps/api`](apps/api) | The backend: Hono on Node 24 — `GET /health`, Google sign-in (Better Auth), and the editor's URL-import relay. Runs locally on Node and on AWS Lambda. | [README](apps/api/README.md) |
| [`packages/db`](packages/db) | The database: Drizzle ORM schema and SQL migrations for PostgreSQL 17. | [README](packages/db/README.md) |
| [`infra`](infra) | AWS (CDK): CloudFront + S3 for the site, Lambda for the API, RDS PostgreSQL, all in one stack. | [README](infra/README.md) |

## Quick start

Needs [Bun](https://bun.sh) 1.4.0, Node 24 (`.node-version`) and, for the
database, Docker.

```bash
bun install
bun run dev                       # editor on http://localhost:5173, API on http://localhost:4000
```

With a database (the API runs without one; `/health` then reports
`db: "not_configured"`):

```bash
cp apps/api/.env.example apps/api/.env
bun run db:up                     # PostgreSQL 17 in Docker, on port 5440
bun run db:migrate                # create the tables
curl http://localhost:4000/health # {"status":"ok","db":"up"}
```

## Commands (from the root)

| Command | Does |
| --- | --- |
| `bun run dev` | Every app's dev server, together (Turbo). |
| `bun run build` | The editor's app, library and embed builds, the API bundle, and type checks of the rest. |
| `bun run lint` / `typecheck` / `test` | Across every package. The database tests need `bun run db:up` (and `TEST_DATABASE_URL`, set in `.env.example`); without it they report as skipped. |
| `bun run db:up` / `db:down` | Start / stop the local Postgres. |
| `bun run db:generate` | Write the next migration after a schema change in `packages/db/src/schema`. |
| `bun run db:migrate` | Apply migrations to `DATABASE_URL`. |
| `bun run deploy` | Build, deploy the AWS stack, publish the site ([infra/README.md](infra/README.md)). |
| `bun run deploy:web` | Rebuild and re-publish the site only. |

Anything a single package offers runs there too, e.g. `bun run --cwd apps/web e2e`.

## Hosting

The site and the API are served by AWS ([infra/README.md](infra/README.md)):
one CloudFront distribution serves the site from S3 and sends `/api/*` to the
API on Lambda, so the editor's existing relative calls work unchanged.

Until the domain moves, markdownstudio.com is still the Vercel project. Vercel
now needs **Root Directory = `apps/web`** in the project's settings (the
`vercel.json` and the `api/` function moved there with the rest of the
editor).
