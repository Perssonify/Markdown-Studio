# CLAUDE.md — the Markdown Studio monorepo

**Working on the editor? Read [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md) first** —
it is the editor's full agent context (invariants, data contracts, what not to
break). Every path in it is relative to `apps/web`.

> **The product is Markdown Studio.** The npm package (`@perssonify/editor`)
> and every DATA identifier keep their old names ON PURPOSE — `pf:` preference
> keys, the `perssonify-document` envelope, `perssonify-backup` archives, the
> `perssonify-snapshots` / `perssonify-embed-docs` / `perssonify-assets`
> IndexedDB databases and the `pf-asset:` scheme are on-disk contracts with
> existing installs. Renaming them orphans users' documents.

## Layout
- `apps/web` — the editor (Vite + React): app, embed and npm library. It was
  moved in AS-IS: only paths, scripts and config changed, never app logic. Its
  tests resolve files from `process.cwd()` = `apps/web`; the few files that
  live at the repository root (`.github/`, `.node-version`, `SECURITY.md`,
  `bun.lock`, `node_modules/`) are read as `../../…`.
- `apps/api` — Hono on Node 24. `src/app.ts` is the whole HTTP surface;
  `src/server.ts` serves it locally, `src/lambda.ts` on AWS Lambda. File storage is
  `src/lib/storage/index.ts` (S3): Amazon S3 through the Lambda's role on AWS, Adobe
  S3Mock locally (docker-compose; MinIO no longer publishes images). Keys are
  plain paths (`assertKey` refuses `..`, leading `/`, empty segments).
- `packages/db` — Drizzle schema (`src/schema/`), committed SQL migrations
  (`drizzle/`), `runMigrations` (advisory-locked).
- `infra` — AWS CDK (us-east-1): `MarkdownStudioFiles` (the files bucket),
  `MarkdownStudio` (the app on AWS, not deployed) and `MarkdownStudioVercelData`
  (the S3 key the app on Vercel uses, and an RDS it does NOT use — see below).
- `vercel.json` (root) — the same two apps as ONE Vercel project with services:
  `web` (apps/web, static) and `api` (apps/api, a Vercel Function built from
  `src/vercel.ts` into `dist/vercel/`); `/api/*` goes to `api`, the rest to `web`.
  The Vercel project's Root Directory is the repository root.

## Invariants — do NOT break
- **One `bun.lock`, hoisted (`bunfig.toml` `linker = "hoisted"`).** Bun's
  isolated linker changes how Vite chunks `node_modules` and where the editor's
  tests find packages. **A dependency change must not move a frontend pin**:
  converting the repo to workspaces made `bun install` re-resolve 129 frontend
  packages to newer versions, and the lockfile had to be rebuilt from the old
  pins by hand. After any install, diff the lockfile's `packages` against the
  previous one; the editor's `dist-app` and `dist-embed` must stay
  byte-identical (verified on the move, and again with every backend package
  installed).
- **The import relay has ONE copy: `apps/web/api/import.js`.** Vercel serves
  it there; the API runs that same file through `src/utils/vercelHandler/index.ts`.
  The relay answers its own CORS (markdownstudio.com only), so the API's
  CORS middleware is registered AFTER the relay route — widening the relay's
  origins would loosen a security control (`tests/integration/cors.test.ts`).
- **The root `vercel.json` is the one description of how the site is served**:
  its top-level `headers` (every response) and the `web` service's `headers` and
  SPA `rewrites`. infra reads it (`infra/lib/site-config.ts`): CloudFront's CSP and
  security headers, S3 objects' Cache-Control and the SPA rewrite all come from
  it. So an inline-script hash change (see apps/web/CLAUDE.md) updates both hosts.
- **The app on Vercel uses Neon** (Vercel Marketplace): `DATABASE_URL` is Neon's
  POOLED address (the API), `DATABASE_URL_UNPOOLED` the direct one, which
  migrations use — their session-level advisory lock does not survive a
  transaction-mode pooler. Migrations run from the `api` service's PRODUCTION
  build only (`scripts/migrate-on-vercel.mjs`); preview builds never touch it.
  Neon's URLs carry `sslmode=require`, which overrides `DATABASE_SSL`/`DATABASE_CA`
  (TLS, verified against the public CAs). The RDS in `MarkdownStudioVercelData` was
  built for Vercel Static IPs, which the Vercel team cannot enable; it is idle and
  its firewall admits nobody (`vercel-data-stack.ts` refuses anything but single
  IPv4 addresses — never a range, never `0.0.0.0/0`).
- **The `api` service's `outputDirectory` stays `dist/vercel`.** With a build
  command, Vercel's builder takes the first server-like file it finds in the
  output folder (`dist/` by default) as the function — that was `dist/server.mjs`,
  the LOCAL Node server, with every other bundle shipped beside it. `vercel dev`
  cannot run the `api` service (CLI 62: it ignores `entrypoint` and `devCommand`
  and detects `src/app.ts`); local development is `bun run dev`, which routes
  `/api` the same way.
- **The API's TypeScript runs on Node directly** (type stripping): relative
  imports carry `.ts`, and only erasable syntax is allowed (no enums,
  namespaces or parameter properties) — `tsconfig.node.json`.
- **Better Auth's origin check is ON explicitly** (`advanced.disableOriginCheck:
  false`, `apps/api/src/modules/auth/services/index.ts`). Its default turns the check off whenever
  it detects a test run, so the suite would pass an open redirect.
- **Users' files live in their own stack, `MarkdownStudioFiles`** (`infra/lib/files-stack.ts`,
  deployed): one production bucket, retained, termination-protected, versioned. The
  app stack only finds it by name (`filesBucketName`) and grants access — never own
  or recreate it there. Local development points `apps/api/.env` at it with the AWS
  CLI login; TESTS never touch AWS (`TEST_S3_ENDPOINT` is the local S3).
- **Cloud sync never infers a deletion** (`apps/web/src/app/cloud/plan.ts`): a
  document is deleted in the account only from the editor's own delete event; one
  missing locally is downloaded again. Server writes are conditional on the client's
  `base` revision under a row lock (`apps/api/src/modules/sync/routes/index.ts`). The client half
  is tested against the real server half by `apps/web/src/__tests__/cloud-contract.test.js`.
- **No code here may ever delete a database.** The RDS instance and the secret
  holding its password are `RemovalPolicy.RETAIN` with deletion protection
  (`infra/test/stack.test.ts` pins both): a failed deploy's rollback, a stack
  delete or a replacement leaves them. The AWS account is shared with other
  projects' databases — never delete a database there, and never run a deploy,
  destroy or delete without the owner's explicit go-ahead; read-only checks are
  always fine.
- **Secrets never sit in the Lambda's configuration**: it gets ARNs and reads
  Secrets Manager at cold start (`src/lib/awsSecrets/index.ts`). The site's URL comes
  from SSM because CloudFront depends on the function (a direct reference is a
  cycle).
- **Behind CloudFront the API refuses requests without `x-origin-verify`**
  (except `/health`), and replaces `X-Forwarded-For` with
  `CloudFront-Viewer-Address` — the relay's rate limit and the session record
  must not trust a client-supplied address.
- Turbo runs with `envMode: "loose"` so tasks see the environment they did
  before the move; `test` is never cached.

## Verify
```
bun install --frozen-lockfile
bun run lint && bun run typecheck && bun run build
bun run db:up && bun run test     # TEST_DATABASE_URL from apps/api/.env.example
```
The editor's own gate (and `bun run e2e`) is in apps/web/CLAUDE.md ▸ Verify.

Commit messages and working agreement: apps/web/HANDOVER.md §9.
