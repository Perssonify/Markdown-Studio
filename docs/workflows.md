# Workflows — How Work Gets Done

> What's actually configured in this repo today, not aspirational process. Where something common is **missing**, this doc says so explicitly so you don't go looking for it. Settings that live outside the repository (branch protection, Vercel, npm, DNS) are in [deployment.md](deployment.md).

## Branching & PRs

- **Main branch:** `main`. Feature work happens on `type/short-description` branches, merged via PR.
- **Commit style** (observed): conventional-ish prefixes — `feat:`, `fix:`, `refactor:`, `chore:`, `test:`, `ci:`. Prefer the prefixed form, and reference the finding or issue a fix closes.
- **PRs:** a PR template exists ([.github/pull_request_template.md](../.github/pull_request_template.md)). There is **no `CODEOWNERS`**. Required reviews and required status checks are branch-protection settings — an owner action ([deployment.md ▸ Gate production on CI](deployment.md#gate-production-on-ci)); until they are set, nothing *enforces* a green CI before merge.

## Testing strategy

- **Unit / component — Vitest** ([vitest.config.js](../vitest.config.js)), jsdom, setup file [src/__tests__/setup.js](../src/__tests__/setup.js). Over a hundred files under `src/__tests__/`. Only `*.test.{js,jsx}` are collected — a `.ts` test is silently ignored, and a test that renders JSX must be `.jsx`. `import "fake-indexeddb/auto"` gives real IndexedDB semantics.
  ```bash
  bun run test         # one-shot
  bun run test:watch   # watch
  ```
- **Browser campaign — [e2e/](../e2e/README.md)** (playwright-core + Chromium, no test runner): real IME composition, real IndexedDB, two tabs, quota exhaustion, blocked storage, coarse pointers, the embed bridge from a second origin, the published stylesheet on a host page, **vercel.json's CSP enforced** (`csp`), and **the service worker offline and across an update** (`pwa`). `e2e/README.md` states what it does not cover.
  ```bash
  bun run build:app && bun run e2e      # every suite except perf
  node e2e/run.mjs csp pwa              # selected suites
  ```
- **The rule for both:** a test that cannot fail is worse than none. Mutation-test every guard — revert the fix, watch the case go red, restore.
- **What must pass before merge:** `bunx tsc --noEmit`, `bun run test`, the three builds, and the e2e tiers CI runs (below).

## CI/CD pipeline

- **CI: GitHub Actions** — [.github/workflows/ci.yml](../.github/workflows/ci.yml), on every PR to `main` and every push to it. Bun is pinned (`BUN_VERSION`, the version that produced `bun.lock`), every action is pinned to a commit SHA, and the workflow only has `contents: read`.
  - job **`verify`**: `bun install --frozen-lockfile` → lint (once a `lint` script exists) → `bunx tsc --noEmit` → `bun run test` → `build:app` → the CSP-hash test again against the BUILT `index.html` → strip sourcemaps (kept as a 90-day artifact on pushes) → library build → embed build.
  - job **`e2e`**: the three builds, Chromium, then harness → surfaces → deep → dataloss → library → bridge → journeys → faults → **csp** → **pwa** (and stress on pushes).
  - [dependabot.yml](../.github/dependabot.yml): weekly grouped PRs for the Bun lockfile and the pinned actions.
  - [uptime.yml](../.github/workflows/uptime.yml): every 30 minutes, checks that markdownstudio.com serves the app shell and its entry script.
- **CD: Vercel**, driven by [vercel.json](../vercel.json):
  - Install: `bun install --frozen-lockfile`.
  - Build: `bun run build:app && node scripts/strip-sourcemaps.mjs` → output `dist-app/` (no `.map` files).
  - SPA rewrite: every path except `api/`, `assets/` and `.well-known/` → `/index.html` (a missing hashed chunk 404s instead of being answered with HTML).
  - Headers: immutable caching for `/assets/*`; a report-only CSP pinned to the inline scripts' hashes; enforced anti-framing on the app (not `/embed.html`); `nosniff`, `Referrer-Policy`, `Permissions-Policy`; `no-cache` for `sw.js`, `sw-recover.js`, the manifest and `index.html`.
  - The only serverless function is `api/import.js`, the same-origin import relay ([import-relay.md](import-relay.md)), with `maxDuration: 25`.
  - Vercel's GitHub integration deploys on push (previews for branches, production for `main`). Gating production on CI is an owner setting ([deployment.md](deployment.md#gate-production-on-ci)).

## Release & deployment

- **App:** merge to `main` → Vercel builds and deploys (once gated: after `verify` and `e2e` pass). Open tabs are **prompted** to reload onto the new version; nothing force-reloads them ([decisions.md](decisions.md)). Rollback = Vercel ▸ Deployments ▸ promote a previous deployment.
- **Library (`@perssonify/editor`):** bump `version` in [package.json](../package.json) (the single source — Vite injects it as `__APP_VERSION__`, re-exported as `VERSION` in `src/constants.ts`), merge, then push a `vX.Y.Z` tag. [.github/workflows/publish.yml](../.github/workflows/publish.yml) verifies the tag, runs the type check, tests and library build, and publishes with **npm provenance** behind the `npm` environment. Never publish from a laptop. Owner setup (npm org, 2FA, token or trusted publishing): [deployment.md ▸ Publishing](deployment.md#publishing-the-npm-package).
- **Feature flags:** none. Build-time gates exist for dev-only surfaces (e.g. ad placeholders).

## Observability

This is a client-only app, so most observability is browser-side, and none of it leaves the device:

- **Diagnostics ring** ([src/utils/diagnostics.ts](../src/utils/diagnostics.ts)): uncaught errors, unhandled rejections, error-boundary crashes, failed lazy chunks, failed/refused/conflicted saves, service-worker problems and boot-watchdog recoveries — redacted, bounded (25), local. Users copy it from the crash screen or Help ▸ About (**Copy diagnostics**); it contains no document content. A host embedding the library can subscribe with `setErrorReporter(fn)` or the `ErrorBoundary`'s `onError`.
- **[DIAG] logs** ([src/utils/diag.ts](../src/utils/diag.ts)): detailed tracing, OFF by default — `?diag=1` or `localStorage.setItem("perssonify-diag", "1")`.
- **Relay logs:** one structured JSON line per `/api/import` request in the Vercel logs (host, status, bytes, ms, reason — never the URL's path or query).
- **Uptime:** the scheduled workflow above; an external monitor that pages a person is an owner action.
- **Error-reporting service:** none, by decision ([decisions.md](decisions.md)).
- **Dashboards / alerts / paging:** none in the repository. Vercel spend and usage alerts are owner settings ([import-relay.md ▸ Operating it](import-relay.md#operating-it-owner-setup)).

Runbooks: [runbooks/README.md](runbooks/README.md).
