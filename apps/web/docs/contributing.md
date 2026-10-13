# Contributing

> How to make changes to this repo. Standards are intentionally light; the important part is keeping the editor's invariants intact and the tests green.

## Before you start

- Read [architecture.md](architecture.md) (the canonical = PM JSON idea) and [gotchas.md](gotchas.md) (the sync-engine landmine). Most regressions in this codebase trace back to one of those.
- Skim [codebase-tour.md](codebase-tour.md#where-does-x-live) to find where your change belongs.

## Proposing a change

1. Branch from `main` using `feat/*` or `fix/*` (see [workflows.md](workflows.md#branching--prs)).
2. Make the change. Keep edits within the relevant subsystem; match the surrounding style (there is **no Prettier config** — mirror the existing file's formatting, naming, and comment density; ESLint checks correctness, not layout).
3. Add or update tests in [src/__tests__/](../src/__tests__/) — vitest collects
   **`*.test.js` and `*.test.jsx` only** (a `.ts` test is silently ignored; a test
   that renders JSX must be `.jsx`) ([gotchas.md](gotchas.md#tests-must-be-js-not-ts)).
   Then **mutation-test the guard you just wrote**: revert the fix, confirm the case
   goes red, restore it. A test that cannot fail is worse than no test — this suite
   has shipped several, including thirteen describing a flag the code never had.
   Where a guard is genuinely unobservable (a memo that only changes a hit rate),
   say so in a comment instead of writing a case that passes either way.
4. Verify locally before opening the PR, and again before merging it — there is no CI, so this gate is the only check (see [workflows.md](workflows.md#verify-gate-and-deploys)):
   ```bash
   bun run lint               # ESLint — zero errors; warnings are the tracked backlog
   bunx tsc --noEmit          # the type gate (strict mode)
   bun run test
   bun run build:app          # the standalone app
   bun run build              # the published library (a separate config — it can
                              # break while build:app is green, e.g. CSS scoping)
   bun run e2e                # browser campaign; needs dist-app (and dist/, dist-embed/
                              # for the library and bridge suites) — see ../e2e/README.md
   ```
   If you touched anything under `docs/` (or `CLAUDE.md`, `README.md`),
   `node scripts/doc-anchors.mjs` checks their `#L123` links into the source;
   `--fix` repairs them. `doc-anchors.test.js` fails the suite if they rot.
5. Open a PR with a clear description: what changed, why, and how you verified it. Get one human review before merging.

## Coding standards

- **TypeScript strict** is on ([tsconfig.json](../tsconfig.json)), including `noImplicitAny`: an untyped parameter or an untyped import fails the type gate. A package that ships no types gets a small declaration in `src/types/` (see `turndown.d.ts`) rather than a new `@types/` dependency. Explicit `any` is still tolerated (the linter counts it as a warning); prefer real types in new code.
- **Lint** ([eslint.config.js](../eslint.config.js)): the stock `@eslint/js` + `typescript-eslint` recommended sets, with `react-hooks/rules-of-hooks` as an error and `exhaustive-deps` as a warning — hook dependencies are where this codebase's worst bugs lived (see the sync-engine landmine in [gotchas.md](gotchas.md)). A deliberately omitted dependency gets an `eslint-disable-next-line` with a comment saying why. The bar is: zero lint errors, type-checks clean, tests pass, matches existing style.
- **Path alias:** import from `@/…` (maps to `src/`).
- **State goes through stores**, not component-local globals — use `documentStore` / `uiStore` / `editorStore`.
- **Markdown vs canonical:** if you touch conversion, ensure HTML→MD→HTML **converges** (idempotent round-trip) or you'll create a sync loop — add a convergence test ([runbooks/sync-loop-or-frozen-editor.md](runbooks/sync-loop-or-frozen-editor.md)); `converter-roundtrip.test.js` drives the real engine and schema through md → rich → md.
- **Don't persist derived data:** `serializeForStorage` ([src/store/documents/document.ts:470](../src/store/documents/document.ts#L470)) writes an explicit list of fields — leave a derived field out of it, and add a new field that must persist.
- **Diagnostics:** use the `[DIAG]` helpers ([src/utils/diag.ts](../src/utils/diag.ts)) rather than ad-hoc `console.log`. An error worth reporting goes through `recordDiagnostic` ([src/utils/diagnostics.ts](../src/utils/diagnostics.ts)) — a local, redacted ring; never put document content in it.

## Adding a dependency

- Install with **Bun** (`bun add <pkg>`) and commit `bun.lock`: the verify gate and the deploy install with `bun install --frozen-lockfile`.
- **Library impact:** the library's externals are **derived from `package.json`** ([build/externals.mjs](../build/externals.mjs)) — anything in `dependencies` or `peerDependencies` stays external, so consumers install and dedupe it; a devDependency the library imports is bundled, and must be listed as such in `pkg-manifest.test.js`, which fails on any import that is not declared. Use a `peerDependency` when the consumer must share your copy (React, Tiptap, CodeMirror). Tiptap packages move as one set at one version, and `pkg-lockfile.test.js` requires a single resolution of Tiptap, ProseMirror, React and KaTeX. UI-only deps used by the app build don't need any of this.
- Prefer small, focused packages; this app deliberately implements things like the force-directed graph **without** a heavy library ([src/ui/graph/graphView/index.tsx](../src/ui/graph/graphView/index.tsx)). Match that bias before reaching for a big dependency.
- Avoid adding anything that duplicates an existing capability (we already have `marked`, `turndown`, `tiptap`, `codemirror`, `zustand`, `lucide-react`, shadcn/ui primitives).

## What not to do

- Don't add a node/mark to `tiptapPane/index.tsx` without ALSO: registering it in [src/engine/serialize-doc.ts](../src/engine/serialize-doc.ts) `SERIALIZE_EXTENSIONS` (or bulk/headless export silently drops or corrupts it — a missing one made `generateHTML` *throw*); adding its tag to `KNOWN_ELEMENTS` in [src/store/importExport/ingest.ts](../src/store/importExport/ingest.ts) (or our own renderer's output is reported to the user as "could not be mapped to the current schema"); and **writing its turndown rule**. Turndown's core is CommonMark only and this repo does not load `turndown-plugin-gfm`, so an element no rule matches keeps its text and loses its tag — silently, with no fidelity warning. Check what the node actually serializes to (`editor.getHTML()`), and test **both** directions. If older builds could not load documents that use it, bump `CURRENT_SCHEMA_VERSION` ([src/store/documents/schema-version.ts](../src/store/documents/schema-version.ts)) so they open them read-only instead of blank.
- Don't trust a one-directional round-trip test. `strikethrough.test.js` covered md → html across several releases while the reverse destroyed the format on every sync.
- Don't add dependencies to the `useSyncEngine` force-sync callbacks ([gotchas.md](gotchas.md#the-sync-engine-callbacks-must-have-empty-dependency-arrays)).
- Don't hand-edit generated shadcn primitives in [src/components/ui/](../src/components/ui/); regenerate them.
- Don't reintroduce the removed auth middleware without a fresh design ([auth.md](auth.md)).
- Don't modify the root [`README.md`](../README.md) as part of a docs change unless that's explicitly the task — the `docs/` folder is the living source of truth.
