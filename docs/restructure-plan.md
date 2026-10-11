# Folder restructure: plan

**Status:** Done. You approved the plan with its defaults, Phases 3 and 4 have run, and the results are in §15.
**Branch:** `refactor/folder-structure` (local only: 8 commits on top of `22d8aff`, not pushed), checked out in the git-ignored worktree `.claude/worktrees/refactor-folder-structure`. Your checkout of `main` and its uncommitted edits (`apps/web/src/App.tsx`, `apps/web/src/i18n/en/account.ts`, `apps/web/src/ui/pages/LoginPage.tsx`) were not touched. The baseline below is `HEAD` without those edits.

## 1. Summary

- **API (`apps/api`):** the module layout from the brief: `modules/{auth,health,importRelay,sync}`, `middlewares/`, `config/`, `lib/` and `utils/`. Unit tests sit next to their code, integration tests go in `tests/integration/` and the shared fixture in `tests/fixtures/`. That is 21 moves and 4 new barrel files, and it fits every constraint.
- **Web (`apps/web`), recommended Option A:** feature folders inside the existing top-level layers (`ui/<feature>/`, `store/<feature>/`, `app/account/`), named by the team convention. That is 126 moves, and every contract the tests and the npm package depend on stays exactly as it is.
  **Option B** is features-first, like the example tree (`src/features/<feature>/…`). It is also possible within the brief, but it widens what two tests scan and moves about 60% more (§7).
- **Left in place, because moving them needs logic or config edits the brief rules out:** web unit tests stay in `src/__tests__/`, web e2e stays in `e2e/`, `docker-compose.yml` stays at the root, and `packages/db` and `infra` are unchanged (§5).
- **How "no behaviour change" will be shown:**
  - the same gates pass;
  - the same 4,574 test names pass or fail as before, with the same 3 pre-existing failures;
  - the route and endpoint tables are identical;
  - the build output is byte-identical once chunk file names and bundler path comments are normalised;
  - the same 5 pre-existing import cycles remain, and no new ones (§11).

## 2. The repository

| | |
|---|---|
| Package manager | Bun (`packageManager: bun@1.4.0`; 1.4.2 installed), one hoisted `bun.lock` |
| Workspaces | Bun workspaces `apps/*`, `packages/*`, `infra`; Turborepo 2.11.6 |
| Web | Vite 8 + React 19 + TypeScript 6. **Not Next.js:** routing is a hand-written History-API router (`src/app/router.tsx`). It ships three ways: the app (`index.html` → `src/main.tsx`), the iframe embed (`embed.html` → `src/embed.tsx`), and the npm library `@perssonify/editor`, which has 4 entry points. |
| API | Hono 4.13 on Node 24. Node runs the TypeScript directly with types stripped (`nodenext`), so every import carries `.ts` and directory imports are not allowed. Entries: `server.ts` (local), `vercel.ts` (Vercel Function), `lambda.ts` and `migrate-lambda.ts` (AWS). |
| Other packages | `packages/db` (Drizzle schema and SQL migrations), `infra` (AWS CDK) |
| Tests | Vitest 5 in all four packages. Web e2e is a Playwright-core rig (`apps/web/e2e/run.mjs`), not part of `bun run test`. |
| Path aliases | Web: `@/*` → `src/*` (tsconfig `paths`, all three Vite configs, Vitest). API: none (relative `.ts` imports). |

## 3. Baseline (`HEAD` 22d8aff, clean worktree, Windows 11, Node 24.21)

| Check | Command | Result |
|---|---|---|
| Install | `bun install --frozen-lockfile` | ✅ 880 packages, lockfile unchanged |
| Lint | `turbo run lint` | ✅ 0 errors (web 112 warnings; api, db, infra none) |
| Typecheck | `turbo run typecheck` | ✅ 4 of 4 packages |
| Build | `turbo run build build:app build:embed` | ✅ 6 of 6 tasks (library, app, embed, API bundles, db, infra) |
| Tests | `vitest run` in each package, with Postgres and S3 from `bun run db:up` | ⚠️ 8 failures, all pre-existing (below) |

| Package | Test files | Tests | Passed | Failed |
|---|---:|---:|---:|---:|
| apps/web | 276 | 4,438 | 4,430 | 8 |
| apps/api | 9 | 84 | 84 | 0 |
| packages/db | 2 | 13 | 13 | 0 |
| infra | 6 | 39 | 39 | 0 |
| **Total** | **293** | **4,574** | **4,566** | **8** |

All 8 web failures happen on `HEAD` before any change. I re-ran only those 6 files, once, in isolation:

- **3 fail every time.** The cause is file content, not the environment:
  - `a11y-keyboard-order.test.jsx` › puts the skip link first in the app shell (`expected 8776 to be less than -1`)
  - `g4-privacy.test.jsx` › no absolute 'nothing ever leaves' claims › `src/i18n/en/account.ts` (an "import and export … PDF" string)
  - `g4-privacy.test.jsx` › Settings ▸ Privacy ▸ Import relay reflects and changes the stored answer (no "Not decided yet" text)
- **5 pass when run alone.** Under the full suite's load they time out or run out of a time budget:
  - `code-block-plain-view` (mermaid card, 20 s)
  - `i18n-render` (pseudo-locale, 60 s)
  - `pkg-cjs-require`, two tests (5 s each)
  - `scroll-anchors` › markdownHeadings

Two of the three that always fail read files you currently have uncommitted edits in (`App.tsx`, `i18n/en/account.ts`), so you may already be fixing them.

**The builds are deterministic.** Rebuilding the unchanged source gave byte-identical `dist-embed/` and `dist-app/` (only `sw.js.map` differed) and byte-identical API bundles. That makes a byte-level comparison usable as proof in Phase 4.

**Import cycles** (madge 8, run through `npx` and not installed): the API has none. The web app has 5, all pre-existing in `store/`:

- `document ↔ canonical-sanitize`
- `document ↔ ingest`
- `idb-storage-adapter ↔ storage-adapter`
- `documentStore ↔ tab-sync`
- `url-import ↔ import-url-normalize`

## 4. Baseline routes and endpoints

**Web**, captured by running `src/app/router.tsx` itself:

| Route | Path | Renders |
|---|---|---|
| editor | `/` and any unknown path | the editor |
| about | `/about` | `AboutPage` (lazy) |
| help | `/help` | `HelpPage` (lazy) |
| graph | `/graph` | the editor with the map overlay open |
| login | `/login` | `LoginPage` (lazy; accounts build only) |
| profile | `/profile` | `ProfilePage` (lazy; accounts build only) |

The HTML entries are `index.html` → `/src/main.tsx` and `embed.html` → `/src/embed.tsx`. Vercel's SPA rewrite lives in the root `vercel.json`, which this work does not touch. The other lazy chunks are `Walkthrough`, `FindReplace`, `GraphView`, `CardsView`, `WorkspacePanel`, `docx-export` and `docx-import`.

**API**, from Hono's route table of the real `createApp()`, in registration order:

```
ALL     /*                      origin check (only when ORIGIN_VERIFY_SECRET is set)
ALL     /api/import             import relay (registered before CORS on purpose)
ALL     /*                      CORS
GET     /health
GET     /api/health
GET     /api/auth/*
POST    /api/auth/*
ALL     /api/sync/*             sync middleware
GET     /api/sync/state
GET     /api/sync/documents/:id
PUT     /api/sync/documents/:id
DELETE  /api/sync/documents/:id
PUT     /api/sync/library
POST    /api/sync/assets/upload
POST    /api/sync/assets/commit
POST    /api/sync/assets/download
GET     /api/sync/documents/:id/versions
GET     /api/sync/documents/:id/versions/:versionId
POST    /api/sync/backups/upload
GET     /api/sync/backups
GET     /api/sync/backups/:date
```

Both tables are saved. After the moves I will capture them again with the same scripts and diff them.

## 5. What stays where it is, and why

### Paths that tooling or deployment depends on

