# Gotchas — The Landmines

Non-obvious traps, stale docs, dead code, and "don't touch that" knowledge. Each: **Symptom → Cause → Fix/Workaround → Related files.** Read this before your first PR.

---

## The sync engine callbacks must have empty dependency arrays

- **Symptom:** After "improving" `useSyncEngine`, the app freezes, the CPU spikes, or the two panes flicker endlessly.
- **Cause:** `forceSyncMdToHtml` / `forceSyncHtmlToMd` deliberately use **empty dependency arrays** and call the current sync function through a ref ([src/engine/useSyncEngine.ts:190-202](../src/engine/useSyncEngine.ts#L190-L202)). Adding any dependency makes the callbacks change identity on render, which re-triggers effects that call sync, which re-renders… an infinite [echo loop](domain-glossary.md#echo-loop).
- **Fix/Workaround:** Don't add dependencies. If you need fresh values inside, reach them via refs, as the existing code does. The `quickHash` guards (in `syncMdToHtml` and `syncHtmlToMd`, [src/engine/useSyncEngine.ts](../src/engine/useSyncEngine.ts) — the rich side checks its doc node's identity, `lastHtmlDoc`, before it hashes) and the `syncing` ref ([:95](../src/engine/useSyncEngine.ts#L95)) are the other two legs of the stool — leave all three intact.
- **Related:** [src/engine/useSyncEngine.ts](../src/engine/useSyncEngine.ts), [architecture.md ADR-2](architecture.md#adr-2--echo-gated-debounced-bidirectional-sync).

## ~~`bun run dev` references a `.js` config that doesn't exist~~ (RESOLVED)

- **Status:** Resolved. The `dev`/`preview`/`build:app` scripts now point at
  `--config vite.app.config.ts`. (Vite 6 actually resolved the `.ts` from the
  `.js` arg, so the breakage never reproduced, but the scripts are now correct.)
- **Related:** [package.json](../package.json).

## ~~`src/store/useDocumentStore.ts` is dead code~~ (REMOVED)

- **Status:** The dead legacy file has been deleted. The only document store is
  the Zustand `documentStore.ts` — note its **export** is still named
  `useDocumentStore` (imported by `PerssonifyEditor`, the lifecycle/link hooks,
  and the UI). Edit [src/store/documents/documentStore.ts](../src/store/documents/documentStore.ts).
- **Related:** [codebase-tour.md](codebase-tour.md).

## Tests must be `.js`, not `.ts`

- **Symptom:** You write `src/__tests__/foo.test.ts` and Vitest never runs it.
- **Cause:** The Vitest `include` glob is `src/__tests__/**/*.test.{js,jsx}` ([vitest.config.js](../vitest.config.js)) — `.ts`/`.tsx` test files are excluded.
- **Fix/Workaround:** Name test files `*.test.js`, or widen the glob to include `ts,tsx`.
- **Related:** [workflows.md](workflows.md).

## `iframe` host bridge now defaults to deny (`allowedOrigins: []`)

- **Status:** `createHostBridge` defaults `allowedOrigins` to `[]` (deny all
  cross-origin messages) ([src/integration/host-bridge.ts](../src/integration/host-bridge.ts)).
  This is a secure-by-default change from the old `["*"]`.
- **Fix/Workaround:** When embedding, **pass an explicit allowlist** of host
  origins, or `["*"]` to intentionally accept any origin. With no allowlist the
  bridge will ignore incoming messages. The shipped iframe embed never uses
  `"*"`: it resolves its allowlist from the real framer (see "The embed's
  `allowedOrigins` is the PARENT's origin" below).
- **Related:** [auth.md#common-auth-gotchas](auth.md#common-auth-gotchas).

## ~~Two version numbers that aren't synced~~ (RESOLVED — single-sourced)

- **Status:** Resolved. The version is now **single-sourced** from
  [package.json](../package.json): Vite injects it as `__APP_VERSION__`, and
  `VERSION` in [src/constants.ts](../src/constants.ts) re-exports that. Bump
  `package.json` only — the in-app/About version follows automatically.
- **Related:** [workflows.md#release--deployment](workflows.md#release--deployment).

## A construct survives the rich pane only if the schema or a turndown rule carries it

- **Symptom:** You type something in the markdown pane, edit in the rich pane,
  and it comes back written differently — or the fidelity indicator warns about it.
- **Cause:** The canonical source of truth is ProseMirror JSON. A construct
  survives a rich-pane edit only if the schema models it, or a turndown rule can
  rebuild it from what the schema keeps. Most now do: maths (`$…$`/`$$…$$`) and
  code-fence diagrams (`mermaid`/`abc`) have dedicated nodes
  ([MathNodes.tsx](../src/extensions/MathNodes.tsx)) or are real code blocks;
  an emoji shortcode is an inline `emoji` node that carries its name, so
  `:smile:` is written back as `:smile:` ([EmojiNode.ts](../src/extensions/EmojiNode.ts));
  **footnotes** have no node — the rich pane shows the renderer's numbered link and
  "Footnotes" list — but their hrefs carry the label, so turndown rules rebuild
  `[^label]` and `[^label]: text`, named labels and multi-paragraph definitions
  included (A043); table column alignment is a cell attribute (A044). What still
  cannot survive:
  - **text alignment** — it has no Markdown or inline-HTML carrier; the fidelity
    report counts it;
  - **a list or a second paragraph inside a table cell, and merged cells** — a GFM
    cell is one line, so these flatten; the fidelity report flags them;
  - **a hard break inside link text, in an exported file** — the app reads a single
    newline as a line break (marked's `breaks: true`), so the markdown pane writes a
    hard break as a plain newline. Exports (`.md` files, single or zipped) write
    `\` + newline instead, which strict CommonMark readers draw too (A051,
    [portable-breaks.ts](../src/engine/portable-breaks.ts)) — except inside a
    link's brackets, where marked itself does not accept `\` + newline, so the
    plain newline stays and a strict reader shows a space there;
  - **tabs inside a fenced code block** — see below.
- **Fix/Workaround:** For a document that must stay byte-for-byte as typed, edit
  in the markdown pane (its text is preserved until you edit the rich pane), and
  use Styled mode for colour, highlight and font.
- **Related:** [build-marked.ts](../src/engine/build-marked.ts),
  [turndown-rules.ts](../src/engine/turndown-rules.ts), [fidelity.ts](../src/store/documents/fidelity.ts),
  `converter-roundtrip.test.js`.

## A table cell's Markdown comes from the document's own conversion — there is no cell converter

- **Symptom (historical):** Styled spans, underline, maths or emoji inside a GFM
  table cell were stripped to plain text on HTML→markdown; later, cells dropped
  strikethrough and image sizes (and kept colour spans even in Clean mode) while
  the fidelity report called the table lossless.
- **Cause:** Cells were re-converted by a separate, smaller turndown instance —
  first one built from a `window.TurndownService` global that was never set (so it
  always fell back to stripping tags), then a hand-kept subset of the rules that
  drifted from the real ones.
- **Fix:** That instance is gone. The `gfmTableCell` rule records the Markdown the
  ONE document conversion already produced for each cell, and `gfmTable` lays the
  rows out from it ([turndown-rules.ts](../src/engine/turndown-rules.ts)) — so a
  cell gets every rule, the escaper and Clean/Styled parity automatically. Every
  pipe in a cell is written `\|`; line breaks in a cell become `<br>`.
- **Watch for:** a per-cell `turndown()` call creeping back in. What a GFM cell
  cannot hold is reported by `fidelity.ts`, not silently dropped.
- **Guard:** `converter-roundtrip.test.js` ("A044 — tables keep alignment and in-cell formatting").

## Decorative formatting silently lost in Clean mode

- **Symptom:** You apply text color/highlight/font, switch to Clean mode, and it vanishes from the markdown.
- **Cause:** Clean mode strips non-GFM styling by design (the `convert` choice, [src/engine/useSyncEngine.ts:38](../src/engine/useSyncEngine.ts#L38)). The toolbar warns (`DECORATIVE_CMDS`, [src/ui/chrome/toolbar/index.tsx:430](../src/ui/chrome/toolbar/index.tsx#L430)) and the fidelity report records the loss, but the markdown genuinely won't carry it.
- **Fix/Workaround:** Use Styled mode to preserve styling, or export as JSON for a lossless copy.
- **Related:** [domain-glossary.md#clean-mode--styled-mode](domain-glossary.md#clean-mode--styled-mode), [src/store/documents/fidelity.ts](../src/store/documents/fidelity.ts).

## IndexedDB transactions abort if you await the wrong thing

- **Symptom:** A storage write silently fails / the transaction aborts mid-operation.
- **Cause:** Inside `idbTransaction()`, the callback may **only** await `idbRequest()` calls. Awaiting an unrelated Promise yields the microtask queue and the browser auto-commits (aborts) the transaction. Documented above `idbTransaction` ([src/store/persistence/idb-storage-adapter.ts:229](../src/store/persistence/idb-storage-adapter.ts#L229)). The same rule applies to the version-history database: read first, in its own transaction, then open the write.
- **Fix/Workaround:** Keep all awaits inside a transaction limited to `idbRequest` wrappers; do any other async work before/after the transaction.
- **Related:** [database.md#invariants](database.md#invariants).

## Importing the same file twice creates duplicate documents

- **Symptom:** Re-importing a file yields two copies.
- **Cause:** Ingest mints a **new id** for every import (`generateId`, [src/store/documents/document.ts](../src/store/documents/document.ts)); there's no dedup by content or filename. A `perssonify-document` envelope (a JSON export or a backup ZIP) carries its own id, but if that id is already in the library `createDoc` mints a fresh one, so the import sits beside the stored document instead of overwriting it.
- **Fix/Workaround:** Expected behavior. Delete the dupe, or add dedup if your feature needs it.
- **Related:** [data-pipeline.md#idempotency](data-pipeline.md#idempotency).

## The relationship map's cost is the RENDER, not the physics — don't optimise the wrong half

- **Symptom:** The map stutters while it settles on a large library.
- **Cause — measured, not assumed:** a CPU profile of a 153-note settle never surfaced the simulation at all. Not `stepOnce`; not `placeLabels`, which benchmarks at ~1ms at 150 nodes. 69% of samples were browser-internal work (style, layout, paint) for the SVG tree the render rewrites, and the frame measured a **44ms median**. The force loop *is* O(n²) per tick, and at these sizes that is still cheap next to one DOM pass.
- **What was done:** above 60 notes the layout advances several steps per rendered frame (`stepsPerFrame` in [src/store/graph/graph-metrics.ts](../src/store/graph/graph-metrics.ts), capped at 6 so one huge library cannot stall a single frame) — the same steps, the same resting layout, a third of the renders. Measured at 153 notes: **108 rendered frames / 5.6s / 3.9s blocking → 35 frames / 2.3s / 1.7s**.
- **If you optimise further:** the remaining win is in the DOM, not the maths — fewer per-frame attribute writes (memoising the rail, or mutating node transforms imperatively instead of through React) beats Barnes-Hut here. Profile before you start; this entry exists because the obvious answer was the wrong one.
- **At library scale both halves matter (A088).** At 2,000 notes the exact O(n²) loop and the per-note SVG are each too slow, so above `BARNES_HUT_MIN` (300) the layout is Barnes–Hut and above `LARGE_MAP_MIN` (250) ordinary notes and links are drawn as a few batched paths, with each frame planned to either step or paint (`planFrame`). Below those thresholds nothing changed — the small-map loop is pinned bit-for-bit against `graph-legacy.js`, a frozen copy that must never be "fixed". Measure with `node e2e/run.mjs perf-map` rather than eyeballing.
- **Related:** [features.md#17-knowledge-graph-the-relationship-map](features.md#17-knowledge-graph-the-relationship-map).

## Tabs inside a fenced code block became four spaces (fixed by marked 14.1.1)

- **Symptom (marked 12):** paste a Go function, a Makefile recipe, or any
  tab-indented snippet into a fenced block; after the first markdown → rich →
  markdown round trip the tabs were four spaces each. For a Makefile that is not
  cosmetic — make requires a literal tab.
- **Cause:** marked up to 14.1.0 expanded leading tabs across the WHOLE source
  before it tokenised, fence content included. CommonMark preserves tabs in code
  content, so this was a marked deviation, not the spec.
- **Fix:** marked 14.1.1 stopped doing it, and the move to marked 18 (A113) took
  the fix. `fenced-code-roundtrip.test.js` now pins tabs byte for byte (a Makefile
  recipe, tabs inside a line); both cases fail on marked 12. It used to pin the
  deviation, so that the day it changed the suite would say why.
- **Related:** [src/engine/build-marked.ts](../src/engine/build-marked.ts),
  [src/__tests__/fenced-code-roundtrip.test.js](../src/__tests__/fenced-code-roundtrip.test.js).

## A code span ending in a backslash hid the emphasis after it (marked ≥ 15.0.8)

- **Symptom:** "Use `` `\` `` to escape. `**Note:**` …" showed the asterisks
  literally — in the rich pane and in the Word export — and so did every `*`, `_`
  and `**` up to the next backtick in the paragraph. CLAUDE.md contained exactly
  such a paragraph (`` `Mod-Alt-\` ``). marked 12 rendered it correctly.
- **Cause:** to decide which delimiters may close emphasis, marked masks the run
  first. Since 15.0.8 it masks backslash escapes BEFORE code spans, but inside a
  code span a backslash is literal, so the span's closing backtick reads as
  escaped and its opener pairs with the next backtick instead. The code span
  itself is still tokenised correctly; only the mask is wrong. Still present in
  18.0.14.
- **Fix:** `emStrongMaskFix` ([src/engine/marked-emphasis-mask.ts](../src/engine/marked-emphasis-mask.ts)),
  an `emStrong` tokenizer override that both `build-marked.ts` and the Word export
  install, hands marked's own emStrong a mask built with code spans and escapes in
  ONE left-to-right pass. It steps in only for a run that contains a backslash
  directly before a backtick.
- **Watch for:** the module mirrors marked's reference-link masking and calls its
  (TypeScript-private) `linkInText`. After a marked upgrade, the "emphasis after
  backslash code span" cases in `marked-upgrade-parity.test.js` say whether it
  still works — and whether upstream has fixed it, in which case delete the module
  and keep the cases.
- **Related:** [src/engine/build-marked.ts](../src/engine/build-marked.ts),
  [src/store/importExport/docx-export.ts](../src/store/importExport/docx-export.ts),
  [src/__tests__/marked-upgrade-parity.test.js](../src/__tests__/marked-upgrade-parity.test.js).

## Reading CodeMirror's text with `innerText` double-counts blank lines

- **Symptom:** a browser check reads `document.querySelector(".cm-content").innerText`
  and reports twice as many blank lines as the document actually contains —
  which looks exactly like a round-trip bug doubling them.
- **Cause:** CodeMirror renders every line as its own `<div class="cm-line">`,
  and an EMPTY line as `<div class="cm-line"><br></div>`. `innerText` emits a
  newline for the block boundary AND one for the `<br>`.
- **Fix/Workaround:** count `.cm-line` elements instead
  (`[...cm.querySelectorAll(".cm-line")].map(el => el.textContent)`), which is
  the document's real line structure. This cost a full investigation into a
  fenced-code "bug" that did not exist.
- **Related:** [src/ui/panes/codeMirrorPane/index.tsx](../src/ui/panes/codeMirrorPane/index.tsx).

## The split-pane scroll sync watches `scrollHeight` on purpose — it is not a heuristic to replace

- **Symptom:** `EditorPanes`' scroll sync rebuilds its heading-anchor map
  whenever either pane's `scrollHeight` changes. It reads like a stand-in for a
  `ResizeObserver`, and rebuilding mid-gesture looks like a performance bug worth
  fixing.
- **Cause:** CodeMirror's `scrollHeight` is an ESTIMATE. With line wrapping and
  per-heading font sizes it refines as you scroll into lines it has not measured
  yet, and the anchor positions come from `cmView.lineBlockAt(...).top`, which
  refines along with it. Rebuilding when that number moves is exactly what keeps
  the two panes in step.
- **Fix/Workaround:** It was swapped for a `ResizeObserver` on both scrollers
  plus a `MutationObserver` on the rich pane, and measured: a ResizeObserver
  watches the box, not the estimate, so after a 25-step wheel gesture on a
  40-section note the panes sat five sections apart. Reverted. The scroll path
  is also not a measurable cost to begin with — 60 wheel steps on a 50KB note
  produced 0–10ms of total blocking on every build tested — so there is nothing
  to win here and alignment to lose.
- **Related:** [src/ui/panes/editorPanes/index.tsx](../src/ui/panes/editorPanes/index.tsx).

## An incremental WRITE of a whole-document parse buys nothing — parse less instead

- **Symptom:** The markdown→rich projection used to be `setContent(mdToHtml(md))`,
  replacing the ENTIRE ProseMirror document every time. It looks like an obvious
  win to parse the whole document as before, diff the result against the live
  one and dispatch only the changed range — preserving the node views (KaTeX,
  Mermaid/ABC, code blocks, theme images) a wholesale replace appears to destroy.
- **Cause:** That premise is wrong. `EditorView.updateState` already diffs the
  new document against the existing view tree and REUSES the DOM and node-view
  instances wherever the markup matches, so a whole-document replace does not
  rebuild them. It was built and measured — `findDiffStart`/`findDiffEnd`, a
  verification before dispatching — and over five runs per size under 4x CPU
  it moved no metric outside the run-to-run spread (10KB blocking 191±60 →
  177±124; 50KB 499±119 → 506±153). A string-level "already holding exactly
  this HTML" memo was equally pointless: the hash and doc-identity gates already
  stop a redundant projection.
- **What did work (A083):** not parsing the whole document. At 1.6 MB the cost
  was the PARSE, not the write — marked over every block, TipTap's quadratic
  `elementFromString` whitespace pass, a per-cell `querySelectorAll` whose cost
  grows with the whole document, ProseMirror's parse — ~23 s a keystroke at 4x.
  [src/engine/incremental-rich.ts](../src/engine/incremental-rich.ts) keeps a
  model of where the markdown can be cut into runs that lex, render and parse
  exactly as they do in place, re-parses only the runs an edit touched, and
  replaces their nodes; the result is `Node.eq` to the whole-document parse
  (`incremental-rich.test.js` checks it after every step of random walks). The
  write it dispatches is small because the parse was — the node views were
  never the problem.
- **Related:** [src/engine/incremental-rich.ts](../src/engine/incremental-rich.ts),
  [src/engine/useSyncEngine.ts](../src/engine/useSyncEngine.ts),
  [src/ui/panes/tiptapPane/index.tsx](../src/ui/panes/tiptapPane/index.tsx).

## A transaction's step count, and a decoration set's size, are costs of their own

- **Symptom:** After the projection stopped re-parsing the whole document
  (above), the first markdown keystroke in a 4 MB document still took seconds
  at 4x CPU, though the parse was now a fraction of a second.
- **Cause:** Three things that are linear for an ordinary edit turn quadratic
  when a transaction holds hundreds of steps or a plugin holds thousands of
  decorations. (1) Each `ReplaceStep` rebuilds the document's top-level node
  list, so a step per changed stretch costs steps × blocks — about 900 code
  blocks changed by the first projection after a load (marked writes the
  trailing newline a rich-pane code block lacks): 6 s. (2) A plugin that maps
  each step's range through every LATER step is steps²: `BidiAuto` and
  `UnresolvedWikiLinks` both did, 1.6 s and 0.8 s. (3) Building or adding to a
  `DecorationSet` scans every decoration once per top-level block
  (`takeSpansForNode`): `BidiAuto`'s one decoration per task item cost 1.5 s
  each time a large range changed — and at every document open.
- **What works:** above `STEP_LIMIT` stretches, `replaceRange`
  (incremental-rich.ts) takes ONE step carrying the unchanged nodes as the same
  objects — the view matches children by node equality, so their DOM stays —
  and maps the selection itself as the per-stretch steps would have. A plugin
  carries the changed range FORWARD through each step's map instead. And a
  per-block view attribute belongs in a node view, never a decoration:
  `BidiAuto` has no decorations at all now; task items get `dir="auto"` from
  `TaskItemAutoDir`, TipTap's own node view with the attribute added.
- **Still there:** TipTap's code-block highlighter re-highlights EVERY code
  block and rebuilds its whole decoration set whenever a code block changes or
  the caret is in one — the same quadratic build, with one decoration per
  highlighted token.
- **Related:** [src/engine/incremental-rich.ts](../src/engine/incremental-rich.ts),
  [src/extensions/BidiAuto.ts](../src/extensions/BidiAuto.ts),
  [src/extensions/UnresolvedWikiLinks.ts](../src/extensions/UnresolvedWikiLinks.ts).

## React walks the focused rich pane on every commit — anywhere on the page

- **Symptom:** With a large document open and the caret in the rich pane, every
  React update froze the page for a moment — a save's status change, the word
  count, the library listing — though no component near the editor rendered.
  Profiles showed the time inside react-dom itself, reading `nextSibling` and
  `nodeType`.
- **Cause:** Before each commit React saves the focused element's caret so it can
  restore it if the commit moves focus (`getSelectionInformation`). For a
  contenteditable it computes the caret's character offsets by walking every DOM
  node before the caret: with the caret near the end of a 4 MB document, nearly
  the whole editor — ~0.5 s per commit at 4x CPU. It happens whichever React root
  commits, because it asks the document for the focused element.
- **What works:** React reads an element that has a `selectionStart` property
  directly (that is how it treats inputs). `ReactSelectionShield` gives the rich
  pane one — reads 0, writes ignored — while its document is large, and only
  then: a browser extension that takes an element with `selectionStart` for a
  text field and reads its `value` sees small documents exactly as before. React
  writes it back only when a commit moved focus, and then focuses the editor
  itself; ProseMirror restores its own selection on focus. The walk was most of
  what was left of an autosave's freeze once the save itself was cheap.
- **Don't** fight it by cutting commits one by one, or by lazy-rendering DOM
  inside the editor for this reason alone: the cost is per commit and per node,
  wherever the commit comes from. `react-selection-shield.test.jsx` drives React
  itself — if an upgrade drops the shortcut, it fails.
- **Related:** [src/extensions/ReactSelectionShield.ts](../src/extensions/ReactSelectionShield.ts),
  [e2e/probes/autosave-cost.mjs](../e2e/probes/autosave-cost.mjs).

## Folder chips are painted LAST on purpose — don't "fix" the draw order

- **Symptom:** A folder's chip visually overlaps a note's dot when zoomed far out.
- **Cause:** Below ~40% zoom the dots converge into a band by design, and a screen-constant chip covers a lot of world, so no slot along the container's border is clear. `folderRects` searches hard (top border, bottom border, then just outside each, nine stops per row) and still sometimes has nowhere free to go.
- **Why it is not a bug:** the chip is the landmark a zoomed-out map is read by, and painting it last is what guarantees the invariant that matters — **no text is ever drawn over**. Move the chip render back above the nodes and a folder's own name ends up under a dot; that was the previous behaviour, and it was measured.
- **Guard:** `graph-metrics.test.js` pins the source order (`pf-folder-box` → `pf-node-dot` → `pf-folder-chip`).

## The library stylesheet is scoped at BUILD time, not in source

- **Symptom:** You change `src/styles.css`, and the app looks right but a library consumer's page gets reset or recoloured — or vice versa.
- **Cause:** `src/styles.css` is shared by all three builds. Tailwind's preflight is global there, and the design tokens sit on `:root`, **on purpose** (the app and the iframe embed own their document). Only the **library** build rewrites the stylesheet, in two passes in [build/scope-css.mjs](../build/scope-css.mjs) run by the `scopeLibraryStylesheet` Vite plugin (wired into `vite.config.ts` **only**): `scopeBaseLayer` confines the `base` layer to the editor's subtrees, and `scopeTokens` moves every rule that declares only custom properties from `:root` / `.dark` / the palette switches onto the editor's own roots (`TOKEN_SCOPE`), so a shadcn/Tailwind host's `--background`, `--primary` or `--radius` of the same name are left alone. Page-level rules outside the base layer (the hidden scrollbar, for one) apply only to `html.pf-app`, which a host page never carries.
- **Watch for:** anything the editor attaches to `document.body` outside its container must carry `data-pf-portal`, or neither the reset nor the tokens reach it in a library mount. Base UI portals get `data-base-ui-portal` for free; sonner gets `data-sonner-toaster`. The integration's `display: contents` wrapper carries `data-pf-root` and sits OUTSIDE its error boundary, so the crash card still gets the tokens. Beyond those passes the build rewrites nothing, so an unlayered rule that must not reach a host page is scoped by hand (the focus ring to the editor roots; the print and coarse-pointer menu rules to `.pf-app`).
- **Related:** [integration-guide.md](integration-guide.md#the-stylesheet-and-why-importing-it-is-safe), `src/__tests__/scope-css.test.js`, `e2e/cases/library.mjs`.

## `bun run dev` does not serve `/api` — the import relay is invisible in local dev

- **Symptom:** "Import from URL" behaves differently locally than in production; the relay never seems to run.
- **Cause:** `bun run dev` is Vite only. A request to `/api/import?url=…` falls through to the SPA and returns **HTTP 200 with `text/html`** (the app shell), so the client's `res.ok` check passes and it tries to ingest the index page.
- **Fix/Workaround:** exercise the handler directly (`bun run test src/__tests__/import-relay.test.js`), or run `npx vercel dev` if you need the real function. Note that `curl`-ing a deployed relay is *supposed* to return 403 — it sends no `Sec-Fetch-Site`. The relay is also opt-in: the client uses it only after the one-time consent question, whose answer is remembered in `pf:import-relay` — remove that key (or change Settings ▸ Privacy) to be asked again.
- **Related:** [import-relay.md](import-relay.md#running-and-testing-it).

## Browser storage eviction can wipe documents

- **Symptom:** A user reports their documents "disappeared."
- **Cause:** There is no server copy; documents exist only in this origin's IndexedDB, which browsers may evict under storage pressure (Chromium, for a "best-effort" origin), delete after seven days without a visit (Safari, unless the app is installed), discard on closing a private window, or lose when the user clears site data.
- **What the app does about it** (standalone app, [src/store/persistence/storage-durability.ts](../src/store/persistence/storage-durability.ts)): after the first successful save it asks the browser to keep its storage (`navigator.storage.persist()`), and Settings ▸ Storage & backup shows whether it is persisted and how much is used; a reminder appears when the last full backup is over 7 days old; Safari/iOS users get a tip to install the app. A localStorage canary (`pf:library-canary`) remembers how many documents the origin held — if IndexedDB comes back empty while the canary remembers documents, the starter documents are NOT seeded (which would make a wipe look like a first visit) and a notice explains the loss. A wipe that also takes localStorage is indistinguishable from a new visitor.
- **Fix/Workaround:** Encourage regular full backups (File ▸ Export ▸ Full backup). See the runbook, which starts with Version history and the unload stash.
- **Related:** [runbooks/documents-disappeared.md](runbooks/documents-disappeared.md), [architecture.md ADR-5](architecture.md#adr-5--local-first-no-backend).

## A composition guard belongs to the pane the projection WRITES

- **Symptom:** In split view, dictating into the markdown pane leaves the rich pane frozen for the whole utterance. In the worst case the two panes never converge again for the rest of the session.
- **Cause:** `syncMdToHtml`/`syncHtmlToMd` used to defer whenever EITHER pane reported `isComposing()`. But `syncMdToHtml` writes the rich pane and only READS the markdown pane (CodeMirrorPane is uncontrolled — nothing in that path can dispatch into it), so a markdown-pane composition never had any business deferring it. The permanent case: an undo dispatched into CodeMirror during a live composition destroys the composition **without a `compositionend`**, so `view.composing` stays `true` forever and every projection defers forever.
- **Fix:** each projection defers for its own write target only, and `isComposing()` in both panes stops believing a composition that has produced no input for `COMPOSITION_STALL_MS` (8s). The retry guards in `handleMdChange`/`handleHtmlChange` mirror the engine's exactly — if they disagree, one reschedules for a projection the other would have run.
- **Guard:** `composition-guards.test.js`, `sync-engine.test.js`, and `e2e/cases/journeys.mjs` (a real composition through CDP; a mocked boolean cannot reach any of this).

## Leaving a document mid-composition: END it, do not wait for it

- **Symptom:** Dictate into the markdown pane, press ⌘N. The dictated text is gone — from both panes and from disk.
- **Cause:** During a composition the 120ms retry loop keeps `mdDebounceRef` non-null for the whole utterance, so `flushAndCacheIfDirty` read it as "a projection is pending", killed the loop, force-synced into the composition guard (a no-op) and cached the RICH pane's JSON — which never received the dictation. ⌘N is the reproducer because it never blurs; clicking another document happens to work, since the click's blur ends the composition first.
- **Fix:** `endCompositions()` at the top of every document-leaving path. Blur fires `compositionend` synchronously and commits the streamed text into that pane's own document, so the flush that follows has something real to carry.
- **Guard:** `composition-guards.test.js` (including a source pin over every debounce-cancelling site), `e2e/cases/journeys.mjs`.

## `beforeunload` cannot save to IndexedDB — it can only stash

- **Symptom:** Type a sentence and reload within the autosave window; the text is gone.
- **Cause:** The unload handler fires a best-effort autosave, but `saveActiveDoc` **awaits a read** before it writes. The page is gone before the write is issued, and the in-memory draft cache does not survive a reload.
- **Fix:** the handler also writes a synchronous localStorage stash (`src/store/persistence/crash-recovery.ts`, `pf:recovery`), which `documentStore.initialize` adopts into the ordinary unsaved-draft cache before activating a document. It is deliberately ONE-SHOT — a stash that survived its own restore would keep resurrecting itself over newer content.
- **Watch for:** stash the live canonical only when `hydratedDocId === activeDocId`; the editor's JSON belongs to the document it holds, not to whichever is active. Also wired to `pagehide` (iOS never fires `beforeunload` on a swipe-away). Each entry carries the revision its draft was based on and whether the tab was in conflict — without them, reloading a conflicted tab turned the refused save into an overwrite of the other tab's work — and `stashUnsaved` read-merge-writes the shared key per document, so a second tab's unload cannot erase the first tab's stash. A host's `storageConfig` can namespace or disable the stash (`configureRecovery`).
- **Guard:** `crash-recovery.test.js`, `e2e/cases/faults.mjs`.

## "Unsaved changes" can mean "saving is failing"

- **Symptom:** The status bar reads *Unsaved changes* while every save is in fact failing.
- **Cause:** A failed autosave is routed `error → editing` after 3s so the re-arm effect fires again — so for most of each retry cycle the status is `editing`, and `editing` rendered the reassuring message.
- **Fix:** `saveError` in `documentStore` outlives that transition (cleared only by a write that lands) and the bar reads *Save failed — retrying*. The terminal `blocked` status (the blank-over-content refusal) has its own branch now too; it previously had none and was invisible except for one 30s-throttled toast. Running out of space is its own terminal status, `full` (*Storage full — not saving*), rather than an endless *Save failed — retrying*.
- **Watch for:** resolving `saveActiveDoc` is not proof of a commit — it resolves `true` only when the write committed, and ⌘S reports success (and fires a host's `onSave`) only then.

## A `ClipboardEvent` has no `shiftKey` — take the modifier from the view

- **Symptom:** ⇧+paste is documented to invert the styled-paste preference, and does nothing.
- **Cause:** `ClipboardEvent` does not inherit from `UIEvent`. `shiftKey` is not on its prototype chain, is `undefined` on a synthetic event, and is `undefined` on the event a real ⇧+paste delivers (all three measured in Chromium). The handler read `event.shiftKey`, so the inversion could never fire — and the test that "covered" it re-implemented the decision rule (`shift ? !pref : pref`) instead of exercising the handler, so it could not fail for the real reason.
- **Fix:** `TiptapPane.handlePaste` reads `view.input.shiftKey` — the field ProseMirror maintains itself and reads for its own plain-text-paste branch — and passes it on as an explicit `{ shiftKey }` argument. The `onPaste` prop takes modifiers, not an event.
- **Watch for:** the same mistake anywhere a modifier is wanted from a non-UIEvent (`ClipboardEvent`, `DragEvent` is fine — it *does* inherit from MouseEvent).
- **Guard:** `paste-styled.test.js` (source pin on both sides), `e2e/cases/journeys.mjs` (a real Shift keydown, then a paste).

## A caller-supplied `shouldShow` REPLACES TipTap's `isEditable` gate

- **Symptom:** Read-only mode hides the toolbar and blocks typing, yet the table and link bubble menus still appear and still mutate the document.
- **Cause:** TipTap's `BubbleMenu` has a default `shouldShow` that includes an editability check. Passing your own does not compose with it — it replaces it wholesale. `CommandManager` has no editability check either, so a chain run from the bubble applies to a "read-only" document.
- **Fix:** every caller-supplied `shouldShow` starts with `ed.isEditable &&`, and every mutating chain goes through `runBubbleCommand` ([src/ui/panes/utils/bubble-menu-command.ts](../src/ui/panes/utils/bubble-menu-command.ts)), which bails when the editor is not editable and blurs first when a composition is live.
- **Watch for:** the same shape anywhere native editability is assumed to be the whole guard. CLAUDE.md's read-only section is explicit: native editability blocks typing and paste, and **every programmatic mutation must be gated separately**.
- **Guard:** `bubble-menu-guard.test.js`.

## `typeof localStorage` is not a feature detect — it can throw

- **Symptom:** With site data blocked (Safari private mode, "block all cookies", some in-app webviews) the app does not boot at all.
- **Cause:** `localStorage` is a getter on `window`. `typeof localStorage` EVALUATES it, and in those browsers it throws `SecurityError` — so the guard written to survive the missing API was itself the crash.
- **Fix:** never touch it directly. `safeStorage` ([src/utils/safe-storage.ts](../src/utils/safe-storage.ts)) wraps get/set/remove/available in try/catch; `uiStore`, `theme/palette`, `storage-adapter` and `crash-recovery` all go through it. Degrading to "no persisted preferences" is fine; failing to render is not.
- **Guard:** `blocked-storage.test.js`, plus `e2e/probes/blocked-storage.mjs`.

## Activating a document and capturing the editor is two awaits apart

- **Symptom:** After an import, a host `addDocuments` call, or a Cards quick capture, one document ends up holding another's content — or an import is saved as an empty "Untitled".
- **Cause:** activate → push the HTML into the editor → read `editor.getJSON()` back spans awaits and a frame, and IndexedDB is slow enough that a document switch (or a click in the library) lands in between routinely. The capture then read, or the fallback persisted, the wrong content.
- **Fix:** don't borrow the editor to convert. Imports are converted HEADLESSLY — `captureIngestHeadless` parses the ingest HTML against the live editor's schema, or the identical `headlessSchema()` when no editor is mounted — and persisted with `saveNewDoc` without being activated; the first import is then opened through `handleSwitchDoc`. `activateAndCapture` (PerssonifyEditor, used by `addDocuments`, the host `importContent` and Cards quick capture) converts headlessly too, and hydrates through the usual ritual only if, after its awaits, `activeDocId` is still the new document — the same post-await chokepoint `saveActiveDoc` and `isEditorTargeting` re-assert. Import, `importContent` and quick capture are document-LEAVING paths — `prepareToLeaveActiveDoc()` first; quick capture switches back to the previous document after.
- **Watch for:** any new path that calls `finalizeDoc`/`switchToDoc` and then reads the editor.

## The embed's `allowedOrigins` is the PARENT's origin, not its own

- **Symptom:** The shipped iframe build ignores every message a host sends it.
- **Cause:** `allowedOrigins` was set to the editor's own origin — which is never the sender — so the bridge rejected everything. In the other direction `createEditorClient` defaulted to `"*"`, i.e. it would post the document to any window that answered.
- **Fix:** `resolveEmbedAllowedOrigins` ([src/integration/embed-origins.ts](../src/integration/embed-origins.ts), called from [src/embed.tsx](../src/embed.tsx)) decides, in order: a deploy-time allowlist (`VITE_EMBED_ALLOWED_ORIGINS`, baked in at build) filters everything; where the browser reports the real framer (`location.ancestorOrigins`), a requested origin must BE that framer, and a page that is not framed gets no partner; the requested origins are a validated `?allowed_origin=` (a literal `"*"` is rejected), else the reported framer, else the origin of `document.referrer`; otherwise `[]` — deny-all is the safe failure. Any page that frames the embed used to get a bridge that can read and overwrite every document the embed sees; set the deploy-time allowlist. `resolveEditorOrigin` ([src/integration/host-bridge.ts](../src/integration/host-bridge.ts)) derives the target from the iframe's own `src`.
- **Watch for:** a self-hosted embed stores its documents in the default database (`perssonify-docs`), and renaming it would orphan every existing embed user's library ([decisions.md](decisions.md)). Only on the app's own hosts (`APP_HOSTS`) does the embed keep a database of its own, `perssonify-embed-docs` (`embedStorageConfig`, guarded by `embed-storage.test.js`).
- **Guard:** `embed-origin.test.js`.

## A converter that throws must not leave the echo gate claiming agreement

- **Symptom:** One pane stops mirroring the other, permanently, with nothing in the console.
- **Cause:** The sync engine's hash gate was committed BEFORE the conversion. If `mdToHtml`/`htmlToMd` threw, the gate had already recorded "these two agree", so every later projection short-circuited on an input hash that matched a projection which never happened.
- **Fix:** commit the hash AFTER the conversion, in both directions. Same shape as marking hydration: `markHydratedAfterMdSync` runs only when a projection actually ran.
- **Guard:** `sync-engine.test.js`.

## A test that cannot fail is worse than no test

- **Symptom:** A suite is green, and the behaviour it names has never worked.
- **Cause:** Four flavours found here: a test that re-implements the rule instead of calling the code (`suppression.test.js` described a `suppressNextUpdate` flag `TiptapPane` has never had — thirteen cases, all green with the real option deleted); an import that is never called (`mdAddColumnBefore`); an assertion loose enough to hold for the bug (counting PIPES, which "insert column before" and "after" share); and a mock that makes the interesting branch unreachable (`keyboard-shortcuts.test.js` passed `{ current: null }`, so the rich-pane early return never executed).
- **Fix:** mutation-test every guard — revert the fix, confirm the case goes red, restore. When a guard genuinely cannot be observed (a memo that only changes a hit rate, an unreachable defence-in-depth check), write that in a comment rather than a case that passes either way.
- **Related:** [../e2e/README.md](../e2e/README.md), which states what the browser campaign does NOT cover for the same reason.

## Memoizing a handler can silently stop an effect from ever re-running

- **Symptom:** After a performance pass that wrapped handlers in `useCallback`, a feature that never looked related stops working — in this case EVERY keyboard shortcut, but only after a page reload.
- **Cause:** `useKeyboardShortcuts`' effect bails when the editor container has not mounted yet (`PerssonifyEditor` renders an "Initializing Engine…" branch first) and relied on a later run to attach its listener. That later run existed only because the handlers it depends on were inline arrows with a fresh identity every render. Stabilise them and the effect runs exactly once — with a null ref.
- **Fix:** the listener is attached to `document` unconditionally and resolves `containerRef.current` inside the handler, at event time. Nothing depends on mount order.
- **Watch for:** the shape `const el = someRef.current; if (!el) return;` at the top of an effect whose dependencies are all stable. Either the node is guaranteed to exist in the same commit (a ref on an element the component always renders), or the effect needs something that changes when the node appears — a state flag or a callback ref — not luck.
- **Guard:** `keyboard-shortcuts.test.js` ("the container mounting after the first render"), `e2e/probes/shortcut-after-reload.mjs`.

## An element with no turndown rule is silently stripped, not reported

- **Symptom:** A format applied in the rich pane disappears as soon as the panes sync, and is missing from every markdown export. No error, no fidelity warning.
- **Cause:** Turndown's core implements CommonMark only, and this project does **not** load `turndown-plugin-gfm`. An element no rule matches falls through to the default behaviour — keep the text, drop the tag. Strikethrough shipped this way: TipTap's Strike renders `<s>`, nothing in [turndown-rules.ts](../src/engine/turndown-rules.ts) matched it, and `fidelity.ts` counts strike as a NATIVE mark so it was never flagged as a loss either.
- **Fix:** write the rule. Check what a node or mark actually SERIALIZES to (`editor.getHTML()`), not what you assume it emits.
- **Watch for:** anything GFM — strikethrough, tables, task lists, autolinks — and any new TipTap extension. Test BOTH directions: `strikethrough.test.js` covered md → html across several releases while the reverse destroyed the format. The mirror image bites too: LITERAL text that would read back as markup (`&lt;br&gt;`, text about `<details>`, `1)` at a line start, a `$` that would open a formula) must be escaped, and turndown's own escaper covers CommonMark only — `escapeMarkdownText` in the same file handles the rest (`converter-escape.test.js`).
- **Guard:** `strikethrough.test.js` ("strikethrough survives html → markdown").

## "Indent" cannot mean paragraph indent in a markdown editor

- **Symptom:** The Indent button does nothing on a paragraph — or worse, in the markdown pane, two presses silently turn the paragraph into a code block.
- **Cause:** Markdown has no paragraph indent. It has list nesting, and it has indented code blocks — four leading spaces on a paragraph line *is* a code block. CodeMirror's `indentMore` happily indents any line, so the markdown pane silently changed what the block WAS, from a button that promised to nest it.
- **Fix:** `mdIndentable` ([src/formatting/useFormatDispatcher.ts](../src/formatting/useFormatDispatcher.ts)) scopes the markdown side to list lines and lines inside a fenced block; the rich side is `sinkListItem`/`liftListItem`, which already refuse anything that is not a list item. Both panes now no-op in the same places.
- **Watch for:** the item type on the rich side. A task item's node is `taskItem`, not `listItem` — hardcoding the latter made indent dead inside every checklist while looking correct in a bullet list.
- **Guard:** `indent-scope.test.jsx`, including cases that drive `dispatch` itself (testing the helper alone survived removing its only caller).

## A loss report must be checked against the serializer, not against intuition

- **Symptom:** The status bar warns "1 other not in MD" on a document whose formatting round-trips perfectly — including the shipped Welcome document, on a brand-new user's very first visit.
- **Cause:** [`fidelity.ts`](../src/store/documents/fidelity.ts) classified marks by what *feels* like plain Markdown rather than by what [`turndown-rules.ts`](../src/engine/turndown-rules.ts) actually emits. `underline`/`subscript`/`superscript` sat in the styled-only set, but their rules live in `addBaseRules`, which **both** turndown instances get — Clean keeps them. An image's `width`/`height` were counted as attribute losses, while the `sizedImage` rule exists specifically to carry them.
- **Fix:** classify from the rule tables. Only `addInlineStyleRule` (the `<span style="…">` carrier for colour, highlight and font family) is mode-dependent; only `textAlign` has no carrier at all.
- **Watch for:** the mirror image of the strikethrough bug two entries up. There, a format with no rule was classed as safe and destroyed silently; here, formats with rules were classed as lossy and warned about needlessly. Both come from reading the classification instead of the serializer — measure `turndown(html)` in both modes.
- **Guard:** `clean-vs-styled.test.js` (measures the turndown output for each case the docs promise), `fidelity.test.js`.

## A copied drag handler copies its bugs

- **Symptom:** After dragging a pane divider on a phone, no text anywhere in the app can be selected, and the divider follows the mouse without a button held.
- **Cause:** Both resize separators registered `pointermove` and `pointerup` on `window` and nothing else. `pointercancel` is not exotic here — the stacked separator is a 4px strip with `touch-action:auto`, so the browser reclaims the gesture as a page scroll, and that reclaim IS a cancel. The teardown never ran, so `document.body.style.userSelect`/`cursor` stayed set; and with no `pointerId` filter the still-armed listener tracked any later pointer.
- **Fix:** pointer CAPTURE, not a third listener — capture routes `pointercancel` and `lostpointercapture` to the element, so the drag cannot outlive its pointer. `touch-none` removes the reclaim that triggers it. Both live in [use-divider-drag.ts](../src/ui/shared/hooks/use-divider-drag.ts), because the duplication was the cause.
- **Watch for:** `role="separator"` without `tabIndex` and `aria-valuenow` — that is invalid ARIA, announced as unoperable, not merely un-keyboard-friendly.
- **Guard:** `divider-drag.test.jsx`, which also counts separators against hook usages so a third one cannot skip it.

## A stylesheet cannot reach motion that JavaScript drives

- **Symptom:** With "reduce motion" on, the relationship map still animates the whole graph exploding out of a ring.
- **Cause:** The global `@media (prefers-reduced-motion: reduce)` guard flattens CSS animations and transitions — which covers more than it looks like, including the graph's *inline* 450ms camera transition (an `!important` stylesheet declaration beats a normal inline one). What it cannot touch is node positions advanced from `requestAnimationFrame`. No `.tsx` in the repo consulted the query at all, and `styles.css` carried a comment asserting one did.
- **Fix:** [`prefersReducedMotion`](../src/utils/reduced-motion.ts), read at call time (the preference can change mid-session) and failing open where `matchMedia` is missing. The graph settles in one step instead of animating.
- **Watch for:** the inverse error this entry started as — assuming a *transition* needs a JS gate. Check whether the stylesheet already wins before writing one. A JavaScript smooth scroll (`scrollIntoView({ behavior: "smooth" })`) is one the stylesheet cannot reach either; outline, heading and Help jumps take their behaviour from `scrollBehavior()` in the same module.
- **Guard:** `reduced-motion.test.js`, including a case that the stylesheet no longer makes the false claim.

## A control that persists and highlights can still do nothing

- **Symptom:** "Reading width" Narrow / Medium / Wide are indistinguishable from Full in the normal split layout, but the segment highlights and the choice survives a reload.
- **Cause:** Fixed pixel caps (640/800/1000) written onto the container wrapping BOTH panes, so each half-width pane inherited the same absolute number. With the workspace panel open by default, "Narrow" only began to bind above a ~1620px viewport.
- **Fix:** express the measure in the unit it actually is — characters (`ch`) — so it binds in a narrow pane and scales with the font-size preference. Migrate stored values; say in the UI where it still cannot bind rather than overclaiming.
- **Watch for:** any setting whose only feedback is its own selected state. That is not evidence it did anything.
- **Guard:** `reading-width.test.js`.

## On Windows, Ctrl+Alt is how half of Europe types `[`, `]` and `\`

- **Symptom:** On a German, Nordic, Swiss, Spanish or French layout, `[`, `]` or `\` cannot be typed — the keystroke indents, outdents, opens Find & Replace or turns a paragraph into a heading instead. Markdown links, task lists and `[[wiki links]]` become untypeable.
- **Cause:** Windows delivers AltGr as Ctrl+Alt, so any handler that reads "Ctrl (or Meta) plus a key" as a chord swallows AltGr typing. Three layers did: the shortcut hook, CodeMirror's default keymap (`Mod-Alt-\` is `indentSelection`) and TipTap's own `Mod-Alt-0…6` / `Mod-Alt-c` bindings.
- **Fix:** `isAltGraphInput` ([src/utils/alt-graph.ts](../src/utils/alt-graph.ts)) is the one predicate: the AltGraph modifier, or — off the Mac, without Meta — Ctrl+Alt that produced anything other than the key's own Latin letter. The shortcut hook and the Find panel bail on it, `dropAltGraphChords` filters CodeMirror's Ctrl+Alt bindings, and `AltGraphPassthrough` makes ProseMirror skip its keymaps for it without `preventDefault`, so the character is still typed.
- **Watch for:** any new Ctrl+Alt binding, including one arriving with a dependency bump — Tiptap 3.31 silently gave Tab a new meaning after a list, which `ListKeymapNoTab` undoes.
- **Guard:** `editor-altgraph.test.js`, `e2e/probes/g2-audit-fixes.mjs` (real AltGr key events through CDP).

## A regex lookbehind LITERAL in the entry chunk blanks the app on older Safari

- **Symptom:** The app is a blank page on Safari/iOS before 16.4, with a `SyntaxError` in the console.
- **Cause:** A lookbehind (`(?<=…)` / `(?<!…)`) in a regex LITERAL is a parse-time error on those engines, and one in any module the entry chunk loads stops the whole bundle from parsing — before any error boundary exists.
- **Fix:** keep the entry chunk free of them. Where one is needed, compile it from a string at runtime inside a `try`, with a fallback (Clear formatting in the markdown pane does this, and its fallback is pinned equal to the primary passes).
- **Guard:** `converter-escape.test.js` ("A097 — no lookbehind in the modules the entry chunk loads"), which asks the TypeScript parser for real regex literals; `formatting-clear-fallback.test.js`.

## Below the browser floor, the page must stop itself — and the watchdog must stay away

- **Symptom:** On Safari/iOS before 16.4, Chrome/Edge before 111 or Firefox before 128 the app was a blank page: the Tailwind v4 stylesheet does not apply there, and the bundle can die on a `SyntaxError`. The boot watchdog in `index.html` took that error for a broken deploy, unregistered the service worker, deleted every cache and reloaded — into the same blank page.
- **Fix (A097):** an inline script in `index.html` and `embed.html` (the same bytes in both) tests the three features the floor is made of — `CSS.registerProperty`, `color-mix()` and regex lookbehind, the last compiled from a string — and below the floor writes a self-contained, inline-styled message followed by `<plaintext>`. The tokenizer never leaves that state, so everything after the check — the watchdog, the stylesheet and the module script Vite injects at the end of `<head>` — is inert text: no app code runs and nothing stored is touched. The watchdog also stands down on `window.__PF_UNSUPPORTED`, in case the two scripts are ever reordered.
- **Watch for:** the check must stay ES5 (it has to parse where it fails) and ABOVE the watchdog and the module entry, and every edit changes its CSP hash in `vercel.json`. Moving the floor means changing the feature tests and the message's version list together.
- **Guard:** `ops-browser-floor.test.js` (the shipped script in a sandbox and in jsdom, ES5 via a parser, the watchdog standing down), `ops-vercel-headers.test.js` (the hashes), and `e2e/cases/floor.mjs` in Chromium, Firefox and WebKit (the module script is never parsed, storage and caches survive, the document is there after "updating").
