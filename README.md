# Markdown Studio — monorepo

The editor at [markdownstudio.com](https://markdownstudio.com), its backend,
and the AWS infrastructure both run on — one Turborepo, one Bun lockfile.

| Path | What it is | Docs |
| --- | --- | --- |
| [`apps/web`](apps/web) | The editor: the standalone app, the iframe embed and the npm library `@perssonify/editor` (Vite + React). Moved in unchanged. | [README](apps/web/README.md) · [CLAUDE.md](apps/web/CLAUDE.md) · [docs/](apps/web/docs/README.md) |
| [`apps/api`](apps/api) | The backend: Hono on Node 24 — `GET /health`, Google sign-in (Better Auth), file storage on S3, and the editor's URL-import relay. Runs locally on Node and on AWS Lambda. | [README](apps/api/README.md) |
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
bun run db:up                     # PostgreSQL 17 (port 5440) and a local S3 (port 9540) in Docker
bun run db:migrate                # create the tables
curl http://localhost:4000/health # {"status":"ok","db":"up","storage":"up"}
```

### Signing in

With the database and the Google keys in `apps/api/.env` ([apps/api/README.md](apps/api/README.md#google-sign-in-the-oauth-client)),
http://localhost:5173 opens on a **Sign in with Google** screen; once signed in,
the account menu at the right of the menu bar has Profile and Sign out. Your
documents, their images and your folders sync to your account (S3), so they
follow you to any device. The
editor reaches the API through its own address (Vite forwards `/api`), so the
Google client's redirect URI is `http://localhost:5173/api/auth/callback/google`.
Builds without the backend (`VITE_ACCOUNTS` unset — the npm library, the embed)
have no sign-in at all.

## Commands (from the root)

| Command | Does |
| --- | --- |
| `bun run dev` | Every app's dev server, together (Turbo). |
| `bun run build` | The editor's app, library and embed builds, the API bundle, and type checks of the rest. |
| `bun run lint` / `typecheck` / `test` | Across every package. The database tests need `bun run db:up` (and `TEST_DATABASE_URL`, set in `.env.example`); without it they report as skipped. |
| `bun run db:up` / `db:down` | Start / stop the local Postgres and S3. |
| `bun run db:generate` | Write the next migration after a schema change in `packages/db/src/schema`. |
| `bun run db:migrate` | Apply migrations to `DATABASE_URL`. |
| `bun run deploy` | Build, deploy the AWS stack, publish the site ([infra/README.md](infra/README.md)). |
| `bun run deploy:web` | Rebuild and re-publish the site only. |

Anything a single package offers runs there too, e.g. `bun run --cwd apps/web e2e`.

## Hosting

The site and the API are served by AWS ([infra/README.md](infra/README.md)):
one CloudFront distribution serves the site from S3 and sends `/api/*` to the
API on Lambda, so the editor's existing relative calls work unchanged.

The same two apps also deploy to Vercel as ONE project with services
([`vercel.json`](vercel.json)): `web` serves the editor, `api` runs the API as a
Vercel Function, and `/api/*` goes to `api` on the same domain. The project's
**Root Directory is the repository root** (leave it empty). The API reads its
settings from the project's environment variables (see `apps/api/.env.example`).
