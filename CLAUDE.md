# CLAUDE.md — agent context for Markdown Studio

> **The product is Markdown Studio** (home: markdownstudio.com). The repo, the
> npm package (`@perssonify/editor`) and every DATA identifier keep their old
> names ON PURPOSE — `pf:` preference keys, the `perssonify-document` export
> envelope, `perssonify-backup` archives and the `perssonify-snapshots` IndexedDB
> database are on-disk contracts with existing installs. Renaming them orphans
> users' documents. The display name lives in `APP_NAME` (`src/constants.ts`)
> with `APP_DOMAIN`/`APP_URL` beside it; surfaces that can't import TypeScript
> (index.html, embed.html, site.webmanifest, the PWA manifest in
> vite.app.config.ts) are pinned to it by `src/__tests__/app-identity.test.js`.

`@perssonify/editor` is a **dual-pane, bidirectionally-synced Markdown editor**:
a CodeMirror 6 raw-markdown pane and a TipTap/ProseMirror rich pane kept in sync.
Client-only (no backend, no network calls). Ships as both an embeddable library
(`dist/`) and a standalone app (`dist-app/`). Package manager: **Bun**.

## Where things live
- `src/App.tsx` — standalone-app shell: routing (`src/app/router.tsx`, history API,
  real `/about` `/help` `/graph` paths — Vercel already SPA-rewrites non-`/api`),
  interior pages, and the first-run guided tour.
- `src/ui/pages/` — routed interior pages (`AboutPage`, `HelpPage`, shared
  `PageChrome`); copy/data in `help-content.ts`, `src/data/credits.ts`.
- `src/ui/Walkthrough.tsx` — custom spotlight tour targeting `data-tour="…"`
  anchors on real UI (menubar / mode-switcher / settings / toolbar / editor).
- **First-run library** (`src/data/starter-documents.ts` + `DEFAULT_CONTENT`): the app
  seeds **three** cross-linked documents, not one — **Welcome** (the `initialDocument`),
  **Changelog** (a living in-app release log, meant to be cleared at each release), and
  **About Perssonify** filed in a `Perssonify` FOLDER. They `[[wiki link]]` to each other
  ON PURPOSE: with a single document the relationship map opened on one unconnected dot
  with nothing to explore, and the folder gives it a labelled cluster too. Seeded via PE's
  **`starterDocuments`** prop — standalone app ONLY (`App.tsx`); an embedder's
  `initialDocument` stays exactly one document. They are seeded through the ordinary
  `importItems` path AFTER the initial doc is live (so the editor is mounted and a real
  canonical is captured), then it switches back to Welcome; failures are caught so
  startup can't break. Only when storage is empty — deleting them is permanent.
  **Wiki links resolve by TITLE, which comes from the first `# H1`** — renaming a
  heading silently breaks the seed graph, so `src/__tests__/starter-documents.test.js`
  asserts every link target is a seeded title and no document is orphaned.
