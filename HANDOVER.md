# Team handoff / onboarding — Markdown Studio (start here)

**Audience:** an engineer (or engineering agent) picking up this repo to continue
feature work, hardening, and maintenance. Read this file top to bottom once, then read
`CLAUDE.md` (the authoritative file/invariant map) and `docs/gotchas.md` (the landmines)
before changing code.

---

## 0. Current state

- **Repo:** `SolutionPath/markdown-studio`
- **Archived predecessor:** [`SolutionPath/Markdown-Editor-V3`](https://github.com/SolutionPath/Markdown-Editor-V3)
- **Package/version:** `@perssonify/editor` **v1.77.0**, plus the unreleased fixes for
  the September 2026 production-readiness audit (`CHANGELOG.md` ▸ Unreleased) —
  single-sourced from `package.json` (Vite injects `__APP_VERSION__`;
  `src/constants.ts` re-exports it as `VERSION`). Bump `package.json` only.
- **Before launch:** read **`docs/audit-2026-09.md`** — the audit's 114 findings, what
  is done, the owner actions that are not code (domain, CI gate, npm scope, legal
  pages…) and the deferred engineering work.
- **Package manager:** **Bun 1.4.0** (pinned by `packageManager`; always
  `bun install --frozen-lockfile`). Do not use npm/yarn.
- **Deploy:** the standalone app auto-deploys to **Vercel** (preview per branch,
  production on `main`). It's a static SPA; the only server code is one same-origin
  serverless relay (`api/import.js` — see `docs/import-relay.md`), used only after
  the user agrees. Open tabs are PROMPTED to update, never force-reloaded.
- **CI:** `.github/workflows/ci.yml` runs the full verify gate and the browser campaign
  on every PR to `main` and every push to it — but nothing yet stops a red build
  from deploying: branch protection and Vercel deployment checks are owner steps
  (`docs/deployment.md`).

### Verify gate (run before every commit; CI runs the same)
```bash
bun install --frozen-lockfile
bunx tsc --noEmit      # type gate — must be clean
bun run lint           # ESLint + React hook rules — 0 errors
bun run test           # Vitest — must pass (196 files / 2,126 tests)
bun run build:app      # standalone app build (dist-app/) + third-party licence notice
bun run build          # library build (dist/)
bun run build:embed    # iframe-embed build (dist-embed/)
bun run e2e            # browser campaign, incl. the csp and pwa suites (e2e/README.md)
```
Everything must be green. Ship incrementally: implement → verify → bump `package.json`
→ commit → push.

---

## 1. What this project is (one screen)

`@perssonify/editor` is a **dual-pane, bidirectionally-synced Markdown editor**: a
**CodeMirror 6** raw-markdown pane and a **TipTap/ProseMirror** rich pane kept in sync.
There is no account, no login and no database to provision; the only server code is
the opt-in URL-import relay. Documents persist in the browser (IndexedDB → a
`window.storage` shim → localStorage → in-memory, chosen by `createStorageAdapter`;
the in-memory fallback shows a permanent "Not saving" banner). It ships three ways: an embeddable npm **library** (`dist/`), a
standalone **app** (`dist-app/`, on Vercel), and an **iframe embed** entry (`dist-embed/`).

**The canonical source of truth is ProseMirror JSON** inside the live TipTap editor.
Markdown is a *projection* maintained by a hash-gated, debounced, re-entrancy-guarded sync
engine. Keep that mental model — most subtle bugs come from forgetting it.

Authoritative reading, in order:
1. `CLAUDE.md` — the file map + the **Invariants — do NOT break** section. The single most
   important document; everything in it is load-bearing.
2. `docs/gotchas.md` — the landmines.
3. `docs/architecture.md` (ADRs), `docs/data-pipeline.md`, `docs/database.md`.
4. `docs/features.md` — feature-by-feature with entry points and edge cases.
5. `docs/audit-2026-09.md` — **what remains before launch**: the September 2026
   production-readiness audit register (all 114 findings and their status), the owner
   actions that are not code, and the deferred engineering work.
6. `docs/v1-to-current-changelog.md` — the full v1→current delta (hand this to builders).
7. `docs/backlog.md` — planned features + earlier audits' findings + the state-machine decision.
8. `docs/integration-guide.md` — for host apps embedding the library/iframe.

---

## 2. Repo map (where things live)

`CLAUDE.md` has the exhaustive, always-updated map. The high-level orientation:

| Area | Path | What |
| --- | --- | --- |
| Orchestrator | `src/PerssonifyEditor.tsx` | Wires stores, engine, panes, dialogs, host bridge. The big component. |
| App shell | `src/App.tsx`, `src/app/router.tsx` | Standalone app: routing (`/about`,`/help`,`/graph`), URL-param reader, first-run tour. |
| Doc lifecycle | `src/hooks/useDocumentLifecycle.ts` | Switch/new/close/delete/revert, sync debounce, history capture, snapshot restore. HIGH-RISK. |
| Stores | `src/store/documentStore.ts`, `uiStore.ts`, `editorStore.ts`, `folders.ts` | Zustand. `documentStore` is the data-integrity core. |
| Persistence | `src/store/storage-adapter.ts`, `idb-storage-adapter.ts` | Pluggable; IndexedDB default. |
| Snapshots | `src/store/snapshot-store.ts` | **Sidecar** IndexedDB version-history ring (recovery net). Independent of the doc adapter. |
| Sync engine | `src/engine/useSyncEngine.ts`, `useMarkdownEngine.ts`, `build-marked.ts`, `turndown-rules.ts` | Bidi MD↔canonical. Ref-based, empty-dep callbacks (see invariants). |
| Panes | `src/ui/CodeMirrorPane.tsx`, `TiptapPane.tsx`, `EditorPanes.tsx` | The two editors + split/scroll-sync. |
| Workspace panel | `src/ui/WorkspacePanel.tsx`, `FolderTree.tsx` | Left-docked Files / Outline tabs (the library + single-doc outline). |
| Graph | `src/ui/GraphView.tsx`, `src/store/graph-metrics.ts`, `doc-outline.ts` | **Map-only** full-screen relationship overlay + orphan/broken-link metrics. |
| Find/Replace | `src/ui/FindReplace.tsx`, `src/formatting/find-engine.ts`, `find-worker.ts` | Floating draggable panel; ONE matcher; a regex runs in a terminable Web Worker. |
| Durability & ops | `src/store/storage-durability.ts`, `crash-recovery.ts`, `src/pwa/sw-updates.ts`, `src/utils/*` | Wipe detection, backup reminder, unload stash, prompted updates, diagnostics ring, dev-only gates. |
| Extensions | `src/extensions/*` | Custom TipTap nodes (math, diagrams, callouts, details, task lists, background-color, wiki-link, sized/theme images, emoji, frontmatter). |
| UI pages/dialogs | `src/ui/pages/*`, `src/ui/*Sheet.tsx`, `Dialogs.tsx` | Help/About, Settings, Memory, Version History, Link builder, etc. |
| Relay | `api/import.js` | The ONLY server code: a hardened same-origin import proxy. |
| Generated | `src/components/ui/*` | shadcn primitives — regenerate via CLI, don't hand-edit. |

---

## 3. How it got here (the short version)

The app grew from the initial import ("v1", internally 1.4.0) to v1.60.0 through ~55
incremental releases. The full, area-grouped delta lives in
[`docs/v1-to-current-changelog.md`](docs/v1-to-current-changelog.md); the terse
per-version log is [`CHANGELOG.md`](CHANGELOG.md); `git log` is authoritative (feature
commit subjects after v1.35 carry their `(vX.Y.Z)` tag). The broad strokes:

- **Foundation** — flavors/math/diagrams/emoji, folders, archives, Settings, CI, license,
  the green type gate.
- **v1.5–v1.9** — integration/embed + URL import, then the menu-bar UX overhaul (tab bar
  removed), routed pages, and the guided tour.
- **v1.16–v1.29** — scroll sync, context menu, heading anchors, case transforms, read-only,
  the Find/Replace redesign, bottom tray, status-bar redesign.
- **v1.30–v1.32** — an antagonistic security audit and, after a **real data-loss scare**,
  the phased **four-layer data-loss defence** (see §5).
- **v1.35–v1.52** — typography/reading, task lists, callouts, details, DOCX import, the
  diagnostics console, incremental link index, IME/dictation-aware sync.
- **v1.54–v1.59** — the **unified Workspace panel** (Files / Outline), mobile touch sizing,
  and the graph settling on a **map-only relationship overlay**.
- **v1.60–v1.77** — the Markdown Studio rename and migration (history-clean import at
  v1.70.0), the Cards board, and a string of data-loss fixes from outside reviews.
- **September 2026** — an external **production-readiness audit** of v1.77.0 (114
  findings). The unreleased fixes cover content fidelity, multi-tab safety, storage
  eviction, prompted updates, the relay's consent and limits, accessibility, the npm
  package and CI; what remains is in `docs/audit-2026-09.md`.

The throughline: this is a **data-integrity-sensitive** app (users lose real work if the
save/switch/sync layer misbehaves). Most hardening effort went into making unintentional,
out-of-user-control data loss impossible, and into recoverability when prevention fails.

---

## 4. The knowledge graph (current design)

`src/ui/GraphView.tsx` is a **map-only, full-screen relationship overlay** (opened from
the top-bar Editor · Cards · Map switcher, View ▸ Relationship map, or **⌘⇧G**):

- Documents are nodes, `[[wiki links]]` are edges, folders are labeled dashed clusters.
- It opens **directly on the map** with the active doc highlighted and its neighbourhood
  focused (`focusActive`), until the user pans/zooms/drags.
- **Search** dims non-matches (Enter focuses the match); **orphan + broken-link health
  chips** highlight isolated/unresolved nodes (broken-link targets shown as off-by-default
  ghost nodes, excluded from the sim).
- Node interactions: click = select; double-click / Enter = open (closes overlay);
  drag = rearrange; wheel/buttons/Fit = camera. Escape clears search/filter, else closes
  — handled in the bubble phase, so a dialog or rename box keeps its own Escape.
- Physics is a **single-ref force loop that FREEZES on settle** — do **not** reintroduce a
  per-loop snapshot (jump/drift bug).

Single-document structure lives in the **Workspace panel's Outline tab**, not the graph.
An earlier in-graph structure pane and an in-panel Map tab were tried and **removed** — do
not re-add them (see `CLAUDE.md`).

---

## 5. Data-loss architecture — the four layers (understand before editing)

"The document" exists as up to four representations that can drift: (a) the live TipTap
editor JSON, (b) `store.activeDoc.canonical`, (c) the persisted record, (d) the cached
unsaved-edit draft. The protection is layered; each layer has a precise job and a
CLAUDE.md invariant explaining it. **Do not weaken any of them.**

1. **Blank-canonical save backstop** (`documentStore.saveActiveDoc`): refuses to persist a
   BLANK canonical over a stored doc that has real content. Fails *closed* on read error.
   Parks a terminal `"blocked"` save status (does NOT re-arm autosave). The only sanctioned
   blank persist is the explicit **Clear document** command via `allowBlankSaveOnce()`.
2. **Stale-overwrite prevention — live-canonical provider**: `renameDoc` and `patchDocById`
   (title-only) merge the change onto the LIVE editor content via `registerLiveCanonical`,
   not the lagging on-disk copy — so a rename/patch can't rewind unsaved edits.
   `liveCanonicalFor` refuses a blank.
3. **Switch guards — rapid-switch stale-settle**: `useDocumentLifecycle.switchGenRef` guards
   the **editor hydration**; `documentStore.switchSeq` guards the store **`activeDocId`**.
   **Both are required** — without the store guard, `activeDocId` and `hydratedDocId`
   desync → every save blocked + cross-doc draft contamination.
4. **Recoverable snapshot net** (`store/snapshot-store.ts`): a **sidecar IndexedDB**
   (`perssonify-snapshots`, its own DB — survives reloads) keeps a bounded per-doc ring of
   prior versions. `saveActiveDoc` snapshots the OLD content before overwriting; `deleteDoc`
   snapshots before delete. Restore via **Tools ▸ Version history**.

Plus the non-negotiable core: **`hydratedDocId` is the save chokepoint** — `saveActiveDoc`
refuses when the editor's content doesn't belong to the active doc. Every path that pushes
content into the editor must `markHydrated(docId)`; every path that changes `activeDocId`
without pushing must leave it null. Read `getLifecycleState()` when debugging this layer.

The September 2026 audit added more around these four (each a `CLAUDE.md` invariant):
stored content reaches the editor only through `hydrateEditorWithDoc`, which opens a
document from a newer build read-only instead of blank (A021); a failed storage read is
an error, never "not found", and the save fails closed (A029); the unload stash carries
each draft's base revision, so a reload cannot launder a two-tab conflict (A018); a
library the browser emptied is detected and never re-seeded (A017); `"full"` joins
`"blocked"` and `"conflict"` as a terminal save status (A086); and `saveActiveDoc`
resolves `true` only when the write committed (A026). One gap is known and open: an
editor unmounted by a host writes its cached draft with no blank check
(`releaseEditor`, see `docs/audit-2026-09.md`).

**Deferred (recorded in `docs/backlog.md`):** a full doc-lifecycle state-machine rewrite.
This is the highest-blast-radius code; it is now protected by the four layers + documented
invariants + a regression suite, at a good risk-adjusted optimum. Do the FSM extraction the
*next* time this layer is substantively changed — most likely the multi-tab `conflict` work
or a multi-file / Overleaf-style project model — so the risk is amortized.

---

## 6. Invariants you must not break (top of the list)

Full list in `CLAUDE.md`. The ones that have each caused a real bug:

- **Sync engine `force*` callbacks use empty dependency arrays and call through refs.**
  Never put `syncMdToHtml`/`syncHtmlToMd` in an effect dep array — mirror into a ref first.
  Violating this wired an infinite loop (React #185) and crashed the app.
- **Sync is IME / voice-dictation aware** — do not strip the composition guards, or
  dictated text gets dropped.
- **Hydrating a different document must drop undo history** (`resetHistory` on both panes).
  The one sanctioned exception is `store/history-cache.ts` (validated restore).
- **Do NOT re-add a focus-based heuristic in `syncHtmlToMd`** — it silently reverted genuine
  deletions on blur. Recoverability is the save backstop's job.
- **CodeMirror multi-range selection needs BOTH `allowMultipleSelections` AND
  `drawSelection()`** — without the latter only one range renders.
- **Any node/mark added to `TiptapPane.tsx` must also be registered in
  `src/engine/serialize-doc.ts` `SERIALIZE_EXTENSIONS`** — else headless/bulk export
  silently drops or corrupts it (a missing node made `generateHTML` throw).
- **Vitest only picks up `*.test.{js,jsx}`** — test files MUST be `.js`/`.jsx`.
- **`src/components/ui/*` are generated** — regenerate via the shadcn CLI, don't hand-edit.
- **Turndown checks later-added rules first (LIFO)** — order matters in `turndown-rules.ts`.
- **Base UI `DropdownMenuLabel` must sit inside a `DropdownMenuGroup`** (Base UI #31).
- **Security invariants**: the relay must not reflect upstream `Content-Type`, is used only
  after the user agrees, and connects only to public addresses; `?import_url=` never
  auto-fetches; host CSS colors go through `sanitizeCssColor` and every style value through
  `css-safety.ts`; `htmlToCanonical` uses an inert `DOMParser`; archive paths go through
  `normalizeArchivePath`; editing an inline `<script>` means updating its CSP hash in
  `vercel.json`. Do not regress.
- **Document chords need the caret in a pane, and AltGr is never a shortcut** — no new
  keymap may bind Ctrl+Alt plus a character (A025, A052).
- **The service worker prompts; it never force-reloads a tab** (A008).

---

## 7. Technical debt, risks & areas of concern

- **Highest-risk area:** the save/switch/sync/hydrate lifecycle (`documentStore.ts` +
  `useDocumentLifecycle.ts` + `useSyncEngine.ts`). Correct and well-tested, but intricate
  and timing-sensitive. Change it surgically, keep the four layers intact, re-run the
  hydration-guard tests.
- **Multi-tab:** tabs sync live over a `BroadcastChannel` (a clean open document
  reloads; one with unsaved work is told at once and chooses, with the other side kept
  in Version history). The save-status machine was not rewritten (§5); read-check-write
  is still not atomic across tabs.
- **Large documents:** both directions project per block now (A083), so typing stays
  responsive at 1.6–4 MB in either pane, and the markdown→rich model is prepared in idle
  time after a load (first keystroke at 4 MB: 28 s → 2.7 s at 4× CPU). What is left is
  not the projection: each autosave of a 4 MB note re-reads and re-sanitizes the stored
  copy (~4 s at 4× CPU), and TipTap's code highlighter redoes every code block — both
  under Deferred in docs/audit-2026-09.md.
- **Graph performance:** measured at 2,000 notes (A088): above 300 notes the layout is
  Barnes–Hut, above 250 the drawing is batched and each frame either steps or paints.
  First frame 1.0 s, settle 17–23 s under a 4× CPU slowdown. Folder maps up to 500 notes
  get a folder-aware layout and larger ones a two-level layout (folders placed as regions,
  notes inside them): no note is drawn under another at any size.
- **`PerssonifyEditor.tsx`** was split into fifteen hooks under `src/editor/` (A110);
  about 970 lines of orchestration remain. Hook call order is effect order — read
  CLAUDE.md's parts map before moving anything. Sixteen behavioural suites now mount the
  real editor (A108).
- **Browsers:** Chromium runs every e2e suite; Firefox and WebKit run five of them (A100).
  Desktop WebKit is not iOS Safari, so the iOS-only paths still lack on-device proof.
  Below the declared floor (Safari/iOS 16.4, Chrome/Edge 111, Firefox 128) the app shows
  a message instead of a blank page (A097).
- **Bundle size:** the startup payload is ~680 KiB gzip; mermaid, abcjs and katex load
  lazily and are precached for offline use.

---

## 8. Suggested next work (candidates, not commitments)

- **Launch blockers first:** the owner actions and deferred engineering in
  `docs/audit-2026-09.md` — above all the domain, the CI gate on deploys and the old
  origin's move banner — and the defects found while reconciling the docs, listed in
  the same file (the `/embed.html` framing gap and the broken first-run `[[Welcome]]`
  links first).
- **Full-document LaTeX / multi-file projects** — content/engine-layer if single-doc; a
  data-model change (and the right moment for the FSM extraction) if Overleaf-style projects.
- **Backlog features** (`docs/backlog.md`): Markdown format detection + settings suggestion,
  multi-column / scientific writing (columns → cross-refs → citations).

---

## 9. Working agreement / git

- Develop on a feature branch; **never force-push shared history**; bump `package.json` per
  shippable change; keep `tsc` + tests + all three builds green.
- Commit messages: clear and descriptive; match the existing style in `git log`.
- Do not include any AI model identifier in commits, PR text, code, or docs.
- GitHub ops go through the GitHub MCP tools (no `gh` CLI in the CI/agent env).

## 10. Fast orientation checklist

1. `bun install --frozen-lockfile && bunx tsc --noEmit && bun run lint && bun run test`
   — confirm a green baseline.
2. Read `CLAUDE.md` (map + invariants) and `docs/gotchas.md`.
3. Skim `src/store/documentStore.ts` and `src/hooks/useDocumentLifecycle.ts` with §5 open
   beside them — that's the delicate core.
4. Open the app (`bun run dev`) and try: type unsaved edits → rename in the Workspace panel
   (edits kept); rapidly switch docs while typing (no wrong-doc flicker); Tools ▸ Version
   history → clear/delete/restore, reload, confirm snapshots persist; ⌘⇧G → graph search +
   health chips. This exercises the recent work end to end.
5. Pick from §8; plan it against §5 (does it touch the lifecycle?); ship incrementally
   behind the verify gate.
