# Backlog & planning

Larger features that are captured for deliberate planning rather than immediate
implementation. Each entry states the goal, an initial design sketch, open
questions, and a rough complexity/risk read. Nothing here is committed to a
release yet.

> **What remains before launch is NOT tracked here.** The September 2026
> production-readiness audit (114 findings, A001–A114) has its own register,
> [`audit-2026-09.md`](audit-2026-09.md): every finding's status, the owner actions
> that are not code, and the deferred engineering work. It is the authoritative
> list; this file keeps the design backlog and the earlier audits, whose statuses
> were reconciled against the code on 2026-09-29 (audit A111).

---

## 1. Console / automation & diagnostics tray

**Status.** ✅ **Diagnostics console SHIPPED** (read-only curated registry —
`src/ui/ConsolePanel.tsx` + `src/store/diagnostics/console-commands.ts`,
`consoleEnabled`/`pf:console`, the bottom tray's second tab after Document Links).
It is switched on from the Settings **Admin** section, which production builds
hide unless `localStorage["pf:admin"]` is `"1"`; while the section is hidden the
switch falls back to off (audit A081). Commands: `help`, `diag.lifecycle`,
`diag.storage`, `docs.list`, `doc.outline`, `doc.links`, `graph.stats`.
**Automation / mutating commands remain backlog** (below). User-facing
diagnostics — the redacted error ring behind "Copy diagnostics" on the crash
screen and the About page — shipped separately (audit A009).

**Shipped design.** A tray tab (next to Document Links) with a REPL-style
input + scrollback. Commands run against a **curated command registry** — NOT
`eval` — over a typed, READ-ONLY `ConsoleContext` of getters. `console-commands.ts`
is pure and unit-tested.

**Remaining (backlog).**
- `format.*` — run the existing dispatch/scope engines programmatically
  (e.g. `format.headings('title')`) — reuses `useFormatDispatcher` + `select-scope`.
  MUST route through `dispatch`/`patchDocById` and honor read-only (no raw storage
  write); the `ConsoleContext` would gain a gated command channel, never a write
  getter.
- `automation.*` — saved scripts + optional triggers (on-save, on-open).
- Persistence of scripts (localStorage / a `__scripts` IDB store).
- A real JS sandbox (Web Worker + `Comlink`) — powerful but heavier and a bigger
  attack surface; the curated registry is the deliberate first step.

**Complexity/risk.** The mutating/automation lane is Medium–Large and its own
effort; the shipped read-only diagnostics were Low risk.

---

## 2. Markdown format detection + settings-change suggestion

**Status (2026-08): PAUSED — needs a usability-impact study before building.** The owner
flagged that surfacing detection/suggestions (toasts, banners, one-click "enable X") has a
**higher UX blast radius than first scoped**: it can nag, fire false positives on literal
`|`/`~`/`$`, and silently change how a document renders when a suggestion is applied. Before
any implementation, research (a) where/when to surface it without interrupting flow, (b) how
to make applying a suggestion clearly reversible and scoped (per-document vs. global), and
(c) confidence thresholds that keep false positives near zero. Revisit on the next backlog
pass with that analysis in hand; the analyzer itself (pure `detectMarkdownFeatures`) is the
low-risk part — the surfacing UX is the risk.

**Goal.** Detect the Markdown "flavor"/features actually used in a document (or on
import) and suggest turning the matching feature toggles on/off.

**Design sketch (to be refined before building).**
- A pure analyzer `detectMarkdownFeatures(md): DetectionReport` that scans for
  signals: tables (`| … |` + `---|`), footnotes (`[^id]`), task lists (`- [ ]`),
  math (`$…$` / `$$`), fenced diagrams (```mermaid/abc```), front matter (`---`),
  wiki links (`[[…]]`), emoji shortcodes, strikethrough, definition lists, etc.
- Compare the report against current `settings.markdownFeatures`; produce a diff:
  "this document uses X, which is currently disabled — enable it?"
- Surface as a **non-intrusive suggestion** (dismissible toast/banner, or a panel
  in the tray), never an automatic change. One-click "Apply suggestions".
- Trigger points: on import, and on demand (Tools ▸ Detect format).

**Open questions.**
- False positives (e.g. a literal `| pipe` in prose) — need confidence scoring.
- Scope: per-document override vs. global settings change.
- Interaction with the existing `applyFlavor` presets.

**Complexity/risk.** Medium. The analyzer is self-contained and testable; the UX
for suggestions needs care to avoid nagging.

---

## 3. DOCX import → Markdown (on the fly)

**Status.** ✅ **SHIPPED for file import.** `src/store/importExport/docx-import.ts` converts a
`.docx` to HTML with `mammoth`, lazy-loaded in its own chunk; the import loop routes
`.docx` files there before the text path and feeds the result to the ordinary
`html` ingest (sanitise + residual report), for File ▸ Open and for files dropped
on the editor or the Files tab. Best-effort, as sketched below: headings,
emphasis, lists, tables and raster images (inlined as `data:` URIs) convert; Word
equations (OMML), text boxes and complex layout do not. A hostile `.docx` can no
longer stall the tab through mammoth's XML parser (audit A071). URL import does
not convert `.docx` — a fetched one is read as a ZIP archive. The design notes
below are kept as the record of the decision.

**Goal.** Import `.docx` files and convert to Markdown on import. Research-gated —
**skip if too complex.**

**Design sketch.**
- Client-only, so a browser-capable converter is required. Candidate: **`mammoth`**
  (`.docx` → HTML) run in the browser, then feed the HTML through the existing
  ingest → turndown pipeline (`store/importExport/ingest.ts` + `turndown-rules.ts`) to reach
  Markdown/canonical. Lazy-import `mammoth` (like `@zip.js/zip.js`) to keep the
  main bundle small.
- Wire into the existing file-import path (PE) and possibly URL import.

**Open questions / risks.**
- Fidelity: DOCX styles, lists, tables, images (embedded → data URIs?), footnotes,
  equations (OMML → LaTeX is hard). Set expectations: best-effort, lossy.
- Bundle size of `mammoth`; ensure it's lazy + offline-safe (no network).
- Images inside DOCX: extract to data URIs vs. drop.
- **Decision gate:** prototype `mammoth` HTML output quality on a few real docs
  before committing. If OMML/equation/layout fidelity is poor, ship "text + basic
  structure only" or skip.

**Complexity/risk.** Medium-high (fidelity is the risk, not the plumbing).

---

## 4. Multi-column layouts + scientific/research writing (Overleaf-inspired)

**Goal.** Support 2-column and multi-column layouts "in a standard way", and make
the editor a strong tool for scientific/research writing — drawing feature
inspiration from Overleaf (https://www.overleaf.com/) and similar.

**Design sketch (early — needs a dedicated design pass).**
- **Columns**: Markdown has no native multi-column. Options:
  - A fenced/directive block (e.g. `::: columns` / `::: column`) → a TipTap
    `columns`/`column` node, rendered with CSS grid; round-trips via a turndown
    rule. Keeps the source portable-ish (degrades to a labeled block elsewhere).
  - Export-only columns (CSS in the exported HTML/PDF) if in-editor columns prove
    too disruptive to the dual-pane model.
- **Scientific writing features to evaluate (Overleaf-inspired):**
  - Numbered figures/tables/equations with **cross-references** and auto-numbering.
  - **Citations / bibliography** (BibTeX-style source, `[@key]` cite syntax,
    references section) — large; likely its own project.
  - Theorem/lemma/proof environments; captions; labels.
  - Section auto-numbering; a table of contents node.
  - Better equation authoring — ✅ done: Insert ▸ Formula opens an equation dialog
    with a live KaTeX preview (`EquationDialog`, `src/ui/Dialogs.tsx`).
  - Templates (article/report/two-column paper).

**Open questions.**
- How much to keep as portable Markdown vs. app-specific nodes (round-trip cost).
- Print/PDF pipeline for true columns + page layout (current PDF export is
  browser-print based).
- Citation data model and UI is a whole subsystem — scope separately.

**Complexity/risk.** High and broad. Recommend splitting into phases: (a) columns
block, (b) cross-references/auto-numbering, (c) citations/bibliography, each
planned on its own.

---

## External code review (1.77.0) — five findings, all resolved

An outside review of the whole codebase at `2e29275`, briefed with `CLAUDE.md`
and asked to hunt data loss first. It returned five findings, all labelled
"traced through source, not reproduced"; every one was verified here against
the real code, and every fix is covered by a test confirmed to fail before it.

| ID | Severity | Verdict |
|---|---|---|
| K1 (their F001) | High · data-loss | ✅ **RESOLVED (1.77.0)** — active close prompted only on `saveStatus === "editing"`, so the TERMINAL `conflict` and `blocked` states (and `error`/`saving`) fell through to the background-tab branch, which only looks for a cached draft. Ordinary typing never caches one, and the close path — unlike `handleNewDoc` — never calls `flushAndCacheIfDirty`. Closing a document whose save was in conflict therefore discarded live content with no prompt, nothing on disk, nothing cached and history dropped. `saveActiveDoc` resolving is also not proof of a commit, so the post-save branch now checks the resulting status. Since then the prompt also covers the terminal `full` status (audit A086), and `saveActiveDoc` resolves `true` only for a committed write (audit A026). |
| K2 (their F002) | High · data-loss | ✅ **RESOLVED (1.77.0)** — `saveActiveDoc` and `renameDoc` cleared the cached draft unconditionally after their `await storage.list()`. A draft cached by a switch DURING that window belonged to newer content the write never persisted, and deleting it removed the only recovery copy when the later leave-save failed. Both sites now retire a draft only when its JSON equals the canonical that operation actually wrote. |
| K3 (their F003) | High · data-loss | ✅ **RESOLVED (1.77.0)** — returned with no patch and a "repair contract"; implemented here as `_draftBases`. `switchToDoc` rebuilt `activeDoc` by spreading the freshly-read record, so another tab's `updated` became the baseline for a draft written against the older revision: drift collapsed to zero and a conflict the guard had already refused went through on the next save. See the CLAUDE.md invariant. |
| K4 (their F004) | Medium · parity | ✅ **RESOLVED (1.77.0)** — `createEditorClient` filtered inbound messages by ORIGIN only. Two editors embedded on one host page share an origin, so either could resolve the other's pending requests and reach its listeners. Now bound to the iframe's own `contentWindow`. |
| K5 (their F005) | Medium · correctness | ✅ **RESOLVED (1.77.0)** — the core's `openDocument` returns `handleSwitchDoc`'s promise, but the integration handle dropped it, so the bridge replied `{ok:true}` before the switch had hydrated and reported an async failure as success. |

**A test that could not fail, found by the same review and repaired:**
`embed-origin.test.js`'s "ignores messages from an origin other than the
editor's" dispatched `type: "perssonify-editor"` while the wire protocol
constant is `"perssonify"`, so the message was rejected before origin was ever
consulted. Mutation-tested here: with BOTH the origin and source guards
deleted, it still passed. It now varies only the origin, and a positive control
proves the same message is delivered from the allowed one.

**What the review explicitly did not cover** (its own `NOTES.md`): the graph
simulation, camera and label placement; responsive layout and cards drag;
screen-reader and keyboard behaviour across overlays; exhaustive turndown /
round-trip tracing; large import interleavings, snapshot-restore races and
storage migration; service worker, offline and package-tarball behaviour. It
ran nothing — no build, no test, no browser.

## State/sync hardening — deferred findings (from the adversarial sync/state review)

The core data-loss work is shipped as a **phased effort** (see CLAUDE.md "Invariants"):
blank-canonical save backstop; **live-canonical provider** (renameDoc/patchDocById merge
onto live editor content — Phase 1); **switch-generation guard** (Phase 4); and the
**recoverable snapshot net** (Phase 5, sidecar IndexedDB version history). The remaining
findings are lower-severity/narrower and are deferred with notes:

- ~~**Deliberate rename to `Untitled`/`Untitled N` reverts on next save**~~ — **FIXED.**
  `DocumentRecord.titlePinnedByUser` records whether `userTitle` is a genuine rename;
  `resolveDocTitle` honours a flagged pin verbatim and heals only an unflagged legacy
  "Untitled N" pin.
- ~~**`renameDoc` of the ACTIVE doc races autosave**~~ — **FIXED (Phase 1).** `renameDoc`
  (and `patchDocById`) now merge the new title onto the LIVE editor canonical via
  `registerLiveCanonical`, so a rename can't rewind unsaved edits and no longer writes a
  stale independent copy.
- ~~**Rapid A→B→C doc switches can settle on a stale doc**~~ — **FIXED (Phase 4).**
  `handleSwitchDoc` stamps each switch with a monotonic `switchGenRef` and aborts any
  hydration whose generation is stale.
- **Multi-tab** — partly done. A save that would overwrite another tab's newer write
  parks the terminal `"conflict"` status (status bar: "Changed in another tab — not
  saving"); a reload after a conflict keeps the other tab's work (audits A018, A027),
  and rename, card pin/colour and bridge patches respect the conflict (audit A028).
  Live cross-tab refresh is DONE (`store/persistence/tab-sync.ts`, a `BroadcastChannel` with a
  `storage`-event fallback). Still open: the non-IndexedDB fallbacks' `setPrefs` still reads, merges and writes
  across an `await`, so two overlapping calls can drop a key (the IndexedDB adapter
  merges inside one transaction).
- ~~**Minor:** `getMetrics()` returns a fresh object each call~~ — **FIXED**
  (`refreshMetrics` publishes only when `sameMetrics` sees a change). The history-cache
  `undefined`-canonical edge is unreachable: capture always passes the live document's
  JSON and restore is skipped when there is none (the cache itself still hashes
  `undefined` as `""`). The `beforeunload` parked-draft write is covered by the
  synchronous localStorage stash (`src/store/persistence/crash-recovery.ts`, written on
  `beforeunload` and `pagehide`, adopted on the next start; entries carry their base
  revision and conflict flag — audits A018, A027).

### Architectural note — an explicit doc-lifecycle state machine
Both reviewers concluded the recurring data-integrity bug class stems from "the document"
existing as four representations that drift (live editor JSON, `store.activeDoc.canonical`,
the persisted record, the cached draft), coordinated by ~a dozen scattered flags
(`saveStatus`, `hydratedDocId`, `activeDocId` vs `activeDoc.id`, `syncing`, the two hash
sentinels, the debounce refs, `initDoneRef`, `_unsavedEdits`, `_persistedCanonical`).

**Decision (2026-08): do NOT do the FSM rewrite speculatively.** The lifecycle is the
highest-blast-radius code in the app; it is now protected by four prevention/recovery
layers, documented invariants, and a regression suite, and sits at a good risk-adjusted
optimum. Full-document LaTeX and nearly all backlog items are content/engine-layer and do
not push on this layer. A read-only **`getLifecycleState()`** selector (documentStore)
exposes the store-owned flags as one object (`activeDocId`, `hydratedDocId`, `hydrated`,
`saveStatus`, `hasActiveDoc`, `unsavedDraftCount`, `docCount`), and the admin console's
`diag.lifecycle` prints it — the low-risk slice of the maintainability upside — WITHOUT
changing any write path.

**Refactor-on-next-touch trigger.** The two-machine extraction — (a) **editor-occupancy**
`{docId, phase: none|hydrating|hydrated}` mutated only by the hydration ritual, and (b) a
**save** FSM with terminal `blocked`/`conflict`/`full` — was meant for the next substantive
change to this layer. The September 2026 production-readiness fixes were that change
(audits A018, A021, A024, A026, A028, A029, A032, A086) and did not extract the machines;
the terminal `conflict` and `full` statuses shipped without them, and the layer gained more
state (`saveError`, the `schemaLock`, `_draftBases`, `deletingDocs`, a fifth representation
in the unload stash). The remaining natural triggers are live cross-tab invalidation or a
multi-file/Overleaf-style project model; splitting `PerssonifyEditor.tsx` (audit A110) is
the other place it could be folded in. Not speculatively.

## Ported UI/UX audit backlog (v1.70.0 migration)

> Ported from the predecessor repo's `docs/audit/ui-audit-2026-08.md` during the history-clean Markdown Studio migration. That file does not exist here — this document is the surviving record.
> Each entry was independently revalidated against predecessor SHA
> `41e831e44b4a8830168b94d13e74c962e3bb0626`. Fully fixed findings were excluded;
> partial findings remain open. **Ported findings: 53.**
> Composition: **48 A–I findings plus 5 J accessibility findings**, all from that
> source audit.

Fully fixed and not ported: `A2`, `A3`, `A4`, `B1`, `B5`, `C3`, `D2`,
`E1`, `E2`, `E11`, `F1`, `F2`, `F9`, `H3`, `H5`, `I1`.

> **Reading these entries (reconciled 2026-09-29, audit A111).** Each entry's
> **Status** line is the current verdict, re-checked against the code after the
> September 2026 production-readiness audit — which found statuses here that were
> wrong in both directions (items marked RESOLVED that were broken, STALE that were
> present, OPEN that were fixed). The "v1.70.0 revalidation" and "Original
> independently verified finding" blocks are HISTORY: they describe the code at the
> predecessor SHA and are kept for their measurements. Where they disagree with the
> Status line, the Status line wins. For everything the 2026-09 audit found, and for
> what remains before launch, [`audit-2026-09.md`](audit-2026-09.md) is the
> authoritative list.

### A1. Bottom tray collapses both editor panes to zero height

**Priority:** high · **Audit severity:** critical · **Status:** ✅ **RESOLVED (1.75.0)**

The floors alone could not fix this: because the editor's `min-h-[10rem]` is not
shrinkable inside an `overflow-hidden` column, the overflow moved to the tray and
the status bar — the app was clipped rather than the editor zeroed. `trayFits`
(`src/ui/chrome/bottomTray/tray-fit.ts`, unit-tested) now refuses to open the tray, with a toast,
when the region the editor, tray and status bar share is under 280px (the 160px
editor floor plus a nominal 120px tray); both the status-bar chevron and the
links chip consult it, and closing is never blocked. It is a threshold, not an
exact fit — the tray opens at up to `min(35dvh, 16rem)` — so a library mount in a
short container on a tall page can still clip the status bar (unmeasured). In the
standalone app a window under 450px tall now scrolls instead (audit A091).

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** PARTIAL at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`bottomTray/index.tsx:29` now has `min-h-0 max-h-[min(35dvh,16rem)]`; `PerssonifyEditor.tsx:2111` has `min-h-[10rem]`. This prevents disappearance, but the audit’s documented ≤360px residual remains: no refusal/auto-collapse guard exists.

#### Original independently verified finding

**Files:** `src/ui/chrome/bottomTray/index.tsx:28-29`; no floor on the editor column in `src/PerssonifyEditor.tsx`
**Source:** [22]
The tray is `shrink-0 flex h-64 max-h-[35dvh]` and nothing reserves a minimum height for `<main>`. Measured at 740×360: `.cm-scroller` goes 65px → **2px**; at 360×360 → **0px**. The user sees two pane headers stacked with nothing between them — the document is gone and uneditable until the tray is collapsed again.
**Repro:** viewport 740×360 → tap the status-bar `Panel` chevron.
**Fix:** give the editor column a hard floor and make the tray yield:
```
// BottomTray root
"shrink-0 flex h-64 max-h-[min(35dvh,16rem)] min-h-0 …"
// editor column wrapper in PerssonifyEditor
"… flex-1 min-h-[10rem]"
```
plus a guard that refuses to open (or auto-collapses) when the remaining editor height would drop below ~120px.

### A5. Truncated text with no tooltip across five list surfaces

**Priority:** low · **Audit severity:** low · **Status:** PARTIAL (library rows fixed in 1.75.0)

The folder row and BOTH document lists (the tree and the flat search/select list)
carry `title` now — pinned by `truncated-titles.test.js`, which covers both so
the tooltip cannot appear and disappear depending on whether the user has typed
in the search box — and so does the map's details-rail heading. Still clipped
with no tooltip: the link bubble's href (`max-w-[220px]`, `linkBubbleMenu/index.tsx`);
the map's node labels, cut by `truncateLabel` with no SVG `<title>` (the node's
`aria-label` does carry the full name); the Document Links tray's titles and its
one-line context preview (`BacklinksPanel.tsx`); search-result titles
(`SearchPanel.tsx`); and Memory's document titles (`MemorySheet.tsx`).

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

Truncation remains without comprehensive titles: e.g. `FolderTree.tsx:503-512` folder name truncates without `title`; `linkBubbleMenu/index.tsx:44` remains `max-w-[220px]`; audit’s graph/list surfaces remain only partially addressed.

#### Original independently verified finding

**Files:** `src/ui/FolderTree.tsx:503` (folder name), `:659` (doc title); `src/ui/panes/linkBubbleMenu/index.tsx:44,46`; `src/ui/GraphView.tsx:744-753` (node label hard-sliced at 22 chars), `:785` (detail `<h3>`); `src/ui/BacklinksPanel.tsx:86,89,115,131`; `src/ui/SearchPanel.tsx:120`; `src/ui/MemorySheet.tsx:189`
**Source:** [8, 9, 10, 11]
The default (unfiltered) Files tree is the only list without `title=` — the search list has it (`WorkspacePanel.tsx:528`) and the outline has it (`DocNavPanel.tsx:106`), so hovering the same row behaves differently depending on whether you typed in the search box. The backlink **context preview** is the one with real substance: it exists to show *which sentence links here* and single-line `truncate` + no tooltip defeats its only purpose. The link bubble caps the href at `max-w-[220px]` inside a `max-w-[400px]` bubble — 180px of unused room. Graph node labels are sliced in JS with no `<title>` child, so SVG has no tooltip path at all.
**Fix:** add `title=` at each cited line; give the graph node `<g>` a child `<title>{node.title}</title>`; raise the bubble's URL cap to the bubble width; use `line-clamp-2` for the backlink context.

### A6. Export/print CSS lacks `overflow-wrap` and a table wrapper

**Priority:** low · **Audit severity:** low · **Status:** ✅ **RESOLVED (1.76.0)**

`EXPORT_CONTENT_CSS` (`src/store/importExport/import-export.ts`) leaned on `overflow-x: auto`,
which is meaningless on paper — there is nothing to scroll, so an over-wide line
is simply clipped off the page, and exported HTML has the same problem in a
narrow window. Long unbroken strings now have somewhere to break
(`overflow-wrap: anywhere` on `body`, `white-space: pre-wrap` + `word-break` on
`pre`) and a wide table's cells wrap instead of overflowing
(`table-layout: fixed`). Pinned by `backlog-sweep.test.js`.


#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`store/importExport/import-export.ts:43-52`: export CSS has neither `overflow-wrap:anywhere` nor `table-layout:fixed`.

#### Original independently verified finding

**File:** `src/store/importExport/import-export.ts:42-51` (`EXPORT_CONTENT_CSS`, shared by `exportAsHtml:250` and `print-export.ts:32`)
**Source:** [7]
The live panes only wrap because prosemirror-view injects `word-wrap: break-word`; the export stylesheet sets `overflow-wrap: normal` and emits bare `<table>` with no `.tableWrapper` (`styles.css:1269` does not ship to exports).
**Verifier correction — impact is narrow:** at the A4 778px content column, realistic URLs, sha256 hashes, Windows paths and 6-column tables all fit. Only *pathological unbroken tokens* overflow (a 200-char base64 `data:` URI pasted as text → `scrollWidth 2306`; a 150-char nonsense cell → table 1244px). Print cannot scroll, so those cases are silently truncated in the PDF.
**Fix:** one line in `EXPORT_CONTENT_CSS`: `body, p, li, td, th, code { overflow-wrap: anywhere; }` plus `table { table-layout: fixed; }`.

### A7. Menu popups pinned to exactly 200px → wrapped rows on Windows/Linux

**Priority:** low · **Audit severity:** low · **Status:** **OPEN** — the earlier "STALE" verdict misread the code (audit A111)

That verdict read `min-w-[200px]` in isolation. The popup's width comes from the
primitive's `w-(--anchor-width)` (`src/components/ui/dropdown-menu.tsx`) — the
~40px trigger — which the minimum only raises to 200px, and `overflow-x-hidden`
then stops content widening it: every top-level menu is a fixed box of
max(trigger width, 200px), and a longer row wraps (View ▸ "Toggle workspace
panel" + `Ctrl+Shift+D` on Windows/Linux). Fix: `w-auto` at the call site in
`menuBar/index.tsx` — tailwind-merge lets it replace the primitive's width, and
`src/components/ui` is generated, not hand-edited.


#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`components/ui/dropdown-menu.tsx:42` still forces `w-(--anchor-width)` and `overflow-x-hidden`.

#### Original independently verified finding

**Files:** `src/components/ui/dropdown-menu.tsx:42` (`w-(--anchor-width) … overflow-x-hidden`), `src/ui/chrome/menuBar/index.tsx:106` (`min-w-[200px]`)
**Source:** [12]
`--anchor-width` is the ~38px "File" button, floored to 200px, and `overflow-x-hidden` means no item can ever widen it. With `displayKeys()` expanding ⌘⇧D → `Ctrl+Shift+D`, the View menu's "Toggle workspace panel" row is 47px tall (two lines) next to 27px siblings. Text wraps, it is not clipped.
**Fix:** drop `w-(--anchor-width)` from the menu popup base class (it belongs to Select-style anchored popups), keeping `min-w-32`; or add `w-auto` at the call site.

### A8. Menu-bar document title clips tall diacritics

**Priority:** low · **Audit severity:** low · **Status:** ✅ **RESOLVED (1.76.0)**

The title used `leading-none`, which makes the line box exactly the font size —
so with `truncate`'s `overflow: hidden` the top pixel of a stacked diacritic (Ẫ,
Ẵ) was clipped (descenders were measured unclipped). `leading-tight` gives it the
pixel of leading it needed.


#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`menuBar/index.tsx:587` still uses `truncate text-[13px] ... leading-none`, not `leading-tight`.

#### Original independently verified finding

**File:** `src/ui/chrome/menuBar/index.tsx:544` (`truncate text-[13px] leading-none`)
**Source:** [16]
`line-height:1` = 13px on a 15px glyph box under `overflow:hidden`.
**Verifier correction:** the "descenders are cut" half of the original claim is **false** — measured baseline 11px + descent 2px = exactly 13px, `clippedBottomPx 0`, and g/j/p/y are pixel-identical with overflow visible. Only the **top** clips, ~1px, and only for stacked diacritics (Ẫ, Ẵ). Also note `scrollHeight 15` is reported even for "Welcome", so scrollHeight≠clientHeight is not itself evidence of clipped ink.
**Fix:** `leading-none` → `leading-tight` on that span.

### A9. Stacked-split second pane header wastes 44px of `pl-11`

**Priority:** low · **Audit severity:** low · **Status:** **PARTIAL** — the 1.76.0 fix left a gap (reconciled 2026-09)

The 44px of left padding exists to clear the floating workspace trigger, which is
absolutely positioned at the EDITOR's top-left — so exactly one header sits under
it. It was applied to both, spending 44px of the second pane's width on a phone,
which is where width is scarcest and where the panes stack so the second header
is nowhere near the trigger. `PaneHeaderProps.clearsTrigger` now marks the
Markdown pane's header — the one under the button in Markdown and Split views.
What remains: the flag is hard-wired to that pane, while the button sits over
whichever header is top-left. In Rich-text-only view the Markdown pane is hidden,
the rich header is top-left with `pl-4`, and below 768px its icon sits under the
reopen button whenever the panel is closed (the phone default). The flag should
follow the visible top-left pane. (At 768px and up no header clears the button —
`md:pl-4` — which predates this fix.)


#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`editorPanes/index.tsx:26-28` retains unconditional `pl-11` for every pane header; no per-pane `needsTriggerClearance` logic.

#### Original independently verified finding

**File:** `src/ui/panes/editorPanes/index.tsx:28`
**Source:** [30]
`pl-11` clears the floating reopen button (`PerssonifyEditor.tsx:2101`), which exists only over the *first* pane and only when the panel is closed. Both stacked headers pay for it.
**Verifier correction:** the claimed knock-on clipping does **not** occur — at 360×640 and 740×360 both headers measure `clientWidth == scrollWidth` and the right-hand controls end at x=344/360. Purely dead space.
**Fix:** pass a `needsTriggerClearance` prop; default the rest to `pl-4`.

### B2. Toasts cover the status bar on phones

**Priority:** medium · **Audit severity:** medium · **Status:** **OPEN** — fixed on desktop only (reconciled 2026-09)

`<Toaster position="bottom-right" offset={48} …>` lifts a desktop toast clear of
the status bar. But at 600px wide and below, sonner positions the toaster from
`mobileOffset`, which defaults to 16px when not given — so on a phone, the case
this finding measured, a full-width toast still lands on the 36px coarse-pointer
status bar. Needs `mobileOffset={{ bottom: … }}` clearing the bar plus the
safe-area inset, and a phone-width measurement: the browser case below runs only
at 1440x900, and `backlog-sweep.test.js` only checks that `offset=` is set.

Measured rather than reasoned about, in `e2e/cases/surfaces-deep.mjs`: a settled
toast at 1440x900 sits at bottom 852 against a status bar whose top is 872. The
case has to wait for the toast to come to REST — sonner animates it in from below
the viewport, and a first attempt read it mid-flight at bottom 884, reporting an
overlap that does not exist. Mutation-tested by restoring sonner's default 24px
offset, which puts the toast's bottom at 876 and turns the case red. Nothing
measures a phone, where `offset` does not apply.


#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`PerssonifyEditor.tsx:2275` renders `<Toaster position="bottom-right" ...>` with no offset/mobileOffset.

#### Original independently verified finding

**File:** `src/PerssonifyEditor.tsx:2044` (`<Toaster position="bottom-right" …>` with no `offset`/`mobileOffset`)
**Source:** [19]
Sonner goes full-width under 600px at z-index 999999999. At 390×844 the toast is `[16,775,358,54]` vs footer top 808 — the tray chevron, links chip and graph toggle all test `covered:true`. On desktop it is a 5px sliver, harmless.
**Verifier correction:** *not* persistent — `useToast().show` hard-codes `duration = 3000` (`src/ui/Toast.tsx:17-20`) and no call site overrides it, so this is a ~3s transient, and it needs a coarse pointer (36px footer).
**Fix:** `<Toaster … offset={{bottom:40}} mobileOffset={{bottom:52}} />`.

### ~~B3. Graph detail panel swallows the canvas on short viewports~~ (RESOLVED in v1.71.0)

**Priority:** ~~medium~~ · **Audit severity:** medium · **Status:** **RESOLVED**

#### v1.71.0 resolution

The finding is gone because the thing it described is gone. The inspector is no
longer an absolutely-positioned card over the canvas: the map is three **docked**
flex regions — header, map + footer strip, details rail — and the rail is a right
column on `lg+` or a docked bottom sheet below that. Nothing floats over the
canvas, so there is no card to span the viewport and nothing for the ghost-target
control to collide with (the floating chip, the floating zoom badge and the
floating hint card were all removed; map chrome lives in one footer strip).

The underlying defect was worse than the audit could see from the outside: the
camera fitted content to the **full canvas rect** while the card covered part of
it, so the map deliberately centred itself *underneath* the panel. The map pane
now measures only its own box, which makes fit and focus correct by construction.

Do not re-add an overlay over the canvas. See
[features.md#17-knowledge-graph-the-relationship-map](features.md#17-knowledge-graph-the-relationship-map).

#### Original independently verified finding (kept for the record)

**File:** `src/ui/GraphView.tsx:784` (`absolute bottom-4 left-4 right-4 … md:left-auto md:w-72`), `:777` (ghost-target chip, same `bottom-4 left-4`, `z-10`)
**Source:** [25, 21]
At 740×360 the canvas is ~156px of usable height and the detail card measures top 191 → bottom 316 — the selected node and its label are entirely hidden behind the card. The card is auto-populated on open (active doc is preselected), so this is the default state.
**Second manifestation (narrow):** below `md`, the `z-10` ghost-target chip stacks on top of the card and eats the left ~48% of the **Focus** button — clicking Focus toggles ghost targets instead.
**Verifier caveat:** the chip is only reachable via the health chips, which are `display:none` below `md` (confirmed computed `none` at 740×360), so the collision only materialises if the window is *resized down* after enabling it — a genuine but narrow path.
**Fix:** give the card `max-h-[40dvh] overflow-y-auto` and a `(max-height: 480px)` rule that docks it right at a fixed width instead of spanning full width; move the ghost chip to `top-14 left-3 md:bottom-4 md:top-auto` and give the card `z-20`.

### B4. Toast close button renders outside the toast

**Priority:** low · **Audit severity:** low · **Status:** ✅ **RESOLVED (1.76.0)** — the overhang is sonner's deliberate corner placement; the real defect, a 20x20 target, is padded to 26x26

The finding as recorded is literally true and is NOT a defect. Measured in a real
browser (`e2e/cases/surfaces-deep.mjs`): sonner straddles the close button across
the toast's top-left corner with `translate(-7px, -7px)`, deliberately. The button
came back fully on-screen, `opacity: 1`, labelled `Close toast`, and hit-testing
to itself at its own centre. Nothing floats over the document and nothing is
clipped; the audit's screenshot-derived "~30% outside the card" is the intended
overhang.

What IS a defect is the size, which the audit did record and did not flag: 20x20,
against WCAG 2.5.8's 24x24 minimum, on the one control whose entire job is
dismissing something that covers the app. Fixed in `styles.css` with a `::before`
rather than by resizing the button — sonner positions the button FROM its own box,
so changing that box moves the glyph — exactly as `DIVIDER_HIT_AREA` does for the
resize separators. The prescribed `closeButton` classNames override was not
applied: it would move a control that measurement says is fine.


#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`components/ui/sonner.tsx:39-43` provides only `toast: "cn-toast"`; no `closeButton` class override/inside positioning.

#### Original independently verified finding

**Files:** `src/PerssonifyEditor.tsx:2148` (`closeButton`), `src/components/ui/sonner.tsx` (overrides `classNames.toast`, never `closeButton`)
**Source:** [112]
Measured: toast `[900,722.5,356,53.5]`, close button `[894,716.5,20,20]` — ~30% of it outside the card, `bg rgb(236,253,243)` on a `rgb(250,249,246)` page. Reads as a rendering artefact floating over the document; on 390px it overlaps paragraph text.
**Fix:** add a `closeButton` entry to `toastOptions.classNames` positioning it inside the card (`--toast-close-button-start:auto; --toast-close-button-end:0`) with `bg-popover border-border`.

### C1. Split scroll-sync misses setext and blockquote headings

**Priority:** high · **Audit severity:** high · **Status:** ✅ **RESOLVED (1.75.0)**

The markdown side asks CodeMirror's parse tree (`markdownHeadings`,
`src/ui/panes/editorPanes/scroll-anchors.ts`) instead of scanning lines, so setext, blockquoted and
list-nested headings are collected like the rich side's rendered `h1`-`h6`. It
also retires the hand-rolled fence tracker and picks up a case neither had:
indented code blocks, whose `#` lines the old scanner counted as headings.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** PARTIAL at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`editorPanes/index.tsx:389-452` now ignores fenced code and pairs anchors by normalized heading text rather than array index, fixing the audit's primary drift path. The Markdown-side scanner at `:404` still accepts only ATX headings matching `^#{1,6}\s+`; setext headings (`===` / `---`) and blockquote headings (`> # Heading`) are omitted while the rich pane includes their rendered `h1`–`h6` elements. Those unmatched anchors are skipped, so interpolation can still span across real headings.

#### Original independently verified finding

**File:** `src/ui/panes/editorPanes/index.tsx:385-412`
**Source:** [1]
The original implementation detected Markdown headings with a raw `^#{1,6}\s` line regex, collected rendered rich-pane `h1..h6` nodes, and paired the arrays by index. A `# comment` inside fenced code shifted every later pair; setext headings and blockquote headings also existed only on the rendered side.

**Fix:** derive the Markdown anchor list from the CodeMirror syntax tree (`ATXHeading1..6`, setext headings, and blockquote-contained headings) and continue matching normalized heading text while dropping only genuinely unmatched anchors.

### C2. Workspace width clamp is an absolute 720px with no viewport awareness

**Priority:** high · **Audit severity:** high · **Status:** **PARTIAL** — one path remains (reconciled 2026-09)

The load-time clamp had already closed the localStorage-poisoning path (this
entry was stale on that). The live path — resize the window and the panel keeps
its old width — is closed, while the panel is open, by a `resize` listener re-applying the current width
through the existing setter, so there is no second copy of the bounds. Those
bounds are exported (`DOCNAV_WIDTH_MIN`, `docNavWidthMax()`) and feed the
separator's `aria-valuemax`, which would otherwise report a flat 720. What
remains: the listener exists only while the panel is mounted and nothing
re-clamps on mount, so narrowing the window while the panel is closed and then
reopening it brings the panel back at its old stored width (up to 720px) beside a
squeezed editor until the next resize.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** PARTIAL at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`uiStore.ts:256-266` now applies a viewport-relative clamp. But no resize listener re-applies `setDocNavWidth` when a persisted wide-panel value meets a later narrow viewport.

#### Original independently verified finding

**File:** `src/store/preferences/uiStore.ts:256-259` — `Math.min(720, Math.max(240, Math.round(value)))` ✅ verified in tree
**Source:** [3]
The comment claims the clamp stops the panel eating the editor; 720 is compared against nothing, and the docked layout starts at `md` = 768px. At an 800×700 viewport with the persisted value: `aside` 720px, `<main>` **80px**, `.cm-editor` **40px** — one character per line. The value is in localStorage, so sizing the panel on a wide monitor poisons every later narrow-window session, with no visible cause.
**Fix:** make the clamp viewport-relative *at apply time*:
```js
const max = Math.max(240, Math.min(720, (typeof window !== "undefined" ? window.innerWidth : 1280) - 420));
const w = Math.min(max, Math.max(240, Math.round(value)));
```
and re-clamp on read: a `resize` listener in `WorkspacePanel` calling `setDocNavWidth(docNavWidth)` is enough since the setter re-clamps.

### C4. Find/Replace scrollbar match ticks freeze at stale pixel positions

**Priority:** medium · **Audit severity:** medium · **Status:** ✅ **RESOLVED (1.75.0)**

The panel observes the pane it points at — a MutationObserver for edits and a
ResizeObserver for the `scrollHeight` baked into every fraction — and bumps a
revision the marker effect depends on. Both are needed: an edit can move matches
without changing the height, and a reflow can change the height with no edit.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`FindReplace.tsx:940-964` marker effect still depends on `matchCount` and stable callbacks, not document revision or scroller-height changes.

#### Original independently verified finding

**File:** `src/ui/FindReplace.tsx:937` (`lineBlockAt(m.pos).top / H`), `:952` (dep array)
**Source:** [5]
Every dep is a persisted option or an identity-stable `useCallback` except `matchCount`. Editing *above* the matches moves them without changing the count, so neither the positions nor `H = scrollHeight` are recomputed.
**Measured:** 3 matches at 18.69% / 57.94% / 97.20% of a 2568px doc; after inserting 30 lines at the top (count still 3, scrollHeight 3288) the ticks were unchanged while the real fractions were 36.86% / 67.52% / 98.18% — the first tick is **18.2 percentage points**, ~148px, wrong.
**Fix:** add a document revision to the deps (`view.state.doc.length` or the transaction counter) and re-run when the pane's `scrollHeight` changes, since `H` is baked into the fraction.

### C5. "Reading width" Narrow/Medium/Wide is inert in the default split layout

**Priority:** medium · **Audit severity:** medium · **Status:** **PARTIAL** — the recorded case is still inert (reconciled 2026-09)

The options are character measures (65/80/100) emitted as `ch`, so they scale
with the font-size preference and bind wherever the pane is wider than the
measure — a pixel cap was the wrong unit for a reading measure regardless of where
it was applied. Stored px values migrate (`migrateReadingWidth`). The case this
entry recorded is still inert: in the default layout (Split, workspace panel open)
at 1280px each pane's text column is about 440px, narrower than even Narrow's 65ch
(roughly 500–600px at the default 15px font), so Narrow, Medium and Wide render
identically to Full there. The control is not disabled; its description only
warns that it may have no visible effect. Exact thresholds need a browser
measurement.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`editorPanes/index.tsx:523-527` still translates reading widths into fixed px `--reading-width`; `SettingsSheet.tsx:304` still persists/selects those values. No relative-width or unavailable-state behavior.

#### Original independently verified finding

**Files:** `src/ui/SettingsSheet.tsx:294-296` (640/800/1000 px options), `src/ui/panes/editorPanes/index.tsx:489`, `src/styles.css:612`
**Source:** [103]
At 1280×800 in Split with the panel open, after choosing Narrow: `{pm: maxWidth "640px", width 442}`, `{cm: maxWidth "640px", width 420}` — the cap is 45% wider than the column, so it never binds. All three options are indistinguishable from "Full" below ~1320px, i.e. the default layout. The segment highlights and persists, so the control looks functional.
**Fix:** express the options relatively (`65ch` / `80ch` / `none`), and/or disable the group with a hint when the pane is already narrower than the smallest option.

### D1. `prefers-reduced-motion` is honored nowhere

**Priority:** high · **Audit severity:** high · **Status:** ✅ **RESOLVED (1.75.0)**

**This entry named the wrong code.** The graph's 450ms camera move is an inline
CSS *transition*, which the stylesheet's `transition-duration: 0.01ms !important`
already beat. What genuinely ignored the preference is the force SIMULATION,
which advances node positions from rAF where no stylesheet can reach it; it now
settles in one step under the preference. The stylesheet's own comment claimed a
JS gate existed when none did, and has been corrected. Explicit
`behavior: "smooth"` scrolls (outline and heading jumps, the Help page's section
links) also ignored the preference — the CSS guard only decides what `"auto"`
means — until audit A096 routed them through `scrollBehavior()`
(`src/utils/reduced-motion.ts`).

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** PARTIAL at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`styles.css:1414-1427` now supplies the global reduced-motion guard. But `GraphView.tsx:269,292,308,713` still enables a 450ms JS camera transform via `camSmoothRef` with no reduced-motion media-query gate.

#### Original independently verified finding

**Files:** `src/styles.css` (0 occurrences ✅ verified), `tw-animate-css` (0 occurrences), built CSS (0 occurrences)
**Source:** [32]
Confirmed at runtime with Chromium `reducedMotion:'reduce'`: `matchMedia(...).matches === true` while `toolbarTransition "0.3s"`, `bodyTransition "0.3s, 0.3s"`, and opening a menu still yields running animations. Affected: boot-splash `animate-pulse` (`PerssonifyEditor.tsx:1824`), autosave spinner + pulsing text (`statusBar/index.tsx:181-182`), infinite `animate-bounce` on the library drop overlay (`WorkspacePanel.tsx:386`), every `animate-in fade-in zoom-in-95` menu/dialog/bubble/page, the 200ms `pf-mode-fade` (`styles.css:1182-1186`), the 450ms graph camera fly (`GraphView.tsx:632`), the 500ms ad slide (`AdUnit.tsx:137`), the 200ms tour spotlight glide, scrollbar-thumb `scale(1.1)`, and all sonner motion.
**Fix:** global guard at the end of `styles.css`:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important; animation-iteration-count: 1 !important;
    transition-duration: .01ms !important; scroll-behavior: auto !important;
  }
  .pf-mode-fade { animation: none !important; }
}
```
Plus the two JS motion sites CSS can't reach: gate `camSmoothRef.current = true` (`GraphView.tsx:255,278,294`) on the media query, and swap `animate-pulse`/`animate-bounce` for static states where the element conveys status.

### D3. Theme switch renders as ~5 stuttered steps; the page background can't transition at all

**Priority:** medium · **Audit severity:** medium · **Status:** ✅ **RESOLVED (1.75.0)**

Resolved by making the swap atomic rather than by making everything animate: a
partial fade is what read as stuttering, and fading every descendant would mean a
transition on everything. next-themes' `disableTransitionOnChange` in both shells;
the `transition: background-color` that could never reach a `background-image`
gradient is gone.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`styles.css:505-515` still transitions `background-color` while rendering the page background through `--noise-bg`; CodeMirror still sets `transition: "background-color 300ms, color 300ms"` at `codeMirrorPane/index.tsx:209,237`; root still has `transition-colors duration-300` at `PerssonifyEditor.tsx:2022`.

#### Original independently verified finding

**Files:** `src/styles.css:513-514` (`body { transition: background-color 300ms, color 300ms }` over a gradient `--noise-bg`), `src/PerssonifyEditor.tsx:1833`, `src/ui/panes/codeMirrorPane/index.tsx:208,236`, `src/ui/chrome/toolbar/index.tsx:598`, `src/EditorHeader.tsx:10`
**Source:** [34, 38]
Two compounding defects:
- **The declared transition on `body` is a no-op.** The page surface is a `linear-gradient` background *image*; `getComputedStyle(document.body).backgroundColor === "rgba(0,0,0,0)"`, and `background-image` is neither in the transition list nor interpolable. So the outermost layer hard-cuts in one frame while everything layered on top fades for 300ms — the opposite of the intent.
- **The 300ms paint-bound fade competes with a 622ms main-thread block.** Instrumented on the real path (View ▸ Appearance ▸ Light): longtasks `[146,74,56,56,78,52,57,51,52]` = 622ms across 9 tasks; **8 frames in the first 500ms**; frame deltas include 153ms and 135ms stalls. The 300ms transition resolves in 5 painted colour steps.
**Fix:** the honest option is (a) drop the fade — remove `transition: background-color 300ms, color 300ms` from `styles.css:514` and `cmTheme()` at `:208`/`:236`, and drop `transition-colors duration-300` at `PerssonifyEditor.tsx:1833` — so the swap is one clean frame. If it is kept, give `body` a real `background-color: var(--background)` so the declaration has a target, and schedule `setTheme` behind `startTransition`/rAF so the React + Tiptap/CodeMirror theme work isn't in the same frame. Separately, narrow `transition-all duration-300` (`toolbar/index.tsx:598`, `EditorHeader.tsx:10`) to an explicit property list.

### D4. Exiting Focus mode un-dims the chrome asymmetrically

**Priority:** medium · **Audit severity:** medium · **Status:** ✅ **RESOLVED (1.75.0)**

The `transition` was declared inside the `.pf-focus` rule, so it existed only
while the class did. It now sits on the unqualified selectors, with only
`opacity: 0.25` under `.pf-focus`.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`styles.css:1193-1199` puts `transition: opacity 200ms` only in `.pf-focus ...`; no corresponding base transition exists for symmetric exit.

#### Original independently verified finding

**File:** `src/styles.css:1192-1199` (transition declared *inside* `.pf-focus`), colliding with `src/ui/chrome/toolbar/index.tsx:598` `transition-all duration-300`
**Source:** [35]
On class removal each element falls back to its own declaration: the menu bar and pane headers have `0s`, the footer has `transition-colors` (no `opacity`), and only the toolbar animates. Measured after removing `.pf-focus`: +30ms `{menubar:1, toolbar:0.255, footer:1, pane:1}`, +100ms `{toolbar:0.593}`, +300ms all 1. Entering fades all four together, so exit is visibly torn — a ghosted strip in the middle of the chrome for a third of a second.
**Fix:** move the transition to a base rule so it applies in both directions and keep only `opacity: .25` inside `.pf-focus`:
```css
[data-tour="menubar"], [data-tour="toolbar"], [data-pane-header], footer { transition: opacity 200ms ease; }
```
plus narrow the toolbar to `transition-colors duration-300`.

### D5. Graph search/filter dimming never applies to edges

**Priority:** medium · **Audit severity:** medium · **Status:** **PARTIAL** — ghost links are never dimmed (reconciled 2026-09)

Edges are dimmed alongside nodes in `GraphView.tsx` — `const dim = anyFilter &&
(!isVisible(edge.source) || !isVisible(edge.target))` — and the edge path no
longer carries an opacity utility, so `opacity={dim ? 0.07 : 1}` takes effect. The
broken-link ghost stubs the finding also cited have no dimming at all: with "Show
on map" on, a search or Isolate leaves the amber stubs and labels of hidden notes
at full strength. No test covers edge dimming.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`GraphView.tsx:761-775` still sets edge opacity through a Tailwind class and separately sets presentation `opacity={dim ? 0.08 : undefined}`, which loses to the class.

#### Original independently verified finding

**File:** `src/ui/GraphView.tsx:673` (also the ghost links at `:691`)
**Source:** [4]
```jsx
className={hot ? "stroke-primary opacity-90" : "stroke-border/50 opacity-50"}
opacity={dim ? 0.08 : undefined}     // presentation attribute — always loses to the class
```
Typing in the graph search dims non-matching **nodes** to 0.12 (their `<g>` has no opacity class) but leaves every edge at 0.5/0.9. Measured: `getComputedStyle(line).opacity === "0.9"` while `line.getAttribute('opacity') === "0.08"`. The filter reads as half-broken.
**Fix:** move the dim into the class and delete the attribute:
```jsx
className={cn(hot ? "stroke-primary" : "stroke-border/50", dim ? "opacity-[0.08]" : hot ? "opacity-90" : "opacity-50")}
```

### D6. Bottom tray opens with a 245px instant layout jump

**Priority:** low · **Audit severity:** low · **Status:** ✅ **RESOLVED (1.75.0)**

Animated `grid-template-rows` 0fr ↔ 1fr, which keeps the documented "collapsed
costs zero vertical space" invariant. The trade is that the active tab's content
stays mounted while collapsed.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`bottomTray/index.tsx:25-29` still conditionally mounts the tray and gives it `h-64`; no mounted grid-row animation.

#### Original independently verified finding

**File:** `src/ui/chrome/bottomTray/index.tsx:25` (`if (!open …) return null`), `:28` (`h-64`)
**Source:** [37]
Measured at 1100×700: `[data-tour="editor"]` height 500 → 255 within 30ms, `document.getAnimations()` empty. The reader's text jumps out of view with no motion cue, while every other expandable surface animates.
**Fix:** keep the node mounted and animate `grid-template-rows`: outer `grid shrink-0 transition-[grid-template-rows] duration-200 ease-out` with `style={{gridTemplateRows: open ? "1fr" : "0fr"}}`, inner `min-h-0 overflow-hidden` wrapping the existing panel. Keep the `tabs.length === 0` early return. Covered by the D1 guard.

### E3. Documented format shortcuts are dead or wrong in the rich pane

**Priority:** high · **Audit severity:** high · **Status:** ✅ **RESOLVED**

**Resolved (1.74.0).** The formatting chords moved ABOVE the `tiptapHasFocus`
early return in `useKeyboardShortcuts.ts`; every branch preventDefaults and
dispatches, so TipTap's own keymap never also fires and the command applies
exactly once through the choke point that carries the read-only and composition
guards. ⌘⇧9 is blockquote as documented (TipTap binds it to `toggleTaskList`),
and `indent`/`outdent` now exist on the Markdown side — **scoped**, by
`mdIndentable`, to list lines and lines inside a fenced block, because four
leading spaces on a paragraph is an indented code block, not an indented
paragraph. On the rich side the item type comes from the selection, so indent
also works inside a checklist (`taskItem`), which hardcoding `listItem` had left
dead. `keyboard-shortcuts.test.js`
drives the rich-pane branch — every earlier test passed `{ current: null }`, so the
early return that decided the fate of half these shortcuts never once executed.
Since audit A025 these chords act only with the caret in a pane and the Editor view
on screen, and since A052 AltGr input is never treated as a chord.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`useKeyboardShortcuts.ts:96-99` still returns on TipTap focus **before** shortcut dispatch branches at `:115-138`; rich-pane documented formatting remains unreachable/wrong.

#### Original independently verified finding

**Files:** `src/hooks/useKeyboardShortcuts.ts:92-95` (`if (tiptapHasFocus) { …; return; }` ✅ verified) fronting `:110-134`; `src/formatting/useFormatDispatcher.ts:462` (`default:` warn, no MD `indent`/`outdent`); advertised at `src/data/shortcuts.ts:69,70,77,78,80,81,82`
**Source:** [41, 54, 40, 55]
Everything after line 92 that TipTap does not coincidentally bind is inert with the rich pane focused. Measured per-combo against a `PROBE` paragraph (each in a fresh page, diffing `.ProseMirror.innerHTML`):

| Documented | Rich pane | Why |
|---|---|---|
| ⌘⇧1–6 Heading | **no-op** | TipTap binds `Mod-Alt-N` |
| ⌘⇧0 Normal text | **no-op** | TipTap binds `Mod-Alt-0` |
| ⌘⇧X Strikethrough | **no-op** | TipTap binds `Mod-Shift-s` |
| ⌘⇧H Highlight | **no-op** | no Highlight extension exists (it's a `textStyle` attr) |
| ⌘] / ⌘[ Indent | **no-op in BOTH panes** | rich: unreachable; MD: `Unknown MD command: indent` |
| ⌘⇧9 Blockquote | **inserts a task list** | `@tiptap/extension-list` binds `Mod-Shift-9` |

All of these work in the Markdown pane, so the feature looks randomly broken. Alignment (⌘⇧L/E/R/J) and ⌘⇧7/8 survive only because TipTap happens to bind them — they are below the same early return.
**Fix:** move the shift-combo / heading / highlight / strike / indent block **above** the `tiptapHasFocus` return (it already routes through `dispatch`, which targets the correct pane), keeping the early return only for bindings TipTap genuinely owns (⌘B/I/U/E, ⌘Z). Add `indent`/`outdent` cases to `dispatchToMd`. Then either re-document ⌘⇧9 as Task list and give Blockquote ⌘⇧B, or intercept before the list keymap — but `shortcuts.ts:81` must end up agreeing with observed behaviour.

### E4. Full-screen overlays never take focus, never trap it, and don't inert the background

**Priority:** high · **Audit severity:** high · **Status:** ✅ **RESOLVED (1.75.0 revalidation)**

**Resolved, and two of this entry's four prescriptions are now WRONG.** The
workspace overlay focuses itself when it opens, sets `inert` on every sibling of
the overlay inside `<main>` (which is the editor), and restores focus to the
trigger on close; `PageChrome` does the same plus `role="dialog" aria-modal="true"`.
Escape is no longer a capture-phase force-close: since audit A057 the map and
Cards each handle it in the bubble phase through `overlayShouldHandleEscape`
(`src/ui/overlay-escape.ts`) — only when it was pressed inside the overlay or with
nothing focused, and no dialog, menu or listbox outside it is open — so a delete
confirmation, a rename box or a menu keeps its own Escape.

The two that must NOT be implemented: **"trap focus while open"** and
**`aria-modal` on the workspace overlay**. `CLAUDE.md` records that both were
deliberately removed — the overlay covers `<main>` only, so the menu bar,
workspace panel and surface switcher beside it are meant to stay reachable, and
`aria-modal="true"` told screen readers to ignore exactly those controls. This
entry was followed verbatim once during planning and would have undone a
deliberate decision; it is left here with that warning rather than deleted.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** PARTIAL at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`PerssonifyEditor.tsx:1981-2005` focuses the overlay and capture-handles Escape; `:2146-2153` gives dialog/aria-modal semantics. But no focus trap and no `inert`/`aria-hidden` background editor shell exist.

#### Original independently verified finding

**Files:** `src/PerssonifyEditor.tsx:2034` (graph wrapper), `:2045` (cards); `src/ui/GraphView.tsx:380` (`if (e.key !== "Escape" || e.defaultPrevented) return`); `src/ui/pages/PageChrome.tsx:22,31`
**Source:** [43, 44, 53]
Three linked failures:
- **Escape is inert.** ProseMirror marks Escape `defaultPrevented` before it bubbles (instrumented listeners from `.ProseMirror` to `window` all report `dp=true`; with CodeMirror focused it is `false`). Measured: after ⌘⇧G, `esc1 → open? 1`, `esc2 → open? 1` — yet the Back button is titled "Back to editor (Esc)". Escape works only after clicking the graph's search box. Same on `/help`.
- **Focus never enters.** After ⌘⇧G `document.activeElement` is still `.ProseMirror` behind the opaque overlay; 14 Tab presses landed only on invisible covered content (`Task item checkbox…`, `Math: E = mc^2`, `Edit`, `Copy code`) and never on the graph's search box, zoom buttons, chips, nodes or Back button. Identical for ⌘⇧K.
- **Interior pages leave the editor live.** On `/help`, 36 of 40 tab stops resolve *outside* the overlay; `document.querySelector('.ProseMirror').closest('[inert],[aria-hidden="true"]')` is `null`. Because the page renders after the editor in DOM order those ~40 stops come **first**, and activating one (Enter on Bold) mutates the invisible document — a functional hazard, not just noise. Screen-reader heading navigation hits the welcome doc's 13 headings before the page's own H1.
**Fix:** on mount, focus the overlay container (`tabIndex={-1}` + `.focus()`) or its first control, trap focus while open, set `inert` + `aria-hidden="true"` on the editor shell whenever `route !== "editor"` or an overlay is open, restore focus to the trigger on close, and give `PageChrome` `role="dialog" aria-modal="true"`. Focusing the overlay alone also fixes Escape; additionally scope the `defaultPrevented` guard to "is a modal dialog open" or listen in capture phase on `window`.

### E5. Divider drags survive `pointercancel`, and the mobile divider is a 4px `touch-action:auto` strip

**Priority:** high · **Audit severity:** high · **Status:** ✅ **RESOLVED (1.75.0)**

Both separators share one hook (`use-divider-drag.ts`) using pointer CAPTURE
rather than window listeners, so `pointercancel` and `lostpointercapture` end the
drag by construction; `pointerId` is still checked, since capture does not stop a
second pointer reaching the element. `touch-none` closes the same bug from the
other end — the reclaim that fires the cancel — and a `pointer-coarse:` `::before`
gives a ≥24px hit area without touching the separator's own box.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`editorPanes/index.tsx:285-300` and `WorkspacePanel.tsx:153-168` attach only `pointermove`/`pointerup`, not `pointercancel`; pane divider remains `h-1/w-1` without `touch-none` at `editorPanes/index.tsx:546-564`.

#### Original independently verified finding

**Files:** `src/ui/panes/editorPanes/index.tsx:293-300` (only `pointermove`/`pointerup`), `:509-518` (separator, no `touch-action`), `:517`/`:525` (`h-1` / 6px pullout); `src/ui/WorkspacePanel.tsx:143-159` (same omission)
**Source:** [45, 84, 46]
`GraphView.tsx:507` is the only place in the repo that registers `pointercancel`, and `touch-action` appears exactly once (`GraphView.tsx:613`).
**Measured stuck drag (1280×800):** `pointerdown` → `pointercancel` (no `pointerup`) leaves `document.body.style = {userSelect:"none", cursor:"col-resize"}` permanently, and the divider then tracks the bare pointer — a single subsequent `pointermove` with a **different** pointerId moved it from x=932 to x=505 and panes from `[640,4,636]` to `[300,4,976]`. Until some unrelated click fires `pointerup`, no text anywhere in the app can be selected and the split thrashes with the mouse.
**Why it fires in practice:** stacked on a phone the separator is `390×4` with `touchAction: 'auto'`, so the browser reclaims the gesture as a scroll — which is exactly the `pointercancel` path. It is also a 4px target against a 44/48px minimum.
**Fix:** in both files add `window.addEventListener("pointercancel", stopDrag)` (removed in `stopDrag`), or better `setPointerCapture` + `lostpointercapture`; add `touch-action: none` (`touch-none`) to both separators; give the separator a ≥24px transparent hit area on coarse pointers (`pointer-coarse:h-6 -my-2.5` with the visible 4px line as a child/pseudo-element).

### E6. Dropping a file anywhere except the Files tab silently does nothing

**Priority:** medium · **Audit severity:** medium · **Status:** **PARTIAL** — the panes and the Files tab only (reconciled 2026-09)

`EditorLayout` carries `onDragOver`/`onDrop` routing to PE's
`handleFileDropImport`, so a file dropped on either pane imports instead of
navigating the tab away — which was the more serious half of this, since that
navigation took the current autosave window with it. Only drags carrying `Files`
are intercepted, so a text drag inside the document still belongs to CodeMirror
and ProseMirror. Pinned by `editor-file-drop.test.js`. Still unhandled: the menu
bar, toolbar, status bar and tray, the Outline tab and panel header, the Cards and
map overlays and the About/Help pages — a file dropped there is not imported, and
the browser default (open the file in the tab) is not prevented. The finding's
minimum fix, a document-level `dragover`/`drop` `preventDefault`, is not in place.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

File drag/drop is still scoped to the Files-tab body: `WorkspacePanel.tsx:381-405`; no root-editor drop routing.

#### Original independently verified finding

**File:** `src/ui/WorkspacePanel.tsx:359-380` (the only file `onDrop`/`onDragOver` in the app), `:226` (`{tab === "files" && <FilesTab …>}`)
**Source:** [91]
Native CDP drags: dropping `drop-test.md` on `aside` imports it (1 → 2 documents, "Dropped file" row appears — so the mechanism works). The same drop on `.ProseMirror`, `.cm-content`, `header` and `footer` produces **nothing**: no import, no toast, no overlay, no error. The zone doesn't exist on the Outline tab either, and the panel is closed by default on phones.
**Fix:** hoist `dragEvents` to the PerssonifyEditor root so the whole app routes to the same `onFileDrop`, and render the "Drop to Import" overlay over the editor. At minimum add a document-level `dragover`/`drop` `preventDefault` so an off-target drop can't fall through to the browser's file navigation.

### E7. Mobile menu rows are two different heights in the same menu

**Priority:** medium · **Audit severity:** medium · **Status:** **OPEN** — the earlier "STALE" verdict was wrong (audit A111)

That verdict checked how the menu is navigated, not how tall its rows are. The
drill-down changed how many rows a level shows, not their height:
`DropdownMenuCheckboxItem` and `DropdownMenuRadioItem` still lack the
`pointer-coarse:min-h-11 …` sizing that `DropdownMenuItem` and
`DropdownMenuSubTrigger` carry, so ☰ ▸ View still mixes 44px rows (the back row,
Toggle workspace panel, Outline, Appearance) with 28px ones (Markdown / Rich text
/ Split, Editor / Cards / Relationship map, Read-only mode, Focus mode).
`src/components/ui` is generated, so restate the sizing in `styles.css` under
`(pointer: coarse)`, as audit A100 did for the context-menu rows.


#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`dropdown-menu.tsx:163,205` Checkbox/Radio items still lack the `pointer-coarse:min-h-11 ...` classes present on normal menu items.

#### Original independently verified finding

**File:** `src/components/ui/dropdown-menu.tsx:163` (CheckboxItem), `:205` (RadioItem) — both missing the `pointer-coarse:` block that `DropdownMenuItem:92` and `SubTrigger:117` carry
**Source:** [105]
Measured in the ☰ → View menu at 390×844 (hasTouch): `All menus 44.0, Markdown 28.0, Rich text 28.0, Split 28.0, Toggle workspace panel 44.0, Outline 44.0, Relationship map 44.0, Cards 44.0, Read-only 28.0, Focus mode 28.0, Show ads 28.0, Appearance 44.0`. The 28px rows are the **view-mode switcher and the mode toggles** — the most-tapped items — at 36% below the touch minimum, and the menu visually reads as two menus glued together.
**Fix:** copy `pointer-coarse:min-h-11 pointer-coarse:gap-2.5 pointer-coarse:px-3 pointer-coarse:py-2.5 pointer-coarse:text-sm` onto both `:163` and `:205`.

### E8. Scroll-sync toggle is a 16×16 target jammed against the phone's right edge

**Priority:** medium · **Audit severity:** medium · **Status:** ✅ **RESOLVED (1.76.0)**

`pointer-coarse:h-8 pointer-coarse:w-8` on the toggle — the icon stays 16px, the
button grows on coarse pointers only. Same shape as the divider hit-area fix in
1.75.0. Now covered by the general assertion: every visible button on a 390px
touch viewport clears 24px, asserted rather than counted
(`e2e/cases/surfaces.mjs`).


#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

Scroll-sync control remains a small `h-4`/16px control at `editorPanes/index.tsx:118-127`; no coarse-pointer target expansion.

#### Original independently verified finding

**File:** `src/ui/panes/editorPanes/index.tsx:118-127` (`h-4 … [&_svg]:size-4`, no width, no padding, no `pointer-coarse:`)
**Source:** [49, 109]
Measured 390×844: `{x:358, y:142.3, width:16, height:16}` — right edge at 374 of 390. Roughly a third of the 44px minimum, its hover tooltip can never fire on touch, and it sits next to the sync-mode pills so mis-taps hit a neighbour. CLAUDE.md's own responsive invariant mandates `pointer-coarse:` bumps to ≥32px for exactly this class of control.
**Fix:** `size-6 pointer-coarse:size-9` (or `p-2 pointer-coarse:p-2.5`) plus right margin to clear the pane edge.

### E9. Two menu items named "Clear formatting" run different commands; one is a silent no-op

**Priority:** medium · **Audit severity:** medium · **Status:** **PARTIAL** — the no-op is fixed; the naming is not (reconciled 2026-09)

1.74.0 gave `dispatchToMd` a `clearFormatting` case, so the Edit and right-click
entries act in the Markdown pane instead of warning to the console, and since
audit A055 that markdown-pane clear keeps content. The naming half is not done:
Edit ▸ Clear formatting and right-click ▸ Clear formatting dispatch
`clearFormatting` (rich pane: marks only) while Format ▸ Clear formatting
dispatches `removeFormat` (marks and block types) — one label, two outcomes in
the rich pane. The fix is still the rename: Edit ▸ "Clear character formatting",
Format ▸ "Clear all formatting".

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`editorContextMenu/index.tsx:104` dispatches `clearFormatting`; Markdown dispatcher has `removeFormat` but no `clearFormatting` case (`useFormatDispatcher.ts:428-464`).

#### Original independently verified finding

**Files:** `src/ui/chrome/menuBar/index.tsx:228` (`dispatch("clearFormatting")`), `:413` (`dispatch("removeFormat")`), `src/ui/chrome/editorContextMenu/index.tsx:104`; `src/formatting/useFormatDispatcher.ts:360,368,428,462`
**Source:** [61]
`dispatchToMd` implements only `removeFormat`; `clearFormatting` falls to `default: console.warn("Unknown MD command: clearFormatting")`. So with the cursor in the Markdown pane, **Edit ▸ Clear formatting** and **right-click ▸ Clear formatting** do nothing while the identically-named **Format ▸ Clear formatting** one menu over works. In the rich pane the two do different things (`unsetAllMarks()` vs `unsetAllMarks().clearNodes()`).
**Fix:** add a `clearFormatting` case to `dispatchToMd`, and rename so the two read differently — Edit ▸ "Clear character formatting", Format ▸ "Clear all formatting".

### E10. Right-click ▸ Insert ▸ Image / Formula / Inline math are no-ops in the rich pane

**Priority:** medium · **Audit severity:** medium · **Status:** ✅ **RESOLVED**

**Resolved (1.74.0).** `EditorContextMenu` takes a `promptInsert(kind)` from
PerssonifyEditor and awaits the same prompt/equation dialog the toolbar and menu
bar use, so all three call sites behave identically. Audit A096 then made all three
ask for alt text after the URL (`promptImage`, `src/formatting/image-insert.ts`;
empty = decorative) and fixed the Markdown side, which had ignored the URL and
written an `![alt text](image-url)` placeholder.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`editorContextMenu/index.tsx:148,151-152` invokes image/math commands without a value; rich dispatcher only acts when `value` is supplied (`useFormatDispatcher.ts:321-343`).

#### Original independently verified finding

**File:** `src/ui/chrome/editorContextMenu/index.tsx:148,151,152` (value-less `d("insertImage")` / `d("insertMathInline")` / `d("insertMathBlock")`) against `src/formatting/useFormatDispatcher.ts:321-324,339,342` (all guarded by `if (value)`)
**Source:** [78]
The toolbar (`toolbar/index.tsx:524`) and menu bar (`menuBar/index.tsx:258`) prompt first; the context menu does not. Measured: image count stayed at 7 and zero dialogs opened after clicking "Image…" — no dialog, no insert, no error, despite the promising ellipsis. (In the MD pane the same command drops a literal `![alt text](image-url)` placeholder, so the panes also disagree.)
**Fix:** move the prompt/equation dialog **inside** the `insertImage`/`insertMath*` cases so all three call sites behave identically, or `await` the same prompt in the context menu before dispatching.

### E12. Guided tour: four defects

**Priority:** medium · **Audit severity:** medium · **Status:** **OPEN** — the earlier "STALE" verdict was wrong (audit A111)

All four defects are present in `src/ui/Walkthrough.tsx`: clicking the dimmed area
does nothing (only the spotlight carries `onClick={next}`, despite a comment
saying "click anywhere outside to advance"); the phone copy keys off
`innerWidth < 640` instead of the 768px breakpoint; the dot row and Next/Done count
all seven steps while the workspace step's target is unmounted on phones (the
panel starts closed there), so the tour ends on a "Next" with a dot never filled;
and the "Two panes" step still tells phones — whose panes stack — about left/right
and "drag the divider". What the tour does do: it re-measures its spotlight on
resize and scroll, contains Escape, and (audit A094) leaves Enter on Skip / Back /
Close to that button. `e2e/cases/surfaces-deep.mjs` proves only that it starts,
finds a real anchor and ends on Escape — none of the four defects is covered.
Under forced colours the spotlight disappears entirely (see J1).


#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`Walkthrough.tsx:22` still uses 640px rather than the 768px mobile breakpoint; `:55-63` retains desktop-only pane/workspace steps; outer wrapper at `:166` still lacks click-to-advance while only spotlight receives `onClick` (`:177`).

#### Original independently verified finding

**File:** `src/ui/Walkthrough.tsx`
**Source:** [88, 27, 28, 113]
1. **`:161-173` — the dimmer swallows clicks without advancing.** The dimming is a `box-shadow: 0 0 0 9999px` spread on the small spotlight box, which is not hit-testable; only the spotlight rect carries `onClick={next}`. The outer `fixed inset-0 z-[100]` div has no handler and no `pointer-events:none`, so clicking the dimmed area does nothing at all — contradicting the file's own comment *"click anywhere outside to advance"*. Measured: `elementFromPoint(1200,780)` returns the wrapper; the step title never changes.
2. **`:22` — wrong phone breakpoint.** `innerWidth < 640` vs the menu bar's actual `MOBILE_BREAKPOINT = 768` (`src/hooks/use-mobile.ts:3`). From 640–767px the tour spotlights the single ☰ button while reading *"Every command lives here — File, Edit, Insert, View, Format, Tools and Help"*.
3. **`:55` + `:195` — six dots, five steps on phones.** Step 6 targets `[data-tour="workspace"]`, which is unmounted (`uiStore.ts:112` defaults `showSidebar` false below 768). `useLayoutEffect` (`:87-95`) silently advances past it and calls `finish()`. The sixth dot never fills, the final button still reads "Next", and phone users are never told the Files/Outline panel exists — the very panel closed by default on their device.
4. **`:51-52` — step 5 describes a layout phones don't have.** *"Type Markdown on the left or rich text on the right… Drag the divider"* while the panes are stacked. Steps 1 and 2 both have mobile variants; this one is the odd one out.
**Fix:** (1) put `onClick={next}` on the outer wrapper, or render an explicit full-screen backdrop behind the spotlight; (2) import `MOBILE_BREAKPOINT`; (3) render the dot row from resolvable steps only, and give the workspace step a phone fallback spotlighting the reopen button (`PerssonifyEditor.tsx:2101`); (4) add a mobile body string. See also **J1** — the whole spotlight vanishes in forced-colors mode.

### E13. Both resize separators are unreachable by keyboard

**Priority:** low · **Audit severity:** low · **Status:** ✅ **RESOLVED (1.75.0)**

Both carry `tabIndex`, `aria-valuenow/min/max`, `aria-valuetext` and arrow /
Home / End handling. Worth noting this was more than missing keyboard support:
`role="separator"` reporting no value is invalid ARIA, so the elements were
announced as unoperable even once focusable.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

Both separators have role/orientation but no `tabIndex`, keyboard handler, or range ARIA: `editorPanes/index.tsx:547-555`; `WorkspacePanel.tsx:188-194`.

#### Original independently verified finding

**Files:** `src/ui/panes/editorPanes/index.tsx:511`, `src/ui/WorkspacePanel.tsx:179-184`
**Source:** [52]
`role="separator"` with no `tabIndex`, no `onKeyDown`, no `aria-valuenow/valuemin/valuemax`. Confirmed: tabbing through the entire chrome never stops on either. The split ratio and the panel width are pointer-exclusive.
**Fix:** `tabIndex={0}`, `aria-valuenow/min/max`, and an `onKeyDown` adjusting on Arrow keys (Up/Down when stacked) with Home/End for the clamps.

### E14. Active-pane label highlight is dead code

**Priority:** low · **Audit severity:** low · **Status:** ✅ **RESOLVED (1.75.0)**

Both the label and the dot key off one `data-pane-focused` attribute styled in
CSS. The entry missed a second defect: the else branch added
`text-muted-foreground` on every blur, accumulating a class that had never been
there.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`editorPanes/index.tsx:32` still applies `text-muted-foreground!`; focus code at `:309-316` toggles non-important classes that cannot override it.

#### Original independently verified finding

**Files:** `src/ui/panes/editorPanes/index.tsx:32` (`text-muted-foreground!`), `:305-317` (`classList.add("text-primary")`, `classList.remove("text-muted-foreground")`)
**Source:** [110]
The code removes a class that was never applied (the applied one is `text-muted-foreground!`) and adds one that cannot beat `!important`. Measured after focusing either pane: `cls "… text-muted-foreground! … text-primary", color rgb(107,114,128)` — unchanged in both directions. The only surviving cue is a 6px dot, and the `transition-colors` on the label implies an animation that never plays.
**Fix:** drop the `!` at `:32` (nothing else overrides it), or toggle a `data-focused` attribute styled in CSS instead of racing Tailwind specificity.

### F3. Broken wiki links are styled identically to working ones

**Priority:** medium · **Audit severity:** medium · **Status:** ✅ **RESOLVED (audit A058)** — the 1.76.0 fix never worked (rich pane only)

A `[[link]]` pointing at a document that does not exist rendered IDENTICALLY to
one that works, so the only way to find a broken link was to click it. The 1.76.0
fix — `useLinkIndex` writing `data-unresolved` into the DOM — never once marked a
link: it compared `String()` of `{ target, displayText }` objects (`"[object
Object]"`) against the link targets, and it wrote into DOM that ProseMirror owns.
This entry called it RESOLVED anyway. Broken links are now a ProseMirror
decoration (`src/extensions/UnresolvedWikiLinks.ts`), recomputed on every edit
and every re-index and judged with the same resolver as clicks, the map and
backlinks (`createWikiResolver`, audit A059); `styles.css` draws the link dashed
and muted through `:has()`. Nothing is marked before the library loads. The
Markdown pane shows the `[[…]]` source unmarked, and card previews are not
marked. `links-resolution.test.js` drives it against a real editor.

