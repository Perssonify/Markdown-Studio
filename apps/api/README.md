# apps/api — the Markdown Studio backend

Hono on Node 24. One app (`src/app.ts`), three ways to run it:
`src/server.ts` (Node, locally), `src/lambda.ts` (AWS Lambda behind
CloudFront, see [infra](../../infra/README.md)) and `src/vercel.ts` (a Vercel
Function: the `api` service of the root [`vercel.json`](../../vercel.json)).

## Endpoints

| Route | What |
| --- | --- |
| `GET /health` (also `/api/health`) | `200 {"status":"ok","db":"up","storage":"up"}`; `not_configured` for a database or bucket that is not set up; `503 {"status":"degraded", …"down"}` when a configured one does not answer. `/api/health` is the path that reaches it through the site's CloudFront. |
| `GET /api/import?url=…` | The editor's URL-import relay — the file the editor already uses, [`apps/web/api/import.js`](../web/api/import.js), run unchanged (`src/utils/vercelHandler/index.ts`). Its rules and tests live with it: [import-relay.md](../web/docs/import-relay.md). |
| `/api/sync/*` | Each signed-in user's library in the cloud (`src/modules/sync/routes/index.ts`): `GET state`, `GET/PUT/DELETE documents/:id` (gzip JSON; conditional on the `base` revision — 409 with the current one), `PUT library` (the folder tree; the server issues the revision), presigned image `assets/upload` → PUT to S3 (SHA-256 checked by S3) → `assets/commit`, `assets/download`; a note's past versions (`GET documents/:id/versions`, thinned to at most 50 across the bucket's 30 days, and `…/versions/:versionId`); one full backup a day (`POST backups/upload` → presigned PUT tagged `kind=backup`, `GET backups`, `GET backups/:date` → a download link). Index in Postgres (`sync_document` with tombstones, `sync_asset`, `sync_library`), content in S3 under `users/<id>/`. Writes need `X-Requested-With: markdown-studio`. 401 without a session, 503 until database, storage and sign-in are configured. |
| `/api/auth/*` | Google sign-in ([Better Auth](https://www.better-auth.com/)): `POST /api/auth/sign-in/social` `{provider:"google", callbackURL}` starts it, `/api/auth/callback/google` finishes it, `GET /api/auth/get-session`, `POST /api/auth/sign-out`. **503** with the names of the missing settings until the database, `BETTER_AUTH_SECRET` and the Google client are all set. Email/password is off. |

File storage is `src/lib/storage/index.ts` (put / get / remove / ping on one S3 bucket); no route stores files yet.

No feature endpoints yet. The editor signs in through these routes: a signed-out
visitor sees its sign-in screen instead of the editor; once signed in, the
account menu (right of the menu bar) has Profile and Sign out
(`apps/web/src/app/account/account.ts`). It calls them at its OWN origin — in
development Vite forwards `/api` to this server — so sign-in runs on one
address, as it does behind CloudFront.

## Layout

```
src/
  app.ts               every route and middleware, independent of the runtime
  bootstrap.ts         env → database + auth → app
  server.ts            Node entry (local)
  lambda.ts            Lambda entry (+ trustViewerAddress)
  vercel.ts            Vercel entry (the app as the default export)
  migrate-lambda.ts    the migration function infra runs on deploy
  config/env/          every setting, validated (zod)
  middlewares/         cors/ (the frontend's origins), originVerify/ (CloudFront only)
  modules/             health/, importRelay/, auth/ (routes + Better Auth service), sync/ — each
                       module's index.ts is what the rest of the app imports
  lib/                 storage/ (S3), awsSecrets/
  utils/               vercelHandler/
  *.test.ts            unit tests sit next to the code they test (vitest)
tests/
  integration/         vitest through createApp(); auth.test.ts uses a real Postgres
  fixtures/            testApp() and the test settings
scripts/smoke-bundle.mjs  run by `build`: starts the bundled server, Lambda handler and Vercel app
```

## Running it

```bash
cp .env.example .env          # every value is optional
bun run dev                   # from the root (with the editor), or here
```

`dev` runs `src/server.ts` on Node 24, which runs the TypeScript directly (so
imports carry their `.ts` extension and only erasable syntax is allowed), and
restarts it when `src/`, `packages/db/src` or the relay changes. It watches
those folders rather than every imported file: watching `node_modules` too
restarted the server on startup noise.
`build` type-checks, bundles `dist/server.mjs`, `dist/lambda/*.mjs` and
`dist/vercel/index.mjs` (Rolldown, no `node_modules` needed at runtime) and
smoke-tests all three.

## Settings (`.env`, see `.env.example`)

| Name | Default | |
| --- | --- | --- |
| `PORT` | 4000 | |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:4173` | Origins allowed to call with credentials. Also Better Auth's trusted origins (callback URLs must be on one). |
| `PUBLIC_URL` | `http://localhost:5173` | Where the browser reaches the API — locally the editor's address, which forwards `/api` here. The Google callback is `${PUBLIC_URL}/api/auth/callback/google`. |
| `DATABASE_URL`, `DATABASE_SSL` | — , `off` | `off` / `require` / `verify` (RDS uses `verify`). |
| `BETTER_AUTH_SECRET` | — | 32+ random characters (`openssl rand -base64 32`). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | — | From the Google Cloud console (below). |
| `TEST_DATABASE_URL` | — | A Postgres the test suites may create databases on. |
| `S3_BUCKET` | — | File storage. Off until set. |
| `S3_REGION` | `us-east-1` | |
| `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | — | Local only: the S3-compatible server `bun run db:up` starts (port 9540) and its throwaway keys. On AWS none is set: Amazon S3, and the Lambda's role. |
| `TEST_S3_ENDPOINT` | — | An S3-compatible server the test suites may create buckets on. |

On Lambda, infra sets these from Secrets Manager and SSM instead
(`src/lib/awsSecrets/index.ts`).

## Google sign-in: the OAuth client

In Google Cloud console ▸ APIs & Services ▸ Credentials ▸ Create credentials ▸
OAuth client ID ▸ *Web application*:

- **Authorized JavaScript origins:** `http://localhost:5173`, and the site's
  URL (the stack output `SiteUrl`; later https://markdownstudio.com).
- **Authorized redirect URIs:** `http://localhost:5173/api/auth/callback/google`
  and the stack output `GoogleRedirectUri`.

Put the ID and secret in `.env` locally, and in the `markdown-studio/google-oauth`
secret on AWS ([infra/README.md](../../infra/README.md#google-sign-in)).
