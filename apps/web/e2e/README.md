# `e2e/` — the browser campaign

Unit tests run in jsdom against mock pane handles. That leaves a class of
defect they structurally cannot see, and this codebase has shipped several of
them:

- **Real IME / voice-dictation composition.** `sync-engine.test.js` toggles a
  boolean on a mock. A genuine composition (CDP `Input.imeSetComposition`)
  behaves differently — for instance an undo dispatched during one destroys it
  *without* a `compositionend`, leaving `view.composing` stuck true forever.
  Three reproduced data-loss defects lived here.
- **Real IndexedDB**, quota exhaustion, blocked storage, a second tab.
- **Layout that is measured, not declared** — the toolbar compacts on its OWN
  width, the panes stack by the viewport's width AND height
  (`src/ui/panes/editorPanes/split-layout.ts`), `pointer-coarse:` rules need touch emulation.
- **Duration.** Listener churn and uncancelled timers only show up over time.

## Running it

```
bun run build:app          # the suites run against a production build
bun run e2e                # every suite except perf
bun run e2e:smoke          # tier 1 — surfaces
bun run e2e:deep           # the surfaces nothing else opens (settings, tray, pages, tour)
bun run e2e:dataloss       # the data-loss sequences: two real tabs, real IndexedDB
bun run e2e:journeys       # tier 3 — user simulation, incl. real composition
bun run e2e:faults         # tier 4 — quota, blocked storage, multi-tab
bun run e2e:stress         # tier 2 — scale and duration (slow)
bun run e2e:harness        # the rig checking itself (run this first when a case looks wrong)
bun run e2e:library        # the published stylesheet on a host page (needs `bun run build`)
bun run e2e:bridge         # the embed's host bridge from a second origin (needs build:embed)
bun run e2e:csp            # vercel.json's CSP ENFORCED while every renderer runs
bun run e2e:pwa            # offline after one visit; updates that never force-reload a tab
bun run e2e:perf           # measurement only, never asserted
node e2e/run.mjs floor     # the browser floor: below it a message, no app code, nothing touched
node e2e/run.mjs perf-map  # measurement only: the relationship map at library scale

E2E_BROWSER=firefox node e2e/run.mjs surfaces   # any suite on Firefox or WebKit — see "Engines"
```

`run.mjs` refuses to start without `dist-app/index.html`. `library` and
`bridge` do not: without `dist/` or `dist-embed/` they log a note, run zero
checks and exit green — build first, and read the output.

There is no CI: run the campaign by hand before opening a pull request and
again before merging it. Build all three outputs first; `bun run e2e` then runs
every suite but perf on Chromium, one after another. Run the cross-engine suites
(harness, surfaces, surfaces-deep, dataloss, floor) again on Firefox and on
WebKit with `E2E_BROWSER` (see "Engines").

The browsers come from `playwright-core`: `bunx playwright-core install
chromium` (add `firefox webkit` for the other engines) if you do not have them;
`E2E_CHROME=/path/to/chrome` overrides Chromium.

## Engines

`E2E_BROWSER=chromium|firefox|webkit` picks the engine (Chromium by default).
`run.mjs` lists, per suite, the engines it has been RUN green on; asked to run
a suite on any other engine, it prints `SKIP <suite> [engine] — reason` rather
than running it, because a failure there would say more about the harness than
about the app. Today harness, surfaces, surfaces-deep, dataloss and floor run on
all three; journeys needs Chromium (its real IME composition is Chromium's
DevTools protocol), and the rest have simply not been run elsewhere yet.

Inside a suite an engine difference is handled one of three ways, never by
quietly weakening a check:

- **A harness fix** — the same assertion, reached another way. Firefox leaves a
  synthetic `ClipboardEvent`'s `clipboardData` empty (0 bytes where Chromium and
  WebKit carry the text), so pastes go through `pasteText`. Reduced motion is
  `page.emulateMedia({ reducedMotion })`, not a raw CDP call. WebKit leaves links
  out of the Tab order by default (Safari's "Press Tab to highlight each item";
  Playwright's WebKit reaches them with neither Tab nor Alt+Tab), so there the
  skip-link case asserts what the link is for — first in the focus order, and
  it lands in the editor — instead of "the first Tab stop". WebKit fires
  `selectionchange` after the key press has resolved, and a click's own
  selection update can land after a Ctrl+End sent right behind it, so text
  typed at once went where the CLICK put the caret (inheriting its bold): the
  surfaces suite now waits until ProseMirror's selection is at the end
  (`richCaretToEnd`) before typing.
- **`rep.skip(name, reason)`** — the engine lacks the capability: the memory
  sheet's heap gauge reads `performance.memory`, which only Chromium has.
  `requireChromium()` does the same for blocks that need CDP, and `open({ cdp })`
  or `open({ throttle })` throws on another engine, so a forgotten guard fails
  loudly instead of passing without the thing it was testing.
- **`rep.xfail(name, ok, reason)`** — a check that fails for a REPORTED app
  defect. It prints XFAIL and does not count as a failure, and it FAILS the
  moment it passes, so the marker goes out with the fix. One today: under forced
  colours, the focus ring on Firefox and WebKit is not Highlight, because
  `styles.css`'s forced-colours `outline-color: Highlight` restatement is
  `(0,1,0)` against ring rules of `(0,2,0)` and never applies (Chromium forces
  ring colours on its own). Measured in `probes/forced-colors-ring.mjs`.

Console messages an engine prints that are not defects are listed, exactly, in
`ENGINE_NOISE` (`lib.mjs`), each with its reason: Firefox reports a font load a
navigation cancelled; WebKit reports the viewport meta's deliberate
`interactive-widget` key, and a service-worker registration cancelled by
leaving the page.

`seed` writes from a blank page on the app's origin (`BLANK_PATH`), never from
the app's own page: from there it raced the app's first boot, which could seed
the starter documents around the case's own (on Chromium the seed usually
landed first; on Firefox the app usually did). Leaving a booting app was worse on Firefox: it rejects
the page's in-flight lazy imports, and the app takes that for a stale deploy and
RELOADS, cancelling the navigation — an app defect, measured in
`probes/leave-during-lazy-chunk.mjs` (6 of 12 navigations away in the first
~0.7 s after `load` on Firefox, none on Chromium or WebKit). The cross-engine
suites therefore never boot the app before seeding.

## Layout

