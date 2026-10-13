# v1 → current — the full feature delta (builder handoff)

> **What this is.** A self-contained, area-grouped summary of everything that changed
> between the **initial import ("v1")** and **v1.60.0**, plus a summary of **v1.60 →
> v1.71** at the end. It is the document to hand to anyone rebuilding, extending, or
> auditing the app — it tells you what the baseline already did, what the app does now,
> and every meaningful **Added / Changed / Removed / Fixed / Security** step in between,
> grouped by subsystem with representative commit references.
>
> **Scope note:** the detailed subsystem sections below run to **v1.60.0**. Everything
> after that is summarised in [Since v1.60 — the short version](#since-v160--the-short-version)
> at the foot of this document; the per-version detail lives in
> [`../CHANGELOG.md`](../CHANGELOG.md).
>
> For the terse, version-by-version log see [`../CHANGELOG.md`](../CHANGELOG.md). For the
> authoritative current feature reference see [`features.md`](features.md); for the file
> map and load-bearing invariants see [`../CLAUDE.md`](../CLAUDE.md).

---

## The two endpoints

### v1 baseline (commit `9c331d1`, "Initial import")

The initial import was already a capable dual-pane editor. It shipped:

- **Dual-pane editing** — a CodeMirror 6 raw-markdown pane and a TipTap/ProseMirror rich
  pane, bidirectionally synced, with **ProseMirror JSON as the canonical source of truth**.
- **View modes** (Markdown / Rich / Split), **focus mode**, core block/inline formatting,
  **tables**, colors/highlight/font/alignment, inline links + link bubble menu, and
  **Find & Replace**.
- **Clean vs Styled** sync modes (strip vs preserve decorative styling).
- **Document management** — multiple documents in a **tab bar**, a **sidebar** list with
  search and drag-drop import, create/rename/duplicate/delete, **auto-save + session
  restore** to IndexedDB.
- **Import/export** across Markdown / HTML / ProseMirror JSON, plus **Copy as Prompt**.
- **Wiki links** (`[[…]]`), a **backlinks panel**, and a force-directed **knowledge graph**.
- Advanced Tiptap extensions: **field blocks** (`:::fields:::`), **transclusions**
  (`![[…]]`), **block IDs** (`^id`).
- An **embed/integration API**, dark/light theme, responsive layout.
- Client-only: no backend, no auth, IndexedDB persistence. Ships as library + app.

It also carried real rough edges: 34 `tsc` errors, no CI, no license, a broken
background-color round-trip, table-cell formatting silently stripped, build/CLI deps in
the wrong section, and two independent version numbers. Internally it identified as
`1.4.0`.

### Current release (v1.60.0)

Same core mental model, dramatically expanded and hardened. The tab bar and standalone
sidebar are gone, replaced by a **menu bar** + a left-docked **Workspace panel** (Files /
Outline). The editor gained math, diagrams, callouts, collapsible details, task lists,
emoji, theme-aware/sized images, YAML front matter, and a rich typography/reading system.
Import/export grew URL import, archives (zip/tar, encrypted), DOCX in/out, PDF/print, and
re-importable full-library backups. The knowledge graph became a full-screen **map-only
relationship overlay** with search and orphan/broken-link health. A **four-layer
data-loss defence** (blank-save backstop, live-canonical merge, switch-generation guards,
sidecar snapshot version-history) was engineered after a real data-loss scare. Security
was hardened across an import relay, CSS injection, prototype pollution, and DOMParser.
CI runs on every PR; the app is a PWA with offline support; there are ~55 test suites.

---

## Added

### Editor & sync
- **Reading & typography controls** — font size, line height, reading width (CSS custom
  properties read by both panes), spellcheck toggle, and a chrome-dimming **focus mode**
  (v1.35.0).
- **Interactive task lists** (`- [ ]` / `- [x]`) as real `TaskList`/`TaskItem` nodes with
  full round-trip and correct nesting (v1.36.0, v1.37.1).
- **Content-aware scroll sync** — heading-anchored piecewise-linear mapping between panes,
  with value-based echo suppression (v1.24.0, v1.17.0).
- **Right-click context menu** in the editor (format / insert / link-to-heading / clipboard
  / undo-redo), admin-gateable (v1.17.0, v1.18.0).
- **Case transforms** (UPPER / lower / Title / sentence) on selection or all headings,
  "content-only" aware so it never mangles code or syntax (v1.21.0).
- **Read-only mode** — both panes non-editable, every programmatic mutation gated, view
  mode locked, toolbar hidden (v1.25.0).

### Markdown features
- **Markdown flavors** (CommonMark / GFM / Markdown Extra) with per-feature toggles
  (tables, task lists, strikethrough, autolink, footnotes), driven by a Settings panel and
  a per-instance `marked` build (foundation batch, v1.5.0).
- **LaTeX math** (`$…$` / `$$…$$`) rendered live via KaTeX with full round-trip, plus an
  **equation authoring dialog** with live preview (foundation; v1.37.0).
- **Mermaid diagrams** and **ABC music notation** rendered live in a cohesive framed
  code-block card with inline editing; theme-aware (foundation; v1.19.0, v1.20.0).
- **Emoji** shortcodes (`:name:`) with a dedicated node for round-trip (foundation batch).
- **Callouts / admonitions** (`> [!NOTE|TIP|…]`) (v1.38.0) and **collapsible details**
  (`<details><summary>`) (v1.39.0).
- **YAML front matter** support (v1.5.0).
- **Theme-aware images** (`#gh-light/dark-mode-only`, `<picture>` → `themeImage` node) and
  **sized images** (`width`/`height` preserved) (v1.19.0, v1.20.0).

### Documents & workspace
- **Menu bar** (File / Edit / Insert / View / Format / Tools / Help) replacing the tab bar,
  with About/Shortcuts dialogs and a trimmed toolbar (v1.9.0).
- **Unified Workspace panel** — one left-docked tabbed tray (Files / Outline) that replaced
  the standalone sidebar and the doc-nav expand ladder (v1.54.0, v1.55.0, v1.57.0, v1.58.0).
- **Nested folders** (create/rename/delete/move, cycle-guarded) as a prefs overlay, with
  drag-and-drop and explicit ordering (foundation; v1.9.0 explorer reorder).
- **In-editor Outline / table of contents** with a live active-heading tracker (v1.34.0,
  v1.44.0, v1.45.0).
- **Bottom tray** — expandable tabbed tray (Document Links, admin Console) replacing the
  always-on backlinks strip (v1.34.0, v1.42.0).
- **Status bar** redesign — far-left expand/collapse chevron + responsive contextual detail
  (v1.29.0).
- **Version history** — Tools ▸ Version history restores prior content in place or as a new
  doc (v1.31.0).
- **Memory dialog** + status-bar memory/storage chips (v1.30.x lifecycle work).
- **Library row context menu** — right-click / long-press with per-document export in any
  format (v1.43.0).

### Import / export
- **Import from URL** — Google Drive / GitHub / Dropbox / generic, via a hardened
  first-party Vercel relay, with preview/selection and shareable `?import_url=` links
  (v1.7.0, v1.8.0).
- **Archive import/export** — `.zip` / `.tar` / `.tar.gz` / `.gz`, loose files wrapped in an
  archive-named folder; **encrypted-ZIP** detection + password prompt (foundation; v1.23.0).
- **DOCX import** (lazy `mammoth` → HTML → ingest) (v1.40.0) and **DOCX export** (v1.5.0).
- **PDF / print** export (v1.5.0).
- **Full-library backup** — export every doc as a re-importable JSON envelope in a ZIP;
  restore reproduces exact library state; timestamped export filenames (v1.29.0).

### Knowledge graph
- **Map-only relationship overlay** — full-screen force-directed graph of the whole
  workspace (documents as nodes, `[[wiki links]]` as edges, folders as labeled clusters),
  opening directly on the map with the active doc focused (v1.59.0).
- **Search** (dim non-matches, focus a note) and **orphan + broken-link health chips**
  with an off-by-default ghost-target overlay (v1.59.0).
- Camera: fit-to-content on settle, wheel-zoom at cursor, folder-cohesion clustering;
  physics freezes once settled (v1.13.0-era camera rework, v1.18.0 clustering).
- Opened from View ▸ Relationship map, the graph button, the status bar, or **⌘⇧G**.

### Find / Replace
- **Floating draggable panel** with Find|Replace segmented mode, cursor-based target pane,
  Find-all / Replace-all, scrollbar match markers, and MD **scope/format filters**
  (include/exclude by region) (v1.26.0, v1.28.0).
- **Format matches** — apply bold/case/etc. to all matches (v1.21.0).
- Regex, case-sensitive, whole-word options persisted; keyboard shortcuts toggleable
  (v1.28.0).

### Theming / UX
- **Theme / accent selector** — light/dark/system plus accent palettes, applied before
  first paint; a mono palette option (foundation; v1.19.0 System; v1.26.0 circles).
- **First-run guided tour** (spotlight walkthrough) and routed **/about**, **/help**,
  **/graph** interior pages with a real client-side router (v1.9.x pages batch).
- **Diagnostics console** — admin-gated, curated read-only command registry (v1.42.0).
- **Optional display ads** behind a setting + `?ads=` param, chrome-gated, offline-safe
  (v1.23.0).
- **Share / embed link builder** (Tools) composing standalone + iframe snippets (v1.30.0).

### Embed / integration
- **Official iframe embed build** (`dist-embed/`) with a `postMessage` host bridge
  (v1.5.1, v1.5.2).
- Bridge actions — `setMode` / `setAccent` / `openDocument` / `addDocuments` /
  `updateDocument` / `appendToDocument`; `chrome` control, transparent background
  (v1.5.3, v1.6.0).
- Host theming — accent palette + scoped custom accent, sanitized (foundation integration
  round).

### Offline / tooling
- **Service worker / PWA** — offline support for the app build with bulletproof update
  handling (no-cache headers, NetworkFirst navigations) (v1.5.0, v1.9.0-era chunk fix).
- **CI** (`.github/workflows/ci.yml`) on every PR — `tsc`, tests, and all three builds
  (foundation batch).
- MIT `LICENSE`, coverage tooling, `CLAUDE.md`, and an expanding Vitest suite (~55 files).

---

## Changed
- **Canonical projection**: `marked` moved from a global singleton to a per-instance build
  so flavor toggles apply at runtime (v1.5.0).
- **Navigation shell**: tab bar → menu bar; standalone sidebar + doc-nav "closed|toc|split|
  full" ladder → unified Workspace panel (Files / Outline) (v1.9.0 → v1.58.0).
- **Graph**: iterated through document-first-with-sidebar and an in-panel structure map,
  then **settled on map-only** — single-doc structure lives in the Outline tab, the graph
  is the whole-workspace relationship map (v1.32.0 → v1.57.0 → v1.59.0).
- **Doc titles** derive from the first heading with explicit user-rename provenance
  (`titlePinnedByUser`) instead of a placeholder-string heuristic (v1.16.0, v1.41.0).
- **Link index** became incremental on content edits (was a full library re-read per
  autosave) (v1.48.0).
- **Autosave** switched to idle + lazy sync (with a Web Worker path) and autosaves on doc
  switch so graph/backlinks reflect typed content (v1.5.0 refactor; v1.16.0).

## Removed
- **Tab bar** and the standalone **Sidebar** component (replaced by menu bar + Workspace
  panel).
- **In-panel graph / Map tab** and the `DocumentGraph` / `StructureMap` components (the
  overlay is the graph; the Outline tab is single-doc structure) (v1.57.0).
- Dead legacy `useDocumentStore.ts` file (the live Zustand store keeps the same export
  name), committed build artifacts, and the doc-nav size-machine in `uiStore` (v1.60.0).
- The removed Vercel edge-middleware **password gate / auth** (documented in `auth.md`).

## Fixed
- **Background-color / highlight** round-trip (canonicalized on a `textStyle`
  `backgroundColor` attribute) (foundation).
- **Table-cell rich formatting** round-trip (the per-cell converter had relied on an unset
  `window.TurndownService` global) (foundation).
- **Strikethrough** restricted to double-tilde only; sub/superscript round-trip as HTML so
  a stray `~`/`^` is literal (v1.33.0).
- **Wiki links** no longer escaped in the Markdown pane (v1.16.x).
- **Find/Replace** rich-pane Next/Prev "stuck on match 1"; multi-range selection requires
  `drawSelection()` (v1.30.2, v1.42.x).
- **Mobile ☰ menu crash** (Base UI #31 — GroupLabel needs a Group) and app-shell overflow
  (v1.16.0).
- **Images** no longer clipped by rounded corners (v1.24.0).
- Extensive **data-integrity race fixes** — save lockout, autosave re-arm loops,
  clear/rename/hash bugs, switch-completion desync, rename-ignored-by-export (v1.30.x,
  v1.41.0, v1.50.0, v1.52.0).
- **IME / voice-dictation** aware sync (composition guards) so dictated text isn't dropped
  (v1.51.0).
- All 34 initial `tsc` errors; the gate is green and CI-enforced (foundation).

## Security
- **Import relay** (`api/import.js`) forces `application/octet-stream` + attachment + a
  locked-down CSP, never reflects upstream `Content-Type`/`Disposition`, requires
  same-origin `Sec-Fetch-Site`, and restricts ports — closing a reflected-XSS/SSRF vector
  (v1.8.1).
- `?import_url=` **pre-fills but never auto-fetches**.
- Host-supplied CSS colors go through `sanitizeCssColor` (rejects `url(`/`expression(`/
  `var(`/`;{}`).
- `htmlToCanonical` parses via an inert `DOMParser`, never `innerHTML` on a live element.
- **Archive path safety** — `normalizeArchivePath` strips absolute roots, Windows drives,
  `..`/`.`, and prototype-pollution keys before any path is trusted.
- iframe host bridge `allowedOrigins` **defaults to deny** (`[]`) — embedders opt in.
- Ingest/paste sanitizers strip `on*` handlers and `javascript:` / non-image `data:` URLs.

---

## The six-layer data-loss defence (read before touching the save path)

Engineered after the owner reported a document being wiped by an unintentional action.
"The document" exists as up to four representations that can drift; the protection is
layered (see [`../CLAUDE.md`](../CLAUDE.md) invariants for the exact rules). Layers 1–4
were the original four; 5 and 6 close gaps found later, and the numbering is kept so the
older references still resolve:

1. **Blank-canonical save backstop** — `saveActiveDoc` refuses to persist a blank canonical
   over a stored doc with real content; fails closed; parks a terminal `"blocked"` status.
   The only sanctioned blank persist is explicit **Clear document** (v1.30.4).
2. **Stale-overwrite prevention** — `renameDoc` / `patchDocById` merge onto the **live**
   editor content via `registerLiveCanonical`, not the lagging on-disk copy (v1.30.5).
3. **Switch-generation guards** — `switchGenRef` (editor hydration) + `switchSeq` (store
   `activeDocId`) abort stale rapid-switch settles; both required (v1.30.6, v1.32.3).
4. **Recoverable snapshot net** — a **sidecar IndexedDB** keeps a bounded per-doc ring of
   prior versions; snapshots before overwrite/delete; restore via Version history (v1.31.0).
5. **Synchronous unload stash** — IndexedDB cannot finish a write while the page is being
   torn down, so `beforeunload`'s best-effort autosave never landed. A localStorage stash
   (`pf:recovery`) is written on `beforeunload` **and** `pagehide`, honours the same
   blank-over-content backstop, is one-shot, bounded and expiring, and is adopted by
   `initialize` before a document is activated (v1.74.0).
6. **Document-leaving discipline** — every path that leaves the open document
   (import, host `addDocuments`, Cards quick capture, close/delete/switch) runs
   `prepareToLeaveActiveDoc()` and ends any live composition rather than waiting for one;
   every path that hydrates the editor after an await re-checks ownership and its switch
   generation. Each of these was, at some point, a route by which the current autosave
   window was silently discarded (v1.71.0–v1.74.0).

A recorded decision **deferred** a full doc-lifecycle state-machine rewrite (highest blast
radius, already protected + regression-tested); do the FSM extraction the next time this
layer is substantively changed (e.g. multi-tab `conflict` or a multi-file project model).

---

## Representative commit references

| Area | Commits |
| --- | --- |
| Foundation (license, CI, flavors, math, diagrams, folders, archives) | `1075eb2`, `c7e032b`, `f4b284f`, `bee4f08`, `a0f11ca`, `86b0556`, `64f9812` |
| Integration / embed / URL import | `8e4b6af` (v1.5.0), `0f9da6a`, `4aa3f27` (v1.6.0), `602a7cb` (v1.7.0), `3ee0ca3`/`f7a249f` (v1.8.x) |
| Menu bar / pages / tour | `c50c73b` (v1.9.0), `6fad875` |
| Editor UX (scroll sync, context menu, anchors, case, F/R, read-only) | `55900cf` (v1.17.0), `9f7c943` (v1.18.0), `14c459b` (v1.21.0), `6c57371` (v1.23.0), `d268b5c` (v1.25.0), `96d096f` (v1.26.0) |
| Data-integrity phases | `cf58345` (1.30.5), `976a6b6` (1.30.6), `d5f0375` (1.31.0), `a0080af` (1.32.3) |
| Typography / task lists / callouts / details / DOCX / console | `f0cdbc2` (1.35.0), `7334e20` (1.36.0), `e491642` (1.37.0), `079903c` (1.38.0), `736aad9` (1.39.0), `e236a25` (1.40.0), `728d47f` (1.42.0) |
| Incremental links / dictation / audit | `1f11bee` (1.48.0), `6846149` (1.51.0), `ba9696b` (1.52.0) |
| Workspace panel / mobile / graph | `3eb26dc` (1.54.0), `c29efc6` (1.55.0), `0637b19` (1.57.0), `0436850` (1.58.0), `4ccf7c6` (1.59.0) |

> `git log` is the authoritative history; every feature commit subject after v1.35 carries
> its `(vX.Y.Z)` tag. This table is a navigational aid, not an exhaustive list.

---

## Since v1.60 — the short version

The detailed sections above stop at v1.60.0. This is what changed between then and
**v1.74.1**, by subsystem. Per-version detail is in [`../CHANGELOG.md`](../CHANGELOG.md).

### Surfaces

- **Cards board** (1.64) — a Keep-style wall over the whole library: quick capture,
  checklists, colours, pinning, search. An overlay over `<main>` with the live editor
  still mounted beneath it.
- **Workspace views became one exclusive selection** (1.66–1.67) — `Editor · Cards · Map`
  as a three-way switcher. They were two independent booleans and could both mount at
  once, with the map invisible *beneath* Cards. Editor is a first-class option, not
  "both overlays off".
- **The relationship map was rebuilt** (1.68–1.71) — see below.

### The relationship map

- **1.68–1.69:** three seeded starter documents so the map opens on a real graph; a
  zero-edge explanation instead of a dot field; an inspector listing headings and both
  link directions; folder labels that stop covering their own contents.
- **1.71:** the map became **three docked regions** (header · map + footer strip ·
  details rail) with nothing floating over the canvas — the inspector used to be pinned
  *over* the map while the camera fitted content to the full rect, so the graph centred
  itself underneath the panel. Physics moved into its own world space (a resize re-aims
  the camera instead of reshuffling the layout), convergence became deterministic, every
  drawn glyph is sized in screen pixels, labels are placed by a solver that guarantees
  **no text is ever drawn over**, folder containers got one shared geometry definition
  and hard separation, and the settle got ~2.4× faster on a large library by advancing
  several simulation steps per rendered frame.

### Library / embed parity

- **1.63:** the published package ships its CSS and types.
- **1.71:** the published stylesheet no longer resets the page that imports it (the
  `base` layer is confined to the editor's subtrees in the library build only, including
  portalled surfaces); the integration writes a namespaced `data-pf-theme` attribute
  instead of rewriting the host's `<html>` class; a pinned theme is now honoured by the
  JavaScript as well as the CSS (`useIsDarkTheme`), which is what makes the embed's
  documented `?theme=` parameter actually work; `setDocuments` stopped being a silent
  no-op; the host bridge exposes everything the handle does and rejects unknown actions.

### Content integrity

- **1.71:** a state audit closed several paths by which an edit could be lost or a
  document overwritten by another — a host adding documents destroying unsaved work, an
  import leaving the editor showing the previous document under the new identity, a blank
  draft written on tab close after the save path had refused it, a save racing a delete,
  and a snapshot-ring id collision that could restore the **wrong version**. Surfaces that
  read the library (Cards, the map, backup and bulk export) now see live content rather
  than the last saved copy.
- **1.71:** import fidelity became readable — the status bar's residual count opens a
  grouped, plain-language list of what the source contained that the model cannot
  represent.

### Sync scheduling

- **1.73:** the cross-pane debounce was purely trailing and reset by every keystroke, so
  while you typed continuously the other pane never updated at all — and how long it
  waited came from the document's *length* (300/500/800ms). Both are gone. The idle delay
  and a max-wait ceiling are now derived from a moving average of what recent projections
  measurably cost on this device ([`src/hooks/sync-schedule.ts`](../src/hooks/sync-schedule.ts),
  pure and unit-tested). Only projections that actually **ran** are measured — most calls
  are gated out by the hash/doc-identity checks and return in microseconds, and folding
  those in would make every document look free.

### Content integrity, continued

- **1.74:** composition (IME / voice dictation) data loss — four measured paths, each
  fixed against a real composition driven through CDP rather than a mocked boolean: a
  projection deferring for the wrong pane, a stuck `composing` flag left behind by an
  undo, document-*leaving* paths hydrating over a live composition instead of committing
  it, and a formatting chord dispatched mid-utterance.
- **1.74:** `beforeunload` alone never covered unload — IndexedDB cannot complete a write
  while the page is torn down. A synchronous localStorage stash
  ([`src/store/persistence/crash-recovery.ts`](../src/store/persistence/crash-recovery.ts)) is written on both
  `beforeunload` and `pagehide` (iOS Safari fires only the latter) and adopted on the
  next `initialize`, one-shot and bounded.
- **1.74:** a dropped file navigated the tab away, taking the current autosave window
  with it — the one gesture that leaves no draft, no undo and no snapshot.
- **1.74:** every asynchronous path that ends in `hydrateEditorWithDoc` now claims and
  re-checks a generation, so a read that settles for an abandoned switch cannot write
  into the document you moved on to.
- **1.74:** a failing save says it is failing, and the terminal blank-over-content and
  multi-tab-conflict states have their own status-bar messages instead of reading
  "Unsaved changes" or nothing at all.

### Controls that did not do what they said

- **1.74:** a sweep by defect class found and fixed a set of controls that were dead or
  wrong rather than merely imperfect — six documented shortcuts inert in the rich pane
  (⌘⇧9 inserted a task list where the docs said blockquote); right-click ▸ Insert ▸
  Image / Formula / Inline math silently doing nothing; Clear formatting, indent, outdent,
  justify and colour-clearing missing on the markdown side; the map losing its filters and
  its only JSON export below 640px; library search serving a stale index; a conversion
  error freezing one pane for the rest of the session; and `deleteForDoc` deleting no
  snapshots at all.
- **1.74:** **strikethrough was destroyed by the sync.** TipTap renders `<s>`; turndown's
  core is CommonMark and this project does not load `turndown-plugin-gfm`, so an element
  no rule matches keeps its text and loses its tag. Nothing warned, because `fidelity.ts`
  classes strike as a native mark. Test both directions of every round-trip.
- **1.74:** **indent** was dead inside checklists (the item node is `taskItem`, not
  `listItem`) and over-eager in the markdown pane, where two presses on a paragraph turned
  it into an indented code block. Both panes now no-op in the same places.
- **1.74.1:** the same mistake in the other direction. `fidelity.ts` classified marks by
  intuition rather than against the Turndown rule tables, so it warned about underline,
  sub/superscript and image sizing — all of which have rules and survive both modes. The
  shipped Welcome document carries a sized logo, so a new library opened with an amber
  "1 other not in MD" about formatting that was never at risk. Classification now comes
  from the rule tables, and `clean-vs-styled.test.js` measures the real Turndown output
  behind every claim the docs make about the two modes.

### Embed / integration, continued

- **1.74:** the shipped iframe build could never receive a host message — it passed its
  *own* origin as `allowedOrigins`. It now resolves them from a validated
  `?allowed_origin=` (a literal `*` is rejected), else the referrer's origin, else
  deny-all; and `createEditorClient` derives the editor's origin from the iframe's `src`
  instead of defaulting to `"*"` in both directions.

### Docs

- **1.71:** [`import-relay.md`](import-relay.md) documents the only server-side code in
  the product — request path, threat model, testing, limitations, hardening roadmap.
- **1.74:** [`gotchas.md`](gotchas.md) gained the landmines this sweep produced; `#Lnnn`
  anchors from `docs/` into `src/` are gated by `doc-anchors.test.js` (`node
  scripts/doc-anchors.mjs --fix` repairs them); and [`../e2e/README.md`](../e2e/README.md)
  states what the browser campaign does **not** cover, which is the half that decides
  what "the tiers are green" is worth.
