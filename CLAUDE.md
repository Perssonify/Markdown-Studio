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
  `src/lib/storage.ts` (S3): Amazon S3 through the Lambda's role on AWS, Adobe
  S3Mock locally (docker-compose; MinIO no longer publishes images). Keys are
  plain paths (`assertKey` refuses `..`, leading `/`, empty segments).
- `packages/db` — Drizzle schema (`src/schema/`), committed SQL migrations
  (`drizzle/`), `runMigrations` (advisory-locked).
- `infra` — AWS CDK, one stack (`MarkdownStudio`, us-east-1).

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
  it there; the API runs that same file through `src/lib/vercel-handler.ts`.
  The relay answers its own CORS (markdownstudio.com only), so the API's
  CORS middleware is registered AFTER the relay route — widening the relay's
  origins would loosen a security control (`test/cors.test.ts`).
- **`apps/web/vercel.json` is the one description of how the site is served.**
  infra reads it (`infra/lib/site-config.ts`): CloudFront's CSP and security
  headers, S3 objects' Cache-Control and the SPA rewrite all come from it. So
  an inline-script hash change (see apps/web/CLAUDE.md) updates both hosts.
- **The API's TypeScript runs on Node directly** (type stripping): relative
  imports carry `.ts`, and only erasable syntax is allowed (no enums,
  namespaces or parameter properties) — `tsconfig.node.json`.
- **Better Auth's origin check is ON explicitly** (`advanced.disableOriginCheck:
  false`, `apps/api/src/lib/auth.ts`). Its default turns the check off whenever
  it detects a test run, so the suite would pass an open redirect.
- **Users' files live in their own stack, `MarkdownStudioFiles`** (`infra/lib/files-stack.ts`,
  deployed): one production bucket, retained, termination-protected, versioned. The
  app stack only finds it by name (`filesBucketName`) and grants access — never own
  or recreate it there. Local development points `apps/api/.env` at it with the AWS
  CLI login; TESTS never touch AWS (`TEST_S3_ENDPOINT` is the local S3).
- **Cloud sync never infers a deletion** (`apps/web/src/app/cloud/plan.ts`): a
  document is deleted in the account only from the editor's own delete event; one
  missing locally is downloaded again. Server writes are conditional on the client's
  `base` revision under a row lock (`apps/api/src/routes/sync.ts`). The client half
  is tested against the real server half by `apps/web/src/__tests__/cloud-contract.test.js`.
- **No code here may ever delete a database.** The RDS instance and the secret
  holding its password are `RemovalPolicy.RETAIN` with deletion protection
  (`infra/test/stack.test.ts` pins both): a failed deploy's rollback, a stack
  delete or a replacement leaves them. The AWS account is shared with other
  projects' databases — never delete a database there, and never run a deploy,
  destroy or delete without the owner's explicit go-ahead; read-only checks are
  always fine.
- **Secrets never sit in the Lambda's configuration**: it gets ARNs and reads
  Secrets Manager at cold start (`src/lib/aws-secrets.ts`). The site's URL comes
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
