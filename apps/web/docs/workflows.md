# Workflows — How Work Gets Done

> What's actually configured in this repo today, not aspirational process. Where something common is **missing**, this doc says so explicitly so you don't go looking for it. Settings that live outside the repository (branch protection, Vercel, npm, DNS) are in [deployment.md](deployment.md).

## Branching & PRs

- **Main branch:** `main`. Feature work happens on `type/short-description` branches, merged via PR.
- **Commit style** (observed): conventional-ish prefixes — `feat:`, `fix:`, `refactor:`, `chore:`, `test:`, `ci:`. Prefer the prefixed form, and reference the finding or issue a fix closes.
- **PRs:** a PR template exists ([.github/pull_request_template.md](../../../.github/pull_request_template.md)). There is **no `CODEOWNERS`**. Required reviews and required status checks are branch-protection settings — an owner action ([deployment.md ▸ Gate production on CI](deployment.md#gate-production-on-ci)); until they are set, nothing *enforces* a green CI before merge.

## Testing strategy

- **Unit / component — Vitest** ([vitest.config.js](../vitest.config.js)), jsdom, setup file [src/__tests__/setup.js](../src/__tests__/setup.js). 196 files and 2,126 tests under `src/__tests__/` (September 2026). Only `*.test.{js,jsx}` are collected — a `.ts` test is silently ignored, and a test that renders JSX must be `.jsx`. `import "fake-indexeddb/auto"` gives real IndexedDB semantics.
  ```bash
  bun run test           # one-shot
  bun run test:watch     # watch
  bun run test:coverage  # coverage over ALL of src (81.8% of lines after A108)
  bun run lint           # ESLint + React hook rules: 0 errors required
  ```
- **Known-flaky: none.** The suite used to exit 1 in about a third of runs with
  every test green: TipTap's `focus()` scrolls on the NEXT animation frame, and when
  that frame fired after a file had finished, ProseMirror called
  `Range#getClientRects` — which jsdom lacks — as an unowned error. `setup.js` now
  gives `Range` the same empty geometry jsdom gives elements
  (`testenv-geometry.test.jsx` reproduces the race), and tests that cold-import big
  dependencies declare their own time budget (A107). If a test that reads source
  files fails on untouched code, check line endings first: a CRLF checkout
  (`core.autocrlf=true` on Windows) broke `sync-perf.test.js`, which matches call
  sites like `"<MenuBar\n"`. `.gitattributes` pins LF (`* text=auto eol=lf`); an
  older clone may need `git add --renormalize .` or a fresh checkout.
- **Browser campaign — [e2e/](../e2e/README.md)** (playwright-core; Chromium, with the engine-neutral suites also on Firefox and WebKit via `E2E_BROWSER`; no test runner): real IME composition, real IndexedDB, two tabs, quota exhaustion, blocked storage, coarse pointers, the embed bridge from a second origin, the published stylesheet on a host page, **vercel.json's CSP enforced** (`csp`), and **the service worker offline and across an update** (`pwa`). `e2e/README.md` states what it does not cover.
  ```bash
  bun run build:app && bun run e2e      # every suite except perf
  node e2e/run.mjs csp pwa              # selected suites
  ```
- **The rule for both:** a test that cannot fail is worse than none. Mutation-test every guard — revert the fix, watch the case go red, restore.
- **What must pass before merge:** `bun run lint`, `bunx tsc --noEmit`, `bun run test`, the three builds, and the e2e tiers CI runs (below).

## CI/CD pipeline

- **CI: GitHub Actions** — [.github/workflows/ci.yml](../../../.github/workflows/ci.yml), on every PR to `main` and every push to it. Bun is pinned (`BUN_VERSION`, the version that produced `bun.lock`), and so is Node: every job that installs the toolchain first runs `actions/setup-node` with [`.node-version`](../../../.node-version), a major inside `engines.node` (A113; `ops-node-range.test.js` checks both, and that `engines.node` admits no Node a direct dependency refuses). Every action is pinned to a commit SHA, and the workflow only has `contents: read`.
  - job **`verify`**: `bun install --frozen-lockfile` → `bun run lint` → `bunx tsc --noEmit` → `bun run test` → `build:app` (which also writes the third-party licence notice from the build's hidden sourcemaps) → the CSP-hash test again against the BUILT `index.html` → strip sourcemaps (kept as a 90-day artifact on pushes) → library build → `pkg-cjs-require.test.js` and `pkg-declarations.test.js` again, now against the BUILT `dist/` (every CommonJS entry `require`d in plain Node, exports compared with the ES build; a consumer file type-checked against the declarations with `skipLibCheck: false` under `bundler` and `nodenext` resolution) → embed build.
  - job **`react18`** (A113): the repo develops on React 19, but the library's peer range still admits `^18.3.0`, so this job installs from the lockfile, then swaps in React 18.3.1 and its 18.3 types with `bun add -d` (in that job only — nothing is written back) and runs `bunx tsc --noEmit` and `bun run test` against them. The same check locally — it rewrites `package.json` and `bun.lock`, so restore them afterwards:
    ```bash
    bun add -d react@18.3.1 react-dom@18.3.1 @types/react@18.3.31 @types/react-dom@18.3.7
    bunx tsc --noEmit && bun run test
    git checkout package.json bun.lock && bun install --frozen-lockfile
    ```
  - job **`e2e`**: the three builds, Chromium, then harness → surfaces → deep → dataloss → **floor** → library → bridge → journeys → faults → **csp** → **pwa** (and stress on pushes).
  - job **`e2e-engines`** (A100): a Firefox + WebKit matrix running harness → surfaces → deep → dataloss → floor on each, the suites `e2e/run.mjs` lists for all three engines (`ops-release-config.test.js` keeps the two in step). Checks an engine cannot run print SKIP; checks failing for a reported app defect print XFAIL — see [e2e/README.md](../e2e/README.md#engines).
  - [dependabot.yml](../../../.github/dependabot.yml): weekly grouped PRs for the Bun lockfile and the pinned actions.
  - [uptime.yml](../../../.github/workflows/uptime.yml): every 30 minutes, checks that markdownstudio.com serves the app shell and its entry script.
- **CD: Vercel**, driven by [vercel.json](../vercel.json):
  - Install: `bun install --frozen-lockfile`.
  - Build: `bun run build:app && node scripts/strip-sourcemaps.mjs` → output `dist-app/` (no `.map` files).
  - SPA rewrite: every path except `api/`, `assets/` and `.well-known/` → `/index.html` (a missing hashed chunk 404s instead of being answered with HTML).
  - Headers: immutable caching for `/assets/*`; a report-only CSP pinned to the inline scripts' hashes; enforced anti-framing on the app (not `/embed.html`); `nosniff`, `Referrer-Policy`, `Permissions-Policy`; `no-cache` for `sw.js`, `sw-recover.js`, the manifest and `index.html`.
  - The only serverless function is `api/import.js`, the same-origin import relay ([import-relay.md](import-relay.md)), with `maxDuration: 25`.
  - Vercel's GitHub integration deploys on push (previews for branches, production for `main`). Gating production on CI is an owner setting ([deployment.md](deployment.md#gate-production-on-ci)).

## Release & deployment

- **App:** merge to `main` → Vercel builds and deploys (once gated: after `verify` and `e2e` pass). Open tabs are **prompted** to reload onto the new version; nothing force-reloads them ([decisions.md](decisions.md)). Rollback = Vercel ▸ Deployments ▸ promote a previous deployment.
- **Library (`@perssonify/editor`):** bump `version` in [package.json](../package.json) (the single source — Vite injects it as `__APP_VERSION__`, re-exported as `VERSION` in `src/constants.ts`), merge, then push a `vX.Y.Z` tag. [.github/workflows/publish.yml](../../../.github/workflows/publish.yml) verifies the tag, runs the type check, tests and library build, `require`s the built CommonJS entries, type-checks a consumer against the built declarations, and publishes with **npm provenance** behind the `npm` environment. Never publish from a laptop. Owner setup (npm org, 2FA, token or trusted publishing): [deployment.md ▸ Publishing](deployment.md#publishing-the-npm-package).
- **Feature flags:** none. Build-time gates exist for dev-only surfaces (the ad placeholders; the Settings Admin section, which a support session can reveal with `localStorage["pf:admin"] = "1"` — [src/utils/build-gates.ts](../src/utils/build-gates.ts)).

## TypeScript 7

The type gate runs on **TypeScript 6.0** (`typescript@^6.0.3`), the newest release every tool in this repo can use. TypeScript 7 (the native compiler) was tried for A113 and is **blocked by tooling, not by this code**:

- **typescript-eslint** — 8.71, the latest release, declares `typescript >=4.8.4 <6.1.0` — parses through the `typescript` package's JavaScript API (`ts.createSourceFile`, programs, the type checker). The `typescript@7` package's main entry exports only `version`; its compiler API is an IPC client under `typescript/unstable/*`. With 7 installed as `typescript`, `bun run lint` cannot run.
- **`converter-escape.test.js`** (the A097 guard: no lookbehind regex literal in the entry chunk) calls `ts.createSourceFile` too.

What 7.0.2 does today, measured against this tree (30 September 2026): `tsc --noEmit` is clean in 1.6 s (6.0 takes 9.4 s), and `tsc -p tsconfig.build.json` emits the same 218 declaration files as 6.0 does, differing only in the order of union members and object properties. The configuration 7 needs is already in place and 6.0 accepts it: no `baseUrl` (removed in 7 — `paths` resolve from the tsconfig's directory), an explicit `rootDir` in `tsconfig.build.json` (the default became the tsconfig's own directory, which would publish `dist/src/index.d.ts` under an exports map that points at `dist/index.d.ts`), and `src/types/side-effect-imports.d.ts`, because `noUncheckedSideEffectImports` is on by default since 6.0. Check 7 at any time without touching the lockfile:

```bash
bunx -p typescript@7 tsc --noEmit
bunx -p typescript@7 tsc -p tsconfig.build.json --outDir /tmp/ts7-dts
```

Re-checked 1 October 2026: still blocked. typescript-eslint 8.71.0 and its newest canary (8.71.1-alpha.2) still declare `typescript >=4.8.4 <6.1.0`, and `typescript@7.0.2`'s main entry still exports only `version` (its `exports` map offers the compiler only as `./unstable/*`).

The move, once unblocked: (1) a typescript-eslint release whose peer range includes 7; (2) `converter-escape.test.js` reads regex literals through an API 7 provides — `typescript/unstable/ast`, or `@typescript/typescript6`, the compatibility package that re-exports the 6.0 API (with a `tsc6` binary) beside 7; (3) bump `typescript` to `^7`, update `src/data/credits.ts` and run every gate. Installing 7 as `typescript` next to an aliased 6 is not a shortcut: typescript-eslint imports the package named `typescript`.

## Observability

Most observability is browser-side, and none of the browser-side part leaves the device unless the user copies it:

- **Diagnostics ring** ([src/utils/diagnostics.ts](../src/utils/diagnostics.ts)): uncaught errors, unhandled rejections, error-boundary crashes, failed lazy chunks, failed/refused/conflicted saves, service-worker problems and boot-watchdog recoveries — redacted, bounded (25), local. Users copy it from the crash screen or Help ▸ About (**Copy diagnostics**); it contains no document content. A host embedding the library can subscribe with `setErrorReporter(fn)` or the `ErrorBoundary`'s `onError`.
- **[DIAG] logs** ([src/utils/diag.ts](../src/utils/diag.ts)): detailed tracing, OFF by default — `?diag=1` or `localStorage.setItem("perssonify-diag", "1")`.
- **Relay logs:** one structured JSON line per `/api/import` request in the Vercel logs (host, status, bytes, ms, reason — never the URL's path or query).
- **Uptime:** the scheduled workflow above; an external monitor that pages a person is an owner action.
- **Error-reporting service:** none, by decision ([decisions.md](decisions.md)).
- **Dashboards / alerts / paging:** none in the repository. Vercel spend and usage alerts are owner settings ([import-relay.md ▸ Operating it](import-relay.md#operating-it-owner-setup)).

Runbooks: [runbooks/README.md](runbooks/README.md).
