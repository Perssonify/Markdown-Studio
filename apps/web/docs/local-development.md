# Local Development — Getting Productive

> Goal: from `git clone` to shipping a change, fast. For *what* the code does see [features.md](features.md); for *where things are* see [codebase-tour.md](codebase-tour.md).

## Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| [Bun](https://bun.sh) | 1.4.0 | Canonical package manager + runner, pinned by `packageManager` in [`package.json`](../package.json). [`bun.lock`](../bun.lock) is the committed lockfile; the verify gate and [`vercel.json`](../vercel.json) install with `bun install --frozen-lockfile`, so a dependency change that does not update `bun.lock` fails the build. |
| Node.js | `^22.22.2`, `^24.15.0` or `>=26` — 24 is the one to use ([`.node-version`](../../../.node-version)) | The `engines` range in `package.json`: the Nodes EVERY direct dependency accepts (the narrowest are jsdom 30's `^22.22.2 \|\| ^24.15.0 \|\| >=26` and Vitest 5's, which skips 23 and 25; `ops-node-range.test.js` recomputes it from `node_modules`). The build scripts (`scripts/*.mjs`, `build/*.mjs`, `e2e/`) and the import relay run on it. |
| A browser at or above the floor | Safari/iOS 16.4, Chrome/Edge 111, Firefox 128 (A097) | The app relies on IndexedDB + DOMParser + (optionally) the RegExp `d`/`hasIndices` flag for find-and-replace capture coloring. The e2e campaign drives Chromium from `playwright-core` (`bunx playwright-core install chromium`), and the cross-engine suites Firefox and WebKit too (`install firefox webkit`, then `E2E_BROWSER=firefox` or `webkit`). |

> `npm install` also works (peer/dev deps are standard), but only Bun reads `bun.lock`, which is what the verify gate and the deploy install from.

## First run

```bash
bun install
bun run dev
```

Then open `http://localhost:5173`.

## Environment variables

**One, optional, build-time — and no secrets.** This is a client-only app; its one server function, the import relay ([`api/import.js`](../api/import.js)), reads no configuration. There is no `.env` and no `.env.example`. The old `MARKDOWNEDITOR_PASSWORD` belonged to the removed auth middleware and **does not exist** — see [auth.md](auth.md).

| Variable | Read by | Effect |
|----------|---------|--------|
| `VITE_EMBED_ALLOWED_ORIGINS` | the iframe embed build only (`bun run build:embed`, read in [src/embed.tsx](../src/embed.tsx)) | Comma-separated host origins baked into `dist-embed/`. When set, the embed's host bridge talks to no other origin, whatever the URL or the referrer says ([src/integration/embed-origins.ts](../src/integration/embed-origins.ts)). Unset, the embed trusts the page that frames it. |

Everything else is decided by the build itself: `import.meta.env.DEV` ([src/utils/build-gates.ts](../src/utils/build-gates.ts)) is true only under `bun run dev` (and vitest), and gates the placeholder ad slots and the Settings ▸ Admin section.

"Configuration" that does exist lives in code/storage, not env:

| What | Where | Notes |
|------|-------|-------|
| Sync idle delay | `SYNC_MIN_DELAY_MS`…`SYNC_MAX_DELAY_MS` = 120…800 ([src/constants.ts](../src/constants.ts)) | derived from measured projection cost, not doc size |
| Sync max-wait ceiling | `SYNC_MIN_MAX_WAIT_MS`…`SYNC_MAX_MAX_WAIT_MS` = 250…1200 ([src/constants.ts](../src/constants.ts)) | how far the other pane may lag while you keep typing |
| Autosave interval | `AUTOSAVE_MS` = 5000 ([src/constants.ts:80](../src/constants.ts#L80)) | |
| Toolbar compact breakpoint | `TOOLBAR_COMPACT_BP = 1080` ([src/constants.ts](../src/constants.ts)) | |
| IndexedDB name / limit | `perssonify-docs` (`DEFAULT_DB_NAME`, [src/store/persistence/idb-storage-adapter.ts:159](../src/store/persistence/idb-storage-adapter.ts#L159)) | no cap of its own — the browser's quota, unless a host passes `storageConfig.maxBytes`; see [database.md](database.md) |
| Theme storage key | `perssonify-theme` (next-themes `storageKey`, [src/main.tsx:68](../src/main.tsx#L68)) | localStorage |
| Admin settings in a production build | `localStorage["pf:admin"] = "1"` | a per-browser opt-in that shows Settings ▸ Admin (console, context-menu switch); dev builds always show it |

## Running the app in each mode

| Mode | Command | Output |
|------|---------|--------|
| Dev server (HMR) | `bun run dev` | localhost:5173 (no `/api` — the import relay is not served) |
| Build standalone app | `bun run build:app` | `dist-app/`, including `third-party-licenses.txt`, generated from the build's hidden sourcemaps ([scripts/third-party-licenses.mjs](../scripts/third-party-licenses.mjs)) |
| Preview prod app | `bun run preview` | serves `dist-app/` |
| Build library | `bun run build` | `dist/` (ESM+CJS, 4 entry points, type declarations) |
| Build iframe embed | `bun run build:embed` | `dist-embed/` |
| Lint | `bun run lint` | ESLint; must report zero errors (warnings are the tracked backlog) |
| Tests (one-shot) | `bun run test` | terminal |
| Tests (watch) | `bun run test:watch` | re-runs on change |
| Coverage | `bun run test:coverage` | `coverage/` — measured over all of `src/` except the generated shadcn primitives |
| Browser campaign | `bun run e2e` (one suite: `bun run e2e:csp`, `e2e:pwa`, `e2e:dataloss`, …) | needs `dist-app/` (and `dist/`, `dist-embed/` for the library and bridge suites) — see [e2e/README.md](../e2e/README.md) |

> `dev`, `preview`, and `build:app` all pass `--config vite.app.config.ts`; `build:embed` uses `vite.embed.config.ts`; `build` (library) uses the default `vite.config.ts`. The deploy runs `build:app` and then [scripts/strip-sourcemaps.mjs](../scripts/strip-sourcemaps.mjs), which moves the maps out of `dist-app/` — see [deployment.md](deployment.md#sourcemaps).

## Seed data

There's no DB to seed — the app seeds itself. On first load (only when storage is empty, and not when the browser wiped a library this origin used to hold — the `pf:library-canary` check, A017), [src/App.tsx](../src/App.tsx) passes an `initialDocument` containing `DEFAULT_CONTENT` ([src/constants.ts](../src/constants.ts)) — a "Welcome" doc demonstrating formatting, tables, task lists, and styled content — plus `starterDocuments` ([src/data/starter-documents.ts](../src/data/starter-documents.ts)), which adds a **Changelog** doc and a **Getting started** doc inside a `Guides` folder. The three `[[wiki link]]` to each other on purpose, so the relationship map opens on a connected graph rather than one lone dot. This is standalone-app only — an embedder's `initialDocument` stays exactly one document. Subsequent loads restore the last active document from IndexedDB ([src/store/documents/documentStore.ts](../src/store/documents/documentStore.ts)).

There are **no default users/passwords** (no auth).

To get a realistic multi-document state for testing graphs/backlinks: create a few docs and add `[[wiki links]]` between them — the workspace panel, backlinks tray, and relationship map populate immediately.

## Common recipes

### Add a formatting command (e.g. a new toolbar button)

1. Add the button in [src/ui/chrome/toolbar/index.tsx](../src/ui/chrome/toolbar/index.tsx) calling `dispatch("myCmd")`.
2. Handle `"myCmd"` in **both** branches of [src/formatting/useFormatDispatcher.ts](../src/formatting/useFormatDispatcher.ts): `dispatchToTiptap` ([:344](../src/formatting/useFormatDispatcher.ts#L344)) for the rich-text pane and `dispatchToMd` ([:512](../src/formatting/useFormatDispatcher.ts#L512)) for the markdown pane.
3. If it should reflect active state, add detection in the format-state query, `queryState` ([:689](../src/formatting/useFormatDispatcher.ts#L689)).
4. Optional shortcut: add to [src/hooks/useKeyboardShortcuts.ts](../src/hooks/useKeyboardShortcuts.ts) — a document chord acts only with the caret in a pane and the Editor view showing, and never on AltGr input — and document it in [src/data/shortcuts.ts](../src/data/shortcuts.ts), the single source for the Help page and the shortcut dialogs.

### Add a new view panel (workspace-panel / overlay style)

1. Add a toggle flag to [src/store/preferences/uiStore.ts](../src/store/preferences/uiStore.ts).
2. Build the component in [src/ui/](../src/ui/), consuming the store.
3. Render it from [src/PerssonifyEditor.tsx](../src/PerssonifyEditor.tsx) (where panels are wired).

### Add a custom Tiptap node

1. Create the extension in [src/extensions/](../src/extensions/), export from [src/extensions/index.ts](../src/extensions/index.ts).
2. Register it in the Tiptap extensions list in [src/ui/panes/tiptapPane/index.tsx](../src/ui/panes/tiptapPane/index.tsx) **and** in `SERIALIZE_EXTENSIONS` in [src/engine/serialize-doc.ts](../src/engine/serialize-doc.ts) — miss the second and headless/bulk export (and headless import) silently drops or throws on the node. Add the tags it renders to `KNOWN_ELEMENTS` in [src/store/importExport/ingest.ts](../src/store/importExport/ingest.ts), or imports report it as unmappable.
3. If it has a markdown form: the markdown → HTML side is a marked extension or renderer override in [src/engine/build-marked.ts](../src/engine/build-marked.ts) (wiki links, maths, footnotes, task lists and callouts work this way — a marked extension never fires inside code), and the HTML → markdown side a Turndown rule in [src/engine/turndown-rules.ts](../src/engine/turndown-rules.ts). If literal text could read as the new syntax, teach the escaper (`escapeMarkdownText`) to escape it. [src/engine/preprocessor.ts](../src/engine/preprocessor.ts) is only for rewrites of the raw source that must happen before marked tokenizes it (front matter, a wiki-link alias's `|`, the opt-in curly syntax).
4. If it can be lost on markdown export, teach [src/store/documents/fidelity.ts](../src/store/documents/fidelity.ts) about it.
5. If older builds could not load documents that use it, bump `CURRENT_SCHEMA_VERSION` ([src/store/documents/schema-version.ts](../src/store/documents/schema-version.ts)) — they then open such documents read-only instead of blank.

### Add a storage field

1. Extend `DocumentRecord` in [src/store/documents/document.ts](../src/store/documents/document.ts) and default it on read.
2. `serializeForStorage` ([:470](../src/store/documents/document.ts#L470)) writes an explicit list of fields: **add a field that must persist to it**, and leave a derived one out. If a backup should carry the field, add it to `toExportEnvelope` ([src/store/importExport/import-export.ts](../src/store/importExport/import-export.ts)) and forward it in the `pmjson` branch of `ingest()`.
3. Only bump `DB_VERSION` if you need a new object store or a data transform — see [database.md#migrations](database.md#migrations).

### Run one test file in watch mode

```bash
bunx vitest src/__tests__/sync-engine.test.js
```

### Reset local DB

In the app: **Settings ▸ Local data ▸ Erase all local data**. In the browser console (also in [database.md](database.md)):

```js
indexedDB.deleteDatabase('perssonify-docs');
indexedDB.deleteDatabase('perssonify-snapshots');
localStorage.clear();
location.reload();
```

Clear `localStorage` too: `pf:library-canary` remembers how many documents the origin held, and left behind it makes the next boot report a wiped library instead of seeding the starter documents.

### Attach a debugger

App build emits sourcemaps (`sourcemap: 'hidden'` in [vite.app.config.ts](../vite.app.config.ts)): nothing in the bundle references them, the licence-notice script reads them, and the deploy moves them out of `dist-app/` ([deployment.md ▸ Sourcemaps](deployment.md#sourcemaps)). The dev server has full sourcemaps. Set breakpoints in your browser's Sources tab against the `src/` files, or in your editor's JS debugger attached to the running Chrome instance. The `[DIAG]` logs ([src/utils/diag.ts](../src/utils/diag.ts)) are your cheapest tracing tool — they print relative timestamps and categories. For a user's problem, ask for **Copy diagnostics** (crash screen, or the About page): a redacted list of recent errors and failed saves with `file:line:col` positions that those sourcemaps map back to source ([src/utils/diagnostics.ts](../src/utils/diagnostics.ts)).