Deliberately NOT baked into the mark: whether a link resolves depends on OTHER
documents, so storing it would make a link's own data depend on its neighbours and
make every rename dirty every document pointing at it. Dashed rather than red,
because a link written before its target exists is a normal state in note-taking,
not an error.


#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`src/extensions/WikiLink.ts:20-40` only preserves `data-doc-link`/`data-anchor`; no unresolved state/class/title reaches rendered links.

#### Original independently verified finding

**Files:** `src/extensions/WikiLink.ts` (renderHTML), consumers of `linkIndex.unresolved`
**Source:** [108]
Measured on a doc with `[[Welcome]]` (resolves) and `[[Missing Doc]]` (does not): both return byte-identical `{cls:"perssonify-link wiki-link", color: color(srgb 0.550431 0.404863 0.00454902), textDecoration:"none", opacity:"1"}`. The app *knows* the difference — it drives the status bar and the graph's broken chip — but nothing reaches the rendered mark, so a user writing wiki links can only discover dead ones by opening the tray or the graph.
**Fix:** have `useLinkIndex` push the unresolved target set into the editor and emit `data-unresolved` (or a `wiki-link--broken` class) in `WikiLink.ts`, styled with a dashed underline / muted-destructive colour and `title="No document named …"`.

### F4. The welcome document's title never follows its H1, unlike every other document

