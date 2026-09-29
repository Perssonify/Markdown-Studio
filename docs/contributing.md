# Contributing

> How to make changes to this repo. Standards are intentionally light; the important part is keeping the editor's invariants intact and the tests green.

## Before you start

- Read [architecture.md](architecture.md) (the canonical = PM JSON idea) and [gotchas.md](gotchas.md) (the sync-engine landmine). Most regressions in this codebase trace back to one of those.
- Skim [codebase-tour.md](codebase-tour.md#where-does-x-live) to find where your change belongs.

## Proposing a change

1. Branch from `main` using `feat/*` or `fix/*` (see [workflows.md](workflows.md#branching--prs)).
2. Make the change. Keep edits within the relevant subsystem; match the surrounding style (the repo has **no ESLint/Prettier config** — mirror the existing file's formatting, naming, and comment density).
3. Add or update tests in [src/__tests__/](../src/__tests__/) — vitest collects
   **`*.test.js` and `*.test.jsx` only** (a `.ts` test is silently ignored; a test
   that renders JSX must be `.jsx`) ([gotchas.md](gotchas.md#tests-must-be-js-not-ts)).
   Then **mutation-test the guard you just wrote**: revert the fix, confirm the case
   goes red, restore it. A test that cannot fail is worse than no test — this suite
   has shipped several, including thirteen describing a flag the code never had.
   Where a guard is genuinely unobservable (a memo that only changes a hit rate),
   say so in a comment instead of writing a case that passes either way.
4. Verify locally before pushing (CI runs the same gate on every PR — see [workflows.md](workflows.md#cicd-pipeline) — but reproducing locally is faster):
   ```bash
   bun run test
   bunx tsc --noEmit          # TypeScript strict mode is the de-facto linter
   bun run build:app          # the standalone app
   bun run build              # the published library (a separate config — it can
                              # break while build:app is green, e.g. CSS scoping)
   bun run e2e                # browser campaign; needs dist-app — see ../e2e/README.md
   ```
   If you touched anything under `docs/`, `node scripts/doc-anchors.mjs` checks the
   `#L123` links from `docs/` into `src/`; `--fix` repairs them. `doc-anchors.test.js`
   fails the suite if they rot.
5. Open a PR with a clear description: what changed, why, and how you verified it. Get one human review before merging.

## Coding standards

- **TypeScript strict** is on ([tsconfig.json](../tsconfig.json)) — but note `noImplicitAny: false`, so `any` is tolerated; prefer real types in new code anyway.
- **No restating lint rules here** — there's no lint config to point at. The bar is: matches existing style, type-checks clean, tests pass.
- **Path alias:** import from `@/…` (maps to `src/`).
- **State goes through stores**, not component-local globals — use `documentStore` / `uiStore` / `editorStore`.
- **Markdown vs canonical:** if you touch conversion, ensure HTML→MD→HTML **converges** (idempotent round-trip) or you'll create a sync loop — add a convergence test ([runbooks/sync-loop-or-frozen-editor.md](runbooks/sync-loop-or-frozen-editor.md)).
- **Don't persist derived data:** new derived fields must be stripped in `serializeForStorage` ([src/store/document.ts:307](../src/store/document.ts#L307)).
- **Diagnostics:** use the `[DIAG]` helpers ([src/utils/diag.ts](../src/utils/diag.ts)) rather than ad-hoc `console.log`.

## Adding a dependency

- Install with **Bun** (`bun add <pkg>`) so `bun.lock` stays canonical.
- **Library impact:** if the dependency is used by code that ships in the **library** build, decide whether it should be a `peerDependency` (so consumers control the version) — the externalization list lives in [vite.config.ts](../vite.config.ts). UI-only deps used by the app build don't need this.
- Prefer small, focused packages; this app deliberately implements things like the force-directed graph **without** a heavy library ([src/ui/GraphView.tsx](../src/ui/GraphView.tsx)). Match that bias before reaching for a big dependency.
- Avoid adding anything that duplicates an existing capability (we already have `marked`, `turndown`, `tiptap`, `codemirror`, `zustand`, `lucide-react`, shadcn/ui primitives).

## What not to do

- Don't add a node/mark to `TiptapPane.tsx` without ALSO: registering it in [src/engine/serialize-doc.ts](../src/engine/serialize-doc.ts) `SERIALIZE_EXTENSIONS` (or bulk/headless export silently drops or corrupts it — a missing one made `generateHTML` *throw*); adding its tag to `KNOWN_ELEMENTS` in [src/store/ingest.ts](../src/store/ingest.ts) (or our own renderer's output is reported to the user as "could not be mapped to the current schema"); and **writing its turndown rule**. Turndown's core is CommonMark only and this repo does not load `turndown-plugin-gfm`, so an element no rule matches keeps its text and loses its tag — silently, with no fidelity warning. Check what the node actually serializes to (`editor.getHTML()`), and test **both** directions.
- Don't trust a one-directional round-trip test. `strikethrough.test.js` covered md → html across several releases while the reverse destroyed the format on every sync.
- Don't add dependencies to the `useSyncEngine` force-sync callbacks ([gotchas.md](gotchas.md#the-sync-engine-callbacks-must-have-empty-dependency-arrays)).
- Don't hand-edit generated shadcn primitives in [src/components/ui/](../src/components/ui/); regenerate them.
- Don't reintroduce the removed auth middleware without a fresh design ([auth.md](auth.md)).
- Don't modify the root [`README.md`](../README.md) as part of a docs change unless that's explicitly the task — the `docs/` folder is the living source of truth.
