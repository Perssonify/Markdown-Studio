# Local Development — Getting Productive

> Goal: from `git clone` to shipping a change, fast. For *what* the code does see [features.md](features.md); for *where things are* see [codebase-tour.md](codebase-tour.md).

## Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| [Bun](https://bun.sh) | latest | Canonical package manager + runner. [`bun.lock`](../bun.lock) is the committed lockfile and [`vercel.json`](../vercel.json) builds with `bun install` / `bun run build:app`. |
| Node.js | 20+ | Vite 6 / Vitest 4 require a modern runtime; Bun bundles its own JS engine, but Node 20+ keeps `npm` fallback and tooling happy. |
| A Chromium/Firefox browser | current | The app relies on IndexedDB + DOMParser + (optionally) the RegExp `d`/`hasIndices` flag for find-and-replace capture coloring. |

> `npm install` also works (peer/dev deps are standard), but prefer Bun so your lockfile matches CI/deploy.

## First run

```bash
bun install
bun run dev
```

Then open `http://localhost:5173`.

## Environment variables

**There are none.** This is a client-only app with no backend and no build-time secrets. There is no `.env`, no `.env.example`, and no `import.meta.env.VITE_*` usage in `src/`. The old `MARKDOWNEDITOR_PASSWORD` belonged to the removed auth middleware and **does not exist** — see [auth.md](auth.md).

"Configuration" that does exist lives in code/storage, not env:

| What | Where | Notes |
|------|-------|-------|
| Sync idle delay | `SYNC_MIN_DELAY_MS`…`SYNC_MAX_DELAY_MS` = 120…800 ([src/constants.ts](../src/constants.ts)) | derived from measured projection cost, not doc size |
| Sync max-wait ceiling | `SYNC_MIN_MAX_WAIT_MS`…`SYNC_MAX_MAX_WAIT_MS` = 250…1200 ([src/constants.ts](../src/constants.ts)) | how far the other pane may lag while you keep typing |
| Autosave interval | `AUTOSAVE_MS = 5000` ([src/constants.ts:17](../src/constants.ts#L17)) | |
| Toolbar compact breakpoint | `TOOLBAR_COMPACT_BP = 1080` ([src/constants.ts](../src/constants.ts)) | |
| IndexedDB name / cap | `perssonify-docs`, 50 MB ([src/store/idb-storage-adapter.ts:66](../src/store/idb-storage-adapter.ts#L66)) | |
| Theme storage key | `perssonify-theme` ([src/main.tsx:13](../src/main.tsx#L13)) | localStorage |

## Running the app in each mode

| Mode | Command | Output |
|------|---------|--------|
| Dev server (HMR) | `bun run dev` | localhost:5173 |
| Build standalone app | `bun run build:app` | `dist-app/` |
| Preview prod app | `bun run preview` | serves `dist-app/` |
| Build library | `bun run build` | `dist/` (ESM+CJS, 4 entry points) |
| Tests (one-shot) | `bun run test` | terminal |
| Tests (watch) | `bun run test:watch` | re-runs on change |

> `dev`, `preview`, and `build:app` all pass `--config vite.app.config.ts`; `build:embed` uses `vite.embed.config.ts`; `build` (library) uses the default `vite.config.ts`.

## Seed data

There's no DB to seed — the app seeds itself. On first load (and only when storage is empty), [src/App.tsx](../src/App.tsx) passes an `initialDocument` containing `DEFAULT_CONTENT` ([src/constants.ts](../src/constants.ts)) — a "Welcome" doc demonstrating formatting, tables, task lists, and styled content — plus `starterDocuments` ([src/data/starter-documents.ts](../src/data/starter-documents.ts)), which adds a **Changelog** doc and an **About Perssonify** doc inside a `Perssonify` folder. The three `[[wiki link]]` to each other on purpose, so the relationship map opens on a connected graph rather than one lone dot. This is standalone-app only — an embedder's `initialDocument` stays exactly one document. Subsequent loads restore the last active document from IndexedDB ([src/store/documentStore.ts](../src/store/documentStore.ts)).

There are **no default users/passwords** (no auth).

To get a realistic multi-document state for testing graphs/backlinks: create a few docs and add `[[wiki links]]` between them — the workspace panel, backlinks tray, and relationship map populate immediately.

## Common recipes

### Add a formatting command (e.g. a new toolbar button)

1. Add the button in [src/ui/Toolbar.tsx](../src/ui/Toolbar.tsx) calling `dispatch("myCmd")`.
2. Handle `"myCmd"` in **both** branches of [src/formatting/useFormatDispatcher.ts](../src/formatting/useFormatDispatcher.ts): `dispatchToTiptap` ([:344](../src/formatting/useFormatDispatcher.ts#L344)) for the rich-text pane and `dispatchToMd` ([:512](../src/formatting/useFormatDispatcher.ts#L512)) for the markdown pane.
3. If it should reflect active state, add detection in the format-state query ([:364](../src/formatting/useFormatDispatcher.ts#L364)).
4. Optional shortcut: add to [src/hooks/useKeyboardShortcuts.ts](../src/hooks/useKeyboardShortcuts.ts).

### Add a new view panel (workspace-panel / overlay style)

1. Add a toggle flag to [src/store/uiStore.ts](../src/store/uiStore.ts).
2. Build the component in [src/ui/](../src/ui/), consuming the store.
3. Render it from [src/PerssonifyEditor.tsx](../src/PerssonifyEditor.tsx) (where panels are wired).

### Add a custom Tiptap node

1. Create the extension in [src/extensions/](../src/extensions/), export from [src/extensions/index.ts](../src/extensions/index.ts).
2. Register it in the Tiptap extensions list in [src/ui/TiptapPane.tsx](../src/ui/TiptapPane.tsx) **and** in `SERIALIZE_EXTENSIONS` in [src/engine/serialize-doc.ts](../src/engine/serialize-doc.ts) — miss the second and headless/bulk export silently drops or throws on the node.
3. If it has a markdown form, add a Turndown rule ([src/engine/turndown-rules.ts](../src/engine/turndown-rules.ts)) and (if needed) preprocessing ([src/engine/preprocessor.ts](../src/engine/preprocessor.ts)).
4. If it can be lost on markdown export, teach [src/store/fidelity.ts](../src/store/fidelity.ts) about it.

### Add a storage field

1. Extend `DocumentRecord` in [src/store/document.ts](../src/store/document.ts) and default it on read.
2. If derived, **strip it in `serializeForStorage`** ([:418](../src/store/document.ts#L418)) so it isn't persisted.
3. Only bump `DB_VERSION` if you need a new object store or a data transform — see [database.md#migrations](database.md#migrations).

### Run one test file in watch mode

```bash
bunx vitest src/__tests__/sync-engine.test.js
```

### Reset local DB

In the browser console (also in [database.md](database.md)):

```js
indexedDB.deleteDatabase('perssonify-docs');
localStorage.clear();
location.reload();
```

### Attach a debugger

App build emits sourcemaps (`sourcemap: 'hidden'` in [vite.app.config.ts](../vite.app.config.ts)); the dev server has full sourcemaps. Set breakpoints in your browser's Sources tab against the `src/` files, or in your editor's JS debugger attached to the running Chrome instance. The `[DIAG]` logs ([src/utils/diag.ts](../src/utils/diag.ts)) are your cheapest tracing tool — they print relative timestamps and categories.