**Priority:** low · **Audit severity:** low · **Status:** ✅ **RESOLVED (1.76.0)**

Seeding set `userTitle`, and `resolveDocTitle` treats a non-placeholder
`userTitle` as a pin — so the welcome document was permanently called "Welcome"
while its own H1 read "Markdown Studio", and editing that heading renamed nothing,
alone among every document in the app. Seeding now sets `title` only: the name to
fall back to, not a rename. Same principle as `createFolder`'s `startNaming` — a
programmatic creation must not leave traces only a user's action should.


#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`src/PerssonifyEditor.tsx:1161-1164` assigns the seed title to `doc.userTitle`; `src/store/documents/document.ts:127-128` derives pinning from a user title.

#### Original independently verified finding

**Files:** `src/App.tsx:122-125` (seeds `initialDocument: { title: "Welcome" }`), `src/store/documents/document.ts` (`createDocument` back-fills `titlePinnedByUser = true` for any non-placeholder `userTitle`), `resolveDocTitle`
**Source:** [114]
A Ctrl+N document given `# Project Notes` retitles itself everywhere within one autosave. Doing the same to the welcome doc — which explicitly invites editing (*"Everything below is live and editable"*) — has no effect: after replacing its top with `# Reload Test Doc`, saving and reloading, both panes show the new H1 while the top bar, library row and status bar all still read "Welcome".
**Fix:** seed the built-in initial document with `titlePinnedByUser` **false** so it heals from its first heading like every other doc.

