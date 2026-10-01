# Markdown Studio — Engineering Docs

> Living technical documentation for the Markdown Studio. Start here; every other doc is linked below.
> Audience: a competent engineer who has never seen this codebase. Goal: ship your first PR within 48 hours without DMing anyone.

## What this is, in one paragraph

Markdown Studio is a **browser-based** markdown editor that runs two editing surfaces side by side: a raw-markdown pane (CodeMirror 6) and a rich-text pane (Tiptap 3 / ProseMirror). Edits in either pane sync to the other in real time, with the **canonical source of truth being ProseMirror JSON** — not the markdown text, not the HTML. It stores documents locally in **IndexedDB** (no account, no login, no database to provision, and no server copy — the only server code is an opt-in relay for importing from a URL), supports many documents in nested folders, wiki-style `[[links]]` between documents, a force-directed knowledge graph, and import/export across Markdown, HTML, and ProseMirror JSON. The same code ships two ways: as a **standalone web app** (deployed to Vercel) and as an **embeddable npm library** (`@perssonify/editor`).

## What it does for a user (concrete)

- **Edit markdown and rich text at the same time**, with instant bidirectional sync — see [features.md#dual-pane-editing](features.md#1-dual-pane-editing).
- **Keep many documents** in nested folders, browsed and searched from the left-docked **Workspace panel**, persisted locally and restored on reload — see [features.md#document-management](features.md#document-management). (There is no tab strip; you switch documents from the panel's Files tab.)
- **Link documents with `[[wiki links]]`** and explore them as a draggable knowledge graph — see [features.md#wiki-links--knowledge-graph](features.md#wiki-links--knowledge-graph).
- **Choose "Clean" vs "Styled" markdown** output — strip decorative styling or preserve it as inline HTML (text alignment has no carrier either way) — see [features.md#sync-modes-clean-vs-styled](features.md#sync-modes-clean-vs-styled).
- **Import/export and "Copy as Prompt"** — export `.md`/`.html`/`.json`, or copy the active doc plus its linked neighbors formatted for an LLM — see [features.md#import--export](features.md#import--export).

## Quickstart

This repo uses **[Bun](https://bun.sh)** as its package manager and runner (see [`bun.lock`](../bun.lock) and [`vercel.json`](../vercel.json)). `npm` also works for installing, but the deploy pipeline and lockfile are Bun.

```bash
git clone https://github.com/SolutionPath/markdown-studio.git
cd markdown-studio
bun install --frozen-lockfile   # exactly the locked tree (Bun 1.4.0, see packageManager)
bun run dev                     # starts the standalone app (Vite 8)
```

Expected output once Vite is up (the version and timing vary):

```
  VITE v8.x.x  ready in … ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

Open `http://localhost:5173`. On an empty browser profile the first run seeds three linked documents — **Welcome** (which opens), **Changelog**, and **About Perssonify** in a folder — in a split view (markdown left, rich text right). They cross-link on purpose, so the relationship map has a real graph on day one. The structured `[DIAG]` boot trace is off by default; add `?diag=1` to the URL to see it (see [domain-glossary.md#diag](domain-glossary.md#diag)).

Run the tests:

```bash
bun run test                # vitest, one-shot (196 files, 2,126 tests)
bun run lint                # ESLint: must report 0 errors
```

Full setup, env vars, and recipes: [local-development.md](local-development.md).

## Repo map at a glance

```
src/
├── PerssonifyEditor.tsx   # Main orchestrator — wires stores, engines, panes, hooks
├── engine/                # Markdown ⇄ HTML ⇄ PM-JSON conversion + bidirectional sync
├── store/                 # Zustand stores + IndexedDB persistence + link index + ingest
├── ui/                    # React components (panes, toolbar, workspace panel, cards, graph, find/replace)
├── extensions/            # Custom Tiptap nodes: WikiLink, MathNodes, Callout, Details, …
├── integration/           # Embeddable API: <PerssonifyEditorIntegration>, iframe host bridge
├── formatting/            # Command dispatch + markdown text/table editing helpers
├── hooks/                 # useDocumentLifecycle, useKeyboardShortcuts, useLinkIndex, …
└── __tests__/             # Vitest suites
```

Full annotated tree and a "where does X live?" table: [codebase-tour.md](codebase-tour.md).

## The rest of the docs

| Doc | Read it when you want to know… |
|-----|-------------------------------|
| [features.md](features.md) ⭐ | What every user-facing feature does and which files implement it |
| [extended-features.md](extended-features.md) 🆕 | 2026 additions: flavors, math, diagrams, emoji, themes, folders, archives, settings |
| [import-relay.md](import-relay.md) 🛰️ | **The only server-side code in the product** — `/api/import`: what it does, its threat model, how to test it, its limitations, and how to harden it further |
| [integration-guide.md](integration-guide.md) 🔌 | **Embedding in a host app**: autosave/persistence contract, theming, default mode, deep links — read this first when integrating |
| [architecture.md](architecture.md) | The mental model — components, process model, design decisions |
| [auth.md](auth.md) | How identity/auth works (spoiler: it doesn't — and why that's OK) |
| [data-pipeline.md](data-pipeline.md) ⭐ | How content moves: ingest → sync → persist, and the fidelity model |
| [database.md](database.md) ⭐ | The IndexedDB "schema": stores, keys, record shapes, invariants |
| [data-contracts.md](data-contracts.md) | The `perssonify` data identifiers that must never be renamed, and why |
| [codebase-tour.md](codebase-tour.md) | Directory map and naming conventions |
| [i18n.md](i18n.md) | Interface translation: how to add a string or a language, the `en-XA` pseudo-locale |
| [local-development.md](local-development.md) | Getting productive: env, run modes, seed data, recipes |
| [workflows.md](workflows.md) | Branching, testing, CI/CD, deployment, observability |
| [domain-glossary.md](domain-glossary.md) | Vocabulary: canonical, residuals, fidelity, transclusion, … |
| [gotchas.md](gotchas.md) | Landmines, stale docs, dead code, perf cliffs |
| [runbooks/](runbooks/) | When things break: documents vanished, sync loop, quota exceeded |
| [audit-2026-09.md](audit-2026-09.md) | **What remains before launch** — the September 2026 production-readiness audit: all 114 findings with their status, the owner actions (accounts, settings, legal) and the deferred engineering work |
| [deployment.md](deployment.md) | What the repository does for a release, and what an owner must switch on (domain, CI gate, npm, CSP) |
| [deployment-todo.md](deployment-todo.md) | The launch checklist: what to switch on, in order, and what to check after every deploy |
| [decisions.md](decisions.md) | Recorded product and architecture decisions, and why |
| [backlog.md](backlog.md) | Planned features and the earlier audits' findings |
| [contributing.md](contributing.md) | How to propose changes |

## Release history & changelog

- **[../CHANGELOG.md](../CHANGELOG.md)** — versioned release notes (Keep-a-Changelog).
- **[v1-to-current-changelog.md](v1-to-current-changelog.md)** — the full feature delta from the
  initial import ("v1") to the current release, grouped by area — the doc to hand to anyone
  rebuilding or extending the app.

The app has **no authentication** by design (a former Vercel edge-middleware password gate was
removed — see [auth.md](auth.md)); its documents live in the visitor's browser storage.