| Path | Why it stays |
|---|---|
| `apps/web/index.html`, `embed.html`, `src/main.tsx`, `src/embed.tsx` | Vite HTML entries. The HTML names `/src/main.tsx` and `/src/embed.tsx` directly. |
| `apps/web/src/index.tsx`, `src/engine/useMarkdownEngine.ts`, `src/store/index.ts`, `src/integration/index.ts` | The npm package's four entry points: `vite.config.ts` `lib.entry`, `tsconfig.build.json`, and `package.json` `exports`, which names `dist/engine/useMarkdownEngine.d.ts`, `dist/store/index.d.ts` and `dist/integration/index.d.ts`. Moving any of them changes the published package. |
| `apps/web/api/import.js` | A Vercel Function by file convention. The API also runs it, and `turbo.json` lists it. |
| `apps/web/src/components/ui/*`, `src/lib/utils.ts`, `src/hooks/use-mobile.ts` | Generated by shadcn. The `components.json` aliases (`@/components/ui`, `@/lib/utils`, `@/hooks`) regenerate them in these places. |
| `apps/web/src/styles.css` | Named in `components.json` (`tailwind.css`) |
| `apps/web/src/i18n/**` | Tests read the catalog by path (`src/i18n/en`, `src/i18n/en.ts`). |
| `apps/web/src/__tests__/**` | See the next table. |
| `apps/web/public/`, `build/`, `scripts/`, `marketing/`, `docs/` | Static assets and build scripts called from `package.json`, from `vercel.json` (`node scripts/strip-sourcemaps.mjs`) and from CI |
| `apps/api/src/vercel.ts` | The root `vercel.json` names it as `entrypoint` and as a `functions` key. |
| `apps/api/src/{server,lambda,migrate-lambda}.ts` | `rolldown.config.ts` entries, also used by the `package.json` dev script and by infra. They stay at `src/`, like the example's `server.ts`. |
| `apps/api/src/{app,bootstrap}.ts` | The composition root shared by the three entries, kept beside them |
| `apps/api/scripts/` | Called from `package.json` and the Vercel build |
| `packages/db/**`, including `drizzle/` migrations | Out of scope (not the web app or the API), and migrations are on the do-not-touch list |
| `vercel.json`, `turbo.json`, `bunfig.toml`, the `package.json` files, `tsconfig*.json`, `.github/workflows/` | Root configs |

### Asked for in the brief, but not possible within its constraints

| Request | What blocks it |
|---|---|
| Put web unit tests next to their code as `*.test.ts(x)` | Three things, each of which would mean changing test logic or lint config:<br>1. The tests are JavaScript, and Vitest only collects `src/__tests__/**/*.test.{js,jsx}`. Renamed to `.ts(x)`, they would fall under `tsc`'s `src/**` include with `noImplicitAny`, which is a typing project, and under `tsconfig.build.json`, which would ship them as `.d.ts` files.<br>2. Five tests scan `src/` as source and skip only folders named `__tests__`. A test placed next to its code would be scanned as source; for example `converter-escape` would flag the lookbehind regex in `a11y-accent-text.test.js`.<br>3. `eslint.config.js` turns off `no-require-imports` only for `src/__tests__/**`, and 5 test files use `require`. |
| Move web tests to `apps/web/tests/…` instead | Blocked by point 3 above: it needs a one-line glob change in `eslint.config.js`, which is lint config (decision D5). |
| Move web `e2e/` to `tests/e2e/` | The rig works out its own root at runtime as `e2e/..` (`lib.mjs`, `run.mjs`). `ops-release-config.test.js` checks CI for `node e2e/run.mjs` with regexes. `scripts/doc-anchors.mjs` only recognises anchor paths that start with `e2e/`. On top of that: 14 `package.json` scripts, CI steps and artifact paths, and `.gitignore` (decision D4). |
| API `params/` and `repositories/` folders | The zod request schemas and the Drizzle queries are inside `routes/sync.ts` (362 lines). Splitting that file would change its content, so it is a follow-up. |
| Group infra under `infra/` | It is already there: `infra/` is the CDK app. `docker-compose.yml` stays at the root because `bun run db:up` runs a bare `docker compose up` and the docs point to it; moving it needs a `-f` flag in the root `package.json`. Listed as a recommendation only. |

## 6. Target layout (Option A)

### Naming rules

- **R1, components:** each React component module becomes `<camelCaseName>/index.tsx`, so `MenuBar.tsx` becomes `menuBar/index.tsx`. Helpers used by only that component go inside its folder.
- **R2, other web modules:** they keep their file names and move into camelCase feature folders, so `store/graph-metrics.ts` becomes `store/graph/graph-metrics.ts`. Helpers shared within a feature go in that feature's `hooks/` or `utils/` folder. Reason: the docs and tests mention these file names about 2,000 times, and keeping the names keeps every mention searchable.
- **R3, barrels:** none in the web app. A barrel changes the order modules run in, and it can pull a lazily loaded module into the startup chunk. Direct imports are what keep the build byte-identical. The API gets one barrel per module (`modules/<name>/index.ts`), as in the example: Node does no chunking, the import graph is small, and madge confirms there are no cycles.
- **API modules** follow the convention strictly: each is `<camelCase>/index.ts`.
- **Imports:** only specifiers that have to change are rewritten. In the web app, a rewritten path that would climb more than one level uses `@/…` instead. API imports stay relative with an explicit `.ts`, as `nodenext` requires.

### API, after the move

```
apps/api/
  src/
    app.ts  bootstrap.ts  server.ts  vercel.ts  lambda.ts  migrate-lambda.ts   entries, unchanged
    lambda.test.ts                     unit test (was test/lambda.test.ts)
    config/env/{index.ts, env.test.ts}
    lib/storage/index.ts               S3 client
    lib/awsSecrets/index.ts            Secrets Manager / SSM clients
    middlewares/cors/index.ts
    middlewares/originVerify/index.ts
    modules/
      auth/{index.ts, routes/index.ts, services/index.ts}
      health/{index.ts, routes/index.ts}
      importRelay/{index.ts, routes/index.ts}
      sync/{index.ts, routes/index.ts}
    utils/vercelHandler/index.ts
  tests/
    fixtures/index.ts                  testApp (was test/helpers.ts)
    integration/{auth,cors,health,importRelay,originVerify,storage,sync}.test.ts
```

### Web, after the move (Option A): only `ui/`, `store/` and `app/` change

```
apps/web/src/
  App.tsx  EditorHeader.tsx  PerssonifyEditor.tsx  constants.ts  embed.tsx  index.tsx  main.tsx  styles.css
  __tests__/          unchanged (283 files)
  app/
    account/          account.ts, accountAvatar/, accountBackups/, accountCheckScreen/, accountMenu/, cloudStatusLine/, plansSection/
    cloud/            unchanged
    router.tsx        unchanged
  components/ui/      unchanged (shadcn)
  data/ editor/ engine/ extensions/ formatting/ hooks/ i18n/ integration/ lib/ pwa/ theme/ types/ utils/   unchanged
  store/
    index.ts          the package's ./store entry; only its re-export paths change
    assets/ cards/ diagnostics/ documents/ editor/ graph/ history/ importExport/ links/ persistence/ preferences/ search/
  ui/
    cards/            cardsView/
    chrome/           bottomTray/ editorContextMenu/ icons/ keyboardShortcutsDialog/ menuBar/ modeSwitcher/
                      selectMenuContent/ statusBar/ tableGridPicker/ toolbar/ hooks/
    dialogs/          index.tsx (was Dialogs.tsx), confirmDialog/, dialogProvider/
    diagnostics/      consolePanel/ diagnosticsActions/ memorySheet/
    find/             findReplace/ searchPanel/ utils/
    graph/            graphView/
    history/          versionHistorySheet/
    importExport/     residualsDialog/ urlImportDialog/
    links/            backlinksPanel/
    notices/          durabilityNotices/ noticeStrip/ tabSyncNotice/
    pages/            aboutPage/ helpPage/ loginPage/ pageChrome/ profilePage/
    panes/            codeBlockCopyButton/ codeBlockWithCopy/ codeMirrorPane/ diagramPreview/ editorPanes/
                      linkBubbleMenu/ tableBubbleMenu/ tiptapPane/ utils/
    settings/         eraseLocalData/ languageSetting/ settingsPrivacy/ settingsSheet/ settingsStorage/ themeControls/
    share/            linkBuilder/ linkBuilderDialog/
    shared/           adUnit/ errorBoundary/ lazyChunkBoundary/ oneEditorPerPage/ skipToEditor/ toast/ hooks/ utils/
    tour/             walkthrough/
    workspace/        docNavPanel/ folderTree/ workspacePanel/ hooks/ utils/
```