### F5. Stale and inconsistent in-product copy

**Priority:** low · **Audit severity:** low · **Status:** **PARTIAL** (reconciled 2026-09)

Fixed: the welcome document names the relationship map and lists `.docx`; Help
has a Cards section; the map's header says "Relationship map"; the view buttons
are named "Rich text" / "Split view" (audit A096). Remaining: Help's Select bullet
still says Select can "Copy, Delete, or apply a style" though the submenu only
selects; the toolbar magnifier is still "Search & Replace (⌘F)" and its tooltips
stay Title Case ("Strike", "Bullet List", "Clear Format", "Del Row"); Cards and
Help spell "colour"/"neighbours" beside "color" elsewhere; the shortcut lists
still say "Toggle relationship graph".

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** PARTIAL at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

Import/help copy is updated (`menuBar/index.tsx:494`, `help-content.ts:138-141,200`), but inconsistent terms remain: `modeSwitcher/index.tsx:20-21` “HTML Text”/“Split View”; `GraphView.tsx:586` “Knowledge Graph”; `CardsView.tsx:442` “Colour”.

#### Original independently verified finding

**Source:** [62, 63, 65, 70, 71, 72, 73]
| Where | Says | Reality |
|---|---|---|
| `src/constants.ts:166` | "explore backlinks… in **View → Graph view**" | Menu item is **"Relationship map"** |
| `src/constants.ts:168` | imports `.md .txt .html .json .zip/.tar/.gz` | picker also accepts **`.docx`** (`menuBar/index.tsx:471`) |
| `help-content.ts:79` | Select ▸ "can act on every heading… — Copy, Delete, or apply a style" | `selectMenuContent/index.tsx:5-8` is **selection-only**; label is "Select by type…" |
| `help-content.ts` | (nothing about Cards) | ⌘⇧K + View ▸ Cards ship a 700-line board with quick capture, pin, colours, checklists |
| `modeSwitcher/index.tsx:20` | aria-label **"HTML Text"**, "Split View" | everywhere else: **"Rich text"**, "Split" (`menuBar/index.tsx:281`, `SettingsSheet.tsx:198`, `statusBar/index.tsx:48`) |
| `toolbar/index.tsx:367` | "Search & Replace (Ctrl+F)" | ⌘F opens **Find** mode; also Title-Case tooltips ("Strike", "Bullet List", "Clear Format", "Del Row") vs sentence-case menu items |
| `GraphView.tsx:537` / `menuBar/index.tsx:303,557` / `statusBar/index.tsx:260` | "Knowledge Graph" / "Relationship map" / "graph view" / "relationship graph" | five names for one feature |
| `CardsView.tsx:369,370,381` | "Colour" (visible title + 2 aria-labels) | American "Color" everywhere else; `help-content.ts:198` "neighbours" |
**Fix:** correct the two welcome-doc pointers and add `.docx`; rewrite the Select bullet as selection-only and point bulk styling at Find ▸ Format matches; add a Cards section; settle on **"Relationship map"** and **"Rich text"** everywhere; retitle the toolbar magnifier to `Find (⌘F)` and normalise toolbar tooltips to the menu wording; one locale.