| File | What it is |
|---|---|
| `lib.mjs` | the rig: the engine (`E2E_BROWSER`), static server, page, seeding, pane accessors, `pasteText`, CDP composition helpers, reporter (`check`, `skip`, `xfail`) |
| `docs.mjs` | canonical (ProseMirror JSON) builders for the stress shapes |
| `run.mjs` | runs each suite in its own process so one crash cannot take the rest down |
| `cases/surfaces.mjs` | tier 1 — blast radius |
| `cases/surfaces-deep.mjs` | the surfaces no other suite opens: Settings, Version history, the bottom tray, `/about` and `/help`, the guided tour, the Outline tab |
| `cases/floor.mjs` | the browser floor (A097) in a real parser: with `CSS.registerProperty` removed before any page script runs, the message shows, the module script is swallowed as text and never runs, the boot watchdog does nothing, and the stored document, the caches and the service worker survive; back at the floor, the app opens that document. The embed half needs `dist-embed/` |
| `cases/dataloss.mjs` | the data-loss sequences with two real tabs and real IndexedDB: live sync between tabs (a save in one reaches the other's panes and library; unsaved work in the other parks a conflict with Keep mine / Use theirs / Save mine as a copy, each checked on disk and in Version history; the open document deleted in the other tab), then the conflicted-draft rebase (F003), closing a conflicted document (F001) and reloading after a conflict (A018) |
| `cases/stress.mjs` | tier 2 — scale and duration |
| `cases/journeys.mjs` | tier 3 — user simulation |
| `cases/faults.mjs` | tier 4 — fault injection |
| `cases/perf.mjs` | measurement, not a gate. By default typing in the markdown pane of 1/10/50 KB prose; `PANE=rich` types in the RICH pane of a 1.6 MB and a 4 MB mixed document (`docs.mjs` `mixedDoc`) and reports keystroke → markdown pane and the longest task; `PANE=md` types in the markdown pane of the same documents, reporting the first keystroke apart from the rest, and the long tasks while the markdown→rich model is prepared after the load (`prepLongestMs`/`prepBlockingMs`, A083). Arguments reach the case only when it is run directly: `node e2e/cases/perf.mjs <label> [sizeKb…]` |
| `cases/perf-map.mjs` | measurement, not a gate: the relationship map on a generated library under CPU throttling (A088) — first frame, settle, long tasks and frames (attributed to the layout loop vs React), wheel-zoom latency while the layout settles and once it rests; `PROFILE=1` / `PROFILE_ZOOM=1` print sourcemapped CPU profiles, `DUMP=1` the timelines |
| `map-library.mjs` | a deterministic library shaped like a real one — folders of skewed sizes, hub notes, unlinked notes, broken links — for the map's scale cases |
| `map-measure.mjs` | what the map has drawn, measured in the page: every note's dot (from `.pf-node-dot` elements, or a large map's batched `.pf-node-dots` paths), and the "nothing drawn over text" counts CLAUDE.md claims |
| `fixtures/` | host pages the library and bridge suites are driven from |
| `cases/harness.mjs` | the rig checking ITSELF — the pane readers against a document of known lines |
| `cases/library.mjs` | the published stylesheet on a page that is not ours (`fixtures/host-page.html`, needs `dist/`): the host's elements, its own tokens on `:root`/`.dark` and its scrollbar survive; the editor subtree, the integration wrapper's inline accent and a portalled surface still resolve the editor's tokens; the theme switch closest to the editor wins |
| `cases/bridge.mjs` | the embed's host bridge, driven from a second origin (needs `dist-embed/`) |
| `cases/csp.mjs` | the production build served with vercel.json's headers, the report-only CSP switched to ENFORCING; KaTeX, Mermaid, abcjs, a data: image, Find, the map, Cards, Word export and /help must raise zero violations |
| `cases/pwa.mjs` | the service worker: one online visit, then the network is killed and every lazy feature is used for the first time offline; then a byte-changed `sw.js` — the prompt appears, nothing reloads by itself, a dirty second tab is told rather than reloaded |
| `renderers.mjs` | the probe document and actions `csp` and `pwa` share (a helper, not a case) |
| `probes/` | one-off diagnostics kept because they are the evidence behind a fix (or, like `forced-colors-ring.mjs` and `leave-during-lazy-chunk.mjs`, behind a reported defect). None is wired into `run.mjs`; run one by hand with `node e2e/probes/<name>.mjs` against a production build (`bun run build:app` first; `embed-boot.mjs` needs `build:embed`). Two cover the audit fixes: `g2-audit-fixes.mjs` (AltGr typing in both panes, ⌘B in the Cards composer, broken-link marking, the Find regex Worker timing out, map wheel-zoom on a later open, Escape on a card's delete confirmation) and `g4-durability-trust.mjs` (the wiped-library boot path, the "Not saving" banner, the Version history delete confirm, the backup record, remote images and Referer under the image CSP, the relay consent prompt, the old-origin banner, no Admin/ads in production, the licence notice) Two are the evidence for the map's scale work (A088): `map-overlap.mjs` re-measures CLAUDE.md's "nothing drawn over text" counts across workspace sizes, desktop and phone, at fit / 4 zoom-outs / 8 zoom-ins, and fingerprints everything drawn so two builds can be compared; `map-trace.mjs` splits a map open (or, with `ZOOM=1`, a zoom) into script, style, layout and paint from a Chrome trace. `autosave-cost.mjs` is the evidence for the large-document save work (A083): it types in a 4 MB document under a CPU slowdown and reports the long tasks in the window where each autosave runs (`SHIM=1` was the experiment behind `ReactSelectionShield`; `PROFILE=<file>` writes a CPU profile) |

## What this campaign does NOT cover

Stated plainly, because "the browser tiers are green" is worth nothing if the
reader has to guess what was in them. These are known gaps, not oversights —
several were in the plan this campaign was built from and were not written.

**Surfaces never driven at all**
- **Find & Replace under load** — Replace All over a large document with a scope
  filter active is the mutation with the widest blast radius in the app. The
  `csp` and `pwa` suites only open the panel.
- The **library's JavaScript** on a host page. `cases/library.mjs` covers the
  published STYLESHEET (the claim that importing it does not restyle a host
  app); mounting the built component into a consumer's bundle is not driven.

**Now covered that previously was not**
- **Settings**, **Version history**, the **bottom tray**, the **interior pages**
  (`/about`, `/help`), the **guided tour** and the **Outline tab** — all six of
  the surfaces this list used to name, in `cases/surfaces-deep.mjs`. The bar is
  deliberately modest (open it, prove it rendered something real, prove the
  console stayed clean), because the console check is what turns it into a
  regression net for the rest of the app rather than a screenshot.
  Two readers in it had to be replaced before it meant anything: "the Document
  Links tab exists" was true against a tray that had never opened (the tray stays
  MOUNTED while collapsed since 1.75.0 — it animates `grid-template-rows`, so the
  state has to be read off that, not off presence), and the Help page was keyed on
  the text "Keyboard shortcuts", which is also an item in the Help MENU, so it
  matched while the menu was still open and reported an `inert`/focus defect the
  app does not have.
