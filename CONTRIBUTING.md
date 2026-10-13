# Contributing to Markdown Studio

Thanks for taking a look. This file is the short version; the full guide —
coding standards, where things live, what not to break — lives in
[`apps/web/docs/contributing.md`](apps/web/docs/contributing.md), and the
architecture it assumes is in
[`apps/web/docs/architecture.md`](apps/web/docs/architecture.md).

Security problems do **not** go in an issue or a PR — see
[SECURITY.md](SECURITY.md).

## The repository

A Turborepo monorepo ([README.md](README.md)): the editor is `apps/web`, the
backend is `apps/api` with its database package `packages/db`, and the AWS
infrastructure is `infra`.

## Getting set up

The package manager is **Bun** (1.4.0 — pinned by `packageManager` in the root
`package.json`; the gate and the deploy install with `bun install
--frozen-lockfile`, so commit the root `bun.lock` with any dependency change).

```bash
bun install
bun run dev          # the editor (Vite, :5173) and the API (:4000) together
bun run --cwd apps/web dev   # the editor alone, exactly as before the monorepo
```

## The verification gate

Run these before you open a pull request, and again before it is merged — from
the root they cover every package through Turbo. There is no CI: pull requests
are reviewed by hand, so this local gate is the only check. Run the browser
campaign too (`bun run e2e` in `apps/web`, see
[`apps/web/e2e/README.md`](apps/web/e2e/README.md)).

```bash
bun run lint         # ESLint — zero errors (warnings are the tracked backlog)
bun run typecheck    # type gate — must be clean
bun run test         # vitest — must pass (bun run db:up first for the database cases)
bun run build        # the editor's app, library and embed builds, and the API bundle
```

## Things that bite first-time contributors

- **Read [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md) before changing anything
  structural in the editor.** It records the deliberate decisions and
  invariants of this codebase — most "obvious cleanups" in this repo are
  re-breaking something that was already fixed once.
- **The `perssonify` naming is intentional.** The product is Markdown Studio,
  but the npm package, the `pf:` preference keys, the `perssonify-document`
  export envelope, the `perssonify-backup` archive and the `perssonify-docs` /
  `perssonify-snapshots` IndexedDB databases are on-disk contracts with existing
  installs ([`apps/web/docs/data-contracts.md`](apps/web/docs/data-contracts.md)).
  Renaming them orphans people's documents. Do not "fix" them.
- **The editor's test files must be `.js`.** `apps/web/vitest.config.js` only
  picks up `*.test.{js,jsx}` — renaming a test to `.ts` silently stops running
  it. (The backend packages use `.ts` tests.)
- **Add tests under [`apps/web/src/__tests__/`](apps/web/src/__tests__/)** for
  anything you fix in the editor.
- **`apps/web/src/components/ui/*` are generated shadcn primitives** —
  regenerate them via the CLI rather than hand-editing. (`input.tsx` and
  `textarea.tsx` are the documented exception: their `forwardRef` wrappers are
  deliberate while React 18 is in the library's peer range, and must be
  re-applied after any regeneration.)
- **A node or mark added to `tiptapPane/index.tsx` must also be registered in
  `apps/web/src/engine/serialize-doc.ts`** (`SERIALIZE_EXTENSIONS`), or headless
  export silently corrupts or throws on documents that use it.
- **Style:** ESLint ([`apps/web/eslint.config.js`](apps/web/eslint.config.js))
  checks correctness — the React hook rules above all — not layout; there is no
  formatter config. Match the surrounding file.

## Pull requests

Branch from `main` (`feat/*` or `fix/*`), keep the change scoped to one
subsystem, and say in the description what changed, why, and how you verified
it. The PR template asks for exactly that.
