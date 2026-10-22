# CLAUDE.md — agent context for Markdown Studio

> **Monorepo:** this is `apps/web` of a Turborepo (the repository root's
> [CLAUDE.md](../../CLAUDE.md) has the layout and its rules). Every path below
> is relative to `apps/web`; `bun.lock` and the hoisted `node_modules` sit at
> the repository root, two levels up, as do `.github/`, `.node-version` and
> `SECURITY.md`. Run commands here or through Turbo from the root. The
> frontend was moved in unchanged. How it is served — headers, rewrite, cache
> rules — is the ROOT `vercel.json` (`../../vercel.json`: its top-level `headers`
> and its `web` service); Vercel and, on AWS, infra (`infra/lib/site-config.ts`)
> both serve it from that one file.

> **The product is Markdown Studio** (home: markdownstudio.com). The repo, the
> npm package (`@perssonify/editor`) and every DATA identifier keep their old
> names ON PURPOSE — `pf:` preference keys, the `perssonify-document` export
> envelope, `perssonify-backup` archives, the `perssonify-snapshots` IndexedDB
> database, the embed's `perssonify-embed-docs` database and the image store
> (`perssonify-assets`, the `pf-asset:` scheme, `assets/<hash>.<ext>` in ZIPs and the
> envelope's `assets` member) are on-disk contracts with existing installs.
> Renaming them orphans users' documents. The display name lives in `APP_NAME`
> (`src/constants.ts`) with `APP_DOMAIN`/`APP_URL` beside it; surfaces that can't
> import TypeScript (index.html, embed.html, site.webmanifest, the PWA manifest in
> vite.app.config.ts) are pinned to it by `src/__tests__/app-identity.test.js`.

`@perssonify/editor` is a **dual-pane, bidirectionally-synced Markdown editor**:
a CodeMirror 6 raw-markdown pane and a TipTap/ProseMirror rich pane kept in sync.
Documents live in the browser's IndexedDB; the only server code is the opt-in
URL-import relay (`api/import.js`, see Security invariants). Ships as both an
embeddable library (`dist/`) and a standalone app (`dist-app/`). Package manager:
**Bun 1.4.0** (`packageManager`) — always `bun install --frozen-lockfile`.
Finding IDs cited as `A0xx` come from the 2026-09 production-readiness audit;
`docs/audit-2026-09.md` is the register and the list of what remains.

## Where things live
- `src/App.tsx` — standalone-app shell: routing (`src/app/router.tsx`, history API,
  real `/about` `/help` `/graph` paths — Vercel SPA-rewrites everything except
  `/api/`, `/assets/` and `/.well-known/`, so a missing chunk is a 404, A012),
  interior pages, and the first-run guided tour.
- `src/ui/pages/` — routed interior pages (`AboutPage`, `HelpPage`, shared
  `PageChrome`); copy/data in `help-content.ts`, `src/data/credits.ts`.
- `src/ui/tour/walkthrough/index.tsx` — custom spotlight tour targeting `data-tour="…"`
  anchors on real UI (menubar / mode-switcher / settings / toolbar / editor).
- **First-run library** (`src/data/starter-documents.ts` + `DEFAULT_CONTENT`): the app
  seeds **three** cross-linked documents, not one — **Welcome** (the `initialDocument`),
  **Changelog** (a living in-app release log, meant to be cleared at each release), and
  **Getting started** filed in a `Guides` FOLDER (it replaced an "About Perssonify"
  agency brochure before the open-source launch). They `[[wiki link]]` to each other
  ON PURPOSE: with a single document the relationship map opened on one unconnected dot
  with nothing to explore, and the folder gives it a labelled cluster too. Seeded via PE's
  **`starterDocuments`** prop — standalone app ONLY (`App.tsx`); an embedder's
  `initialDocument` stays exactly one document. They are seeded by the boot sequence
  (`useEditorBoot`, `src/editor/useEditorBoot.ts`) through the ordinary
  `importItems` path AFTER the initial doc is live — so they convert against the
  mounted editor's schema; `importItems` never activates anything, so Welcome stays
  open — and failures are caught so startup can't break. Seeding happens only when
  storage is empty AND `noteLibraryAtBoot` finds no sign of a wipe (see the
  durability invariant); deleting them is permanent.
  **Wiki links resolve by TITLE, which comes from the first `# H1`** — renaming a
  heading silently breaks the seed graph, so `src/__tests__/starter-documents.test.js`
  asserts every link target is a seeded title and no document is orphaned.
  The test takes `WELCOME_TITLE` from the Welcome document's OWN H1
  (`titleOf(DEFAULT_CONTENT)`): since 1.76.0 that title is "Markdown Studio", so the
  other starters link to it as `[[Markdown Studio|Welcome]]`. The test used to
  hard-code "Welcome", so it agreed with `[[Welcome]]` links that resolved to
  nothing and were drawn as broken on first run.
- `src/store/documents/doc-outline.ts` — `extractHeadings(canonical)` + `buildHeadingTree()`
  (stack-nesting), consumed by the Workspace Outline tab. **`src/ui/graph/graphView/index.tsx`
  is the MAP-ONLY knowledge-graph overlay** — the force-directed relationship graph
  of the whole workspace (documents + wiki-links + folder clusters).
  **There is NO in-graph document-structure view** — single-doc structure lives in
  the **Workspace panel's Outline tab** (`workspacePanel/index.tsx`, visible beside the
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
    if it would cross a folder container the note does not belong to (`reject` =
    `crossesForeignContainer` — it cannot be a shared obstacle, since a note's own
    container must not block its own name), or fall outside the canvas (`bounds`).
    The veto ignores a foreign box the note's DOT already sits in, and any foreign
    box when the name lies wholly inside the note's OWN box: both only happen where
    folders overlap, and vetoing them stripped a 2,000-note map of every name.
    Only notes whose dot is ON the canvas compete for the `LABEL_CANDIDATES` slots
    — the best-connected notes of the whole map left a zoomed-in view unnamed. Dropping a label is the
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
    in `src/store/graph/graph-metrics.ts`, unit-tested), highlighted on demand with an
    OFF-by-default ghost-target overlay (ghost nodes are excluded from the sim).
    The chips are the FILTER; the rail lists the actual notes behind each count.
  - **The rail is the whole information layer.** With a node selected: title,
    folder/state tags, three stat cells (links in · out · headings), Open/Focus/
    Isolate, then the document's **headings** (`headingsFor`, capped at 10 — click
    one to open the doc there via `onOpenHeading` → `scrollToHeading` in
    `src/editor/useHeadingNavigation.ts`), BOTH
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
    label↔label, label↔dot, label↔chip and label↔canvas-edge are all **zero**.
    **chip↔chip is not always zero** — that claim was here too and was wrong on the
    old build and the new alike: a 150-note `mapLibrary` workspace measures 1 at
    desktop 4-out and phone fit, a 400-note folder map 24 at phone 4-out. **Container↔container and a stranger's dot inside a container are NOT
    zero** — that claim used to be here too and was wrong: with `e2e/map-library.mjs`
    at 153 notes in 15 skewed folders they measure 20 and 158 at fit (25 / 339 before
    A088), while every TEXT overlap stays zero.
  - **Folder maps get a FOLDER-AWARE layout (up to `FOLDER_LAYOUT_MAX`, 500
    notes).** With folders the old layout STACKED notes on the same spot — 150
    notes in 15 folders rested at 117 distinct positions — for four reasons, each
    fixed and each mutation-tested: notes were seeded on ONE ring, so a folder's
    members started scattered and every container started spanning the world (now
    `seedPositions`: each folder its own shelf-packed cluster); `worldFor` stopped
    growing at 23 notes (now `worldFor(n, withFolders)` grows with a folder map's
    notes — `FOLDER_NOTE_AREA`); the 1/d² repulsion is uncapped and the container
    constraint and walls keep making close pairs, so a pair two units apart was
    thrown ~1,700 units in a step (now `FOLDER_MAX_SPEED`); and folders pushed
    apart were clamped to the wall member by member (now `shiftGroup` moves a
    folder as a unit). Measured (`e2e/probes/map-stacks.mjs`): every note on its
    own spot at 150 and 400 notes. **A folderless map is untouched** — its seed,
    world and dynamics are the old ones, pinned bit-for-bit. The zoom floor is 6%
    so Fit can show a folder map's larger world.
  - **Above `FOLDER_LAYOUT_MAX` a folder map is laid out on TWO LEVELS**
    (`planFolderLayout` + `stepTwoLevel`): the single-level settle is chaotic there
    (2,000 notes in 60 folders rested at ~790 distinct positions, stacks of 89).
    **Level 1** is made whenever the map is seeded — on open, and when a note changes
    folder (`planKey`, sorted: the graph arrives in varying order). Each folder is a
    rectangle sized for a grid of its notes' dots and names (at least its name tab),
    plus one for notes in no folder; they are packed largest first at the free spot
    that best balances "next to linked folders" against "grows the block"
    (`PACK_COMPACT`). Candidates sit flush against placed rectangles and are
    accepted only where nothing is, so no two regions come within `REGION_GAP` BY
    CONSTRUCTION; a cell grid keeps that test local (a full scan was cubic — 2.5 s
    for 1,000 folders). The plan does not depend on arrival order. Each note gets a
    HOME cell — breadth-first along its region's links, middle first, with a hashed
    wobble. **Level 2:** repulsion and springs act only WITHIN a region
    (cross-region springs drove notes into walls and stacked them again); each note
    is pulled to its HOME, not the region's middle (the centre packed densest and
    names ran through each other); each note is HELD where its dot, name and
    container padding lie inside its region, and a container its name tab widens
    past the region is shifted back as a unit — so containers cannot overlap and no
    stranger sits in one, at any zoom down to Fit. Entering or leaving a plan
    re-seeds EVERY note, so a library always rests the same way; a dragged note is
    held inside its region (`clampToRegion`); the world comes from the plan, not
    `worldFor`. Measured: 600 and 2,000 notes in 60 folders — every note distinct,
    0 overlapping boxes, 0 stranger dots, 0 text overlaps; settles in 1–2 s at 600
    (was 12–24 s). Pinned by `graph-two-level.test.js`, the 600-note case in
    `graph-large-map.test.jsx` and the stress tier. Adding, removing or refiling a
    note on an open large folder map re-settles the whole map.
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
    `framesRef` counts STEPS so `MAX_FRAMES` remains the same hard budget. Large
    maps are also capped by the clock (`SLICE_MS`, next bullet).
  - **Above `LARGE_MAP_MIN` (250) notes the map is drawn and paced for scale; at or
    below it nothing changes** (A088). Ordinary dots, links and arrowheads are batched
    `<path>`s (`store/graph/graph-draw.ts`, integer hundredths inside
    `scale(1/BATCH_UNITS)`), memoized on `layoutVersionRef` and the zoom, never on
    the camera position; open, selected, hovered and keyboard-focused notes are drawn
    in full on top, and the pointer is hit-tested in code against the copy that was
    PAINTED. Each loop frame holds, paints or steps (`planFrame`) — never a step and
    a paint in one frame, never a step in the frame that shows a paint; extra steps
    stop at `SLICE_MS`, and the layout holds for `CAMERA_HOLD_MS` after camera or
    pointer activity (held steps are deferred, not skipped). Under reduced motion the
    settle runs in slices and draws nothing that moves (`drawPosRef`). Batched dots
    carry `pf-node-dots` plus `data-doc-ids` in draw order (`parseCircles`,
    `e2e/map-measure.mjs`) — keep them measurable. Measured at 2,000 notes under 4×
    CPU: first frame 8.9 → 1.0 s, blocking 64 → 6 s, a frame 3.7 s → 83 ms.
  - **The layout is `stepLayout` in `store/graph/graph-physics.ts`.** At or below
    `BARNES_HUT_MIN` (300) it is the exact loop — a FOLDERLESS map pinned
    bit-for-bit against `graph-legacy.js` (a frozen copy of the old loop — never
    "fix" it; folder maps changed on purpose, above); above it,
    Barnes–Hut (θ 0.9) plus a grid for the label-room pairs. Coincident notes are
    separated by `pairJitter`, never `Math.random`. Container membership is a
    lookup; `folderBounds` is `folderRects` without the chip, and both come from
    `containerGeometry`. `placeLabels` and the chip scorer query `BoxGrid`, which
    must stay EXACTLY equivalent to the linear scan (insertion-order sums).
  - (History: an earlier build led with the document structure; that was reversed
    once the Outline tab took over structure — do not re-add an in-graph structure
    pane. An earlier build also floated the inspector over the canvas — do not
    re-add that either.)
- **The workspace overlay is a labelled REGION, not a modal.** It covers `<main>`
  only — the menu bar, workspace panel and surface switcher stay usable beside it
  by design — so `aria-modal="true"` told screen readers to ignore controls the
  design intends you to use. Instead, the covered editor (which must stay mounted)
  is marked **`inert`** while an overlay is open, imperatively, because React 18 (still
  in the peer range) does not forward `inert` as a prop and 19 treats it as a boolean. The same pattern covers the interior pages
  (`PageChrome`), which additionally take focus and restore it. Do NOT add a Tab
  trap: the switcher outside is meant to be reachable.
