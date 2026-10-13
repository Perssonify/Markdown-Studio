# Workflows — How Work Gets Done

> What's actually configured in this repo today, not aspirational process. Where something common is **missing**, this doc says so explicitly so you don't go looking for it. Settings that live outside the repository (branch protection, Vercel, npm, DNS) are in [deployment.md](deployment.md).

## Branching & PRs

- **Main branch:** `main`. Feature work happens on `type/short-description` branches, merged via PR.
- **Commit style** (observed): conventional-ish prefixes — `feat:`, `fix:`, `refactor:`, `chore:`, `test:`, `ci:`. Prefer the prefixed form, and reference the finding or issue a fix closes.
- **PRs:** a PR template exists ([.github/pull_request_template.md](../../../.github/pull_request_template.md)). There is **no `CODEOWNERS`** and **no CI**: PRs are reviewed by hand, and the author runs the verify gate locally before opening one and again before merging it ([below](#verify-gate-and-deploys)). Required reviews are a branch-protection setting — an owner action ([deployment.md ▸ Gate production on review](deployment.md#gate-production-on-review)); until it is set, nothing *enforces* a review before merge.

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
- **What must pass before merge:** `bun run lint`, `bunx tsc --noEmit`, `bun run test`, the three builds, and the e2e tiers (below) — run locally; there is no CI.

## Verify gate and deploys

- **No CI.** Nothing runs on a PR or a push; the gate below is run by hand, before a PR is opened and again before it is merged. Use the Bun that produced `bun.lock` (`packageManager`) and the Node major in [`.node-version`](../../../.node-version), which lies inside `engines.node` (A113; `ops-node-range.test.js` checks that, and that `engines.node` admits no Node a direct dependency refuses).
  - **The gate** (root [CLAUDE.md](../../../CLAUDE.md) ▸ Verify; the editor's own list is [CLAUDE.md ▸ Verify before you commit](../CLAUDE.md#verify-before-you-commit)): `bun install --frozen-lockfile` → `bun run lint` → `bunx tsc --noEmit` → `bun run test` → `build:app` (which also writes the third-party licence notice from the build's hidden sourcemaps) → the CSP-hash test again against the BUILT `index.html` → library build → `pkg-cjs-require.test.js` and `pkg-declarations.test.js` again, now against the BUILT `dist/` (every CommonJS entry `require`d in plain Node, exports compared with the ES build; a consumer file type-checked against the declarations with `skipLibCheck: false` under `bundler` and `nodenext` resolution) → embed build.
  - **React 18** (A113): the repo develops on React 19, but the library's peer range still admits `^18.3.0`, so the type gate and the unit suite must also pass on React 18.3.1 and its 18.3 types. The check rewrites `package.json` and `bun.lock`, so restore them afterwards:
    ```bash
    bun add -d react@18.3.1 react-dom@18.3.1 @types/react@18.3.31 @types/react-dom@18.3.7
    bunx tsc --noEmit && bun run test
    git checkout package.json bun.lock && bun install --frozen-lockfile
    ```
  - **Browser campaign:** the three builds, then `bun run e2e` on Chromium — every suite but perf: harness, surfaces, deep, dataloss, **floor**, stress, journeys, faults, library, bridge, **csp**, **pwa**. Harness, surfaces, deep, dataloss and floor — the suites `e2e/run.mjs` lists for all three engines — also run on Firefox and WebKit with `E2E_BROWSER` (A100). Checks an engine cannot run print SKIP; checks failing for a reported app defect print XFAIL — see [e2e/README.md](../e2e/README.md#engines).
- **CD: Vercel**, driven by [vercel.json](../vercel.json):
  - Install: `bun install --frozen-lockfile`.
  - Build: `bun run build:app && node scripts/strip-sourcemaps.mjs` → output `dist-app/` (no `.map` files).
  - SPA rewrite: every path except `api/`, `assets/` and `.well-known/` → `/index.html` (a missing hashed chunk 404s instead of being answered with HTML).
  - Headers: immutable caching for `/assets/*`; a report-only CSP pinned to the inline scripts' hashes; enforced anti-framing on the app (not `/embed.html`); `nosniff`, `Referrer-Policy`, `Permissions-Policy`; `no-cache` for `sw.js`, `sw-recover.js`, the manifest and `index.html`.
  - The only serverless function is `api/import.js`, the same-origin import relay ([import-relay.md](import-relay.md)), with `maxDuration: 25`.
  - Vercel's GitHub integration deploys on push (previews for branches, production for `main`); nothing but review and the local gate stands before production ([deployment.md](deployment.md#gate-production-on-review)).

## Release & deployment

- **App:** merge to `main` → Vercel builds and deploys. Open tabs are **prompted** to reload onto the new version; nothing force-reloads them ([decisions.md](decisions.md)). Rollback = Vercel ▸ Deployments ▸ promote a previous deployment.
- **Library (`@perssonify/editor`):** bump `version` in [package.json](../package.json) (the single source — Vite injects it as `__APP_VERSION__`, re-exported as `VERSION` in `src/constants.ts`), merge, then push a `vX.Y.Z` tag. Publishing is manual, by an owner: on that commit, the verify gate, `bun run build`, the built-package checks (`pkg-cjs-require.test.js`, `pkg-declarations.test.js`), then `npm publish --access public` from `apps/web`. Owner setup (npm org, 2FA) and the steps: [deployment.md ▸ Publishing](deployment.md#publishing-the-npm-package).
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
- **Uptime:** none in the repository; an external monitor that pages a person is an owner action.
- **Error-reporting service:** none, by decision ([decisions.md](decisions.md)).
- **Dashboards / alerts / paging:** none in the repository. Vercel spend and usage alerts are owner settings ([import-relay.md ▸ Operating it](import-relay.md#operating-it-owner-setup)).

Runbooks: [runbooks/README.md](runbooks/README.md).
