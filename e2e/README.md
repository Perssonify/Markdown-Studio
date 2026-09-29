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
  width, the panes stack on `matchMedia`, `pointer-coarse:` rules need touch
  emulation.
- **Duration.** Listener churn and uncancelled timers only show up over time.

## Running it

```
bun run build:app          # the suites run against a production build
bun run e2e                # every suite except perf
bun run e2e:smoke          # tier 1 — surfaces (the CI default)
bun run e2e:deep           # the surfaces nothing else opens (settings, tray, pages, tour)
bun run e2e:dataloss       # the data-loss sequences: two real tabs, real IndexedDB
bun run e2e:journeys       # tier 3 — user simulation, incl. real composition
bun run e2e:faults         # tier 4 — quota, blocked storage, multi-tab
bun run e2e:stress         # tier 2 — scale and duration (slow)
bun run e2e:harness        # the rig checking itself (run this first when a case looks wrong)
bun run e2e:library        # the published stylesheet on a host page (needs `bun run build`)
bun run e2e:bridge         # the embed's host bridge from a second origin (needs build:embed)
bun run e2e:perf           # measurement only, never asserted in CI
```

Chromium comes from `playwright-core`. `bunx playwright-core install chromium`
if you do not have one; `E2E_CHROME=/path/to/chrome` overrides.

## Layout

| File | What it is |
|---|---|
| `lib.mjs` | the rig: static server, page, seeding, pane accessors, CDP composition helpers, reporter |
| `docs.mjs` | canonical (ProseMirror JSON) builders for the stress shapes |
| `run.mjs` | runs each suite in its own process so one crash cannot take the rest down |
| `cases/surfaces.mjs` | tier 1 — blast radius |
| `cases/surfaces-deep.mjs` | the surfaces no other suite opens: Settings, Version history, the bottom tray, `/about` and `/help`, the guided tour, the Outline tab |
| `cases/dataloss.mjs` | the 1.77.0 data-loss sequences with two real tabs and real IndexedDB — picks up where `faults.mjs`'s multi-tab case stops |
| `cases/stress.mjs` | tier 2 — scale and duration |
| `cases/journeys.mjs` | tier 3 — user simulation |
| `cases/faults.mjs` | tier 4 — fault injection |
| `cases/perf.mjs` | measurement, not a gate |
| `fixtures/` | host pages the library and bridge suites are driven from |
| `cases/harness.mjs` | the rig checking ITSELF — the pane readers against a document of known lines |
| `cases/library.mjs` | the published stylesheet on a page that is not ours (needs `dist/`) |
| `cases/bridge.mjs` | the embed's host bridge, driven from a second origin (needs `dist-embed/`) |
| `probes/` | one-off diagnostics kept because they are the evidence behind a fix |

## What this campaign does NOT cover

Stated plainly, because "the browser tiers are green" is worth nothing if the
reader has to guess what was in them. These are known gaps, not oversights —
several were in the plan this campaign was built from and were not written.

**Surfaces never driven at all**
- **Find & Replace under load** — Replace All over a large document with a scope
  filter active is the mutation with the widest blast radius in the app.
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

**Now reproduced in a browser that previously was not**
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
- An **archive import with a mid-loop switch**.
- The window **immediately after `compositionend`**, and the **emoji suggestion
  list clicked mid-composition**.
- **Slow or failing network**, **corrupt stored JSON**, **offline / PWA**.

**Scaled down from what was planned**
- Continuous typing runs are ~480 characters, not 2000; the duration case is 8
  rounds, not 20 minutes; the largest library is 120 documents, not 200; there is
  no 200 KB document and no math-heavy document.
- **Breakpoints** now assert five real switches, not two. The menu collapsing to
  ☰ and the panes stacking (both at 768px) are read off the separator's own
  `aria-orientation`; the map's details rail is read as whether it docks to the
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
  a regression in an unrelated surface still fails the run.
- `probes/` is where a hypothesis is tested before it becomes a case. Keep the
  probe when it is the evidence for a fix — the comments in the source point at
  them.