**Why A keeps the layers at the top.** In this repo the layer folders are contracts, not just folders:

- `ui/` is exactly the set of files `a11y-accent-text` scans.
- `ui/`, `editor/`, `hooks/`, `formatting/`, `extensions/`, `integration/` and `pwa/` are what the i18n scanner scans (its `ROOTS` list).
- `store/` holds the library's server-safe `./store` entry, which must not carry `"use client"`.
- `engine/` and `integration/` hold published entry points.

A keeps every one of those scans exactly as it is, because no file moves into or out of a scanned folder. The same feature names are used under `ui/` and `store/` (graph, cards, history, importExport and so on), so the UI and the state for one feature sit in parallel places.

## 7. Option B: features-first, like the example

The shape would be `src/features/<feature>/{components,hooks,services,utils,types}`, built from `ui/`, `store/`, `editor/`, `hooks/`, `formatting/` and `data/`. That is roughly 160 to 200 moves and about 1,350 import rewrites, against A's 126 and 1,066. `engine/`, `extensions/`, `theme/`, `utils/` and `i18n/` stay at the top level as shared code, because both the core and the features import them. `app/` keeps the code that only the standalone app uses (account, cloud). Two tests would need path changes:

- **`a11y-accent-text`:** its root changes from `src/ui` to `src/features`. For that to work, shared UI would have to live in `src/features/shared/` rather than the example's `src/components/`, because shadcn's `button.tsx` there breaks the rule this test enforces. The account UI would stay in `src/app/`, because two of its files (`AccountBackups.tsx`, `PlansSection.tsx`) break it too. Today's test does not look in `src/app/`.
- **The i18n scanner's `ROOTS`:** `src/ui`, `src/editor` and `src/formatting` become `src/features`. That adds 79 store, utils, data and theme files to the scan. I ran the repository's own scanner over those files and it found 0 hits.

Both are path-only edits, but both widen what a test checks, so I'm listing them rather than deciding them for you. The fixed paths also leave two placeholders: `src/store/` would hold only the package's `index.ts`, and `src/hooks/` only shadcn's `use-mobile.ts`.

**Why I still lean to A:** B's main gain is putting each feature's UI and state in one folder. A gets most of the navigation benefit (the same feature names in `ui/` and `store/`) with about 60% of the churn. It does not widen any test's scope, it does not leave placeholder folders, and it means fewer merge conflicts for the five open branches. If you prefer B, say so and I'll publish its full move map before moving anything. Doing A now does not block doing B later.

## 8. Move maps

### apps/api: 21 moves and 4 new barrels

Paths are relative to `apps/api/`.

| old path | new path | reason |
| --- | --- | --- |
| `src/config/env.ts` | `src/config/env/index.ts` | config module |
| `src/middleware/cors.ts` | `src/middlewares/cors/index.ts` | middleware |
| `src/middleware/origin-verify.ts` | `src/middlewares/originVerify/index.ts` | middleware |
| `src/routes/auth.ts` | `src/modules/auth/routes/index.ts` | auth module: routes |
| `src/lib/auth.ts` | `src/modules/auth/services/index.ts` | auth module: Better Auth service |
| `src/routes/health.ts` | `src/modules/health/routes/index.ts` | health module: routes |
| `src/routes/import-relay.ts` | `src/modules/importRelay/routes/index.ts` | import-relay module: routes |
| `src/routes/sync.ts` | `src/modules/sync/routes/index.ts` | sync module: routes + request schemas + queries (one file; splitting is a content change) |
| `src/lib/storage.ts` | `src/lib/storage/index.ts` | S3 client setup (shared) |
| `src/lib/aws-secrets.ts` | `src/lib/awsSecrets/index.ts` | Secrets Manager/SSM client setup |
| `src/lib/vercel-handler.ts` | `src/utils/vercelHandler/index.ts` | generic Vercel-handler → Fetch adapter |
| `test/env.test.ts` | `src/config/env/env.test.ts` | unit test, co-located |
| `test/lambda.test.ts` | `src/lambda.test.ts` | unit test, co-located |
| `test/helpers.ts` | `tests/fixtures/index.ts` | shared fixture (testApp) |
| `test/auth.test.ts` | `tests/integration/auth.test.ts` | integration (app + Postgres) |
| `test/cors.test.ts` | `tests/integration/cors.test.ts` | integration (through createApp) |
| `test/health.test.ts` | `tests/integration/health.test.ts` | integration (through createApp) |
| `test/import-relay.test.ts` | `tests/integration/importRelay.test.ts` | integration (through createApp) |
| `test/origin-verify.test.ts` | `tests/integration/originVerify.test.ts` | integration (through createApp) |
| `test/storage.test.ts` | `tests/integration/storage.test.ts` | integration (real S3) |
| `test/sync.test.ts` | `tests/integration/sync.test.ts` | integration (Postgres + S3) |
| — (new) | `src/modules/auth/index.ts` | barrel: authRoutes + Better Auth service |
| — (new) | `src/modules/health/index.ts` | barrel: healthRoutes |
| — (new) | `src/modules/importRelay/index.ts` | barrel: importRelayRoutes |
| — (new) | `src/modules/sync/index.ts` | barrel: syncRoutes + its public constants/types |

### apps/web, Option A: 126 moves

Paths are relative to `apps/web/`.

