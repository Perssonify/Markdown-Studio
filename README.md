# Markdown Studio

> A dual-engine Markdown editor built with React, CodeMirror 6, and Tiptap 3 — featuring bidirectional sync, wiki links, a knowledge graph, and a three-layer document model.
>
> **Home:** [markdownstudio.com](https://markdownstudio.com) · Built by [Perssonify Labs](https://labs.perssonify.com/) · Ships as a standalone app **and** an embeddable library (`@perssonify/editor` — the npm coordinate is unchanged).

> **Lineage:** The archived predecessor is [SolutionPath/Markdown-Editor-V3](https://github.com/SolutionPath/Markdown-Editor-V3). This repository began as a history-clean import of predecessor `main` at `41e831e44b4a8830168b94d13e74c962e3bb0626` (`v1.70.0`) and is the active home of Markdown Studio.

> 📚 **Full engineering documentation lives in [`docs/`](docs/).** Start at [docs/README.md](docs/README.md). This file is a high-level overview; the `docs/` set is the living source of truth.


## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Browser support](#browser-support)
- [Getting Started](#getting-started)
- [Architecture](#architecture)
- [Features](#features)
- [Document Model](#document-model)
- [Sync Engine](#sync-engine)
- [Wiki Links and Knowledge Graph](#wiki-links-and-knowledge-graph)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Authentication](#authentication)
- [Integration API](#integration-api)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Deployment](#deployment)
- [The import relay](#the-import-relay)
- [Environment Variables](#environment-variables)
- [Contributing](#contributing)

---

## Overview

Markdown Studio is a **browser-based** markdown editor that runs two editing engines side by side: **CodeMirror 6** for raw markdown and **Tiptap 3** (ProseMirror) for rich text. Edits in either pane are synchronized bidirectionally through a canonical ProseMirror JSON layer, with content hashing to prevent echo loops.

The editor supports multi-document management with **nested folders**, wiki-style inter-document linking, a force-directed knowledge graph, selectable **Markdown flavors** (CommonMark/GFM/Markdown Extra), **LaTeX math (KaTeX)**, **Mermaid diagrams**, **ABC music**, emoji, a **theme/accent selector**, and import/export across markdown, HTML, JSON, and **ZIP/TAR archives**. Documents are persisted in the browser's IndexedDB — there is no account and no server copy; the only server code is an opt-in relay for "Import from URL" ([below](#the-import-relay)). After one online visit the app works offline. It ships two ways: as a standalone web app and as an embeddable npm library (`@perssonify/editor`). See [docs/extended-features.md](docs/extended-features.md) for the 2026 additions.

> **Before launch:** the September 2026 production-readiness audit and what still
> remains — mostly owner actions such as the domain, the CI gate on deploys and
> the npm scope — are in [docs/audit-2026-09.md](docs/audit-2026-09.md).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| UI Framework | React 18 |
| Markdown editor | CodeMirror 6 |
| Rich Text Editor | Tiptap 3.31 (ProseMirror) — every `@tiptap/*` package at one version |
| Markdown Parser | marked 12 |
| HTML-to-Markdown | Turndown 7 |
| State | Zustand 5 |
| Persistence | IndexedDB in the browser (no account, no server copy) |
| UI primitives | Base UI (menus, dialogs, popovers) |
| Build Tool | Vite 8 (Rolldown) + vite-plugin-pwa (service worker) |
| Test Framework | Vitest 4 + Testing Library; Playwright-driven Chromium, Firefox and WebKit for `e2e/` |
| Lint | ESLint 10 + typescript-eslint + React hook rules |
| Package Manager | Bun 1.4.0 (pinned by `packageManager`) |
| Deployment | Vercel (static SPA + one serverless function, the import relay) |
| Styling | Tailwind CSS v4 + shadcn/ui |

---

## Browser support

**Safari 16.4** or later (on iPhone and iPad, **iOS / iPadOS 16.4** — every
browser there uses Safari's engine), **Chrome or Edge 111** or later, and
**Firefox 128** or later. That is what the stylesheet and the code already
require: Tailwind v4 is built on `@property` and `color-mix()`, and the code
uses regex lookbehind. The same floor applies to the npm library, where the host
page decides what an older browser sees.

Below the floor the app and the iframe embed show a plain message naming these
versions instead of a blank page. It is decided by feature detection
(`CSS.registerProperty`, `color-mix()`, lookbehind), never by user agent, and it
stops the page before any app code runs: nothing stored in the browser is
touched, so a user's documents are there after they update. The boot watchdog,
which would otherwise read an old browser's errors as a broken deploy and clear
the offline caches, never runs there. See
[docs/gotchas.md](docs/gotchas.md#below-the-browser-floor-the-page-must-stop-itself--and-the-watchdog-must-stay-away).

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (canonical — `bun.lock` is committed and Vercel builds with Bun),
  at the version pinned by `packageManager` in `package.json`. Install with
  `bun install --frozen-lockfile` to get exactly the locked tree.
- Node.js 20+

### Install and Run

```bash
# Install dependencies (exactly the locked tree)
bun install --frozen-lockfile

# Start development server (localhost:5173)
bun run dev

# Type-check, lint (zero errors; warnings are the tracked backlog) and test
bunx tsc --noEmit
bun run lint
bun run test

# Build the standalone app (also writes dist-app/third-party-licenses.txt)
bun run build:app

# Preview production build
bun run preview

# Browser campaign against the build (see e2e/README.md)
bun run e2e
```

### Build Outputs

| Command | Output | Purpose |
|---------|--------|---------|
| `bun run build` | `dist/` | Library build (ESM + CJS) for embedding |
| `bun run build:app` | `dist-app/` | Standalone application for deployment |
| `bun run build:embed` | `dist-embed/` | Iframe embed shell (`index.html`, relative base) — see [docs/integration-guide.md §6](docs/integration-guide.md) |

---


## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    PerssonifyEditor.tsx                       │
│              Main orchestrator — wires everything            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ documentStore    │  │ useSyncEngine│  │ useLinkIndex   │  │
│  │ (Zustand)        │  │ MD ↔ HTML    │  │ Wiki links,    │  │
│  │ Docs, folders,   │  │ Hashing      │  │ backlinks,     │  │
│  │ autosave, IDB    │  │ Debounce     │  │ graph data     │  │
│  └────────┬────────┘  └──────┬───────┘  └───────┬────────┘  │
│           │                  │                   │            │
│  ┌────────▼──────────────────▼───────────────────▼────────┐  │
│  │                    Editor Panes                         │  │
│  │  ┌──────────────┐          ┌──────────────────────┐    │  │
│  │  │ CodeMirror 6 │  ← sync →│ Tiptap (ProseMirror) │    │  │
│  │  │ Markdown     │          │ Rich Text / Canonical│    │  │
│  │  └──────────────┘          └──────────────────────┘    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────┐ ┌─────────┐ ┌───────┐ ┌───────┐ ┌────────┐ │
│  │WorkspacePanel│ │ Toolbar │ │ Cards │ │ Graph │ │ Status │ │
│  └──────────────┘ └─────────┘ └───────┘ └───────┘ └────────┘ │
└──────────────────────────────────────────────────────────────┘
```

`WorkspacePanel` (the left-docked Files + Outline tray), `Cards` and `Graph` are the three
**workspace views** — Editor, Cards and Map are one exclusive selection, and Cards/Map mount as
overlays over the editor rather than replacing it. There is no tab strip.

See [docs/architecture.md](docs/architecture.md) for the full mental model, component breakdown, and ADRs.

### Key Design Decisions

- **Canonical source of truth** is ProseMirror JSON — not markdown, not HTML
- **Bidirectional sync** uses content hashing (`quickHash()`) to detect changes and prevent loops
- **Adaptive projection** — the other pane updates *while* you type, on delays derived from what a projection measurably costs on your device
- **Three-layer document model** separates origin, canonical, and residuals
- **Local-first** — documents in IndexedDB; no account, no server copy (the only server code is the opt-in import relay)

---

## Features

### Editing

- **Three view modes:** Markdown-only, Rich Text-only, Split (side-by-side)
- **Focus mode:** Distraction-free editing with minimal chrome
- **Text formatting:** Bold, italic, underline, strikethrough, superscript, subscript, monospace
- **Block formatting:** Headings (H1-H6), ordered/unordered lists, task lists, blockquotes, code blocks, horizontal rules
- **Tables:** Insert with grid picker, add/delete rows and columns, bubble menu for operations
- **Colors:** Text color and highlight color with opacity support
- **Font family** selector
- **Text alignment:** Left, center, right, justify — app-only; plain Markdown cannot record alignment, so it does not survive a round-trip or an export (the fidelity indicator flags it)
- **Indent / outdent:** list nesting, including checklists. Markdown has no paragraph indent, so both panes no-op outside a list (and inside a fenced block, where indentation is the code)
- **Links:** Inline link insertion with bubble menu for editing
- **Find and Replace:** Regex support, live preview with strikethrough/inline replacement, match navigation

Per-feature details with file references: [docs/features.md](docs/features.md).

### Sync Modes

| Mode | Behavior |
|------|----------|
| **Clean** | Standard markdown — decorative inline styles stripped |
| **Styled** | Preserves `<span style="...">` in markdown output |

Underline, super/subscript and image sizing are written as inline HTML in **both**
modes (`addBaseRules` in [src/engine/turndown-rules.ts](src/engine/turndown-rules.ts));
what **Styled** adds is the `<span style="…">` carrying colour, highlight and font
family (`addInlineStyleRule`). Text alignment has no carrier in either mode — see
[docs/features.md § 6](docs/features.md#6-colors-highlight-font-family-alignment).

The mode switch is in the **markdown** pane's header. **Paste Styled**, in the **rich** pane's header, is a separate and persisted preference, **on by default**: it keeps the formatting of what you paste. Hold **Shift** while pasting to invert it for that one paste.

### Document Management

- **Workspace panel** ([src/ui/WorkspacePanel.tsx](src/ui/WorkspacePanel.tsx)) — one left-docked
  tray with two tabs. **Files** is the library (nested folders, search over titles and content,
  new document / new folder, drag-and-drop file import, a select mode for bulk export and delete,
  and a per-document export menu); **Outline** is the live table of contents for the active
  document. It docks as a resizable column on desktop and a drawer on phones; toggle with
  `⌘⇧D`. There is **no tab strip** — you switch documents from the Files tab, and the active
  title is shown in the menu bar.
- **Three workspace views**, one exclusive selection: **Editor**, **Cards** (a board where every
  document is a card — `⌘⇧K`) and **Map** (the relationship graph — `⌘⇧G`). Cards and Map are
  full-canvas overlays; the editor stays mounted underneath.
- **Row actions** (hover ⋮ or right-click / long-press) on every document and folder: rename,
  duplicate, move to, export, delete.
- **Auto-save** every 5 seconds to IndexedDB (`AUTOSAVE_MS` in [src/constants.ts](src/constants.ts))
- **Version history:** Tools ▸ Version history restores an earlier version of a document, in place
  or as a copy, from a bounded per-document snapshot ring.
- **Session restore:** Automatically reopens the last active document

### Import / Export

| Format | Import | Export |
|--------|--------|--------|
| Markdown (.md, .markdown, .mdown, .txt) | Yes | Yes |
| HTML (.html, .htm) | Yes | Yes |
| JSON (ProseMirror / `perssonify-document` envelope) | Yes | Yes |
| Word (.docx) | Yes (lossy, via `mammoth`) | Yes |
| PDF | — | Yes (via print) |
| Archives (.zip, .tar, .tgz, .gz) | Yes | Yes (`.zip`, incl. a restorable full backup) |

- Max file size: 5MB per file
- **Import from URL** (File ▸ Import ▸ From URL…) fetches client-side, falling back to the
  same-origin `/api/import` relay only when the direct fetch is CORS-blocked
- Copy to clipboard: Markdown, HTML, or canonical JSON
- Download as file
- **Copy as Prompt:** Exports active document plus linked documents formatted for LLM context

### Theme

- **Light, Dark and System** modes (System is the app default) with Tailwind utility classes
- **Accent palette selector** — Amber (default), Blue, Violet, Emerald, Rose, Mono
  ([src/theme/palette.ts](src/theme/palette.ts)); orthogonal to light/dark
- **Glassmorphic** surfaces with backdrop-blur
- Persisted to localStorage (`perssonify-theme` for the mode; `pf:` keys for the rest)

### Responsive Design

- Below 768px the menu bar collapses to a single ☰ drill-down menu, and the split view
  **stacks vertically** when there is height for two panes (500px or more, or a phone held
  upright) — a landscape phone keeps them side by side
- Below 450px of height (400% zoom, a landscape phone) the page scrolls instead of
  squeezing the editor to nothing
- Safe area insets for notched devices (`viewport-fit=cover` + `.pf-safe-*` utilities)
- Compact toolbar on mobile

---

## Document Model

Each document uses a three-layer architecture (see [src/store/document.ts](src/store/document.ts)):

```
┌─────────────────────────────────┐
│  Origin Layer (immutable)       │
│  Raw input, format, source,     │
│  timestamp, alternates          │
├─────────────────────────────────┤
│  Canonical Layer (mutable)      │
│  ProseMirror JSON — the true    │
│  source of truth for content    │
├─────────────────────────────────┤
│  Residuals Layer                │
│  Content lost during ingest     │
│  (styles, unsupported syntax)   │
└─────────────────────────────────┘
```

**Persistence (IndexedDB — database `perssonify-docs`, see [docs/database.md](docs/database.md)):**
- Object store `documents` — keyed by document id
- Object store `meta` — holds `__manifest` (document index) and `__prefs` (last active doc, sync mode, editor mode)

---

## Sync Engine

The sync engine keeps CodeMirror and Tiptap in lockstep (see [src/engine/useSyncEngine.ts](src/engine/useSyncEngine.ts)):

```
MD pane edit → marked.parse(md) → HTML → Tiptap.setHTML(html) → PM JSON saved
                                                                        ↑ canonical

HTML pane edit → Tiptap PM JSON saved → Turndown(html) → MD → CM6.setValue(md)
                       ↑ canonical
```

- **Hash guard:** Each sync computes a 32-bit hash of content. If the hash matches the last known value, the sync is skipped (prevents echo loops).
- **Adaptive scheduling:** two delays, both derived from a moving average of what recent projections actually cost on this device rather than from the document's length. The *idle delay* (120–800ms) is how long after your last keystroke the other pane updates; the *max-wait ceiling* (250–1200ms) is the longest it may lag while you keep typing. Without that ceiling the debounce was purely trailing — every keystroke reset it — so during continuous typing the other pane never updated at all. See [src/hooks/sync-schedule.ts](src/hooks/sync-schedule.ts).
- **Undo awareness:** `Cmd+Z` cancels any pending sync to prevent undo stack corruption.

Full pipeline (ingest → sync → persist): [docs/data-pipeline.md](docs/data-pipeline.md).

---

## Wiki Links and Knowledge Graph

### Wiki Link Syntax

```markdown
[[Document Title]]           # Resolved by title (case-insensitive)
[[doc-id|Display Text]]      # Resolved by ID with custom display text
```

### Link Index

The link index ([src/store/link-index.ts](src/store/link-index.ts)) maintains four maps (in memory, not persisted):

| Map | Purpose |
|-----|---------|
| `forward` | docId → Set of linked target IDs |
| `reverse` | docId → Set of documents linking to it (backlinks) |
| `unresolved` | docId → targets that don't match any document |
| `contexts` | "srcId→tgtId" → surrounding text for context |

### Graph Visualization

The knowledge graph is a **full-screen relationship map** of the whole workspace —
documents, wiki links, and folder clusters. Open it from the **Editor · Cards · Map**
switcher in the top bar, **View → Relationship map**, **⌘⇧G**, or the `/graph` route.

**Layout — three docked regions, nothing floats over the canvas.** A header, the map
with a slim footer strip (legend, zoom, Fit), and a details rail: a right column on wide
screens, a docked bottom sheet below that. The map pane measures only its own box, so
"fit to content" frames the map you can actually see. (An earlier build pinned the
inspector *over* the canvas while the camera fitted content to the full rect — the graph
centred itself underneath the panel.)

- **Rendering:** SVG with a force-directed simulation, no external library. Physics runs
  in its own world space, so resizing a panel re-aims the camera instead of reshuffling
  the graph. A decaying `alpha` makes convergence deterministic.
- **Camera is overview-first** — if the whole workspace fits legibly it frames
  everything; only a workspace too large falls back to the active note's neighbourhood.
- **Nothing is ever drawn over text.** Every label is placed in screen space against
  everything already positioned, trying four positions and then a compact form; a label
  with nowhere to go is dropped rather than overlapped (the note is still named in the
  rail and on hover). Verified in a browser across 3–153 note workspaces, desktop and
  phone widths, at three zoom levels.
- **Everything drawn is sized in screen pixels**, so zoom changes how far apart notes
  are, not how big a note looks.
- **Folders are containers with a legend chip**, kept off each other and off notes that
  do not belong to them by a positional constraint, not a soft force.
- **The rail is the information layer:** the selected note's folder, headings, both link
  directions as clickable documents, and its broken links. With nothing selected it is a
  workspace overview — most connected, unlinked, broken links.
- **Interaction:** click = select, double-click / Enter = open, drag = rearrange,
  wheel / footer buttons / Fit = camera.
- **Utilities:** header search that dims non-matches without disturbing the layout;
  orphan and broken-link filter chips; JSON export from the map's own header.
- **Performance:** above 60 notes the layout advances several simulation steps per
  rendered frame — the frame, not the physics, is the expensive half. Measured at 153
  notes: 108 rendered frames / 5.6s / 3.9s blocking → 35 frames / 2.3s / 1.7s.

### Backlinks Panel

Shows incoming links, outgoing links, and unresolved references for the active document. Each entry is clickable for navigation.

---

## Keyboard Shortcuts

### General

| Shortcut | Action |
|----------|--------|
| `Cmd+S` | Save |
| `Cmd+N` | New document |
| `Cmd+F` | Find |
| `Alt+Cmd+F` | Find & Replace (also `Ctrl+H` on Windows/Linux) |
| `Cmd+Shift+F` | Search all notes |
| `Cmd+Shift+D` | Toggle workspace panel |
| `Cmd+Shift+K` | Toggle cards board |
| `Cmd+Shift+G` | Toggle relationship map |

### Formatting (Markdown Pane)

| Shortcut | Action |
|----------|--------|
| `Cmd+B` | Bold |
| `Cmd+I` | Italic |
| `Cmd+U` | Underline |
| `Cmd+E` | Inline code |
| `Cmd+K` | Insert link |
| `Cmd+Shift+X` | Strikethrough |
| `Cmd+Shift+H` | Highlight |
| `Cmd+Shift+1` through `6` | Heading H1–H6 |
| `Cmd+Shift+0` | Remove heading |
| `Cmd+Shift+7` | Ordered list |
| `Cmd+Shift+8` | Unordered list |
| `Cmd+Shift+9` | Blockquote |
| `Cmd+]` / `Cmd+[` | Indent / Outdent a list item |
| `Cmd+Shift+L/E/R/J` | Align left/center/right/justify (rich pane; not carried by Markdown) |

Bindings: [src/hooks/useKeyboardShortcuts.ts](src/hooks/useKeyboardShortcuts.ts). The documented
list (Help page, shortcut dialogs, menu hints) is single-sourced from
[src/data/shortcuts.ts](src/data/shortcuts.ts).

---

## Authentication

**There is none.** This is a local-first, single-user, client-only app. There is no login, no session, no roles, and no server to authenticate against — all data lives in the visitor's own browser (IndexedDB / localStorage).

> An earlier version had a Vercel edge-middleware password gate; it was **removed** (commit `84d7099`, "remove login form and authentication logic"). There is no `middleware.ts`, no `MARKDOWNEDITOR_PASSWORD`, and no auth code in `src/`. If you embed the editor and need access control, enforce it in the host application.

Full details and the one real cross-boundary surface (the iframe `postMessage` bridge and its `allowedOrigins` setting): [docs/auth.md](docs/auth.md).

---

## Integration API

The editor can be embedded in external applications via the library build.

> **📖 Full embedding guide: [docs/integration-guide.md](docs/integration-guide.md)** — the
> authoritative reference for **autosave/persistence, theming, default view mode,
> and deep links**. Read it first if you're integrating the editor into a host app.

### Install

```bash
npm install @perssonify/editor
```

The package ships ES and CommonJS builds, TypeScript declarations and one
stylesheet. React 18, Tiptap 3 (3.31 or later, as one matching set), CodeMirror 6,
lucide-react, next-themes and zustand are **peer dependencies**: npm 7+ installs
them for you; with pnpm, Yarn or `--legacy-peer-deps`, add them yourself
(`npm view @perssonify/editor peerDependencies` lists the exact ranges). The
Markdown and rendering libraries — marked, turndown, KaTeX, Mermaid, abcjs, docx,
mammoth and the rest — are ordinary dependencies that your bundler resolves and
dedupes against any copy you already have; the heavy renderers stay lazy chunks
that load the first time a document needs them.

Import two stylesheets once, at your app root:

```js
import '@perssonify/editor/styles.css';  // the editor — safe to import, see "Style isolation"
import 'katex/dist/katex.min.css';       // math: without it every formula renders twice, unstyled
```

`katex` is installed as a dependency of this package. Under pnpm's strict
`node_modules` layout your own code cannot import it until you add it to your
dependencies (`pnpm add katex@^0.18`).

```jsx
import { PerssonifyEditorIntegration } from '@perssonify/editor';
import '@perssonify/editor/styles.css';   // safe to import: see "Style isolation" below
import 'katex/dist/katex.min.css';

function App() {
  return (
    <PerssonifyEditorIntegration
      isDark={hostIsDark}
      accent="violet"                 // or accentColor="#7c3aed" (scoped to the editor)
      initialMode="split"             // "split" | "md" | "html"
      onContentChange={(p) => myBackend.saveDraft(p.docId, p.canonical)}  // host autosave
      onLinkClick={(e) => { if (e.kind === 'external' && !e.external) { router.go(e.href); return true; } }}
    />
  );
}
```

### Autosave & persistence (important)

The editor **autosaves the canonical document to browser storage** (IndexedDB, with
fallbacks) ~5s after editing stops — this is **local-only and works in an embed with
no configuration**. It never pushes to the host by itself (privacy by design).

To persist into **your** app/backend, the host does one of:

- **Subscribe to `onContentChange`** (debounced ~300ms) and save wherever you want —
  this is how a host "autosaves". `onSave` fires only on an explicit user save (⌘S / Save).
- **Inject `storageAdapter`** (or `storageConfig`) to make the editor persist *through you*.

If content isn't reaching your store, wire `onContentChange` (or a `storageAdapter`) —
the editor cannot push to an external system on its own. See the
[integration guide](docs/integration-guide.md#1-persistence--autosave--who-owns-what).

### Imperative Handle (`ref` / `onReady`)

```javascript
editorRef.current.getCanonicalDocument()  // ProseMirror JSON
editorRef.current.getMarkdown()           // { md, fidelityReport }
editorRef.current.getHTML()               // Current HTML string
editorRef.current.getGraph()              // Link graph (wiki + associations)
editorRef.current.getDocuments() / .getActiveDocument() / .getAssociations(docId?)
editorRef.current.importContent(content, format) / .setDocuments(docs)
editorRef.current.setTheme('dark'|'light'|bool) / .setMode('split'|'md'|'html') / .setAccent(id)
editorRef.current.setAssociations(...)
editorRef.current.exportAs(format) / .copyAsPrompt(opts)
```

### Style isolation

`@perssonify/editor/styles.css` will not restyle your page. The editor is built on
Tailwind, whose preflight is a *global* reset — appropriate for the standalone app
and the iframe embed, which own their document, and not for a stylesheet you import
into an application that already has styles of its own. The library build therefore
confines everything in the `base` layer to the editor's own subtrees:

| Scope root | What it covers |
| --- | --- |
| `.perssonify-editor` | the editor container itself, on every mount |
| `[data-pf-root]` | the `PerssonifyEditorIntegration` wrapper around it (carries `isDark`, `accent`, `accentColor`, `themeVars`) |
| `.pf-app` | the standalone app and iframe embed shells |
| `[data-base-ui-portal]`, `[data-sonner-toaster]` | menus, dialogs, sheets, tooltips, toasts — these portal to `document.body`, outside the container |
| `[data-pf-portal]` | the few surfaces the editor attaches to `document.body` itself |

Your headings keep their size and weight, your links keep their underline, your
elements keep their margins and `box-sizing`.

The editor's **design tokens** (`--background`, `--primary`, `--border`,
`--radius`, … and Tailwind's own theme variables) are *defined on those roots*,
never on your `:root` or `.dark` — so a shadcn / Tailwind app keeps its own tokens
of the same names, and your `<html class="dark">` does not recolour itself with the
editor's palette. The portalled menus and dialogs are roots too, so they are themed
along with the editor. Theme the editor through its props (`isDark`, `accent`,
`accentColor`, `themeVars`) rather than by setting those names on `:root`. Rules
that only make sense for a page the editor owns — hiding the page scrollbar, for
one — apply only where `<html>` carries `.pf-app`, which a host page does not.

One limit: `[data-base-ui-portal]` and `[data-sonner-toaster]` are attributes those
libraries put on *every* portal, so if your own app also uses Base UI or sonner,
your menus and toasts sit inside the scope as well.

The scoping is applied by the library build only, and is pinned by
`src/__tests__/scope-css.test.js` and the browser case `e2e/cases/library.mjs`.

### Integration Props

| Prop | Type | Purpose |
|------|------|---------|
| `isDark` | `boolean` | Light/dark mode |
| `accent` | `string` | Preset accent palette (`amber`\|`blue`\|`violet`\|`emerald`\|`rose`\|`mono`) |
| `accentColor` | `string` | Custom accent color → `--primary` (scoped to the editor subtree) |
| `themeVars` | `Record<string,string>` | Arbitrary scoped CSS-var overrides (highest precedence) |
| `initialMode` | `"md"\|"html"\|"split"` | View mode at open (user's stored choice wins later) |
| `initialDocument` | `{ title?, content }` | Seed doc when the store is empty |
| `onContentChange` | `(payload) => void` | **Debounced change event — use for host autosave** |
| `onSave` | `(payload) => void` | Fires only on explicit user save (⌘S / Save button) |
| `storageAdapter` / `storageConfig` | adapter / config | Host-controlled persistence |
| `onStorageMetricsChange` / `onStorageQuotaExceeded` | callbacks | Storage usage / quota |
| `onChange` | `(data) => void` | Canonical-change event (fires on every edit) |
| `onLinkClick` | `(e) => boolean\|void` | All link activations (`{kind:"doc"\|"external"}`); return `true` to handle deep links yourself |
| `onGraphUpdate` | `(graph) => void` | The link graph changed |
| `onReady` | `(handle) => void` | Receives the imperative handle |
| `associations` | data | External edges merged into `getGraph()` |
| `allowedOrigins` | `string[]` | postMessage origins for iframe embeds (default `[]` = deny all cross-origin host messages) |

#### Deprecated — accepted, but they do nothing

Kept so existing hosts still compile; each logs one console warning in development
builds when used, and will be removed in a future major version.

| API | Status |
|-----|--------|
| `fieldSchemas` prop, `setFieldSchemas()` | No effect — the editor has no field-schema feature. |
| `linkResolver` prop | Never called — wiki links resolve against the editor's own documents. Map a link into your app from `onLinkClick` (`kind: "doc"` carries the target title and id). |
| `onFieldChange`, `onExport` props | Never fired. `exportAs()` resolves when its download has been triggered. |
| `documents` prop | Never read — seed documents with `addDocuments()`. |
| `BlockId`, `FieldBlock`, `TransclusionBlock` exports | Not registered by the editor, and block ids do not survive a Markdown round trip. They still work in a Tiptap editor of your own. |

For the iframe `postMessage` bridge (`createHostBridge` / `createEditorClient`), see [src/integration/host-bridge.ts](src/integration/host-bridge.ts), [docs/integration-guide.md](docs/integration-guide.md#cross-origin-iframe-embeds), and [docs/architecture.md](docs/architecture.md#embedding--integration).

---

## Project Structure

```
markdown-studio/
├── vercel.json                     # Deployment config (static SPA, Bun build)
├── api/
│   └── import.js                   # The ONLY server code — same-origin import relay
│                                   #   (docs/import-relay.md)
├── build/
│   └── scope-css.mjs               # Confines the reset to the editor (LIBRARY build only)
├── package.json                    # Dependencies and scripts
├── vite.config.ts                  # Library build config (dist/)
├── vite.app.config.ts              # App build config (dist-app/)
├── vite.embed.config.ts            # Iframe-embed build config (dist-embed/)
├── vitest.config.js                # Test config
│
└── src/
    ├── main.tsx                   # App entry point
    ├── App.tsx                    # App shell (ErrorBoundary + header + editor)
    ├── index.tsx                  # Library entry point
    ├── PerssonifyEditor.tsx       # Main orchestrator
    ├── EditorHeader.tsx           # Top navigation bar
    ├── constants.ts               # App name, version, config
    ├── styles.css                 # Global styles
    │
    ├── data/                      # Static copy/data
    │   ├── shortcuts.ts           # Single source for shortcut documentation
    │   ├── starter-documents.ts   # First-run seeded library (standalone app only)
    │   └── credits.ts             # About-page credits
    │
    ├── engine/                    # Markdown / HTML processing
    │   ├── useMarkdownEngine.ts   # marked + Turndown initialization
    │   ├── useSyncEngine.ts       # Bidirectional sync with hashing
    │   ├── build-marked.ts        # Per-instance marked config (flavors, features)
    │   ├── serialize-doc.ts       # Headless canonical → MD/HTML (must mirror the live schema)
    │   ├── preprocessor.ts        # Field blocks, transclusions, block IDs
    │   ├── html-cleaner.ts        # Paste sanitization
    │   └── turndown-rules.ts      # Custom Turndown serialization rules
    │
    ├── store/                     # State + persistence
    │   ├── documentStore.ts       # Zustand store (docs, active doc, save status)
    │   ├── uiStore.ts             # View mode, toggles, sync mode
    │   ├── editorStore.ts         # Formatting state, link index, graph
    │   ├── document.ts            # Three-layer document model
    │   ├── storage-adapter.ts     # Storage backend abstraction
    │   ├── idb-storage-adapter.ts # IndexedDB implementation
    │   ├── link-index.ts          # Wiki link graph builder
    │   ├── graph-metrics.ts       # PURE map layer: placeLabels, folderRects, stepsPerFrame
    │   ├── url-import.ts          # Import from URL + the relay fallback
    │   ├── import-url-normalize.ts# Provider share links → raw-download links
    │   ├── ingest.ts              # Format detection and normalization
    │   ├── import-export.ts       # File I/O handlers
    │   ├── archive.ts             # ZIP/TAR extraction + path safety
    │   ├── snapshot-store.ts      # Recoverable version snapshots (sidecar IDB)
    │   └── fidelity.ts            # Serialization loss analysis
    │
    ├── ui/                        # React components
    │   ├── CodeMirrorPane.tsx     # CM6 markdown editor
    │   ├── TiptapPane.tsx         # Tiptap rich text editor
    │   ├── EditorPanes.tsx        # Pane layout + scroll sync
    │   ├── Toolbar.tsx            # Format toolbar
    │   ├── MenuBar.tsx            # File/Edit/Insert/View/Format/Tools/Help
    │   ├── WorkspacePanel.tsx     # Left-docked Files + Outline tabs
    │   ├── FolderTree.tsx         # Nested folder/document tree
    │   ├── FindReplace.tsx        # Find and replace (draggable panel)
    │   ├── GraphView.tsx          # Relationship map — docked header/map/rail (SVG)
    │   ├── CardsView.tsx          # Cards board over the whole library (overlay)
    │   ├── BacklinksPanel.tsx     # Backlink / forward link panel
    │   ├── BottomTray.tsx         # Tabbed tray (links + admin console)
    │   ├── VersionHistorySheet.tsx# Recoverable snapshots
    │   ├── StatusBar.tsx          # Word count, save status, import-fidelity chip
    │   ├── ResidualsDialog.tsx    # What an import could not represent, in plain language
    │   ├── LinkBuilder.tsx        # The ONE share/embed link builder (Tools + Help)
    │   ├── UrlImportDialog.tsx    # Import from URL (discloses relay use)
    │   ├── ModeSwitcher.tsx       # MD / HTML / Split toggle
    │   ├── Toast.tsx              # Notification system
    │   ├── Icons.tsx             # SVG icon library
    │   ├── LinkBubbleMenu.tsx     # Link editing popup
    │   ├── TableBubbleMenu.tsx    # Table operations popup
    │   ├── TableGridPicker.tsx    # Table size selector
    │   └── ErrorBoundary.tsx      # Error boundary
    │
    ├── hooks/                     # Custom React hooks
    │   ├── useKeyboardShortcuts.ts # Global shortcut handler
    │   ├── useLinkIndex.ts         # Link graph hook
    │   ├── useDocumentLifecycle.ts # Document lifecycle / debounced sync
    │   ├── useDialogs.ts           # Promise-based prompt/confirm
    │   ├── useActiveHeading.ts     # Read-only active-heading tracker (Outline)
    │   └── use-mobile.ts           # Responsive breakpoint
    │
    ├── formatting/                # Text formatting logic
    │   ├── useFormatDispatcher.ts  # Routes commands to active pane
    │   ├── md-format-utils.ts      # CM6 markdown formatting
    │   └── md-table-ops.ts         # Markdown table operations
    │
    ├── theme/                     # Theming
    │   ├── index.ts              # Dark/light theme (createTheme)
    │   ├── useThemeMode.ts       # Effective theme (honours a pinned forcedTheme)
    │   └── palette.ts            # Accent palettes + sanitizeCssColor
    │
    ├── extensions/                # Custom Tiptap nodes / marks
    │   ├── WikiLink.ts            # Link mark that preserves [[wiki]] attrs
    │   ├── MathNodes.tsx          # KaTeX inline/block math
    │   ├── Callout.ts             # > [!NOTE] admonitions
    │   ├── Details.ts             # Collapsible <details>/<summary>
    │   ├── ThemeImage.tsx         # <picture> theme-aware images
    │   ├── FieldBlock.ts          # :::fields ... ::: metadata blocks (authoring-only)
    │   ├── TransclusionBlock.ts   # ![[target]] embed syntax (authoring-only)
    │   └── BlockId.ts             # ^block-id annotations (authoring-only)
    │
    ├── integration/              # External embedding API
    │   ├── PerssonifyEditorIntegration.tsx  # Integration component + handle
    │   ├── host-bridge.ts        # iframe postMessage bridge
    │   ├── prompt-builder.ts     # LLM prompt formatting
    │   └── associations.ts       # External link merging
    │
    ├── ui/pages/                 # Routed interior pages (About, Help, PageChrome)
    │
    ├── utils/
    │   ├── diag.ts               # Diagnostic logging ([DIAG] prefix)
    │   └── index.ts              # Shared utilities (quickHash)
    │
    └── __tests__/               # Unit tests
```

Annotated map and a "where does X live?" table: [docs/codebase-tour.md](docs/codebase-tour.md).

---

## Testing

```bash
bun run test           # Run all tests once
bun run test:watch     # Watch mode
bun run test:coverage  # Coverage over ALL of src/ (generated shadcn primitives excluded); html in coverage/
```

> Test files must be named `*.test.js` or `*.test.jsx` — the Vitest `include` glob is
> `src/__tests__/**/*.test.{js,jsx}` ([vitest.config.js](vitest.config.js)). A `.ts` test is
> silently ignored — it runs nowhere and fails nothing; a test that renders JSX must be `.jsx`.

The suite is **2,126 tests across 196 files** (`bunx vitest run --maxWorkers=3`,
September 2026). Browser-level coverage (real IME composition, real IndexedDB, quota
exhaustion, blocked storage, a second tab, coarse pointers, the published library on a
host page, the Content-Security-Policy enforced, offline after one visit) lives in
[`e2e/`](e2e/) — `bun run e2e`, and [`e2e/README.md`](e2e/README.md) states what it does
*not* cover. A sample of the unit suites in [src/__tests__/](src/__tests__/):

| Test Suite | Covers |
|------------|--------|
| `md-format-utils` | Markdown wrapping, prefix toggling |
| `md-table-ops` | Table row/column insert and delete |
| `document` | Document model creation and serialization |
| `sync-engine` | Bidirectional sync, hash guards |
| `link-index` | Wiki link parsing, backlink resolution |
| `fidelity` | Serialization loss detection |
| `converter-roundtrip` | md → rich → md′ → rich → md″ through the real engine and schema |
| `smoke` | Component renders without crashing |
| `serialize-doc` | Headless export round-trips (schema parity) |
| `workspace-views` | Editor / Cards / Map stay one exclusive selection |
| `app-identity` | Product name is consistent; data identifiers are unchanged |

CI runs on every PR to `main` and every push to it via GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)): lint, `bunx tsc --noEmit`, `bun run test`, the app/library/embed builds and the browser campaign, including the `csp` and `pwa` suites. Run the same gate locally before pushing. **CI does not yet block a deploy** — Vercel deploys `main` on its own until branch protection and deployment checks are switched on ([docs/deployment.md](docs/deployment.md)). See [docs/workflows.md](docs/workflows.md).

---

## Deployment

### Vercel

The app deploys to Vercel as a static Vite SPA. There is no middleware and no server-rendered
code; the one serverless function is [`api/import.js`](api/import.js), the same-origin fallback
relay for "Import from URL" — **the only server-side code in the product**. Full developer
guide, threat model, limitations and hardening roadmap:
**[docs/import-relay.md](docs/import-relay.md)**.

**Configuration** ([vercel.json](vercel.json)):
- Install command: `bun install --frozen-lockfile`
- Build command: `bun run build:app && node scripts/strip-sourcemaps.mjs` — the build writes
  the third-party licence notice from its hidden sourcemaps, then the maps are moved out of
  the deploy
- Output directory: `dist-app/`
- SPA rewrites: every route **except** `/api/*`, `/assets/*` and `/.well-known/*` →
  `/index.html` (the relay stays reachable, and a missing chunk is a 404 rather than the app
  page)
- Headers: a Content-Security-Policy in report-only mode (hash-pinned — editing an inline
  script means updating the hash), enforced anti-framing on everything but `/embed.html`,
  `nosniff`, `Referrer-Policy: no-referrer` and a restrictive `Permissions-Policy`;
  `/assets/*` is cached as immutable
- `Cache-Control: no-cache` on `sw.js`, `sw-recover.js`, `index.html` and
  `manifest.webmanifest`, so a cached service worker can't pin visitors to an old build
- The service worker **prompts** for updates ("Update ready — Reload"); it never reloads an
  open tab by itself while there is work to lose

Production is not yet gated on CI; the owner steps (domain, branch protection, Vercel
deployment checks, npm) are in [docs/deployment.md](docs/deployment.md).

### Manual Deployment

```bash
bun run build:app
# Deploy the dist-app/ directory to any static host
# (a static host has no /api/import relay, so CORS-blocked "Import from URL"
#  fetches lose their fallback; direct fetches still work)
```

Deploy troubleshooting: [docs/runbooks/deploy-broken.md](docs/runbooks/deploy-broken.md).

---

## The import relay

**Where a developer should look:** [`api/import.js`](api/import.js) is the entire
server side of this product — one Vercel Serverless Function. The client that calls it
is `fetchDirectOrProxy` in [`src/store/url-import.ts`](src/store/url-import.ts); its
tests are [`src/__tests__/import-relay.test.js`](src/__tests__/import-relay.test.js).

**What it does.** "Import from URL" tries a direct browser `fetch` first. Some hosts
refuse cross-origin reads — Google Drive sends no CORS headers to a browser at all — so
on a CORS failure the client can retry through `/api/import?url=…`, which fetches the URL
server-side and returns the bytes. **It asks first**: the relay is used only after the
user agrees, once, and the answer is remembered (`pf:import-relay`; Settings ▸ Privacy).
It runs on the app's own origin, so no third party sees the request; a public CORS proxy
would hand a third party the URL, the bytes and the user's IP.

**Why most of the file is refusals.** An unauthenticated endpoint that fetches an
arbitrary URL is an SSRF gadget, an open proxy and an XSS vector at the same time. It
resolves DNS and connects only to GLOBAL-UNICAST addresses (an allowlist, which also
refuses the IPv4-in-IPv6, NAT64, 6to4 and Teredo wrappers that are the classic
bypasses), pins the vetted IPs to the connection so it cannot be rebound between check
and connect, re-validates every redirect hop, allows only ports 80 and 443, caps the body
at 4 MB and the time at 25 s, writes one log line per request with the host only, and
never reflects the upstream `Content-Type`, because doing so let an attacker render HTML
on this origin.

**Its limits are real and documented**, not hand-waved: `Sec-Fetch-Site` stops other web
pages but not a script, so to non-browser clients it is a bounded proxy whose real abuse
controls are the platform's (a firewall rate limit and spend alerts — owner setup); the
in-code rate limit is per warm instance, `x-forwarded-for` is trusted, redirect chains are
not covered end to end by tests, and a static (non-Vercel) deployment has no relay at all.

📖 **[docs/import-relay.md](docs/import-relay.md)** — the full guide: request path,
threat model control by control, how to run and test it, every limitation, and a
prioritised list of what to do next if you want it more effective or more hardened.

---

## Environment Variables

**Two, both optional and build-time; no secrets and no `.env`.**
`VITE_EMBED_ALLOWED_ORIGINS` (comma-separated origins, embed builds only) is the allowlist
of host pages the iframe embed's bridge will talk to — set it for any embed deployment
served from an origin that holds user documents
([docs/integration-guide.md](docs/integration-guide.md)). `VITE_PERSSONIFY_DIAG=true`
turns on the `[DIAG]` console tracing that is otherwise off (`?diag=1` or
`localStorage.perssonify-diag = "1"` do the same at run time). Runtime configuration (debounce, autosave, etc.) lives in
[src/constants.ts](src/constants.ts) and component props; see
[docs/local-development.md](docs/local-development.md#environment-variables).

---

## Contributing

1. Create a feature branch from `main` (`feat/*` or `fix/*`)
2. Make changes and add tests where appropriate (test files end in `.test.js` / `.test.jsx`), then mutation-test each new guard: revert the fix, confirm the case goes red, restore
3. Run `bunx tsc --noEmit`, `bun run lint`, `bun run test`, `bun run build:app`, `bun run build`, `bun run build:embed` and `bun run e2e` to verify
4. Submit a pull request with a clear description of changes

Full contributor guide (standards, dependencies, what not to touch): [docs/contributing.md](docs/contributing.md). When making significant changes, update the relevant docs under [`docs/`](docs/).

---

## Changelog

- [CHANGELOG.md](CHANGELOG.md) — versioned release notes (Keep-a-Changelog), newest first.
- [docs/v1-to-current-changelog.md](docs/v1-to-current-changelog.md) — the full, area-grouped feature delta from the initial import ("v1") to the current release. Hand this to anyone rebuilding or extending the app.

New engineers: start with [HANDOVER.md](HANDOVER.md).

---

*Built by [Perssonify Labs](https://github.com/SolutionPath)*
