## What changed

<!-- One or two sentences. What does this PR do? -->

Closes #<!-- issue number -->

## Why

<!-- The problem, the bug, the request. -->

## How to verify

<!-- What a reviewer should click through, or the test that now covers it. -->

## AI assistance

<!-- Did an AI assistant help write this? Say which one and for what (for example: "Claude Code wrote the first draft of the fix; I rewrote the test"). Write "None" if not. -->

## Checklist

- [ ] `bun run lint && bun run typecheck && bun run test && bun run build` passes from the repo root
- [ ] Tests added or updated (editor tests go in `apps/web/src/__tests__/` as `.js` or `.jsx` files; `.ts` files there are not run)
- [ ] I understand every line of this change and tested it myself
- [ ] I read the relevant part of [CLAUDE.md](../CLAUDE.md) and [apps/web/CLAUDE.md](../apps/web/CLAUDE.md) and did not undo a documented invariant
- [ ] No renaming of the `perssonify` data identifiers (`pf:` keys, `perssonify-document`, `perssonify-snapshots`): those are on-disk contracts
- [ ] If I added a Tiptap node or mark, it is also registered in `apps/web/src/engine/serialize-doc.ts` (`SERIALIZE_EXTENSIONS`)
- [ ] This PR contains no security fix that should have gone through [private disclosure](../SECURITY.md)

## Screenshots

<!-- For any visible UI change. Light and dark if the change touches colours. -->