| old path | new path | reason |
| --- | --- | --- |
| `src/ui/CardsView.tsx` | `src/ui/cards/cardsView/index.tsx` | cards board |
| `src/ui/BottomTray.tsx` | `src/ui/chrome/bottomTray/index.tsx` | editor frame: bottom tray |
| `src/ui/tray-fit.ts` | `src/ui/chrome/bottomTray/tray-fit.ts` | private to the bottom tray (read by editor/useBottomTray) |
| `src/ui/EditorContextMenu.tsx` | `src/ui/chrome/editorContextMenu/index.tsx` | editor frame: right-click menu |
| `src/ui/Icons.tsx` | `src/ui/chrome/icons/index.tsx` | editor frame: shared icons |
| `src/ui/KeyboardShortcutsDialog.tsx` | `src/ui/chrome/keyboardShortcutsDialog/index.tsx` | opened from the status bar |
| `src/ui/MenuBar.tsx` | `src/ui/chrome/menuBar/index.tsx` | editor frame: menu bar |
| `src/ui/ModeSwitcher.tsx` | `src/ui/chrome/modeSwitcher/index.tsx` | editor frame: layout switcher |
| `src/ui/SelectMenuContent.tsx` | `src/ui/chrome/selectMenuContent/index.tsx` | shared by menu bar and context menu |
| `src/ui/StatusBar.tsx` | `src/ui/chrome/statusBar/index.tsx` | editor frame: status bar |
| `src/ui/save-announcer.ts` | `src/ui/chrome/statusBar/save-announcer.ts` | private to the status bar |
| `src/ui/TableGridPicker.tsx` | `src/ui/chrome/tableGridPicker/index.tsx` | shared by menu bar and toolbar |
| `src/ui/Toolbar.tsx` | `src/ui/chrome/toolbar/index.tsx` | editor frame: toolbar |
| `src/ui/use-roving-focus.ts` | `src/ui/chrome/hooks/use-roving-focus.ts` | hook shared by toolbar and bottom tray |
| `src/ui/Dialogs.tsx` | `src/ui/dialogs/index.tsx` | prompt/confirm/equation dialogs (the dialogs feature's entry module) |
| `src/ui/ConfirmDialog.tsx` | `src/ui/dialogs/confirmDialog/index.tsx` | dialogs |
| `src/ui/DialogProvider.tsx` | `src/ui/dialogs/dialogProvider/index.tsx` | dialogs |
| `src/ui/ConsolePanel.tsx` | `src/ui/diagnostics/consolePanel/index.tsx` | admin diagnostics console |
| `src/ui/DiagnosticsActions.tsx` | `src/ui/diagnostics/diagnosticsActions/index.tsx` | copy/download diagnostics |
| `src/ui/MemorySheet.tsx` | `src/ui/diagnostics/memorySheet/index.tsx` | memory & storage diagnostics sheet |
| `src/ui/FindReplace.tsx` | `src/ui/find/findReplace/index.tsx` | find & replace (lazy chunk) |
| `src/ui/SearchPanel.tsx` | `src/ui/find/searchPanel/index.tsx` | library search |
| `src/ui/search-colors.ts` | `src/ui/find/utils/search-colors.ts` | match colours shared by find and both panes |
| `src/ui/GraphView.tsx` | `src/ui/graph/graphView/index.tsx` | relationship map (lazy chunk) |
| `src/ui/VersionHistorySheet.tsx` | `src/ui/history/versionHistorySheet/index.tsx` | version history |
| `src/ui/ResidualsDialog.tsx` | `src/ui/importExport/residualsDialog/index.tsx` | import-fidelity report |
| `src/ui/UrlImportDialog.tsx` | `src/ui/importExport/urlImportDialog/index.tsx` | import from URL |
| `src/ui/BacklinksPanel.tsx` | `src/ui/links/backlinksPanel/index.tsx` | document links (bottom-tray tab) |
| `src/ui/DurabilityNotices.tsx` | `src/ui/notices/durabilityNotices/index.tsx` | storage durability notices |
| `src/ui/NoticeStrip.tsx` | `src/ui/notices/noticeStrip/index.tsx` | notice strip primitive |
| `src/ui/TabSyncNotice.tsx` | `src/ui/notices/tabSyncNotice/index.tsx` | another-tab notice |
| `src/ui/pages/AboutPage.tsx` | `src/ui/pages/aboutPage/index.tsx` | routed page /about (lazy chunk) |
| `src/ui/pages/about-content.ts` | `src/ui/pages/aboutPage/about-content.ts` | private to the About page |
| `src/ui/pages/HelpPage.tsx` | `src/ui/pages/helpPage/index.tsx` | routed page /help (lazy chunk) |
| `src/ui/pages/help-content.ts` | `src/ui/pages/helpPage/help-content.ts` | private to the Help page |
| `src/ui/pages/LoginPage.tsx` | `src/ui/pages/loginPage/index.tsx` | routed page /login (lazy chunk) |
| `src/ui/pages/PageChrome.tsx` | `src/ui/pages/pageChrome/index.tsx` | shared page frame |
| `src/ui/pages/ProfilePage.tsx` | `src/ui/pages/profilePage/index.tsx` | routed page /profile (lazy chunk) |
| `src/ui/CodeBlockCopyButton.tsx` | `src/ui/panes/codeBlockCopyButton/index.tsx` | rich pane: code block |
| `src/ui/CodeBlockWithCopy.tsx` | `src/ui/panes/codeBlockWithCopy/index.tsx` | rich pane: code block node view |
| `src/ui/code-block-plain-view.ts` | `src/ui/panes/codeBlockWithCopy/code-block-plain-view.ts` | private to the code block node view |
| `src/ui/CodeMirrorPane.tsx` | `src/ui/panes/codeMirrorPane/index.tsx` | markdown pane |
| `src/ui/DiagramPreview.tsx` | `src/ui/panes/diagramPreview/index.tsx` | rich pane: mermaid/ABC preview |
| `src/ui/EditorPanes.tsx` | `src/ui/panes/editorPanes/index.tsx` | split layout of the two panes |
| `src/ui/scroll-anchors.ts` | `src/ui/panes/editorPanes/scroll-anchors.ts` | private to the split layout |
| `src/ui/split-layout.ts` | `src/ui/panes/editorPanes/split-layout.ts` | private to the split layout |
| `src/ui/LinkBubbleMenu.tsx` | `src/ui/panes/linkBubbleMenu/index.tsx` | rich pane: link bubble |
| `src/ui/TableBubbleMenu.tsx` | `src/ui/panes/tableBubbleMenu/index.tsx` | rich pane: table bubble |
| `src/ui/bubble-menu-command.ts` | `src/ui/panes/utils/bubble-menu-command.ts` | shared by both bubble menus |
| `src/ui/TiptapPane.tsx` | `src/ui/panes/tiptapPane/index.tsx` | rich pane |
| `src/ui/EraseLocalData.tsx` | `src/ui/settings/eraseLocalData/index.tsx` | settings |
| `src/ui/LanguageSetting.tsx` | `src/ui/settings/languageSetting/index.tsx` | settings |
| `src/ui/SettingsPrivacy.tsx` | `src/ui/settings/settingsPrivacy/index.tsx` | settings |
| `src/ui/SettingsSheet.tsx` | `src/ui/settings/settingsSheet/index.tsx` | settings |
| `src/ui/SettingsStorage.tsx` | `src/ui/settings/settingsStorage/index.tsx` | settings |
| `src/ui/ThemeControls.tsx` | `src/ui/settings/themeControls/index.tsx` | appearance controls (settings + View menu) |
| `src/ui/LinkBuilder.tsx` | `src/ui/share/linkBuilder/index.tsx` | share/embed link builder |
| `src/ui/LinkBuilderDialog.tsx` | `src/ui/share/linkBuilderDialog/index.tsx` | share/embed dialog |
| `src/ui/AdUnit.tsx` | `src/ui/shared/adUnit/index.tsx` | app-wide (dev builds) |
| `src/ui/ErrorBoundary.tsx` | `src/ui/shared/errorBoundary/index.tsx` | app-wide; exported by the library |
| `src/ui/LazyChunkBoundary.tsx` | `src/ui/shared/lazyChunkBoundary/index.tsx` | app-wide |
| `src/ui/OneEditorPerPage.tsx` | `src/ui/shared/oneEditorPerPage/index.tsx` | app-wide |
| `src/ui/SkipToEditor.tsx` | `src/ui/shared/skipToEditor/index.tsx` | app-wide |
| `src/ui/Toast.tsx` | `src/ui/shared/toast/index.tsx` | app-wide |
| `src/ui/asset-dom.ts` | `src/ui/shared/utils/asset-dom.ts` | shared by the cards board and the ThemeImage extension |
| `src/ui/overlay-escape.ts` | `src/ui/shared/utils/overlay-escape.ts` | shared by the cards board and the map overlay |
| `src/ui/use-divider-drag.ts` | `src/ui/shared/hooks/use-divider-drag.ts` | shared by the split layout and the workspace panel |
| `src/ui/Walkthrough.tsx` | `src/ui/tour/walkthrough/index.tsx` | first-run tour (lazy chunk) |
| `src/ui/DocNavPanel.tsx` | `src/ui/workspace/docNavPanel/index.tsx` | outline list primitives |
| `src/ui/FolderTree.tsx` | `src/ui/workspace/folderTree/index.tsx` | library tree |
| `src/ui/folder-dnd.ts` | `src/ui/workspace/folderTree/folder-dnd.ts` | private to the library tree |
| `src/ui/WorkspacePanel.tsx` | `src/ui/workspace/workspacePanel/index.tsx` | workspace panel (lazy chunk) |
| `src/ui/relative-time.ts` | `src/ui/workspace/utils/relative-time.ts` | shared by the tree and the panel |
| `src/ui/use-windowed-list.ts` | `src/ui/workspace/hooks/use-windowed-list.ts` | shared by the tree and the panel |
| `src/store/asset-gc.ts` | `src/store/assets/asset-gc.ts` | image store |
| `src/store/asset-refs.ts` | `src/store/assets/asset-refs.ts` | image store |
| `src/store/asset-store.ts` | `src/store/assets/asset-store.ts` | image store |
| `src/store/assets.ts` | `src/store/assets/assets.ts` | image store |
| `src/store/card-save.ts` | `src/store/cards/card-save.ts` | cards board |
| `src/store/cards.ts` | `src/store/cards/cards.ts` | cards board |
| `src/store/console-commands.ts` | `src/store/diagnostics/console-commands.ts` | diagnostics console registry |
| `src/store/canonical-json.ts` | `src/store/documents/canonical-json.ts` | document model |
| `src/store/canonical-ops.ts` | `src/store/documents/canonical-ops.ts` | document model |
| `src/store/canonical-sanitize.ts` | `src/store/documents/canonical-sanitize.ts` | document model |
| `src/store/doc-outline.ts` | `src/store/documents/doc-outline.ts` | document model (headings) |
| `src/store/doc-text.ts` | `src/store/documents/doc-text.ts` | document model (text) |
| `src/store/document.ts` | `src/store/documents/document.ts` | document model |
| `src/store/documentStore.ts` | `src/store/documents/documentStore.ts` | document store |
| `src/store/editorStore.ts` | `src/store/editor/editorStore.ts` | active-editor state (formats, link index) |
| `src/store/fidelity.ts` | `src/store/documents/fidelity.ts` | document model (round-trip fidelity) |
| `src/store/folders.ts` | `src/store/documents/folders.ts` | library folders |
| `src/store/schema-version.ts` | `src/store/documents/schema-version.ts` | document model (schema lock) |
| `src/store/graph-draw.ts` | `src/store/graph/graph-draw.ts` | relationship map |
| `src/store/graph-metrics.ts` | `src/store/graph/graph-metrics.ts` | relationship map |
| `src/store/graph-physics.ts` | `src/store/graph/graph-physics.ts` | relationship map |
| `src/store/account-versions.ts` | `src/store/history/account-versions.ts` | version history (account) |
| `src/store/history-cache.ts` | `src/store/history/history-cache.ts` | version history |
| `src/store/snapshot-store.ts` | `src/store/history/snapshot-store.ts` | version history |
| `src/store/archive.ts` | `src/store/importExport/archive.ts` | import/export |
| `src/store/docx-export.ts` | `src/store/importExport/docx-export.ts` | import/export (lazy chunk) |
| `src/store/docx-import.ts` | `src/store/importExport/docx-import.ts` | import/export (lazy chunk) |
| `src/store/headless-ingest.ts` | `src/store/importExport/headless-ingest.ts` | import/export |
| `src/store/import-export.ts` | `src/store/importExport/import-export.ts` | import/export |
| `src/store/import-url-normalize.ts` | `src/store/importExport/import-url-normalize.ts` | import/export |
| `src/store/ingest.ts` | `src/store/importExport/ingest.ts` | import/export (HTML ingest) |
| `src/store/print-export.ts` | `src/store/importExport/print-export.ts` | import/export |
| `src/store/share-link.ts` | `src/store/importExport/share-link.ts` | share links |
| `src/store/url-import.ts` | `src/store/importExport/url-import.ts` | import/export |
| `src/store/zip-builder.ts` | `src/store/importExport/zip-builder.ts` | import/export |
| `src/store/heading-renames.ts` | `src/store/links/heading-renames.ts` | wiki links |
| `src/store/link-index.ts` | `src/store/links/link-index.ts` | wiki links |
| `src/store/crash-recovery.ts` | `src/store/persistence/crash-recovery.ts` | storage layer |
| `src/store/idb-storage-adapter.ts` | `src/store/persistence/idb-storage-adapter.ts` | storage layer |
| `src/store/storage-adapter.ts` | `src/store/persistence/storage-adapter.ts` | storage layer |
| `src/store/storage-durability.ts` | `src/store/persistence/storage-durability.ts` | storage layer |
| `src/store/tab-sync.ts` | `src/store/persistence/tab-sync.ts` | storage layer (cross-tab) |
| `src/store/settings.ts` | `src/store/preferences/settings.ts` | markdown feature flags |
| `src/store/uiStore.ts` | `src/store/preferences/uiStore.ts` | persisted interface preferences |
| `src/store/search.ts` | `src/store/search/search.ts` | library search |
| `src/app/account.ts` | `src/app/account/account.ts` | account state (sign-in) |
| `src/app/AccountAvatar.tsx` | `src/app/account/accountAvatar/index.tsx` | account UI |
| `src/app/AccountBackups.tsx` | `src/app/account/accountBackups/index.tsx` | account UI |
| `src/app/AccountCheckScreen.tsx` | `src/app/account/accountCheckScreen/index.tsx` | account UI |
| `src/app/AccountMenu.tsx` | `src/app/account/accountMenu/index.tsx` | account UI |
| `src/app/CloudStatusLine.tsx` | `src/app/account/cloudStatusLine/index.tsx` | account UI |
| `src/app/PlansSection.tsx` | `src/app/account/plansSection/index.tsx` | account UI |

## 9. Edits other than moves

**Allowed by the brief:**

- **Import specifiers**, including `vi.mock` and `import()`:
  - web: 1,066 in 346 files, of which 459 are in 201 test files;
  - API: up to 47;
  - 4 `import()` paths in `apps/web/src/__tests__/cloud-contract.test.js`, which loads the API to test sync from both sides.
- **Test-runner globs:** the API `vitest.config.ts` include changes from `test/**/*.test.ts` to `src/**/*.test.ts` plus `tests/**/*.test.ts`, and the API `tsconfig.json` include changes from `test` to `tests`, so the moved tests are still type-checked.
- **New files:** the 4 API module barrels.

**Not on the brief's allowed list, but needed to keep the suite green or the docs accurate.** These need your OK (D3, D6):

- **Path strings in tests:** 77 of them in 43 web test files. Examples are `read("src/ui/MenuBar.tsx")`, the i18n scanner's `ALLOWLIST` entry for `ConsolePanel.tsx`, `converter-escape`'s `LAZY_ALLOWED`, and `g4-privacy`'s file list. Only the strings change; no test logic and no scan scope changes.
- **Docs:**
  - 104 `#L` anchors point at moved files. `doc-anchors.test.js` fails unless they are updated. Their line numbers stay valid, because only import lines change.
  - About 910 more path references in 28 living docs: both `CLAUDE.md` files, `HANDOVER.md`, `ONBOARDING.md`, `PRODUCT.md`, `docs/*.md` including `backlog.md`, the READMEs and `SECURITY.md`.
  - 144 bare component file names, such as `MenuBar.tsx` becoming `menuBar/index.tsx`.
  - History stays as written: `CHANGELOG.md` and `docs/v1-to-current-changelog.md`.
- **Code comments that name moved paths:** 35 in 29 files, for example in `apps/web/src/app/cloud/*` and `packages/db/src/schema/*`. I would skip `apps/web/src/i18n/en/account.ts`, which has your uncommitted changes.

**Not touched:** dependencies, `bun.lock`, lint and format config, the `package.json` files, `vercel.json`, CI workflows, migrations, env files, and the route and endpoint definitions.

## 10. How Phase 3 would run

Everything happens in the worktree. Every move uses `git mv`, each commit covers one area, and nothing is pushed:

1. `docs: add the folder-restructure plan`
2. `refactor(api): module layout`: moves, barrels and import rewrites. Check: API typecheck, lint and tests, plus the endpoint diff.
3. `refactor(api): co-locate unit tests; integration tests and fixtures under tests/`, including the vitest and tsconfig globs. Check: the API tests have the same 84 names.
4. `refactor(web): group store/ by feature`. Check: web typecheck, lint, and the tests that import the moved modules.
5. `refactor(web): group ui/ by feature`, probably split into two commits (panes and chrome first, then the rest).
6. `refactor(web): group the app's account surface`
7. `docs: point paths at the new locations`. Check: `doc-anchors.test.js`.

A script driven by the move map rewrites the imports, not hand edits. It uses the same resolution rules as the import graph behind the counts above. If a step can only go green by changing logic, I revert that step and record it.

## 11. How Phase 4 checks it

- **Gates:** lint, typecheck and build as in §3, and the full test suite once.
- **Tests, by name and not just count:** the full names of all 4,574 tests must be identical before and after. The same 3 failures must remain and nothing new may fail. If any of the 5 load-sensitive tests fail, I re-run them alone.
- **Routes and endpoints:** run the two capture scripts again and diff against §4.
- **Build output:** compare `dist-app/`, `dist-embed/`, `dist/` and the API bundles with the baseline, after normalising chunk file names and the API bundler's `//#region <path>` comments.
  - Expected and acceptable differences: the names of lazily loaded chunks (likely `GraphView-<hash>.js` becomes `index-<hash>.js`, because of R1), the PWA precache list that names them, declaration-file paths inside `dist/` (which the package's `exports` map doesn't expose), and hidden source maps.
  - Any other byte difference gets investigated.
- **Import cycles (madge):** the API stays at zero, and the web app keeps exactly the 5 known cycles under their new paths.
- **Test scan scopes:** for `a11y-accent-text`, the i18n scanner and the other tests that scan source, the set of files each scans after the move must equal the set before, mapped through the move map.

## 12. Risks

- **Your uncommitted work:** commit it before this branch is merged. `ui/pages/LoginPage.tsx` moves to `ui/pages/loginPage/index.tsx`, and `App.tsx` gets new import lines. Git's rename detection carries content edits across a rename, but expect a small, easy conflict in `App.tsx`'s imports.
- **Other open branches** (`audit/production-readiness-fixes`, `monorepo-backend`, `neon-database`, `vercel-services`, `vercel-site-origin` and the Dependabot branches): the same applies. Rename detection handles moved files, and anything that edits a moved file's imports conflicts once.
- **Chunk names:** under R1, lazily loaded chunks will likely be named `index-<hash>.js`, so a "failed to fetch chunk" report is less self-explanatory. This is cosmetic; behaviour doesn't change.
- **Tests that forbid words in source text:** for example, `sync-perf` forbids `document|editor` anywhere in `hooks/sync-schedule.ts`. If a new folder name ends up inside an import path of a file such a test reads, the test could fail. The fix would be a different folder name, never a test edit.

## 13. Suspected dead code (not deleted)

Found from the import graph; Phase 4 will confirm with a symbol-level pass:

- `apps/web/src/app/AccountBackups.tsx`: only a test imports it.
- `apps/web/src/components/ui/select.tsx`, `sidebar.tsx`, `toggle-group.tsx`: shadcn primitives that nothing imports.
- The `ConfirmDialog` export of `apps/web/src/ui/Dialogs.tsx`: nothing imports it. The `ConfirmDialog` the app renders comes from `useConfirm()` in `ui/ConfirmDialog.tsx`.
- `apps/web/src/ui/DocNavPanel.tsx`: its component was removed, and the module now only holds `TocList` and `EmptyOutline`. The web `CLAUDE.md` documents this as intentional.

## 14. Decisions for you

Defaults are in bold.

| # | Decision | Default |
|---|---|---|
| D1 | Web layout | **Option A** (§6). B is in §7. |
| D2 | Naming | **R1 to R3 as in §6.** The strict reading would make every hook, util and store file its own `<name>/index.ts` folder with barrels: about 60 more folders, and the byte-identical build check would no longer be possible. |
| D3 | Docs | **Update** the 104 test-gated anchors (required) and the path references in living docs; leave changelogs as written. |
| D4 | Web e2e | **Stays in `apps/web/e2e/`.** Moving it needs the edits listed in §5. |
| D5 | Web unit tests | **Stay in `src/__tests__/`.** The alternative moves them all to `apps/web/tests/unit/`, which needs a one-line glob change in `eslint.config.js` (lint config is on your do-not-touch list) plus vitest and CI path updates. |
| D6 | Code comments that name moved paths | **Update them**, except in files with your uncommitted changes |
| D7 | API module barrels | **Yes** (4 files) |
| D8 | Commit this plan as the branch's first commit | **Yes**. The copy in your checkout's `docs/` can be deleted afterwards. |

Reply "approved" to run Phase 3 with these defaults, or name the decisions you want changed.

---

## 15. Results (Phases 3 and 4)

Executed with the defaults in §14 (Option A, naming rules R1 to R3, docs and comments updated, web e2e and web unit tests left in place, API barrels). Nothing was pushed, and no PR was opened.

### Branch and commits

`refactor/folder-structure` is a local branch on top of `22d8aff`, checked out in `.claude/worktrees/refactor-folder-structure`:

| Commit | Area | Renames | Checked before committing |
|---|---|---:|---|
| `5dbd5b6` | docs: add the folder-restructure plan | — | — |
| `71e2654` | refactor(api): module layout (modules/, middlewares/, lib/, utils/) | 11 (+4 barrels) | typecheck, lint, 84 API tests, endpoint table, bundle comparison |
| `cc15032` | refactor(api): unit tests beside their code, integration tests under tests/ | 10 | typecheck (all 9 test files still in the program), lint, the same 84 tests by name, bundle comparison |
| `2558b12` | refactor(web): group store/ by feature | 45 | typecheck, lint, 169 affected test files, scan scopes, madge |
| `97f58c9` | refactor(web): group ui/ by feature — editor frame and panes | 25 | typecheck, lint, 46 affected test files, scan scopes |
| `7bf4d37` | refactor(web): group the rest of ui/ by feature | 49 | typecheck, lint, 48 affected test files, scan scopes |
| `5f9040e` | refactor(web): group the standalone app's account surface | 7 | typecheck (web, infra), lint, affected tests, scan scopes |
| *(this commit)* | docs: record the restructure results | — | — |

Overall: 147 files moved, every one of them a git rename (similarity 66–100%, so `git log --follow` works); 4 barrels added; nothing deleted. Leaving out this document, the branch changes 471 files by +1,903 / −1,889 lines: import specifiers, path strings and doc paths, plus the barrels and the API README's layout tree.

### Checks, before and after

| Check | Before (`22d8aff`) | After (branch) |
|---|---|---|
| `bun install --frozen-lockfile` | ✅ | ✅ (`bun.lock` untouched) |
| Lint (`turbo run lint`, forced) | ✅ 0 errors, 112 warnings | ✅ 0 errors, the same 112 warnings |
| Typecheck (`turbo run typecheck`, forced) | ✅ 4/4 | ✅ 4/4 |
| Build (`turbo run build build:app build:embed`, forced) | ✅ 6/6 | ✅ 6/6 (incl. the API bundle smoke test) |
| Tests: files / tests | 293 / 4,574 | **293 / 4,574** |
| Tests: passed / failed (full run) | 4,566 / 8 | 4,568 / 6 |
| Tests failing when re-run alone | 3 | **the same 3** |

| Package | Files | Tests | Before: passed / failed | After: passed / failed |
|---|---:|---:|---:|---:|
| apps/web | 276 | 4,438 | 4,430 / 8 | 4,432 / 6 |
| apps/api | 9 | 84 | 84 / 0 | 84 / 0 |
| packages/db | 2 | 13 | 13 / 0 | 13 / 0 |
| infra | 6 | 39 | 39 / 0 | 39 / 0 |

**Every test has the same full name before and after.** I compared all 4,574 test names, file by file, mapping the 10 moved API test files and the titles that contain a moved path. API, db and infra are identical by name and status. In the web app, the only status differences are load timeouts:

- **Fail in both runs, and when run alone:** these exist on `main` today:
  - `a11y-keyboard-order` › puts the skip link first in the app shell;
  - `g4-privacy` › the `src/i18n/en/account.ts` claim;
  - `g4-privacy` › Settings ▸ Privacy ▸ Import relay ("Not decided yet").
- **Time out only under the full suite's load, and pass when run alone:**
  - At baseline: `code-block-plain-view` (mermaid), `i18n-render` (pseudo-locale), `pkg-cjs-require` ×2 and `scroll-anchors`.
  - In the final run: `converter-escape` (the lookbehind scan took 5.98 s against a 5 s budget) and `pkg-cjs-require` ×2.
  - Seen the same way in the per-area runs: `cloud-contract` (the presigned image upload, and the deletion case that depends on it), `editor-modules` (`collectImportItems`), `persistence-local-data` ×2, and another `code-block-plain-view` case.

### Route and endpoint parity: confirmed

- **Web routes are identical.** This covers:
  - `routeToPath` for all six routes, and `pathToRoute` for 16 probe paths (edge cases included), run through the real `src/app/router.tsx`;
  - `App.tsx`'s route → page mapping;
  - the HTML entries (`/src/main.tsx`, `/src/embed.tsx`).

  The only difference is the module paths of the lazy routes, for example `./ui/pages/AboutPage` became `./ui/pages/aboutPage`. Each still loads the same exported component.
- **API endpoints are identical.** Hono's own route table from the real `createApp()` matches line for line, including middleware order: 20 registrations without the CloudFront origin secret, 21 with it.

### Build output parity

The baseline and branch builds were compared file by file. Hashed chunk names, the API bundler's `//#region <path>` comments and `sourceMappingURL` lines were normalised first.

| Output | Result |
|---|---|
| `dist-embed/` (iframe embed) | 239 of 239 files content-identical; 5 chunks renamed |
| `dist-app/` (the app) | 257 of 258 identical; 15 chunks renamed. `sw.js` has the same code and the same 217 precache entries; the only difference is the revision hash of `index.html`, whose raw bytes differ only by the renamed chunk names |
| `dist/` (npm library) | every JavaScript file identical. The 75 declaration files that differ are identical once module specifiers and comments are set aside. The four `exports`-map declaration entries are present, and `pkg-declarations` (which compiles a consumer against `dist/`) passes |
| API bundles (server, Vercel, Lambda) | identical apart from one JSDoc comment that names a moved web path (`store/importExport/url-import.ts`); one shared Lambda chunk renamed `aws-secrets-*` → `awsSecrets-*` |

**Lazy chunk names:** Rolldown names an `index.tsx` chunk after its folder, so `GraphView-<hash>.js` became `graphView-<hash>.js`, not `index-<hash>.js` as §11 and §12 expected. Many hashes didn't change at all, because the content is identical.

**Import cycles (madge):** the API has none, with the barrels and moved tests included. The web app has the same 5 pre-existing cycles under their new paths, and no new ones.

**What the source-scanning tests see** is unchanged, by file set: `a11y-accent-text` 58 files, the i18n scanner 143, the whole-`src` walkers 292, and the i18n catalog check 273.

### Before / after trees (depth 3)

Folders show their file count; deeper folders are folded into it.

<details><summary>apps/api — before</summary>

```
apps/api/
  scripts/  (2)
    migrate-on-vercel.mjs
    smoke-bundle.mjs
  src/  (17)
    config/  (1)
      env.ts
    lib/  (4)
      auth.ts
      aws-secrets.ts
      storage.ts
      vercel-handler.ts
    middleware/  (2)
      cors.ts
      origin-verify.ts
    routes/  (4)
      auth.ts
      health.ts
      import-relay.ts
      sync.ts
    app.ts
    bootstrap.ts
    lambda.ts
    migrate-lambda.ts
    server.ts
    vercel.ts
  test/  (10)
    auth.test.ts
    cors.test.ts
    env.test.ts
    health.test.ts
    helpers.ts
    import-relay.test.ts
    lambda.test.ts
    origin-verify.test.ts
    storage.test.ts
    sync.test.ts
  .env.example
  README.md
  eslint.config.js
  package.json
  rolldown.config.ts
  tsconfig.json
  vitest.config.ts
```

</details>

<details><summary>apps/api — after</summary>

```
apps/api/
  scripts/  (2)
    migrate-on-vercel.mjs
    smoke-bundle.mjs
  src/  (23)
    config/  (2)
      env/  (2)
    lib/  (2)
      awsSecrets/  (1)
      storage/  (1)
    middlewares/  (2)
      cors/  (1)
      originVerify/  (1)
    modules/  (9)
      auth/  (3)
      health/  (2)
      importRelay/  (2)
      sync/  (2)
    utils/  (1)
      vercelHandler/  (1)
    app.ts
    bootstrap.ts
    lambda.test.ts
    lambda.ts
    migrate-lambda.ts
    server.ts
    vercel.ts
  tests/  (8)
    fixtures/  (1)
      index.ts
    integration/  (7)
      auth.test.ts
      cors.test.ts
      health.test.ts
      importRelay.test.ts
      originVerify.test.ts
      storage.test.ts
      sync.test.ts
  .env.example
  README.md
  eslint.config.js
  package.json
  rolldown.config.ts
  tsconfig.json
  vitest.config.ts
```

</details>

<details><summary>apps/web — before (src/__tests__ unchanged, folded)</summary>

```
apps/web/
  api/  (1)
    import.js
  build/  (5)
    externals.d.mts
    externals.mjs
    finish-declarations.mjs
    scope-css.d.mts
    scope-css.mjs
  docs/  (35)
    runbooks/  (10)
    README.md
    architecture.md
    audit-2026-09.md
    auth.md
    backlog.md
    codebase-tour.md
    contributing.md
    data-contracts.md
    data-pipeline.md
    database.md
    decisions.md
    deployment-todo.md
    deployment.md
    domain-glossary.md
    extended-features.md
    features.md
    gotchas.md
    i18n.md
    import-relay.md
    integration-guide.md
    integration-threejs.md
    local-development.md
    v1-to-current-changelog.md
    why-markdown-studio.md
    workflows.md
  e2e/  (60)
    cases/  (14)
    fixtures/  (2)
    probes/  (37)
    README.md
    docs.mjs
    lib.mjs
    map-library.mjs
    map-measure.mjs
    renderers.mjs
    run.mjs
  marketing/  (8)
    00-README.md
    01-short-descriptions.md
    02-long-description.md
    03-feature-list.md
    04-audiences.md
    05-social-and-launch.md
    06-faq.md
    07-messaging-guide.md
  public/  (17)
    .well-known/  (1)
    brand/  (8)
    apple-touch-icon.png
    favicon-96x96.png
    favicon.ico
    site.webmanifest
    sw-recover.js
    third-party-licenses.txt
    web-app-manifest-192x192.png
    web-app-manifest-512x512.png
  scripts/  (4)
    doc-anchors.mjs
    live-preview-walkthrough.mjs
    strip-sourcemaps.mjs
    third-party-licenses.mjs
  src/  (576)
    __tests__/  (283)
      fixtures/  (1)
    app/  (15)
      cloud/  (7)
    components/  (20)
      ui/  (20)
    data/  (3)
    editor/  (17)
    engine/  (17)
    extensions/  (23)
    formatting/  (9)
    hooks/  (8)
    i18n/  (26)
      en/  (19)
    integration/  (7)
    lib/  (1)
    pwa/  (1)
    store/  (46)
    theme/  (3)
    types/  (2)
    ui/  (74)
      pages/  (7)
    utils/  (13)
    App.tsx
    EditorHeader.tsx
    PerssonifyEditor.tsx
    constants.ts
    embed.tsx
    index.tsx
    main.tsx
    styles.css
  .gitignore
  CHANGELOG.md
  CLAUDE.md
  HANDOVER.md
  LICENSE
  ONBOARDING.md
  PRODUCT.md
  README.md
  components.json
  embed.html
  eslint.config.js
  index.html
  package.json
  tsconfig.build.json
  tsconfig.json
  vite.app.config.ts
  vite.chunks.ts
  vite.config.ts
  vite.embed.config.ts
  vitest.config.js
```

</details>

<details><summary>apps/web — after</summary>

```
apps/web/
  api/  (1)
    import.js
  build/  (5)
    externals.d.mts
    externals.mjs
    finish-declarations.mjs
    scope-css.d.mts
    scope-css.mjs
  docs/  (35)
    runbooks/  (10)
    README.md
    architecture.md
    audit-2026-09.md
    auth.md
    backlog.md
    codebase-tour.md
    contributing.md
    data-contracts.md
    data-pipeline.md
    database.md
    decisions.md
    deployment-todo.md
    deployment.md
    domain-glossary.md
    extended-features.md
    features.md
    gotchas.md
    i18n.md
    import-relay.md
    integration-guide.md
    integration-threejs.md
    local-development.md
    v1-to-current-changelog.md
    why-markdown-studio.md
    workflows.md
  e2e/  (60)
    cases/  (14)
    fixtures/  (2)
    probes/  (37)
    README.md
    docs.mjs
    lib.mjs
    map-library.mjs
    map-measure.mjs
    renderers.mjs
    run.mjs
  marketing/  (8)
    00-README.md
    01-short-descriptions.md
    02-long-description.md
    03-feature-list.md
    04-audiences.md
    05-social-and-launch.md
    06-faq.md
    07-messaging-guide.md
  public/  (17)
    .well-known/  (1)
    brand/  (8)
    apple-touch-icon.png
    favicon-96x96.png
    favicon.ico
    site.webmanifest
    sw-recover.js
    third-party-licenses.txt
    web-app-manifest-192x192.png
    web-app-manifest-512x512.png
  scripts/  (4)
    doc-anchors.mjs
    live-preview-walkthrough.mjs
    strip-sourcemaps.mjs
    third-party-licenses.mjs
  src/  (576)
    __tests__/  (283)
      fixtures/  (1)
    app/  (15)
      account/  (7)
      cloud/  (7)
    components/  (20)
      ui/  (20)
    data/  (3)
    editor/  (17)
    engine/  (17)
    extensions/  (23)
    formatting/  (9)
    hooks/  (8)
    i18n/  (26)
      en/  (19)
    integration/  (7)
    lib/  (1)
    pwa/  (1)
    store/  (46)
      assets/  (4)
      cards/  (2)
      diagnostics/  (1)
      documents/  (10)
      editor/  (1)
      graph/  (3)
      history/  (3)
      importExport/  (11)
      links/  (2)
      persistence/  (5)
      preferences/  (2)
      search/  (1)
    theme/  (3)
    types/  (2)
    ui/  (74)
      cards/  (1)
      chrome/  (13)
      diagnostics/  (3)
      dialogs/  (3)
      find/  (3)
      graph/  (1)
      history/  (1)
      importExport/  (2)
      links/  (1)
      notices/  (3)
      pages/  (7)
      panes/  (12)
      settings/  (6)
      share/  (2)
      shared/  (9)
      tour/  (1)
      workspace/  (6)
    utils/  (13)
    App.tsx
    EditorHeader.tsx
    PerssonifyEditor.tsx
    constants.ts
    embed.tsx
    index.tsx
    main.tsx
    styles.css
  .gitignore
  CHANGELOG.md
  CLAUDE.md
  HANDOVER.md
  LICENSE
  ONBOARDING.md
  PRODUCT.md
  README.md
  components.json
  embed.html
  eslint.config.js
  index.html
  package.json
  tsconfig.build.json
  tsconfig.json
  vite.app.config.ts
  vite.chunks.ts
  vite.config.ts
  vite.embed.config.ts
  vitest.config.js
```

</details>

### Moves skipped, and why

| Not moved | Why |
|---|---|
| Web unit tests (`apps/web/src/__tests__/`, 283 files) | Co-locating them would need test-logic or lint-config edits (§5). Moving them to `apps/web/tests/` needs a glob change in `eslint.config.js` (decision D5). |
| Web e2e (`apps/web/e2e/`) | Root paths computed at runtime, CI regexes, the doc-anchor checker, 14 `package.json` scripts and CI steps (decision D4) |
| API `params/` and `repositories/` | The request schemas and queries sit inside `modules/sync/routes/index.ts`; splitting the file changes its content |
| `docker-compose.yml` → `infra/` | `bun run db:up` runs a bare `docker compose up` from the root; moving it needs a `-f` flag in `package.json`. `infra/` (the CDK app) is already grouped. |
| `packages/db` | Not part of the web app or the API; holds the migrations |
| Fixed paths (§5): Vite HTML entries, the four package entry points, `api/import.js`, shadcn output (`components/ui`, `lib/utils.ts`, `hooks/use-mobile.ts`), `styles.css`, `i18n/`, the API's runtime entries | Tooling, deployment or the published package names them |
| Other web layers (`editor/`, `engine/`, `extensions/`, `formatting/`, `hooks/`, `utils/`, `data/`, `theme/`, `integration/`, `pwa/`) | Out of Option A's scope (§6). They are not flat enough to need it, and some hold the package's entry points. |

No step needed a logic change, so no step was reverted. Where the tooling was adjusted to keep moves path-only:

- **Bare file names in code** (`"EditorPanes.tsx"`) were changed only inside comments. In `divider-drag.test.jsx` they build test titles, and renaming a test is not a move.
- **`graph-legacy.js`** kept its comments: the project marks it frozen, and its comments describe the old code.
- **Your three uncommitted files** (`App.tsx`, `ui/pages/LoginPage.tsx`, `i18n/en/account.ts`) received import-path changes only, with no comment edits, to keep merge conflicts small.
- **History stays as written:** `CHANGELOG.md`, `docs/v1-to-current-changelog.md`, `docs/audit-2026-09.md` and this plan's §1–§14.

### Suspected dead code (not deleted)

Found by knip 6.41 (run through `npx`, not installed, without a project config) and the import graph, with each item checked by grep. Two caveats: knip doesn't see `embed.html`'s entry, so `embed.tsx` and `integration/embed-origins.ts` are false positives; and in production mode it lists every script, e2e and build file, which run from `package.json` and CI.

- **Files nothing imports:**
  - `src/components/ui/select.tsx`, `sidebar.tsx` and `toggle-group.tsx` (shadcn);
  - `skeleton.tsx` and `toggle.tsx`, which only those use;
  - `src/app/account/accountBackups/index.tsx`, which only a test imports. `backUpNow` in `app/cloud/index.ts` exists only for it.
- **Exports nothing imports, tests included** (some are used inside their own file):
  - **UI:** `ConfirmDialog` in `ui/dialogs/index.tsx` (the app renders the one from `useConfirm()` in `ui/dialogs/confirmDialog/`); `useNewDocPrompt` (`confirmDialog/`); `CrashActions` (`shared/errorBoundary/`); `EmptyOutline` (`workspace/docNavPanel/`); `formatStorageBytes` (`settings/settingsStorage/`); `folderRowKey` and `docRowKey` (`workspace/folderTree/`).
  - **Store:** `encodeSharePayload`, `decodeSharePayload` and `SHARE_HASH_KEY` (`store/importExport/share-link.ts`); `exportMarkdown` (`store/importExport/import-export.ts`); `openTransport` (`store/persistence/tab-sync.ts`).
  - **App, utils, engine, i18n:** `libraryOwner` (`app/cloud/index.ts`); `clearDiagnostics` (`utils/diagnostics.ts`); `parseColwidth`, `styleAttrValue` and three `css-safety` exports (`engine/`); and the i18n helpers `translateRich`, `localeAttributes`, `matchLocale`, `resolveInitialLocale` and `DEFAULT_LOCALE`, which are re-exported but never imported.
- About 30 exported constants are used only inside their own file, so the `export` is unnecessary.
- **Kept on purpose, not dead:** the deprecated extension exports (`BlockId`, `FieldBlock`, `TransclusionBlock` and their helpers) are public API that warns when used (web `CLAUDE.md`, A105).

### Open decisions for you

1. **Merging.**
   - Pushing and opening a PR are yours to do; the brief ruled them out for me.
   - Before merging, commit your work in progress on `main` (`App.tsx`, `i18n/en/account.ts`, `ui/pages/LoginPage.tsx`). `LoginPage.tsx` now lives at `ui/pages/loginPage/index.tsx`; git's rename detection carries your edits across, and `App.tsx` will likely have a small conflict in its import block.
   - Delete the untracked copy of this file in your checkout's `docs/`, or git will refuse to overwrite it with the committed one.
2. **Open branches:** `audit/production-readiness-fixes`, `monorepo-backend`, `neon-database`, `vercel-services`, `vercel-site-origin` and the Dependabot branches each conflict once on any import of a moved file.
3. **Option B** (features-first, §7) is still possible on top of this.
4. **Doc style:** bare component names in the docs became `menuBar/index.tsx`. If you'd prefer full paths (`ui/chrome/menuBar/index.tsx`), that's a mechanical follow-up.
5. **My suggestions (not from the brief):**
   - split `modules/sync/routes/index.ts` into `params/` and `repositories/`;
   - remove the dead code above;
   - fix the 3 tests that fail on `main`;
   - give the load-sensitive tests realistic time budgets: 11 cases failed only under load across these runs (timeouts or time budgets).
