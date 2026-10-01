# Runbook — Sync Loop / Frozen Editor

## Symptoms
- Browser tab pegs a CPU core; the editor becomes unresponsive.
- The markdown and rich-text panes flicker or rapidly overwrite each other.
- Typing in one pane causes runaway updates in the other.
- Typing lags more and more as one document grows.

## Diagnosis
1. Open devtools → Performance, record ~3s. A sync loop shows as repeated `syncMdToHtml`/`syncHtmlToMd` frames; a slow large document shows single long projections (marked or turndown) spaced out by the idle delay.
2. Check the console for a flood of `[DIAG]` lines or React "Maximum update depth exceeded".
3. Identify the trigger:
   - **Just edited `useSyncEngine`?** Almost certainly the empty-deps invariant was broken — see [gotchas.md](../gotchas.md#the-sync-engine-callbacks-must-have-empty-dependency-arrays).
   - **Just added a Tiptap extension or changed the markdown engine?** A round trip that does not converge (HTML→MD→HTML differs on each pass). Projections write without an echo — the rich pane with `setContent(…, { emitUpdate: false })`, the markdown pane with its update listener suppressed — so this does not loop on its own; it rewrites the other pane on every edit, which reads as the panes fighting or text drifting.
   - **Only on a very large document?** Every projection still converts the whole document. Rich→markdown is linear-time now (`turndownLinear` converts in runs of 64 blocks, byte-identical to plain turndown), but a ~1.6 MB document still took 1.6–3.5 s per rich→markdown projection in jsdom measurements; incremental projection is not built (A083, partial). The scheduler waits longer when projections cost more ([src/hooks/sync-schedule.ts](../../src/hooks/sync-schedule.ts)), but its waits are capped — 800 ms after the last keystroke, 1.2 s while typing continues — so on a document that size the tab spends most of its time converting.
   - **Only while Find & Replace has a regular expression?** A regex runs in a Web Worker and is abandoned after 1.5 s — the worker is terminated and the panel shows an error — so a catastrophic pattern cannot freeze the tab ([src/formatting/find-worker.ts](../../src/formatting/find-worker.ts), A061). Where no Worker can be created (a host page whose CSP blocks `blob:` workers) the pattern runs on the main thread with a 250 ms budget, after a static check refuses the classic nested-quantifier shape — a heuristic, not a guarantee.

## Remediation
- **Broken deps:** Revert the dependency array of `forceSyncMdToHtml`/`forceSyncHtmlToMd` to `[]` and route fresh values through refs ([src/engine/useSyncEngine.ts:190-202](../../src/engine/useSyncEngine.ts#L190-L202)).
- **Non-converging round trip:** Find the unstable transform. Reproduce in isolation with the real pipeline (`createMarkdownEngine`, as [`src/__tests__/converter-harness.js`](../../src/__tests__/converter-harness.js) does):
  ```js
  const html = engine.mdToHtml(md);
  engine.htmlToMd(html) === md   // should converge after one round-trip
  ```
  If it never converges, the offending Turndown rule ([src/engine/turndown-rules.ts](../../src/engine/turndown-rules.ts)) or preprocessor step ([src/engine/preprocessor.ts](../../src/engine/preprocessor.ts)) is emitting output it can't re-parse to the same thing. Make the rule idempotent.
- **A very large document:** split it into several documents linked with `[[wiki links]]`.
- **Emergency stop for a user:** reload, or close the tab if it no longer responds. A frozen tab cannot write the unload stash, so text typed since the last autosave may be lost; everything autosaved is safe. If the app crashes instead, the crash screen offers **Export my documents** and **Copy diagnostics**. Switching the view to MD-only or Rich-only does NOT stop sync: both panes stay mounted and every edit is still projected into the hidden one. ⌘Z in the markdown pane drops the pending projection ([`cancelPendingSync`](../../src/hooks/useKeyboardShortcuts.ts#L237)) for that undo only.

## Prevention
- Keep the guards intact: the `quickHash` gate and the rich pane's doc-node identity check (`lastHtmlDoc`), the `syncing` re-entrancy ref, and the empty-deps force callbacks.
- Add a round-trip case to [`src/__tests__/converter-roundtrip.test.js`](../../src/__tests__/converter-roundtrip.test.js) (md → rich → md′ → rich → md″, through the real engine and schema) for any new markdown feature.

## Escalation
File a GitHub issue with the exact document content that triggers it (a minimal repro markdown snippet) — that's the fastest path to a fix — plus the Copy-diagnostics text.
