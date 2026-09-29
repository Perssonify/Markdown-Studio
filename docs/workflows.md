# Workflows — How Work Gets Done

> What's actually configured in this repo today, not aspirational process. Where something common is **missing**, this doc says so explicitly so you don't go looking for it.

## Branching & PRs

- **Main branch:** `main`. Feature work happens on `type/short-description` branches, merged via PR.
- **Branch naming** (observed in git history): `feat/*`, `fix/*` (e.g. `fix/stefan-improvements`), and topic branches. Follow `type/short-description`.
- **Commit style** (observed): conventional-ish prefixes — `feat:`, `fix:`, `refactor:`, `chore:` — mixed with plain messages (`Update README.md`). Prefer the prefixed form.
- **PRs:** Merged via GitHub (`Merge pull request #11 from …` appears in history). There is **no `CODEOWNERS`, no PR template, and no enforced required reviewers** in the repo. Use normal GitHub review; get one human review before merge.

## Testing strategy

The only test runner is **Vitest** ([vitest.config.js](../vitest.config.js)), jsdom environment, globals on, setup file [src/__tests__/setup.js](../src/__tests__/setup.js) (just `@testing-library/jest-dom`).

```bash
bun run test         # one-shot
bun run test:watch   # watch
```

| Suite | File | Covers |
|-------|------|--------|
| Format utils | [src/__tests__/md-format-utils.test.js](../src/__tests__/md-format-utils.test.js) | markdown wrap/prefix/heading toggling |
| Table ops | [src/__tests__/md-table-ops.test.js](../src/__tests__/md-table-ops.test.js) | pipe-table row/column insert & delete |
| Document model | [src/__tests__/document.test.js](../src/__tests__/document.test.js) | record creation & serialization |
| Sync engine | [src/__tests__/sync-engine.test.js](../src/__tests__/sync-engine.test.js) | bidirectional sync + hash guards |
| Link index | [src/__tests__/link-index.test.js](../src/__tests__/link-index.test.js) | wiki-link parsing, backlink resolution |
| Fidelity | [src/__tests__/fidelity.test.js](../src/__tests__/fidelity.test.js) | serialization-loss detection |
| Suppression | [src/__tests__/suppression.test.js](../src/__tests__/suppression.test.js) | content filtering logic |
| Smoke | [src/__tests__/smoke.test.js](../src/__tests__/smoke.test.js) | components render without crashing |

- **Layers:** these are **unit + light component (smoke)** tests. There are **no integration or e2e tests** (no Playwright/Cypress).
- **What must pass before merge:** run `bun run test` locally and keep it green — there's no bot enforcing it (see CI below). Also keep TypeScript clean: `bunx tsc --noEmit` (strict mode is on, [tsconfig.json](../tsconfig.json)).
- **Tests are `.js`** even though source is `.ts` — Vitest's `include` is `src/__tests__/**/*.test.{js,jsx}` ([vitest.config.js](../vitest.config.js)). A `*.test.ts` file would **not be picked up** unless you widen that glob. See [gotchas.md](gotchas.md).
- **Known-flaky:** none documented.

## CI/CD pipeline

- **CI: GitHub Actions** — [.github/workflows/ci.yml](../.github/workflows/ci.yml) runs on every PR to `main`: `bun install`, `bunx tsc --noEmit`, `bun run test`, then the app/library/embed builds. A red check blocks merge. Run the same gate locally before pushing.
- **CD: Vercel.** [vercel.json](../vercel.json) drives it:
  - Install: `bun install`
  - Build: `bun run build:app` → output `dist-app/`
  - Framework: `vite`
  - SPA rewrite: every path → `/index.html`
  - Vercel's GitHub integration deploys on push (preview deploys for branches, production for `main`) — there is no middleware, and the only serverless function is `api/import.js`, the same-origin import relay ([import-relay.md](import-relay.md)) — auth was removed, see [auth.md](auth.md).

## Release & deployment

- **App:** push to `main` → Vercel builds `dist-app/` and deploys. Rollback = redeploy a previous deployment from the Vercel dashboard.
- **Library (`@perssonify/editor`):** `package.json` is set up for npm publish (`main`/`module`/`exports`) but there's **no publish script or CI publish step**. Publishing is manual: `bun run build` then `npm publish` (with appropriate access). The version is **single-sourced** from [package.json](../package.json) — Vite injects it as `__APP_VERSION__`, which `src/constants.ts` re-exports as `VERSION` (the in-app/About version). Bump `package.json` only.
- **Feature flags:** none. The closest thing is the module-level `ADS_ENABLED` constant in [src/ui/AdUnit.tsx](../src/ui/AdUnit.tsx) (off).

## Observability

This is a client-only app, so "observability" is browser-side:

- **Logs:** structured `[DIAG]` console output ([src/utils/diag.ts](../src/utils/diag.ts)) — categories like `[BOOT]`, `[ENGINE]`, lifecycle, state, errors, with relative timestamps. There's no log shipping; you read them in the user's browser console.
- **Errors:** [src/ui/ErrorBoundary.tsx](../src/ui/ErrorBoundary.tsx) catches render crashes and shows a "Recover Editor" fallback. There is **no error-reporting service** (no Sentry).
- **Dashboards / alerts / paging:** none. The only operational surface is Vercel's deployment/analytics dashboard.

> If you need production telemetry, it has to be added — there's no hook for it today.
