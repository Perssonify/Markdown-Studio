## What changed

<!-- One or two sentences. What does this PR do? -->

## Why

<!-- The problem, the bug, the request. Link the issue if there is one: Fixes #123 -->

## How to verify

<!-- What a reviewer should click through, or the test that now covers it. -->

## Checklist

- [ ] `bunx tsc --noEmit` is clean
- [ ] `bun run test` passes
- [ ] `bun run build:app` and `bun run build` succeed
- [ ] Tests added or updated under `src/__tests__/` (files must be `.js` — `.ts` tests are silently skipped)
- [ ] I read the relevant part of [CLAUDE.md](../CLAUDE.md) and did not undo a documented invariant
- [ ] No renaming of the `perssonify` data identifiers (`pf:` keys, `perssonify-document`, `perssonify-snapshots`) — those are on-disk contracts
- [ ] If I added a TipTap node or mark, it is also registered in `src/engine/serialize-doc.ts` (`SERIALIZE_EXTENSIONS`)
- [ ] This PR contains no security fix that should have gone through [private disclosure](../SECURITY.md)

## Screenshots

<!-- For any visible UI change. Light and dark if the change touches colours. -->