- `src/store/doc-outline.ts` — `extractHeadings(canonical)` + `buildHeadingTree()`
  (stack-nesting), consumed by the Workspace Outline tab. **`src/ui/GraphView.tsx`
  is the MAP-ONLY knowledge-graph overlay** — the force-directed relationship graph
  of the whole workspace (documents + wiki-links + folder clusters).
  **There is NO in-graph document-structure view** — single-doc structure lives in
  the **Workspace panel's Outline tab** (`WorkspacePanel.tsx`, visible beside the
  overlay, which only covers `<main>`); an in-graph structure pane + Document⇄Map
  toggle were REMOVED (they duplicated that Outline). `DocumentGraph.tsx` was
  DELETED. The graph tracks `activeDocId` and never carries its own library tree
  (the Files tab is the library).
  - **LAYOUT — three DOCKED regions, nothing floats over the canvas** (header ·
    map + slim footer strip · details rail). The rail used to be an `absolute`
    card pinned over the map while the camera fitted content to the FULL canvas
    rect: the map centred itself *underneath* the panel, so the note you selected
    was the note you could no longer see. The rail is a flex sibling — right
    column on `lg+`, docked bottom sheet below that (`railOpen`, header
    `PanelRight` toggle, default open only on wide viewports; **selecting a node
    on a narrow viewport opens it**, or a tap would appear to do nothing). The map
    pane measures ONLY its own box (`canvasRef` + ResizeObserver), so fit/focus
    are correct by construction. Map chrome — legend, zoom −/%/+, Fit — lives in
    ONE footer strip; the old floating hint card, zoom badge and broken-targets
    button are gone. Do NOT re-add an overlay over the canvas.
  - **Physics runs in its own WORLD-SPACE** (`worldFor(n)`), never the viewport:
    layout was keyed to the canvas rect, so every resize (docking a panel,
    a window drag) reheated the sim and reshuffled the whole graph. A resize now
    only re-aims the camera. Still a **single-`posRef` mutate-in-place loop that
    FREEZES on settle — do NOT reintroduce a per-loop snapshot** (jump/drift bug),
    and do NOT key it back to the viewport. Convergence is **deterministic**: a
    decaying `alpha` (`ALPHA_DECAY`/`ALPHA_MIN`) fades the forces out in ~110
    frames, plus a `MAX_FRAMES` backstop — an uncooled loop measured 377 frames at
    25 notes and, when it never settled, the post-settle camera fit NEVER RAN and
    the map stayed framed on its initial ring in a corner. `reheat(alpha)` takes a
    temperature: 1 for a fresh layout, `0.25` for a drag nudge. Repulsion scales
    with the NODE COUNT, not the world area (world size already grows with n —
    scaling by area double-counted it).
  - **Camera is OVERVIEW-FIRST**: if the whole workspace fits at `OVERVIEW_MIN_K`
    or better, it fits everything; only a workspace too big to read whole falls
    back to the active doc's neighbourhood (`focusActive` → folder cluster, else
    node+neighbours). It also **tracks the layout while it unfolds** (`recenter(false)`
    each frame — un-animated; smooth is for discrete jumps only) until the user
    pans/zooms/drags (`camTouchedRef`). Breathing room is reserved in SCREEN pixels
    inside `frame()`, not as world padding — labels are drawn at a constant size,
    so a world pad shrank exactly when it mattered and clipped outer names.
  - **Everything DRAWN is sized in screen pixels and divided by `k`** — dots,
    strokes, arrowheads, labels, folder chips — so zoom changes how far apart
    notes are, not how big a note looks. World-sized glyphs inflated into blobs
    at 240% and vanished at 30%. Two deliberate exceptions: **dots are damped
    below 1×** (`dotScale`), because perfectly constant dots turn a zoomed-out
    map into a blob of touching circles and crowd out the labels; and **folder
    container geometry is world-STABLE below 1×** (`gs = 1/max(k,1)` in
    `folderRects`) — screen-sized padding meant zooming out inflated every box in
    world terms until boxes the layout had cleanly separated grew over each other
    and over their neighbours' notes.
  - **NOTHING is ever drawn over text.** This is a draw-time guarantee, not a
    hope: `placeLabels` (pure, unit-tested) resolves every label in SCREEN space
    against everything already placed. Reserved first: **every node dot**, then
    **every folder chip**, then ghost-target stubs. Each name then gets **four
    candidate positions** (below · above · right · left) and, failing those, a
    **compact form** (`shortLabel`) — a single fixed position under the dot meant
    one crowded neighbour silently cost a note its name when there was room an
    inch away, and a phone went almost entirely anonymous. A label is also vetoed
    if it would cross a folder container the note does not belong to (`reject` —
    it cannot be a shared obstacle, since a note's own container must not block
    its own name), or fall outside the canvas (`bounds`). Dropping a label is the
    only sanctioned outcome; the note is still named in the rail and on hover.
    Priority: selection/active/hover, then `rankByDegree`, then the rest. It MUST
    be recomputed every render (positions live in a mutable ref, so a memo keyed
    on the camera hands back a stale placement).
  - **`LABEL_CHAR_W` is a MEASUREMENT, not a guess** (6.0): the widest real
    character average at the map's 11px size, halo included, was 5.67px. An
    estimate that under-measures makes the placer claim fits the rendered text
    does not have, i.e. silent overlap. Re-measure before lowering it.
  - **Reciprocal links bow apart**: two notes linking to each other drew two
    identical stacked lines whose arrowheads read as one ambiguous double-arrow.
    Edges are trimmed to the node borders (so arrowheads land on the edge, not
    under the dot) and a two-way pair curves to the left of its own direction.
  - **Folder containers have ONE geometry definition — `folderRects`** — shared by
    the renderer, the label placer and the layout forces. They each used to
    compute their own approximation, so the box the user saw, the box labels
    avoided and the box clusters were pushed out of were three different
    rectangles. A container **encloses each member's DOT AND ITS LABEL** (worst
    case: the placer may put a name on any side), so it never clips the names of
    the notes it holds.
  - **Container separation is a HARD POSITIONAL CONSTRAINT, not a force.** Applied
    to positions after integration, and deliberately NOT scaled by alpha: as a
    velocity nudge it simply lost to the springs between two linked folders, and
    whatever overlap remained when the forces cooled was the overlap the user saw.
    Three relaxation passes per frame resolve container↔container and
    container↔outsider (measured with the outsider's own label footprint).
    Ejection tries all four walls **nearest-first and picks one that lands FREE** —
    a note wedged in the corridor between two clusters was otherwise shoved back
    and forth and stayed inside one of them. `FOLDER_COHESION` remains the soft
    half (it gathers a folder's members); the layout also reserves room for each
    note's NAME (`TEXT_SEPARATION`/`TEXT_ROOM_Y`), since radial repulsion is blind
    to text and lets two comfortably-spaced dots have names that run through each
    other.
  - **Cluster labels straddle a border** (fieldset-legend style) and the box
    widens to fit — the label used to sit inside, on top of a small cluster's own
    node. The chip **slides along the top border then the bottom** looking for
    clear ground, avoiding other chips outright and node dots by least-overlap
    (four corners was not enough: zoomed out it ran out of slots and stamped a
    folder name over someone's note). Chips stay screen-constant at every zoom —
    they are the landmarks a zoomed-out map is read by — but a name that would
    dwarf its own container is trimmed to fit (`folderChipLabel`).
  - **Node interactions:** click = select; double-click / Enter = open (closes
    overlay); drag = rearrange; wheel + footer zoom buttons + Fit = camera.
  - **Utilities:** a header **search** (dims non-matches, Enter focuses the match —
    layout untouched, never reheats) and **orphan / broken-link filter chips** —
    orphans are already isolated nodes (`findOrphans`); broken links come from
    `linkIndex.unresolved` via the `unresolved` prop (`brokenSourceIds`/`brokenLinks`
    in `src/store/graph-metrics.ts`, unit-tested), highlighted on demand with an
    OFF-by-default ghost-target overlay (ghost nodes are excluded from the sim).
    The chips are the FILTER; the rail lists the actual notes behind each count.
  - **The rail is the whole information layer.** With a node selected: title,
    folder/state tags, three stat cells (links in · out · headings), Open/Focus/
    Isolate, then the document's **headings** (`headingsFor`, capped at 10 — click
    one to open the doc there via `onOpenHeading` → PE's `scrollToHeading`), BOTH
    link directions as clickable documents (`Links out`/`Links in`, from
    `graph.edges` — clicking a row moves the map's selection, the arrow opens it)
    and that note's broken links. Counts alone said a relationship existed but not
    with what. With nothing selected it is a **workspace overview** — Most
    connected (`rankByDegree`), Unlinked notes, Broken links (each row selects the
    note; "Show on map" toggles the ghost targets) — so the header counts have
    somewhere real to lead. The rail tracks the SELECTED node only; hover just
    highlights (a rail that follows the pointer flickers). `selectedId` seeds from
    `activeDocId`, so it is populated on open.
  - When there are nodes but **zero edges**, the map replaces the scatter of
    unconnected dots with an explanation of what a link is plus clickable chips for
    each note — a dot field reads as broken.
  - **Escape** clears an active search/filter first, else closes. Toggled from the
    **top-bar surface switcher** (see below), View ▸ Relationship map, and **⌘⇧G**.
    The header carries the graph **JSON export** (`onExport`) — that button used to
    sit in the global status bar, visible to users who had never opened the map.
  - **NO TEXT IS EVER DRAWN OVER** — re-measured in a real browser across 3/12/25/40/153-note
    workspaces, desktop AND phone widths, at fit / 4 clicks out / 8 clicks in:
    label↔label, label↔dot, label↔chip, container↔container, stranger dot/label
    inside a container, chip↔chip and label↔canvas-edge are all **zero**.
    **`chip↔dot` is NOT zero and cannot be** — that claim used to be here and was
    wrong. Below ~40% zoom the dots converge into a band by design (density, not a
    defect) and a screen-constant chip covers a lot of world, so no slot along a
    container's border is clear; measured, a chip's own LETTERS sat under a node
    dot at 25 and 40 notes. `folderRects` searches harder now (top border, bottom
    border, then just outside each, nine stops per row), but the honest resolution
    is **draw order**: folder boxes paint first (they are a background wash), then
    edges and nodes, then **folder chips LAST**. Everything else on the map is
    PLACED so it cannot collide; the chip is the one glyph that sometimes has
    nowhere free to go, and it is also the landmark a zoomed-out map is read by, so
    it wins the pixel. Do NOT move the chip render back above the nodes —
    `graph-metrics.test.js` pins the source order. If you touch the geometry,
    re-measure rather than eyeball: the pure layer (`placeLabels`, `folderRects`,
    `labelBoxAt`, `labelWidth`, `stepsPerFrame`) is unit-tested in
    `graph-metrics.test.js`, and the DOM carries `pf-node-dot` / `pf-node-label`
    / `pf-folder-box` / `pf-folder-chip` / `pf-chip-label` / `pf-ghost-label` classes
    plus `data-doc-id` / `data-folder-docs` for exactly that purpose.
  - **The two halves of a frame cost wildly different amounts** (`stepsPerFrame`,
    `graph-metrics.ts`). A CPU profile of a 153-note settle never surfaced the
    physics at all — not `stepOnce`, not `placeLabels` (benchmarked at ~1ms) —
    while the frame itself measured a 44ms median, almost all of it style and
    layout for the SVG the render rewrites. So above 60 notes the layout advances
    SEVERAL steps per rendered frame (capped at 6, or one huge library stalls a
    single frame): same steps, same resting layout, a third of the renders.
    Measured at 153 notes: 108 rendered frames / 5.6s / 3.9s blocking → **35
    frames / 2.3s / 1.7s blocking**. At or below 60 notes it stays 1:1, where the
    frame is cheap and step-per-frame is the smoothest way to watch it unfold.
    `framesRef` counts STEPS so `MAX_FRAMES` remains the same hard budget.
  - (History: an earlier build led with the document structure; that was reversed
    once the Outline tab took over structure — do not re-add an in-graph structure
    pane. An earlier build also floated the inspector over the canvas — do not
    re-add that either.)
- **The workspace overlay is a labelled REGION, not a modal.** It covers `<main>`
  only — the menu bar, workspace panel and surface switcher stay usable beside it
  by design — so `aria-modal="true"` told screen readers to ignore controls the
  design intends you to use. Instead, the covered editor (which must stay mounted)
  is marked **`inert`** while an overlay is open, imperatively, because React 18
  does not forward `inert` as a prop. The same pattern covers the interior pages
  (`PageChrome`), which additionally take focus and restore it. Do NOT add a Tab
  trap: the switcher outside is meant to be reachable.
- **Workspace views are ONE exclusive selection** (`workspaceView: "editor"|"map"|
  "cards"` in `PerssonifyEditor`). Cards and the map are PEERS — full-canvas views of
  the whole library, each an overlay over `<main>` with the editor still mounted — so
  they are derived from one value and rendered through **one overlay shell**, not two
  independent booleans. They WERE two booleans, and both could mount at once: two
  `aria-modal` dialogs at the same z-index with the map invisible **beneath** Cards
  (so View ▸ Relationship map looked like a dead menu item), both assigned the same
  `overlayRef` so focus/Escape targeted whichever mounted last. Every open/close goes
  through `setWorkspaceView` / `toggleWorkspaceView`; the graph half must keep routing
  via **`setGraphVisible`** (NOT `setShowGraph`) or the standalone app's `/graph` route
  control desyncs. Surfaced as a **three-way `ButtonGroup` beside the ModeSwitcher**
  (`data-tour="workspace-views"`, `SURFACES` in `MenuBar.tsx`: **Editor · Cards · Map**,
  `aria-pressed`), mirrored by a radio group in the View menu. **Editor is a first-class
  option, NOT "both overlays off"** — leaving a view by un-toggling the button you
  entered through read as an escape hatch. So the switcher buttons SELECT
  (`setWorkspaceView(x)`) while the **keyboard shortcuts stay toggles**
  (`toggleWorkspaceView`, so ⌘⇧K twice returns). Choosing a LAYOUT (MD/Rich/Split)
  routes through PE's `handleSetMode`, which also returns to the editor — those panes
  are invisible under an overlay, so it would otherwise be a control that silently does
  nothing. Same reason the heading/anchor navigation paths call `setWorkspaceView("editor")`
  rather than just `setGraphVisible(false)`. The switcher stays visible because the
  overlay only covers `<main>`. Pinned by `src/__tests__/workspace-views.test.js`.
- `src/ui/MenuBar.tsx` defines its menu content once (`sections`) and renders it
  as a desktop row or, on phones (`useIsMobile`), a single ☰ dropdown that
  **DRILLS DOWN**: level 0 is the collapsed group list (File, Edit, …), tapping a
  group slides into `sections[i].content` with a "‹ All menus" back row
  (`mobileSection` state; reset to null via the menu's `onOpenChange` on close so
  it always reopens at the group list). Navigation rows (group rows + Back) use
  **`closeOnClick={false}`** (Base UI `Menu.Item` prop) so selecting them moves
  between levels instead of dismissing the menu; leaf items keep the default
  close-on-select. This replaced the old flat dump of all seven sections at once
  (an unnavigable long scroll). Deeper submenus inside a section (Export, Table,
  Callout, …) stay as Base UI sub-flyouts. **`DropdownMenuLabel` (Base UI
  GroupLabel) MUST sit inside a `DropdownMenuGroup` — a bare label throws Base UI
  error #31 and crashed the whole app on the first mobile ☰ tap once.**
- **`src/ui/LinkBuilder.tsx` is the ONE share/embed builder**, rendered both in
  Tools ▸ Share / embed link (`LinkBuilderDialog`, now just dialog chrome) and
  inline on the Help page under "Sharing & embedding". Help used to carry a
  cut-down copy that could only produce `?import_url=` links, so the reference
  list documented far more than the widget beside it could build. Every parameter
  has an enable switch plus a value selector; only enabled ones are written.
  Links target the app ROOT — composing from `window.location.pathname` produced
  `/help?view_mode=md`, which opens the Help page rather than the editor.
- `src/data/shortcuts.ts` is the single source for shortcut documentation
  (Help page, shortcuts dialogs, menu hints) and exports `displayKeys()` which
  converts ⌘/⇧ glyphs to Ctrl+/Shift+ on non-Mac at display time. `displayKeysFor(keys, "mac"|"other")`
  is the platform-explicit variant (the Help page renders BOTH via a toggle).
  ⌘F = Find; **⌥⌘F** = Find & Replace (replace row expanded). **The ⌥⌘F branch
  must be tested BEFORE the bare `f` branch** in `useKeyboardShortcuts` — a plain
  `key === "f"` check ran first and returned, so the documented shortcut opened
  plain Find and (⌘H being unreachable on macOS) Replace had NO keyboard route
  there at all. It also matches the `ƒ` macOS composes from Option+F.
  Duplicate rows in `SHORTCUT_GROUPS` are a real bug, not noise: the Help page
  keys rows by `action`, so React drops one and the docs lose a line —
  `shortcuts.test.js` pins it. ⌘H is also bound for
  Windows/Linux but is UNREACHABLE on macOS — AppKit consumes it as Hide Application
  before the page sees the key, which is why ⌥⌘F exists. ⌘⇧K = Cards board.
- **Appearance controls live once in `src/ui/ThemeControls.tsx`** (`ThemeSwatch`,
  `ThemeCircleRow`, `AccentCircleRow`, `THEME_OPTIONS`) and are reused by the
  View ▸ Appearance menu (`MenuBar.tsx`) and the Settings sheet (`SettingsSheet.tsx`).
  Theme radios bind next-themes' **raw `theme`** (NOT `resolvedTheme`) so "System"
  is a genuine selectable value; app default is `system` (`main.tsx`). Embeds stay
  host-controlled (`embed.tsx` keeps its `theme` param / dark default).
- **Reading & typography** (`uiStore`: `editorFontSize`/`editorLineHeight`/`readingWidth`/
  `spellcheck`/`focusMode`; persisted `pf:font-size`/`pf:line-height`/`pf:reading-width`/
  `pf:spellcheck`/`pf:focus-mode`). Font size / line height / reading width are pushed as
  **CSS custom properties** (`--editor-font-size`/`--editor-line-height`/`--reading-width`)
  set inline on the editor split container (`EditorPanes.tsx` `splitRef`) and read by BOTH
  panes: `.ProseMirror`/`[data-md-preview]` (styles.css) and CodeMirror's `.cm-content`
  (`cmTheme()` — vars, NOT hardcoded 13px/1.6). **Reading width caps the CONTENT column**
  (`.ProseMirror`/`.cm-content` `max-width` + `margin-inline:auto`), never the flex pane —
  capping the pane breaks the split-divider math. **Spellcheck** rides a CodeMirror
  `contentAttributes` Compartment (live-reconfigured) and BOTH Tiptap `editorProps.attributes`
  objects (init + theme effect, with `spellcheck` in the effect deps). The rich-pane wrapper's
  Tailwind `prose-sm`/`text-sm` were removed so the font-size var wins. **Focus mode** dims the
  chrome via a `.pf-focus` class on the `PerssonifyEditor` CONTAINER (encloses menu bar /
  toolbar / status bar / `[data-pane-header]`), styled **opacity/transition ONLY** (never
  height/visibility — the shell stays `h-dvh`+`overflow-hidden`), with hover/`:focus-within`
  restoring full opacity. Surfaced in Settings ▸ "Reading & typography" + a View-menu Focus-mode
  checkbox.
- **Structured "Select" engine** (`src/formatting/select-scope.ts`): the Select… ▸
  submenu (Edit tab + right-click, shared renderer `src/ui/SelectMenuContent.tsx`).
  **Selection-only** — every entry places a real selection, no act-on-all actions
  (those belong to the toolbar / Find▸Format). Contiguous: `selectAll`/`selectBlock`
  (active pane). Scattered scopes (all headings/H1-6, paragraphs, list items,
  code blocks, blockquotes, table rows, images, inline code, links) place a
  **multi-range selection in the MD pane** via `dispatch("selectScope",{scope})` →
  `selectScopeCM` (CodeMirror `allowMultipleSelections`). Selection commands are
  non-mutating → allowed in read-only (routed before the read-only guard).
  The clipboard group (Cut/Copy/Paste/Select all/**Clear formatting**) sits with
  the Select… submenu in both menus.
- **Admin settings** (`SettingsSheet` "Admin" section): operator/debug toggles not
  necessarily exposed to all users — `contextMenuEnabled` (`pf:context-menu`; gates
  the custom `EditorContextMenu`, off → native browser menu), `consoleEnabled`
  (`pf:console`, **default off**; gates the diagnostics Console tray tab), and Show
  ads. Add new admin-only modules here.
- **Diagnostics console** (`src/ui/ConsolePanel.tsx` + `src/store/console-commands.ts`):
  an admin-gated (`consoleEnabled`) bottom-tray tab running a **CURATED, READ-ONLY**
  command registry (`CONSOLE_COMMANDS` + `runConsoleCommand`) over EXISTING read
  APIs — `diag.lifecycle` (`getLifecycleState`), `diag.storage` (`getStorageMetrics`),
  `docs.list`, `doc.outline` (`extractHeadings`), `doc.links`
  (`getBacklinks`/`getForwardLinks`), `graph.stats` (`exportGraph`). It is **NOT an
  `eval` REPL** and exposes no arbitrary property access: PE injects a typed
  read-only `ConsoleContext` of getters (no write path); adding a capability means
  adding a vetted entry, never a general escape hatch. `console-commands.ts` is PURE
  (tests inject a fake context). If a mutating command is ever added it MUST route
  through `dispatch`/`patchDocById` and honor read-only — never a raw storage write.
- **Unified Workspace panel** (`src/ui/WorkspacePanel.tsx`): a single **left-docked
  tabbed tray** that consolidates the former left library Sidebar and the document
  **Outline** into ONE surface — **Files / Outline** tabs (`WorkspaceTab =
  "files"|"outline"`). Document-first: the Files tab is the single library (search,
  new doc/folder, select mode + bulk export/delete via `useDialog().confirm`,
  drag-to-import, `FolderTree` when unfiltered / a flat per-doc list when
  searching or in select mode, per-doc export DropdownMenu, footer count, AdUnit);
  selecting a doc updates the Outline live. Outline reuses **`TocList`**
  (exported FROM `DocNavPanel.tsx`, along with `EmptyOutline`; the `DocNavPanel`
  component itself is now dead but retained as their home). **There is NO in-panel
  graph tab** — an earlier "Map" tab (a horizontal `DocumentGraph`, then a vertical
  `StructureMap`) was tried and REMOVED: the outline covers document navigation, and
  the knowledge graph is the full-screen **relationship-map overlay** toggled from
  the View menu / graph button (PE `graphVisible`, `src/ui/GraphView.tsx`) — do not
  re-add a graph into the narrow dock. `StructureMap.tsx` was deleted; a persisted
  `pf:workspace-tab==="map"` migrates to `"outline"` in `uiStore`. This **replaced
  the shadcn Sidebar + DocNavPanel + the old `docNav` "closed|toc|split|full" expand
  ladder** — `Sidebar.tsx` was DELETED and the docNav reconcile effect removed.
  **Open/closed** is `uiStore.showSidebar` (persisted `pf:workspace`, viewport-aware
  default: OPEN on desktop, CLOSED on phones so the drawer doesn't cover the editor
  on first load); the **active tab** is `uiStore.workspaceTab` (`"files"|"outline"`,
  persisted `pf:workspace-tab`; a stored `"map"` from the removed tab migrates to
  `"outline"`); **width** reuses `docNavWidth`
  (`pf:docnav-width`, clamped in `setDocNavWidth`). It mounts as a flex sibling of
  the editor inside a `relative flex` wrapper (no more `SidebarProvider`/
  `SidebarInset`): a docked column on `md+` at the persisted width, pinned to the
  LEFT of `<main>` via `md:order-first` (it renders after `<main>` in source), a
  left-overlay drawer on phones — and on phones **selecting a doc closes the
  drawer** (`onSelect` → `handleSwitchDoc` + `if (isMobile) setShowSidebar(false)`).
  The left-edge resize divider became a RIGHT-edge one (`-right-1`; width =
  pointer X − panel left edge). When closed, a small `PanelLeft` reopen button
  sits at the editor's top-left. Opened
  via **View ▸ Toggle workspace panel** (⌘⇧D) and **View ▸ Outline**
  (`MenuBar.onOutline` → `setShowSidebar(true)` + `setWorkspaceTab("outline")`).
  The `useActiveHeading` tracker is gated to `showSidebar && workspaceTab==="outline"
  && mode!=="md"`. The left-edge resize divider copies the `EditorPanes`/DocNavPanel
  Pointer-Events idiom (identity-stable drag callbacks via `onResizeRef`; width =
  panel right edge − pointer X, clamped in `setDocNavWidth`).
- **Cards board** (`src/ui/CardsView.tsx` + pure helpers in `src/store/cards.ts`): a
  Google-Keep-style board over the WHOLE library — every document is a card. Opened
  from the **top-bar surface switcher** / View ▸ Cards / **⌘⇧K** / a **launcher button
  in the Workspace panel header** (`onOpenCards` — a launcher, deliberately NOT a third
  tab: the board needs the full canvas, and an overlay-scale view in that narrow dock
  was already tried and removed as the Map tab). It exits via the same **"Back to
  editor"** button as the map — peer surfaces must not leave by different doors. Mounted as an **OVERLAY over `<main>` exactly like
  GraphView — the live TipTap editor MUST stay mounted beneath it** (same blank-doc
  invariant). The board is a **row-major masonry** (`Masonry` + `useColumnCount`), NOT CSS
  `columns`: multi-column fills each column top-to-bottom, so a newest-first board laid
  1,2,3 DOWN column one and the top row read 1,4,7,10 — the sort order was invisible.
  Cards are dealt round-robin into flex columns instead (ragged bottoms are the accepted
  cost of preserving order). Column count is measured from the BOARD via `ResizeObserver`,
  not Tailwind's viewport breakpoints — with the workspace panel open the board is ~340px
  narrower than the window, so `xl:columns-4` packed four columns into ~940px.
  Quick capture composes markdown via `composeNoteMarkdown` (title → `# H1`
  so the normal title-derivation path names the doc; Checklist mode turns each body line
  into `- [ ]`); the composer **autofocuses the BODY, not the title** — "Take a note…"
  promises you can just start writing, and most captures never get an explicit title.
  Card previews come from **`cardPreviewHtml`** — a PURE, bounded PM-JSON→safe-HTML
  renderer (NOT marked/`generateHTML`, which would build a schema per card per search
  keystroke) — so the face shows real headings/lists/emphasis instead of one flat grey
  run, wrapped in a `[data-md-preview]` container to inherit the rich pane's styling.
  Every text run is escaped; only a fixed structural tag whitelist is emitted; a
  `link` mark renders as an `<a>` with NO href (the face is a button — a real href
  would steal the click). `cardPreview` (plain text, `{ skipTasks: true }`) stays for
  the empty-check, the a11y label and the unfiltered search `haystack`. **The opened
  card is a Preview·Split·Write surface** (`CardEditor`, persisted `pf:card-view`,
  default `preview` on narrow / `split` on wide): the rendered side reuses PE's
  `cardRenderMarkdown` = `sanitizeForIngest(engine.mdToHtml(md))` so a card renders
  IDENTICALLY to the main preview and reflects unsaved edits; links inside it are
  `preventDefault`-ed (reading, not navigation — real nav is Open in editor). No
  `renderMarkdown` prop ⇒ write-only fallback. Editing still hands MARKDOWN to
  `handleCardSave` (unchanged save contract). `nodeText` inserts a separator between BLOCK children and across
  childless break nodes (a four-item list once previewed as `milkeggsbreadcoffee`, and a
  three-line note as `line1line2line3`) while leaving adjacent TEXT runs unspaced. Card edits NEVER write the canonical directly — they hand markdown to
  PE's `handleCardSave`, which mirrors the host bridge's `updateDocument`: parse with the
  LIVE editor schema → `patchDocById` → `setCanonical` when the target is the active doc
  (skip that re-hydrate and the editor's autosave silently reverts the edit). Per-card
  colour/pin live in `DocumentRecord.metadata` under `cardColor`/`cardPinned` via
  `patchDocById(..., { metadata, touchUpdated: false })` — `touchUpdated:false` matters,
  or pinning re-sorts the board as if the note were edited. `metadata` is merged AFTER
  `syncFieldsToMetadata` so a same-named `:::fields:::` key can't clobber it. Colours are
  explicit light/dark pairs (never translucent tints) so they survive old WebViews.
- **`src/components/ui/input.tsx` / `textarea.tsx` are wrapped in `forwardRef` ON
  PURPOSE.** The generated shadcn source targets React 19 (ref-as-prop); this repo is on
  React **18.3.1**, which STRIPS `ref` from function components. Without the wrapper every
  consumer ref read null — ⌘F opened Find, left focus in the document, and typed the query
  INTO the user's content; inline rename and prompt autofocus were dead too. If you
  regenerate these primitives, re-apply the `forwardRef` until the project moves to React 19.
- **Bottom tray** (`src/ui/BottomTray.tsx`): an expandable, tabbed tray above the
  `StatusBar` (collapsed = zero height). Document Links is the first tab
  (`BacklinksPanel` has a `hideHeader` embed mode); a **Console** tab
  (`ConsolePanel`) appears as a second tab only when the admin `consoleEnabled`
  flag is on (spread into the `tabs` array). Toggled by the status-bar links chip
  and the primary **far-left "Panel" chevron** on the status bar; state
  (`trayOpen`/`trayTab`) lives in PE. Replaced the old always-on backlinks strip +
  the floating links popover.
- **`KNOWN_ELEMENTS`/`SCHEMA_OWNED_ATTRS` (ingest.ts) MUST mirror the LIVE schema**,
  exactly like `SERIALIZE_EXTENSIONS`. They drifted: the lists predated `themeImage`,
  `Callout` and `SizedImage`, so the shipped Welcome document — which deliberately
  DEMONSTRATES a `<picture>` theme image, a `> [!NOTE]` callout and a sized logo —
  opened reporting **7 things that "could not be mapped to the current schema"**, every
  one of which round-trips. A residual list that flags our own renderer's output is
  worse than no list. Adding a node/mark to `TiptapPane` means adding its tag here
  (`div`, `picture`, `source` were the missing ones) — `residual-accuracy.test.js` pins
  it. **Known limit:** on the HTML/paste path `sanitizeForIngest` runs BEFORE
  `analyzeHtml`, so blocked elements (script, iframe, form controls) are removed and
  reported as NOTHING; the count under-reports there. Recording residuals from inside
  the sanitizer is the fix and has not been done.
- **Styled paste is the DEFAULT and is a persisted preference** (`pasteStyled`,
  `pf:paste-styled`, default ON). It used to default to "strip styles" and behave as a
  ONE-SHOT — arm the toggle, paste once, and it disarmed itself — which is coherent only
  while stripping is the default. Do NOT re-add the `setPasteStyled(false)` auto-reset:
  with styled as the default it turns the preference off the first time it is used.
  **Shift INVERTS** the preference for one paste (`shiftKey ? !pasteStyled : pasteStyled`)
  rather than forcing styled — as `shiftKey || pasteStyled` the modifier was dead once
  the default became on. **The modifier does NOT come from the paste event.**
  `ClipboardEvent` does not inherit from `UIEvent` and carries no `shiftKey` — not on a
  synthetic one, not on the event a real ⇧+paste delivers (measured) — so reading
  `event.shiftKey` was always `undefined` and the inversion never once fired.
  `TiptapPane.handlePaste` takes it from `view.input.shiftKey`, which is the field
  ProseMirror maintains for its OWN plain-text-paste branch, and hands it to
  `handleHtmlPaste` as an explicit `{ shiftKey }` argument. Pinned by
  `paste-styled.test.js` and `e2e/cases/journeys.mjs`.
- **Import fidelity is READABLE, not just counted** (`src/ui/ResidualsDialog.tsx`).
  The status bar's residual chip is a BUTTON that opens a grouped, plain-language
  list of what the import could not represent (`ResidualItem` carries type / tag /
  attribute / reason / location — the detail was always recorded, it just had
  nowhere to be read). `RESIDUAL_KINDS` must have an entry for EVERY `type` that
  `ingest.ts` pushes as a residual, or the dialog renders a raw slug — the jargon
  it exists to replace; `residuals-dialog.test.js` scrapes ingest.ts and pins it.
  `DocumentRecord.residuals` is typed `ResidualItem[]` (it was `unknown[]`).
- **Status bar** (`src/ui/StatusBar.tsx`): a three-region footer. The **primary
  tray toggle is a full-height, bordered, labeled chevron on the FAR LEFT** ("Panel"
  + `PanelBottom` + up/down chevron) — the obvious expand/collapse the user asked for.
  The interior surfaces contextual detail (active doc title, view mode + read-only,
  fidelity/residual warnings, links count, save state, word/char counts, storage,
  memory). It reports STATE and carries **no view switcher** — the graph toggle used to
  live here AND in the top bar (same `Network` icon, same action, opposite corners);
  do not re-add one. It **degrades responsively** — details shed least-important-first via
  `xs`/`sm`/`md`/`lg` breakpoints so it stays readable on phones. The custom `xs`
  breakpoint (480px) is defined in `styles.css` `@theme` (`--breakpoint-xs: 30rem`).
- **The open document is marked in the library** (`FolderTree` doc rows + the flat
  search/select list in `WorkspacePanel`): `bg-sidebar-accent` + a primary left bar +
  primary icon + semibold title + `aria-current`. It was `bg-card` — the exact colour
  of the aside behind it, so the highlight was invisible. Keep both lists in sync.
- **`createFolder(name, parentId, { startNaming })`** — the inline rename box opens
  ONLY for a user's New-folder action. Programmatic creation (archive import, first-run
  seeding) must omit it: it left a focused rename input, and a blinking caret, in the
  library on load.
- **Both resize separators go through `use-divider-drag.ts`** — the split-pane
  divider and the workspace panel's edge. They were the same twenty lines copied,
  and the copy is why one defect existed twice: each registered `pointermove` and
  `pointerup` on `window` and nothing else, so a `pointercancel` (which a phone
  fires the instant it reclaims a 4px `touch-action:auto` strip as a scroll) left
  `body.style.userSelect="none"` and `cursor="col-resize"` set for the session,
  and — nothing filtering by `pointerId` — the divider then tracked ANY later
  pointer. The hook uses pointer CAPTURE, not a third window listener, so the
  drag cannot outlive its pointer whatever the browser does; `touch-none` closes
  the same bug from the other end. `role="separator"` also REQUIRES `tabIndex`
  and `aria-valuenow/min/max` to be operable — reporting no value is invalid
  ARIA, not merely missing keyboard support. A third separator must come through
  this hook; `divider-drag.test.jsx` counts them.
- **`prefers-reduced-motion` needs a JS consultation for JS motion**
  (`utils/reduced-motion.ts`). The stylesheet's `!important` guard flattens CSS
  animations AND transitions — including the graph's inline 450ms camera
  transition, which therefore needs nothing. What it cannot reach is motion
  driven from rAF: the graph's force simulation, which now settles in one step
  under the preference. `styles.css` once carried a comment claiming a JS gate
  existed when none did; if you add JS-driven motion, gate it and say so
  truthfully.
- **Don't race Tailwind specificity from JavaScript.** The active-pane label
  carried `text-muted-foreground!` while the focus handler removed
  `text-muted-foreground` (a different token, never applied) and added
  `text-primary` (which cannot beat `!important`) — it never changed colour in
  either direction. Toggle a `data-` attribute and let CSS decide.
- **A `transition` declared inside a state's own rule only exists in that
  state.** `.pf-focus`'s dimming animated on entry and snapped on exit, because
  the selector stopped matching in the same frame the value reverted. Put the
  transition on the unqualified selector and only the changed value under the
  state class.
- **Reading width is a measure in CHARACTERS (`ch`), not pixels**
  (`migrateReadingWidth` in `uiStore`). As pixels it was set on the container
  wrapping BOTH panes, so each half-width pane inherited the same absolute cap
  and "Narrow" only bound above a ~1620px viewport — the control highlighted,
  persisted and did nothing. A pixel cap is also the wrong unit: it holds a
  different number of characters at every font size.
- **Responsive/touch invariants** (from the breakpoint audit): hover-revealed row
  actions (`FolderTree`/`Sidebar` ⋮ menus) MUST also show on touch — use
  `pointer-coarse:opacity-100` (+ `pointer-coarse:size-8` for the hit target), never
  hover-only, or they become unreachable on phones. Small icon controls that stay
  visible on mobile (status bar, ModeSwitcher) get `pointer-coarse:` size bumps to
  ≥32px. The **split panes stack below 768px** (`EditorPanes` matchMedia, aligned with
  the ☰ menu-collapse breakpoint), and the floating mobile `SidebarTrigger` is cleared
  by `pl-11 md:pl-4` on the pane header. The FR panel and any fixed overlay need
  `max-h-[…dvh] overflow-y-auto` so controls stay reachable on short viewports.
- **Embedded / in-app webview invariants** (WhatsApp / Slack / Telegram / Claude /
  ChatGPT — how most first-time users see the app): `index.html`'s viewport meta carries
  **`viewport-fit=cover`** (exposes `env(safe-area-inset-*)`) + `interactive-widget=resizes-content`
  (keyboard shrinks layout, doesn't cover the editor) — do NOT drop either. `styles.css`
  pins `-webkit-text-size-adjust:100%` / `-webkit-tap-highlight-color:transparent` /
  `overscroll-behavior:none` on html+body so webviews don't inflate fonts, flash tap
  boxes, or rubber-band into the host. Safe-area padding rides three utility classes
  (`.pf-safe-top`/`.pf-safe-bottom`/`.pf-safe-x`, each `env(..., 0px)` → a strict **no-op**
  where there's no inset, incl. the iframe embed): `pf-safe-top` on `EditorHeader`
  (fills the notch), `pf-safe-bottom` on the `StatusBar` **footer** (fills the home-indicator
  area — and the footer is `min-h-7`/`min-h-9`, NOT `h-7`, so the inset padding GROWS the
  bar instead of clipping content under border-box), `pf-safe-x` on the standalone `App.tsx`
  shell (landscape notches). The embed stays host-controlled — these live on the standalone
  chrome only.
- **Library row actions live once, rendered into two menu primitives**
  (`FolderTree.tsx`). A `MenuFam` object (`{Item,Sub,SubTrigger,SubContent,Separator}`)
  lets ONE body renderer (`DocMenuBody`/`FolderMenuBody`, + generic `MoveToMenu`/
  `ExportDocSubmenu`) drive BOTH the hover **⋮ dropdown** and a **right-click /
  long-press context menu** (`RowContextMenu` wraps each row; Base UI
  `components/ui/context-menu.tsx`). The context wrapper uses a
  `display:contents` trigger so it adds no box and leaves the row's ref/DnD/flex
  untouched, and it honors the admin `contextMenuEnabled` flag (off → native menu),
  mirroring `EditorContextMenu`. Do NOT duplicate row-menu item definitions per
  primitive — extend the shared body. **Per-document export** (`onExportDoc` →
  `handleExportDoc(docId, "md"|"html"|"docx"|"json")` in PE) derives every format
  from the STORED canonical via `canonicalToHtml`/`canonicalToMarkdown`
  (`serialize-doc.ts`) + `exportAs*`, so it works on ANY list item without that doc
  being loaded in the editor (it prefers the LIVE canonical when `hydratedDocId`
  matches). Folder rows add **Full backup (.zip)** via `onExportFolder(id, {canonical:true})`.
  **`SERIALIZE_EXTENSIONS` (`serialize-doc.ts`) MUST mirror the live `TiptapPane`
  schema** — it uses `WikiLink` (not stock `Link`, so `[[wiki]]` attrs survive and
  round-trip), `ThemeImage` (a distinct `themeImage` node — its ABSENCE made
  `generateHTML` THROW → export failed outright for any doc with a `<picture>`
  theme image), and `SizedImage` (keeps `width`/`height`). Any node/mark the live
  editor gains must be added here too, or headless export silently corrupts or
  throws. Pinned by `serialize-doc.test.js` round-trip cases.
- **Find/Replace (`FindReplace.tsx`) is a floating draggable panel** (`position:fixed`,
  translucent `bg-card/80 backdrop-blur`), not a docked bar. `initialShowReplace`
  seeds/expands the replace row; PE passes it live via `frWithReplace` so ⌘H expands
  it even when already open. Drag is pointer-events on the header handle, clamped to
  the viewport. **Panel mode is a Find|Replace segmented control** (`panelMode`,
  above the MD/Rich selector) — NOT the old "Replace…" toggle; ⌘F opens find, ⌘H
  opens replace, and the default pane follows the cursor (`initialTarget` from the
  last-focused pane). Find mode shows **Find + Find all** (Find all multi-selects
  every match in CM via `EditorState.allowMultipleSelections`); Replace mode shows
  **NOTE: multi-range selection needs BOTH `allowMultipleSelections` AND
  `drawSelection()` in the `CodeMirrorPane` extensions — the native DOM selection
  renders only ONE range, so without `drawSelection` "Find all" / "Select all
  headings" / scattered "Select ▸ …" scopes appear to select just the first match.
  Do not remove `drawSelection()`.** Replace mode shows
  Replace + Replace All. The **Format matches** row (apply bold/case to all matches)
  is **Replace-mode only** (it mutates). **Match ticks are drawn over the active
  pane's scrollbar** (`MatchScrollbar`) — it **portals to `document.body`** because
  the panel's `backdrop-blur` makes it a containing block for `position:fixed`, which
  otherwise pushed the overlay off-screen. The **MD scope/format filter** (`mdScope`,
  persisted `pf:fr-scope`) is a collapsible Funnel of per-region chips that cycle
  **off → only → exclude**, grouped Structure (headings/code/links) + Formatting
  (bold/italic/strike/highlight), applied in `scopeMd`; headings=only doubles as the
  old "headings only" (format-all-headings affordance). ⌘F/⌘H also switch the panel
  mode from inside the panel (the global shortcut listener is editor-container-scoped).
  **Keyboard shortcuts can be disabled** (`uiStore.keyboardShortcutsEnabled`,
  `pf:keyboard-shortcuts`, Settings ▸ Editor) — `useKeyboardShortcuts` early-returns. Search options (regex, **case-sensitive**,
  **whole-word**) persist in localStorage (`pf:fr-*`) and route
  through one builder (`buildSource`/`buildRegex`) used by every CM+Tiptap match
  site. **Rich-pane Next/Prev uses `findNextInTiptap`** (walks `collectTiptapMatches`
  ordered by position, advances relative to the selection) — `findInTiptap` only
  seeds the first/live match, so do NOT route Next/Prev back through it (that was the
  "stuck on match 1" bug). **Panel position**: `pos` state is set in a `useLayoutEffect`
  on mount (before paint) — it restores the last dragged position (`pf:fr-pos`, written
  in `endDrag`) or **centers on the viewport**, always clamped on-screen. **`replaceAllInCM6`
  MUST honor `mdScope`**: whenever any region is active (`Object.values(mdScopeRef.current).some(v => v!=="off")`)
  it runs the ranged-change scoped path over `scopeMd(...)` matches so Replace All mutates
  exactly the filtered matches shown in the count — never fall back to an unscoped
  `doc.replace` when a filter is active (that silently rewrote excluded regions).
- **Optional display ads** live in `src/ui/AdUnit.tsx`, gated by `useUIStore.showAds`
  (localStorage `pf:show-ads`, default off) AND full chrome — never in the embed.
  Toggled from Settings/View and the `?ads=` URL param (App.tsx / embed.tsx). Slots
  are placeholder-only (no external network — offline/CSP-safe); a real network would
  replace the markup inside each variant, keeping the gate.
- **Read-only mode** (`useUIStore.readOnly`, `pf:read-only`, `?readonly=`): TiptapPane
  `editor.setEditable(!ro)` + CodeMirrorPane editability Compartment
  (`EditorState.readOnly`/`EditorView.editable`); node views already honor
  `editor.isEditable`. PE hides the formatting toolbar when read-only, keeps the menu bar.
  **Native editability only blocks typing/paste/drop — every PROGRAMMATIC mutation
  must also be gated:** `useFormatDispatcher.dispatch` early-returns when
  `readOnly` (covers toolbar / menu bar / shortcuts / context menu), `handleClipboard`
  blocks cut+paste, `handleAction("clear")` bails, FindReplace hides + no-ops
  Replace/Replace-All/Format, and the ModeSwitcher / View-menu / Settings view-mode
  control + Insert/Format menus disable. Read-only also **locks the view mode**.
  `?readonly=`/`?ads=` are applied session-only via `useUIStore.setState` (NOT the
  persisting setters) so a shared link doesn't overwrite the visitor's saved settings.
- **`view_mode=md|html|split`** URL param maps to `setMode` (App.tsx reader; embed.tsx
  aliases it to `mode`). The standalone app's URL-param reader (App.tsx) also applies
  `ads`/`readonly` then strips them via `history.replaceState`.
- **URL/embed builder**: `src/ui/LinkBuilderDialog.tsx` (Tools ▸ Share / embed link)
  composes a standalone link + iframe snippet from view_mode/ads/readonly/theme/chrome.
- **Password-protected ZIPs**: `isZipEncrypted(buf)` in `store/archive.ts` reads the
  central-directory (fallback: local-header) general-purpose bit 0 with NO dependency;
  `extractArchive` throws `ArchiveEncryptedError` when encrypted+no password, and
  decrypts via a **lazy** `@zip.js/zip.js` import when a `password` option is given
  (wrong password → `ArchiveWrongPasswordError`). File import (PE) and URL import
  (`fetchImportResource` + `UrlImportDialog`) prompt for a masked password (the shared
  `useDialog().prompt` gained a `type: "password"`) and retry.
- **Archive path safety**: `normalizeArchivePath(path)` in `store/archive.ts` strips
  absolute roots, Windows drives (`C:`, incl. drive-relative `C:foo`), `..`/`.`/empty
  segments, AND prototype-pollution keys (`__proto__`/`constructor`/`prototype`);
  `extractArchive` runs every entry through it before the path is trusted anywhere
  (folder tree, storage keys). Never feed a raw archive `e.path`/`folderPath` into a
  storage-key/IDB-path op.
- **Full-backup export/restore**: `handleAction("export-backup-zip")` → `exportDocsToZip(ids,
  "perssonify-backup", { canonical: true })` writes each doc as the full
  `perssonify-document` JSON envelope (canonical + title/id/tags/metadata/timestamps).
  Re-import restores the exact library state, which requires TWO cooperating paths:
  (1) the `pmjson` ingest branch (`store/ingest.ts`) forwards
  `tags/metadata/created/updated/origin/residuals` + pins `userTitle` from the envelope
  (NOT just id/canonical/title — omitting them silently drops the state and resets
  timestamps); (2) `archiveEntriesToItems` detects an all-envelope archive
  (`isBackup`) and keeps entry paths VERBATIM — it must NOT apply the loose-file
  `<zip-name>/` wrap, or the whole library nests under a synthetic folder.
  **Every export ZIP filename carries an `exportTimestamp()` `YYYYMMDD-HHMMSSmmm` suffix**
  (`store/import-export.ts`) for implicit version control.
- **Export titles MUST derive from `resolveDocTitle`, never bare
  `deriveTitleFromCanonical`.** Every export path (File-menu active-doc export-md/
  html/json/docx/pdf, the sidebar per-doc `handleExportDoc`, and `exportDocsToZip`'s
  filename + backup-envelope title) resolves the title through `resolveDocTitle(doc,
  canonical)` so a **user rename (pinned `userTitle`) wins over the first-heading**.
  Using `deriveTitleFromCanonical(...) || activeDoc.title` here was a real bug — a
  renamed doc exported under its old heading-derived filename, ignoring the rename.
- **Security invariants** (from the vulnerability audit — do NOT regress):
  - The **import relay** (`api/import.js`) MUST NOT reflect the upstream
    `Content-Type`/`Content-Disposition`. It forces `application/octet-stream` +
    `Content-Disposition: attachment` + `Content-Security-Policy: default-src 'none';
    sandbox`, and forwards the real type in `X-Upstream-Content-Type` (the client reads
    that for its format hint). Reflecting `text/html` let a same-origin navigation to
    `/api/import?url=…` render attacker HTML on our origin (full XSS). The relay also
    requires `Sec-Fetch-Site` = `same-origin`/`none` (rejects absent = non-browser open
    proxy) and only ports 80/443.
  - `?import_url=` **pre-fills** the importer URL but NEVER auto-fetches — a shared link
    must not force the visitor's browser to hit an attacker URL on load.
  - Host-supplied CSS colors (`bg`/`accentColor` in `embed.tsx` +
    `PerssonifyEditorIntegration.tsx`) go through `sanitizeCssColor` (`theme/palette.ts`)
    — rejects `url(`/`expression(`/`var(`/`;{}` so a value can't become a tracking beacon.
  - `htmlToCanonical` (`store/canonical-ops.ts`) parses via an inert `DOMParser`, never
    `el.innerHTML` on a live element (avoids resource loads / mutation-XSS).
- **Mermaid/ABC blocks render by default in ONE cohesive framed card** (`CodeBlockWithCopy.tsx`
  `.diagram-frame`: header label + Edit/Copy · source · live preview), mirroring the math
  nodes. The `<pre><NodeViewContent/></pre>` stays MOUNTED (hidden via `.diagram-source.is-hidden`)
  — never unmount it, ProseMirror owns that content and the fenced-code round-trip depends on it.
  The preview reads the live node text, so it re-renders as you type.
- **Theme-aware images** follow the in-app theme (not just the OS):
  - `#gh-light-mode-only` / `#gh-dark-mode-only` URL fragments on ordinary Markdown images —
    pure CSS show/hide in `styles.css` (keyed on `.dark` / `[data-theme="dark"]`) + `useMarkdownEngine.ts`
    `PREVIEW_CSS` (with a `prefers-color-scheme` fallback for exported standalone HTML).
  - `<picture>` with `prefers-color-scheme` sources → the `themeImage` node (`extensions/ThemeImage.tsx`)
    picks the src by next-themes `resolvedTheme` and round-trips back to `<picture>` via the
    `themeImagePicture` turndown rule (`turndown-rules.ts`).
- **Image sizing**: `extensions/SizedImage.ts` keeps `width`/`height` on the Image node; the
  `sizedImage` turndown rule serializes a sized image to an `<img …>` HTML tag (plain `![]()`
  can't carry a size). Unsized images still serialize as Markdown.
- **Case transforms** live in `src/formatting/case-transform.ts` (`applyCase`,
  `transformCaseTiptap`/`CM`, `headingsCase*`), dispatched via `changeCase` / `headingsCase` /
  `selectAll` in `useFormatDispatcher.ts` and surfaced in Format ▸ Change case, the right-click
  menu, and the Find/Replace "Format matches" row. **"Content only"** (persisted
  `uiStore.caseContentOnly`, localStorage `pf:case-content-only`) skips code (the `code` mark +
  `codeBlock` in the rich pane; fenced/inline code, HTML tags, and link/image URLs in the MD
  pane) so casing never mangles syntax. The MD masker uses PUA delimiters (U+E000/E001), NOT bare
  digits, so it can't collide with numbers in the document.
- **Archive imports wrap loose root files in a folder named after the archive** via
  `archiveEntriesToItems(entries, zipBaseName)` in `store/archive.ts` (used by both the
  file-upload and URL-import sites in PE). A single top-level folder is kept as-is; a
  lone file imports at root.
- **DOCX import** (`store/docx-import.ts` `convertDocxToHtml`): a `.docx` upload can't take
  the text path (`getFileContentAndFormat` reads text → binary garbage), so PE's import loop
  branches on `.docx` BEFORE that call and routes through **lazy** `mammoth` (`await import`,
  own chunk — never in the main bundle) → HTML → the existing `format:"html"` ingest branch
  (`sanitizeForIngest` keeps inlined `data:` raster images, strips scripts; `analyzeHtml`
  reports residuals). Best-effort/lossy: headings/bold/italic/lists/tables/raster images
  convert; Word equations (OMML), text boxes, and complex layout do not. `convertToHtml` is
  called with **BOTH** `{ arrayBuffer, buffer: arrayBuffer }` — mammoth's browser build reads
  `arrayBuffer`, its node build (tests) reads `buffer` — so one call works in both without a
  throw-and-retry. Images inline as base64, so a small `.docx` can expand past the 5MB import
  skip once images are embedded.
- The standalone app shell (`src/App.tsx`) is a `h-dvh` viewport-locked column;
  PerssonifyEditor receives `fitParent` there and sizes to its parent. Embed/
  library mounts omit it and keep viewport (`h-dvh`) sizing. Never let the shell
  grow past the viewport — window scroll drifts the chrome off-screen.
- Interior pages/graph are wired through PE via optional props (`onAbout`,
  `onHelp`, `onStartTour`, `graphOpen`/`onGraphOpenChange`); omitted by the
  library/iframe embed, which keep the built-in dialogs + internal graph toggle.
- `src/PerssonifyEditor.tsx` — the orchestrator wiring stores, engine, panes.
- `src/engine/` — markdown conversion + sync. `useSyncEngine.ts` (hash-gated bidi
  sync), `useMarkdownEngine.ts` (marked/turndown, feature-driven), `build-marked.ts`
  (per-instance marked config), `turndown-rules.ts`, `html-cleaner.ts`, `math-marked.ts`.
- `src/store/` — Zustand stores (`documentStore.ts`, `uiStore.ts`, `editorStore.ts`),
  document model (`document.ts`), persistence adapters (`storage-adapter.ts`,
  `idb-storage-adapter.ts`), ingest/sanitize (`ingest.ts`), `settings.ts`.
- `src/ui/` — view components (panes, toolbar, sidebar, settings, dialogs, graph).
- `src/extensions/` — custom TipTap nodes (BackgroundColor, MathInline/MathBlock,
  BlockId, FieldBlock, TransclusionBlock).
- `src/theme/palette.ts` — accent-palette selection (orthogonal to light/dark).
- Docs: `docs/` — start at `docs/README.md`. `docs/import-relay.md` covers the ONLY
  server code (`api/import.js`); `docs/gotchas.md` is the landmine list; `docs/backlog.md`
  carries the audit findings (the old `docs/audit/` was folded into it during the
  Markdown Studio migration and no longer exists).

## Invariants — do NOT break
- **Sync engine `force*` callbacks use empty dependency arrays** and call through
  refs (`useSyncEngine.ts`). This prevents infinite sync loops. Do not add deps.
  Corollary: never put `syncMdToHtml`/`syncHtmlToMd` in an effect dep array —
  mirror them into a ref first (their identity churns via onCanonicalChange and
  loops the render). This crashed the app once already (React #185).
- **The bidi sync is IME / voice-dictation aware — do NOT strip the composition
  guards.** Windows Voice dictation (and any IME) streams text via
  `compositionstart→update→end`; dispatching content into an editor mid-composition
  (`cm.setValue` / `tiptap.setHTML`) ABORTS the composition and drops the streamed
  text (the "dictated text not accepted" bug). Both panes expose `isComposing()`
  (`view.composing`), and the `handleMdChange`/`handleHtmlChange` debounces
  RESCHEDULE (~120ms) rather than dropping the projection. Strict no-op for
  ordinary keyboard input (`view.composing` is false then). Doc-load paths
  (`setCanonical`/`setFromHtml`) are intentionally NOT guarded — a switch blurs the
  editor, ending composition. Four rules, each measured against a REAL composition
  (CDP `Input.imeSetComposition`, `e2e/cases/journeys.mjs` — a mocked boolean
  cannot reach any of this):
  - **A projection defers for the pane it WRITES, and only that pane.**
    `syncMdToHtml` writes the rich pane (`tiptap.setHTML`) and merely READS the
    markdown pane, which is an uncontrolled CodeMirror — so a markdown-pane
    composition is not its business, and vice versa for `syncHtmlToMd`. Checking
    BOTH froze the mirror for a whole dictated utterance and let one pane's stuck
    flag wedge the other direction. `handleMdChange`/`handleHtmlChange`'s retry
    guards mirror the engine's exactly; if they disagree, one reschedules for a
    projection the other would run anyway.
  - **A stuck flag expires** (`COMPOSITION_STALL_MS`, `constants.ts`). An undo
    dispatched into CodeMirror during a live composition destroys it WITHOUT a
    `compositionend`, so `view.composing` stays true for the rest of the session:
    measured, every projection then deferred forever and the panes never converged
    again. `isComposing()` in both panes stamps liveness on each composing update
    and stops believing a composition that has produced no input for 8s.
  - **Document-LEAVING paths END the composition instead of waiting**
    (`endCompositions` in `useDocumentLifecycle`, `endComposition()` on both pane
    handles — blur, which fires `compositionend` synchronously and commits the
    text into that pane's own document). They are about to hydrate a different
    document over both panes, so waiting means the dictated text is destroyed.
    Reproduced: dictate into the markdown pane, press ⌘N (which never blurs) and
    the text was gone from both panes and from disk. Every site that cancels a
    pending projection must do this or bail — `cancelPendingSync` (⌘Z) bails,
    `flushPendingSync` bails, `flushAndCacheIfDirty` and the close/delete/
    sync-mode sites end it. `composition-guards.test.js` pins the set.
  - **`useFormatDispatcher.dispatch` ends the composition before acting.**
    ProseMirror already ignores keys near a composition; the markdown pane had no
    such rule, so ⌘B mid-dictation dispatched straight into the composing
    CodeMirror view and left the streamed text DUPLICATED with the rich pane never
    converging.
- **Projection scheduling has a CEILING, and it is measured, not guessed**
  (`src/hooks/sync-schedule.ts`, pure + unit-tested). The cross-pane debounce
  used to be purely trailing, reset by every keystroke, so while you typed
  continuously the other pane NEVER updated — it caught up only on a pause, and
  the pause length came from the document's LENGTH (300/500/800ms). Both are
  gone: the idle delay and the max-wait ceiling are derived from a moving
  average of what recent projections actually COST on this device. Only
  projections that RAN are measured — `syncMdToHtml`/`syncHtmlToMd` return a
  boolean for exactly this, because most calls are gated out by the hash /
  doc-identity checks and return in microseconds, and folding those in would
  make every document look free. The pending-since stamp survives a composition
  deferral: an IME delays a projection, it does not restart its clock.
- **The sync engine compares the rich pane by DOC NODE, not by serializing it**
  (`lastHtmlDoc` in `useSyncEngine`). PM nodes are immutable, so reference
  equality answers "has the rich pane changed?" for free, where hashing the
  answer cost a full HTML serialization of the document on every projection.
  When no doc node is available (editor unmounted) it falls back to the old
  hash — the echo gate must NOT depend on the fast path. `cm.setValue` likewise
  returns the text the pane settled on (null when it wrote nothing), so the md
  side never reads the rope back just to hash it.
- **Derived values are published only when they CHANGE.** `updateDerived`
  computes the fidelity report and the word/char counts in ONE walk of the
  canonical (`computeCanonicalStats`) and keeps the previous object when the
  value is unchanged — the same `sameMetrics` pattern `refreshMetrics` uses.
  Two fresh objects per projection defeated every `useShallow` selector
  downstream and re-rendered the shell on each sync. Same reason
  `editorStore.setActiveFormats` shallow-compares: `queryState()` allocates a
  new object on every keyup.
- **A memoized child must not be handed a freshly-built prop.** MenuBar,
  StatusBar and BottomTray were `React.memo` and never once bailed out, because
  every handler was an inline arrow and the tray's `tabs` an array literal of
  new JSX. Handlers are hoisted into `useCallback`/`useMemo` at the call site
  and `sync-perf.test.js` fails if an inline function, array or object comes
  back. `EditorLayout`, the panes, `WorkspacePanel` and the four dialog sheets
  are memoized on top of that. Order matters — memo before stable props is a
  no-op.
- **`hydratedDocId` (documentStore) is the data-integrity chokepoint**: it tracks
  which doc's content the live editor holds; `saveActiveDoc` refuses on mismatch.
  Every path that pushes content into the editor must `markHydrated(docId)`;
  every path that changes `activeDocId` without pushing must leave it null.
- **Hydrating a different document must drop undo history** (`resetHistory()` on
  both panes — `setCanonical`/`setFromHtml` do it automatically). Without it,
  ⌘Z after a doc switch resurrects the previous doc's content into the new one.
  The ONE sanctioned exception is `src/store/history-cache.ts` (per-doc undo
  stacks): restores only go through `takeForRestore`, which validates the
  cached content hash against the just-hydrated content and discards on any
  mismatch. Never restore a cached pane state without that validation.
- **Canonical source of truth is ProseMirror JSON** inside the live TipTap editor;
  markdown is a projection. Don't collapse the dual representation.
- **Data-loss backstop (do NOT weaken).** The canonical (TipTap PM JSON) is what
  autosave persists, so a blank editor projected over a doc is the "my file got
  wiped, unrecoverable" failure. Protection lives at the PERSISTENCE boundary, not
  in the sync path: `documentStore.saveActiveDoc` refuses to persist a BLANK
  canonical (`isBlankCanonical`) over a stored doc that has real content, so an
  accidental/stale empty can never overwrite on disk (reload recovers). It **fails
  closed** if the pre-save read errors, and parks a **terminal `"blocked"` save
  status** (NOT `"editing"`/`"error"`) so the autosave re-arm effect can't spin a
  loop. The ONLY sanctioned blank persist is the explicit **Clear document**
  command, which calls `allowBlankSaveOnce()` (a one-shot module flag) to bypass
  the backstop; PE toasts "Document is empty — not saved…" when a blank is blocked.
  **Do NOT re-add a focus-based ("is the rich editor focused?") heuristic inside
  `syncHtmlToMd`** — it was tried and removed because it silently REVERTED genuine
  deletions when the user blurred the rich pane before the debounce fired. The sync
  path is synchronous and only runs on real edits, so it correctly propagates a
  clear; recoverability is the save backstop's job.
- **Unload is a data-loss path, and `beforeunload` alone does not cover it**
  (`src/store/crash-recovery.ts`). The handler fires a best-effort autosave, but
  IndexedDB is ASYNCHRONOUS — `saveActiveDoc` awaits a read before it writes, so
  the page is gone before the write is issued, and the in-memory draft cache does
  not survive a reload either. Measured: type a sentence, reload inside the
  autosave window, and it was on neither pane nor disk. localStorage is the only
  store that completes while the page is torn down, so the handler ALSO writes a
  synchronous stash (`stashUnsaved`, `pf:recovery`) — the live canonical for the
  document the editor actually holds (`hydratedDocId === activeDocId`, else it is
  a cross-document overwrite) plus every parked draft, honouring the same
  blank-over-content backstop. `documentStore.initialize` adopts it via
  `takeStashed()` BEFORE activating a document, feeding `cacheUnsavedEdit` so the
  ordinary cached-draft path takes over. The stash is ONE-SHOT (like
  `history-cache`'s `takeForRestore`) — one that survived its own restore would
  keep resurrecting itself over newer content — bounded to 2MB newest-first, and
  expires after a week. Also wired to `pagehide`: iOS Safari does not fire
  `beforeunload` when a tab is swiped away.
- **A failed save must stay VISIBLE** (`saveError` in `documentStore`,
  `StatusBar`). A failed autosave is routed error → editing after 3s so the
  re-arm effect fires, so for most of each retry cycle the status bar read
  "Unsaved changes" — the reassuring message — while saving was failing over and
  over. `saveError` outlives that transition (cleared only by a save that lands)
  and the bar reads "Save failed — retrying". `"blocked"` — the terminal
  blank-over-content refusal — had NO branch at all and was invisible except for
  one 30s-throttled toast; it now reads "Empty editor — not saving".
- **Stale-overwrite prevention (live-canonical provider).** The store's non-editor
  persist paths (`renameDoc`, `patchDocById`) used to write the ON-DISK/store
  canonical, which lags the live editor by up to one autosave interval — so a
  rename (or a host title patch) while the user had unsaved edits silently rewound
  those edits. PE registers a `registerLiveCanonical(fn)` getter that returns the
  LIVE TipTap JSON when the editor currently holds a given doc; `renameDoc` and
  `patchDocById` (title-only) merge onto that live content instead of the stale
  copy. `liveCanonicalFor` refuses a BLANK live canonical, so a rename can never
  wipe content even if the editor is momentarily empty (that stays the blank
  backstop's / explicit-clear's domain). Do NOT revert these paths to sourcing the
  disk/store canonical for the active doc. **Corollary — `saveActiveDoc` re-reads
  `get().activeDoc` AFTER its `await storage.get`** and builds the record's
  title/metadata from that freshest copy (canonical still from the editor's
  `getJSON()`). It captured `activeDoc` before the await, so a `renameDoc`/
  `patchDocById` that landed DURING the await would otherwise be clobbered by the
  stale-title snapshot (and its provenance pin cleared) — a narrow but real rename-
  loss race. Keep the post-await re-read. `duplicateDoc` likewise merges
  `liveCanonicalFor` so a copy captures unsaved edits. **`saveActiveDoc` ALSO
  re-asserts the hydration chokepoint after its `await storage.get`** (re-checks
  `activeDocId === activeDoc.id && hydratedDocId === activeDoc.id` before reading
  `getJSON()`/writing): a doc switch or delete landing during the await re-hydrates
  the editor with a DIFFERENT doc, so writing then would save doc B's content into
  doc A's record (cross-doc overwrite) or resurrect a just-deleted doc. This is the
  save-side analogue of the `switchGenRef`/`switchSeq` hydration guards — keep it.
- **Title provenance (`titlePinnedByUser`).** `DocumentRecord.titlePinnedByUser`
  records WHETHER the current `userTitle` is a genuine user rename, replacing the
  old string-sniff (`/^Untitled( \d+)?$/`) in `resolveDocTitle` that mis-healed a
  doc a user deliberately named "Untitled 5". Set `true` by `renameDoc`, an
  explicit `patchDocById({userTitle})`, and backup-envelope restore
  (`completeIngest`/pmjson ingest); `resolveDocTitle` honors a flagged pin
  VERBATIM. `createDocument` MIGRATES old stored docs: a non-placeholder
  `userTitle` back-fills the flag `true`, an "Untitled N" pin stays `false` so it
  can still heal. The flag round-trips through `serializeForStorage`. `resolveDocTitle`
  now returns `{title, userTitle, titlePinnedByUser}` — apply all three at every
  call site (saveActiveDoc spreads it; ingest/patchDocById assign it).
- **A cached draft carries the revision it was written against**
  (`_draftBases`, documentStore). The multi-tab conflict guard compares
  `stored.updated` against `activeDoc.updated`, meaning "the revision this
  tab's content is based on" — but `switchToDoc` rebuilds `activeDoc` by
  spreading the FRESHLY-READ record and grafting the cached draft onto it, so
  the record's `updated` (possibly another tab's write) became the draft's
  baseline. Measured: a conflict the guard had correctly refused was forgotten
  by switching away and back — drift collapsed to zero and the next save
  overwrote the other tab's work with no prompt, no merge and no consent. The
  base is recorded on FIRST cache and never advanced on re-cache (typing more
  into a dirty document does not rebase it); `clearUnsavedEdit` drops it with
  the draft, so a save or an explicit discard retires both. A draft with no
  recorded base — adopted from a crash stash written before this existed —
  keeps the old behaviour rather than being dropped or blocked.
- **Closing the active document prompts for EVERY unsaved state, not just
  `editing`.** `handleCloseTab` gated its prompt on `saveStatus === "editing"`,
  so `conflict` and `blocked` (both TERMINAL) and `error`/`saving` fell to the
  background-tab branch, which only looks for a cached draft — and ordinary
  typing does not cache one (`cacheUnsavedEdit` runs on LEAVING paths only).
  The close path also never calls `flushAndCacheIfDirty`, unlike `handleNewDoc`.
  So closing a document whose save was in conflict discarded the live content
  with no prompt, nothing on disk, nothing cached, and history dropped.
  Resolution of `saveActiveDoc` is also NOT proof of a commit — it returns
  normally on a blocked write, an aborted ownership check and a caught
  non-quota error — so the post-save branch checks the resulting status.
- **Multi-tab conflict → terminal `"conflict"` save status.** `saveActiveDoc`
  already refused to overwrite a stored doc a DIFFERENT tab wrote (its `updated`
  drifted >2s ahead of what this tab loaded). It now parks a **terminal
  `"conflict"` saveStatus** (set before it throws) — like `"blocked"`, it must
  NOT re-arm autosave. PE's autosave catch detects the conflict error and RETURNS
  without the error→editing re-arm (re-arming would just re-detect the conflict
  every few seconds — a toast/status loop); a later real edit (`setDirty` →
  `"editing"`) resumes saving. Surfaced in the StatusBar ("Changed in another tab
  — not saving") and counted as unsaved by the `beforeunload` guard (warns, but
  never re-attempts the conflicting write). This is the SAFE slice of the
  deferred multi-tab work — NOT a `BroadcastChannel`/FSM rewrite (still backlog).
- **`refreshMetrics` de-dupes.** `storage.getMetrics()` returns a fresh object
  every call; `refreshMetrics(set, get)` compares via `sameMetrics` and only
  `set`s a new `storageMetrics` reference when a value actually changed, so a
  save/patch/delete/rename can't churn a re-render of every metrics subscriber
  (the status bar) on a no-op.
- **Switch-generation guard (rapid-switch stale-settle).** `handleSwitchDoc`
  (`useDocumentLifecycle.ts`) is async (awaits `autosaveOnLeave` + `switchToDoc`'s
  `storage.get`). A monotonic `switchGenRef` is bumped at each switch's entry;
  every await boundary re-checks `switchGenRef.current === myGen` and ABORTS if a
  newer switch superseded it. Without this, a slow storage read for an abandoned
  switch (rapid A→B→A) hydrated the editor with the wrong/superseded doc and
  clobbered anything typed into the now-current doc. Switches that pass their
  post-autosave check call `switchToDoc` in strictly increasing-gen order, so
  `activeDocId` always converges on the last-entered switch and only its
  hydration touches the editor. Do NOT hydrate the editor from a switch without
  re-checking the generation after each await. **The hook's `switchGenRef` guards
  the EDITOR hydration; a SEPARATE module-level `switchSeq` in `documentStore`
  guards the STORE's `activeDocId`** — `switchToDoc` sets `activeDocId` both
  optimistically AND at completion (after its own `await storage.get`), so a stale
  switch whose read settled out-of-order must NOT apply its completion/revert
  (checked via `switchSeq !== mySeq`), or `activeDocId` and `hydratedDocId` end up
  on different docs → every save blocked + cross-doc draft contamination. Both
  guards are required. **Every OTHER async path that ends in
  `hydrateEditorWithDoc` claims and re-checks the same generation** —
  `handleCloseTab`, `handleDeleteDoc`, `handleNewDoc`, `handleRevertDoc`,
  `restoreSnapshotInPlace`, `restoreSnapshotAsNew`. They reach the identical
  hydration after the identical kind of await, several of them after an
  UNBOUNDED one (a confirm dialog the user can leave open while opening another
  document), and none of them claimed a generation at all —
  `restoreSnapshotAsNew` bumped it to invalidate others and then never checked
  its own. `composition-guards.test.js` pins the set behaviourally and by
  source, so a new async hydration path cannot quietly join without one.
- **Recoverable snapshot net (`store/snapshot-store.ts`).** The LAST line of
  defence: a SIDECAR IndexedDB (`perssonify-snapshots`, its own DB — independent
  of the injected StorageAdapter, must survive reloads) keeps a bounded, per-doc
  ring of prior content versions so anything the prevention layers miss stays
  recoverable. `saveActiveDoc` calls `snapshotStore.maybeRecordOnSave(...)` with
  the OLD stored content before overwriting (throttled to one/interval per doc,
  but a large content SHRINK — the "got wiped" signature, incl. an explicit
  clear — always snapshots as `pre-clear`); `deleteDoc` records a `pre-delete`
  snapshot so deleted docs are recoverable. Bounds: per-doc count + global byte
  budget + age, evicted oldest-first but NEVER a doc's single most-recent
  snapshot. Blank canonicals are never snapshotted (nothing to protect).
  Restore is via **Tools ▸ Version history** (`VersionHistorySheet`): restore
  in place (snapshots current first, so it's reversible) or as a new document
  (`restoreSnapshotInPlace`/`restoreSnapshotAsNew` in `useDocumentLifecycle`).
  Falls back to an in-memory ring when IndexedDB is absent (SSR/tests). Do NOT
  route snapshots through the main doc schema/adapter — the sidecar is
  deliberate (keeps the delicate doc save-path and IDB schema untouched).
- **Vitest only picks up `*.test.{js,jsx}`** (see `vitest.config.js` `include`).
  Test files must be `.js` — renaming to `.ts` silently drops them.
- **`src/components/ui/*` are generated shadcn primitives** — regenerate via CLI,
  don't hand-edit.
- Turndown checks **later-added rules first** (LIFO); order matters in `turndown-rules.ts`.
- **This project does NOT load `turndown-plugin-gfm`.** Turndown's core covers
  CommonMark only, so every GFM element needs a hand-written rule in
  `turndown-rules.ts` — and an element with no rule does not throw or warn, it
  falls through to "keep the text, drop the tag". That is how **strikethrough**
  came to be destroyed on every rich→markdown projection: TipTap's Strike
  renders `<s>`, nothing matched it, and `fidelity.ts` lists strike among the
  NATIVE marks so no warning fired either. Tables and task lists have their own
  rules for the same reason. When you add a mark or node to `TiptapPane`, check
  what it SERIALIZES to and write the rule; a round-trip test in one direction
  proves nothing about the other (`strikethrough.test.js` covered md → html for
  releases while the reverse silently lost the format).
- **Indent/outdent mean LIST NESTING, in both panes.** Markdown has no paragraph
  indent, so the rich side is `sinkListItem`/`liftListItem` — with the item type
  taken from the SELECTION, since a task item's node is `taskItem` and hardcoding
  `listItem` made indent dead inside every checklist. The markdown side is scoped
  by `mdIndentable`: list lines (nesting) and lines inside a fenced block (where
  indentation is the code) only. Four leading spaces on a paragraph is an
  INDENTED CODE BLOCK — measured, two clicks of Indent turned a paragraph into
  `<pre>` — so a button labelled "Indent" silently changed what the block was,
  and the two panes disagreed about the same button. A no-op on a paragraph, or
  on a list's first item, is correct.
- **`fidelity.ts` classifies against the RULE TABLES, never against intuition.**
  It answers "what will the markdown pane fail to carry?", so its sets must
  mirror `turndown-rules.ts`: `addBaseRules` runs for BOTH turndown instances
  (bold/italic/strike/code/link, plus `<u>`/`<sub>`/`<sup>` and the `sizedImage`
  `<img … width>` tag), so all of those are lossless in Clean AND Styled; only
  `addInlineStyleRule` — the `<span style="…">` carrier for colour, highlight
  and font family — is mode-dependent; and `textAlign` has NO carrier at all,
  making alignment the one formatting feature with neither a markdown nor an
  inline-HTML representation. Both directions of the mistake have shipped:
  strikethrough was classed NATIVE with no rule (destroyed silently, above), and
  underline/sub/sup/image-size were classed lossy despite having rules — so the
  shipped Welcome document, which carries one sized logo, opened with an amber
  "1 other not in MD" about formatting that was never at risk. A warning that
  flags our own renderer's output is worse than no warning, exactly as with the
  residual list. `clean-vs-styled.test.js` measures the real turndown output for
  every claim the Help page and README make about the two modes.

- **Post-await ownership check (`isEditorTargeting`, PerssonifyEditor).** Any
  path that writes a document and THEN pushes content into the live editor must
  re-check ownership AFTER the await, never capture it before. Persisting goes
  through IndexedDB, which is slow enough that a doc switch lands mid-write
  routinely; a pre-await `activeDocId === id` snapshot let `handleCardSave` and
  the bridge's `updateDocument`/`appendToDocument` push document A's content into
  an editor now holding B, which autosave then wrote into B's record. One helper,
  three call sites, each followed by `markHydrated`. This is the same chokepoint
  `saveActiveDoc` re-asserts after its own await. It checks `activeDocId` ONLY —
  also demanding `hydratedDocId` looks safer but swallows a REPAIR: a document
  that is active but unhydrated SHOULD receive the content it just persisted,
  which is how an activated-but-unhydrated doc is rescued from having every save
  refused.
- **Adding documents is a document-LEAVING path too.** `addDocumentsImpl` (and
  therefore the deprecated `setDocuments` that forwards to it) runs
  `prepareToLeaveActiveDoc()` and the same post-loop hydration hand-off as
  `importItems`. It activates the created document and overwrites both panes, so
  without the goodbye a host call destroyed whatever was typed in the open
  document's current autosave window.
- **The snapshot ring's memory ids are NEGATIVE** (`memSeq` counts down). IDB's
  autoIncrement only issues positive ids, so the two stores can never alias now
  that readers union both — sharing one space made `getCanonical(1)` return the
  memory record instead of the stored one, i.e. restoring the WRONG version in
  the one path whose job is recovering content. Every id-keyed operation
  dispatches on the sign.
- **Surfaces that read the LIBRARY must see live content.** `cardLoadDoc` prefers
  the live canonical for the hydrated doc (like `headingsForDoc`/`liveCanonicalFor`),
  and opening **Cards** flushes in-flight edits exactly as the map already did.
  Reading only the stored copy meant a card opened during the autosave window was
  seeded with pre-edit text, and saving it wrote that back over newer content —
  unbounded whenever the save was parked in `blocked`/`conflict`. Bulk/backup
  **export** flushes first for the same reason (a backup silently missing the last
  paragraph you typed is the worst kind).
- **Import is a document-LEAVING path.** `importItems` calls
  `prepareToLeaveActiveDoc()` (flush pending sync → cache the draft → capture undo
  history → autosave), exposed from `useDocumentLifecycle` for exactly this. It
  used to activate the imported doc and overwrite both panes with no goodbye at
  all, destroying anything typed in the current autosave window — not on disk, not
  in the draft cache, not in undo. It also HANDS OFF hydration afterwards: a
  `pmjson` item has no ingest HTML, so `activeDocId` moved to the import while
  `hydratedDocId` still pointed at the previous doc (editor showing the old text
  under the new identity, every later save refused). **The mid-loop switch guard
  checks `activeDocId` ALONE — never `hydratedDocId`**: `finalizeDoc(..., true)`
  activates without marking hydrated (the capture is what establishes hydration),
  so checking hydration there sends every markdown import — including the starter
  documents — down the no-editor fallback and titles them all "Untitled".
- **Every blank-canonical write goes through the backstop.** The `beforeunload`
  draft flush uses `patchDocById`, which has no blank guard (a host clearing a doc
  through the bridge is a legitimate write), so a blank canonical `saveActiveDoc`
  had deliberately REFUSED was written to disk anyway on tab close — the exact
  wipe the backstop exists to prevent, via the long way round. It now skips a
  blank draft over a non-empty stored doc. The one-shot clear permission is
  **scoped to the document it was granted for** (`blankSaveAllowedFor`): unbound,
  a permission from a clear whose save never happened stayed armed and disarmed
  the backstop for a different document.
- **`deleteDoc` claims the id before its awaits** (`deletingDocs`), and
  `saveActiveDoc` refuses to write a doc being deleted. `closeTab` only clears
  `activeDocId`/`hydratedDocId` at the very end, so an in-flight autosave passed
  the hydration re-assert and re-created the record after `storage.delete`
  committed. Bulk delete is sequential and awaited for the same class of reason.
- **`touchUpdated: false` is honoured by the ADAPTERS** via `stampUpdated`
  (`document.ts`) and the `_preserveUpdated` marker. Every `save()` used to stamp
  `updated` regardless, so the flag never did anything and recolouring or pinning
  a card re-sorted the board as if it had been edited.
- **`normalizeMarkdown` masks fenced code** before its whitespace passes, exactly
  as `preprocessMarkdown` does. Those passes run on every rich→markdown projection
  and collapsed blank runs / stripped trailing whitespace INSIDE code blocks.
- **Archive import skips hidden DIRECTORIES, not dot-prefixed filenames** — a note
  titled ".env setup" was written into a backup ZIP, counted in the export, and
  silently dropped on restore.
- **The snapshot store's memory ring is READABLE.** `record()` falls back to memory
  when an IDB write fails, but the DB is still open, so readers that short-circuit
  on `this.db` could never see those entries: the last line of defence was writing
  snapshots nothing could read back. Every accessor unions both.

- **A file dropped on the editor must not navigate the tab away**
  (`EditorLayout`'s `onDragOver`/`onDrop` → PE's `handleFileDropImport`). There
  was no drop handler anywhere in `src/`, so a file dropped on either pane got
  the browser default: the tab navigates to the file and everything typed since
  the last autosave is gone — the one gesture that leaves no draft, no undo and
  no snapshot. Only drags carrying `Files` are intercepted; a text/HTML drag
  inside the document still belongs to CodeMirror and ProseMirror. The
  `preventDefault` happens even with no importer wired (a library host may not
  pass `onFileDrop`) — losing the document is not an acceptable way to say "we
  can't import this". Pinned by `editor-file-drop.test.js`.

- **Every path that ACTIVATES a document and then captures the editor uses
  `activateAndCapture`** (PerssonifyEditor). `importItems`, `addDocumentsImpl`
  and `handleCardCreate` each did their own version, and two of them captured
  `editor.getJSON()` after two awaits with no re-check — so a switch landing in
  between wrote the OTHER document's content into the new record. The shared
  helper re-checks ownership (`stillOurs()`) after every await, exactly like
  `isEditorTargeting`. **Cards quick-capture is also a document-LEAVING path**:
  it calls `prepareToLeaveActiveDoc()` and switches back to `previousDocId`
  afterwards, or capturing a note destroyed whatever was typed in the open
  document's autosave window.
- **The surface-open flush oracle is `editing | saving | error`, not
  `editing`** (opening Cards / the map). Those surfaces read the LIBRARY, so
  they flush in-flight edits first — but keying the flush on `"editing"` alone
  missed a save that was mid-flight or retrying, which is exactly when the
  stored copy is most stale. A **`"conflict"`** status routes to
  `prepareToLeaveActiveDoc()` instead: it is terminal, so autosaving it would
  spin.
- **A caller-supplied `shouldShow` REPLACES TipTap's own `isEditable` gate**
  (`TableBubbleMenu`, `LinkBubbleMenu`) — it does not compose with it. Both
  bubble menus shipped mutating a read-only document because of that, and
  `CommandManager` has no editability check of its own to catch it. Every
  mutating chain goes through **`runBubbleCommand`** (`ui/bubble-menu-command.ts`),
  which bails when `!editor.isEditable` and blurs first when `view.composing`.
  Pinned by `bubble-menu-guard.test.js`.
- **The embed's `allowedOrigins` is the PARENT's origin, never its own.** The
  shipped iframe build could not receive a single host message because it was
  passing the editor's origin, and `createEditorClient` defaulted to `"*"` in
  both directions. `resolveAllowedOrigins` (`embed.tsx`) takes a validated
  `?allowed_origin=` (a literal `"*"` is REJECTED), else the origin of
  `document.referrer`, else `[]` — deny-all, which is the safe failure.
  `resolveEditorOrigin` (`host-bridge.ts`) derives the target from the
  iframe's own `src`. Pinned by `embed-origin.test.js`.
- **`typeof localStorage` EVALUATES the getter**, which throws where a browser
  blocks site data (Safari private mode, "block all cookies", some webviews) —
  so the feature-detect was itself the crash, and the app did not boot at all.
  Every access goes through **`utils/safe-storage.ts`** (`safeStorage.get/set/
  remove/available`, each try/caught); `uiStore`, `theme/palette`,
  `storage-adapter` and `crash-recovery` use it. Pinned by
  `blocked-storage.test.js`.
- **`claimEditorGeneration(willHydrate)` — claim when you will hydrate, observe
  when you will not.** `handleCloseTab`'s background-tab branch DOES hydrate
  (it opens the next document), so it re-claims immediately before that call;
  the foreground branch only observes. A path that hydrates without claiming
  cannot detect that a newer switch superseded it, which is the whole point of
  the generation guard.
- **The echo-gate hashes are committed AFTER the conversion, never before.** A
  converter that threw left the gate claiming the panes agreed, and the mirror
  stayed frozen for the rest of the session — the failure was silent and
  permanent. Same shape as `markHydratedAfterMdSync`, which now runs only when
  a projection actually happened (`if (projected)`); marking hydration for a
  projection that never ran pointed the chokepoint at content the editor does
  not hold.
- **An IndexedDB write transaction cannot await a read in ANOTHER transaction.**
  IDB auto-commits as soon as the microtask queue drains with nothing pending,
  so `snapshotStore.deleteForDoc` — which opened its write transaction and then
  awaited `allForDoc` — found `tx` dead and threw every delete into its own
  catch: it cleared the memory ring, emitted a change, and deleted nothing.
  Read first, in its own transaction, then open the write. `idb-storage-adapter`
  documents the same rule at length; it applies to the sidecar too.
- **The formatting chords are handled ABOVE the `tiptapHasFocus` early return**
  (`useKeyboardShortcuts`). TipTap does not bind what the Help page documents —
  `⌘⇧X` is `Mod-Shift-s`, `⌘⇧1–6` are `Mod-Alt-N`, `⌘]`/`⌘[` are bound by
  nothing, and `⌘⇧9` is `toggleTaskList`, so "Blockquote" produced a task list
  in one pane and a blockquote in the other. Every branch preventDefaults and
  dispatches, so the command applies exactly once through the choke point that
  carries the read-only and composition guards. `keyboard-shortcuts.test.js`
  drives a ref whose editor DOM CONTAINS the focused element — with
  `{ current: null }` the early return never executes and the tests prove
  nothing about the pane the bugs were in.
- **Toolbar state that depends on the ACTIVE PANE reads `queryState().pane`,
  not `uiStore.mode`.** In Split both panes exist, so the mode says nothing
  about where the caret is.
- **An effect that needs a mounted DOM node must not depend on handler identity
  to re-run.** `PerssonifyEditor` renders an "Initializing Engine…" branch before
  the editor container exists, so `useKeyboardShortcuts`' effect always runs once
  with a null ref. It returned there and relied on a LATER run to attach the
  listener — a run that only happened because every handler passed to it was an
  inline arrow with a fresh identity each render. Stabilising those handlers (the
  correct memoization work in this same branch) removed the accidental re-run and
  killed EVERY keyboard shortcut: measured after a reload, ⌘F, ⌘⇧D, ⌘⇧K and ⌘⇧G
  all did nothing, before and after clicking into the editor. The listener sits on
  `document` and resolves `containerRef.current` **at event time**, so nothing
  depends on mount order. **Memoizing a handler can turn an effect that used to
  re-run constantly into one that runs once** — when you stabilise props, check
  what was quietly relying on the churn. Three sibling effects were checked and
  are fine (the overlay effect is gated on the overlay opening; Cards measures a
  div it always renders; the map's wheel listener was MEASURED attaching, wheel
  zoom 240% → 300%). Pinned by `keyboard-shortcuts.test.js` and
  `e2e/probes/shortcut-after-reload.mjs`.

## Internal links (wiki links + heading anchors)
- **Wiki-link rendering is ON** in `useMarkdownEngine.ts` (`preprocessMarkdown(..., { wikiLinks: true })`).
  `[[Doc]]`, `[[Doc#Heading]]`, `[[#Heading]]` (current doc), and `|Display`
  variants become `<a data-doc-link data-anchor class="wiki-link">`. The Link
  mark is extended by `src/extensions/WikiLink.ts` to PRESERVE `data-doc-link`
  and `data-anchor` (stock TipTap Link drops them) — required for both click
  navigation (`useLinkIndex`) and turndown round-trip (`turndown-rules.ts`
  `wikiLink` rule keys on those attrs; filter uses `hasAttribute`, since a
  same-doc anchor has `data-doc-link=""`).
- **`scanWikiLinks` (link-index.ts) reads BOTH forms**: literal `[[…]]` in text
  (markdown-only / not-yet-rendered docs) AND rendered link marks (docLink attr).
  It strips a `#heading` anchor so the graph/backlinks connect documents, not
  `doc#heading` pseudo-targets; a pure `[[#Heading]]` anchor is not a doc link.
  Do NOT revert to text-only scanning — enabling wiki-link rendering turns
  `[[…]]` into marks, and text-only scanning would blind the graph/backlinks.
- **Incremental link index (perf hot path).** `useLinkIndex` no longer full-reads
  the WHOLE library on every single-doc save (that was N `storage.get` + a full
  `buildLinkIndex` per autosave). Its trigger effect diffs the `documents` list
  against a per-doc `{updated,title}` snapshot: membership change (add/remove) or
  **rename** → `rebuildLinks` (a rename can re-resolve OTHER docs'
  `[[wiki-links]]`, which a single-doc pass can't see); a pure **content edit** →
  debounced `applyIncremental`, which re-reads only the changed doc(s) and splices
  them via `updateDocInIndex`. Because `updateDocInIndex` MUTATES the index Maps
  in place, `applyIncremental` hands subscribers a fresh wrapper (`{...idx}`) so
  the backlinks/graph derive effects re-run. Any error falls back to a full
  rebuild. Invariant pinned by `link-index.test.js` ("incremental update matches
  a full rebuild after a content edit") — if incremental ever diverges from full,
  the classification is wrong; widen what routes to `rebuildLinks`.
- Heading-anchor navigation resolves by NORMALIZED heading text
  (`scrollToHeadingByAnchor` in PerssonifyEditor). True auto-update on heading
  rename is a tracked follow-up.
- **Right-click context menu** (`src/ui/EditorContextMenu.tsx` + generated
  `components/ui/context-menu.tsx`) wraps the panes and reuses `dispatch`; its
  "Link to heading" submenu inserts `[[#Heading]]` via `insertHeadingLink`.
- **Split-pane scroll sync** (`EditorPanes.tsx`) uses value-based echo
  suppression (remembers the exact scrollTop it wrote to the other pane and
  swallows that one echo) — never a timer. Do not reintroduce a setTimeout
  guard; it made the panes fight and dropped user scrolls. The mapping is
  **heading-anchored piecewise-linear**, NOT a single global percentage: it pairs
  corresponding headings on both sides (CM: `lineBlockAt(line.from).top` for each
  `^#{1,6}` line — works for off-screen/virtualized lines; Tiptap: heading
  `getBoundingClientRect` offsets) plus `(0,0)`/`(max,max)` endpoints, then
  interpolates BETWEEN anchors so each section's speed scales to its own relative
  height and headings stay in line. Anchors rebuild lazily when either pane's
  `scrollHeight` changes. No headings → falls back to top↔bottom (percentage).
- **Active-heading tracker** (`src/hooks/useActiveHeading.ts`): reports which
  heading the reader is scrolled to in the rich pane (the flat `h1..h6` index,
  same order as `extractHeadings`) for a live table-of-contents. **STRICTLY
  READ-ONLY** — it observes scroll/resize and reads rects, and MUST NEVER write
  `scrollTop` (a programmatic scroll would masquerade as a user scroll and fight
  the split-pane scroll-sync's echo suppression above). rAF-throttled; the pure
  core `computeActiveHeadingIndex(relativeTops, threshold)` (the last heading at
  or above the activation line) is unit-tested. Re-attaches on `revision` bump
  (doc switch / heading-count change).
- **View mode** (md / rich / split) is `uiStore.mode`/`setMode`, controlled by the
  `ModeSwitcher`, the View menu, a segmented control in `SettingsSheet`, and the
  `?view_mode=` param. Imposing a mode or read-only briefly runs the `pf-mode-fade`
  animation on the editor container (`EditorPanes.tsx` restarts it via reflow;
  opacity-only, no remount) for a graceful transition.
- **Editor images carry NO border-radius** (`.ProseMirror img` in styles.css +
  `[data-md-preview] img` in `useMarkdownEngine.ts`) — rounding clips corner pixels
  and truncates logos/screenshots with edge content. Keep them square.

## Library / embed parity (the "module system")

The product ships three ways from one codebase: the standalone app
(`main.tsx`→`App.tsx`), the iframe embed (`embed.tsx`) and the npm library
(`index.tsx`, `engine`, `store`, `integration` entries). Parity rules:

- **URL parameters are the APP SHELL's job.** `App.tsx` reads `ads`/`readonly`/
  `view_mode`/`import_url` and strips them; the editor component must not read
  `window.location` itself, or a library consumer's own query string opens dialogs
  inside their embedded editor. `?import_url=` is read DURING RENDER (an effect
  runs after the editor's first render, too late to seed it) and **pre-fills the
  importer without ever fetching** — a shared link must not make a visitor's
  browser hit an attacker-chosen address on load.
- **The library must not touch the host page.** The integration's next-themes
  provider writes a NAMESPACED attribute (`data-pf-theme`) with
  `enableColorScheme={false}` — with `attribute="class"` it rewrote the host's
  own `<html>` class and color-scheme. **`styles.css` must recognise
  `[data-pf-theme="dark"]` in the `dark` custom variant AND in the token block**:
  menus, dialogs, sheets, tooltips and toasts portal to `document.body`, OUTSIDE
  the editor's themed wrapper, so without it a library mount rendered every
  portalled surface light while the editor was dark.
- **A pinned theme must be read as such.** `resolvedTheme` reports the stored
  PREFERENCE; a provider pinning a theme exposes it separately as `forcedTheme`.
  Use `useIsDarkTheme`/`useThemeMode` (`theme/useThemeMode.ts`), never
  `resolvedTheme` alone, or a pinned theme is honoured by the CSS and ignored by
  the JS that picks the CodeMirror theme, card colours and theme-aware image
  sources. next-themes also makes a NESTED provider a no-op, which is why the
  embed pins on its own outer provider rather than the integration's.
  The provider itself must stay: `ThemeImage`, `CardsView` and `EditorPanes` read
  `resolvedTheme`, and without a provider `useTheme()` is an inert stub. Page-level
  CSS (Tailwind's `*` reset, `html` scrollbars, the webview pins, the `body`
  typography/background block) is scoped to **`.pf-app`**, which `index.html` and
  `embed.html` carry in the MARKUP (not added by JS — that flashes unstyled).
- **The published library stylesheet must not restyle the host page.** Tailwind's
  preflight is a GLOBAL reset — right for the app and the iframe embed (they own the
  document, and their configs keep it global), wrong for a stylesheet a consumer
  imports into an app that already has styles. Measured unscoped in a browser, it
  dropped the host's `<h1>` from 32px/700 to 16px/400, removed its links' underline,
  took 16px of margin and 40px of padding off its `<ul>`, and switched every element
  to `border-box` with a solid border-style. `build/scope-css.mjs`
  (`scopeLibraryBaseLayer`, wired into **`vite.config.ts` ONLY**) confines everything
  in `@layer base` to `:where(.pf-app, .perssonify-editor, [data-base-ui-portal],
  [data-sonner-toaster], [data-pf-portal])` and their descendants. `:where()` keeps
  ZERO specificity, so utilities still beat the reset exactly as before. The **`theme`
  layer is deliberately NOT scoped** — tokens must stay on `:root`, which is where the
  PORTALLED surfaces (outside the editor container) resolve `--background`/`--border`/
  `--primary` from; scoping it would leave every menu, dialog and toast unthemed. A
  selector that already names a root is skipped (`html.pf-app::-webkit-scrollbar`
  double-scoped matches nothing). **Anything we attach to `document.body` by hand must
  carry `data-pf-portal`** (the emoji suggestion list, the Find/Replace match ticks) —
  Base UI's own wrapper gives us `data-base-ui-portal` for free. Pinned by
  `src/__tests__/scope-css.test.js`.
- **`"use client"`** belongs on every hook-bearing library entry (`index.tsx`,
  `integration/index.ts`, `engine/useMarkdownEngine.ts`) — but NOT on
  `store/index.ts`, whose exports are server-safe.
- **`readOnly` is a prop** on both `PerssonifyEditor` and the integration, applied
  session-only via `useUIStore.setState` so a host can never overwrite a visitor's
  saved preference.
- **`setDocuments` is a deprecated additive alias for `addDocuments`.** It was a
  complete no-op — it called the store's PURE `createDoc` and discarded every
  result — so hosts got a success reply and an unchanged library.
- **The host bridge must expose everything the handle does.** `exportAs` and
  `getAssociations` were missing, and an unknown action RESOLVED with an error
  object instead of rejecting, so an iframe host's "Export as Word" silently did
  nothing. Unknown actions now reject.
- `documents`, `onFieldChange` and `onExport` on the integration are accepted for
  API compatibility and never consumed — marked `@deprecated`, not left looking
  functional.

## Feature architecture notes
- **Markdown flavors/features** live in `src/store/settings.ts` (persisted under
  `__prefs.markdownFeatures`), consumed by `build-marked.ts`. The Settings panel
  (`SettingsSheet.tsx`) drives them; `useMarkdownEngine` rebuilds marked on change.
- **Math** (`$…$`/`$$…$$`) → `math-marked.ts` emits data-attribute placeholders →
  TipTap `MathNodes.tsx` renders KaTeX (lazy) → turndown rules restore the source.
  **Insertion uses an equation dialog with a live KaTeX preview** (`Dialogs.tsx`
  `EquationDialog`, wired through `useDialog().equation` — a promise-based method on
  the shared `DialogApi` mirroring `prompt`). Insert ▸ Formula/Inline (MenuBar) and
  the toolbar Sigma menu call `equation(...)` then `dispatch("insertMathBlock"/
  "insertMathInline", latex)` — NOT the old bare `prompt()`. Existing nodes still edit
  in place via the `MathNodes` node view's inline `math-source-input` (unchanged). The
  dialog lazy-imports KaTeX the same way as the node view; ⌘/Ctrl+Enter submits (plain
  Enter is a newline for multi-line block math).
- **Mermaid/ABC** render in the code-block node view (`DiagramPreview.tsx`, lazy),
  round-trip as fenced code for free.
- **Highlight/background-color** is a `backgroundColor` attribute on the `textStyle`
  mark (`extensions/BackgroundColor.ts`), NOT the `<mark>` Highlight extension.
- **Callouts/admonitions** (`> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]`) — gated on the
  `callouts` feature flag. `> [!NOTE]` is valid blockquote syntax, so `build-marked.ts`
  overrides the **blockquote RENDERER** (not the tokenizer) to detect a leading `[!TYPE]`
  in the first `<p>` and emit `<div data-type="callout" data-callout="type">…</div>`
  (`extensions/Callout.ts`, `content: block+`, registered in BOTH TiptapPane and
  serialize-doc). Turndown's `callout` rule → `> [!TYPE]` + blockquoted body; it is added
  AFTER `plainDiv` (LIFO) so the attr-less callout div isn't swallowed by the plainDiv
  catch-all. The type label is a CSS `::before` (keyed on `data-callout`) so it never
  enters serialized content. Inline markdown inside a callout survives (marked already
  parsed the blockquote). Off ⇒ plain blockquote (prior behavior).
- **Collapsible details** (`<details><summary>`) — gated on `details`; hand-rolled
  `Details` (`content: "summary block+"`, `open` attr) + `Summary` (`content: "inline*"`)
  nodes (`extensions/Details.ts`, both extension arrays). NOT Markdown — round-trips as
  RAW HTML: marked passes the block-level `<details>…</details>` through untouched, the
  nodes re-parse it, and turndown's `detailsBlock` rule re-emits the element's `outerHTML`
  (like the `<picture>`/sized-image rules). **`details`/`summary` were added to
  `KNOWN_ELEMENTS` (ingest.ts)** so imports don't strip/flag them. The MD-pane insert
  template must be a SINGLE contiguous HTML block (no internal blank lines — a blank line
  splits marked's HTML block). The MD pane shows the raw `<details>` HTML for this block.
- **Interactive task lists** (`- [ ]`/`- [x]`) use `TaskList`/`TaskItem` from
  `@tiptap/extension-list` (no new dep; `TaskItem.configure({ nested: true })`),
  registered in BOTH `TiptapPane.tsx` AND `serialize-doc.ts` `SERIALIZE_EXTENSIONS`.
  There is **NO preprocessor pass** — marked's gfm list tokenizer detects tasks
  natively, and `build-marked.ts` **overrides the RENDERER** (gated on `taskLists` +
  gfm) to emit `<ul data-type="taskList"><li data-type="taskItem" data-checked="…">…`
  (suppressing the default disabled `<input>` via a `checkbox() → ""` override) — this
  preserves inline markdown INSIDE each item, which a raw-HTML preprocessor would have
  lost. The old `preprocessor.ts` `0d` checkbox pass was REMOVED (it stripped `[ ]`
  before marked saw it). Turndown's `taskListItem` rule reads the authoritative
  `data-checked` (fallback: `input[type=checkbox]`) and indents nested items under the
  marker; it must stay AFTER `tightListItem` (LIFO). **NESTING (do NOT regress):** a
  REGULAR list that merely CONTAINS a nested task list must NOT be treated as a task
  list. The marked `list` renderer decides task-ness from the FIRST DIRECT child only
  (`body…startsWith('<li data-type="taskItem"')`), NOT `body.includes(…)` (which matched
  a nested item and mis-tagged the parent `<ul>`). Turndown's `isTaskLi(el)` matches a li
  ONLY when it is itself a task item (`data-type="taskItem"`, or a checkbox whose
  `closest("li")` IS that li) — a plain parent `<li>` with a nested task list must fall
  through to `tightListItem`, or a recursive `querySelector('input')` rewrites the parent
  bullet as `- [ ]`. NOTE: the live TaskItem **nodeView**
  li carries only `data-checked` (not `data-type="taskItem"`) — the `data-type` is on the
  `renderHTML`/`generateHTML` (serialize) path that turndown consumes, so CSS targets
  `ul[data-type="taskList"] li` (not the li's data-type). `useMarkdownEngine`'s list
  inline-style injection and `PREVIEW_CSS`, plus `styles.css`, skip/override taskList so
  no disc bullet sits beside the checkbox. When `taskLists` is off, marked's default
  disabled checkbox renders (prior behavior); commonmark has no task detection.
- **Strikethrough is DOUBLE-tilde only.** marked's default GFM `del` also matches a
  single `~…~`, so a stray tilde (e.g. "~32 000") or an unpaired `~` rendered
  surrounding prose as strikethrough. `build-marked.ts` overrides the `del`
  tokenizer to require `~~…~~` (GitHub's rule); a single `~` stays literal. Do NOT
  restore the lenient single-tilde `del`. **Sub/superscript round-trip as
  `<sub>`/`<sup>` HTML** (turndown-rules.ts, mirroring the `<u>` underline rule and
  the MD pane's own `<sub>`/`<sup>` insertion) — NOT `~x~`/`^x^`, which collided
  with strikethrough. So single `~`/`^` carry no inline-format meaning.
- **MD pane list wrap hangs to the item text** (`CodeMirrorPane.tsx`
  `listHangingIndent` ViewPlugin): with line wrapping on, each list line gets
  `text-indent:-Nch; padding-left:Nch` where N = the content offset (leading
  whitespace + marker + space via `LIST_MARKER`), so wrapped continuation lines
  align under the item text, not the bullet. Nested lists indent further
  automatically.

## Verify before you commit
```
bun install
bunx tsc --noEmit      # type gate (must be clean)
bun run test           # vitest (must pass)
bun run build:app      # app build
bun run build          # library build
bun run e2e            # browser campaign (needs dist-app; see e2e/README.md)
```
CI (`.github/workflows/ci.yml`) runs all of the above on PRs to `main`.

**`e2e/` is where the things jsdom cannot see are tested** — real IME
composition through CDP, real IndexedDB, quota exhaustion, blocked storage, a
second tab, coarse pointers, and duration. Every guard in it was
mutation-tested (revert the fix, confirm the case goes red); a case that cannot
fail is worse than no case. Timing is measured (`e2e:perf`) but never asserted
in CI — this container's wall-clock varies by more than 50% run to run.
**`e2e/README.md` also states what the campaign does NOT cover** — keep that
section honest when you add or remove a case; "the browser tiers are green" is
worth nothing if the reader has to guess what was in them.

**A layout switch keyed on an ELEMENT's measured width cannot be tested by
resizing the window.** The toolbar's compaction (`TOOLBAR_COMPACT_BP`) and the
cards board's column count (`useColumnCount`) are ResizeObservers precisely
because a library consumer mounts the editor into a container narrower than
their page — so in the standalone shell, where both spans equal the window, a
window-resize case passes against a media query too. `cases/surfaces.mjs`
narrows `.perssonify-editor` inside a wide window instead, which is that
geometry. Two related traps, both found by mutation-testing: the workspace
panel does NOT narrow the toolbar (it is a full-width band above the row the
panel shares — Toolbar.tsx claimed otherwise until 1.76.0, a comment stranded
by the WorkspacePanel refactor), and the panel's width is re-clamped against
the viewport, so it cannot be relied on to move a board across a threshold.

### Testing invariants (they are as load-bearing as the code)
- **A test that cannot fail is worse than no test.** Mutation-test every guard:
  revert the fix, confirm the case goes red, restore. Four cases in this suite
  were found vacuous that way, and `suppression.test.js` had THIRTEEN describing
  a `suppressNextUpdate` flag `TiptapPane` has never had. Where a guard is
  genuinely unobservable (a memo that only changes a hit rate, an unreachable
  belt-and-braces check), say so in a comment instead of writing a case that
  passes either way.
- **Vitest collects `*.test.{js,jsx}` ONLY** (`vitest.config.js`). A `.ts` test
  is silently ignored; a test that renders JSX must be `.jsx`.
- **`fake-indexeddb` (devDependency) is how the persistence layer is tested.**
  `import "fake-indexeddb/auto"` at the top of the file gives real IDB with real
  transaction auto-commit semantics. The snapshot store's `_resetForTests()`
  forces its in-memory fallback by default; pass **`{ useIndexedDB: true }`** to
  drive the database path. Do not `deleteDatabase` between cases — the store
  keeps its connection open and exposes no `close()`, so the delete BLOCKS;
  clear the object store through a second connection instead.
- **`e2e/lib.mjs`'s `mdText` scroll-accumulates, and de-duplicates by TEXT with
  a half-line tolerance.** CodeMirror virtualises: reading `.cm-line` once
  returned **969 characters of a 60 KB document**, so every markdown-pane
  assertion was answering a question about 1.6% of the text. But scrolling alone
  is not enough and the first attempt was WORSE than the bug it fixed — CM
  refines its height estimates as lines scroll past and positions the content
  10px differently at scrollTop 0, so a key of `offsetTop` recorded the same
  line many times: a 30-token run came back as 360. Under-reading fails loudly;
  over-reading produces a plausible wrong number. Neither simplify it back to a
  single query nor key it on position alone. **`e2e/cases/harness.mjs` is the
  proof** — it reads a document of 400 uniquely-numbered lines and asserts every
  one is recovered exactly once, from both ends of the document. A rig that
  cannot be checked is not evidence.
- **Assertions poll, they do not sleep** (`until` / `waitUntil` / `waitForMirror`
  in `e2e/lib.mjs`). A fixed budget tuned on one machine does not report "too
  slow" on a slower CI runner — it reports the same FAIL a real regression does.
  A fixed sleep is correct for exactly one thing: a NEGATIVE assertion, where
  there is nothing to poll for.
- **Documentation anchors are gated.** `#L123` links from `docs/` into `src/`
  are checked by `doc-anchors.test.js`; `node scripts/doc-anchors.mjs --fix`
  repairs them. A symbol that is only MENTIONED in the target file gets no line
  number at all — an arbitrary first occurrence is false precision.