### F6. Shortcut reference data errors

**Priority:** low · **Audit severity:** low · **Status:** ✅ **RESOLVED (by 1.77.0)** — this entry was still marked PARTIAL (audit A111)

`SHORTCUT_GROUPS` has one "Toggle cards board" row, and `COMMON_SHORTCUTS` lists
Find ⌘F and Find & Replace ⌥⌘F (`src/data/shortcuts.ts`); `shortcuts.test.js`
fails on a duplicate action within a group. Still inconsistent, outside this
finding: the Edit menu hints Replace as ⌘H, which macOS never delivers.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** PARTIAL at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

Mac replace key fixed at `src/data/shortcuts.ts:53`, but duplicate Cards rows remain at `:57-58`; `COMMON_SHORTCUTS` still says “Find & Replace ⌘F” at `:100`.

#### Original independently verified finding

**File:** `src/data/shortcuts.ts` — *"THE single source of truth"* per its own header
**Source:** [50, 58, 51, 59]
- `:57-58` — **"Toggle cards board ⌘⇧K" is listed twice**, byte-identical apart from indentation. It renders as a duplicated row in the Help page and both shortcuts dialogs, and since `HelpPage.tsx:259` keys rows on `r.action` it also throws a duplicate-React-key warning. → delete `:57`.
- `:100` — `COMMON_SHORTCUTS` says **"Find & Replace ⌘F"**, contradicting `:52-53` (`Find ⌘F` / `Find & Replace ⌘H`) and the handler. ⌘H is absent from that list entirely. It surfaces only in the MenuBar fallback dialog (`menuBar/index.tsx:600`) used by library embeds that don't supply `onHelp`. → `{ action: "Find", keys: "⌘F" }` + add the ⌘H row.

