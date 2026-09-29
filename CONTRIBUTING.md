# Contributing to Markdown Studio

Thanks for taking a look. This file is the short version; the full guide —
coding standards, where things live, what not to break — lives in
[`docs/contributing.md`](docs/contributing.md), and the architecture it assumes
is in [`docs/architecture.md`](docs/architecture.md).

Security problems do **not** go in an issue or a PR — see
[SECURITY.md](SECURITY.md).

## Getting set up

The package manager is **Bun** (1.4.0 — pinned by `packageManager` in
`package.json`; CI installs with `bun install --frozen-lockfile`, so commit
`bun.lock` with any dependency change).

```bash
bun install
bun run dev          # standalone app on Vite's dev server
```

## The verification gate

Run all five before you open a pull request. CI
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the same commands
on every PR to `main`, plus the embed build and the browser campaign
(`bun run e2e`, see [`e2e/README.md`](e2e/README.md)).

```bash
bun run lint         # ESLint — zero errors (warnings are the tracked backlog)
bunx tsc --noEmit    # type gate — must be clean
bun run test         # vitest — must pass
bun run build:app    # standalone app build
bun run build        # library build (@perssonify/editor)
```

## Things that bite first-time contributors

- **Read [`CLAUDE.md`](CLAUDE.md) before changing anything structural.** It
  records the deliberate decisions and invariants of this codebase — most
  "obvious cleanups" in this repo are re-breaking something that was already
  fixed once.
- **The `perssonify` naming is intentional.** The product is Markdown Studio,
  but the npm package, the `pf:` preference keys, the `perssonify-document`
  export envelope, the `perssonify-backup` archive and the `perssonify-docs` /
  `perssonify-snapshots` IndexedDB databases are on-disk contracts with existing
  installs ([`docs/data-contracts.md`](docs/data-contracts.md)). Renaming them
  orphans people's documents. Do not "fix" them.
- **Test files must be `.js`.** `vitest.config.js` only picks up
  `*.test.{js,jsx}` — renaming a test to `.ts` silently stops running it.
- **Add tests under [`src/__tests__/`](src/__tests__/)** for anything you fix.
- **`src/components/ui/*` are generated shadcn primitives** — regenerate them
  via the CLI rather than hand-editing. (`input.tsx` and `textarea.tsx` are the
  documented exception: their `forwardRef` wrappers are deliberate on React 18
  and must be re-applied after any regeneration.)
- **A node or mark added to `TiptapPane.tsx` must also be registered in
  `src/engine/serialize-doc.ts`** (`SERIALIZE_EXTENSIONS`), or headless export
  silently corrupts or throws on documents that use it.
- **Style:** ESLint ([`eslint.config.js`](eslint.config.js)) checks correctness
  — the React hook rules above all — not layout; there is no formatter config.
  Match the surrounding file.

## Pull requests

Branch from `main` (`feat/*` or `fix/*`), keep the change scoped to one
subsystem, and say in the description what changed, why, and how you verified
it. The PR template asks for exactly that.
