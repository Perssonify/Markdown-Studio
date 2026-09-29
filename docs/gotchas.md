# Gotchas — The Landmines

Non-obvious traps, stale docs, dead code, and "don't touch that" knowledge. Each: **Symptom → Cause → Fix/Workaround → Related files.** Read this before your first PR.

---

## The sync engine callbacks must have empty dependency arrays

- **Symptom:** After "improving" `useSyncEngine`, the app freezes, the CPU spikes, or the two panes flicker endlessly.
- **Cause:** `forceSyncMdToHtml` / `forceSyncHtmlToMd` deliberately use **empty dependency arrays** and call the current sync function through a ref ([src/engine/useSyncEngine.ts:98-110](../src/engine/useSyncEngine.ts#L98-L110)). Adding any dependency makes the callbacks change identity on render, which re-triggers effects that call sync, which re-renders… an infinite [echo loop](domain-glossary.md#echo-loop).
- **Fix/Workaround:** Don't add dependencies. If you need fresh values inside, reach them via refs, as the existing code does. The `quickHash` guards ([src/engine/useSyncEngine.ts:62](../src/engine/useSyncEngine.ts#L62), [:124](../src/engine/useSyncEngine.ts#L124)) and the `syncing` ref ([:28](../src/engine/useSyncEngine.ts#L28)) are the other two legs of the stool — leave all three intact.
- **Related:** [src/engine/useSyncEngine.ts](../src/engine/useSyncEngine.ts), [architecture.md ADR-2](architecture.md#adr-2--hash-guarded-debounced-bidirectional-sync).

## ~~`bun run dev` references a `.js` config that doesn't exist~~ (RESOLVED)

- **Status:** Resolved. The `dev`/`preview`/`build:app` scripts now point at
  `--config vite.app.config.ts`. (Vite 6 actually resolved the `.ts` from the
  `.js` arg, so the breakage never reproduced, but the scripts are now correct.)
- **Related:** [package.json](../package.json).

## ~~`src/store/useDocumentStore.ts` is dead code~~ (REMOVED)

- **Status:** The dead legacy file has been deleted. The only document store is
  the Zustand `documentStore.ts` — note its **export** is still named
  `useDocumentStore` (imported by `PerssonifyEditor`, the lifecycle/link hooks,
  and the UI). Edit [src/store/documentStore.ts](../src/store/documentStore.ts).
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
  bridge will ignore incoming messages.
- **Related:** [auth.md#common-auth-gotchas](auth.md#common-auth-gotchas).

## ~~Two version numbers that aren't synced~~ (RESOLVED — single-sourced)

- **Status:** Resolved. The version is now **single-sourced** from
  [package.json](../package.json): Vite injects it as `__APP_VERSION__`, and
  `VERSION` in [src/constants.ts](../src/constants.ts) re-exports that. Bump
  `package.json` only — the in-app/About version follows automatically.
- **Related:** [workflows.md#release--deployment](workflows.md#release--deployment).

## Some markdown features don't round-trip through the rich pane

- **Symptom:** You type `:smile:` (or a `[^1]` footnote) in the markdown pane; it
  renders in the rich pane, but after editing in the rich pane the markdown comes
  back as the emoji glyph (or the footnote as a plain link/list) rather than the
  original shortcode/syntax.
- **Cause:** The canonical source of truth is ProseMirror JSON. Features that are
  **not** modeled as TipTap nodes get flattened when HTML is parsed into the
  schema. Math (`$…$`/`$$…$$`) and code-fence diagrams (`mermaid`/`abc`) **do**
  round-trip because they have dedicated nodes ([MathNodes.tsx](../src/extensions/MathNodes.tsx))
  or are real code blocks. Emoji collapses to its unicode glyph; **footnotes** are
  effectively display-only (rendered, not reconstructed).
- **Fix/Workaround:** For footnote-heavy or shortcode-sensitive docs, edit in the
  markdown pane (its text is preserved as-is until you edit the rich pane). A
  future emoji/footnote TipTap node would make these fully round-trip.
- **Related:** [build-marked.ts](../src/engine/build-marked.ts), [features.md](features.md).

## Table-cell rich formatting round-trips again (was silently stripped)

- **Symptom (historical):** Styled spans / underline / math / emoji inside a GFM
  table cell were stripped to plain text on HTML→markdown.
- **Cause:** The per-cell turndown instance was created via `window.TurndownService`,
  a global that was **never set**, so the code always hit its tag-stripping
  fallback. Fixed by importing `TurndownService` directly in
  [turndown-rules.ts](../src/engine/turndown-rules.ts).
- **Related:** [src/engine/turndown-rules.ts](../src/engine/turndown-rules.ts).

## Decorative formatting silently lost in Clean mode

- **Symptom:** You apply text color/highlight/font, switch to Clean mode, and it vanishes from the markdown.
- **Cause:** Clean mode strips non-GFM styling by design ([src/engine/useSyncEngine.ts:76](../src/engine/useSyncEngine.ts#L76)). The toolbar warns ([src/ui/Toolbar.tsx:200](../src/ui/Toolbar.tsx#L200)) and the fidelity report records the loss, but the markdown genuinely won't carry it.
- **Fix/Workaround:** Use Styled mode to preserve styling, or export as JSON for a lossless copy.
- **Related:** [domain-glossary.md#clean-mode--styled-mode](domain-glossary.md#clean-mode--styled-mode), [src/store/fidelity.ts](../src/store/fidelity.ts).

## IndexedDB transactions abort if you await the wrong thing

- **Symptom:** A storage write silently fails / the transaction aborts mid-operation.
- **Cause:** Inside `idbTransaction()`, the callback may **only** await `idbRequest()` calls. Awaiting an unrelated Promise yields the microtask queue and the browser auto-commits (aborts) the transaction. Documented at [src/store/idb-storage-adapter.ts:94](../src/store/idb-storage-adapter.ts#L94).
- **Fix/Workaround:** Keep all awaits inside a transaction limited to `idbRequest` wrappers; do any other async work before/after the transaction.
- **Related:** [database.md#invariants](database.md#invariants).

## Importing the same file twice creates duplicate documents

- **Symptom:** Re-importing a file yields two copies.
- **Cause:** Ingest mints a **new id** every call ([src/store/ingest.ts](../src/store/ingest.ts), `generateId`); there's no dedup by content or filename.
- **Fix/Workaround:** Expected behavior. Delete the dupe, or add dedup if your feature needs it.
- **Related:** [data-pipeline.md#idempotency](data-pipeline.md#idempotency).

## The relationship map's cost is the RENDER, not the physics — don't optimise the wrong half

- **Symptom:** The map stutters while it settles on a large library.
- **Cause — measured, not assumed:** a CPU profile of a 153-note settle never surfaced the simulation at all. Not `stepOnce`; not `placeLabels`, which benchmarks at ~1ms at 150 nodes. 69% of samples were browser-internal work (style, layout, paint) for the SVG tree the render rewrites, and the frame measured a **44ms median**. The force loop *is* O(n²) per tick, and at these sizes that is still cheap next to one DOM pass.
- **What was done:** above 60 notes the layout advances several steps per rendered frame (`stepsPerFrame` in [src/store/graph-metrics.ts](../src/store/graph-metrics.ts), capped at 6 so one huge library cannot stall a single frame) — the same steps, the same resting layout, a third of the renders. Measured at 153 notes: **108 rendered frames / 5.6s / 3.9s blocking → 35 frames / 2.3s / 1.7s**.
- **If you optimise further:** the remaining win is in the DOM, not the maths — fewer per-frame attribute writes (memoising the rail, or mutating node transforms imperatively instead of through React) beats Barnes-Hut here. Profile before you start; this entry exists because the obvious answer was the wrong one.
- **Related:** [features.md#17-knowledge-graph-the-relationship-map](features.md#17-knowledge-graph-the-relationship-map).

## Tabs inside a fenced code block become four spaces

- **Symptom:** paste a Go function, a Makefile recipe, or any tab-indented
  snippet into a fenced block; after the first markdown → rich → markdown round
  trip the tabs are four spaces each. For a Makefile that is not cosmetic — make
  requires a literal tab.
- **Cause:** marked expands leading tabs across the WHOLE source before it
  tokenises. `Lexer.blockTokens` runs
  `src.replace(/^( *)(\t+)/gm, (_, lead, tabs) => lead + "    ".repeat(tabs.length))`
  unconditionally — not only under `pedantic` — so fence CONTENT is expanded
  along with block-structure indentation. CommonMark preserves tabs in code
  content, so this is a marked deviation, not the spec.
- **Fix/Workaround:** not fixed. `preprocessMarkdown` already masks fenced code
  for its own semantic passes, but it restores the code BEFORE marked runs, so
  marked still sees the tabs. The fix is to carry a mask across marked itself —
  stash fence bodies in `hooks.preprocess` and restore them, HTML-escaped, in
  `hooks.postprocess`, both configured in `build-marked.ts`. That is a change to
  the whole md→html path and wants its own verification pass. Pinned as an
  `it.fails` case in `fenced-code-roundtrip.test.js`, which will start failing
  (i.e. telling you) the moment it is fixed.
- **Related:** [src/engine/build-marked.ts](../src/engine/build-marked.ts),
  [src/engine/preprocessor.ts](../src/engine/preprocessor.ts),
  [src/__tests__/fenced-code-roundtrip.test.js](../src/__tests__/fenced-code-roundtrip.test.js).

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
- **Related:** [src/ui/CodeMirrorPane.tsx](../src/ui/CodeMirrorPane.tsx).

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
- **Related:** [src/ui/EditorPanes.tsx](../src/ui/EditorPanes.tsx).

## Don't "optimise" the rich pane's projection into an incremental write

- **Symptom:** `TiptapPane.setHTML` calls `editor.commands.setContent(html)`,
  which replaces the ENTIRE ProseMirror document on every cross-pane projection.
  It looks like an obvious win to diff the parsed document against the live one
  and dispatch only the changed range — preserving the node views (KaTeX,
  Mermaid/ABC, code blocks, theme images) that a wholesale replace appears to
  destroy.
- **Cause:** That premise is wrong. `EditorView.updateState` already diffs the
  new document against the existing view tree and REUSES the DOM and node-view
  instances wherever the markup matches, so a whole-document replace does not,
  in fact, rebuild them. Measured directly: a code block's rendered element is
  the same DOM node before and after a projection on the unmodified build.
- **Fix/Workaround:** It was built and measured — `findDiffStart`/`findDiffEnd`
  to find the range, a verification against the target document before
  dispatching, the lot. Over five runs per size under 4x CPU throttling it moved
  no metric outside the run-to-run spread (10KB blocking 191±60 → 177±124; 50KB
  499±119 → 506±153) while adding a second structural walk of the document to
  every projection. It was reverted. A string-level "already holding exactly
  this HTML" memo was tried too, and is equally pointless: the sync engine's own
  hash and doc-identity gates already stop a redundant projection before it
  reaches the pane.
- **Related:** [src/ui/TiptapPane.tsx](../src/ui/TiptapPane.tsx),
  [src/engine/useSyncEngine.ts](../src/engine/useSyncEngine.ts).

## Folder chips are painted LAST on purpose — don't "fix" the draw order

- **Symptom:** A folder's chip visually overlaps a note's dot when zoomed far out.
- **Cause:** Below ~40% zoom the dots converge into a band by design, and a screen-constant chip covers a lot of world, so no slot along the container's border is clear. `folderRects` searches hard (top border, bottom border, then just outside each, nine stops per row) and still sometimes has nowhere free to go.
- **Why it is not a bug:** the chip is the landmark a zoomed-out map is read by, and painting it last is what guarantees the invariant that matters — **no text is ever drawn over**. Move the chip render back above the nodes and a folder's own name ends up under a dot; that was the previous behaviour, and it was measured.
- **Guard:** `graph-metrics.test.js` pins the source order (`pf-folder-box` → `pf-node-dot` → `pf-folder-chip`).

## The library stylesheet is scoped at BUILD time, not in source

- **Symptom:** You change `src/styles.css`, and the app looks right but a library consumer's page gets reset — or vice versa.
- **Cause:** `src/styles.css` is shared by all three builds. Tailwind's preflight is global there **on purpose** (the app and the iframe embed own their document). Only the **library** build confines the `base` layer to the editor's subtrees, via `scopeLibraryBaseLayer` in [build/scope-css.mjs](../build/scope-css.mjs), wired into `vite.config.ts` **only**.
- **Watch for:** anything the editor attaches to `document.body` outside its container must carry `data-pf-portal`, or the reset will not reach it in a library mount. Base UI portals get `data-base-ui-portal` for free; sonner gets `data-sonner-toaster`.
- **Related:** [integration-guide.md](integration-guide.md#the-stylesheet-and-why-importing-it-is-safe), `src/__tests__/scope-css.test.js`.

## `bun run dev` does not serve `/api` — the import relay is invisible in local dev

- **Symptom:** "Import from URL" behaves differently locally than in production; the relay never seems to run.
- **Cause:** `bun run dev` is Vite only. A request to `/api/import?url=…` falls through to the SPA and returns **HTTP 200 with `text/html`** (the app shell), so the client's `res.ok` check passes and it tries to ingest the index page.
- **Fix/Workaround:** exercise the handler directly (`bun run test src/__tests__/import-relay.test.js`), or run `npx vercel dev` if you need the real function. Note that `curl`-ing a deployed relay is *supposed* to return 403 — it sends no `Sec-Fetch-Site`.
- **Related:** [import-relay.md](import-relay.md#running-and-testing-it).

## Browser storage eviction can wipe documents

- **Symptom:** A user reports their documents "disappeared."
- **Cause:** There is no backend; everything is in IndexedDB, which browsers may evict under storage pressure or when the user clears site data. The app does not request persistent storage.
- **Fix/Workaround:** Encourage periodic JSON export. See the runbook.
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
- **Fix:** the handler also writes a synchronous localStorage stash (`src/store/crash-recovery.ts`, `pf:recovery`), which `documentStore.initialize` adopts into the ordinary unsaved-draft cache before activating a document. It is deliberately ONE-SHOT — a stash that survived its own restore would keep resurrecting itself over newer content.
- **Watch for:** stash the live canonical only when `hydratedDocId === activeDocId`; the editor's JSON belongs to the document it holds, not to whichever is active. Also wired to `pagehide` (iOS never fires `beforeunload` on a swipe-away).
- **Guard:** `crash-recovery.test.js`, `e2e/cases/faults.mjs`.

## "Unsaved changes" can mean "saving is failing"

- **Symptom:** The status bar reads *Unsaved changes* while every save is in fact failing.
- **Cause:** A failed autosave is routed `error → editing` after 3s so the re-arm effect fires again — so for most of each retry cycle the status is `editing`, and `editing` rendered the reassuring message.
- **Fix:** `saveError` in `documentStore` outlives that transition (cleared only by a write that lands) and the bar reads *Save failed — retrying*. The terminal `blocked` status (the blank-over-content refusal) has its own branch now too; it previously had none and was invisible except for one 30s-throttled toast.

## A `ClipboardEvent` has no `shiftKey` — take the modifier from the view

- **Symptom:** ⇧+paste is documented to invert the styled-paste preference, and does nothing.
- **Cause:** `ClipboardEvent` does not inherit from `UIEvent`. `shiftKey` is not on its prototype chain, is `undefined` on a synthetic event, and is `undefined` on the event a real ⇧+paste delivers (all three measured in Chromium). The handler read `event.shiftKey`, so the inversion could never fire — and the test that "covered" it re-implemented the decision rule (`shift ? !pref : pref`) instead of exercising the handler, so it could not fail for the real reason.
- **Fix:** `TiptapPane.handlePaste` reads `view.input.shiftKey` — the field ProseMirror maintains itself and reads for its own plain-text-paste branch — and passes it on as an explicit `{ shiftKey }` argument. The `onPaste` prop takes modifiers, not an event.
- **Watch for:** the same mistake anywhere a modifier is wanted from a non-UIEvent (`ClipboardEvent`, `DragEvent` is fine — it *does* inherit from MouseEvent).
- **Guard:** `paste-styled.test.js` (source pin on both sides), `e2e/cases/journeys.mjs` (a real Shift keydown, then a paste).

## A caller-supplied `shouldShow` REPLACES TipTap's `isEditable` gate

- **Symptom:** Read-only mode hides the toolbar and blocks typing, yet the table and link bubble menus still appear and still mutate the document.
- **Cause:** TipTap's `BubbleMenu` has a default `shouldShow` that includes an editability check. Passing your own does not compose with it — it replaces it wholesale. `CommandManager` has no editability check either, so a chain run from the bubble applies to a "read-only" document.
- **Fix:** every caller-supplied `shouldShow` starts with `ed.isEditable &&`, and every mutating chain goes through `runBubbleCommand` ([src/ui/bubble-menu-command.ts](../src/ui/bubble-menu-command.ts)), which bails when the editor is not editable and blurs first when a composition is live.
- **Watch for:** the same shape anywhere native editability is assumed to be the whole guard. CLAUDE.md's read-only section is explicit: native editability blocks typing and paste, and **every programmatic mutation must be gated separately**.
- **Guard:** `bubble-menu-guard.test.js`.

## `typeof localStorage` is not a feature detect — it can throw

- **Symptom:** With site data blocked (Safari private mode, "block all cookies", some in-app webviews) the app does not boot at all.
- **Cause:** `localStorage` is a getter on `window`. `typeof localStorage` EVALUATES it, and in those browsers it throws `SecurityError` — so the guard written to survive the missing API was itself the crash.
- **Fix:** never touch it directly. `safeStorage` ([src/utils/safe-storage.ts](../src/utils/safe-storage.ts)) wraps get/set/remove/available in try/catch; `uiStore`, `theme/palette`, `storage-adapter` and `crash-recovery` all go through it. Degrading to "no persisted preferences" is fine; failing to render is not.
- **Guard:** `blocked-storage.test.js`, plus `e2e/probes/blocked-storage.mjs`.

## Activating a document and capturing the editor is two awaits apart

- **Symptom:** After an import, a host `addDocuments` call, or a Cards quick capture, one document ends up holding another's content.
- **Cause:** activate → persist → read `editor.getJSON()` spans at least two awaits, and IndexedDB is slow enough that a document switch lands in between routinely. A pre-await ownership snapshot is stale by the time the capture runs.
- **Fix:** one helper, `activateAndCapture` (PerssonifyEditor), re-checks ownership after every await (`stillOurs()`), the same chokepoint `saveActiveDoc` and `isEditorTargeting` re-assert. Quick capture is additionally a document-LEAVING path — `prepareToLeaveActiveDoc()` first, switch back to the previous document after.
- **Watch for:** any new path that calls `finalizeDoc`/`switchToDoc` and then reads the editor.

## The embed's `allowedOrigins` is the PARENT's origin, not its own

- **Symptom:** The shipped iframe build ignores every message a host sends it.
- **Cause:** `allowedOrigins` was set to the editor's own origin — which is never the sender — so the bridge rejected everything. In the other direction `createEditorClient` defaulted to `"*"`, i.e. it would post the document to any window that answered.
- **Fix:** `resolveAllowedOrigins` ([src/embed.tsx](../src/embed.tsx)) takes a validated `?allowed_origin=` (a literal `"*"` is rejected), else the origin of `document.referrer`, else `[]` — deny-all is the safe failure. `resolveEditorOrigin` ([src/integration/host-bridge.ts](../src/integration/host-bridge.ts)) derives the target from the iframe's own `src`.
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
- **Watch for:** anything GFM — strikethrough, tables, task lists, autolinks — and any new TipTap extension. Test BOTH directions: `strikethrough.test.js` covered md → html across several releases while the reverse destroyed the format.
- **Guard:** `strikethrough.test.js` ("strikethrough survives html → markdown").

## "Indent" cannot mean paragraph indent in a markdown editor

- **Symptom:** The Indent button does nothing on a paragraph — or worse, in the markdown pane, two presses silently turn the paragraph into a code block.
- **Cause:** Markdown has no paragraph indent. It has list nesting, and it has indented code blocks — four leading spaces on a paragraph line *is* a code block. CodeMirror's `indentMore` happily indents any line, so the markdown pane silently changed what the block WAS, from a button that promised to nest it.
- **Fix:** `mdIndentable` ([src/formatting/useFormatDispatcher.ts](../src/formatting/useFormatDispatcher.ts)) scopes the markdown side to list lines and lines inside a fenced block; the rich side is `sinkListItem`/`liftListItem`, which already refuse anything that is not a list item. Both panes now no-op in the same places.
- **Watch for:** the item type on the rich side. A task item's node is `taskItem`, not `listItem` — hardcoding the latter made indent dead inside every checklist while looking correct in a bullet list.
- **Guard:** `indent-scope.test.jsx`, including cases that drive `dispatch` itself (testing the helper alone survived removing its only caller).

## A loss report must be checked against the serializer, not against intuition

- **Symptom:** The status bar warns "1 other not in MD" on a document whose formatting round-trips perfectly — including the shipped Welcome document, on a brand-new user's very first visit.
- **Cause:** [`fidelity.ts`](../src/store/fidelity.ts) classified marks by what *feels* like plain Markdown rather than by what [`turndown-rules.ts`](../src/engine/turndown-rules.ts) actually emits. `underline`/`subscript`/`superscript` sat in the styled-only set, but their rules live in `addBaseRules`, which **both** turndown instances get — Clean keeps them. An image's `width`/`height` were counted as attribute losses, while the `sizedImage` rule exists specifically to carry them.
- **Fix:** classify from the rule tables. Only `addInlineStyleRule` (the `<span style="…">` carrier for colour, highlight and font family) is mode-dependent; only `textAlign` has no carrier at all.
- **Watch for:** the mirror image of the strikethrough bug two entries up. There, a format with no rule was classed as safe and destroyed silently; here, formats with rules were classed as lossy and warned about needlessly. Both come from reading the classification instead of the serializer — measure `turndown(html)` in both modes.
- **Guard:** `clean-vs-styled.test.js` (measures the turndown output for each case the docs promise), `fidelity.test.js`.

## A copied drag handler copies its bugs

- **Symptom:** After dragging a pane divider on a phone, no text anywhere in the app can be selected, and the divider follows the mouse without a button held.
- **Cause:** Both resize separators registered `pointermove` and `pointerup` on `window` and nothing else. `pointercancel` is not exotic here — the stacked separator is a 4px strip with `touch-action:auto`, so the browser reclaims the gesture as a page scroll, and that reclaim IS a cancel. The teardown never ran, so `document.body.style.userSelect`/`cursor` stayed set; and with no `pointerId` filter the still-armed listener tracked any later pointer.
- **Fix:** pointer CAPTURE, not a third listener — capture routes `pointercancel` and `lostpointercapture` to the element, so the drag cannot outlive its pointer. `touch-none` removes the reclaim that triggers it. Both live in [use-divider-drag.ts](../src/ui/use-divider-drag.ts), because the duplication was the cause.
- **Watch for:** `role="separator"` without `tabIndex` and `aria-valuenow` — that is invalid ARIA, announced as unoperable, not merely un-keyboard-friendly.
- **Guard:** `divider-drag.test.jsx`, which also counts separators against hook usages so a third one cannot skip it.

## A stylesheet cannot reach motion that JavaScript drives

- **Symptom:** With "reduce motion" on, the relationship map still animates the whole graph exploding out of a ring.
- **Cause:** The global `@media (prefers-reduced-motion: reduce)` guard flattens CSS animations and transitions — which covers more than it looks like, including the graph's *inline* 450ms camera transition (an `!important` stylesheet declaration beats a normal inline one). What it cannot touch is node positions advanced from `requestAnimationFrame`. No `.tsx` in the repo consulted the query at all, and `styles.css` carried a comment asserting one did.
- **Fix:** [`prefersReducedMotion`](../src/utils/reduced-motion.ts), read at call time (the preference can change mid-session) and failing open where `matchMedia` is missing. The graph settles in one step instead of animating.
- **Watch for:** the inverse error this entry started as — assuming a *transition* needs a JS gate. Check whether the stylesheet already wins before writing one.
- **Guard:** `reduced-motion.test.js`, including a case that the stylesheet no longer makes the false claim.

## A control that persists and highlights can still do nothing

- **Symptom:** "Reading width" Narrow / Medium / Wide are indistinguishable from Full in the normal split layout, but the segment highlights and the choice survives a reload.
- **Cause:** Fixed pixel caps (640/800/1000) written onto the container wrapping BOTH panes, so each half-width pane inherited the same absolute number. With the workspace panel open by default, "Narrow" only began to bind above a ~1620px viewport.
- **Fix:** express the measure in the unit it actually is — characters (`ch`) — so it binds in a narrow pane and scales with the font-size preference. Migrate stored values; say in the UI where it still cannot bind rather than overclaiming.
- **Watch for:** any setting whose only feedback is its own selected state. That is not evidence it did anything.
- **Guard:** `reading-width.test.js`.
