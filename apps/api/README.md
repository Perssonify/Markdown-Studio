# apps/api — the Markdown Studio backend

Hono on Node 24. One app (`src/app.ts`), two ways to run it:
`src/server.ts` (Node, locally) and `src/lambda.ts` (AWS Lambda behind
CloudFront, see [infra](../../infra/README.md)).

## Endpoints

| Route | What |
| --- | --- |
| `GET /health` (also `/api/health`) | `200 {"status":"ok","db":"up"}`; `db: "not_configured"` without a database; `503 {"status":"degraded","db":"down"}` when the database does not answer. `/api/health` is the path that reaches it through the site's CloudFront. |
| `GET /api/import?url=…` | The editor's URL-import relay — the file the editor already uses, [`apps/web/api/import.js`](../web/api/import.js), run unchanged (`src/lib/vercel-handler.ts`). Its rules and tests live with it: [import-relay.md](../web/docs/import-relay.md). |
| `/api/auth/*` | Google sign-in ([Better Auth](https://www.better-auth.com/)): `POST /api/auth/sign-in/social` `{provider:"google", callbackURL}` starts it, `/api/auth/callback/google` finishes it, `GET /api/auth/get-session`, `POST /api/auth/sign-out`. **503** with the names of the missing settings until the database, `BETTER_AUTH_SECRET` and the Google client are all set. Email/password is off. |

No feature endpoints yet. The editor does not call `/api/auth` yet either —
signing in from the editor is a separate, frontend change.

## Layout

```
src/
  app.ts               every route and middleware, independent of the runtime
  bootstrap.ts         env → database + auth → app
  server.ts            Node entry (local)
  lambda.ts            Lambda entry (+ trustViewerAddress)
  migrate-lambda.ts    the migration function infra runs on deploy
  config/env.ts        every setting, validated (zod)
  middleware/          cors.ts (the frontend's origins), origin-verify.ts (CloudFront only)
  routes/              health.ts, import-relay.ts, auth.ts
  lib/                 auth.ts (Better Auth), aws-secrets.ts, vercel-handler.ts
test/                  vitest; auth.test.ts uses a real Postgres
scripts/smoke-bundle.mjs  run by `build`: starts the bundled server and Lambda handler
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
`build` type-checks, bundles `dist/server.mjs` and `dist/lambda/*.mjs`
(Rolldown, no `node_modules` needed at runtime) and smoke-tests both.

## Settings (`.env`, see `.env.example`)

| Name | Default | |
| --- | --- | --- |
| `PORT` | 4000 | |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:4173` | Origins allowed to call with credentials. Also Better Auth's trusted origins (callback URLs must be on one). |
| `PUBLIC_URL` | `http://localhost:4000` | Where the browser reaches the API; the Google callback is `${PUBLIC_URL}/api/auth/callback/google`. |
| `DATABASE_URL`, `DATABASE_SSL` | — , `off` | `off` / `require` / `verify` (RDS uses `verify`). |
| `BETTER_AUTH_SECRET` | — | 32+ random characters (`openssl rand -base64 32`). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | — | From the Google Cloud console (below). |
| `TEST_DATABASE_URL` | — | A Postgres the test suites may create databases on. |

On Lambda, infra sets these from Secrets Manager and SSM instead
(`src/lib/aws-secrets.ts`).

## Google sign-in: the OAuth client

In Google Cloud console ▸ APIs & Services ▸ Credentials ▸ Create credentials ▸
OAuth client ID ▸ *Web application*:

- **Authorized JavaScript origins:** `http://localhost:5173`, and the site's
  URL (the stack output `SiteUrl`; later https://markdownstudio.com).
- **Authorized redirect URIs:** `http://localhost:4000/api/auth/callback/google`
  and the stack output `GoogleRedirectUri`.

Put the ID and secret in `.env` locally, and in the `markdown-studio/google-oauth`
secret on AWS ([infra/README.md](../../infra/README.md#google-sign-in)).