- **Workspace views are ONE exclusive selection** (`workspaceView: "editor"|"map"|
  "cards"` from `useWorkspaceViews`, `src/editor/useWorkspaceViews.ts`, which also holds
  the overlay's focus/inert effect `useOverlayInert`). Cards and the map are PEERS — full-canvas views of
  the whole library, each an overlay over `<main>` with the editor still mounted — so
  they are derived from one value and rendered through **one overlay shell**, not two
  independent booleans. They WERE two booleans, and both could mount at once: two
  `aria-modal` dialogs at the same z-index with the map invisible **beneath** Cards
  (so View ▸ Relationship map looked like a dead menu item), both assigned the same
  `overlayRef` so focus/Escape targeted whichever mounted last. Every open/close goes
  through `setWorkspaceView` / `toggleWorkspaceView`; the graph half must keep routing
  via **`setGraphVisible`** (NOT `setShowGraph`) or the standalone app's `/graph` route
  control desyncs. Surfaced as a **three-way `ButtonGroup` beside the ModeSwitcher**
  (`data-tour="workspace-views"`, `SURFACES` in `menuBar/index.tsx`: **Editor · Cards · Map**,
  `aria-pressed`), mirrored by a radio group in the View menu. **Editor is a first-class
  option, NOT "both overlays off"** — leaving a view by un-toggling the button you
  entered through read as an escape hatch. So the switcher buttons SELECT
  (`setWorkspaceView(x)`) while the **keyboard shortcuts stay toggles**
  (`toggleWorkspaceView`, so ⌘⇧K twice returns). Choosing a LAYOUT (MD/Rich/Split)
  routes through `handleSetMode` (`useWorkspaceViews`), which also returns to the editor — those panes
  are invisible under an overlay, so it would otherwise be a control that silently does
  nothing. Same reason the heading/anchor navigation paths call `setWorkspaceView("editor")`
  rather than just `setGraphVisible(false)`. The switcher stays visible because the
  overlay only covers `<main>`. Pinned by `src/__tests__/workspace-views.test.js`.
  **Escape belongs to what it was pressed in** (A057): Cards and the map listen in
  the BUBBLE phase through `overlayShouldHandleEscape` (`ui/shared/utils/overlay-escape.ts`: not
  `defaultPrevented`, not composing, pressed inside the overlay or with nothing
  focused, and no VISIBLE modal, menu or listbox open outside it). The old
  capture-phase close shut the board when Escape was meant for a card's delete
  confirmation, shut the map mid-rename (the blur then committed the rename being
  cancelled) and discarded the composer's draft; a hidden listbox parked on `<body>`
  (the emoji list) held every Escape until visibility counted.
- `src/ui/chrome/menuBar/index.tsx` defines its menu content once (`sections`) and renders it
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
- **`src/ui/share/linkBuilder/index.tsx` is the ONE share/embed builder**, rendered both in
  Tools ▸ Share / embed link (`LinkBuilderDialog`, now just dialog chrome) and
  inline on the Help page under "Sharing & embedding". Help used to carry a
  cut-down copy that could only produce `?import_url=` links, so the reference
  list documented far more than the widget beside it could build. Every parameter
  (`view_mode`, `readonly`, `import_url`, `theme`, `accent`, `chrome`, `bg` — and
  `ads` only in a dev build, `adsAvailable()`) has an enable switch plus a value
  selector; only enabled ones are written, as a standalone link and an iframe
  snippet. Links target the app ROOT — composing from `window.location.pathname`
  produced `/help?view_mode=md`, which opens the Help page rather than the editor.
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
  before the page sees the key, which is why ⌥⌘F exists. ⌘⇧K = Cards board. The
  **"Keyboard navigation" group** documents keys that are not chords (skip link,
  Esc-then-Tab out of the markdown pane, the roving toolbar and library tree) —
  a navigation key nobody can discover does not exist for a keyboard user (A094).
- **Appearance controls live once in `src/ui/settings/themeControls/index.tsx`** (`ThemeSwatch`,
  `ThemeCircleRow`, `AccentCircleRow`, `THEME_OPTIONS`) and are reused by the
  View ▸ Appearance menu (`menuBar/index.tsx`) and the Settings sheet (`settingsSheet/index.tsx`).
  Theme radios bind next-themes' **raw `theme`** (NOT `resolvedTheme`) so "System"
  is a genuine selectable value; app default is `system` (`main.tsx`). Embeds stay
  host-controlled (`embed.tsx` keeps its `theme` param / dark default).
- **Reading & typography** (`uiStore`: `editorFontSize`/`editorLineHeight`/`readingWidth`/
  `spellcheck`/`focusMode`; persisted `pf:font-size`/`pf:line-height`/`pf:reading-width`/
  `pf:spellcheck`/`pf:focus-mode`). Font size / line height / reading width are pushed as
  **CSS custom properties** (`--editor-font-size`/`--editor-line-height`/`--reading-width`)
  set inline on the editor split container (`editorPanes/index.tsx` `splitRef`) and read by BOTH
  panes: `.ProseMirror`/`[data-md-preview]` (styles.css) and CodeMirror's `.cm-content`
  (`cmTheme()` — vars, NOT hardcoded 13px/1.6). **Reading width caps the CONTENT column**
  (`.ProseMirror`/`.cm-content` `max-width` + `margin-inline:auto`), never the flex pane —
  capping the pane breaks the split-divider math. **Spellcheck** rides a CodeMirror
  `contentAttributes` Compartment (live-reconfigured) and BOTH Tiptap `editorProps.attributes`
  objects (init + theme effect, with `spellcheck` in the effect deps). The rich-pane wrapper's
  Tailwind `prose-sm`/`text-sm` were removed so the font-size var wins. **Focus mode** dims the
  chrome via a `.pf-focus` class on the `PerssonifyEditor` CONTAINER (encloses menu bar /
  toolbar / status bar / `[data-pane-header]`), styled **opacity/transition ONLY** (never
  height/visibility — the shell's height is owned by `.pf-shell`), with hover/`:focus-within`
  restoring full opacity. Surfaced in Settings ▸ "Reading & typography" + a View-menu Focus-mode
  checkbox.
- **Structured "Select" engine** (`src/formatting/select-scope.ts`): the Select… ▸
  submenu (Edit tab + right-click, shared renderer `src/ui/chrome/selectMenuContent/index.tsx`).
  **Selection-only** — every entry places a real selection, no act-on-all actions
  (those belong to the toolbar / Find▸Format). Contiguous: `selectAll`/`selectBlock`
  (active pane). Scattered scopes (all headings/H1-6, paragraphs, list items,
  code blocks, blockquotes, table rows, images, inline code, links) place a
  **multi-range selection in the MD pane** via `dispatch("selectScope",{scope})` →
  `selectScopeCM` (CodeMirror `allowMultipleSelections`). **Each range is the
  CONTENT, never the block marker** (`## `, `> `, `- `, `1. `, `- [ ] `, a heading's
  closing `#`s); a table row selects each cell (split by `cellSeparators`) and skips
  the delimiter row. With the marker selected, Select ▸ All headings + Bold wrote
  `**## Alpha**` — a paragraph — and **markdown-pane formatters act on EVERY range**
  (`mdWrapBy` over `changeByRange`, `selectedLineNumbers`), never `selection.main`,
  which left every heading but the first untouched (A054). Code fences are found by
  ONE CommonMark tracker (`fencedBlocks`/`fencedLineMask`, select-scope.ts) shared by
  case transforms, these scopes and Find's heading/code scopes, so a `# comment` in
  a fenced `bash` block is never a heading (A062). Selection commands are
  non-mutating → allowed in read-only (routed before the read-only guard).
  The clipboard group (Cut/Copy/Paste/Select all/**Clear formatting**) sits with
  the Select… submenu in both menus.
- **Markdown-pane text tools must never delete content.** Clear formatting
  (`clearMdFormatting`) masks code spans, images, link destinations, autolinks,
  bare URLs and inline maths, unwraps only formatting tags and strips only
  balanced, flanking emphasis — its old `<[^>]+>` / `\*(.+?)\*` passes deleted
  `<img>` tags, autolinks, list bullets and the `*` in `5 * 3 * 2` (A055). Table
  operations split rows the way marked does (`cellSeparators`, md-table-ops.ts: a
  `\|` is content and a `[[Doc|Alias]]` one unit), keep an explicit `:---` and
  re-apply a table's list indentation — adding one row to a table holding either
  used to split it into more columns (A053). ⌘K and Insert ▸ Image write the URL
  that was entered (`mdLinkDestination`: angle brackets when it holds spaces or
  parentheses) — they wrote a literal `(url)` placeholder.
- **Admin settings** (`SettingsSheet` "Admin" section) are operator/debug toggles,
  **hidden unless `adminSettingsAvailable()`** (`utils/build-gates.ts`: a dev build,
  or `localStorage["pf:admin"] === "1"`, a per-browser opt-in for support sessions —
  A081): `consoleEnabled` (`pf:console`, **default off**; gates the diagnostics
  Console tray tab), and Show ads (dev builds only). **While the section is hidden
  those switches read their DEFAULTS** (`uiStore`), or a value stored before the gate
  existed would stick with no control left to change it — `admin-prefs-fallback.test.js`.
  Add new admin-only modules here. `contextMenuEnabled` (`pf:context-menu`) USED to be
  one; it is an everyday switch now, Settings ▸ Editor ▸ **Custom right-click menu**,
  honoured in every build (PL-51: off → the browser's own menu, which is the only
  route to its spelling suggestions). **Shift + right-click always reaches the
  browser's menu** over the editor's and the library's custom ones
  (`passShiftContextMenuToBrowser`, `ui/shared/utils/native-context-menu.ts`: the
  event is stopped in the CAPTURE phase, before Base UI's trigger and its document
  listener cancel the default), and the editor's menu ends with that hint —
  `native-context-menu.test.jsx`.
- **Diagnostics console** (`src/ui/diagnostics/consolePanel/index.tsx` + `src/store/diagnostics/console-commands.ts`):
  an admin-gated (`consoleEnabled`) bottom-tray tab running a **CURATED, READ-ONLY**
  command registry (`CONSOLE_COMMANDS` + `runConsoleCommand`) over EXISTING read
  APIs — `diag.lifecycle` (`getLifecycleState`), `diag.storage` (`getStorageMetrics`),
  `docs.list`, `doc.outline` (`extractHeadings`), `doc.links`
  (`getBacklinks`/`getForwardLinks`), `graph.stats` (`exportGraph`). It is **NOT an
  `eval` REPL** and exposes no arbitrary property access: PE injects a typed
  read-only `ConsoleContext` of getters (`useConsoleContext`,
  `src/editor/useBottomTray.tsx`; no write path); adding a capability means
  adding a vetted entry, never a general escape hatch. `console-commands.ts` is PURE
  (tests inject a fake context). If a mutating command is ever added it MUST route
  through `dispatch`/`patchDocById` and honor read-only — never a raw storage write.
- **Unified Workspace panel** (`src/ui/workspace/workspacePanel/index.tsx`): a single **left-docked
  tabbed tray** that consolidates the former left library Sidebar and the document
  **Outline** into ONE surface — **Files / Outline** tabs (`WorkspaceTab =
  "files"|"outline"`). Document-first: the Files tab is the single library (search,
  new doc/folder, select mode + bulk export/delete via `useDialog().confirm`,
  drag-to-import, `FolderTree` when unfiltered / a flat per-doc list when
  searching or in select mode, per-doc export DropdownMenu, footer count, AdUnit
  in dev builds); selecting a doc updates the Outline live. **Both lists are
  WINDOWED** (`ui/workspace/hooks/use-windowed-list.ts`: measured variable heights, with the focused
  row, a rename and an open menu PINNED so focus never drops to `<body>`), rows are
  memoized on PRIMITIVES (`storage.list()` returns fresh summary objects on every
  save, so a memo on the object never bailed out) and the search filter runs on
  `useDeferredValue`. Measured in jsdom at 2,000 documents: 52,052 → 807 elements
  and 2,266 → 16 ms per autosave (A082). The tree is a flat WAI-ARIA tree
  (`aria-level`/`aria-posinset`, one roving tab stop, arrows/Home/End/Enter, F2
  rename, Shift+F10 menu) and the flat list a listbox (A094).
  Outline reuses **`TocList`**
  (exported FROM `docNavPanel/index.tsx`, along with `EmptyOutline`; the `DocNavPanel`
  component itself is now dead but retained as their home). **There is NO in-panel
  graph tab** — an earlier "Map" tab (a horizontal `DocumentGraph`, then a vertical
  `StructureMap`) was tried and REMOVED: the outline covers document navigation, and
  the knowledge graph is the full-screen **relationship-map overlay** toggled from
  the View menu / graph button (`graphVisible` from `useWorkspaceViews`,
  `src/ui/graph/graphView/index.tsx`) — do not
  re-add a graph into the narrow dock. `StructureMap.tsx` was deleted; a persisted
  `pf:workspace-tab==="map"` migrates to `"outline"` in `uiStore`. This **replaced
  the shadcn Sidebar + DocNavPanel + the old `docNav` "closed|toc|split|full" expand
  ladder** — `Sidebar.tsx` was DELETED and the docNav reconcile effect removed.
  **Open/closed** is `uiStore.showSidebar` (persisted `pf:workspace`, viewport-aware
  default: OPEN on desktop, CLOSED on phones so the drawer doesn't cover the editor
  on first load); the **active tab** is `uiStore.workspaceTab` (`"files"|"outline"`,
  persisted `pf:workspace-tab`; a stored `"map"` from the removed tab migrates to
  `"outline"`); **width** reuses `docNavWidth`
  (`pf:docnav-width`, clamped in `setDocNavWidth`). It is a flex sibling of the
  editor inside the `pf-editor-row` wrapper and **comes BEFORE `<main>` in the DOM**
  — it used to render after `<main>` and be pulled left with `md:order-first`, so
  keyboard users reached the library only after the toolbar and both editors
  (A094). A docked column on `md+` at the persisted width; a left-overlay drawer on
  phones that takes focus, closes on Escape and hands focus back (to the reopen
  button when its opener is gone) — and on phones **selecting a doc closes the
  drawer** (`onSelect` → `handleSwitchDoc` + `if (isMobile) setShowSidebar(false)`).
  The resize divider is on its RIGHT edge (`-right-1`; width = pointer X − panel
  left edge, via `useDividerDrag`). When closed, a small `PanelLeft` reopen button
  sits at the editor's top-left. Opened
  via **View ▸ Toggle workspace panel** (⌘⇧D) and **View ▸ Outline**
  (`MenuBar.onOutline` → `setShowSidebar(true)` + `setWorkspaceTab("outline")`).
  The `useActiveHeading` tracker is gated to `showSidebar && workspaceTab==="outline"
  && mode!=="md"`.
- **Cards board** (`src/ui/cards/cardsView/index.tsx` + pure helpers in `src/store/cards/cards.ts`): a
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
  default `preview` on narrow / `split` on wide): the rendered side reuses
  `cardRenderMarkdown` (`src/editor/useCardHandlers.ts`) = `sanitizeForIngest(engine.mdToHtml(md))` so a card renders
  IDENTICALLY to the main preview and reflects unsaved edits; links inside it are
  `preventDefault`-ed (reading, not navigation — real nav is Open in editor). No
  `renderMarkdown` prop ⇒ write-only fallback. Editing still hands MARKDOWN to
  `handleCardSave`, but **a card's source comes from the STYLED converter**: the save
  replaces the whole note with what that markdown parses back to, and the Clean
  converter has no carrier for colour, highlight or font, so ONE card edit stripped
  them from the entire note (A020). Alignment has no carrier at all:
  `carryBlockAttrs` (`store/cards/card-save.ts`) restores it on every block the edit left
  unchanged and the user is told when edited ones lost it; a note holding anything
  the round trip cannot carry is snapshotted before it is replaced. The save passes
  the revision the card was read from (`expectedUpdated`), so another tab's newer
  write refuses it (A028) — the refused edit goes to version history, not the bin.
  **The board reloads INCREMENTALLY** (`planCardReload` against the
  `cardSyncSignature` each card was read at — which includes a pin/colour digest,
  since `touchUpdated:false` writes never move `updated`): only new or changed cards
  load and merge in place, skeletons appear on the FIRST load only (the board and its
  scroll survive), cards render 60 at a time as the end nears, and pin/colour apply
  optimistically (A087, A056). **The composer's draft persists** (`pf:card-draft`):
  Escape collapses it and keeps the text; Cancel is the one discard (A057).
  `nodeText` inserts a separator between BLOCK children and across childless break
  nodes (a four-item list once previewed as `milkeggsbreadcoffee`, and a three-line
  note as `line1line2line3`) while leaving adjacent TEXT runs unspaced. Card edits
  NEVER write the canonical directly: `handleCardSave` mirrors the host bridge's
  `updateDocument` — refuse a schema-locked note, parse with the LIVE editor schema,
  `patchDocById`, then, if `isEditorTargeting` still holds after the await,
  `hydrateEditorWithDoc` (skip that re-hydrate and the editor's autosave silently
  reverts the edit). Per-card
  colour/pin live in `DocumentRecord.metadata` under `cardColor`/`cardPinned` via
  `patchDocById(..., { metadata, touchUpdated: false })` — `touchUpdated:false` matters,
  or pinning re-sorts the board as if the note were edited, and it writes the
  metadata ONLY, onto the freshest stored record. Colours are
  explicit light/dark pairs (never translucent tints) so they survive old WebViews;
  dimmed text on a card stays at ≥85% opacity, the lowest that keeps 4.5:1 on every
  card colour in both themes (`cards-text-contrast.test.js`, A095).
- **`src/components/ui/input.tsx` / `textarea.tsx` are wrapped in `forwardRef` ON
  PURPOSE.** The shadcn source targets React 19 (ref as a prop). The app runs 19.3,
  but the library's peer range still admits React 18.3, which STRIPS `ref` from
  function components: there every consumer ref read null — ⌘F typed the query INTO
  the document, and inline rename and prompt autofocus died. `forwardRef` works on
  both. Re-apply it after any regeneration while 18 is in the peer range.
- **Bottom tray** (`src/ui/chrome/bottomTray/index.tsx`): an expandable, tabbed tray above the
  `StatusBar` (collapsed = zero height). Document Links is the first tab
  (`BacklinksPanel` has a `hideHeader` embed mode); a **Console** tab
  (`ConsolePanel`) appears as a second tab only when the admin `consoleEnabled`
  flag is on (spread into the `tabs` array). Toggled by the status-bar links chip
  and the primary **far-left "Panel" chevron** on the status bar; state
  (`trayOpen`/`trayTab`) lives in `useBottomTray` (`src/editor/useBottomTray.tsx`). Replaced the old always-on backlinks strip +
  the floating links popover. **Collapsed, it stays mounted (it animates to 0fr) and
  is therefore `inert`**, set imperatively in a layout effect — `aria-hidden` alone
  left its tabs and chevron in the Tab order; collapsing around focus hands focus
  back to the opener. The tabs are a real `role="tablist"` with arrow keys through
  the shared `useRovingFocus` (also the toolbar's), which re-applies tabindexes via
  a MutationObserver so a control that mounts later cannot become an extra stop
  (A093, A094).
- **`KNOWN_ELEMENTS`/`SCHEMA_OWNED_ATTRS` (ingest.ts) MUST mirror the LIVE schema**,
  exactly like `SERIALIZE_EXTENSIONS`. They drifted: the lists predated `themeImage`,
  `Callout` and `SizedImage`, so the shipped Welcome document — which deliberately
  DEMONSTRATES a `<picture>` theme image, a `> [!NOTE]` callout and a sized logo —
  opened reporting **7 things that "could not be mapped to the current schema"**, every
  one of which round-trips. A residual list that flags our own renderer's output is
  worse than no list. Adding a node/mark to `TiptapPane` means adding its tag here
  (`div`, `picture`, `source` were the missing ones) — `residual-accuracy.test.js` pins
  it. The drift runs both ways: `<mark>` is deliberately NOT known (there is no
  Highlight extension, so its highlight is lost and must be reported), `<section>`
  is (marked-footnote's wrapper), `data-frontmatter` is schema-owned, and an HTML
  comment is recorded as an `html-comment` residual instead of vanishing (A050).
  **Known limit:** on the HTML/paste path `sanitizeForIngest` runs BEFORE
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
- **Import fidelity is READABLE, not just counted** (`src/ui/importExport/residualsDialog/index.tsx`).
  The status bar's residual chip is a BUTTON that opens a grouped, plain-language
  list of what the import could not represent (`ResidualItem` carries type / tag /
  attribute / reason / location — the detail was always recorded, it just had
  nowhere to be read). `RESIDUAL_KINDS` must have an entry for EVERY `type` that
  `ingest.ts` pushes as a residual, or the dialog renders a raw slug — the jargon
  it exists to replace; `residuals-dialog.test.js` scrapes ingest.ts and pins it.
  `DocumentRecord.residuals` is typed `ResidualItem[]` (it was `unknown[]`).
- **Status bar** (`src/ui/chrome/statusBar/index.tsx`): a three-region footer. The **primary
  tray toggle is a full-height, bordered, labeled chevron on the FAR LEFT** ("Panel"
  + `PanelBottom` + up/down chevron) — the obvious expand/collapse the user asked for.
  The interior surfaces contextual detail (active doc title, view mode + read-only,
  fidelity/residual warnings, links count, save state, word/char counts, storage,
  memory). It reports STATE and carries **no view switcher** — the graph toggle used to
  live here AND in the top bar (same `Network` icon, same action, opposite corners);
  do not re-add one. It **degrades responsively** — details shed least-important-first via
  `xs`/`sm`/`md`/`lg` breakpoints so it stays readable on phones. The custom `xs`
  breakpoint (480px) is defined in `styles.css` `@theme` (`--breakpoint-xs: 30rem`).
  Every unsaved state has its own label: "Save failed — retrying" (`error`), "Empty
  editor — not saving" (`blocked`), "Changed in another tab — not saving"
  (`conflict`), "Deleted in another tab — not saving" (`conflict` too, told apart by
  the tab-sync notice), "Storage full — not saving" (`full`) and "Newer version — read-only"
  (the schema lock). **The save indicator is not a live region**: it walks editing →
  saving → saved on every autosave (nine announcements in twelve seconds of typing).
  One visually hidden region speaks only when saving starts failing, fails in a new
  way or recovers (`ui/chrome/statusBar/save-announcer.ts`, A096).
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
  truthfully. JS smooth scrolls (outline and heading jumps, Help sections) take
  their behaviour from `scrollBehavior()` — the CSS guard only defines what "auto"
  means, so they ignored the preference (A096, `a11y-reduced-motion-scroll.test.js`).
- **Accessibility rules the tests pin** (A089–A096, `src/__tests__/a11y-*.test.*`).
  The focus ring is a 2px outline in `--focus-ring` on `:focus-visible`, UNLAYERED
  on purpose (so the generated Button's `outline-none` cannot beat it) and
  hand-scoped to the editor roots, since the library build scopes only
  `@layer base`; the primitives' 30% ring measured 1.75:1 (A090). Accent TEXT uses
  `text-primary-strong` (`--primary-strong`, which the theme blocks derive from each
  palette's DECLARED `--accent-text-light/-dark`), never `text-primary` — the raw
  accent fails as a text colour (A092); `a11y-accent-text.test.js` scans every text
  use and `a11y-contrast.test.js` resolves the real stylesheet for every palette ×
  theme. A `forced-colors` block restates every background-only state in system
  colours (A095). A control's VISIBLE label is part of its accessible name (WCAG
  2.5.3 — the mode buttons read "MD" and were named "Markdown"); explanations go in
  `aria-describedby`. The panes are named "Markdown source" (with an
  `aria-description` of the Esc-then-Tab way out of `indentWithTab`) and "Rich text"
  (`role="textbox"`, `aria-multiline`, in BOTH TipTap attribute objects — the theme
  effect replaces the init object wholesale, A089). The toolbar is `role="toolbar"`,
  ONE tab stop with arrow keys (`useRovingFocus`), and "Skip to editor" is the
  first stop (A094). Image insertion asks for alt text after the URL (`promptImage`:
  empty = decorative, cancel = nothing, A096).
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
  actions (the library's ⋮ triggers in `FolderTree` and `WorkspacePanel`) MUST also
  show on touch — use
  `pointer-coarse:opacity-100` (+ `pointer-coarse:size-8` for the hit target), never
  hover-only, or they become unreachable on phones. Small icon controls that stay
  visible on mobile (status bar, ModeSwitcher) get `pointer-coarse:` size bumps to
  ≥32px. **Split stacks by HEIGHT as well as width** (`splitShouldStack`,
  `ui/panes/editorPanes/split-layout.ts`): only below 768px wide (the ☰ breakpoint) AND with ≥500px of
  height for two panes, or on a touch device held upright — whose ORIENTATION, unlike
  its keyboard-shrunk viewport under `interactive-widget=resizes-content`, does not
  flip while typing. Stacking on width alone gave a landscape phone two 37–69px
  editors (A100). The panel's reopen button is cleared by `pl-11` on the pane header
  (`clearsTrigger`). **Printing prints the document**: chrome is hidden
  (`data-print-hide`), the viewport lock released, the light palette forced and the
  RICH pane printed (`data-print-pane` — both panes are always mounted, so even
  Markdown-only view prints the document); Ctrl+P used to print one page of chrome.
  Every print rule (and the coarse-pointer context-menu sizing, restated in
  styles.css rather than hand-editing the generated primitive) is unlayered and
  therefore scoped under `.pf-app`, or a library host that printed lost its own
  dialogs (A100). The FR panel and any fixed overlay need
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
  (`folderTree/index.tsx`). A `MenuFam` object (`{Item,Sub,SubTrigger,SubContent,Separator}`)
  lets ONE body renderer (`DocMenuBody`/`FolderMenuBody`, + generic `MoveToMenu`/
  `ExportDocSubmenu`) drive BOTH the hover **⋮ dropdown** and a **right-click /
  long-press context menu** (Base UI `components/ui/context-menu.tsx`). **There is
  ONE of each per list, never one per row** (A082): a single `ContextMenu` whose
  trigger IS the tree (recorders note which row the right-click or long-press was
  over), and a single `DropdownMenu` whose ⋮ triggers are DETACHED (a Base UI
  `createHandle` handle + a row payload), mounted only while open. Two menu roots
  per row were most of what froze the editor at a few hundred documents. The
  context menu honors the `contextMenuEnabled` setting (off → no trigger, native
  menu), mirroring `EditorContextMenu`. **Right-click anywhere in the Files list
  creates** (PL-51): a document row's menu starts with New document / New folder
  (in that document's folder), a folder's with New document / New subfolder, and a
  right-click on blank space — a second ContextMenu around the list's scroller in
  `WorkspacePanel`, which the tree's own trigger stops before it — offers New
  document / New folder at the top level (`CreateItems`, `LibraryBackgroundMenuItems`).
  **Library order is a per-browser preference** (`pf:library-sort`, the ⇅ menu in the
  Files header, `LibrarySort` in `store/documents/folders.ts`): `updated` (default —
  the original order: drag order first, folders A–Z, notes newest-edited), `name`
  (A–Z, numbers in order), `created` (newest first; a folder's time is in its id) and
  `manual` (drag order, the rest in the order they were made, so nothing re-sorts).
  `name` and `created` ignore drag order (it is kept), so dragging to reorder in
  them switches to `manual` — `folder-reorder.test.js`. Do NOT duplicate row-menu item definitions
  per primitive — extend the shared body. A folder dropped on a document row lands
  in that document's folder (`docRowDrop`) — the drop used to bubble to the root
  handler and move it to the top level (A066). **Per-document export** (`onExportDoc` →
  `handleExportDoc(docId, "md"|"html"|"docx"|"json")` in `src/editor/useExportActions.ts`) derives every format
  from the STORED canonical via `canonicalToHtml`/`canonicalToMarkdown`
  (`serialize-doc.ts`) + `exportAs*`, so it works on ANY list item without that doc
  being loaded in the editor (it prefers the LIVE canonical when `hydratedDocId`
  matches). Folder rows add **Full backup (.zip)** via `onExportFolder(id, {canonical:true})`.
  **`SERIALIZE_EXTENSIONS` (`serialize-doc.ts`) MUST mirror the live `TiptapPane`
  schema** — it uses `WikiLink` (not stock `Link`, so `[[wiki]]` attrs survive and
  round-trip), `ThemeImage` (a distinct `themeImage` node — its ABSENCE made
  `generateHTML` THROW → export failed outright for any doc with a `<picture>`
  theme image), `SizedImage` (keeps `width`/`height`) and `TableCellAlign` (keeps a
  column's `:-:`/`--:`/`:--`, A044). Any node/mark the live editor gains must be
  added here too, or headless export silently corrupts or throws — and since imports
  now convert against `headlessSchema()` (built from this list) whenever no editor is
  mounted, a missing entry would also lose content ON IMPORT. Plugins with no schema
  (`BidiAuto`, `UnresolvedWikiLinks`, `AltGraphPassthrough`) stay out.
  `serialize-doc.test.js` round-trips the known nodes and `converter-roundtrip.test.js`
  pins `TableCellAlign` in both lists, but NO test compares the two schemas' full
  node/mark sets — keep them in step by hand.
- **Find/Replace (`findReplace/index.tsx`) is a floating draggable panel** (`position:fixed`,
  translucent `bg-card/80 backdrop-blur`), not a docked bar. PE passes the panel mode
  live (`initialMode={frMode}`) so ⌘H switches an already-open panel to Replace.
  Drag is pointer-events on the header handle, clamped to the viewport. **Panel mode is a Find|Replace segmented control** (`panelMode`,
  above the MD/Rich selector) — NOT the old "Replace…" toggle; ⌘F opens find, ⌘H
  opens replace, and the default pane follows the cursor (`initialTarget` from the
  last-focused pane). Find mode shows **Find + Find all** (Find all multi-selects
  every match in CM via `EditorState.allowMultipleSelections`); Replace mode shows
  Replace + Replace All. **NOTE: multi-range selection needs BOTH
  `allowMultipleSelections` AND `drawSelection()` in the `CodeMirrorPane` extensions
  — the native DOM selection renders only ONE range, so without `drawSelection`
  "Find all" / "Select all headings" / scattered "Select ▸ …" scopes appear to select
  just the first match. Do not remove `drawSelection()`.** The **Format matches** row
  (apply bold/case to all matches) is **Replace-mode only** (it mutates).
  **Matching lives in ONE place** (`computeMatches` → `formatting/find-engine.ts`):
  `compileFindQuery` builds the pattern (literal escaping, case, whole word as a
  Unicode lookaround — `\b` is ASCII-only, so "мир" and "東京" never matched — and
  the `m` flag in the markdown pane), and the count, Next/Previous, Find all,
  Replace, Replace All, Format matches, the scrollbar ticks and BOTH panes'
  highlights all read the same `MatchSet`, keyed by query + document revision
  (CodeMirror's `Text` and ProseMirror's `Node` are immutable, so identity IS the
  revision). The pattern used to be rebuilt in five places, and the highlighters
  re-ran it with a hard-coded `"gi"` that ignored Match case / Whole word; they now
  only DRAW the ranges they are handed (`setSearchHighlight(spec)`, both panes).
  **A regex runs in a Web Worker** (`runFind`, `formatting/find-worker.ts`, built
  from `execAllCore`'s own SOURCE TEXT — so those functions must stay
  self-contained, no imports and conservative syntax; `var` there is deliberate),
  TERMINATED after `FIND_WORKER_TIMEOUT_MS` (1.5s): `(a+)+$` on 28 characters froze
  the tab for 5s, and a killed renderer writes no crash stash (A061). Literal searches stay synchronous.
  Where no Worker can start (a host CSP that blocks `blob:` workers, jsdom) a
  main-thread fallback runs with the match cap and a 250ms budget after
  `hasNestedQuantifier` refuses the classic catastrophic shape — a heuristic; the
  Worker is the guarantee, and a Worker that dies MID-job is never re-run on the
  main thread. Matches stop at `MAX_FIND_MATCHES` (10,000; the count reads
  "10000+"). **Replacements are expanded from the ORIGINAL match**
  (`expandReplacement`: `$1`…`$99`, `$&`, `$<name>`, checked against
  `String.prototype.replace`) — re-running the pattern on the isolated match text
  meant `\d+(?=px)` was counted and highlighted but never replaced (A060). A single
  rich-pane Replace inserts TEXT (`tr.insertText`), never parsed HTML, and Format ▸
  Highlight MERGES into each run's `textStyle` rather than replacing it (A067).
  **Match ticks are drawn over the active pane's scrollbar** (`MatchScrollbar`) — it
  **portals to `document.body`** (with `data-pf-portal`) because the panel's
  `backdrop-blur` makes it a containing block for `position:fixed`, which otherwise
  pushed the overlay off-screen. The **MD scope/format filter** (`mdScope`,
  persisted `pf:fr-scope`) is a collapsible Funnel of per-region chips that cycle
  **off → only → exclude**, grouped Structure (headings/code/links) + Formatting
  (bold/italic/strike/highlight), applied by `applyMdScope` to the match set;
  headings=only doubles as the old "headings only" (format-all-headings affordance).
  **Replace All is ALWAYS ranged changes over exactly the (scoped) matches shown in
  the count** — never an unscoped whole-document rewrite, which once silently
  rewrote the regions a filter excluded. ⌘F/⌘H also switch the panel mode from
  inside the panel (the global shortcut listener is editor-container-scoped).
  **Keyboard shortcuts can be disabled** (`uiStore.keyboardShortcutsEnabled`,
  `pf:keyboard-shortcuts`, Settings ▸ Editor) — `useKeyboardShortcuts` early-returns.
  Search options (regex, **case-sensitive**, **whole-word**) persist in localStorage
  (`pf:fr-*`). **Panel position**: `pos` state is set in a `useLayoutEffect` on mount
  (before paint) — it restores the last dragged position (`pf:fr-pos`, written in
  `endDrag`) or **centers on the viewport**, always clamped on-screen.
- **Placeholder ad slots are a DEVELOPMENT-build surface** (`src/ui/shared/adUnit/index.tsx`).
  `adsAvailable()` (`utils/build-gates.ts`, `import.meta.env.DEV`) is checked where
  the slots RENDER, not only at the toggles, so a `pf:show-ads=true` stored by an
  older version or a crafted `?ads=1` link cannot paint "Your Ad Here" over the
  shipped product (A078). In dev they are gated by `useUIStore.showAds`
  (`pf:show-ads`, default off) AND full chrome — never in the embed; the View-menu
  item, the Settings switch and the link builder's `ads` parameter exist only in dev,
  and App.tsx honours `?ads=` only in dev (`sessionAdsFromParam`; it strips the
  parameter either way). Slots are placeholder-only (no external network —
  offline/CSP-safe); a real network would replace the markup inside each variant,
  keeping BOTH gates.
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
  Version history's Restore / As new / Delete are disabled, and
  `restoreSnapshotInPlace` REFUSES (checked again after the version loads) — it
  hydrates, dirties and saves without ever passing the dispatcher (A036).
  **Read-only must survive a document switch**: `resetHistory()`/`restoreEditorState()`
  rebuild CodeMirror with `view.setState`, whose extensions carry the compartment
  values captured at MOUNT, so every switch reverted the markdown pane to the
  mount-time flag — editable in a read-only session, with the edits autosaved.
  `reapplyLiveConfig` re-applies editability and spellcheck from the live refs after
  every `setState`, and the update listener reports nothing while read-only (A019).
  `?readonly=` (and, in dev, `?ads=`) are applied session-only via
  `useUIStore.setState` (NOT the persisting setters) so a shared link doesn't
  overwrite the visitor's saved settings.
- **`view_mode=md|html|split`** URL param maps to `setMode` (App.tsx reader; embed.tsx
  aliases it to `mode`). The standalone app's URL-param reader (App.tsx) also applies
  `readonly` (and `ads`, in dev only) then strips them via `history.replaceState`.
- **Password-protected ZIPs**: `isZipEncrypted(buf)` in `store/importExport/archive.ts` reads the
  central-directory (fallback: local-header) general-purpose bit 0 with NO dependency;
  `extractArchive` throws `ArchiveEncryptedError` when encrypted+no password, and
  decrypts via a **lazy** `@zip.js/zip.js` import when a `password` option is given
  (wrong password → `ArchiveWrongPasswordError`). File import (`collectImportItems`,
  `src/editor/useImportPipeline.ts`) and URL import
  (`fetchImportResource` + `UrlImportDialog`) prompt for a masked password (the shared
  `useDialog().prompt` gained a `type: "password"`) and retry.
- **Archive path safety**: `normalizeArchivePath(path)` in `store/importExport/archive.ts` strips
  absolute roots, Windows drives (`C:`, incl. drive-relative `C:foo`), `..`/`.`/empty
  segments, AND prototype-pollution keys (`__proto__`/`constructor`/`prototype`);
  `extractArchive` runs every entry through it before the path is trusted anywhere
  (folder tree, storage keys). Never feed a raw archive `e.path`/`folderPath` into a
  storage-key/IDB-path op.
- **Full-backup export/restore**: `handleAction("export-backup-zip")` → `exportDocsToZip(ids,
  "perssonify-backup", { canonical: true })` writes each doc as the full
  `perssonify-document` JSON envelope (canonical + title/id/tags/metadata/timestamps).
  Re-import restores the exact library state, which requires TWO cooperating paths:
  (1) the `pmjson` ingest branch (`store/importExport/ingest.ts`) forwards
  `tags/metadata/created/updated/origin/residuals` + pins `userTitle` from the envelope
  (NOT just id/canonical/title — omitting them silently drops the state and resets
  timestamps); (2) `archiveEntriesToItems` detects an all-envelope archive
  (`isBackup`) and keeps entry paths VERBATIM — it must NOT apply the loose-file
  `<zip-name>/` wrap, or the whole library nests under a synthetic folder. The
  backup also carries every referenced image as `assets/<sha256>.<ext>`: those
  entries are recognised by path AND image extension, `isBackup` looks at documents
  only, and they come back separately as `extractArchive(...).assets` (the returned
  entries array carries an `assets` property).
  **Every export ZIP filename carries an `exportTimestamp()` `YYYYMMDD-HHMMSSmmm` suffix**
  (`store/importExport/import-export.ts`) for implicit version control. JSON and backup exports
  share **`toExportEnvelope`**, which stamps `schemaVersion` and LEAVES OUT
  `origin.raw` (the whole input as first imported) and the clipboard alternates —
  text the user may have deleted since, which nothing reads on import (A079). Large
  exports read through `readDocuments` (IndexedDB `getMany`: one transaction) and
  compress file by file with yields (`zip-builder.ts`); an unreadable document is
  REPORTED, never silently missing from a backup (A088). A non-empty full backup
  records `pf:last-full-backup` for the backup reminder (`recordFullBackup`).
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
    `/api/import?url=…` render attacker HTML on our origin (full XSS). It connects
    only to a GLOBAL-UNICAST address (`isGlobalUnicast` — an allowlist; the old
    blocklist let `::127.0.0.1`, NAT64, 6to4, Teredo and documentation space
    through) on port 80/443, caps the body at `MAX_BYTES` (4,000,000 — Vercel cannot
    return much more) with a 413 whose message the client shows, pins CORS to
    markdownstudio.com and its www host, and writes ONE JSON log line per request
    carrying the HOST only — never the path or query, where share tokens live (A010,
    A013, A074). `Sec-Fetch-Site` must be `same-origin`/`none`: that stops OTHER web
    pages from using the relay, NOT curl, which sends whatever headers it likes — to
    non-browser clients it is a bounded proxy, and the rate limit and spend alerts
    are owner setup in Vercel (`docs/import-relay.md`). **Its `fetch` comes from
    undici, next to its `Agent` — never Node's global**: a dispatcher works only
    with the fetch of its own major, and undici 8's Agent with Node 24's built-in
    fetch failed EVERY request (`invalid onRequestStart method`) while the stubbed
    unit tests stayed green. `import-relay-dispatcher.test.js` sends a real request
    over a socket; `allowH2: false` (undici 8 defaults HTTP/2 on).
  - **The relay is opt-in** (A076). `fetchImportResource` never relays without a
    stored `"allow"` (`pf:import-relay`) or a `confirmRelay` callback that answers
    yes; the answer is remembered and can be changed in Settings ▸ Privacy. It used
    to engage silently on any CORS failure while the copy said nothing left the
    browser — and privacy copy must stay TRUE: `g4-privacy.test.jsx` rejects
    absolute "never leaves your device" claims in the app's own surfaces.
  - **Block remote images** is a CSP `img-src` meta installed by the APP SHELL only
    (`installRemoteImagePolicy` in `App.tsx`, `utils/remote-images.ts`); it applies
    from the next load, and the library must never install it (it would restrict
    the host page). index.html and embed.html send no Referer.
  - `?import_url=` **pre-fills** the importer URL but NEVER auto-fetches — a shared link
    must not force the visitor's browser to hit an attacker URL on load.
  - Host-supplied CSS colors (`bg`/`accentColor` in `embed.tsx` +
    `PerssonifyEditorIntegration.tsx`) go through `sanitizeCssColor` (`theme/palette.ts`)
    — rejects `url(`/`expression(`/`var(`/`;{}` so a value can't become a tracking beacon.
  - `htmlToCanonical` (`store/documents/canonical-ops.ts`) parses via an inert `DOMParser`, never
    `el.innerHTML` on a live element (avoids resource loads / mutation-XSS).
  - **Anything written into a `style` attribute goes through `engine/css-safety.ts`**
    — an allowlist; a CSS escape (`posit\ion`) walked past the old filter. Renderers
    concatenate canonical attrs into `style="…"`, so `sanitizeCanonicalNode`
    (`store/documents/canonical-sanitize.ts`) validates colour, highlight, font family,
    alignment, cell align, column widths and theme-image sources wherever canonical
    JSON enters (import, storage load) — a crafted JSON document injected CSS (A070,
    A073). Ingest strips `class`/`id`/`name` except `language-*`, `sr-only`,
    `wiki-link` and `perssonify-link`, and without a DOM parser `sanitizeForIngest`
    fails CLOSED (everything becomes text).
  - **Mermaid's CSS carriers are locked** (`MERMAID_SECURE_KEYS`, `diagramPreview/index.tsx`):
    `themeCSS`, font families, theme variables and `dompurifyConfig` may be set by
    `initialize()` only, never by a diagram's `%%{init}%%` or front matter. Mermaid
    pastes them into a `<style>` and checks only brace balance, so any opened
    document could restyle the page (A069).
  - **Mermaid 12 defaults to ELK; `mermaidConfig` pins `layout: "dagre"`** so existing
    diagrams keep their layout — a diagram may still opt into ELK
    (`ops-mermaid-secure` pins both). ELK (elkjs, **EPL-2.0**, 436 KiB gzip) is lazy
    and precached; the csp/pwa renderer probe draws an ELK diagram, found by its own
    label. Mermaid 12's notes say Safari 17.4+ against our 16.4 floor: a scan of the
    built chunks found no post-16.4 API, which is evidence, not a device run.
  - **CSP ships REPORT-ONLY and hash-pinned; anti-framing is ENFORCED**
    (`vercel.json`: `frame-ancestors 'none'` + `X-Frame-Options: DENY` everywhere but
    `/embed.html`, A068) — framing the app root is broken by design. **Editing an
    inline `<script>` in index.html or embed.html changes its sha256**: update the
    hash in vercel.json — `ops-vercel-headers.test.js` recomputes every hash
    (LF-normalised) and names the new one. Moving CSP to enforcing is an owner
    decision; `e2e:csp` runs the build under the ENFORCED policy and must stay at
    zero violations.
  - **Google Analytics runs in the PRODUCTION DEPLOY ONLY** (`utils/analytics.ts`,
    G-WFN9X3MKR0). `__PF_ANALYTICS__` (vite.app.config.ts) is true only when
    `VERCEL_ENV=production`, so previews, local and e2e builds and `vite dev`
    carry none of it — the e2e suites fail on any console error, and a gtag.js
    that cannot load prints one. main.tsx installs it AFTER `__PF_BOOTED`: ad
    blockers block gtag.js, and before boot the watchdog would take that for a
    broken deploy and wipe the offline caches. Google is told the ROUTE
    (`trackPageView(routeToPath(route))` in App.tsx, with `send_page_view: false`
    in the config), never `location.href`: `#share=` IS the shared documents,
    `#live=` a live share's permission, `?import_url=` the user's own address.
    The embed and the library never import it — Settings ▸ Privacy and the
    consent bar read `utils/analytics-consent.ts`, which holds no Google code,
    and the switch shows only once analytics.ts has registered. The CSP allows
    `https://www.googletagmanager.com` on the app's pages, not `/embed.html`.
    **Consent, for EVERY visitor in every country:** Consent Mode's one default
    denies all storage, and the bar (`app/analyticsConsent`) asks — under the
    editor's header and under every PageChrome header (About, Help, Login,
    Profile; PageChrome makes the editor's copy inert). A first visit's tour
    waits for the answer (`consentPending` in App.tsx): its overlay would cover
    the bar. No region list or time-zone guess: nobody is treated differently
    by location. "denied" sets
    `ga-disable-<id>`, clears `_ga*` cookies and loads nothing next time;
    "granted" allows `analytics_storage` only, never ad storage. Keep Decline as
    prominent as Allow. Keep `installAnalytics` out of any call cycle and the
    ids as plain strings: either kept Google's code in non-production builds.
    The About and Help privacy copy says so. Pinned by `ops-analytics.test.jsx`.
    The GA stream's "page changes based on browser history events" must stay OFF
    (owner setting, docs/decisions.md 2026-10-22): it reports `location.href`.
- **Images are binary assets** (A086, `store/assets/asset-store.ts`, `asset-refs.ts`,
  `assets.ts`, `asset-gc.ts`; `extensions/AssetImages.ts` and `cm-asset-refs.ts`).
  Pasted, dropped and imported images live ONCE in a sidecar IndexedDB,
  `perssonify-assets` (`perssonify-assets:<ns>` under a host namespace; stores
  `meta` and `bytes`, keyed by SHA-256), and a document refers to one as
  `pf-asset:<sha256>` (an optional `#fragment` is kept). On in the app shell
  (`App.tsx`); OPT-IN for library hosts and the embed (`storageConfig.assets`),
  because a host reading content back out would get references that resolve only
  in this browser. **A reference is written only after the bytes commit, and there
  is no memory fallback**: an unavailable or disabled store, or a failed write,
  leaves the image inline as a `data:` URL exactly as before (`data:` URLs under
  2,048 characters always stay inline). Only USER transactions are converted —
  loads and syncs (`preventUpdate`) never, conversions are not undo steps, and a
  conversion never lands in a different document, a read-only one or mid-composition.
  Existing documents are not migrated.
  - **A `pf-asset:` src must never reach a live `<img>`**: the browser cannot load
    it, and under the CSP it is a violation even on a detached element. **TipTap's
    `getHTML()`/`generateHTML()` are NOT safe**: they build every node with the
    PAGE's document and only then move the result into an inert one, so each `<img>`
    starts loading — WebKit logged a failed load for the reference on every HTML
    export, and a remote image was fetched on every export and host callback. HTML
    of document content goes through `engine/inert-html.ts` (`fragmentToHtml`,
    byte-identical): the rich pane's `getHTML` handle, `canonicalToHtml` and the
    per-block converter all do (`inert-html.test.jsx`). Never call
    `editor.getHTML()`/`generateHTML()` directly for content. Every surface
    that SHOWS document HTML resolves through the node view, `useAssetSrc`, or
    `neutralizeAssetSrcs` + `useResolvedAssetImages` (`ui/shared/utils/asset-dom.ts`). `e2e:csp`
    pins it.
  - **Exports are self-contained.** HTML, markdown, PDF/print, Word and Copy as
    MD/HTML inline the bytes (`inlineAssetRefsInText`); the JSON export's envelope
    carries an `assets` member `{hash: {mime, data}}`; the full backup and the crash
    screen's emergency backup write `assets/<hash>.<ext>`; the markdown ZIP links
    images by relative path. Images that cannot be found are reported
    (`missingImagesNote`), never silently dropped. Restores check each asset
    against its hash.
  - **Nothing deletes assets automatically.** Settings ▸ Storage ▸ Clean up unused
    images checks every place a reference can live (`defaultReferenceSources`:
    documents, every snapshot including deleted documents', the live editor, unsaved
    drafts, localStorage), deletes NOTHING if any of them cannot be read, keeps
    anything stored or shown in the last 24 hours and re-checks each image just
    before deleting it. **Any new place that can hold a document's content must be
    added to `defaultReferenceSources`**, or the clean-up deletes images it still
    uses. Erase all local data clears the store too.
- **An ordinary code block is a PLAIN DOM node view** (`ui/panes/codeBlockWithCopy/code-block-plain-view.ts`,
  A083); only diagram and score blocks are React. TipTap mounts each React node view
  with a synchronous render that re-renders the ONE portal list holding every node
  view, so opening a document was quadratic in its code blocks. The plain view keeps
  the React one's markup (`code-block-*` classes, `pre > code`), stops the Copy
  button's events and ignores its mutations (they are not content), and follows the
  interface language. A plain block that must BECOME a diagram gets a new view: a
  language change is declined in `update`; a diagrams/music feature toggle
  dispatches a `codeBlockRebuildKey` node decoration — re-setting identical
  attributes does NOT work, because ProseMirror matches an identical node
  structurally and never calls `update` (`code-block-plain-view.test.jsx`). Math
  nodes and theme images are still React node views: a formula-heavy document may
  open slowly for the same reason.
- **Mermaid/ABC blocks render by default in ONE cohesive framed card** (`codeBlockWithCopy/index.tsx`
  `.diagram-frame`: header label + Edit/Copy · source · live preview), mirroring the math
  nodes. The `<pre><NodeViewContent/></pre>` stays MOUNTED (hidden via `.diagram-source.is-hidden`)
  — never unmount it, ProseMirror owns that content and the fenced-code round-trip depends on it.
  The preview reads the live node text, so it re-renders as you type. **Lazy renderers
  load through `cachedImport`** (`utils/lazy-import.ts` — Mermaid, abcjs and the KaTeX
  in `MathNodes`): it memoises a pending or fulfilled import but FORGETS a rejection.
  A cached rejected promise left every diagram or formula unrendered until a reload
  (A085); a failed load now says the renderer could not be loaded instead of
  printing the fetch error as a diagram error. (Chromium also remembers a failed
  module fetch, so there the real recovery is the precache plus a reload.)
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
  `archiveEntriesToItems(entries, zipBaseName)` in `store/importExport/archive.ts` (used by both the
  file-upload and URL-import sites in `src/editor/useImportPipeline.ts`). A single top-level folder is kept as-is; a
  lone file imports at root.
- **DOCX import** (`store/importExport/docx-import.ts` `convertDocxToHtml`): a `.docx` upload can't take
  the text path (`getFileContentAndFormat` reads text → binary garbage), so the import loop
  (`collectImportItems`) branches on `.docx` BEFORE that call and routes through **lazy** `mammoth` (`await import`,
  own chunk — never in the main bundle) → HTML → the existing `format:"html"` ingest branch
  (`sanitizeForIngest` keeps inlined `data:` raster images, strips scripts; `analyzeHtml`
  reports residuals). Best-effort/lossy: headings/bold/italic/lists/tables/raster images
  convert; Word equations (OMML), text boxes, and complex layout do not. `convertToHtml` is
  called with **BOTH** `{ arrayBuffer, buffer: arrayBuffer }` — mammoth's browser build reads
  `arrayBuffer`, its node build (tests) reads `buffer` — so one call works in both without a
  throw-and-retry. mammoth emits images as base64 `data:` URLs; the import then
  stores each one as an asset where the asset store is on (see the image-asset bullet),
  so the document holds references, not the bytes. The 5 MB skip is on the `.docx`
  file's own size.
- The standalone app shell (`src/App.tsx`) is a `h-dvh` viewport-locked column;
  PerssonifyEditor receives `fitParent` there and sizes to its parent. Embed/
  library mounts omit it and keep viewport (`h-dvh`) sizing. Never let the shell
  grow past the viewport — window scroll drifts the chrome off-screen — EXCEPT below
  450px of height (400% zoom, a landscape phone): there `.pf-shell` lets the PAGE
  scroll, the chrome keeps its height, the editor row (`pf-editor-row`) gets exactly
  one viewport and the tray and status bar follow it. Locked, 1366×768 at 400% zoom
  left the editor zero pixels tall with the status bar and Settings clipped out of
  reach (WCAG 1.4.10, A091). Scoped to `.pf-shell`, so embed and library mounts keep
  the height their host gives them.
- Interior pages/graph are wired through PE via optional props (`onAbout`,
  `onHelp`, `onStartTour`, `graphOpen`/`onGraphOpenChange`); omitted by the
  library/iframe embed, which keep the built-in dialogs + internal graph toggle.
- **Accounts are the STANDALONE APP's alone** (Google sign-in through the backend,
  `apps/api` + Better Auth), and only in builds that have the backend:
  `accountsEnabled()` is true for the dev server and for `VITE_ACCOUNTS=on` (the AWS
  deploy sets it, `infra/scripts/deploy.ts`; Vercel's `web` service builds with
  `build:app:accounts`); every other build — the library, the embed, the e2e builds,
  the unit tests — makes NO account call and shows no account UI. It reads
  the exact expression `import.meta.env`: Vite and Vitest rewrite only that text, and a
  cast-wrapped form read a stale copy (tests could not switch it on).
  **Signing in is OPTIONAL (guest first)**: every visitor gets the editor, with the
  notes in this browser; signing in adds sync and the daily backup. There is no
  sign-in gate: only a checking screen while the session is unknown
  (`SESSION_CHECK_TIMEOUT_MS`) and, signed in, while `prepareCloudLibrary` readies
  the library, so a signed-in visitor on a new device opens on their notes, not on
  freshly seeded first-visit notes. Share links open straight into the editor.
  **Making** a share link needs an account: App passes PE's `shareDisabledReason`
  ("Sign in to share…") while signed out, and every share control (the menu bar's
  Share button beside the document title, "Copy share link" on notes and folders)
  reads it through `editor/share-gate.tsx`: greyed out with a ? icon, the reason in
  the app's tooltip (`ShareHint`, shadcn / Base UI) on hover and focus and in
  `aria-description`, and choosing one (a tap on a phone) shows the reason as a toast
  instead of copying. `aria-disabled`, not `disabled`: a disabled element gets no
  hover and no tooltip. The library and the embed never
  set it, so sharing there is unchanged.
  `/login` shows the full sign-in screen (`SignInScreen`) over the editor, with
  "Continue without signing in". `SignInNudge` (a bar under the header) invites a
  signed-out visitor to sign in a minute after they have a note of their own, and
  "Not now" hides it for a week (`pf:sign-in-nudge-dismissed-at`). **The first
  sign-in in a browser used signed out** removes the still-untouched first-visit
  notes there when the account already has notes (`app/cloud/starters.ts`,
  `cloud-starters.test.js`), so each device does not add another Welcome, Getting
  started and Changelog to the account; they were never in the account, and
  anything the visitor wrote or edited stays and syncs. **Sign out keeps the notes
  in this browser**; "Sign out and remove notes from this browser" (account menu,
  for a shared computer) is offered only once every change is synced, asks first,
  and erases the library with `clearLocalData({ preferences: true })` (which also
  drops the `pf:cloud-*` sync state) before starting over at `/`.
  `src/app/account/account.ts` is the session state (`useAccount`), calling same-origin
  `/api/auth/*` — CloudFront routes `/api/*` to the API on AWS, and
  `vite.app.config.ts` proxies `/api` to `:4000` in dev and preview, so local sign-in
  also runs on ONE origin (`PUBLIC_URL` is the editor's address; a cookie set on
  another port is not reliably sent back). Signed in: `src/app/account/accountMenu/index.tsx` at the
  right end of the top header (Profile, Sign out, Sign out and remove notes), handed in
  through EditorHeader's `accountControl` prop (App.tsx only; the library and the embed
  never pass it, pinned by `account.test.jsx`); `/login` and `/profile` are routed
  interior pages (`ui/pages/loginPage/index.tsx`, `profilePage/index.tsx`). Signing
  out leaves the editor open on the same notes. Signing in
  is a full navigation to Google, covered by the unload safety net, and does not touch
  documents. Google returns to `/` on success and `/login?error=<code>` on failure
  (`signInTargets`), both trusted origins of the API (`CORS_ORIGINS`).
- **Cloud sync** (`src/app/cloud/`, signed-in only): documents, their images and the
  folder tree, to the account (API `/api/sync`, content in S3). **Polling is cheap and
  follows use** (`index.ts`): every 5 s for a minute after anything moved, every 15 s
  while the page is on screen, every 5 min behind other windows, and at once when the
  page is shown again, focused or back online. Each cycle sends the `version` of the
  state it last read (`state(since)`, engine `serverState`); while it still matches,
  the API answers `{ unchanged }` (`stateVersion`, a digest of every revision, the
  tree and the live shares) and the engine plans from its cached copy. A cycle that
  finds the lock busy RETRIES shortly (it used to claim "synced" and drop the change
  that woke it), and the day's backup runs under its own lock, never inside a sync
  cycle. **Nothing a cycle writes over is newer than what it planned from**: a pull or
  a remote deletion first re-checks the local revision (`stillPlanned`) — a save that
  landed mid-cycle, in any tab, is never overwritten (`again` re-plans) — and the
  pending-deletion list is MERGED back (`settlePending`), never replaced by the copy
  the cycle loaded. The editor also SAVES on blur / page hide (`useAutosave`), so the
  same note open in two tabs rarely meets "Changed in another tab". **The engine works
  like ANOTHER TAB**: its own `IndexedDBStorageAdapter` on the app's database, and
  what it changes is announced on the tab-sync channel (a second BroadcastChannel,
  `from: "cloud-sync:…"`), so the editor's tested multi-tab paths do the rest — a
  clean open note reloads, a dirty one gets "Keep mine / Use theirs". It learns of
  local changes by LISTENING on that channel. Rules (`plan.ts`, pure, mutation-
  tested): one side changed → it travels; both → the NEWER wins and the other goes
  to Version history (`"cloud-sync"` snapshot reason, both devices); **a document
  is deleted in the account ONLY from the editor's own delete event** (pending
  deletes) — a document merely missing here is downloaded again, so a wiped browser
  can never erase the account; an edit after a deletion restores the note. Every
  local copy replaced or deleted is snapshotted first. The folder tree is a
  THREE-WAY merge per entry against the last agreed tree, judged by CONTENT (a
  server-issued revision guards the write; timestamps collided). Images go
  straight to S3 with presigned URLs and S3 verifies each SHA-256. One web lock per
  account runs one cycle at a time across tabs. One account owns a browser's
  library (`pf:cloud-owner`); another account signing in there does not sync. An
  EMPTY library (new device, wiped browser) is filled from the account BEFORE the
  editor mounts (`prepareCloudLibrary`), so no starter notes are seeded over it.
  "Erase all local data" (`cleared`) resets this device's sync state and pauses
  sync for the page. **Beside sync** (both only in the account that owns the library):
  a full backup a DAY (`backup.ts`: the File ▸ Export ▸ Full backup ZIP, built by
  `buildBackupZip` — the crash screen's builder — and PUT straight to S3 through a
  presigned link whose SHA-256 S3 checks; first device that day stores it, a minute
  after sign-in, inside the sync lock; `pf:cloud-backup:<user>` is the day done;
  Profile ▸ Backups lists, downloads and "Back up now"), and Version history ▸ **In
  your account** (`versions.ts` → `store/history/account-versions.ts`, a registry the editor
  reads so the library and embed never import app code): the bucket's past versions
  of the open note, THINNED by the API (`thinVersions`) so they span the 30 days;
  bringing one back records an `"account-version"` snapshot and restores THAT, so it
  is undone like any restore. **Live shares** (`src/app/publish/`, PL-51) ride on it:
  the Share dialog (`ui/share/shareDialog`) publishes a READ-ONLY copy of one note
  (`buildLiveDocument`: the export envelope with its images, without the owner's id or
  metadata) to `PUT /api/sync/published/:docId`, and `/#live=<id>` opens it for
  anyone — `GET /api/published/:id` needs no sign-in; the id is 128 random bits. The
  sync engine REPUBLISHES a published note whose local revision moved
  (`syncPublished`; the state lists `published`) and unpublishes one it deletes. A
  follower's copy is an ordinary note with `metadata.liveShare` (`live-share-meta.ts`):
  it opens read-only (`useSharedDocLock` — the session flag, on transitions only), the
  library marks it (`SharedDocBadge`, a dot while an update is unseen), and
  `startFollowing` checks for new versions (`?since=`), keeps the replaced copy as a
  `"live-update"` snapshot and writes the OWNER's revision, so every device following
  it agrees; a 404 ends it (the note becomes the user's own). Read-only share links
  (`#share=` with `readOnly`, `metadata.readOnlyShare`) share the lock and the notice
  (`SharedDocNotice`); `view` sets the layout a share opens in. A live copy carries its
  images inside, so it is refused above 4 MB (a Vercel Function's request limit).
  Tests: `live-share`, `share-dialog`, `cloud-sync` (republish) and the API's
  `sync.test.ts`. The avatar is the initials on `--primary`, never the
  Google picture. Tests: `cloud-plan`, `cloud-folder-merge`, `cloud-sync` (two
  devices, in-memory account), `cloud-backup`, `cloud-versions` and `cloud-contract`
  (this code against the REAL API, Postgres and S3 — skipped without
  `TEST_DATABASE_URL` / `TEST_S3_ENDPOINT`; `bun run db:up` starts both).
- `src/PerssonifyEditor.tsx` — the orchestrator: reads the stores, owns the refs and
  engines, calls the hooks below, and renders. **Where PerssonifyEditor's parts live**
  (`src/editor/`, A110 — each hook takes its dependencies explicitly; `types.ts`
  names them by the hook or store that produces them):
  - `props.ts` — `PerssonifyEditorProps`.
  - `useWorkspaceViews.ts` — the editor/map/cards selection, the switcher and shortcut
    handlers, `handleSetMode`; `useOverlayInert` (the overlay's focus/inert effect).
  - `useEditorBoot.ts` — `usePersistPreferences` (preferences written back after boot)
    and `useEditorBoot` (first-render storage injection; the init effect: preferences,
    library, hydration or first-run seeding, the wiped-library check; metrics feed).
  - `useChangeNotifications.ts` — `useCanonicalChangeHandler` (the sync engine's
    STABLE `onCanonicalChange`) and `useContentChangeEmitter` (debounced `onContentChange`).
  - `useHeadingNavigation.ts` — `scrollToHeading`, `scrollToHeadingByAnchor`; `useOutline`.
  - `usePaneCommands.ts` — the context-menu API, clipboard, heading-anchor insertion,
    insert prompts, and the pane focus handlers with `lastFocusedPaneRef`.
  - `useBottomTray.tsx` — tray state and the height-guarded toggles; `useConsoleContext`;
    `useTrayTabs`.
  - `useImportPipeline.ts` — `importItems`, `handleImportUrl`, `activateAndCapture`,
    `isEditorTargeting`, `waitForEditor`; `collectImportItems` (file expansion).
  - `useAutosave.ts` — ⌘S, the idle autosave and its re-arm, the surface-open flush,
    the unload safety net (`beforeunload`/`pagehide` + the synchronous stash).
  - `useEditorActions.ts` — `handleAction` (the menu dispatcher), file drop, "Back up now".
  - `useExportActions.ts` — per-document / folder / selection ZIP exports, and the
    File-menu export helpers `handleAction` calls (incl. the recorded full backup).
  - `useLibraryQueries.ts` — search, the Files body filter, the map rail's headings.
  - `useCardHandlers.ts` — the Cards board's load / save / create / metadata handlers.
  - `useHeadingRenameLinks.ts` — the offer to retarget links to a renamed heading.
  - `useHostApi.ts` — the imperative handle the integration wrapper and the iframe
    bridge drive (`useImperativeHandle`, `addDocuments`, `updateDocument`, …). Its
    dependency list names EVERYTHING its methods close over — nothing holds the
    handle's identity, and an omitted callback went stale
    (`behave-host-api-stale.test.jsx`).
  Still in PE itself: the store selectors and refs, `registerLiveCanonical`, the
  `releaseEditor` layout cleanup, the markdown-feature re-sync, the format dispatcher,
  the keyboard-shortcut wiring and the whole render. **Hook call order is effect
  order**: each hook is called where its block stood, so effects run exactly as they
  did in one file — keep it that way when adding to them. Source-pin tests read the
  module that holds their subject, and pin the editor's wiring separately.
- `src/engine/` — markdown conversion + sync. `useSyncEngine.ts` (hash-gated bidi
  sync), `useMarkdownEngine.ts` (a thin hook over the PURE `createMarkdownEngine`,
  which `src/__tests__/converter-harness.js` drives with the real schema), `build-marked.ts`
  (per-instance marked config), `wiki-link-marked.ts`, `preprocessor.ts`,
  `turndown-rules.ts`, `html-cleaner.ts`, `math-marked.ts`, `css-safety.ts`.
- `src/store/` — Zustand stores (`documentStore.ts`, `uiStore.ts`, `editorStore.ts`),
  document model (`document.ts`), persistence adapters (`storage-adapter.ts`,
  `idb-storage-adapter.ts`), ingest/sanitize (`ingest.ts`, `canonical-sanitize.ts`),
  `settings.ts`, `schema-version.ts`, `storage-durability.ts`, `crash-recovery.ts`,
  `snapshot-store.ts`, `canonical-json.ts` (`canonicalOf` — getJSON() from each block's
  cached JSON — and `canonicalJsonText`, its text from each block's cached text).
- `src/ui/` — view components (panes, toolbar, sidebar, settings, dialogs, graph).
- `src/utils/` — `build-gates.ts` (dev-only surfaces), `diagnostics.ts` (the local
  error ring), `app-health.ts` (when a reload is safe), `remote-images.ts`,
  `safe-storage.ts`, `alt-graph.ts`, `lazy-import.ts`, `idle.ts` (`runWhenIdle`:
  idle-time slices, a timer where Safari has no `requestIdleCallback`). `src/pwa/sw-updates.ts` —
  service-worker update prompts.
- `src/extensions/` — custom TipTap nodes and plugins (BackgroundColor,
  MathInline/MathBlock, Callout, Details, ThemeImage, SizedImage, WikiLink,
  TableCellAlign; the schema-less plugins BidiAuto (and `TaskItemAutoDir`),
  UnresolvedWikiLinks, AltGraphPassthrough, ListKeymapNoTab, ReactSelectionShield;
  CodeMirror's `cm-bidi.ts`). BlockId,
  FieldBlock and TransclusionBlock are exported by the library but registered in
  NEITHER schema — deprecated, and they warn once when used (A105).
- `src/theme/palette.ts` — accent-palette selection (orthogonal to light/dark).
- Docs: `docs/` — start at `docs/README.md`. `docs/import-relay.md` covers the ONLY
  server code (`api/import.js`); `docs/gotchas.md` is the landmine list;
  `docs/audit-2026-09.md` is the register of the 2026-09 production-readiness audit
  (A001–A114) and the authoritative list of what remains; `docs/backlog.md` carries
  the older audits (the old `docs/audit/` was folded into it during the Markdown
  Studio migration and no longer exists); `docs/deployment.md` separates what the
  repo does from what an owner must switch on.

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
  side never reads the rope back just to hash it. The per-block projection
  combines each block's hash into EXACTLY `quickHash(getHTML())` (31^n weights,
  `pow31` in incremental-md.ts), so the echo gate is unchanged — changing
  `quickHash` means changing `pow31`. `onCanonicalChange` reuses each unchanged
  block's JSON.
- **Derived values are published only when they CHANGE.** `updateDerived`
  computes the fidelity report and the word/char counts in ONE walk of the
  canonical (`computeCanonicalStats`) and keeps the previous object when the
  value is unchanged — the same `sameMetrics` pattern `refreshMetrics` uses.
  Two fresh objects per projection defeated every `useShallow` selector
  downstream and re-rendered the shell on each sync. Same reason
  `editorStore.setActiveFormats` shallow-compares: `queryState()` allocates a
  new object on every keyup. The word count (`countTextRun`) segments a
  whitespace-free run of Han, kana, Thai, Lao, Khmer or Myanmar with
  `Intl.Segmenter` (a bounded cache), so a Japanese paragraph is no longer one word;
  spaced languages count exactly as before (A098). **Every node boundary other than
  adjacent text ends a word** (`endWordRun`, document.ts): text nodes that differ
  only in marks continue one (`un**believ**able` is one word), but a paragraph,
  heading, list item, cell or hard break does not — the counter used to run the last
  word of each block into the first of the next, so a four-item list was ONE word.
  Because of that, `computeCanonicalStats` caches PER TOP-LEVEL BLOCK, keyed on the
  block's JSON object (which `canonicalOf` keeps for every block an edit did not
  touch): a keystroke walks one block, not the document (A083). The canonical is
  read, never mutated in place — a cached block edited in place would not be
  re-counted (`fidelity-block-cache.test.js`). `computeCounts` (document.ts) keeps
  its own per-block cache the same way, for the save, the library summary and the
  snapshot check (`canonical-json.test.js`).
- **A memoized child must not be handed a freshly-built prop.** MenuBar,
  StatusBar and BottomTray were `React.memo` and never once bailed out, because
  every handler was an inline arrow and the tray's `tabs` an array literal of
  new JSX. Handlers are hoisted into `useCallback`/`useMemo` at the call site
  and `sync-perf.test.js` fails if an inline function, array or object comes
  back. `EditorLayout`, the panes, `WorkspacePanel` and the four dialog sheets
  are memoized on top of that. Order matters — memo before stable props is a
  no-op. Sonner's `<Toaster>` is given `dir` once: without it, it read
  `getComputedStyle(document.documentElement)` on every render of the shell (A082).
- **Only STARTUP packages go into eager vendor chunks** (A084, `vite.chunks.ts`
  `createManualChunks`): a `node_modules` package is grouped only when an entry
  reaches it through STATIC imports. A hand-written exclusion list let lazy-only
  trees (mammoth, `@zip.js`, mermaid's nested marked) ride in the preloaded vendor
  chunk — startup payload 915 → 680 KiB gzip once they left. Anything heavy must
  stay behind a dynamic `import()`.
- **`hydratedDocId` (documentStore) is the data-integrity chokepoint**: it tracks
  which doc's content the live editor holds; `saveActiveDoc` refuses on mismatch.
  Every path that pushes content into the editor must `markHydrated(docId)`;
  every path that changes `activeDocId` without pushing must leave it null.
- **Stored content reaches the editor ONLY through `hydrateEditorWithDoc`** (the
  hydration ritual, `useDocumentLifecycle`) — boot, late boot, switches, the
  bridge's update/append and card saves all use it. It first checks the content
  against the LIVE schema (`canonicalMisfit`, `store/documents/schema-version.ts` — TipTap's
  own `nodeFromJSON` check): `setContent` handed a node or mark the schema lacks
  loads an EMPTY document, and the next keystroke's autosave wrote that over the
  stored one. A misfit, or a record stamped with a newer `schemaVersion`, is shown
  as a display copy (`coerceToSchema`, every word kept), read-only for the session,
  and is NOT marked hydrated — the store's `schemaLock` makes `markHydrated` refuse
  it and `saveActiveDoc` park `blocked` ("Newer version — read-only"), so no save,
  rename or draft path can persist the copy. The forced read-only lifts as soon as
  any compatible document is hydrated, by any path (A021). `CURRENT_SCHEMA_VERSION`
  is stamped on records and exports and never downgraded — **bump it** whenever a
  schema change writes content an older build could not load.
- **Never arm `suppressNextUpdate` before `view.setState`** (`CodeMirrorPane`).
  `setState` runs no update listeners, so the flag leaked into the user's NEXT
  transaction and swallowed its `onChange`: the first edit after a document switch
  (one paste into the markdown pane) was never synced, never marked dirty and never
  saved (A019).
- **Hydrating a different document must drop undo history** (`resetHistory()` on
  both panes — `setCanonical`/`setFromHtml` do it automatically). Without it,
  ⌘Z after a doc switch resurrects the previous doc's content into the new one.
  The ONE sanctioned exception is `src/store/history/history-cache.ts` (per-doc undo
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
  accidental/stale empty can never overwrite on disk (reload recovers), and parks a
  **terminal `"blocked"` save status** (NOT `"editing"`/`"error"`) so the autosave
  re-arm effect can't spin a loop. It **fails closed** when the pre-save read
  errors — writes nothing, parks `error`, retries — and **a failed read IS an error
  now**: every adapter's `get()` returns `null` ONLY for a genuine miss and throws
  `StorageReadError` otherwise (`corrupt` when a present record will not parse).
  They used to catch and return null, so this backstop, the conflict check and the
  pre-overwrite snapshot all took the "nothing stored" branch on a failed read and
  let the write through (A029). Callers handle the throw: boot skips an unreadable
  document, a switch reports it could not be opened, the link index skips it. The
  ONLY sanctioned blank persist is the explicit **Clear document**
  command, which calls `allowBlankSaveOnce()` (a one-shot module flag) to bypass
  the backstop; the autosave (`useAutosave`) toasts "Document is empty — not saved…" when a blank is blocked.
  **Do NOT re-add a focus-based ("is the rich editor focused?") heuristic inside
  `syncHtmlToMd`** — it was tried and removed because it silently REVERTED genuine
  deletions when the user blurred the rich pane before the debounce fired. The sync
  path is synchronous and only runs on real edits, so it correctly propagates a
  clear; recoverability is the save backstop's job.
- **Unload is a data-loss path, and `beforeunload` alone does not cover it**
  (`src/store/persistence/crash-recovery.ts`). The handler fires a best-effort autosave, but
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
  `beforeunload` when a tab is swiped away. Entries are built ONLY by
  `collectUnloadStash` (pure) and carry the revision the draft was written against
  (`base`) and whether the tab was already in `conflict`; boot restores `base` into
  `_draftBases`. Without it a reload laundered a multi-tab conflict — the adopted
  draft measured zero drift against the OTHER tab's record and the first autosave
  replaced that tab's work (A018). `stashUnsaved` read-merge-writes, newest entry
  per document: every tab shares the one key, and closing a window with two dirty
  tabs used to keep only the second tab's stash (A027). `configureRecovery()` lets a
  host namespace or disable it (A103).
- **The library is defended against the BROWSER deleting it** (A017, A022, A004;
  `store/persistence/storage-durability.ts`, one notice at a time in `ui/notices/durabilityNotices/index.tsx`,
  and Settings ▸ Storage & backup). Documents live only in this origin's IndexedDB,
  which Safari clears after seven days without a visit. `navigator.storage.persist()`
  is requested after the first save (re-asked at most weekly), and a full backup
  older than a week brings a reminder. **A localStorage canary (`pf:library-canary`)
  remembers how many documents the origin held**: when IndexedDB comes back empty
  while it remembers some, `noteLibraryAtBoot` reports a WIPE, nothing is seeded —
  the starter documents dressed the loss up as a first visit — and the notice
  explains and offers a backup import, Version history or Start fresh
  (`acknowledgeWipe`). While a wipe is unanswered an empty library is never written
  to the canary, and **anything that deliberately empties storage must clear it**
  (`clearLocalData` does), or the next boot reports a false wipe. A persistent,
  undismissable "Not saving" banner shows whenever the in-memory adapter is active
  or IndexedDB would not open (Safari private mode, blocked site data) — the one
  notice an embed shows too. The old origin (`LEGACY_APP_HOST`) announces the move
  with a one-click full backup.
- **Service-worker updates PROMPT; nothing forces a reload** (A008). With
  autoUpdate, `skipWaiting`, a `controllerchange` → `location.reload()` listener and
  a worker that navigated every client, each deploy reloaded every open tab mid-edit
  — undo history, IME compositions and open dialogs lost. Now (`registerType:
  'prompt'`, `src/pwa/sw-updates.ts`) a new worker WAITS behind "Update ready —
  Reload"; when another tab applies it, a tab reloads by itself only if online,
  clean and hidden (`decideUpdateReload`, `utils/app-health.ts`) and asks otherwise.
  Do NOT re-add any of the three. Tabs check for a new worker hourly
  (`UPDATE_CHECK_MS` — `pushState` routes are not navigations). **Every JS chunk is
  precached** (about 9.9 MiB since mermaid 12's ELK chunk), so the app works offline after ONE online visit — any lazy feature
  not opened online used to fail offline (A085) — and `public/sw-recover.js` falls
  back to THIS worker's own precached `index.html`. `e2e:pwa` proves both.
- **The boot watchdog acts only on EVIDENCE, and only online** (A011). The inline
  script in `index.html` fired on an 8s timer alone, so a slow device had its
  service worker unregistered and every cache deleted, then reloaded — offline,
  onto the browser's error page. It now needs a `<script>`/`<link>` that failed to
  load or an uncaught error from the app's OWN bundle (a file under `/assets/`, not
  an extension's script), waits a 4s grace, never acts offline, keeps its 30s loop
  guard and leaves `pf:boot-recovered` for the diagnostics. Likewise a failed lazy
  chunk reloads by itself only online, clean and not within 10s of the last time
  (`reloadForChunkErrorIfSafe`), and a genuine render error is SHOWN, never answered
  with a reload.
- **Diagnostics never hold document content** (A009, `utils/diagnostics.ts`): a
  bounded (25) localStorage ring of crashes, rejections, chunk failures, refused or
  conflicted saves and watchdog recoveries — kind, version, error class, a REDACTED
  first line (quotes, URLs, KaTeX, backslash commands and e-mail addresses
  stripped) and short frames. It leaves the device only when the user presses "Copy
  diagnostics" (crash screen, About) or a host subscribes with `setErrorReporter`;
  `installGlobalErrorCapture` runs on app-owned pages only (the app and the embed),
  never in a library host's page. The crash screen also offers "Export my documents"
  (`utils/emergency-backup.ts`: the backup ZIP, built without an editor).
- **A failed save must stay VISIBLE** (`saveError` in `documentStore`,
  `StatusBar`). A failed autosave is routed error → editing after 3s so the
  re-arm effect fires, so for most of each retry cycle the status bar read
  "Unsaved changes" — the reassuring message — while saving was failing over and
  over. `saveError` outlives that transition (cleared only by a save that lands)
  and the bar reads "Save failed — retrying". `"blocked"` — the terminal
  blank-over-content refusal — had NO branch at all and was invisible except for
  one 30s-throttled toast; it now reads "Empty editor — not saving". **`"full"` is
  terminal too** (A086): the IndexedDB adapter has NO default cap any more — the old
  self-imposed 50 MB measured characters × 2 and stopped saves at ~18 MB of real
  markdown, then retried forever — so the limit is the browser's quota
  (`navigator.storage.estimate()`, UTF-8 bytes; `maxBytes` is an optional HOST cap).
  A `QuotaExceededError` becomes `StorageQuotaError`, the one error the UI calls
  "Storage full — not saving"; deleting a document (`storageFreed`), a real edit or
  the toolbar's Save retries.
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
  `editing`** (now including the terminal `full`). `handleCloseTab` gated its
  prompt on `saveStatus === "editing"`,
  so `conflict` and `blocked` (both TERMINAL) and `error`/`saving` fell to the
  background-tab branch, which only looks for a cached draft — and ordinary
  typing does not cache one (`cacheUnsavedEdit` runs on LEAVING paths only).
  The close path also never calls `flushAndCacheIfDirty`, unlike `handleNewDoc`.
  So closing a document whose save was in conflict discarded the live content
  with no prompt, nothing on disk, nothing cached, and history dropped.
- **A save checks a REVISION, not the record, when it can** (A083). An autosave of
  a 4 MB note froze the page for 1.0–1.9 s at 4x CPU: it read its own record back
  and parsed and re-sanitized all of it, stringified the whole document, walked it
  for counts twice, deep-copied it into a snapshot, and the link index then read
  it back once more. Now `knownStored` (documentStore) remembers, per document,
  the revision, content and title this tab last WROTE or READ (seeded by boot and
  `switchToDoc`), and a save asks `storage.getRevision` (optional on
  `StorageAdapter`; the IndexedDB adapter reads `updated` off the END of the stored
  text, `readRevision` — so `serializeForStorage` MUST keep `updated` and
  `schemaVersion` last). The same revision → judge against what is remembered;
  another revision → `get` as before (conflicts are still caught); a BLANK editor →
  always `get`: the blank backstop judges against storage, never a memory of it. A
  failed revision read fails closed like `get`. The canonical comes from
  `canonicalOf`, the record text from `canonicalJsonText` (each unchanged block's
  cached text; `serializeForStorage` writes field by field, byte-identical to the
  old stringify — `document-serialize.test.js`), the counts from the per-block
  cache, the link index takes the store's own record (`storedRecordIfCurrent`), and
  the adapter remembers each record's size as written (`_recordBytes`). Measured:
  longest task per autosave 1.0–1.9 s → 0–0.44 s, most saves none
  (`e2e/probes/autosave-cost.mjs`, `persistence-save-revision.test.js`).
- **React walks a focused contenteditable on EVERY commit — `ReactSelectionShield`**
  (A083, docs/gotchas.md). Before each commit React saves the focused element's
  caret (`getSelectionInformation`), and for a contenteditable it finds the offsets
  by walking every DOM node before the caret: ~0.5 s per commit at 4 MB under a 4x
  CPU slowdown, for ANY commit on the page while the rich pane has focus. React
  reads an element with a `selectionStart` property directly, so the rich pane gets
  one (reads 0, writes ignored) while its document is ≥ `SHIELD_FROM_SIZE`
  (200,000 positions) and loses it below that and on destroy — a browser extension
  that takes such an element for a text field sees small documents as before.
  React writes it back only when a commit moved focus, and then focuses the editor
  itself; ProseMirror restores its own selection. `react-selection-shield.test.jsx`
  drives React itself and fails if an upgrade drops the shortcut.
- **`saveActiveDoc` resolves `true` ONLY when the write committed** — check the
  boolean, never the absence of a throw. It used to resolve normally on a refused
  blank, an aborted ownership check and a caught non-quota error, so ⌘S toasted
  "Changes saved" and fired the host's `onSave` for writes that never happened, and
  closing a background tab said "Saved" regardless. `handleSave` now says why
  nothing was saved (`describeUncommittedSave`) and does not call `onSave` (A026).
- **Multi-tab conflict → terminal `"conflict"` save status.** `saveActiveDoc`
  already refused to overwrite a stored doc a DIFFERENT tab wrote (its `updated`
  drifted >2s ahead of what this tab loaded). It now parks a **terminal
  `"conflict"` saveStatus** (set before it throws) — like `"blocked"`, it must
  NOT re-arm autosave. The autosave catch (`useAutosave`) detects the conflict error and RETURNS
  without the error→editing re-arm (re-arming would just re-detect the conflict
  every few seconds — a toast/status loop); a later real edit (`setDirty` →
  `"editing"`) resumes saving. Surfaced in the StatusBar ("Changed in another tab
  — not saving") and counted as unsaved by the `beforeunload` guard (warns, but
  never re-attempts the conflicting write). Live sync between tabs sits on top of
  it (next bullet); the save-status machine itself was not rewritten and the
  terminal statuses are unchanged.
- **Live sync between tabs** (`store/persistence/tab-sync.ts`, `editor/useTabSync.ts`,
  `ui/notices/tabSyncNotice/index.tsx`). Every COMMITTED write announces `{type, id, updated}` —
  never content — from `documentStore`, right after the adapter resolves and never
  for a refused write: **any new commit path must add its own `announce`**. The
  channel is named after the database or namespace (`pf-tab-sync:idb:<dbName>`,
  `:host[:<namespace>]`, …), so the app, its embed and two host namespaces never
  cross-talk; without `BroadcastChannel` it falls back to a `storage` event through
  `safeStorage`. A message is a HINT: the receiver re-reads its own storage and acts
  only on a revision ANOTHER tab announced (`isForeignRevision` — this tab's own
  settling write also looks newer). Announced revisions are noted on arrival and
  `isOvertaken` gives them no 2 s tolerance, closing the gap where a write inside
  the tolerance was overwritten silently. On receipt: the library listing (and the
  folder tree, when it changed) refreshes — Cards, the map and the link index follow;
  a changed document open here with NO unsaved work reloads ONLY through the
  hydration ritual, after `markHydrated(null)` (so the heading-rename baseline
  restarts), deferring while unhydrated, saving, composing or a projection is
  pending, and re-deciding after its read; WITH unsaved work (editing, error,
  blocked, full, conflict, or a parked draft) it `markConflict`s now and offers Keep
  mine / Use theirs / Save mine as a copy — every choice keeps the side set aside in
  Version history (`tab-conflict`), and nothing is written on receipt. A document
  deleted elsewhere while open is refused by `saveActiveDoc` while its record is
  still missing (`isDeletedElsewhere`), its unsaved text goes to Version history, and
  the notice offers Keep as a new document or Close. The folder tree is never
  written back from a remote apply (`withRemoteApply`) nor rewritten when unchanged
  (it is one last-writer-wins preference). Known gaps: read-check-write is still not
  atomic across tabs; a tab restored from the back/forward cache missed messages sent
  while frozen (its save's own read still protects).
  **The non-editor writes respect it too** (A028): `renameDoc` and `patchDocById`
  used to merge this tab's live content and save with no drift check. A content
  patch against a stored revision newer than this tab's base (the open document's,
  a parked draft's, or the caller's `expectedUpdated`) now throws `ConflictError`;
  a rename or title patch of an overtaken document renames the stored record
  WITHOUT merging live content or moving the base, so the conflict is not
  laundered. **`touchUpdated: false` patches METADATA only**, onto the freshest
  stored record — it used to persist new content under the OLD timestamp, which
  the other tab's guard could not see.
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
  guards are required, and **every ACTIVATION bumps `switchSeq`** — `finalizeDoc`
  (new document, import, restore-as-new), `closeTab`'s nothing-left-open branch and
  the boot activation changed `activeDocId` without it, so a switch whose read was
  still in flight re-activated its own target afterwards (A032). **Every OTHER
  async path IN THE HOOK that ends in `hydrateEditorWithDoc` claims and re-checks
  the same generation** —
  `handleCloseTab`, `handleDeleteDoc`, `handleNewDoc`, `handleRevertDoc`,
  `restoreSnapshotInPlace`, `restoreSnapshotAsNew`. They reach the identical
  hydration after the identical kind of await, several of them after an
  UNBOUNDED one (a confirm dialog the user can leave open while opening another
  document), and none of them claimed a generation at all —
  `restoreSnapshotAsNew` bumped it to invalidate others and then never checked
  its own. `composition-guards.test.js` pins that set behaviourally and by
  source. The editor's own hydration sites — boot (`useEditorBoot`), the bridge's
  update/append (`useHostApi`), card save (`useCardHandlers`),
  `activateAndCapture` and the no-editor import branch (`useImportPipeline`), all in
  `src/editor/` — re-check `activeDocId` after their awaits instead
  (`isEditorTargeting`, below); the source pin names the lifecycle hook's functions
  only, so a new site in `src/editor/` must be checked by hand.
- **Recoverable snapshot net (`store/history/snapshot-store.ts`).** The LAST line of
  defence: a SIDECAR IndexedDB (`perssonify-snapshots`, its own DB — independent
  of the injected StorageAdapter, must survive reloads) keeps a bounded, per-doc
  ring of prior content versions so anything the prevention layers miss stays
  recoverable. `saveActiveDoc` calls `snapshotStore.maybeRecordOnSave(...)` with
  the OLD stored content before overwriting (throttled to one/interval per doc,
  but a large content SHRINK — the "got wiped" signature, incl. an explicit
  clear — always snapshots as `pre-clear`); `deleteDoc` records a `pre-delete`
  snapshot so deleted docs are recoverable. Bounds: per-doc count + global byte
  budget + age, evicted oldest-first but NEVER a doc's single most-recent
  snapshot — **unless that snapshot is a deleted document's `pre-delete` copy**,
  which expires with the 30-day age window and counts against the byte budget like
  any other: deleted content must not live on for ever (A079). After a delete the
  toast offers **Erase history** (`deleteDoc({ purgeHistory })` /
  `purgeDocHistory`), and deleting a single version is confirmed — for a deleted
  document it may be the last copy (A023). Same-millisecond snapshots order by a
  session-wide insertion `seq`, not the id (memory ids count DOWN, so the id order
  was exactly backwards, A035). A host's `storageConfig` namespaces the sidecar
  database (or turns it off) along with its documents (A103). Blank canonicals are
  never snapshotted (nothing to protect).
  Restore is via **Tools ▸ Version history** (`VersionHistorySheet`): restore
  in place (snapshots current first, so it's reversible) or as a new document
  (`restoreSnapshotInPlace`/`restoreSnapshotAsNew` in `useDocumentLifecycle`).
  Falls back to an in-memory ring when IndexedDB is absent (SSR/tests). Do NOT
  route snapshots through the main doc schema/adapter — the sidecar is
  deliberate (keeps the delicate doc save-path and IDB schema untouched).
  **A database record keeps the content as JSON TEXT (`json`)** since A083 —
  records written before keep an object (`canonical`); every reader takes both
  (`payloadOf`), and the memory ring keeps objects. IndexedDB deep-copies an
  object graph on every write and read: a 4 MB note's snapshot spent ~1 s at 4x
  CPU in that copy. A build from before lists the new records but cannot restore
  them. Dedup reads ONE record (`latestForDoc`: the doc's keys, then the highest),
  not every version kept, content and all.
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
- **Turndown's escaper covers CommonMark core only, so the engine installs its
  own** (`installEscape` → `escapeMarkdownText`, turndown-rules.ts): `<` before a
  tag-like character, `&` before a character reference, `N)` at a line start, and —
  only while their feature is on — `$` exactly where the maths tokenizers would open
  a formula (it asks `matchInlineMath`/`matchBlockMath` themselves, to a fixpoint),
  `~~` and recognised curly groups. Literal text typed in the rich pane otherwise
  came back as markup on the next pass: `&lt;br&gt;` a line break, text about
  `<details>` a Details node, `\$x\$` a formula (A040). Ordinary prose (`a < b`,
  `Tom & Jerry`, `$5 and $10`) gets no backslashes (`converter-escape.test.js`).
  Thematic breaks are written `---` (`hr: "---"`), not turndown's `* * *` (A051). A
  table cell's markdown comes from the OUTER conversion — the separate small cell
  converter lost strikethrough and image sizes; lists or paragraphs inside a cell
  still flatten (GFM cannot hold them) and fidelity reports them (A044).
- **Rich→markdown is LINEAR-time** (`turndownLinear`). Turndown folds children with
  a join that makes V8 flatten the whole accumulated string — quadratic in
  top-level blocks, on every projection. The top level now converts in runs of 64
  blocks joined with turndown's own separator rule, byte-identical to
  `td.turndown(html)`: any new rule must keep `converter-linear.test.js` green.
  `converter-roundtrip.test.js` drives md → rich → md′ → rich → md″ through the real
  engine and schema (`converter-harness.js`) and pins hard breaks (A037), content
  nested under checklist items (A038), blank lines inside list items and their code
  (A041) and footnotes, which now ROUND-TRIP as `[^label]` (A043).
- **Rich→markdown projects PER TOP-LEVEL BLOCK** (`engine/incremental-md.ts`, A083),
  byte-identical to `htmlToMd(getHTML())`. A WeakMap keyed on each top-level PM
  node caches its HTML hash, cleaned HTML, turndown output (per mode and escaper
  setting) and the whitespace-passed result, so a keystroke re-converts only the
  blocks that changed; seams follow `turndownLinear`'s rules and runs are joined
  with turndown's own seam rule. **A turndown rule that reads OUTSIDE its own
  top-level block** (a sibling, like `footnoteHeading`) must be handled in
  `holdsNextSibling` (turndown-rules.ts), or the per-block and linear paths
  diverge — `converter-incremental.test.js` (seeded random edit walks, both modes,
  after every step) and `converter-linear.test.js` must both stay green. A change
  to `normalizeMarkdown`'s fence placeholder must follow `FENCE_PLACEHOLDER`
  (pinned). Blocks are serialised into an INERT document only — a live one loads
  each `<img>`, which the CSP and dataloss suites caught with stored images.
  Measured at 1.6 MB: keystroke → markdown pane 23 s → 0.6 s at 4× CPU, 2.5 s →
  0.17 s at 1×. markdown→rich is incremental too (next bullet).
- **Markdown→rich is INCREMENTAL** (`engine/incremental-rich.ts`, A083).
  `syncMdToHtml` dispatches `engine.planRich(md, view.state)`; `setCanonical` and
  `setFromHtml` call `forgetRich()`. A MODEL (each run of top-level blocks: its
  source length and node count) lets an edit re-lex, render and parse only the runs
  it touched, plus runs whose nodes the rich pane changed (found by identity). The
  result MUST be `Node.eq` to `setContent(mdToHtml(md))` with `preventAutolink`;
  the transaction sets `preventUpdate` and `preventAutolink` and is one history step.
  A CUT needs all four: a blank line after a block that cannot run on; marked's
  inline state clear; the HTML leaving the browser parser clean
  (`selfContainedHtml`, else the `leavesParserClean` probe); and ProseMirror with no
  node open (position check plus a sentinel text node). **Anything uncertain falls
  back to the whole path** — a wrong partial update is data corruption, a fallback
  only a slow keystroke. Whole document while present: the curly-brace syntax,
  marked hooks, a `\r`, link reference definitions (or a block one could still grow
  out of), footnote definitions, a bare-pipe alias wiki link, raw HTML holding a
  `<pre>` with more than text or a `white-space`/CSS-escape style, ANY raw-HTML
  `<table>` (three defects came from them), a raw-length mismatch, the
  preprocessor rewriting the text. **The suite's 40 random walks are not enough to trust a
  change to the cut rules**: deep runs of 600–4,000 seeds each found new defects —
  run deep, split across processes (`RICH_SEEDS`/`RICH_SEED_FROM`/`RICH_LONG_SEEDS`,
  and `RICH_PREBUILD_SEEDS` for the prepared-model walks; the corpora and edits live
  in `incremental-rich-harness.js`; jsdom's `setContent` grows ~3.5 MB per 30
  projections, so one process crawls).
  **The model is PREPARED after a load** (`prepare` → `RichPrebuild`; `useSyncEngine`'s
  `startPrebuild` runs it in `runWhenIdle` slices, `utils/idle.ts`, for documents of
  64 KB and up — the first keystroke used to parse the whole document to build it).
  Windows of ~16 KB from the start, each lexed, cut and parsed on its own by the edit
  window's own rules, ending AFTER A BLANK LINE (ended at a mere line start, a window
  is never clean, and it doubled until it swallowed the document). Anything a window
  refuses gives the preparation up and the first keystroke builds as before; a
  keystroke that comes first finishes what is left; a load, `forget` or a feature
  switch retires it. The loaded document need not be its markdown's parse (a code
  block typed in the rich pane lacks marked's trailing newline): parsed nodes equal
  to the loaded ones ARE the loaded objects, and when all are (`shared`) the model is
  simply that document's — a rich edit since is found by identity, as any is;
  otherwise the first projection turns the document into the parse (`replaceRange`,
  as the build did) and re-parses the edit's window on top, in one transaction
  (`incremental(..., base)`). Measured at 4× CPU: first keystroke 1.6 MB 9.1 s →
  0.7 s, 4 MB 28 s → 2.7 s (a document whose ~900 code blocks that first projection
  rewrites), slices' longest task 55–76 ms; later keystrokes 0.6 s and 1.4 s (were
  ~23 s and ~116 s). `incremental-rich-prebuild.test.js` walks prepared loads —
  prepared text messy on purpose, and half the time NOT the converter's own output
  (the app only ever hands it that, which never holds a link definition or a raw
  `</div>`). Tokens are walked with `walkTokensLinear` — marked's `walkTokens` rebuilds its result array
  with `concat` at every token (1 MB: 54 s against 13 ms) — and not at all without a
  "<" or an extension `walkTokens` (`incremental-rich-walk.test.js`).
- **A transaction's STEP COUNT is a cost of its own** (A083, docs/gotchas.md). Each
  ReplaceStep rebuilds the document's top-level node list, so a step per changed
  stretch is quadratic when there are hundreds (the first projection after a load
  rewrote ~900 code blocks at 4 MB: 6 s at 4× CPU). Above `STEP_LIMIT` (16)
  stretches `replaceRange` takes ONE step that carries the unchanged nodes between
  them as the very same objects — the view matches children by node equality, so
  their DOM stays — and maps the selection itself as the per-stretch steps would
  have (the one step's own map would send a caret anywhere in the range to its end).
  A plugin must never map each step's range through every LATER step: `BidiAuto`
  did (it now has no state at all); `UnresolvedWikiLinks` carries the range
  forward through each step's map instead, reporting their union above 32 steps.
- **marked-footnote is registered AFTER maths**, and every parse calls
  `resetFootnoteNumbering(m)` first: registered first, a document opening with `$$`
  that held a `[^1]` threw, and the extension then stayed stuck for every later
  parse. Its section token must be `tokens[0]`; its reference counter is shared
  between parses. **`TableCellFast`/`TableHeaderFast`** (`engine/table-colwidth.ts`)
  replace the stock cells in BOTH schemas (no per-cell `querySelectorAll`), and
  `TiptapPane.setHTML` parses through `parseHtmlDoc`, whose whitespace pass is
  linear. **Formulas typeset only near the view** (`MathNodes`, IntersectionObserver;
  `beforeprint` typesets all) — React's commit walks the whole contenteditable
  (`getSelectionInformation`) and KaTeX DOM made that walk expensive.
- **Exported markdown writes hard breaks as `\` + newline** (A051,
  `engine/portable-breaks.ts`): the app's `breaks: true` dialect draws a line
  break for a bare newline, which stock markdown renderers drop, so File ▸ Export,
  the per-document export and the ZIP export (`canonicalToPortableMarkdown`) run
  the converter inside `withPortableBreaks`. **The editor's own projection must
  NOT** — `docToMd` always runs with the switch off. A break stays as it was inside
  a table cell (written `<br>`) and inside link text, where marked rejects `\` +
  newline. Backups, the clipboard, a card's source and the append API are unchanged
  (`converter-portable-breaks.test.js`).
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

- **Post-await ownership check (`isEditorTargeting`, `src/editor/useImportPipeline.ts`).** Any
  path that writes a document and THEN pushes content into the live editor must
  re-check ownership AFTER the await, never capture it before. Persisting goes
  through IndexedDB, which is slow enough that a doc switch lands mid-write
  routinely; a pre-await `activeDocId === id` snapshot let `handleCardSave` and
  the bridge's `updateDocument`/`appendToDocument` push document A's content into
  an editor now holding B, which autosave then wrote into B's record. One helper,
  three call sites, each followed by `hydrateEditorWithDoc` (which refuses to mark a
  schema-locked document hydrated). This is the same chokepoint
  `saveActiveDoc` re-asserts after its own await. It checks `activeDocId` ONLY —
  also demanding `hydratedDocId` looks safer but swallows a REPAIR: a document
  that is active but unhydrated SHOULD receive the content it just persisted,
  which is how an activated-but-unhydrated doc is rescued from having every save
  refused.
- **Adding documents is a document-LEAVING path too.** `addDocumentsImpl` (and
  therefore the deprecated `setDocuments` that forwards to it) runs
  `prepareToLeaveActiveDoc()` first and, after the loop, hands hydration off so the
  editor holds whatever the store says is active. It activates the created document
  and overwrites both panes, so without the goodbye a host call destroyed whatever
  was typed in the open document's current autosave window. The host's
  `importContent` owes the same goodbye (`prepareToLeaveActiveDoc()` then
  `activateAndCapture`): it pushed HTML straight into the live editor over the open
  document, and a `pmjson` payload was neither saved nor opened (A034).
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
  used to overwrite both panes with no goodbye at all, destroying anything typed in
  the current autosave window — not on disk, not in the draft cache, not in undo.
  **Imports convert HEADLESSLY and never activate a document mid-loop** (A031):
  each file goes through `captureIngestHeadless` against the live editor's schema
  (or `headlessSchema()` when none is mounted) and is persisted WITHOUT activation
  (`saveNewDoc`); the caller then opens the first import through `handleSwitchDoc`,
  the ordinary leaving path (only with no editor mounted at all does `importItems`
  activate and hydrate it itself). The loop used to BORROW the live editor per file
  — activate, push the HTML, yield a frame, read it back — so a click in the library
  during that frame hydrated the user's own document, the fallback persisted the
  file as an empty "Untitled" (counted as imported), and each later file yanked the
  store back off the user's choice.
- **Every blank-canonical write goes through the backstop.** The `beforeunload`
  draft flush uses `patchDocById`, which has no blank guard (a host clearing a doc
  through the bridge is a legitimate write), so a blank canonical `saveActiveDoc`
  had deliberately REFUSED was written to disk anyway on tab close — the exact
  wipe the backstop exists to prevent, via the long way round. It now skips a
  blank draft over a non-empty stored doc. The one-shot clear permission is
  **scoped to the document it was granted for** (`blankSaveAllowedFor`): unbound,
  a permission from a clear whose save never happened stayed armed and disarmed
  the backstop for a different document. Unmount's `releaseEditor` (`useDocumentLifecycle`) applies
  the same blank-over-content check (`blankOverContent`) before it writes the cached
  draft through `patchDocById` — `persistence-remount-blank.test.jsx`, in a file of
  its own because the stores keep the FIRST adapter a file installs.
- **`deleteDoc` claims the id before its awaits** (`deletingDocs`), and
  `saveActiveDoc` refuses to write a doc being deleted. `closeTab` only clears
  `activeDocId`/`hydratedDocId` at the very end, so an in-flight autosave passed
  the hydration re-assert and re-created the record after `storage.delete`
  committed. Bulk delete is sequential and awaited for the same class of reason.
  **`patchDocById` refuses a document deleted since its read began** — being
  deleted (`deletingDocs`) OR already deleted (`deletedAtSeq`, numbered, because a
  delete that finishes entirely during the read has cleared its claim). It used
  to write the record straight back after the delete (card saves, host updates,
  retargeted links). Keep the check with no await between it and the write.
- **`touchUpdated: false` is honoured by the ADAPTERS** via `stampUpdated`
  (`document.ts`) and the `_preserveUpdated` marker. Every `save()` used to stamp
  `updated` regardless, so the flag never did anything and recolouring or pinning
  a card re-sorted the board as if it had been edited.
- **`normalizeMarkdown` masks fenced code** before its whitespace passes, exactly
  as `preprocessMarkdown` does. Those passes run on every rich→markdown projection
  and collapsed blank runs / stripped trailing whitespace INSIDE code blocks. Both
  find fences with the ONE line-based scanner, `findFencedCodeRanges` (same
  character, at least as long, blockquote-aware, unclosed runs to the end): the old
  regexes closed a four-backtick fence at the first three-backtick line and ignored
  fences inside blockquotes and callouts (A046).
- **Archive import skips hidden DIRECTORIES, not dot-prefixed filenames** — a note
  titled ".env setup" was written into a backup ZIP, counted in the export, and
  silently dropped on restore.
- **The snapshot store's memory ring is READABLE.** `record()` falls back to memory
  when an IDB write fails, but the DB is still open, so readers that short-circuit
  on `this.db` could never see those entries: the last line of defence was writing
  snapshots nothing could read back. Every accessor unions both.

- **A file dropped on the editor must not navigate the tab away**
  (`EditorLayout`'s `onDragOver`/`onDrop` → `handleFileDropImport`, `src/editor/useEditorActions.ts`). There
  was no drop handler anywhere in `src/`, so a file dropped on either pane got
  the browser default: the tab navigates to the file and everything typed since
  the last autosave is gone — the one gesture that leaves no draft, no undo and
  no snapshot. Only drags carrying `Files` are intercepted; a text/HTML drag
  inside the document still belongs to CodeMirror and ProseMirror. The
  `preventDefault` happens even with no importer wired (a library host may not
  pass `onFileDrop`) — losing the document is not an acceptable way to say "we
  can't import this". Pinned by `editor-file-drop.test.js`.

- **Every path that creates AND opens a document outside import uses
  `activateAndCapture`** (`src/editor/useImportPipeline.ts`: the bridge's `addDocuments` and
  `importContent`, Cards quick-capture). It converts headlessly FIRST — no yield
  between conversion and persistence — then persists and activates (`finalizeDoc`),
  and hydrates through the ritual only if, after the awaits, the store is still on
  the new document (`activeDocId` alone, like `isEditorTargeting`). Each path used
  to borrow the live editor and capture `editor.getJSON()` after two awaits, so a
  switch landing in between wrote the OTHER document's content into the new record.
  **Cards quick-capture is also a document-LEAVING path**:
  it calls `prepareToLeaveActiveDoc()` and switches back to `previousDocId`
  afterwards, or capturing a note destroyed whatever was typed in the open
  document's autosave window.
- **The surface-open flush oracle is `editing | saving | error`, not
  `editing`** (opening Cards / the map). Those surfaces read the LIBRARY, so
  they flush in-flight edits first — but keying the flush on `"editing"` alone
  missed a save that was mid-flight or retrying, which is exactly when the
  stored copy is most stale. A **`"conflict"`** or **`"full"`** status routes to
  `prepareToLeaveActiveDoc()` instead: both are terminal, so autosaving would
  spin.
- **A caller-supplied `shouldShow` REPLACES TipTap's own `isEditable` gate**
  (`TableBubbleMenu`, `LinkBubbleMenu`) — it does not compose with it. Both
  bubble menus shipped mutating a read-only document because of that, and
  `CommandManager` has no editability check of its own to catch it. Every
  mutating chain goes through **`runBubbleCommand`** (`ui/panes/utils/bubble-menu-command.ts`),
  which bails when `!editor.isEditable` and blurs first when `view.composing`.
  Pinned by `bubble-menu-guard.test.js`.
- **The embed's `allowedOrigins` is the PARENT's origin, never its own — and the
  framer does not get to pick it.** The shipped iframe build could not receive a
  single host message because it was passing the editor's origin, and
  `createEditorClient` defaulted to `"*"` in both directions; the first fix then
  trusted `?allowed_origin=` or `document.referrer`, both chosen by whoever frames
  the embed, so ANY framing page got a bridge that can read and overwrite every
  document (A072). `resolveEmbedAllowedOrigins` (`integration/embed-origins.ts`,
  pure) decides now: the build-time `VITE_EMBED_ALLOWED_ORIGINS` allowlist filters
  everything; where the browser reports the real framer (`location.ancestorOrigins`)
  a requested origin must BE it and an unframed page gets no partner; then
  `?allowed_origin=` (a literal `"*"` is REJECTED), else the reported framer, else
  `document.referrer`'s origin; else `[]` — deny-all, the safe failure. Any
  deployment serving the embed from an origin that holds user documents must set
  the allowlist. A SELF-HOSTED embed keeps the `perssonify-docs`
  database (renaming it would orphan every embed user's library); on the app's own
  hosts (`APP_HOSTS`, constants.ts) `embedStorageConfig(location.hostname)` gives it
  `perssonify-embed-docs`, so a framing page can never reach the app's library, and
  its snapshots and crash stash follow the name (`embed-storage.test.js`). `resolveEditorOrigin` (`host-bridge.ts`)
  derives the host's target from the iframe's own `src`. Pinned by
  `embed-origin.test.js`.
- **`typeof localStorage` EVALUATES the getter**, which throws where a browser
  blocks site data (Safari private mode, "block all cookies", some webviews) —
  so the feature-detect was itself the crash, and the app did not boot at all.
  Use **`utils/safe-storage.ts`** (`safeStorage.get/set/remove/available`, each
  try/caught); `uiStore`, `theme/palette`, `storage-adapter` and `crash-recovery`
  use it. The few direct `localStorage` calls that remain (Find's options, the
  tour flag in `App.tsx`, the stash write, `clearLocalData`'s key scan) must stay
  inside a try/catch. Pinned by `blocked-storage.test.js`.
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
  in one pane and a blockquote in the other. Every branch — reached only with the
  caret in a pane, see the next bullet — preventDefaults and dispatches, so the
  command applies exactly once through the choke point that carries the read-only
  and composition guards. `keyboard-shortcuts.test.js`
  drives a ref whose editor DOM CONTAINS the focused element — with
  `{ current: null }` the early return never executes and the tests prove
  nothing about the pane the bugs were in.
- **Document chords need the caret IN the document** (A025). The listener admits
  any focus inside the editor container, which also holds the Cards composer and
  card editor, the library's search and rename boxes, the map's search and the
  Find panel — ⌘B/⌘I/⌘K/⌘⇧1… typed in any of them formatted the document hidden
  under the overlay, and autosaved it. Formatting chords, ⌘K and ⌘Z's
  `cancelPendingSync` run only when focus is inside the CodeMirror or ProseMirror
  view AND `workspaceView === "editor"` (read through a ref at event time);
  otherwise the key is left to whatever has focus, un-prevented. The global chords —
  find, replace, search, save, new, workspace panel, map, cards — still work from
  anywhere in the container.
- **AltGr is never a shortcut** (A052). Windows delivers AltGr as Ctrl+Alt, so on
  German, Nordic, Swiss, Spanish and French layouts `[` and `]` (AltGr+8/9) were
  swallowed as outdent/indent — no markdown links, task lists or `[[wiki links]]` —
  and CodeMirror's `Mod-Alt-\` ate the backslash. Guarded in THREE places:
  `useKeyboardShortcuts` and the Find panel bail on `isAltGraphInput`
  (`utils/alt-graph.ts`); CodeMirror's keymap goes through `dropAltGraphChords`;
  TipTap's own `Mod-Alt-*` keymaps sit behind `AltGraphPassthrough`, a
  highest-priority plugin that skips ProseMirror's keydown handling WITHOUT
  `preventDefault`, so the character still types. **No new keymap may bind Ctrl+Alt
  plus a character key.** Deliberate consequences: the undocumented Ctrl+Alt+digit
  heading chords do nothing on Windows/Linux (⌘⇧1–6 are the documented ones), and
  on an AltGr layout Ctrl+Alt+F types its character — Ctrl+H opens Replace.
  `editor-altgraph.test.js`.
- **Tab right after a list keeps its pre-3.31 meaning.** Tiptap 3.31's ListKeymap
  added a Tab binding that moves a paragraph following a list INTO the list's last
  item — a structure change and a captured focus key, arriving with a dependency
  bump. The rich pane registers `ListKeymapNoTab` (StarterKit `listKeymap: false`);
  Tab inside a list item still nests. Adopting the upstream behaviour is a product
  decision, not an upgrade side effect (`editor-list-tab.test.js`).
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
  what was quietly relying on the churn. The overlay effect (gated on the overlay
  opening) and Cards (it measures a div it always renders) are fine. The map's wheel
  listener was measured attaching — on the FIRST open only: every later open
  mounts before the `<svg>` exists, so a mount-once effect never attached it and a
  pinch zoomed the whole page (A065). It is a callback ref on the `<svg>` now; a
  listener that needs an element which mounts LATER belongs in a callback ref, not
  a mount effect (`graph-wheel-attach.test.js`). Pinned by
  `keyboard-shortcuts.test.js` and `e2e/probes/shortcut-after-reload.mjs`.

## Internal links (wiki links + heading anchors)
- **Wiki links are a marked INLINE extension** (`engine/wiki-link-marked.ts`,
  registered in `build-marked.ts`), never a regex pass over the raw source: the old
  preprocessor pass could not know what marked would treat as CODE, so an indented
  code block got an `<a>` injected and the next rich edit wrote it into the markdown
  for good (A048). `[[Doc]]`, `[[Doc#Heading]]`, `[[#Heading]]` (current doc), and
  `|Display` variants become `<a data-doc-link data-anchor class="wiki-link">`.
  **`\|` is an alias separator too** — the spelling a pipe takes inside a GFM table
  cell and the one our table serializer writes; with only `|` recognised a
  table-cell alias came back as target `Doc\`, one more backslash per trip (A045).
  The preprocessor's only wiki-link job now is `wikiLinkTablePipes` (escape a bare
  `|` inside `[[…]]` so a table does not split the link across cells). Titles
  containing `|` or `]` still cannot be linked. The Link
  mark is extended by `src/extensions/WikiLink.ts` to PRESERVE `data-doc-link`
  and `data-anchor` (stock TipTap Link drops them) — required for both click
  navigation (`useLinkIndex`) and turndown round-trip (`turndown-rules.ts`
  `wikiLink` rule keys on those attrs; filter uses `hasAttribute`, since a
  same-doc anchor has `data-doc-link=""`).
- **ONE resolver — `createWikiResolver` / `resolveWikiLink` (`store/links/link-index.ts`),
  built once per library — serves the link index, the click handler and the
  broken-link decoration.** With an anchor it first tries the WHOLE `docLink#anchor`
  as a title (so `[[C# Tips]]` finds "C# Tips"), then an exact id, then an exact
  title (NFKC, case- and whitespace-insensitive) — never a partial match, which sent
  `[[C# Tips]]` to "Changelog" in the graph while a click said "Document not found"
  (A059). **Broken links are a ProseMirror DECORATION** (`extensions/UnresolvedWikiLinks.ts`,
  a plugin — no schema change) that `useLinkIndex` feeds the library after every
  re-index, judged live with the same resolver; nothing is marked before the
  library loads. **An edit re-judges only the top-level blocks it touched** (A083):
  the previous decorations are mapped through it, and the changed ranges come from
  the STEPS, not the step maps — a mark step (making text a link, retargeting one)
  maps no positions, so a map-only reading never sees it. An unknown step shape
  falls back to a full rescan; a library change always rescans. The old DOM marking compared `String()` of objects ("[object
  Object]") and never marked a single link (A058). Its dashed underline uses `:has()`
  in a rule of its own — an engine without `:has()` drops a whole selector list.
  **Link clicks are delegated on `document`** and resolve the current editor at
  event time, ignoring links outside it: a listener on `editor.view.dom` died when
  the editor remounted (A064).
- **`scanWikiLinks` (link-index.ts) reads BOTH forms**: literal `[[…]]` in text
  (markdown-only / not-yet-rendered docs) AND rendered link marks (docLink attr).
  It separates a `#heading` anchor (carried beside the target, so the resolver can
  still try `C# Tips` whole) so the graph/backlinks connect documents, not
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
- **Heading anchors resolve in ONE place** — `scrollToHeadingByAnchor`
  (`src/editor/useHeadingNavigation.ts`) calls `findHeadingByAnchor` with THE normaliser,
  `normalizeHeadingAnchor` (`store/documents/doc-outline.ts`: NFKC, lowercase, keeps
  `\p{L}\p{N}\p{M}`, collapses the rest); generation sites carry the raw heading
  text. The old `[^a-z0-9]` key turned every Cyrillic/CJK/Arabic heading into "", so
  any non-Latin anchor jumped to the FIRST non-Latin heading, and "Über" matched
  "ber" (A098). Combining marks are kept on purpose (stripping them merges distinct
  Devanagari/Thai headings); a heading with no letters or digits compares on its
  exact text. `extractHeadings` is UNBOUNDED by default — a 40-heading cap meant for
  the long-removed in-graph structure view truncated the Outline, "Link to heading"
  and `doc.outline` (A063); the map rail keeps its own `HEADING_CAP`.
- **Renaming a heading OFFERS to retarget the links to it** (#122): the pure half
  is `store/links/heading-renames.ts`, timing and writes `editor/useHeadingRenameLinks.ts`.
  - **Baseline:** the heading texts at hydration (a `hydratedDocId` subscription).
  - **When it checks:** `HEADING_RENAME_CHECK_MS` after the caret LEAVES a heading
    (document `selectionchange`/`keyup`/`pointerup`, deferred one task, read from the
    last-focused pane — ProseMirror `$from`, CodeMirror `resolveInner`), and on
    every leaving path via useDocumentLifecycle's `onLeavingDoc` (switch, new,
    `prepareToLeaveActiveDoc`, close with the content kept) — never on Discard,
    delete or unmount. The heading the caret is in is excluded; a live composition
    reschedules.
  - **Alignment:** unchanged anchors are fixed points (prefix/suffix, then LCS);
    the gaps pair IN ORDER at the SAME level. Offered only when the old anchor is
    gone, was the first of its key, the new one is the first of its key, and
    `isLinkableAnchor` (no `|`, `[`, `]`, line break).
  - **Consent:** nothing is written without the toast; any close of it is
    Dismiss, and either answer re-baselines only the offered renames. Renames are
    claimed at leave time (an import leaves twice).
  - **Update, open note:** ONE transaction under `closeHistory` (so ⌘Z takes back
    exactly it), after ending a composition and `flushPendingSync` (a pending
    markdown projection otherwise landed afterwards and the typed markdown was
    lost). Read-only: no offer, and Update refuses.
  - **Update, other notes:** `snapshotStore.record(…, "pre-link-update")`, then
    `patchDocById({ canonical, expectedUpdated })`; never a note that is active,
    schema-locked or holds a parked draft (`writableThroughStorage`, checked
    before the read AND after the awaits). Such notes are named in the result
    toast, never forced.
  - **Links** are found like `scanWikiLinks` (marks and literal text, never in code
    or inside another link) but with the renderer's tokenizer and
    `parseWikiInner` (so `\|` aliases work), resolved by the ONE resolver; an
    alias-less link's text follows its target by the turndown `wikiLink` rule's
    own test.
  - Known narrow race: a note opened while its `patchDocById` read is in flight
    can load the pre-rewrite copy and autosave the old links back (the snapshot
    keeps the rewrite recoverable).
- **Right-click context menu** (`src/ui/chrome/editorContextMenu/index.tsx` + generated
  `components/ui/context-menu.tsx`) wraps the panes and reuses `dispatch`; its
  "Link to heading" submenu inserts `[[#Heading]]` via `insertHeadingLink`, and the
  rich-pane link is built by `headingLinkHtml`, which ESCAPES the text — a heading
  `Use <b> tags` inserted bold text, and one holding `<img …>` an image. **Never
  compute document-derived data in its render**: it re-renders on every keystroke,
  and building the heading list there (a full `getJSON()` plus a walk) cost ~300 ms
  per key on a large document at 4× CPU; `HeadingLinkItems` reads them only when
  the submenu opens (A083).
- **Split-pane scroll sync** (`editorPanes/index.tsx`) uses value-based echo
  suppression (remembers the exact scrollTop it wrote to the other pane and
  swallows that one echo) — never a timer. Do not reintroduce a setTimeout
  guard; it made the panes fight and dropped user scrolls. The mapping is
  **heading-anchored piecewise-linear**, NOT a single global percentage: it pairs
  corresponding headings on both sides (CM: headings from the syntax tree via
  `markdownHeadings`, `scroll-anchors.ts` — setext, quoted and list-nested headings
  included, code excluded — positioned with `lineBlockAt(h.from).top`, which works
  for off-screen/virtualized lines; Tiptap: heading
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
  animation on the editor container (`editorPanes/index.tsx` restarts it via reflow;
  opacity-only, no remount) for a graceful transition.
- **Editor images carry NO border-radius** (`.ProseMirror img` in styles.css +
  `[data-md-preview] img` in `useMarkdownEngine.ts`) — rounding clips corner pixels
  and truncates logos/screenshots with edge content. Keep them square.

## Library / embed parity (the "module system")

The product ships three ways from one codebase: the standalone app
(`main.tsx`→`App.tsx`), the iframe embed (`embed.tsx`) and the npm library
(`index.tsx`, `engine`, `store`, `integration` entries). Parity rules:

- **URL parameters are the APP SHELL's job.** `App.tsx` reads `readonly`/
  `view_mode`/`import_url` (and `ads`, in dev only) and strips them; the editor component must not read
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
  (`scopeLibraryStylesheet`, wired into **`vite.config.ts` ONLY**) runs two passes.
  (1) Everything in `@layer base` is confined to `:where(SCOPE_ROOTS)` — `.pf-app`,
  `.perssonify-editor`, `[data-pf-root]`, `[data-base-ui-portal]`,
  `[data-sonner-toaster]`, `[data-pf-portal]` — and their descendants; `:where()`
  keeps ZERO specificity, so utilities still beat the reset exactly as before.
  (2) **The design TOKENS live on those roots, not the host's `:root`** (A102): a rule
  made only of page roots and theme/palette switches is rewritten to `TOKEN_SCOPE`.
  Unscoped, `--background`, `--primary`, `--border`, `--radius` — the names a
  shadcn/Tailwind host uses for ITS design system — were redefined in unlayered
  rules that beat the host's layered ones, and `html::-webkit-scrollbar` hid the
  host page's scrollbar. Portalled surfaces still get the tokens because their
  wrappers ARE roots. `TOKEN_SCOPE` excludes roots nested under `[data-pf-root]` (the
  integration's `display:contents` wrapper, which sits OUTSIDE its ErrorBoundary so
  the crash card is themed too) so they inherit the wrapper's inline
  `accentColor`/`themeVars`. A token rule must declare ONLY custom properties —
  anything else on a page root takes the page path, which applies only to
  `html.pf-app`. The names were not renamed to `--pf-*`: JavaScript reads them
  (CodeMirror's theme, the preview CSS, sonner) and they ARE the host theming API
  (`themeVars`). The unlayered print and coarse-pointer menu rules are hand-scoped
  under `.pf-app` too, or a host that printed had its own dialogs hidden (A100). A
  selector that already names a root is skipped (`html.pf-app::-webkit-scrollbar`
  double-scoped matches nothing). **Anything we attach to `document.body` by hand must
  carry `data-pf-portal`** (the emoji suggestion list, the Find/Replace match ticks) —
  Base UI's own wrapper gives us `data-base-ui-portal` for free. Pinned by
  `src/__tests__/scope-css.test.js` and the browser case `e2e/cases/library.mjs`.
- **npm releases are manual, by an owner** (A006): after the verify gate, `bun run
  build` and the built-package checks, an owner runs `npm publish` from `apps/web`
  (`docs/deployment.md` ▸ Publishing). Claiming the `@perssonify` scope and 2FA are
  owner steps.
  `public/.well-known/security.txt` expires 2027-09-29 and
  `ops-release-config.test.js` goes red a month before, so it gets renewed.
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
- **Public API that does nothing is DEPRECATED LOUDLY, never left looking
  functional** (A105): `setFieldSchemas()` (it wrote a global nothing reads), the
  `fieldSchemas` and `linkResolver` props (use `onLinkClick`), `documents`,
  `onFieldChange`, `onExport`, and the `BlockId`/`FieldBlock`/`TransclusionBlock`
  exports (registered in neither schema). Each is `@deprecated` in JSDoc (it reaches
  the `.d.ts`) and logs ONE console warning per page load, in development only, when
  actually used (`warnDeprecated`, `integration/deprecation.ts`); the extensions are
  re-exported as `.extend()`ed copies that warn in `onBeforeCreate`, so importing
  the package stays silent. Removal would break hosts at compile time. Pinned by
  `lib-api-surface.test.jsx`.
- **The library's externals are DERIVED from `package.json`** (`build/externals.mjs`):
  dependencies and peers are external — the consumer's bundler dedupes them and gets
  patches without a republish — and any devDependency the library imports is
  bundled; only `sonner` (its module-level toast queue would show every toast twice
  beside a host's `<Toaster/>`) and `@base-ui/react` (the stylesheet's portal roots
  are its DOM markers) are bundled ON PURPOSE. `esmExternalRequirePlugin` must OWN
  the list outright: Base UI's bundled `use-sync-external-store` calls
  `require("react")`, which crashed the ES build in every browser bundle, and a
  module listed in both places keeps its raw require. Never set `chunkFileNames` —
  the CJS build then named shared chunks `.js` inside a `"type": "module"` package.
  `publicDir: false`, `sourcemap: 'hidden'` and `"!dist/**/*.map"` keep app assets
  and 45 MB of maps out of the tarball (13 MB → 0.66 MB, A104); `minify: 'oxc'`,
  because Vite 8 honours `'esbuild'` only when esbuild is installed separately and a
  clean install could not build. Every runtime import must be declared (A101,
  `pkg-manifest.test.js`, `pkg-library-build.test.js`); consumers import
  `katex/dist/katex.min.css` themselves.
- **`@tiptap/*` moves in LOCKSTEP at one exact version** (3.31.3): each package
  peers on its siblings at the same version, so a mix made a plain `npm install`
  fail with ERESOLVE (A113). `pkg-lockfile.test.js` requires ONE resolution of
  `@tiptap/core`, `@tiptap/pm`, the prosemirror packages, react, react-dom and katex
  (a `katex` override dedupes mermaid's copy) — the unit suite stays green through a
  duplicated prosemirror-model, so after a dependency change run
  `rm -rf node_modules && bun install --frozen-lockfile` and that test. React is 19 at runtime and in `@types/react`
  (same major, `pkg-manifest.test.js`). The peers are `^18.3.0 || ^19.0.0`, and `tsc`
  and the unit suite must also pass on React 18.3.1 and its types (the local check
  is in `docs/workflows.md`), so code must compile and run on BOTH: a ref whose `.current` you READ is
  `RefObject<T | null>`; a ref prop you only FORWARD to `ref=` is `React.Ref<T>`
  (`RefObject<T | null>` on a `ref=` fails under 18's types, `RefObject<T>` rejects
  19's `useRef<T>(null)`); `MutableRefObject` stays where 18 needs a writable ref;
  and no 19-only API in library code (`use`, `useActionState`, `ref` as a prop,
  `<Context>` as a provider).
- **TypeScript is 6.0, not 7** (A113). typescript-eslint (peer `<6.1.0`) and
  `converter-escape.test.js` need the compiler's JavaScript API, which `typescript@7`
  does not ship. The tree is ready for 7: no `baseUrl`, an explicit `rootDir` in
  `tsconfig.build.json`, and `src/types/side-effect-imports.d.ts` for 6.0's default
  `noUncheckedSideEffectImports` — a new non-`.css` side-effect import needs a line
  there. `bunx -p typescript@7 tsc --noEmit` is clean; see `docs/workflows.md` ▸
  TypeScript 7. Re-checked 1 Oct 2026: typescript-eslint 8.71.0 and its newest canary
  still peer `<6.1.0` — still blocked.
- **`engines.node` is the intersection of the direct dependencies' ranges**
  (`^22.22.2 || ^24.15.0 || >=26.0.0` — jsdom 30 and vitest 5 are the narrowest;
  vitest 5 skips Node 23 and 25). `.node-version` (24) is the Node to develop,
  verify and publish on. `ops-node-range.test.js` reads every installed dependency's
  Node requirement and fails, naming the tool, if our range admits a Node one of
  them refuses.
- **Published declarations are FINISHED by `build/finish-declarations.mjs`** (both
  `build` and `build:types`): no side-effect CSS imports (TS2882 under
  `skipLibCheck: false`), explicit `./x.js` specifiers (every extensionless import
  was TS2834 under node16/nodenext, so the entry points re-exported nothing), no `@/`
  alias, and a `dist/styles.css.d.ts` behind the `./styles.css` export's `types`
  condition. `pkg-declarations.test.js` compiles a `skipLibCheck: false` consumer
  against the built `dist` under `bundler` AND `nodenext`. The bridge's
  `EditorHandle` is written as methods over `unknown`, the integration passes its
  ref without a cast, `EditorViewMode`/`EditorChromeLevel` are shared (exported from
  `./integration`), and the bridge REFUSES an unknown mode or chrome level; the core
  handle is `InternalEditorHandle` in `editor/props.ts`.
- **Held dependencies:** docx stays at 9.7.x until the Word-export parity fixture is
  re-recorded for 9.8 (it writes `w:val="clear"` shading); an `overrides` entry
  keeps lodash-es at ^4.18.1 (mermaid 12's chevrotain pins 4.17.23, which has
  advisories).
- **Never DEFAULT-import an `__esModule` CommonJS external** (every `@tiptap/*`):
  import the named export — `{ StarterKit }`, `{ CodeBlockLowlight }`. The package is
  `"type": "module"`, so Rolldown gives the CJS build Node's interop and the default
  becomes the whole module object; `require("@perssonify/editor")` threw until A113.
  `pkg-cjs-require.test.js` enforces the rule in source and requires the built
  `dist/*.cjs` when a current `dist/` exists — re-run it after `bun run build`, and
  always before `npm publish`.
- **One editor per page** (A106): the stores are module singletons, so a SECOND
  editor mounted while one is running refuses to start. `PerssonifyEditor` is a gate
  (`ui/shared/oneEditorPerPage/index.tsx`) around `PerssonifyEditorInstance`: it claims the page's
  slot (`claimEditorInstance`, documentStore.ts) in a LAYOUT effect before anything
  below it renders and releases it in that effect's cleanup, so a keyed remount never
  shows the refusal (a passive release would). A refused editor renders a message,
  logs `SECOND_EDITOR_ERROR`, touches no store, and takes over when the owner
  unmounts; StrictMode re-claims with the same token (`lib-one-editor.test.jsx`). Remounting IS supported — `initialize()` is
  re-entrant (it re-activates the open document UNHYDRATED for the new editor to
  hydrate), and unmount is a document-leaving path: `releaseEditor`, run from a
  LAYOUT cleanup while both panes still exist, flushes, caches, stashes and releases
  the hydration mark. A remounted editor used to be told it held a document while
  empty, and the first keystroke saved over it (A024). Switching storage needs a
  page load; `clearLocalData()` (library, store entry and editor handle) is the
  logout on a shared device; `storageConfig` `namespace`/`snapshots`/`crashRecovery`
  keep a host's version history and crash stash with its documents (A103).

## Feature architecture notes
- **Markdown flavors/features** live in `src/store/preferences/settings.ts` (persisted under
  `__prefs.markdownFeatures`), consumed by `build-marked.ts`. The Settings panel
  (`settingsSheet/index.tsx`) drives them; `useMarkdownEngine` rebuilds marked on change.
  **Toggling a feature must not strip rich formatting** (A033): the `configVersion`
  effect re-parses the markdown over the rich document ONLY when `computeFidelity`
  says the document is lossless in the current sync mode; otherwise the rich
  content is kept and only the markdown pane is re-projected — the re-parse dropped
  alignment always, and colour/highlight/font in Clean mode. **The curly-brace
  syntax (`{color=red}…{/color}`) is OFF by default** in all three places (the
  preprocessor default, the settings default, the engine option): it defaulted ON,
  undocumented, so `## Returns {Promise}` rendered as `## Returns` (A039). Turned on,
  a group renders only if EVERY key is known and every value validates; anything
  else stays exactly as written, and escaped braces are honoured.
- **Math** (`$…$`/`$$…$$`) → `math-marked.ts` emits data-attribute placeholders →
  TipTap `MathNodes.tsx` renders KaTeX (lazy) → turndown rules restore the source.
  **Insertion uses an equation dialog with a live KaTeX preview** (`dialogs/index.tsx`
  `EquationDialog`, wired through `useDialog().equation` — a promise-based method on
  the shared `DialogApi` mirroring `prompt`). Insert ▸ Formula/Inline (MenuBar) and
  the toolbar Sigma menu call `equation(...)` then `dispatch("insertMathBlock"/
  "insertMathInline", latex)` — NOT the old bare `prompt()`. Existing nodes still edit
  in place via the `MathNodes` node view's inline `math-source-input` (unchanged). The
  dialog lazy-imports KaTeX the same way as the node view; ⌘/Ctrl+Enter submits (plain
  Enter is a newline for multi-line block math). **Delimiters follow Pandoc**
  (`matchInlineMath`/`matchBlockMath`, exported so the escaper uses the SAME rules):
  inline `$` must be followed by a non-space and closed after a non-space, on one
  line, so `$5 and $10` stays prose; the "no digit after the closer" guard applies
  only to digit-leading (money-like) content, or `$x$1` — how the serializer writes
  a formula followed by a digit — fell apart on its next trip. Block `$$` must START
  a line and its closer END one; a mid-line `$$…$$` stays literal (it split the
  paragraph into three blocks, A049). `mathBlock.start()` looks no further than the
  current paragraph — it scanned the rest of the document per paragraph (A083).
- **No lookbehind regex LITERAL may reach the entry chunk** (A097). A lookbehind in
  a literal is a parse-time SyntaxError on Safari/iOS before 16.4: one assertion
  blanked the whole app there. `converter-escape.test.js` asks the TypeScript parser
  for real regex literals in the entry chunk's modules; where a lookbehind is
  needed, compile it from a string at runtime with a fallback (`emphasisPasses`,
  md-format-utils, pinned equal by `formatting-clear-fallback.test.js`). The floor is declared (next bullet).
- **The browser floor is an inline script that must stay FIRST** (A097): Safari/iOS
  16.4, Chrome/Edge 111, Firefox 128. It is ES5 and byte-identical in `index.html`
  and `embed.html`, after `<title>` and before the watchdog and Vite's module entry.
  It detects `CSS.registerProperty`, `color-mix()` and lookbehind (compiled from a
  string) and, below the floor, writes a message and then `<plaintext>`, so nothing
  after it is parsed and nothing stored is touched; the watchdog stands down on
  `__PF_UNSUPPORTED`. Editing it changes its CSP hash in `vercel.json`. Pinned by
  `ops-browser-floor.test.js` and `e2e/cases/floor.mjs` (all engines).
- **marked is 18.x.** Renderer and tokenizer overrides take ONE token object and are
  typed `RendererObject` / `TokenizerObject` — never cast `as never`. The task-list
  checkbox is a TOKEN (inside the first paragraph of a loose item): the `checkbox()`
  override returns "", and the Word export skips `checkbox` tokens. A mid-line
  `$$…$$` is a `mathInline` token with `literal: true`, never a `text` token.
  `emStrongMaskFix` works around an upstream bug (emphasis after a code span ending
  in a backslash) and is installed by `buildMarked` AND the Word export; it mirrors
  marked internals (reference-link masking, the private `linkInText`), so if marked
  fixes the bug upstream, delete the module and keep the parity cases. The Word
  export uses its OWN `Marked` instance, never the global `marked`. `marked-emoji`
  stays on 2.x deliberately (its 3.x shortcode matching changed case sensitivity).
- **Mermaid/ABC** render in the code-block node view (`diagramPreview/index.tsx`, lazy),
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
  registered in BOTH `tiptapPane/index.tsx` AND `serialize-doc.ts` `SERIALIZE_EXTENSIONS`.
  There is **NO preprocessor pass** — marked's gfm list tokenizer detects tasks
  natively, and `build-marked.ts` **overrides the RENDERER** (gated on `taskLists` +
  gfm) to emit `<ul data-type="taskList"><li data-type="taskItem" data-checked="…">…`
  (suppressing the default disabled `<input>` via a `checkbox() → ""` override) — this
  preserves inline markdown INSIDE each item, which a raw-HTML preprocessor would have
  lost. The old `preprocessor.ts` `0d` checkbox pass was REMOVED (it stripped `[ ]`
  before marked saw it). Turndown's `taskListItem` rule reads the authoritative
  `data-checked` (fallback: `input[type=checkbox]`) and indents continuation lines to
  the CONTENT column (2), not the printed marker width of `- [ ] ` (6) — at 6, a nested
  list or code block became a lazy continuation and one markdown edit turned it into
  literal text (A038); it must stay AFTER `tightListItem` (LIFO). **NESTING (do NOT regress):** a
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
- **Right-to-left text is VIEW-ONLY** (A099): `BidiAuto` (rich pane) gives every text
  block `dir="auto"` through NODE VIEWS for paragraph, heading, listItem, blockquote,
  callout, table cells and summary, and task items through `TaskItemAutoDir` (TipTap's
  own node view with the attribute added — a plugin's node view cannot replace it;
  NOT `HTMLAttributes`, which would write `dir` into getHTML()). It holds NO
  decorations — never go back to one per block: mapping and handing them down is
  quadratic (one keystroke at 1.6 MB: 714 ms → 8 ms, A083), and so is building the
  set (the task-item decorations cost 1.5 s at 4x CPU on every 4 MB open and large
  projection). An extension that adds its own node view for one of those types must
  take the `dir` over. And
  `extensions/cm-bidi.ts` does the same per visible CodeMirror line with
  `perLineTextDirection`. Do NOT use TipTap's `textDirection` option: it adds a
  `dir` attr to every node of the canonical JSON — rewriting every stored document
  to say what its text already says. Paste keeps `dir`/`lang`. HTML and print export
  declare no `lang`: what is exported is the DOCUMENT, whose language the app does
  not know.
- **Interface strings come from `src/i18n` (A099).** In a component: `const t = useT()`,
  and list `t` in the dependencies of any memo, callback or effect that uses it.
  Outside a component: the global `t` (stores import `../i18n/core`, which has no
  React). Module-level label tables are getters (`get label() { return t("…") }`) so
  they are read at render. A sentence is ONE message with `{vars}` and `t.rich` markup
  — never glued from several keys — and every message with a count is a plural
  object. Never translate DATA: stored titles such as "Untitled" or a new folder's
  name, ids, `data-*` hooks, URL parameters, file names, or anything written into a
  document. English is the source of truth (`en/<area>.ts`, keys prefixed with the
  area); `i18n-scanner` fails on a new hard-coded interface literal, and
  `i18n-catalog` / `i18n-render` hold the rest. **The scanner cannot see a string
  parked in a module-level object, a helper's return value or markup built in a
  template** (the stored-image strings arrived that way and passed it) — route those
  through `t()` yourself, and build anything that holds text when it is USED, never
  as a load-time constant, or it stays in the language the page loaded in. The Help and About prose is CONTENT
  in per-locale maps (`HELP_CONTENT`, `ABOUT_CONTENT`), not catalog keys. The app
  shell and the embed set `<html lang dir>`; the library never does. `?lang=` is
  session-only; the `en-XA` pseudo-locale is development-only. See `docs/i18n.md`.
- **MD pane list wrap hangs to the item text** (`codeMirrorPane/index.tsx`
  `listHangingIndent` ViewPlugin): with line wrapping on, each list line gets
  `text-indent:-Nch; padding-left:Nch` where N = the content offset (leading
  whitespace + marker + space via `LIST_MARKER`), so wrapped continuation lines
  align under the item text, not the bullet. Nested lists indent further
  automatically.

## Verify before you commit
```
bun install --frozen-lockfile
bunx tsc --noEmit              # type gate (must be clean)
bun run lint                   # ESLint: 0 errors (warnings are allowed, not welcome)
bun run test                   # vitest (must pass)
node scripts/doc-anchors.mjs   # docs → src line anchors (--fix repairs drift)
bun run build:app              # app build + dist-app/third-party-licenses.txt
bun run build                  # library build (dist/)
bun run build:embed            # iframe embed build (dist-embed/)
bun run e2e                    # every browser suite but perf (see e2e/README.md)
bun run e2e:csp                # …or one: the build under the ENFORCED CSP
bun run e2e:pwa                # …offline after one visit; updates never force a reload
```
There is no CI: run all of the above before opening a PR to `main` and again
before merging it. The checks that need a build skip without one, so after the
builds re-run `bunx vitest run src/__tests__/ops-vercel-headers.test.js
src/__tests__/pkg-cjs-require.test.js src/__tests__/pkg-declarations.test.js`
(the CSP hashes against the BUILT `index.html`; the built library). **Nothing
gates a deploy**: Vercel deploys `main` on its own (`docs/deployment.md`).

**`build:app` also writes the third-party licence notice**, read from the build's
HIDDEN sourcemaps (`scripts/third-party-licenses.mjs` → `dist-app/third-party-licenses.txt`;
it refuses to run without maps), and **Vercel strips the maps AFTERWARDS** —
the root `vercel.json`'s `web` `buildCommand` is
`bun run build:app:accounts && node scripts/strip-sourcemaps.mjs`,
so the order is build → notice → strip, and the maps land in the gitignored
`dist-app-sourcemaps/` (deploy 35 MB → 9.4 MB, A016). Moving the maps inside the
build would break the notice (A077). When dependencies change, refresh the
committed copy with `node scripts/third-party-licenses.mjs --public`; the About
page's credits (`src/data/credits.ts`) are pinned to it by
`g4-third-party-licenses.test.js`.

**`e2e/` is where the things jsdom cannot see are tested** — real IME
composition through CDP, real IndexedDB, quota exhaustion, blocked storage, a
second tab, coarse pointers, duration, the service worker (offline and updates),
the CSP enforced, and the published library on a host page. Chromium runs every suite; harness, surfaces, surfaces-deep, dataloss and floor
also run on Firefox and WebKit (`E2E_BROWSER`; `run.mjs` lists them). An engine difference is a harness
fix, a `rep.skip` (the capability is missing; `open({cdp|throttle})` throws off
Chromium) or a strict `rep.xfail` naming a reported defect — never a loosened check.
`ENGINE_NOISE` holds the exact non-defect console messages, and `seed()` writes from
`BLANK_PATH` with the stores cleared, never from the app's page (A100). Every guard in it was
mutation-tested (revert the fix, confirm the case goes red); a case that cannot
fail is worse than no case. Timing is measured (`e2e:perf`) but never asserted
— this container's wall-clock varies by more than 50% run to run.
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
panel shares — toolbar/index.tsx claimed otherwise until 1.76.0, a comment stranded
by the WorkspacePanel refactor), and the panel's width is re-clamped against
the viewport, so it cannot be relied on to move a board across a threshold.

### Testing invariants (they are as load-bearing as the code)
- **A test that cannot fail is worse than no test.** Mutation-test every guard:
  revert the fix, confirm the case goes red, restore. Four cases in this suite
  were found vacuous that way, and `suppression.test.jsx` had THIRTEEN describing
  a `suppressNextUpdate` flag `TiptapPane` has never had. Where a guard is
  genuinely unobservable (a memo that only changes a hit rate, an unreachable
  belt-and-braces check), say so in a comment instead of writing a case that
  passes either way.
- **Vitest collects `*.test.{js,jsx}` ONLY** (`vitest.config.js`). A `.ts` test
  is silently ignored; a test that renders JSX must be `.jsx`.
- **The suite must be deterministic** (A107). It exited 1 in about a third of runs
  with every test green: TipTap's `focus()` scrolls into view on the NEXT frame, and
  when that frame fired after a file had finished, ProseMirror called
  `Range#getClientRects` — which jsdom lacks — as an unowned error.
  `src/__tests__/setup.js` gives `Range` the empty geometry jsdom already gives
  elements (`testenv-geometry.test.jsx` reproduces the race). A test with cold
  dynamic imports states its own budget rather than inheriting 5s, and a component
  using `useIsMobile` needs `window.matchMedia` stubbed (jsdom has none). Vitest 5:
  `clearMocks: false` is DELIBERATE — suites create spies once and 147
  `not.toHaveBeenCalled()` checks rely on call history. `seededAdapter` keeps a
  fixture's own `updated` (re-stamping it made which document opened at boot a
  same-millisecond race — the `behave-editor-surfaces` flake), and a `beforeAll`
  that clicks a library row waits for the row. In e2e, rich-pane typing after a click
  and Ctrl+End waits for ProseMirror's selection (`richCaretToEnd`): WebKit fired
  `selectionchange` late, text inherited the bold it was clicked into, and ⌘B then
  REMOVED bold.
- **Line endings are LF everywhere** (`.gitattributes` `* text=auto eol=lf`).
  Source-reading tests match call sites such as `"<MenuBar\n"`, so a CRLF checkout
  (`core.autocrlf=true` on Windows) failed `sync-perf.test.js` on untouched code.
- **Lint is ESLint with the React hook rules** (`eslint.config.js`, A109):
  `rules-of-hooks` is an ERROR; `exhaustive-deps` warns, and a DELIBERATE omission
  (the sync engine's empty-dependency `force*` callbacks) gets an
  `eslint-disable-next-line` with its reason — a disable that suppresses nothing is
  reported. `bun run test:coverage` measures ALL of `src`: 81.8% of lines after the
  behavioural suites (71.2% before them, A108).
- **`noImplicitAny` is on** (A109). An untyped package gets a declaration in
  `src/types/` (`turndown.d.ts`); delete it if `@types/turndown` is ever added.
- **The `behave-*` suites mount the REAL editor once per file** (`behave-harness.jsx`,
  A108), import `@testing-library/react/pure` (the default entry unmounts after every
  case), run each file as one ordered journey, and judge outcomes by the adapter,
  both panes, toasts and downloads. A path that mounts the editor and then waits for
  it cannot finish inside `act()`, which holds renders until the scope ends — call
  it through `outsideAct()`. In jsdom a Base UI menu returns focus to its trigger
  synchronously, which blurs (and commits) a rename box opened from a dropdown item:
  drive rename by F2 or the context menu. jsdom has no `DragEvent`, so
  testing-library drops `clientY`; set it on the event (`dragAt`). The plain
  `MemoryStorageAdapter` drops preferences; use `PrefsMemoryAdapter`.
- **The marked parity fixture pins md→html and the Word export**
  (`marked-parity`, 747 KB). A deliberate change to the preprocessor, the marked
  config, the post-pass or the schema turns it red BY DESIGN: re-record with
  `MARKED_PARITY_UPDATE=1`, then write every empty `why`. An `editor: "same"`
  claim is verified through TipTap.
- **`fake-indexeddb` (devDependency) is how the persistence layer is tested.**
  `import "fake-indexeddb/auto"` at the top of the file gives real IDB with real
  transaction auto-commit semantics. The snapshot store's `_resetForTests()`
  forces its in-memory fallback by default; pass **`{ useIndexedDB: true }`** to
  drive the database path. Do not `deleteDatabase` between cases: the store now
  closes on `versionchange` and silently falls back to its memory ring, so the
  rest of the file would stop exercising IndexedDB at all until the next
  `_resetForTests({ useIndexedDB: true })`. Clear the object store through a second
  connection instead.
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
  slow" on a slower machine — it reports the same FAIL a real regression does.
  A fixed sleep is correct for exactly one thing: a NEGATIVE assertion, where
  there is nothing to poll for.
- **Documentation anchors are gated.** `#L123` links from `docs/` into `src/`
  are checked by `doc-anchors.test.js`; `node scripts/doc-anchors.mjs --fix`
  repairs them. A symbol that is only MENTIONED in the target file gets no line
  number at all — an arbitrary first occurrence is false precision.