**Fix:** delete the duplicate Cards shortcut row; correct `COMMON_SHORTCUTS` to list Find as `⌘F`; and add the distinct Find & Replace shortcut using the current platform-correct key.

### F7. Workspace flat-list word count: renders a bare "0", and drops the unit

**Priority:** low · **Audit severity:** low · **Status:** OPEN

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`src/ui/WorkspacePanel.tsx:575-576` uses `doc.wordCount &&` and renders only the unformatted number/no unit.

#### Original independently verified finding

**File:** `src/ui/WorkspacePanel.tsx:546-547` ✅ verified
**Source:** [85, 111]
```jsx
{doc.wordCount && doc.wordCount > 0 && (   // 0 && … → 0, which React renders
  … <HashIcon/>{doc.wordCount}</span>      // no unit, no toLocaleString()
)}
```
`wordCount` is a required `number` (`document.ts:82`), so a new/emptied doc renders a stray unlabelled `0` text node next to its timestamp (measured row innerText: `Untitled | just now | 0`). And the same document reads `# 9 words` in the tree (`FolderTree.tsx:673`, which guards correctly with `!= null` and formats) but `# 9` in search results — the unit and the thousands separator both vanish.
**Fix:** `{doc.wordCount > 0 && (… {doc.wordCount.toLocaleString()} words …)}` plus the matching `title=`, so both renderers agree.

### F8. Graph header pluralises wrongly in the one-document state

**Priority:** low · **Audit severity:** low · **Status:** ✅ **RESOLVED (by 1.77.0)** — this entry was still marked OPEN (audit A111)

The header reads "N note(s) · N link(s)", singular for one, and a library with
notes but no links gets "One note, nothing linked yet". The canvas's accessible
name is still unpluralised ("2 documents, 1 links").

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`src/ui/GraphView.tsx:586-589` hard-codes “docs”/“links”, including one-document state.

#### Original independently verified finding

**File:** `src/ui/GraphView.tsx:539`
**Source:** [31]
A brand-new user opening the graph reads **"KNOWLEDGE GRAPH · 1 docs, 0 links"**.
**Fix:** `doc{n === 1 ? "" : "s"}` / `link{e === 1 ? "" : "s"}`, matching `statusBar/index.tsx:164`.

### F10. About page's credits omit two shipped dependencies and mis-state the licenses

**Priority:** low · **Audit severity:** low · **Status:** ✅ **RESOLVED (audit A077)**

The credits add mammoth (BSD-2-Clause) and @zip.js/zip.js (BSD-3-Clause), so
"Licenses in use" includes both BSD variants; the About page presents the credits
as highlights and links the complete notice generated from the build
(`/third-party-licenses.txt`), which covers `@tiptap/extension-code-block-lowlight`
and every other shipped package. `g4-third-party-licenses.test.js` pins each
credited runtime package to that notice at its credited version.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`src/data/credits.ts:61-65` lists only `docx`/`fflate`; no `mammoth`, `@zip.js/zip.js`, or `@tiptap/extension-code-block-lowlight`, despite current use.

#### Original independently verified finding

**File:** `src/data/credits.ts:61` (+ derived `LICENSE_SUMMARY:106`, rendered `AboutPage.tsx:65-67`)
**Source:** [66]
`mammoth` (^1.12.0, **BSD-2-Clause**, powers DOCX import) and `@zip.js/zip.js` (^2.8.34, **BSD-3-Clause**, powers encrypted-ZIP decryption) are runtime `dependencies` shipping as lazy chunks and appear nowhere in CREDITS, so the page's checkable claim *"Licenses in use: Apache-2.0 · ISC · MIT · OFL-1.1"* is wrong. Both BSD variants require attribution.
**Fix:** add both entries (plus the uncredited `@tiptap/extension-code-block-lowlight`); `LICENSE_SUMMARY` auto-corrects.

### F11. Byte formatter has no GB tier

