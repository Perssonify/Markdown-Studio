# Runbook — Sync Loop / Frozen Editor

## Symptoms
- Browser tab pegs a CPU core; the editor becomes unresponsive.
- The markdown and rich-text panes flicker or rapidly overwrite each other.
- Typing in one pane causes runaway updates in the other.

## Diagnosis
1. Open devtools → Performance, record ~3s. A sync loop shows as repeated `syncMdToHtml`/`syncHtmlToMd` frames.
2. Check the console for a flood of `[DIAG]` lines or React "maximum update depth exceeded".
3. Identify the trigger:
   - **Just edited `useSyncEngine`?** Almost certainly the empty-deps invariant was broken — see [gotchas.md](../gotchas.md#the-sync-engine-callbacks-must-have-empty-dependency-arrays).
   - **Just added a Tiptap extension or changed the markdown engine?** A non-deterministic round-trip (HTML→MD→HTML produces different output each pass) defeats the hash guard, so each sync sees "changed" content and re-fires.

## Remediation
- **Broken deps:** Revert the dependency array of `forceSyncMdToHtml`/`forceSyncHtmlToMd` to `[]` and route fresh values through refs ([src/engine/useSyncEngine.ts:98-110](../../src/engine/useSyncEngine.ts#L98-L110)).
- **Non-deterministic round-trip:** Find the unstable transform. Reproduce in isolation:
  ```js
  const html = engine.mdToHtml(md);
  engine.htmlToMd(html) === md   // should converge after one round-trip
  ```
  If it never converges, the offending Turndown rule ([src/engine/turndown-rules.ts](../../src/engine/turndown-rules.ts)) or preprocessor step ([src/engine/preprocessor.ts](../../src/engine/preprocessor.ts)) is emitting output it can't re-parse to the same thing. Make the rule idempotent.
- **Emergency stop for a user:** `Cmd+Z` cancels pending sync ([src/hooks/useKeyboardShortcuts.ts:59](../../src/hooks/useKeyboardShortcuts.ts#L59)); switching to a single-pane mode (MD-only or Rich-only) stops cross-pane sync entirely.

## Prevention
- Keep the three guards intact: `quickHash` guard, `syncing` re-entrancy ref, empty-deps callbacks.
- Add a round-trip convergence assertion to [src/__tests__/sync-engine.test.js](../../src/__tests__/sync-engine.test.js) for any new markdown feature.

## Escalation
File a GitHub issue with the exact document content that triggers it (a minimal repro markdown snippet) — that's the fastest path to a fix.