- **Reduced motion**, emulated through CDP: the graph's force simulation is the
  one piece of motion no stylesheet can reach (it advances node positions from
  rAF), so the case asserts the map opens already settled. It samples the node
  groups' `transform`, not the circles' `cx`/`cy` — every dot is drawn at 0,0
  and positioned by its parent, so a cx/cy sample would compare "0,0" with
  "0,0" and pass whatever the simulation did.

- **Keyboard and assistive-tech plumbing** (`cases/surfaces.mjs`, the
  A090-A100 block): the skip link is the first Tab stop and lands in the
  editor; the toolbar and the folder tree are each ONE tab stop and walk on the
  arrows; the library precedes `<main>` in the DOM; a keyboard-focused control
  shows the 2px `--focus-ring` outline (read AFTER the Button's
  `transition-all` settles — `probes/focus-ring-transition.mjs` is why);
  forced colours keep the pressed state and the ring; print hides the chrome
  and prints the rich pane unclipped; a 342×192 viewport (1366×768 at 400%)
  gives the editor a full viewport and scrolls to the status bar; a 667×375
  landscape phone keeps the panes side by side. `cases/surfaces-deep.mjs` also
  asserts the collapsed tray is `inert`. Each was mutation-tested against a
  build with its fix reverted.

- **Renaming a heading** (`cases/journeys.mjs`, R1): real keystrokes rename a
  heading in each pane, nothing is offered while the caret stays in it, the
  arrow key that leaves it brings the offer, and Update rewrites the other note
  on disk. The markdown pane's half is the one jsdom cannot reach (its caret is
  judged by CodeMirror's parse tree); it was mutation-tested against a build
  with that detection disabled. NOT driven in a browser: the offer on the
  leaving paths, a real composition during the check, a mouse click as the way
  out — those are in `behave-heading-renames.test.jsx` only.