**Priority:** low · **Audit severity:** low · **Status:** **OPEN** — and wider since audit A086

`formatEstBytes` and `formatSnapshotBytes` still stop at MB. Since the storage
limit became the browser's quota (audit A086), three more MB-only formatters meet
gigabyte values: the "Storage quota exceeded" error text, the status bar's
storage tooltip and the console's `diag.storage`. Settings ▸ Storage already has a
GB tier.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`src/store/history/history-cache.ts:273-277` and `snapshot-store.ts:380-384` still stop at MB.

#### Original independently verified finding

**Files:** `src/store/history/history-cache.ts:273-277`, mirrored in `src/store/history/snapshot-store.ts:380-384`; rendered at `src/ui/MemorySheet.tsx:109`
**Source:** [87]
The Memory sheet reads *"JS heap 44.3 MB of **4095.8 MB**"* for a 4 GB `jsHeapSizeLimit`.
**Fix:** add `if (bytes < 1024**3) …; return `${(bytes/1024**3).toFixed(1)} GB`;` to both.

### F12. Image files are dropped from a mixed import without appearing in the "Skipped" toast

**Priority:** low · **Audit severity:** low · **Status:** OPEN

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`src/PerssonifyEditor.tsx:1553-1555` still bare-continues image files; sibling skips populate `skipped` at `:1582,1587,1600,1603`.

#### Original independently verified finding

**File:** `src/PerssonifyEditor.tsx:1485` (`if (file.type?.startsWith("image/")) continue;`)
**Source:** [82]
Every sibling skip branch (`:1512`, `:1517`, `:1531`, `:1534`) pushes to `skipped[]`, which the warning toast at `:1544-1546` reads; the image branch is the only bare `continue`. Dragging a folder of notes + images shows "Imported N file(s)" with no hint the images were discarded. (Images-only drops do surface "No supported files found", so only the mixed case is silent.)
**Fix:** `if (file.type?.startsWith("image/")) { skipped.push(file.name); continue; }`.

### G1. "Images" toggle paints dashed placeholders over ProseMirror's internal separator `<img>`s

**Priority:** high · **Audit severity:** high · **Status:** OPEN

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`src/styles.css:1220` still matches every `.ProseMirror img`, without excluding `.ProseMirror-separator` or requiring `src`.

#### Original independently verified finding

**File:** `src/styles.css:1220` (`[data-hide-images] .ProseMirror img { … }`)
**Source:** [74]
The selector matches every `<img>` in the editor, including ProseMirror's own zero-size `<img class="ProseMirror-separator" alt="">` placeholders injected after inline atoms (emoji, math, images) at paragraph ends. Measured on the default Welcome doc: toggling Images off turns **10** invisible separators into visible 64×18 dashed amber boxes (each `0x0` → `64x18`), scattered through the prose — e.g. two "hidden image" markers at the top where the source has one image.
**Fix:** `[data-hide-images] .ProseMirror img:not(.ProseMirror-separator)`, or scope to `img[src]` so only real content images get the placeholder treatment.

### G2. `ThemeImage` (`<picture>`) discards width/height — and every other `<img>` attribute — and misuses `srcset` as `src`

**Priority:** medium · **Audit severity:** medium · **Status:** OPEN

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`src/extensions/ThemeImage.tsx:20-26` returns raw `srcset`; `:55-62` has no width/height attributes; view at `:43` renders no size; parse/render at `:77-102` retains only four attrs.

#### Original independently verified finding

**File:** `src/extensions/ThemeImage.tsx:25` (returns the raw `srcset` string), `:43` (node view), `:67-83` (`getAttrs` reads only lightSrc/darkSrc/alt/title), `:95-102` (`renderHTML` rebuilds from those four)
**Source:** [80, 81]
- **Size is lost and then deleted from the user's source.** A `<picture>` whose `<img>` declares `width="80" height="40"` renders at its intrinsic **400×200** in the rich pane, and one keystroke elsewhere re-projects the Markdown with the attributes **permanently stripped** — a sized theme logo silently becomes full-bleed with no undo from the MD pane. Sibling `SizedImage.ts:14-24` deliberately preserves these for the plain Image node, so `<picture>` is the only image form that loses them. (Same mechanism discards `class`, `loading`, `sizes`, and the `<source>` `type`/`sizes`.)
- **`srcset` is assigned to `src`.** `<source srcset="logo@2x.svg 2x, logo.svg 1x">` yields `img.getAttribute('src') === "logo@2x.svg 2x, logo.svg 1x"` — the whole candidate list with descriptors as a single URL, i.e. a 404 against a real server. *(Repro caveat: in the verifier's sandbox a catch-all route interceptor happened to fulfil the mangled URL, so the image still painted; the defect is in the value, not the paint.)*
**Fix:** add `width`/`height` to `addAttributes()` (default null), read them in `getAttrs`, and emit them in both `renderHTML` and the node view — mirroring `SizedImage.ts:14-24`. Parse the candidate list before use: `(srcset||"").split(",")[0]?.trim().split(/\s+/)[0]`, falling back to the source's `src`.

### G3. Welcome doc's remote S3 images: 72px content jump and no offline caching

**Priority:** medium · **Audit severity:** medium · **Status:** **PARTIAL** — the offline half is fixed (reconciled 2026-09)

The Welcome document's images are same-origin files under `/brand/`, which the
service worker precaches, so they show offline and nothing is fetched from S3 —
that was the half the medium rating rested on. The header logo still declares
`width="84"` without a `height` (the file is 1024×1024), so its box has no height
until the image decodes; how far the text still moves on first load now that the
file is local needs a browser measurement.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`src/constants.ts:55` seed logo still has width only; `vite.app.config.ts:62-87` caches navigation/scripts only, with no image route.

#### Original independently verified finding

**Files:** `src/constants.ts:38` (+ 7 more S3 URLs), `src/styles.css:1213-1217`, `vite.app.config.ts:62-86` (runtimeCaching covers only `navigate` + same-origin `script`)
**Source:** [79]
The header `<img … width="84">` has no `height`, so with `height:auto` its box is 84×0 until the bytes arrive: measured H1 top 235.59 → 307.61 = **72.02px** shift, layout-shift score 0.027. Cross-origin S3 images match no SW rule, so offline — the state the app advertises — the first thing a new user sees is a broken-image glyph with wrapped alt text where the logo should be, plus four broken brand logos. This also contradicts the project's own "client-only (no backend, no network calls)" claim.
**Calibration:** CLS 0.027 is inside Google's "good" band; the medium rating rests on the offline half.
**Fix:** add `height` (or an `aspect-ratio`) to the seed images, and either inline them as `data:` URIs / ship them from `/public` as same-origin assets, or add a workbox `runtimeCaching` rule for `request.destination === 'image'` (StaleWhileRevalidate, bounded expiration).

### G4. Install/home-screen icons and browser chrome colour are wrong

**Priority:** low · **Audit severity:** low · **Status:** **OPEN**

The manifest icons are now declared `purpose: "any maskable"` but are still the
transparent, edge-to-edge glyph (opaque pixels reach 3.6% from the top and
bottom), so the maskable crop clips it; `apple-touch-icon.png` is still
transparent; `theme_color`/`background_color` are still `#0a0a0a`, and
`index.html` has one unconditional dark `theme-color` with no runtime updater.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`vite.app.config.ts:36-43` retains black `theme_color`/`background_color` and only `purpose: "maskable"` icons; `index.html:12` has one unconditional dark `theme-color`.

#### Original independently verified finding

**Files:** `vite.app.config.ts:36-37,40-43`; `public/web-app-manifest-{192,512}.png`; `public/apple-touch-icon.png`; `index.html:12`
**Source:** [75, 76, 77]
- Both manifest icons are declared `purpose: "maskable"` but are **transparent, edge-to-edge glyphs**: measured alpha bbox x 12.1–87.9%, y **3.7–96.3%** (192px: 3.6–96.4%), only 38.6% opaque, corners RGBA(0,0,0,0). Maskable reserves the outer 10% as croppable and requires opacity, so Android crops the glyph top and bottom and the mask shows through unfilled. There is **no `purpose:"any"` icon at all**, so contexts needing one render the same asset whole and inset.
- `apple-touch-icon.png` (180×180, RGBA, transparent) — iOS ignores alpha and flattens onto **black**, so the home-screen tile is a yellow glyph on black while the brand is cream everywhere else.
- `theme-color` is an unconditional `#0a0a0a` with no `prefers-color-scheme` variant and no runtime updater, and `background_color` is the same, while `defaultTheme="system"` and the light surface is `hsl(40,30%,96%)` — a near-black address bar over a cream app, and a black PWA splash on every cold launch.
**Fix:** ship a padded **opaque** maskable variant (glyph inside the centre 80%) and keep the current asset as a separate `purpose:"any"` entry; flatten `apple-touch-icon.png` onto `#F7F4EE`; emit two `<meta name="theme-color" media="(prefers-color-scheme: …)">` tags and rewrite the active one from the next-themes change handler; set `background_color` to the light surface.

### H1. Split panes stack by viewport **width** only — landscape phones get 37–69px editors

**Priority:** medium · **Audit severity:** medium · **Status:** ✅ **RESOLVED (audit A100)**

Split stacks only below 768px wide AND when there is room for two panes: a touch
device held upright, or a viewport at least 500px tall (`splitShouldStack`,
`src/ui/panes/editorPanes/split-layout.ts`). A landscape phone keeps the panes side by side; unit
tests and the `surfaces` e2e tier (667×375, each editor over 150px) pin it. An
upright phone ignores its keyboard-shrunk height, so opening the keyboard does not
flip the layout.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`src/ui/panes/editorPanes/index.tsx:266-276` remains width-only `matchMedia("(max-width: 767px)")`; no viewport-height condition.

#### Original independently verified finding

**File:** `src/ui/panes/editorPanes/index.tsx:270` (`matchMedia("(max-width: 767px)")`), consumed at `:280`, `:471`, `:512`, `:517`
**Source:** [14, 23]
A landscape phone is wide *and short* — precisely where stacking is worst. Measured pane geometry:
| Viewport | `.cm-scroller` height | Rich viewport / content |
|---|---|---|
| 740×360 | 61.4px | 57px / 4700px |
| 667×375 (iPhone SE landscape) | 68.9px | 65px / 4769px |
| 653×320 | 41.4px | **37px** / 4779px |
| **768×400** (1px over the breakpoint) | **196px each** | side-by-side |
So a viewport 25px taller gets 3× the usable height by going side-by-side; the stacking decision inverts precisely when vertical space is scarcest.
**Honest constraint:** stacking below 768px is a **documented deliberate invariant** (CLAUDE.md, aligned with the ☰ collapse), and simply flipping the width test would give ~330px-wide panes at 667px. The real defect is the missing **height** term.
**Fix:** add a height condition — stack only when `width < 768 && height >= 480`; on short viewports either go side-by-side or fall back to a single pane. Everything downstream already keys off `isNarrow`, so no other change is needed.

### H2. Mobile workspace drawer: no scrim, no dismiss, no animation, invisible loading state

**Priority:** medium · **Audit severity:** medium · **Status:** **PARTIAL** (reconciled 2026-09)

The phone drawer now takes focus when it opens, closes on Escape and hands focus
back (audit A094). Still missing: a scrim or tap-outside dismiss; `max-w-sm` still
leaves a ~6px strip of editor at 390px; it appears with no animation; and its
loading fallback is `hidden` below `md`, so the first tap on a slow connection
shows nothing.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`src/ui/WorkspacePanel.tsx:174-194` remains a conditionally mounted mobile absolute drawer with `max-w-sm`, no scrim/Escape/animation.

#### Original independently verified finding

**Files:** `src/ui/WorkspacePanel.tsx:167-173` (bare `absolute inset-y-0 left-0 z-20 w-full max-w-sm`), `src/PerssonifyEditor.tsx:1960` (conditional mount, no backdrop, `onClose` wired only to the header icon), `:2064` (Suspense fallback `hidden … md:block`)
**Source:** [104, 36, 29]
Three defects on one surface:
- **No scrim, no tap-outside, no Escape.** At 390px `max-w-sm` = 384px, so the drawer covers 98.5% of the screen leaving a **6px vertical strip** that reads as a rendering glitch. Escape leaves it mounted (a subsequent `.cm-content` click was blocked for 30s by *"`<aside data-tour="workspace">` subtree intercepts pointer events"*). Tapping the strip does nothing. The only exit is a 36px `⊟` in the drawer header, and with no dim the panel doesn't look modal.
- **No animation.** `document.getAnimations()` is `[]` and computed `{transitionDuration:"0s", animationName:"none", transform:"none"}`; screencast frames `0:9ms, 1:60ms` show it fully present in frame 1. It reads as a page swap, and is inconsistent with every other overlay in the app (menus, dialogs, bubbles, PageChrome, and the library's *own* drop overlay at `:385`, all `animate-in`).
- **Invisible lazy fallback.** The Suspense placeholder is `hidden` until `md`, so on a phone the first tap of the reopen button downloads the chunk with **no** spinner or skeleton — on a slow connection the control reads as broken and users tap again.
**Fix:** render a `md:hidden fixed inset-0 z-10 bg-black/40` scrim wired to `onClose`; add an Escape handler while open on mobile; make the drawer full-bleed (`w-full`, drop `max-w-sm`) or leave a deliberate ~15% peek; append `"animate-in slide-in-from-left duration-200 md:animate-none"` to the phone-only class group (transform-based, stays on the compositor — for a symmetric close, keep it mounted and drive `-translate-x-full` off `showSidebar` instead of unmounting); give the fallback the drawer's mobile geometry with a skeleton header. Pair with the D1 reduced-motion guard.

### H4. The graph strips Fit-to-view and the health chips on phones

**Priority:** medium · **Audit severity:** medium · **Status:** ✅ **RESOLVED**

**Resolved (1.74.0).** The graph header WRAPS rather than hiding: the
unlinked/broken filter chips and the JSON export are present at every width (the
chip labels collapse to icon + count below `md`), pinned at 375px by the
`surfaces` e2e tier. Fit sits with the zoom controls in the map's docked footer
strip, also at every width. (The colour LEGEND in that strip is still `md:flex` —
a decorative key, not an affordance.)

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`src/ui/GraphView.tsx:617` hides health chips below `md`; `:640` hides Fit below `sm`.

#### Original independently verified finding

**File:** `src/ui/GraphView.tsx:591` (`hidden sm:inline-flex` on Fit), `:566-568` (`hidden … md:flex` wrapping both HealthChips), `:535` (title + counts `hidden … sm:flex`)
**Source:** [26, 106]
At 360–390px the graph header contains only the search input, Zoom out, Zoom in and Back. The canvas is still fully pannable and draggable, and `camTouchedRef` suppresses auto-focus once the user pans — so **a flick can lose every node off-screen with no way back except closing and reopening the overlay**. The orphan/broken chips (which read "0 orphans / 3 broken" on desktop) are the graph's problem-finding feature and are simply absent.
**Fix:** drop `hidden sm:inline-flex` from Fit — it is the single most important recovery affordance and the header already fits three icon buttons at 360px. Keep the chips at all widths (their `hidden lg:inline` label span already collapses them to icon+count, ~44px each), or move both into an overflow menu on narrow widths rather than removing them.

### H6. Ctrl+P prints one page of chrome — 94% of the document is missing

**Priority:** medium · **Audit severity:** medium · **Status:** ✅ **RESOLVED (audit A100)**

An `@media print` block hides the chrome, releases the viewport lock and prints
the rich pane dark-on-white — even in Markdown-only view, since both panes are
always mounted — keeping headings with their text and not breaking inside code,
tables, quotes or images. It is scoped to `.pf-app`, so a library host's own
printing is untouched. The `surfaces` e2e tier emulates print and checks the
chrome is hidden and the document unclipped; the page count is not measured.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

No `@media print` rule exists in `src/`; viewport-locked shell remains `src/App.tsx:122-126`.

#### Original independently verified finding

**Files:** no `@media print` anywhere in `src/` ✅; shell is `h-dvh; overflow:hidden`
**Source:** [95]
`src/store/importExport/print-export.ts` builds its own hidden iframe for File ▸ Export ▸ PDF, but the browser's native print path is untouched. Measured with `emulateMedia({media:'print'})`: `document.scrollingElement.scrollHeight = 800` while `.ProseMirror.scrollHeight = 5046`; `page.pdf({format:'A4'})` yields a page tree of **`/Count 1`**. The user gets menu bar + toolbar + library + status bar + one screenful, with the remaining ~6 pages silently dropped and no hint that Export ▸ PDF exists.
**Fix:** an `@media print` block in `styles.css` that hides the chrome (`[data-tour="menubar"]`, toolbar, `aside`, `footer`, `[data-pane-header]`, overlays), releases the shell (`height:auto; overflow:visible` on html/body and the `h-dvh` container), shows only the rich pane, and reuses the page-break rules already written in `print-export.ts`.

### I2. Host-supplied `accentColor` / `themeVars` / `bg` never reach portaled menus, sheets and popovers

**Priority:** medium · **Audit severity:** medium · **Status:** OPEN

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`src/integration/PerssonifyEditorIntegration.tsx:358-370,391-395` scopes vars to a `display:contents` wrapper; portaled UI still attaches under `document.body`.

#### Original independently verified finding

**File:** `src/integration/PerssonifyEditorIntegration.tsx:389-393` (vars set inline on a `display:contents` wrapper), vs `src/components/ui/dropdown-menu.tsx:32` / `sheet.tsx:50` (`Portal` → `document.body`)
**Source:** [86]
CSS custom properties inherit down the tree; portaled content is not a descendant, so it cannot see them.
**Measured** at `/?accentColor=%23ff0000&bg=%23112233`: in-tree `.ProseMirror` → `--primary #ff0000`, `--background #112233`; portaled `[role="menu"]` (a direct child of `<body>`) → `--primary #f2b202`, `--background #121212`, computed `backgroundColor rgb(25,25,25)`. A themed embed therefore turns visibly two-toned the moment the user opens any menu, the Settings/Memory/Version-History sheets, or any overlay.
**Fix:** either pass a `container` to the Base UI portals that lives inside the themed wrapper, or write the resolved vars onto `document.documentElement` scoped by a wrapper-generated attribute — the pattern `applyPalette` already uses for `data-palette` (`src/theme/palette.ts:66-68`).

### I3. Status bar keeps the deleted document's counts and fidelity warning

**Priority:** medium · **Audit severity:** medium · **Status:** OPEN

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`src/store/documents/documentStore.ts:709-712` clears only identity/save state; `:884-886` no-ops on null canonical, leaving counts/fidelity stale.

#### Original independently verified finding

**Files:** `src/store/documents/documentStore.ts:884-886` (`updateCounts` no-ops on a null canonical), `:711` (`closeTab` resets only identity); `src/ui/chrome/statusBar/index.tsx:80,86`
**Source:** [93]
Delete the last document: `<main>` correctly shows *"No document open"* and `.ProseMirror` unmounts, but the footer still reads `Panel | Split | 1 other not in MD | 672w | 4613c` — statistics and a fidelity warning for a document that no longer exists.
**Fix:** in `closeTab`'s empty branch also `set({ counts: { words: 0, chars: 0 }, fidelityReport: null })`, and make `updateCounts` reset to zero on a null canonical rather than early-returning.

### J1. Windows High Contrast (forced colors) erases three state indicators

**Priority:** medium · **Audit severity:** medium · **Status:** **PARTIAL** (reconciled 2026-09)

A forced-colors block (audit A095) repaints every pressed / selected / current /
highlighted control in `Highlight`, so the active view button is visible, and
gives switches a bordered track and a visible thumb in both states; the `surfaces`
e2e tier checks the pressed view button and the focus outline under forced
colours. Still open: the tour spotlight is only a box-shadow dimmer plus a
`ring-2`, both of which forced colours remove, so first-run High Contrast users
still get captions over an unmarked UI.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

No forced-colors rule in `src/`; color-only mode variant remains `modeSwitcher/index.tsx:32`; switch thumb has no forced-colors border at `components/ui/switch.tsx:17-24`; tour remains box-shadow-driven.

#### Original independently verified finding

**Files:** `src/ui/chrome/modeSwitcher/index.tsx:32`, `src/components/ui/switch.tsx:17,24`, `src/ui/Walkthrough.tsx:170`
**Source:** [96, 97, 98]
- **Mode switcher.** `variant={mode === id ? "default" : "outline"}` — the *only* difference is background/foreground colour, which the UA overrides. Measured with `forcedColors:'active'`: MD `{ap:false, bg:rgb(255,255,255), color:rgb(0,0,0), fontWeight:500}`, HTML identical, Split `{ap:true, …identical}`. The app's primary navigation control gives no visual clue which mode is active. (`aria-pressed` is correct, so SR users are fine — this hits *sighted* HCM users.)
- **Switches.** Track is colour-only (`data-checked:bg-primary data-unchecked:bg-input`) and the thumb is `bg-background … ring-0` with no border. Measured: checked → `{track:#fff, thumb:#fff, thumbX:13}`; unchecked → `{track:#fff, thumb:#fff, thumbX:1}` — the thumb is invisible against its own track, so the pane-header Styled/Images/Styled-paste toggles and *every* Settings switch read as identical empty pills with no confirmation after toggling.
- **Tour spotlight.** The entire highlight is `boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)"`, and Chromium strips `box-shadow` in forced colors — as does the Tailwind `ring-2`. Measured: **zero** elements on the page have any shadow. First-run HCM users get six steps of disembodied captions like *"Every command lives here"* over an un-dimmed, un-annotated UI.
**Fix:** under `@media (forced-colors: active)` — give the active mode button `forced-color-adjust:none; background:Highlight; color:HighlightText` (or a non-colour cue: bold/underline/check glyph); give the switch thumb `border:1px solid CanvasText` and the checked track `forced-color-adjust:none; background:Highlight`; replace the spotlight with four opaque `Canvas` rectangles around the hole, or add `outline:3px solid Highlight; outline-offset:2px` (outline survives forced colors).

### J2. The entire status bar is one `aria-live` region containing the live word/char counters

**Priority:** medium · **Audit severity:** medium · **Status:** ✅ **RESOLVED (by 1.77.0; narrowed further by audit A096)** — this entry was still marked OPEN (audit A111)

The `<footer>` carries no role or live region, so it keeps its `contentinfo`
landmark and the counters are silent. The one live region is a visually hidden
`role="status"` that speaks only when saving starts failing, fails differently or
recovers (`src/ui/chrome/statusBar/save-announcer.ts`); `a11y-save-announcer.test.jsx` asserts it
is the only live region and stays quiet through routine autosaves.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`src/ui/chrome/statusBar/index.tsx:88-91` still wraps all status-bar content in `role="status" aria-live="polite"`.

#### Original independently verified finding

**File:** `src/ui/chrome/statusBar/index.tsx:90-92` (`<footer role="status" aria-live="polite">`) wrapping `:222-225`
**Source:** [60]
`counts` updates on every sync debounce, so a screen-reader user typing hears the whole bar re-announced continuously — title, view mode, link count, save state, storage %, word count, char count. Dictation and SR editing become effectively unusable. Separately `role="status"` on `<footer>` overrides the implicit `contentinfo` landmark, removing the status bar from landmark navigation.
**Fix:** drop `role="status" aria-live="polite"` from the `<footer>` (restoring `contentinfo`) and put a narrow `role="status" aria-live="polite"` only on the save-state cluster (`:170-207`) — the one genuinely announce-worthy value. Leave the counters silent.

### J3. Graph's `sr-only` fallback list duplicates every node as an invisible tab stop

**Priority:** medium · **Audit severity:** medium · **Status:** OPEN

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`src/ui/GraphView.tsx:1008-1017` retains focusable `sr-only` fallback buttons; graph nodes remain separately focusable.

#### Original independently verified finding

**File:** `src/ui/GraphView.tsx:823` (`<ul className="sr-only">` of `<button>Open {title}</button>`)
**Source:** [48]
`sr-only` clips but does not remove from the tab order, and there is no `focus:not-sr-only`. Since each node `<g>` is already `tabIndex={0} role="button"` (`:714`), every document is reachable **twice** — once with a visible focus ring, then again as a completely invisible button. In an N-document workspace, focus appears to vanish for N consecutive Tab presses.
**Fix:** `tabIndex={-1}` on the sr-only buttons (they stay available to SR users via the nodes' aria-labels), or drop the duplicate list now that the nodes are focusable and Enter-activatable.

### J4. Color contrast failures

**Priority:** medium · **Audit severity:** medium · **Status:** **PARTIAL** (reconciled 2026-09)

(a) Blue and emerald fills now take near-black ink, (b) violet and rose declare a
lighter dark-mode accent for text, and (d) `--muted-foreground` was darkened to
40% lightness (5.05:1 on `--muted`); `a11y-contrast.test.js` measures every
palette in both themes (audits A092, A095). Still open: (c) the two empty-state
hints ("Add headings…" in the Outline, "Create notes and link them…" in the map)
keep `opacity-70` on muted text — about 3:1 by the token values, unmeasured.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`src/styles.css:171-189` keeps white foreground on blue/emerald palettes; `:197-205` resets dark `--primary-strong` to `var(--primary)`, preserving the cited conditional contrast risk.

#### Original independently verified finding

**Source:** [56, 57, 67, 68]
| # | Tokens | Ratio | Scope |
|---|---|---|---|
| a | `--primary-foreground` #fff on `--primary` — **emerald** `hsl(160,84%,39%)` / **blue** `hsl(201,90%,48%)` (`styles.css:181`) | **2.59:1** / **3.04:1** | every primary button + selected segment of every segmented control (`button.tsx:12`, `SettingsSheet.tsx:208`) |
| b | `--primary-strong: var(--primary)` in dark (`styles.css:102`) — **violet** / **rose** | **3.31:1** / **4.01:1** | all MD-pane H4–H6, inline links, list markers (`codeMirrorPane/index.tsx:141-154`) |
| c | `text-muted-foreground` + `opacity-70` at 11–12px (`DocNavPanel.tsx:26`, `GraphView.tsx:606`) | **2.74:1** light | the two empty-state hints that tell a new user what to do next |
| d | `--muted-foreground` on `--muted` (`styles.css:46-47`) | **4.04:1** | About page's permanent 10px license chips; segmented-control hover |
**Honesty:** (a) and (b) only appear after the user explicitly picks a non-default accent — `DEFAULT_PALETTE` is **amber** (`theme/palette.ts:26`), which passes at ~9.4:1 / ~10:1. (b)'s H1–H3 clear the 3:1 large-text allowance. The often-quoted `--muted-foreground` vs `--background` = **4.47:1** is a 0.7% miss no user can perceive and is **not** worth listing as a defect; the `--muted` pairing is.
**Fix:** give blue and emerald a dark `--primary-foreground` (as amber already does) or darken their `--primary`; give violet/rose an explicit dark-mode `--primary-strong` (≈`hsl(262,90%,72%)` / `hsl(347,90%,68%)`) instead of blanket-aliasing; drop `opacity-70` from the two hints (plain `text-muted-foreground` is already 4.83:1 on card); darken `--muted-foreground` to ≈`hsl(220 9% 40%)`. Add a unit test asserting `contrast(--primary-foreground, --primary) ≥ 4.5` for every palette.

### J5. Bottom-tray tabs use `aria-selected` on plain buttons

**Priority:** low · **Audit severity:** low · **Status:** ✅ **RESOLVED (audit A093)**

The tray's tabs are a real tablist: `role="tab"` buttons with `aria-selected` and
`aria-controls` inside a `role="tablist"`, one `role="tabpanel"`, one tab stop
with arrow keys that move and activate; the collapsed tray is `inert`. Pinned by
`a11y-tray-inert.test.jsx`.

#### v1.70.0 revalidation (history — the Status line above is current)

**Status:** OPEN at imported predecessor SHA `41e831e44b4a8830168b94d13e74c962e3bb0626`.

`src/ui/chrome/bottomTray/index.tsx:34-45` still uses `aria-selected` on implicit buttons without tablist/tab semantics.

#### Original independently verified finding

**File:** `src/ui/chrome/bottomTray/index.tsx:37-40` (no `role="tab"`, container has no `role="tablist"`)
**Source:** [69]
`aria-selected` is not permitted on the implicit `button` role, so AT ignores it (axe `aria-allowed-attr`); the selected state is conveyed by background colour only. `WorkspacePanel.tsx:200` gets this right with `aria-pressed`.
**Scope caveat:** the tray ships with **one** tab by default — the Console tab is spread in only when the admin `consoleEnabled` flag is on (`PerssonifyEditor.tsx:2116-2124`, defaulted false at `uiStore.ts:133-135`) — so the ambiguity only materialises for operators.
**Fix:** swap `aria-selected` → `aria-pressed` to match the WorkspacePanel pattern, or add the full `tablist`/`tab`/`tabpanel` triad with `aria-controls`.