**Firefox and WebKit — five suites, not a device.** Harness, surfaces,
surfaces-deep, dataloss and floor run on all three engines.
Journeys (real IME composition is Chromium's DevTools protocol), faults,
stress, library, bridge, csp and pwa run on Chromium only. And WebKit here is
Playwright's build on a desktop, not Safari on an iPhone: the iOS-specific paths
(the `pagehide` stash when a tab is swiped away, safe areas on a notched device,
storage eviction and the seven-day cap, the install tip) still have no
real-device proof.

**Hand-run only.** The two audit probes in `probes/` cover behaviour that no
suite asserts. Nothing runs them automatically, so a regression there shows up
only when someone runs them.

**Now reproduced in a browser that previously was not**
- **Live sync between tabs** (`src/store/persistence/tab-sync.ts`, `src/editor/useTabSync.ts`):
  two tabs of one real browser over one real IndexedDB and a real
  BroadcastChannel. A save in tab A reaches clean tab B's panes and library
  without a reload; B with unsaved typing parks the conflict and each of its
  three choices is checked on disk AND in the Version history database; the
  document open in B deleted from A is never written back and is kept under a
  new id. `faults.mjs`'s multi-tab case now asserts the sequential edit that
  used to conflict is saved on top instead. NOT driven in a browser: the
  storage-event fallback (every engine here has BroadcastChannel), a tab
  restored from the back/forward cache (it missed the messages sent while it
  was frozen; the save guard's own read still refuses an overwrite), and the
  reload deferred by a live composition — `behave-tab-sync.test.jsx` covers
  that one against the real editor.
- The **conflicted-draft rebase** and the **silent close of a conflicted
  document** (both fixed in 1.77.0). `faults.mjs` drove two tabs into a conflict
  and stopped there; `cases/dataloss.mjs` continues — it leaves the document
  through the library list and returns, then types, and asserts the other tab's
  work is still on disk; and it closes a conflicted document and asserts the app
  ASKS. Mutation-tested against a deliberately reverted build, where
  `TAB-B-EDIT-AFTER-RETURN` really is written over the other tab's text and the
  close prompt never appears.
- The **reload after a conflict** (audit A018): the conflicted tab reloads, as
  the conflict message tells it to, and `cases/dataloss.mjs` asserts its own
  text survives on screen while the other tab's work stays on disk and the
  conflict is still reported. Mutation-tested against a build with the stash's
  base-revision restore removed: `TAB-B-EDIT` replaces the other tab's text.
- **NOT reproduced here: the draft-retirement race (F002).** It needs a save
  whose `storage.list()` is still pending while a switch caches a newer draft,
  and holding an IndexedDB call open from outside the page would make it a test
  of the injection rather than of the app. It stays unit-tested
  (`draft-retirement.test.js`).

**Races and failure modes not reproduced**
- A **close or delete racing a document switch** (the generation guards are
  unit-tested against fakes, not against a real slow IndexedDB read).
- An **archive import with a click mid-loop**. Imports are converted
  headlessly and never activated mid-loop (A031); that is tested against the
  real editor in jsdom, not in a browser.
- The window **immediately after `compositionend`**, and the **emoji suggestion
  list clicked mid-composition**.
- **Slow or failing network** (a network that answers, slowly or with errors —
  `pwa.mjs` covers only a network that is GONE), **corrupt stored JSON**.
- **Offline / PWA — now covered by `cases/pwa.mjs`, with these limits:** it
  cannot flip `navigator.onLine` reliably (Playwright's offline emulation leaves
  it `true` in a reloaded, worker-controlled page), so the "never reload while
  offline" gates are covered by unit tests only (`ops-app-health`,
  `ops-sw-update`); the automatic reload of a clean BACKGROUND tab after another
  tab applied an update is unit-tested only (visibility is not emulated); and a
  password-protected ZIP (zip.js's WebAssembly/worker path) is exercised by
  neither `pwa.mjs` nor `csp.mjs`.

**Scaled down from what was planned**
- Continuous typing runs are ~480 characters, not 2000; the duration case is 8
  rounds, not 20 minutes; the largest library you edit and switch in is 120
  documents, not 200 (the relationship map is opened on 2,000); there is no
  200 KB document and no math-heavy document.
- **Breakpoints** now assert five real switches, not two. The menu collapsing to
  ☰ and the panes stacking (both at 768px wide, on viewports tall enough to
  stack; the height half of the rule is the 667×375 landscape case above) are
  read off the separator's own `aria-orientation`; the map's details rail is
  read as whether it docks to the
  RIGHT of the canvas or UNDER it; and toolbar compaction and the cards column
  count are read at the boundary that actually decides them.
  Those last two key off an ELEMENT's measured box, not the window's, which is
  why they are ResizeObservers and not media queries — and it is why resizing the
  window cannot tell a correct implementation from a broken one. Both are driven
  by constraining the editor root in a wide window instead, which is the
  library-mount geometry. Mutation-testing found the first attempt at the cards
  case vacuous twice over: the seeded library is three documents, so a board wide
  enough for four columns can only show three, and opening the workspace panel
  left a 1200px board that is in the same column band as the 1440px window.
- **Touch** asserts a minimum target size instead of printing a count of
  offenders — WCAG 2.5.8's 24px, measured as the HIT AREA rather than the box,
  because most of the `pointer-coarse:` work in this app grows a `::before` and
  deliberately leaves the element's own geometry alone. It also asserts the pane
  divider specifically: its hit area is ≥24px while its own box stays thin (the
  divider maths depend on that), and it owns the gesture (`touch-action: none`).
  Writing the assertion found the one remaining offender — the diagram frame's
  "Edit source" chip, 58x21 — and it is fixed rather than excepted.

## Rules

- **A case that cannot fail is worse than no case.** Every guard added here was
  mutation-tested: the fix was reverted and the case confirmed to go red.
- **A wrong READER is worse than a missing case.** Two of the pane readers here
  have been wrong — one under-read a virtualised CodeMirror (969 of 61,000
  characters), and its replacement over-read by recording the same line a dozen
  times. `harness.mjs` measures both readers against a document whose every line
  is known, so the tiers above them mean something. It does not cover the reader
  completely: its cases hold the de-duplication tolerance but not the warm-up
  sweep, which only the stress tier's sustained-typing case fails without. If you
  change `mdText`, run `e2e:harness` **and** `e2e:stress`.
- **Assert content, not timing.** This container's wall-clock varies by more
  than 50% run to run. `perf.mjs` compares two builds under identical
  conditions; it is not a gate.
- **Console errors are failures.** Every case asserts `errors` stayed empty, so
  a regression in an unrelated surface still fails the run. The only exceptions
  are `ENGINE_NOISE`'s exact, justified patterns.
- **An engine difference is a harness fix, a SKIP or an XFAIL** (see
  "Engines") — never a check quietly loosened until it passes.
- `probes/` is where a hypothesis is tested before it becomes a case. Keep the
  probe when it is the evidence for a fix, and name it where the fix is
  documented — most of the 28 are not named anywhere else yet.
