# Markdown Studio: Product Overview

> Written from the source code at version **1.77.0** ([package.json](package.json)) on 2026-09-28, and revised on 2026-09-29 against the fixes that followed the production-readiness audit of that release; defects those fixes closed were removed from §7.
> README, `docs/`, `marketing/`, the in-app Help text and code comments were treated as claims to check, not as evidence. Where they disagree with the code, the code wins and the disagreement is listed in [§7.3](#73-docs-and-in-app-text-that-promise-more-than-the-code-does).
> Tech stack and architecture are covered in [ONBOARDING.md](ONBOARDING.md). Line numbers are a snapshot and will drift.
>
> Most findings come from reading the code. The app was not run in a browser for this document. One finding was confirmed by running the pinned parsing library (a nested-checklist defect, since fixed).

Every feature below carries one of four statuses:

| Status | Meaning |
|---|---|
| **Done** | A user (or, for developer features, a host app) can reach it, and it does the whole job. |
| **Partial** | Reachable, but part of the behaviour is missing, lossy, or works in only one pane or context. |
| **Stub** | The control exists but does nothing real: a placeholder or a no-op. |
| **Dead** | The code exists, but nothing a user or host can reach invokes it. |

---

## 1. Pitch

Markdown Studio is a private Markdown workspace from Perssonify Labs that runs in the browser. Every document is shown twice: raw Markdown in one pane and formatted rich text in the other. An edit in either pane updates the other, so a Markdown writer and someone who wants a word-processor view can work on the same file. Documents are stored in the browser itself, with no account, no sign-up and no copy on a server. Around the editor sits a small personal knowledge base: folders, `[[wiki links]]`, backlinks, a relationship map and a Keep-style cards board. Import and export cover Markdown, HTML, Word, PDF (via the print dialog) and ZIP backups. The same editor also ships as an npm component and an iframe embed, so developers can put it inside their own apps. The problem it solves: Markdown is portable but hard to read and format by hand, while rich-text editors are easy but keep your words in their own format and their own cloud. Markdown Studio keeps one document in both forms, on the user's own machine.

Grounded in: name and home page in [src/constants.ts](src/constants.ts), dual pane in [src/ui/panes/editorPanes/index.tsx](src/ui/panes/editorPanes/index.tsx), browser storage in [src/store/persistence/idb-storage-adapter.ts](src/store/persistence/idb-storage-adapter.ts), and the library and embed entry points in [src/index.tsx](src/index.tsx) and [src/embed.tsx](src/embed.tsx).

## 2. Product type and stage

**Category.** A local-first productivity web app that can be installed as a PWA: a Markdown editor with personal-knowledge-base features. It is also distributed as an embeddable editor component for developers. It is **not SaaS**. There are no accounts, no tenants and no server-side document storage.

| What the code shows | Evidence |
|---|---|
| Documents are stored only in the browser, per browser profile: IndexedDB `perssonify-docs`, plus `perssonify-snapshots` for version history. | [src/store/persistence/idb-storage-adapter.ts](src/store/persistence/idb-storage-adapter.ts), [src/store/history/snapshot-store.ts](src/store/history/snapshot-store.ts) |
| There is one server function, and it exists only for Import from URL, which uses it only with the user's consent. | [api/import.js](api/import.js), [vercel.json](vercel.json), [src/store/importExport/url-import.ts](src/store/importExport/url-import.ts) |
| Three distributions ship from one codebase. | Standalone app: [index.html](index.html) → [src/main.tsx](src/main.tsx) → [src/App.tsx](src/App.tsx). Iframe embed: [embed.html](embed.html) → [src/embed.tsx](src/embed.tsx). npm package `@perssonify/editor`: [src/index.tsx](src/index.tsx) plus the `exports` map in [package.json](package.json). |
| The app is installable, with a manifest and a service worker. | [vite.app.config.ts](vite.app.config.ts) |

**Stage: production, a mature 1.x release, not yet monetized.** The standalone app is the most complete surface. The iframe embed and parts of the host API are noticeably less finished (§4.12).

- **Release history.** Version 1.77.0, with 30 release entries in [CHANGELOG.md](CHANGELOG.md) running from 1.4.x.
- **Deployment.**
  - [vercel.json](vercel.json) is a Vercel deploy config, and `APP_URL = https://markdownstudio.com` in [src/constants.ts](src/constants.ts).
  - A QA script drives the live site ([scripts/live-preview-walkthrough.mjs](scripts/live-preview-walkthrough.mjs)).
  - Whether that site runs this exact build cannot be verified from code.
- **Test investment.**
  - 196 Vitest files with about 2,100 test cases ([src/\_\_tests\_\_](src/__tests__)).
  - 12 real-browser suites ([e2e/cases](e2e/cases)) covering IME composition, real IndexedDB, quota exhaustion, a second tab, fault injection, an enforced Content-Security-Policy, and offline use and updates through the service worker.
  - CI runs all of them except the timing suite on every PR (the stress suite only on pushes to `main`), together with lint, a type-check and three builds ([.github/workflows/ci.yml](../../.github/workflows/ci.yml)).
  - [e2e/README.md](e2e/README.md) states plainly what is not covered.
- **Data-loss engineering.** Five protections: a hydration guard, an empty-save backstop, crash recovery, snapshot history and multi-tab conflict detection — plus, against the browser clearing its storage, a persistent-storage request, a backup reminder and wiped-library detection (§4.5).
- **Operations.**
  - Prompted updates and stale-deploy self-healing: [src/pwa/sw-updates.ts](src/pwa/sw-updates.ts), [index.html](index.html), [src/main.tsx](src/main.tsx), [public/sw-recover.js](public/sw-recover.js).
  - A local, redacted error log the user can copy: [src/utils/diagnostics.ts](src/utils/diagnostics.ts).
  - A security policy with private disclosure: [SECURITY.md](../../SECURITY.md).
  - Issue templates: [.github/ISSUE_TEMPLATE](../../.github/ISSUE_TEMPLATE).
- **Against "launched commercial product":**
  - The ad slots are placeholders, and only development builds render them ([src/ui/shared/adUnit/index.tsx](src/ui/shared/adUnit/index.tsx), [src/utils/build-gates.ts](src/utils/build-gates.ts)).
  - There is no analytics or telemetry, so no product usage data is collected.
  - There are no accounts or sync.
  - The iframe embed is built in CI but not deployed ([vercel.json](vercel.json) builds only the app).

## 3. Users and roles

The code has **no authentication, no user model, no roles and no tenancy**: no login, no session, no permission checks. The unit of isolation is the browser profile, and each profile has its own library. As a result, a shared link carries *settings*, never documents. Someone who opens a `?readonly=1` link sees their **own** library in read-only mode, not the sender's.

What the code does have is a set of personas and modes. None of them is enforced. Anyone holding the tab can switch any of them.

| Role | How someone gets it | Can see | Can do | Enforced by |
|---|---|---|---|---|
| **Writer** (default) | Opens the app | Every document in this browser and every surface | Everything in §4 | Nothing to enforce |
| **Read-only viewer** | View ▸ Read-only mode, Settings ▸ Editor, a `?readonly=1` link, or the `readOnly` prop | Documents, map, cards, search, outline, version history | Read, navigate, search, select, copy and export. Typing, paste, formatting, inserts, replace and bubble-menu edits are blocked; the toolbar is hidden and the layout is locked ([src/formatting/useFormatDispatcher.ts](src/formatting/useFormatDispatcher.ts), [src/ui/find/findReplace/index.tsx](src/ui/find/findReplace/index.tsx)). Version history's Restore, As new and Delete are disabled, and restoring in place is refused. **Not blocked:** creating, renaming, moving and deleting documents, and importing files (no read-only checks in [src/hooks/useDocumentLifecycle.ts](src/hooks/useDocumentLifecycle.ts), [src/ui/workspace/folderTree/index.tsx](src/ui/workspace/folderTree/index.tsx) or [src/ui/workspace/workspacePanel/index.tsx](src/ui/workspace/workspacePanel/index.tsx)) | Nothing. It is a UX mode, and the View-menu checkbox that turns it off stays live ([src/ui/chrome/menuBar/index.tsx:343](src/ui/chrome/menuBar/index.tsx#L343)) |
| **"Admin" / operator** | Settings ▸ Admin, shown only in development builds or in a browser where `localStorage` `pf:admin` is `1` | The Admin section | Toggle the right-click menu, the diagnostics console and (development builds only) the ads | Nothing beyond that visibility gate; hidden switches fall back to their defaults ([src/utils/build-gates.ts](src/utils/build-gates.ts), [src/ui/settings/settingsSheet/index.tsx](src/ui/settings/settingsSheet/index.tsx)) |
| **Shared-link visitor** | Opens a link made with Tools ▸ Share / embed link | Their own library, preset with a view mode and read-only for this session; or the importer pre-filled from `?import_url=` | Same as a writer. The preset doesn't overwrite their saved settings, and an import runs only when they press Continue | [src/App.tsx:28-71](src/App.tsx#L28-L71) |
| **Embedding host, iframe** (developer) | Frames the embed build | Nothing (it is a program) | Set theme, accent, chrome and background by URL; read and write documents over `postMessage` (§4.12) | An origin allowlist ([src/integration/embed-origins.ts](src/integration/embed-origins.ts)): a deploy-time `VITE_EMBED_ALLOWED_ORIGINS` list filters everything; where the browser reports the real framer (`location.ancestorOrigins`), a requested origin must be that framer; then `?allowed_origin=` (never `*`), else the framer, else the referrer; otherwise nobody. Without the deploy-time list, whoever frames it still gets the full API |
| **Embedding host, npm library** (developer) | Mounts `PerssonifyEditorIntegration` | Nothing (it is a program) | Props, imperative handle, callbacks and a custom storage adapter (§4.12) | The host app's own access control |

The URL-import relay isn't a user role, but it has its own gates. The app uses it only with the visitor's consent, asked once and remembered ([src/store/importExport/url-import.ts](src/store/importExport/url-import.ts)). The relay refuses browser requests from other sites (`Sec-Fetch-Site`) and allows at most 40 requests per minute per IP, per warm instance ([api/import.js](api/import.js)). A non-browser client can still call it, within the caps listed in §6.

## 4. Feature inventory

### 4.1 Writing and editing

| Feature | What it does | Where | Status |
|---|---|---|---|
| Dual-pane editor | Markdown (CodeMirror) and rich text (TipTap) views of one document; an edit in either is projected to the other. Layouts: Markdown, Rich text, Split (default). | [src/ui/panes/editorPanes/index.tsx](src/ui/panes/editorPanes/index.tsx), [src/ui/chrome/modeSwitcher/index.tsx](src/ui/chrome/modeSwitcher/index.tsx), [src/engine/useSyncEngine.ts](src/engine/useSyncEngine.ts) | Done |
| Adaptive sync timing | While you type continuously, the other pane stays at most about 0.25–1.2 s behind, tuned to how long projections take on this device. | [src/hooks/sync-schedule.ts](src/hooks/sync-schedule.ts), [src/constants.ts](src/constants.ts) | Done |
| IME and voice-dictation safety | Sync waits for an in-progress composition (or ends it when leaving a document), so dictated text isn't dropped. | [src/engine/useSyncEngine.ts](src/engine/useSyncEngine.ts), [src/hooks/useDocumentLifecycle.ts](src/hooks/useDocumentLifecycle.ts), [e2e/cases/journeys.mjs](e2e/cases/journeys.mjs) | Done |
| Split divider, phone stacking | Drag or keyboard-resize between 15% and 85%. Below 768 px wide the panes stack vertically when there is height for two (500 px or more, or any upright touch device); a short landscape phone keeps them side by side. The ratio resets to 50% on reload. | [src/ui/panes/editorPanes/index.tsx](src/ui/panes/editorPanes/index.tsx), [src/ui/panes/editorPanes/split-layout.ts](src/ui/panes/editorPanes/split-layout.ts), [src/ui/shared/hooks/use-divider-drag.ts](src/ui/shared/hooks/use-divider-drag.ts) | Done |
| Split scroll sync | Scrolling one pane scrolls the other, aligned on matching headings. The toggle is in the Markdown pane header. | [src/ui/panes/editorPanes/index.tsx](src/ui/panes/editorPanes/index.tsx) | Done |
| Formatting toolbar | Undo/redo, B/I/U/S, block type, font, sub/superscript, lists, indent, align, colour, highlight, link, image, table, inserts, save. Collapses to essentials when its own width is under 1080 px. Hidden when read-only or when chrome is minimal. | [src/ui/chrome/toolbar/index.tsx](src/ui/chrome/toolbar/index.tsx) | Done |
| Inline marks, headings, quotes | Work in both panes: rich marks on the right, Markdown syntax on the left. | [src/formatting/useFormatDispatcher.ts](src/formatting/useFormatDispatcher.ts), [src/formatting/md-format-utils.ts](src/formatting/md-format-utils.ts) | Done |
| Lists (bullet, numbered, task) | Toggle lists in both panes. In the Markdown pane it cannot convert bullet ↔ numbered, and `*`, `+` or indented items get a second marker. | [src/formatting/useFormatDispatcher.ts](src/formatting/useFormatDispatcher.ts) | Partial |
| Indent / outdent | Nests list items in both panes. A no-op on plain paragraphs, by design. | [src/formatting/useFormatDispatcher.ts](src/formatting/useFormatDispatcher.ts) | Done |
| Colour, highlight, font family | Applied in the rich pane. Kept in the Markdown as `<span style>` only while "Styled" mode is on (the default). | [src/ui/chrome/toolbar/index.tsx](src/ui/chrome/toolbar/index.tsx), [src/extensions/BackgroundColor.ts](src/extensions/BackgroundColor.ts), [src/engine/turndown-rules.ts](src/engine/turndown-rules.ts) | Done |
| Text alignment | Works in the rich pane only. Markdown can't store it, so it is lost on the next Markdown-side edit and in `.md` and `.docx` export. The Markdown-pane Align command writes a span that has no effect. | [src/formatting/useFormatDispatcher.ts:487-492](src/formatting/useFormatDispatcher.ts#L487-L492), [src/ui/panes/tiptapPane/index.tsx](src/ui/panes/tiptapPane/index.tsx) | Partial |
| Insert link / image | Both panes use the URL you type (⌘K included). Insert image then asks for a description, used as alt text; leaving it empty marks the image decorative. | [src/formatting/useFormatDispatcher.ts](src/formatting/useFormatDispatcher.ts) | Done |
| Insert table | 8 × 6 grid picker with the header row on. | [src/ui/chrome/tableGridPicker/index.tsx](src/ui/chrome/tableGridPicker/index.tsx) | Done |
| Table editing, rich pane | Bubble menu: row above/below, column left/right, delete row/column, toggle header, delete table. Columns can't be resized. | [src/ui/panes/tableBubbleMenu/index.tsx](src/ui/panes/tableBubbleMenu/index.tsx), [src/ui/panes/tiptapPane/index.tsx:309](src/ui/panes/tiptapPane/index.tsx#L309) | Done |
| Table editing, Markdown pane | Add row after, delete row, toggle header, delete table. Rows are split the way the renderer splits them (a backslash-escaped pipe, including the one in an aliased wiki link, stays in its cell), and column alignment is kept. No column operations. | [src/formatting/md-table-ops.ts](src/formatting/md-table-ops.ts) | Partial |
| Inserts | Formula (dialog with live KaTeX preview), Mermaid diagram, ABC score, callout, collapsible details, code block, horizontal rule. | [src/ui/chrome/menuBar/index.tsx](src/ui/chrome/menuBar/index.tsx), [src/ui/dialogs/index.tsx](src/ui/dialogs/index.tsx) | Done |
| Emoji autocomplete | Typing `:` in the rich pane suggests up to 8 of 87 shortcodes. | [src/extensions/emoji-suggestion.ts](src/extensions/emoji-suggestion.ts), [src/engine/emoji-map.ts](src/engine/emoji-map.ts) | Done |
| Change case | UPPER / lower / Title case for a selection or for all headings. "Content only" skips code and URLs. | [src/formatting/case-transform.ts](src/formatting/case-transform.ts) | Done |
| Select by type | Selects the content of every heading, paragraph, list item, code block, link and so on (17 scopes), after each block's marker. Markdown pane only. Formatting applied afterwards changes every selected range. | [src/formatting/select-scope.ts](src/formatting/select-scope.ts), [src/ui/chrome/selectMenuContent/index.tsx](src/ui/chrome/selectMenuContent/index.tsx) | Done |
| Clear formatting | Removes marks; the rich-pane variant also resets blocks. The Markdown-pane variant removes emphasis, strikethrough and formatting tags, in every selected range, and keeps code, images, links, URLs and math. | [src/formatting/useFormatDispatcher.ts](src/formatting/useFormatDispatcher.ts), [src/formatting/md-format-utils.ts](src/formatting/md-format-utils.ts) | Done |
| Right-click menu | Formatting, case, turn into, link, link to heading, inserts, clipboard, select. On by default (Admin toggle). | [src/ui/chrome/editorContextMenu/index.tsx](src/ui/chrome/editorContextMenu/index.tsx) | Done |
| Link bubble menu | Shows the URL, with Edit and Unlink. Rich pane only. | [src/ui/panes/linkBubbleMenu/index.tsx](src/ui/panes/linkBubbleMenu/index.tsx) | Done |
| Keyboard paste | The rich pane keeps pasted styling by default (a setting), and Shift+paste inverts that for one paste. The Markdown pane pastes plain text. | [src/ui/panes/tiptapPane/index.tsx](src/ui/panes/tiptapPane/index.tsx), [src/engine/html-cleaner.ts](src/engine/html-cleaner.ts) | Done |
| Edit ▸ Cut / Copy / Paste | Menu versions of the clipboard actions. Menu Paste reads plain text only and skips styled paste. | [src/PerssonifyEditor.tsx:784-816](src/PerssonifyEditor.tsx#L784-L816) | Partial |
| Undo / redo | Per pane. Each document's undo history survives switching away and back (bounded cache). | [src/store/history/history-cache.ts](src/store/history/history-cache.ts) | Done |
| Keyboard shortcuts | About 30 app shortcuts (formatting, headings, lists, find, new, save, views), shown for the user's platform. | [src/hooks/useKeyboardShortcuts.ts](src/hooks/useKeyboardShortcuts.ts), [src/data/shortcuts.ts](src/data/shortcuts.ts) | Done |
| "Keyboard shortcuts" off switch | Turns off only the app's own listener. The panes' built-in keymaps (⌘B, ⌘Z, CodeMirror's search) keep working. | [src/ui/settings/settingsSheet/index.tsx](src/ui/settings/settingsSheet/index.tsx), [src/hooks/useKeyboardShortcuts.ts](src/hooks/useKeyboardShortcuts.ts) | Partial |
| Read-only mode | Blocks content editing (see §3 for what it does not block). | [src/store/preferences/uiStore.ts](src/store/preferences/uiStore.ts), [src/formatting/useFormatDispatcher.ts](src/formatting/useFormatDispatcher.ts) | Done |
| Focus mode | Dims the menus, toolbar, pane headers and status bar; hovering restores them. | [src/styles.css](src/styles.css), [src/store/preferences/uiStore.ts](src/store/preferences/uiStore.ts) | Done |
| Reading & typography | Font size (13–19 px), line height, reading width in characters, spellcheck. | [src/ui/settings/settingsSheet/index.tsx](src/ui/settings/settingsSheet/index.tsx), [src/ui/panes/editorPanes/index.tsx](src/ui/panes/editorPanes/index.tsx) | Done |
| Hide images | A rich-pane toggle collapses images to placeholders. They still download. | [src/ui/panes/editorPanes/index.tsx](src/ui/panes/editorPanes/index.tsx) | Done |

### 4.2 Markdown and rich content

| Feature | What it does | Where | Status |
|---|---|---|---|
| Markdown flavors | CommonMark, GitHub (default) or Markdown Extra, plus per-feature switches for tables, task lists, strikethrough, autolinks, footnotes, math, diagrams, music, emoji and callouts. Changing one re-renders the open document. "Markdown Extra" is GitHub plus footnotes only. | [src/store/preferences/settings.ts](src/store/preferences/settings.ts), [src/engine/build-marked.ts](src/engine/build-marked.ts), [src/ui/settings/settingsSheet/index.tsx](src/ui/settings/settingsSheet/index.tsx) | Done |
| "Collapsible details" switch | The value is stored but never read; details always render. | [src/store/preferences/settings.ts:40](src/store/preferences/settings.ts#L40), [src/ui/settings/settingsSheet/index.tsx:51](src/ui/settings/settingsSheet/index.tsx#L51) | Stub |
| Core Markdown | Headings, bold/italic, strikethrough (`~~` only), inline code, links, quotes, rules, and underline/sub/sup (as HTML) round-trip between the panes. | [src/ui/panes/tiptapPane/index.tsx](src/ui/panes/tiptapPane/index.tsx), [src/engine/turndown-rules.ts](src/engine/turndown-rules.ts) | Done |
| Images | By URL or data URI. Sized images use `<img width>`. Theme-aware images (`#gh-light-mode-only` / `#gh-dark-mode-only`, or `<picture>`) follow the app theme. No drag-to-resize. | [src/extensions/SizedImage.ts](src/extensions/SizedImage.ts), [src/extensions/ThemeImage.tsx](src/extensions/ThemeImage.tsx) | Done |
| Tables | GFM tables render and are editable. Column alignment (`:-:`, `--:`, `:--`), in-cell formatting and `<br>` survive the trip back to Markdown. Lists or several paragraphs inside a cell flatten, because GFM cannot hold them, and the fidelity report says so. | [src/extensions/TableCellAlign.ts](src/extensions/TableCellAlign.ts), [src/engine/turndown-rules.ts](src/engine/turndown-rules.ts) | Partial |
| Task lists | Clickable checkboxes. Nested checklists, and content nested under a checklist item, round-trip. | [src/engine/turndown-rules.ts](src/engine/turndown-rules.ts), [src/engine/build-marked.ts](src/engine/build-marked.ts) | Done |
| Code blocks | Fenced blocks with a language tag and a copy button. Token classes are applied but no colour styles exist anywhere (no `hljs` rules), so code is not syntax-coloured. Leading tabs become spaces. | [src/ui/panes/codeBlockWithCopy/index.tsx](src/ui/panes/codeBlockWithCopy/index.tsx) | Partial |
| Math | `$…$` and `$$…$$` via KaTeX, loaded on demand. Double-click, Enter or F2 edits in place; errors are shown inline. | [src/engine/math-marked.ts](src/engine/math-marked.ts), [src/extensions/MathNodes.tsx](src/extensions/MathNodes.tsx) | Done |
| Mermaid diagrams | A ```` ```mermaid ```` block renders in a framed card with Edit and Copy. Theme-aware, with errors shown. | [src/ui/panes/codeBlockWithCopy/index.tsx](src/ui/panes/codeBlockWithCopy/index.tsx), [src/ui/panes/diagramPreview/index.tsx](src/ui/panes/diagramPreview/index.tsx) | Done |
| ABC music notation | A ```` ```abc ```` block renders as a score. | [src/ui/panes/diagramPreview/index.tsx](src/ui/panes/diagramPreview/index.tsx) | Done |
| Callouts | `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` and `[!CAUTION]` render as coloured boxes. | [src/extensions/Callout.ts](src/extensions/Callout.ts), [src/engine/build-marked.ts](src/engine/build-marked.ts) | Done |
| Collapsible details | `<details><summary>` blocks, kept as raw HTML in the Markdown. | [src/extensions/Details.ts](src/extensions/Details.ts) | Done |
| Emoji | `:shortcode:` becomes a glyph and round-trips. | [src/extensions/EmojiNode.ts](src/extensions/EmojiNode.ts) | Done |
| Footnotes | `[^1]` renders when footnotes are on (Markdown Extra, or the Footnotes switch), and round-trips: the rich → Markdown projection writes `[^label]` and `[^label]: text` back. | [src/engine/build-marked.ts](src/engine/build-marked.ts), [src/engine/turndown-rules.ts](src/engine/turndown-rules.ts) | Done |
| Front matter | A leading `---` YAML block shows as a read-only card, is edited in the Markdown pane, and round-trips. It isn't used for the title or tags. | [src/extensions/FrontmatterBlock.ts](src/extensions/FrontmatterBlock.ts), [src/engine/preprocessor.ts](src/engine/preprocessor.ts) | Done |
| Inline style shorthand | Undocumented `{color=red}text{/color}` syntax (also `bg` and `font`), **off by default** (the `curlyBraceFormatting` setting, which Settings has no switch for). When it is on, a group renders only if every key is known and every value validates; anything else, such as a Markdown Extra-style `# Title {#id}`, stays exactly as written. | [src/engine/preprocessor.ts](src/engine/preprocessor.ts), [src/store/preferences/settings.ts](src/store/preferences/settings.ts) | Done |
| Clean vs Styled | One global switch. Styled (default) writes colour, highlight and font into the Markdown as HTML spans; Clean keeps the Markdown pure. | [src/ui/panes/editorPanes/index.tsx](src/ui/panes/editorPanes/index.tsx), [src/engine/useMarkdownEngine.ts](src/engine/useMarkdownEngine.ts) | Done |
| Fidelity badge | The status bar counts formatting the Markdown can't carry, e.g. "2 colors, 1 alignment … not in MD". | [src/store/documents/fidelity.ts](src/store/documents/fidelity.ts), [src/ui/chrome/statusBar/index.tsx](src/ui/chrome/statusBar/index.tsx) | Done |
| Block IDs, `:::fields`, transclusion `![[…]]` | Node types exported by the npm package ([src/index.tsx](src/index.tsx)), now marked deprecated (a development-build console warning when used), but never registered in the editor or enabled in the parser. `![[Doc]]` renders as "!" followed by a normal link. | [src/extensions/BlockId.ts](src/extensions/BlockId.ts), [src/extensions/FieldBlock.ts](src/extensions/FieldBlock.ts), [src/extensions/TransclusionBlock.ts](src/extensions/TransclusionBlock.ts) | Dead |

### 4.3 Find and search

| Feature | What it does | Where | Status |
|---|---|---|---|
| Find & Replace panel | A floating, draggable panel. Targets the pane with the cursor. Case / whole-word / regex options (remembered), next/previous, match count, and match ticks on the scrollbar. Rich-pane matches can't span a formatting boundary. | [src/ui/find/findReplace/index.tsx](src/ui/find/findReplace/index.tsx) | Done |
| Scope filters | Seven regions (headings, code, links, bold, italic, strike, highlight), each off / only / exclude. Fully applied in the Markdown pane; the rich pane honours only "headings only". | [src/ui/find/findReplace/index.tsx](src/ui/find/findReplace/index.tsx) | Partial |
| Find all | Multi-selects every match in the Markdown pane. In the rich pane it selects only one. | [src/ui/find/findReplace/index.tsx](src/ui/find/findReplace/index.tsx) | Partial |
| Replace / Replace all | The Markdown pane honours every filter. Rich-pane Replace All ignores every filter except "headings only". | [src/ui/find/findReplace/index.tsx](src/ui/find/findReplace/index.tsx) | Partial |
| Format matches | Bold, italic, underline, highlight or change the case of every match (Replace mode). | [src/ui/find/findReplace/index.tsx](src/ui/find/findReplace/index.tsx) | Done |
| Search all notes | ⌘⇧F overlay over every document's title and body. Up to 50 results with title matches first, highlighted snippets and keyboard navigation. Opening a result opens Find with the query. Searches saved content. | [src/ui/find/searchPanel/index.tsx](src/ui/find/searchPanel/index.tsx), [src/store/search/search.ts](src/store/search/search.ts) | Done |
| Files filter | Substring filter over title, tags and body in the Files tab. | [src/ui/workspace/workspacePanel/index.tsx](src/ui/workspace/workspacePanel/index.tsx), [src/store/documents/doc-text.ts](src/store/documents/doc-text.ts) | Done |

### 4.4 Library: documents and folders

| Feature | What it does | Where | Status |
|---|---|---|---|
| Workspace panel | Left dock (a drawer on phones) with Files and Outline tabs. Resizable; toggled with ⌘⇧D. | [src/ui/workspace/workspacePanel/index.tsx](src/ui/workspace/workspacePanel/index.tsx) | Done |
| New document | ⌘N, File ▸ New, Files "+" or the empty-state button creates "Untitled N"; the first heading then names it. | [src/hooks/useDocumentLifecycle.ts](src/hooks/useDocumentLifecycle.ts) | Done |
| Open / switch | Click a row. The document you leave is saved, and its draft and undo history are kept. The last active document reopens on launch. | [src/hooks/useDocumentLifecycle.ts](src/hooks/useDocumentLifecycle.ts), [src/store/documents/documentStore.ts](src/store/documents/documentStore.ts) | Done |
| Rename | Inline from the row menu. The name is pinned, so headings no longer rename the document. Wiki links to the old title are not updated. | [src/ui/workspace/folderTree/index.tsx](src/ui/workspace/folderTree/index.tsx), [src/store/documents/documentStore.ts](src/store/documents/documentStore.ts) | Done |
| Duplicate | Saves "Title (copy)" at the library root without opening it. If the source's title came from its heading, the copy reverts to that same title on its next save. | [src/store/documents/documentStore.ts](src/store/documents/documentStore.ts) | Partial |
| Delete | Confirm dialog, which says a recoverable copy is kept. A snapshot taken first makes it recoverable from Version history for up to 30 days; the "Deleted" toast offers **Erase history** to remove that copy too. There is no trash. | [src/hooks/useDocumentLifecycle.ts](src/hooks/useDocumentLifecycle.ts), [src/store/documents/documentStore.ts](src/store/documents/documentStore.ts) | Done |
| Revert to saved / Close | Revert reloads the stored copy (undo can take it back). Close prompts for any unsaved state: editing, saving, error, conflict, blocked or full. There is no tab bar. | [src/hooks/useDocumentLifecycle.ts](src/hooks/useDocumentLifecycle.ts) | Done |
| Folders | Create, nest, rename, move (by menu or drag) and reorder. Deleting a folder moves its contents up one level. | [src/store/documents/folders.ts](src/store/documents/folders.ts), [src/ui/workspace/folderTree/index.tsx](src/ui/workspace/folderTree/index.tsx), [src/ui/workspace/folderTree/folder-dnd.ts](src/ui/workspace/folderTree/folder-dnd.ts) | Done |
| Row menus | ⋮ menu, right-click and long-press on every row: open, rename, duplicate, move, export, delete. | [src/ui/workspace/folderTree/index.tsx](src/ui/workspace/folderTree/index.tsx) | Done |
| Bulk actions | Select mode: select all (within the filter), export as ZIP, delete. There is no bulk move. | [src/ui/workspace/workspacePanel/index.tsx](src/ui/workspace/workspacePanel/index.tsx) | Done |
| Tags | `tags` exists on the document record and the Files filter matches it, but nothing lets a user see or set tags. Only a backup import can populate them. | [src/store/documents/document.ts](src/store/documents/document.ts), [src/store/importExport/ingest.ts](src/store/importExport/ingest.ts) | Dead |
| First-run library | On an empty browser, the app seeds Welcome, Changelog and "About Perssonify" (in a Perssonify folder), linked to each other by wiki links. Their `[[Welcome]]` links are broken (§7.2 #1). The set is seeded again if the user empties the library, but not when the browser wiped it: a `localStorage` record of the library's size detects that, and a notice explains the loss instead (§4.5). | [src/data/starter-documents.ts](src/data/starter-documents.ts), [src/PerssonifyEditor.tsx](src/PerssonifyEditor.tsx), [src/store/persistence/storage-durability.ts](src/store/persistence/storage-durability.ts) | Partial |

### 4.5 Saving, history and data safety

| Feature | What it does | Where | Status |
|---|---|---|---|
| Autosave | Saves about 5 s after the first unsaved change; more typing doesn't postpone it. Also saves when you leave a document, open Map or Cards, or export a ZIP. | [src/PerssonifyEditor.tsx:1813-1826](src/PerssonifyEditor.tsx#L1813-L1826), [src/constants.ts:55](src/constants.ts#L55) | Done |
| Manual save | ⌘S, File ▸ Save or the toolbar button. It reports "Changes saved", and fires the host's `onSave`, only when the write committed; otherwise it says why nothing was saved. | [src/PerssonifyEditor.tsx](src/PerssonifyEditor.tsx) | Done |
| Save status | The status bar reads, as applicable: "Unsaved changes", "Saving…", "Changes saved", "Save failed — retrying", "Empty editor — not saving", "Changed in another tab — not saving", "Storage full — not saving", "Newer version — read-only". | [src/ui/chrome/statusBar/index.tsx](src/ui/chrome/statusBar/index.tsx) | Done |
| Empty-document guard | Refuses to overwrite a stored document with an empty editor. Only Edit ▸ Clear document can do that. | [src/store/documents/documentStore.ts](src/store/documents/documentStore.ts) | Done |
| Multi-tab conflict | Stops saving if another tab saved the same document more recently. There is no live sync and no merge. The ways out are Revert or a reload; any later edit hits the conflict again. | [src/store/documents/documentStore.ts](src/store/documents/documentStore.ts), [src/ui/chrome/statusBar/index.tsx](src/ui/chrome/statusBar/index.tsx) | Partial |
| Crash recovery | On tab close or reload, unsaved edits are stashed and silently restored on the next launch (2 MB cap, 7-day expiry). | [src/store/persistence/crash-recovery.ts:24-27](src/store/persistence/crash-recovery.ts#L24-L27), [src/PerssonifyEditor.tsx](src/PerssonifyEditor.tsx) | Done |
| Leave-page warning | The browser prompts when you close with unsaved, failed or conflicted work. | [src/PerssonifyEditor.tsx](src/PerssonifyEditor.tsx) | Done |
| Version history | Tools ▸ Version history.<br>• When: automatic snapshots, at most one per 90 s per document, plus always before a large shrink, a delete or a restore.<br>• Limits: 20 per document, 12 MB in total, 30 days.<br>• Actions: restore in place (reversible), restore as a new document, or delete a snapshot. | [src/store/history/snapshot-store.ts:62-66](src/store/history/snapshot-store.ts#L62-L66), [src/ui/history/versionHistorySheet/index.tsx](src/ui/history/versionHistorySheet/index.tsx) | Done |
| Deleted-document recovery | Version history lists "Other & deleted documents", which can be restored as new for up to 30 days after the delete (the copy is no longer exempt from the age cap). Restores come from the last *stored* copy; tags, metadata and folder are not restored. | [src/ui/history/versionHistorySheet/index.tsx](src/ui/history/versionHistorySheet/index.tsx), [src/hooks/useDocumentLifecycle.ts](src/hooks/useDocumentLifecycle.ts) | Partial |
| Memory & undo history | A sheet showing how much undo history is cached and for how many documents. Limits: 5–50 documents, 8–64 MB. Can clear per document. | [src/ui/diagnostics/memorySheet/index.tsx](src/ui/diagnostics/memorySheet/index.tsx), [src/store/history/history-cache.ts](src/store/history/history-cache.ts) | Done |
| Storage limit | No cap of its own: the limit is the browser's quota for the site, measured in real bytes with `navigator.storage.estimate()`, unless a host sets `maxBytes`. When the browser refuses a write for lack of space, saving stops in a terminal "Storage full — not saving" state; deleting a document or a real edit retries. Nothing is evicted. The usage chip appears at 60% but stays hidden after a reload until the first save. Images are still stored inside documents, not as separate blobs. | [src/store/persistence/idb-storage-adapter.ts](src/store/persistence/idb-storage-adapter.ts), [src/ui/chrome/statusBar/index.tsx](src/ui/chrome/statusBar/index.tsx) | Partial |
| Storage & backup | Settings ▸ Storage & backup shows whether the browser agreed to keep the library (`navigator.storage.persist()` is requested after the first save, with a button to ask again), how much space it uses, and the last full backup, with a download button. | [src/ui/settings/settingsStorage/index.tsx](src/ui/settings/settingsStorage/index.tsx), [src/store/persistence/storage-durability.ts](src/store/persistence/storage-durability.ts) | Done |
| Eviction notices | One strip above the status bar: a reminder when the last full backup is over 7 days old (or there has never been one); a notice when the library comes back empty although this browser held documents, offering Import a backup, Version history or Start fresh; a tip for Safari and iOS users to add the app to the Home Screen or Dock; and a persistent "Not saving" warning whenever browser storage is unavailable. | [src/ui/notices/durabilityNotices/index.tsx](src/ui/notices/durabilityNotices/index.tsx), [src/store/persistence/storage-durability.ts](src/store/persistence/storage-durability.ts) | Done |
| Erase all local data | Settings ▸ Local data: after a confirmation, deletes every document, all version history, drafts, the crash stash and the app's settings from this browser. Also exported as `clearLocalData()` for hosts (logout on shared devices). | [src/ui/settings/eraseLocalData/index.tsx](src/ui/settings/eraseLocalData/index.tsx), [src/store/documents/documentStore.ts](src/store/documents/documentStore.ts) | Done |
| Content from a newer version | A document saved by a newer build opens read-only ("Newer version — read-only") instead of blank, so it cannot be overwritten. | [src/store/documents/schema-version.ts](src/store/documents/schema-version.ts), [src/store/documents/documentStore.ts](src/store/documents/documentStore.ts), [src/ui/chrome/statusBar/index.tsx](src/ui/chrome/statusBar/index.tsx) | Done |

### 4.6 Import

| Feature | What it does | Where | Status |
|---|---|---|---|
| File import | File ▸ Open file… and File ▸ Import ▸ File(s) open the same picker; every file becomes a **new** document and the first one opens.<br>• Formats: `.md`/`.markdown`, `.html`/`.htm`, `.txt`, `.json` (a ProseMirror document or a backup envelope), `.docx`.<br>• 5 MB per file; images are skipped silently.<br>• `.mdown` is offered but imports as plain text. | [src/ui/chrome/menuBar/index.tsx:498](src/ui/chrome/menuBar/index.tsx#L498), [src/PerssonifyEditor.tsx:1952-2142](src/PerssonifyEditor.tsx#L1952-L2142), [src/store/importExport/import-export.ts:65-75](src/store/importExport/import-export.ts#L65-L75) | Done |
| Drag and drop | Onto the editor panes, or onto the Files tab with a "Drop to Import" overlay. A file dropped anywhere else (menu bar, toolbar, status bar) makes the tab navigate to the file. | [src/ui/panes/editorPanes/index.tsx](src/ui/panes/editorPanes/index.tsx), [src/ui/workspace/workspacePanel/index.tsx](src/ui/workspace/workspacePanel/index.tsx) | Done |
| Archives | `.zip`, `.tar`, `.tar.gz`/`.tgz` and `.gz`; folder structure is kept, and loose root files are wrapped in a folder named after the archive. Hidden directories and macOS clutter are skipped. Limits: 5 MB compressed, 20 MB unpacked, 500 entries; past any limit the whole archive is skipped. | [src/store/importExport/archive.ts:100-105](src/store/importExport/archive.ts#L100-L105) | Done |
| Password-protected ZIP | Detects encryption, asks for the password (masked), retries on a wrong one, and decrypts in the browser. ZIP only. | [src/store/importExport/archive.ts](src/store/importExport/archive.ts), [src/PerssonifyEditor.tsx](src/PerssonifyEditor.tsx) | Done |
| Word (`.docx`) import | Converted in the browser: headings, lists, bold/italic, tables and raster images. Equations, text boxes, SVG/EMF images and complex layout are lost. Converter warnings are discarded, and a `.docx` inside an archive is ignored. | [src/store/importExport/docx-import.ts](src/store/importExport/docx-import.ts) | Partial |
| Import from URL | Import ▸ From URL: fetch, preview (archives get an entry picker), then import.<br>• Rewrites GitHub file links to raw, and Dropbox and Google Drive file links to direct downloads.<br>• Refuses local and private addresses.<br>• Falls back to the server relay when the host blocks cross-site reads, but only with the user's consent: asked once, remembered, and changeable in Settings ▸ Privacy. The relay carries files up to 4 MB and says so when one is larger.<br>• **Google Docs links are always rejected** by a sign-in-page guard, and only ZIP archives import reliably from a URL (§7.2 #3). | [src/store/importExport/url-import.ts](src/store/importExport/url-import.ts), [src/store/importExport/import-url-normalize.ts](src/store/importExport/import-url-normalize.ts), [src/ui/importExport/urlImportDialog/index.tsx](src/ui/importExport/urlImportDialog/index.tsx) | Partial |
| Paste into the importer | Paste Markdown or HTML into the URL dialog to import it directly. | [src/ui/importExport/urlImportDialog/index.tsx](src/ui/importExport/urlImportDialog/index.tsx) | Done |
| `?import_url=` links | Opens the importer pre-filled. Nothing is fetched until the user presses Continue. The dialog also offers a shareable link. | [src/App.tsx:28-32](src/App.tsx#L28-L32), [src/ui/importExport/urlImportDialog/index.tsx](src/ui/importExport/urlImportDialog/index.tsx) | Done |
| Import sanitising | Scripts, event handlers, dangerous URLs and risky CSS are stripped from HTML, DOCX and URL imports. | [src/store/importExport/ingest.ts](src/store/importExport/ingest.ts) | Done |
| "What didn't come through" | The status-bar "N residuals" button lists what an import couldn't represent. On the HTML, DOCX and URL paths it under-reports: anything the sanitiser removed first is never listed. | [src/ui/importExport/residualsDialog/index.tsx](src/ui/importExport/residualsDialog/index.tsx), [src/store/importExport/ingest.ts](src/store/importExport/ingest.ts) | Partial |
| Backup restore | Importing a full-backup ZIP (or one backup `.json`) brings back documents with their folders, titles, created dates, tags and card colours.<br>• It is **additive**: colliding ids get new ones and folders are duplicated.<br>• It re-stamps "updated" and pins every title.<br>• A backup over 500 documents or 20 MB can't be restored. | [src/store/importExport/archive.ts](src/store/importExport/archive.ts), [src/store/importExport/ingest.ts](src/store/importExport/ingest.ts) | Partial |

### 4.7 Export and sharing

| Feature | What it does | Where | Status |
|---|---|---|---|
| Export ▸ Markdown | The active document as `.md`, following the current Clean/Styled mode; the filename comes from the title. | [src/store/importExport/import-export.ts](src/store/importExport/import-export.ts), [src/PerssonifyEditor.tsx](src/PerssonifyEditor.tsx) | Done |
| Export ▸ HTML | A standalone `.html` page with styles. Math appears as raw LaTeX, Mermaid and ABC as code, and wiki links as dead `#` links. | [src/store/importExport/import-export.ts](src/store/importExport/import-export.ts) | Partial |
| Export ▸ ProseMirror JSON | A full-fidelity document envelope: content, title, metadata, timestamps. | [src/store/importExport/import-export.ts](src/store/importExport/import-export.ts) | Done |
| Export ▸ Word (`.docx`) | **Keeps:** headings, paragraphs, lists (4 levels), quotes, code, tables, bold/italic/strike/code, links.<br>**Loses:**<br>• Images become alt text.<br>• Math, emoji and wiki links stay as source text.<br>• Checkbox state, colours and alignment are dropped.<br>• Raw HTML tags appear as text. | [src/store/importExport/docx-export.ts](src/store/importExport/docx-export.ts) | Partial |
| Export ▸ PDF / Print | Opens the browser's print dialog on a print-styled copy; the PDF comes from "Save as PDF". Same content limits as HTML. | [src/store/importExport/print-export.ts](src/store/importExport/print-export.ts) | Partial |
| Per-document export | From any library row (⋮ or right-click): Markdown, HTML, Word or backup JSON, without opening the document. | [src/ui/workspace/folderTree/index.tsx](src/ui/workspace/folderTree/index.tsx), [src/PerssonifyEditor.tsx:2247-2286](src/PerssonifyEditor.tsx#L2247-L2286), [src/engine/serialize-doc.ts](src/engine/serialize-doc.ts) | Done |
| Folder export | From the folder menu: a ZIP of Markdown or a full backup, keeping sub-folders. | [src/ui/workspace/folderTree/index.tsx](src/ui/workspace/folderTree/index.tsx), [src/PerssonifyEditor.tsx](src/PerssonifyEditor.tsx) | Done |
| All documents / Full backup | File ▸ Export: the whole library as a Markdown ZIP, or as a restorable ZIP with one JSON per document. Filenames are timestamped, and unsaved edits are flushed first. The menu is only available while a document is open ([src/ui/chrome/menuBar/index.tsx:205](src/ui/chrome/menuBar/index.tsx#L205)). | [src/PerssonifyEditor.tsx:1979-1990](src/PerssonifyEditor.tsx#L1979-L1990), [src/PerssonifyEditor.tsx:2147-2222](src/PerssonifyEditor.tsx#L2147-L2222) | Done |
| Copy as Markdown / HTML / JSON | Copies the whole active document to the clipboard. | [src/PerssonifyEditor.tsx:1953-1957](src/PerssonifyEditor.tsx#L1953-L1957) | Done |
| Copy as AI prompt | Copies an LLM-ready prompt: the active document plus the documents it links to and from (one hop, up to 20), with metadata. It reads the last-*saved* copies, runs paragraphs together, and lists relationships by internal id. | [src/integration/prompt-builder.ts](src/integration/prompt-builder.ts), [src/PerssonifyEditor.tsx:1999-2015](src/PerssonifyEditor.tsx#L1999-L2015) | Partial |
| Copy graph JSON | Copies the link graph (nodes and edges) to the clipboard, from the Tools menu or the map header. | [src/hooks/useLinkIndex.ts](src/hooks/useLinkIndex.ts), [src/store/links/link-index.ts](src/store/links/link-index.ts) | Done |
| Share / embed link builder | Tools ▸ Share / embed link, and inline on the Help page. It builds two things:<br>• a standalone link with view mode, read-only and import URL (plus ads, in development builds only) — this works;<br>• an iframe snippet that also carries theme, accent, chrome and background — this points at `/embed.html`, which the production build doesn't contain.<br>Links carry settings, never document content. | [src/ui/share/linkBuilder/index.tsx:173-199](src/ui/share/linkBuilder/index.tsx#L173-L199), [vercel.json](vercel.json) | Partial |

### 4.8 Links, backlinks, map and outline

| Feature | What it does | Where | Status |
|---|---|---|---|
| Wiki links | `[[Title]]`, `[[Title\|alias]]`, `[[Title#Heading]]` and `[[#Heading]]` typed in the Markdown pane become clickable links in the rich pane and round-trip. They are parsed by a Markdown inline extension, so they are never recognised inside code, and inside a table cell the alias pipe is escaped with a backslash. There is **no `[[` autocomplete**, and a title containing `\|` or `]` cannot be linked. | [src/engine/wiki-link-marked.ts](src/engine/wiki-link-marked.ts), [src/extensions/WikiLink.ts](src/extensions/WikiLink.ts), [src/engine/turndown-rules.ts](src/engine/turndown-rules.ts) | Done |
| Wiki links typed in the rich pane | They stay plain, unclickable text until the rich pane is re-rendered from Markdown. They are still indexed. | [src/ui/panes/tiptapPane/index.tsx](src/ui/panes/tiptapPane/index.tsx) | Partial |
| Following a link | Click opens the target, scrolling to the heading if one is given. Clicks, the link index, the map and the broken-link marking share one resolver: the whole `Title#Heading` as a title first, then an exact id, then an exact title (case-insensitive, Unicode-normalised); nothing partial. Clicks keep working after the editor remounts. A missing target shows "Document not found" and offers no way to create it. | [src/hooks/useLinkIndex.ts](src/hooks/useLinkIndex.ts), [src/store/links/link-index.ts](src/store/links/link-index.ts) | Partial |
| Link to heading | Right-click ▸ Link to heading inserts `[[#Heading]]` for the current document only. | [src/ui/chrome/editorContextMenu/index.tsx](src/ui/chrome/editorContextMenu/index.tsx), [src/PerssonifyEditor.tsx:760-778](src/PerssonifyEditor.tsx#L760-L778) | Done |
| Broken-link styling | Links whose target does not exist are drawn dashed, judged live against the library by a rich-pane decoration. | [src/extensions/UnresolvedWikiLinks.ts](src/extensions/UnresolvedWikiLinks.ts), [src/hooks/useLinkIndex.ts](src/hooks/useLinkIndex.ts) | Done |
| Document Links tray | A bottom-tray tab with backlinks (with a context snippet), outgoing links and broken links; click to open. Opened from the status-bar links chip or the "Panel" toggle. | [src/ui/links/backlinksPanel/index.tsx](src/ui/links/backlinksPanel/index.tsx), [src/ui/chrome/bottomTray/index.tsx](src/ui/chrome/bottomTray/index.tsx), [src/ui/chrome/statusBar/index.tsx](src/ui/chrome/statusBar/index.tsx) | Done |
| Relationship map | A full-canvas graph of every document and link, grouped into folder clusters. Opened from the top-bar switcher, the View menu, ⌘⇧G or the `/graph` URL. | [src/ui/graph/graphView/index.tsx](src/ui/graph/graphView/index.tsx), [src/store/graph/graph-metrics.ts](src/store/graph/graph-metrics.ts) | Done |
| Map interactions | Click selects, double-click or Enter opens, drag rearranges. Pan, zoom (wheel or buttons, 30–300%) and Fit. Search dims non-matches. "Unlinked" and "broken" filters with ghost targets. Keyboard-accessible; settles instantly under reduced motion. | [src/ui/graph/graphView/index.tsx](src/ui/graph/graphView/index.tsx) | Done |
| Map details rail | Selected note: folder, link counts, Open/Focus/Isolate, its headings (click to open there), links in and out. Nothing selected: most connected, unlinked and broken. A right column on wide screens, a bottom sheet on narrow ones. | [src/ui/graph/graphView/index.tsx](src/ui/graph/graphView/index.tsx) | Done |
| Map empty state | When there are notes but no links, it explains links and lists the notes as chips. | [src/ui/graph/graphView/index.tsx](src/ui/graph/graphView/index.tsx) | Done |
| Outline | Workspace panel Outline tab (or View ▸ Outline): nested headings, the current heading highlighted as you scroll, click to jump. No cap on the number of headings. In Markdown-only view there's no highlight, and a click switches to Split. | [src/ui/workspace/docNavPanel/index.tsx](src/ui/workspace/docNavPanel/index.tsx), [src/hooks/useActiveHeading.ts](src/hooks/useActiveHeading.ts), [src/store/documents/doc-outline.ts](src/store/documents/doc-outline.ts) | Done |

### 4.9 Cards board

| Feature | What it does | Where | Status |
|---|---|---|---|
| Cards board | A Keep-style board with every document as a card. Opened from the switcher, the View menu, ⌘⇧K or the Workspace panel. Masonry layout with 1–4 columns by board width; pinned cards first, then newest. Cards render 60 at a time, and a change reloads only the cards it touched. | [src/ui/cards/cardsView/index.tsx](src/ui/cards/cardsView/index.tsx), [src/store/cards/cards.ts](src/store/cards/cards.ts) | Done |
| Quick capture | "Take a note…" with an optional title and a checklist mode. ⌘/Ctrl+Enter saves; Esc collapses the composer and keeps the draft, which survives closing the board and reloads; only Cancel throws it away. The note is created at the library root. | [src/ui/cards/cardsView/index.tsx](src/ui/cards/cardsView/index.tsx), [src/PerssonifyEditor.tsx:2460-2479](src/PerssonifyEditor.tsx#L2460-L2479) | Done |
| Card faces | Rendered preview (headings, lists, emphasis), a checklist with a done/total count (display-only), a folder badge and a relative time. | [src/store/cards/cards.ts](src/store/cards/cards.ts) | Done |
| Card search | Filters by title and the first ~2,000 characters of text. | [src/ui/cards/cardsView/index.tsx](src/ui/cards/cardsView/index.tsx) | Done |
| Colour and pin | 9 colours and pin-to-top, saved to the document without touching its "updated" time, and shown on the board at once. | [src/ui/cards/cardsView/index.tsx](src/ui/cards/cardsView/index.tsx), [src/store/cards/cards.ts](src/store/cards/cards.ts) | Done |
| Card editor | Preview · Split · Write (choice remembered), rendered exactly like the main editor. Saves on close; "Open in editor" is also offered. Below 480 px the view switch is hidden and Preview is the default, so a phone can't edit in place. Saving keeps the note's colour, highlight and font, carries alignment over on the paragraphs the edit left alone (and says when edited ones lose it), and snapshots the old version first when anything could not be carried. | [src/ui/cards/cardsView/index.tsx](src/ui/cards/cardsView/index.tsx), [src/store/cards/card-save.ts](src/store/cards/card-save.ts) | Partial |
| Delete from a card | With confirmation. | [src/ui/cards/cardsView/index.tsx](src/ui/cards/cardsView/index.tsx) | Done |
| Read-only board | No composer; pin, colour and delete are disabled. | [src/ui/cards/cardsView/index.tsx](src/ui/cards/cardsView/index.tsx) | Done |

### 4.10 Appearance, settings, onboarding and help

| Feature | What it does | Where | Status |
|---|---|---|---|
| Routes | `/` editor, `/about`, `/help`, `/graph` (the map), as real URLs with browser back and forward. | [src/app/router.tsx](src/app/router.tsx), [src/App.tsx](src/App.tsx) | Done |
| Theme | Light, Dark or System (default), applied before first paint. | [src/ui/settings/themeControls/index.tsx](src/ui/settings/themeControls/index.tsx), [index.html](index.html) | Done |
| Accent palettes | Amber (default), Blue, Violet, Emerald, Rose, Mono. | [src/theme/palette.ts](src/theme/palette.ts) | Done |
| Settings sheet | Appearance, Markdown flavor and features, editor (layout, read-only, shortcuts), reading & typography, Storage & backup, Privacy (import relay, Block remote images), Local data, and Admin (hidden unless enabled, §3). Changes apply and save at once. Choosing a layout here doesn't leave Cards or Map. | [src/ui/settings/settingsSheet/index.tsx](src/ui/settings/settingsSheet/index.tsx), [src/store/preferences/uiStore.ts](src/store/preferences/uiStore.ts) | Done |
| Guided tour | A 7-step spotlight: menus, layout switcher, Cards/Map, settings, toolbar, panes, workspace. Runs once on a first visit and can be rerun from Help. | [src/ui/tour/walkthrough/index.tsx](src/ui/tour/walkthrough/index.tsx), [src/App.tsx:92-111](src/App.tsx#L92-L111) | Done |
| Help page | 12 searchable sections (including Offline & privacy and Keeping your library safe) with a table of contents, a live share-link builder, and a shortcut table with a macOS / Windows toggle. | [src/ui/pages/helpPage/index.tsx](src/ui/pages/helpPage/index.tsx), [src/ui/pages/helpPage/help-content.ts](src/ui/pages/helpPage/help-content.ts) | Done |
| About page | Version, privacy / offline / open-format cards, third-party credits with a link to the full licence notice generated at build time (`/third-party-licenses.txt`), and Copy diagnostics. | [src/ui/pages/aboutPage/index.tsx](src/ui/pages/aboutPage/index.tsx), [src/data/credits.ts](src/data/credits.ts), [scripts/third-party-licenses.mjs](scripts/third-party-licenses.mjs) | Done |
| Status bar | Tray toggle, document title, view mode, fidelity badge, residuals, links chip, save state, storage %, word/character counts, shortcuts and memory. Detail drops away on narrow screens. | [src/ui/chrome/statusBar/index.tsx](src/ui/chrome/statusBar/index.tsx) | Done |
| Phone layout | ☰ drill-down menu, workspace panel as a drawer (closed by default), stacked panes, larger touch targets, safe-area padding for in-app browsers. | [src/ui/chrome/menuBar/index.tsx](src/ui/chrome/menuBar/index.tsx), [src/ui/workspace/workspacePanel/index.tsx](src/ui/workspace/workspacePanel/index.tsx), [index.html](index.html) | Done |

### 4.11 Admin, diagnostics and monetization

| Feature | What it does | Where | Status |
|---|---|---|---|
| Admin settings | Right-click menu (on by default), diagnostics console (off) and, in development builds, ads (off). Hidden unless the build is a development build or `localStorage` `pf:admin` is `1`; while hidden, the switches fall back to their defaults. | [src/ui/settings/settingsSheet/index.tsx](src/ui/settings/settingsSheet/index.tsx), [src/utils/build-gates.ts](src/utils/build-gates.ts) | Done |
| Diagnostics console | A bottom-tray tab with seven read-only commands: `help`, `diag.lifecycle`, `diag.storage`, `docs.list`, `doc.outline`, `doc.links`, `graph.stats`. There is no eval. | [src/ui/diagnostics/consolePanel/index.tsx](src/ui/diagnostics/consolePanel/index.tsx), [src/store/diagnostics/console-commands.ts](src/store/diagnostics/console-commands.ts) | Done |
| Debug logging | `?diag=1` or a localStorage flag turns on console diagnostics. | [src/utils/diag.ts](src/utils/diag.ts) | Done |
| Diagnostics report | A local ring of the last 25 errors, failed saves and recoveries: error class, a redacted first line of the message, script and line — never document content. The user copies it from the crash screen or the About page; nothing is sent anywhere. Hosts can subscribe with `setErrorReporter`. | [src/utils/diagnostics.ts](src/utils/diagnostics.ts), [src/ui/diagnostics/diagnosticsActions/index.tsx](src/ui/diagnostics/diagnosticsActions/index.tsx) | Done |
| Ads | Development builds only: a "Sponsored" floating bar and a Files-panel tile, toggled from View ▸ Show ads, Settings or `?ads=true`. Both are static "Your Ad Here" placeholders: no ad network, no link, and "Learn More →" does nothing. A production build renders neither, whatever is stored or passed in the URL. | [src/ui/shared/adUnit/index.tsx](src/ui/shared/adUnit/index.tsx), [src/utils/build-gates.ts](src/utils/build-gates.ts) | Stub |
| Right-rail ad slot | Defined but never placed. | [src/ui/shared/adUnit/index.tsx](src/ui/shared/adUnit/index.tsx) | Dead |

### 4.12 Embedding and developer platform

| Feature | What it does | Where | Status |
|---|---|---|---|
| npm package | `@perssonify/editor`, with entry points for the component, engine, store, integration and stylesheet. The stylesheet is scoped so it doesn't restyle the host page. KaTeX's CSS is not included, so math is unstyled unless the host adds it. | [package.json](package.json), [src/index.tsx](src/index.tsx), [vite.config.ts](vite.config.ts), [build/scope-css.mjs](build/scope-css.mjs) | Done |
| Integration component | `PerssonifyEditorIntegration` props: dark/light, accent palette or colour, CSS variables, chrome (full / minimal / none), initial document and mode, read-only, fit-to-parent, storage config. | [src/integration/PerssonifyEditorIntegration.tsx](src/integration/PerssonifyEditorIntegration.tsx) | Done |
| Handle: read | `getMarkdown`, `getHTML`, `getCanonicalDocument`, `getDocuments`, `getActiveDocument`, `getGraph`. | [src/integration/PerssonifyEditorIntegration.tsx](src/integration/PerssonifyEditorIntegration.tsx), [src/PerssonifyEditor.tsx:1147-1167](src/PerssonifyEditor.tsx#L1147-L1167) | Done |
| Handle: write | `addDocuments`, `updateDocument`, `appendToDocument`, `openDocument`, `setTheme`, `setAccent`, `setChrome`. | [src/integration/PerssonifyEditorIntegration.tsx](src/integration/PerssonifyEditorIntegration.tsx), [src/PerssonifyEditor.tsx](src/PerssonifyEditor.tsx) | Done |
| Handle: `importContent`, `exportAs`, `setMode` | `importContent` now leaves the open document the way a switch does (flush, draft, save) before opening the import. `exportAs` doesn't wait for ZIP exports and ignores unknown formats silently. `setMode` accepts and saves any value; an invalid one hides both panes. | [src/PerssonifyEditor.tsx](src/PerssonifyEditor.tsx) | Partial |
| Handle: `copyAsPrompt` | The same prompt as Copy as AI prompt (§4.7), linked documents included (their lookups are awaited). | [src/integration/PerssonifyEditorIntegration.tsx](src/integration/PerssonifyEditorIntegration.tsx), [src/integration/prompt-builder.ts](src/integration/prompt-builder.ts) | Partial |
| Callbacks | These work: `onReady`, `onChange` (every projection), `onSave` (only when a write committed), `onStorageMetricsChange`, `onStorageQuotaExceeded`.<br>These don't fully:<br>• `onContentChange` misses changes that don't come from typing.<br>• `onGraphUpdate` fires only for host-made changes.<br>• `onLinkClick` can intercept navigation in React, but not over the iframe bridge. | [src/PerssonifyEditor.tsx](src/PerssonifyEditor.tsx), [src/hooks/useLinkIndex.ts](src/hooks/useLinkIndex.ts) | Partial |
| Custom storage adapter | Sends document storage through a host-supplied adapter. The default database is still opened at startup, and snapshots and the crash stash still use the browser's own storage, but they follow the host's `storageConfig` namespace, or can be switched off there. `clearLocalData()` erases them, e.g. on logout. | [src/store/documents/documentStore.ts](src/store/documents/documentStore.ts), [src/store/persistence/storage-adapter.ts](src/store/persistence/storage-adapter.ts) | Partial |
| Associations | Host-supplied extra edges between documents. Held in memory, and merged only into `getGraph` and `copyAsPrompt`; never shown in the map or backlinks. | [src/integration/associations.ts](src/integration/associations.ts) | Partial |
| `setFieldSchemas`; `documents`, `fieldSchemas`, `linkResolver`, `onFieldChange`, `onExport` props | Deprecated (`@deprecated` in the types, and one console warning per page load in development builds when used), still accepted and ignored: `setFieldSchemas` writes a global nobody reads; the props are never read or fired. `onLinkClick` replaces `linkResolver`. | [src/integration/deprecation.ts](src/integration/deprecation.ts), [src/integration/PerssonifyEditorIntegration.tsx](src/integration/PerssonifyEditorIntegration.tsx) | Dead |
| Iframe embed | `embed.html` with URL parameters: `mode`, `theme`, `accent`, `accentColor`, `chrome`, `bg` (including `transparent`), `allowed_origin`, `readonly`. Built in CI but **not part of the deployed site**: `/embed.html` on the production domain serves the standalone app. Self-hosters must serve the `dist-embed` build. | [src/embed.tsx](src/embed.tsx), [vite.embed.config.ts](vite.embed.config.ts), [vite.app.config.ts](vite.app.config.ts), [vercel.json](vercel.json) | Partial |
| postMessage bridge | About 20 actions (document reads and writes, theme, mode, chrome, export, prompt, associations) with request/response, plus events (ready, change, save, link click). Unknown actions are rejected. Talks only to the origins resolved as §3 describes, and to nobody when none qualifies. | [src/integration/host-bridge.ts](src/integration/host-bridge.ts), [src/integration/embed-origins.ts](src/integration/embed-origins.ts) | Done |
| Client helper | `createEditorClient(iframe)` wraps the bridge for host pages. | [src/integration/host-bridge.ts](src/integration/host-bridge.ts) | Done |

### 4.13 Install, offline and resilience

| Feature | What it does | Where | Status |
|---|---|---|---|
| Installable app | PWA manifest (standalone display, icons) and a service worker. Installing is optional for offline use; on Safari it also protects the library from the 7-day storage limit. | [vite.app.config.ts](vite.app.config.ts) | Done |
| Offline use | Works after one online visit, installed or not. The service worker precaches every file the app can load, on-demand features included, in the background after the first load, and serves its own copy of the page when the network is gone. Import from URL and images hosted elsewhere still need a connection. A real-browser suite uses every on-demand feature for the first time offline. | [vite.app.config.ts](vite.app.config.ts), [public/sw-recover.js](public/sw-recover.js), [e2e/cases/pwa.mjs](e2e/cases/pwa.mjs) | Done |
| Update delivery | Prompted, never forced: "A new version of Markdown Studio is ready" with a Reload button, and an open tab checks for a new version hourly. A tab reloads by itself only when it is online, has nothing unsaved and is in the background. The boot watchdog recovers a load that cannot start only on evidence of a failed app script, and only online. A missing on-demand file 404s (it is no longer answered with the page), and the app reloads for it only when online with nothing unsaved. | [src/pwa/sw-updates.ts](src/pwa/sw-updates.ts), [src/main.tsx](src/main.tsx), [index.html](index.html), [public/sw-recover.js](public/sw-recover.js), [vercel.json](vercel.json) | Done |
| Crash screen | An "Editor Crashed" card with Recover Editor (remounts the editor), Export my documents (a full backup ZIP built straight from storage) and Copy diagnostics. A file that failed to download gets its own screen with Reload. | [src/ui/shared/errorBoundary/index.tsx](src/ui/shared/errorBoundary/index.tsx), [src/utils/emergency-backup.ts](src/utils/emergency-backup.ts) | Done |
| Blocked browser storage | The app doesn't crash when the browser blocks storage. If IndexedDB can't open, the editor still opens and editing works, but nothing is saved or restored; startup reports "Failed to initialize", and a persistent "Not saving" banner stays up for as long as that is true. | [src/utils/safe-storage.ts](src/utils/safe-storage.ts), [src/store/persistence/storage-adapter.ts](src/store/persistence/storage-adapter.ts), [src/ui/notices/durabilityNotices/index.tsx](src/ui/notices/durabilityNotices/index.tsx), [e2e/cases/faults.mjs](e2e/cases/faults.mjs) | Done |

## 5. Core user journeys

### Journey 1: first visit to a saved document (writer)

1. **Open the app.** `/` loads [index.html](index.html), which paints the saved (or system) theme before anything else. [src/main.tsx](src/main.tsx) then mounts the shell in [src/App.tsx](src/App.tsx).
2. **The library initialises.** `initialize` in [src/store/documents/documentStore.ts:414-471](src/store/documents/documentStore.ts#L414-L471) reads IndexedDB `perssonify-docs`.
   - On an empty browser, the editor seeds the Welcome document, imports Changelog and About Perssonify, and returns to Welcome ([src/PerssonifyEditor.tsx:1574-1628](src/PerssonifyEditor.tsx#L1574-L1628)). A "Ready" toast appears.
   - On later visits, the last open document comes back instead.
3. **Tour.** Once the menu bar exists, a 7-step tour runs once ([src/App.tsx:92-111](src/App.tsx#L92-L111), [src/ui/tour/walkthrough/index.tsx](src/ui/tour/walkthrough/index.tsx)).
4. **Create.** ⌘N, File ▸ New or "+" creates "Untitled N" ([src/hooks/useDocumentLifecycle.ts](src/hooks/useDocumentLifecycle.ts)).
5. **Write.**
   - Typing `# Plan` in the Markdown pane renders in the rich pane within about 0.1–1.2 s ([src/engine/useSyncEngine.ts](src/engine/useSyncEngine.ts), [src/hooks/sync-schedule.ts](src/hooks/sync-schedule.ts)).
   - Toolbar formatting in the rich pane is written back as Markdown.
   - The first heading names the document (`resolveDocTitle` in [src/store/documents/document.ts:205-220](src/store/documents/document.ts#L205-L220)).
6. **Save.** The status bar reads "Unsaved changes". Autosave runs 5 s after the first change, then "Saving…", then "Changes saved" ([src/PerssonifyEditor.tsx:1813-1826](src/PerssonifyEditor.tsx#L1813-L1826), [src/ui/chrome/statusBar/index.tsx](src/ui/chrome/statusBar/index.tsx)). Switching documents or closing the tab also saves.
7. **Safety nets.**
   - Reloading inside the autosave window stashes the edits, and they come back on the next launch ([src/store/persistence/crash-recovery.ts](src/store/persistence/crash-recovery.ts)).
   - Snapshots build up for Tools ▸ Version history ([src/store/history/snapshot-store.ts](src/store/history/snapshot-store.ts)).

**Outcome:** the document is stored only in this browser: no account, and no copy of it on any server. **Friction on this path:** the seeded map already shows three broken `[[Welcome]]` links (§7.2 #1).

### Journey 2: bring notes in, link them, explore, back up (writer)

1. **Import.** File ▸ Import ▸ File(s) / archive…, or drop a `.zip` on the editor or on the Files tab ([src/ui/chrome/menuBar/index.tsx](src/ui/chrome/menuBar/index.tsx), [src/ui/panes/editorPanes/index.tsx](src/ui/panes/editorPanes/index.tsx), [src/ui/workspace/workspacePanel/index.tsx](src/ui/workspace/workspacePanel/index.tsx)).
2. **Unpack.**
   - The archive is extracted in the browser, within its size and entry limits, with a password prompt if needed ([src/store/importExport/archive.ts](src/store/importExport/archive.ts)).
   - Each text, HTML or JSON entry becomes a sanitised document, in folders that mirror the archive (`importItems` in [src/PerssonifyEditor.tsx:1373](src/PerssonifyEditor.tsx#L1373), [src/store/importExport/ingest.ts](src/store/importExport/ingest.ts)).
   - The first document opens, with an "Imported N file(s)" toast.
3. **Check fidelity.** If something couldn't be represented, the status bar shows "N residuals"; clicking it opens "What didn't come through" ([src/ui/importExport/residualsDialog/index.tsx](src/ui/importExport/residualsDialog/index.tsx)).
4. **Link.** Type `[[Meeting notes]]` in the Markdown pane (there is no autocomplete). It becomes a clickable link in the rich pane, and the link index updates incrementally ([src/engine/wiki-link-marked.ts](src/engine/wiki-link-marked.ts), [src/hooks/useLinkIndex.ts](src/hooks/useLinkIndex.ts)).
5. **Follow connections.** The status-bar chip (for example "3 links · 1 broken") opens the Document Links tray, with backlinks and their context ([src/ui/links/backlinksPanel/index.tsx](src/ui/links/backlinksPanel/index.tsx)).
6. **Explore.**
   - ⌘⇧G or the Map button opens `/graph`: notes clustered by folder, filters for unlinked and broken notes, and a rail with headings and links. Double-click opens a note ([src/ui/graph/graphView/index.tsx](src/ui/graph/graphView/index.tsx)).
   - ⌘⇧K shows the same library as cards ([src/ui/cards/cardsView/index.tsx](src/ui/cards/cardsView/index.tsx)).
7. **Back up.** File ▸ Export ▸ Full backup (.zip) writes one JSON envelope per document, in its folders, under a timestamped name ([src/PerssonifyEditor.tsx:2147-2222](src/PerssonifyEditor.tsx#L2147-L2222)).

**Outcome:** a connected local library and a restorable backup. **Friction:** restoring into a non-empty library duplicates rather than replaces (§4.6).

### Journey 3: a developer embeds the editor in their app (npm)

1. **Install and mount.** Add `@perssonify/editor`, then import `PerssonifyEditorIntegration` and `@perssonify/editor/styles.css` ([package.json](package.json) `exports`, [src/index.tsx](src/index.tsx)). Add KaTeX's CSS if documents may contain math.
2. **Configure.** Pass `isDark`, `accent`, `chrome="minimal"`, `initialDocument`, `readOnly`, `fitParent` and `storageConfig` ([src/integration/PerssonifyEditorIntegration.tsx](src/integration/PerssonifyEditorIntegration.tsx)). When storage is empty, the editor seeds exactly the one `initialDocument`.
3. **Drive it.** From `onReady` or a `ref`, call `addDocuments`, `openDocument`, `updateDocument`, `appendToDocument`, `getMarkdown` or `exportAs` (the imperative handle in [src/PerssonifyEditor.tsx](src/PerssonifyEditor.tsx)).
4. **Listen.**
   - `onChange` fires on each pane projection.
   - `onContentChange` is debounced by 300 ms.
   - `onSave` fires on explicit saves.
   - `onLinkClick` can return `true` to take over navigation ([src/hooks/useLinkIndex.ts](src/hooks/useLinkIndex.ts)).
5. **Persist.** Documents stay in the end user's browser (IndexedDB, limited by the browser's quota unless the host sets `maxBytes`), or go through a host `storageAdapter` ([src/store/documents/documentStore.ts](src/store/documents/documentStore.ts), [src/store/persistence/idb-storage-adapter.ts](src/store/persistence/idb-storage-adapter.ts)).

**Iframe variant:**

1. Build and self-host `dist-embed` (`bun run build:embed`).
2. Frame it with `?theme=…&chrome=…&allowed_origin=https://host.example`.
3. Drive the same actions over postMessage with `createEditorClient(iframe)` ([src/embed.tsx](src/embed.tsx), [src/integration/host-bridge.ts](src/integration/host-bridge.ts)).

The production site does not serve the embed, so the Share / embed builder's snippet won't work as-is.

**Outcome:** an in-app Markdown editor with no backend to run. **Friction:** the Partial rows in §4.12.

## 6. Integrations

| Service | Used for | Where | Notes |
|---|---|---|---|
| Vercel | Hosts the static app and runs the one serverless function | [vercel.json](vercel.json), [api/import.js](api/import.js) | Every non-`/api` path is rewritten to the app. The service worker and `index.html` are sent with no-cache headers. |
| Import relay (first-party, on Vercel) | Fetches a URL for Import from URL when the host blocks direct browser reads, and only if the user has agreed | [api/import.js](api/import.js), [src/store/importExport/url-import.ts](src/store/importExport/url-import.ts) | See the relay rules below the table. |
| GitHub, Dropbox, Google Drive / Docs / Sheets, any web host | Sources for Import from URL | [src/store/importExport/import-url-normalize.ts](src/store/importExport/import-url-normalize.ts), [src/store/importExport/url-import.ts](src/store/importExport/url-import.ts) | GitHub file links become `raw.githubusercontent.com` links; Dropbox gets `dl=1`; Drive file links become direct downloads. Fetched from the browser without cookies or referrer. Google Docs is always rejected (§7.2). |
| Remote image hosts | Images that documents reference by URL | [src/extensions/SizedImage.ts](src/extensions/SizedImage.ts), [src/store/importExport/print-export.ts](src/store/importExport/print-export.ts), [src/utils/remote-images.ts](src/utils/remote-images.ts) | The browser loads them directly and sends no referrer (`index.html`, `embed.html` and `vercel.json` all set `no-referrer`). Settings ▸ Privacy ▸ Block remote images stops these requests from the next load, through a CSP `img-src` the app shell installs; the npm library never installs it. Together with URL import, this is the only traffic to third parties. |
| Host applications | Embedding via the npm component or the iframe bridge | [src/integration/](src/integration/) | §4.12 |
| npm registry | Distribution of `@perssonify/editor` | [package.json](package.json) (`publishConfig`) | Whether it is published can't be verified from code. |

**Relay rules** ([api/import.js](api/import.js)):

- Used by the app only with the visitor's consent: asked once, before the first use, remembered, and changeable in Settings ▸ Privacy.
- `GET` only. Browser requests from other sites are refused (`Sec-Fetch-Site`); a non-browser client can still call it, within the limits below.
- 40 requests per minute per IP, counted per warm instance.
- Ports 80 and 443 only.
- DNS answers are checked and pinned; only global-unicast addresses are fetched (an allowlist, so private, loopback, link-local and reserved space are all refused).
- At most 5 redirects, each one re-checked.
- 20 s per hop and a 4 MB cap; a larger file gets a 413 with a message the app shows.
- The response is forced to `application/octet-stream` with a sandbox CSP, and CORS is limited to `https://markdownstudio.com` and its `www` host.
- One structured log line per request: host, status, bytes, time and a reason — never the path or query, which can carry tokens. The address can still appear in the hosting provider's own request logs, which the consent prompt says.

**Not present** (checked across `src/`, `api/`, `public/` and the HTML entry points):

- Analytics or telemetry.
- External error reporting. Errors go to a local, redacted log the user can copy (§4.11); a host can subscribe with `setErrorReporter`.
- Ad networks.
- Identity or authentication providers.
- Cloud storage or sync.
- AI or LLM APIs. "Copy as AI prompt" only copies text to the clipboard.
- Payments and email.
- CDN-hosted fonts. Fonts are bundled.

**Bundled engines** (they run locally and make no network calls): KaTeX (math), Mermaid (diagrams), abcjs (music notation), mammoth (Word import), docx (Word export), fflate and zip.js (archives, encrypted ZIP).

## 7. Gaps and unknowns

### 7.1 Not built

- **Accounts, cross-device sync, sharing and collaboration.** Moving a library means exporting and importing it. Share links carry settings only (§3).
- **Live multi-tab sync.** Tabs only detect a conflict and stop saving. There is no cross-tab messaging ([src/store/documents/documentStore.ts](src/store/documents/documentStore.ts)).
- **Linking helpers:**
  - `[[` autocomplete;
  - creating a note from a missing link;
  - updating links when a document is renamed ([src/hooks/useLinkIndex.ts](src/hooks/useLinkIndex.ts)).
- **Tags.** No user interface; the field exists only on the record ([src/store/documents/document.ts](src/store/documents/document.ts)).
- **Trash or undo delete.** Recovery goes through Version history.
- **Transclusion, block references and `:::fields` blocks.** The code exists but is never enabled (Dead, §4.2).
- **Code syntax colours.** No styles exist for the token classes.
- **Image resizing and table column resizing.** [src/extensions/SizedImage.ts](src/extensions/SizedImage.ts) only keeps width and height, and tables are configured `resizable: false` ([src/ui/panes/tiptapPane/index.tsx:309](src/ui/panes/tiptapPane/index.tsx#L309)).
- **PDF import**, and a working Google Docs import.
- **Any revenue path** (the ad slots are development-only placeholders) and **any usage measurement**.

### 7.2 Built but broken or incomplete

Found by reading the code, ordered by how directly users hit them.

1. **The first-run graph ships with broken links.**
   - The Welcome document's title is taken from its first heading ("Markdown Studio"), not "Welcome" ([src/PerssonifyEditor.tsx:1579-1588](src/PerssonifyEditor.tsx#L1579-L1588) → `completeIngest` in [src/store/importExport/ingest.ts:625-640](src/store/importExport/ingest.ts#L625-L640) → `resolveDocTitle`).
   - So the three `[[Welcome]]` links in the companion documents ([src/data/starter-documents.ts:39](src/data/starter-documents.ts#L39), [:280](src/data/starter-documents.ts#L280), [:374](src/data/starter-documents.ts#L374)) resolve to nothing.
   - The test that should catch this hard-codes the old title ([src/\_\_tests\_\_/starter-documents.test.js:38](src/__tests__/starter-documents.test.js#L38)).
2. **Cards can't be edited in place below 480 px** unless a view preference was saved earlier ([src/ui/cards/cardsView/index.tsx](src/ui/cards/cardsView/index.tsx)).
3. **URL import has three defects:**
   - **Google Docs is always rejected.** The normaliser asks for `format=html`, then an HTML guard for all `google*` providers refuses the result ([src/store/importExport/url-import.ts:339](src/store/importExport/url-import.ts#L339)).
   - **`.tar`, `.tgz` and `.tar.gz` from a URL lose their extension and fail** (`nameFromUrl`, [src/store/importExport/url-import.ts:132](src/store/importExport/url-import.ts#L132)).
   - **"The request timed out" can never show.** The code checks for `AbortError`, but `AbortSignal.timeout` throws `TimeoutError` ([src/store/importExport/url-import.ts:242](src/store/importExport/url-import.ts#L242)).
4. **`.mdown` files import as plain text.** The picker accepts them ([src/ui/chrome/menuBar/index.tsx:498](src/ui/chrome/menuBar/index.tsx#L498)), but the loose-file detector doesn't recognise the extension ([src/store/importExport/import-export.ts:65-75](src/store/importExport/import-export.ts#L65-L75)).
5. **A file dropped outside the panes or the Files tab navigates the tab to that file.** The leave-page prompt and crash stash still apply.
6. **Emptying the library yourself re-seeds the three starter documents** on the next load, because seeding runs whenever storage holds no documents. This contradicts the promise in [src/data/starter-documents.ts](src/data/starter-documents.ts) that deleting them is permanent. (A library the browser wiped is detected and is not re-seeded.)
7. **Settings controls that do less than they say:**
    - "Collapsible details" does nothing.
    - The "Keyboard shortcuts" off switch leaves the pane keymaps on.
    - The layout picker doesn't leave Cards or Map.
8. **The storage-usage chip stays hidden after a reload** until the first save.
9. **A multi-tab conflict never clears.** Every later edit conflicts again. The only exits are Revert (which takes the other tab's version) and a reload.
10. **Copy as AI prompt is lossy.** It uses the last-saved copies, runs paragraphs together, and lists relationships by id.
11. **Host API rough edges:**
    - `exportAs` doesn't await ZIP exports.
    - `setMode` is neither validated nor kept to the session.
    - `themeVars` is not sanitised.
    - `storageAdapter` doesn't fully replace browser storage (§4.12).
    - Only one editor per page is supported: the stores are module singletons. This is documented; remounting the editor works.
12. **The embed isn't deployed**, so the builder's iframe snippet is broken in production. The snippet is built at [src/ui/share/linkBuilder/index.tsx:197](src/ui/share/linkBuilder/index.tsx#L197); [vite.app.config.ts:99](vite.app.config.ts#L99) and [vercel.json](vercel.json) show the embed isn't part of the deployed build.

### 7.3 Docs and in-app text that promise more than the code does

**In the app (users read these):**

| Claim | Where it's made | What the code does |
|---|---|---|
| "Your library starts with three linked documents" | [src/ui/pages/helpPage/help-content.ts:219](src/ui/pages/helpPage/help-content.ts#L219); Welcome text [src/constants.ts:97-101](src/constants.ts#L97-L101) | The links back to Welcome are broken (§7.2 #1). |
| "Type `[[` anywhere to link documents"; the map's empty state says "Type `[[` … and pick a note" | [src/constants.ts:99](src/constants.ts#L99); [src/ui/graph/graphView/index.tsx:1115](src/ui/graph/graphView/index.tsx#L1115) | There is no picker; only emoji has suggestions. |
| "flip the pill above to **Styled** to keep colors" | [src/constants.ts:112](src/constants.ts#L112) | Styled is already the default ([src/store/preferences/uiStore.ts:167](src/store/preferences/uiStore.ts#L167)), so flipping switches to Clean. |
| "fenced code blocks with syntax highlighting" | [src/ui/pages/helpPage/help-content.ts:120](src/ui/pages/helpPage/help-content.ts#L120) | No colours (§4.2). |
| Strikethrough, tables, checklists and math "survive both panes, every export" | [src/ui/pages/helpPage/help-content.ts:95](src/ui/pages/helpPage/help-content.ts#L95) | HTML/PDF show raw LaTeX; Word keeps LaTeX source and drops checkbox state. |
| "Re-import the ZIP to return the library to exactly that state" | [src/ui/pages/helpPage/help-content.ts:159](src/ui/pages/helpPage/help-content.ts#L159) | Additive, re-stamped, titles pinned, size-capped (§4.6). |
| Link to heading builds `[[Document#Heading]]` links | [src/ui/pages/helpPage/help-content.ts:86](src/ui/pages/helpPage/help-content.ts#L86) | It builds only same-document `[[#Heading]]`. |
| Map: "Isolate to hide everything but the selection"; "orphans (notes nothing links to)" | [src/ui/pages/helpPage/help-content.ts:219](src/ui/pages/helpPage/help-content.ts#L219), [:221](src/ui/pages/helpPage/help-content.ts#L221) | Isolate dims to 12%. An orphan is a note with no links in *or* out. |
| "click a rendered formula to edit its source" | [src/ui/pages/helpPage/help-content.ts:116](src/ui/pages/helpPage/help-content.ts#L116) | Double-click, Enter or F2. |
| The Help page's iframe snippet | [src/ui/pages/helpPage/help-content.ts](src/ui/pages/helpPage/help-content.ts) (Sharing & embedding) | Targets the undeployed `/embed.html` (§7.2 #12). |
| "Install it as an app … to work offline" | [src/ui/pages/helpPage/help-content.ts](src/ui/pages/helpPage/help-content.ts) (Offline & privacy) | Understated: offline works after one online visit whether or not the app is installed (§4.13). Installing matters for Safari's 7-day storage limit instead. |
| About: "Import and export … Word and PDF" | [src/ui/pages/aboutPage/index.tsx](src/ui/pages/aboutPage/index.tsx) | No PDF import. |
| Clear and Revert dialogs say "cannot be undone" | [src/PerssonifyEditor.tsx](src/PerssonifyEditor.tsx), [src/hooks/useDocumentLifecycle.ts](src/hooks/useDocumentLifecycle.ts) | Understated: a cleared document can be recovered from Version history, and a revert can be undone. (The delete dialogs now describe the copy Version history keeps.) |

**In README, `docs/` and `marketing/`:**

| Claim | Where it's made | What the code does |
|---|---|---|
| "Markdown Extra" as a distinct flavor | [README.md](README.md), [marketing/03-feature-list.md](marketing/03-feature-list.md) | GitHub plus footnotes; `{#id}` heading ids are not supported (the text stays as written). |
| `onFieldChange`, `onExport`, `fieldSchemas`, `linkResolver`, `setFieldSchemas` | [README.md](README.md), [docs/features.md](docs/features.md), [docs/integration-guide.md](docs/integration-guide.md) | Never fired or read. |
| `setDocuments` is "destructive"; `importContent` "does not persist" | [docs/integration-guide.md](docs/integration-guide.md) | `setDocuments` is an additive alias; `importContent` persists and activates. |
| Field blocks, transclusion and block IDs are "fully live as editor nodes" | [docs/features.md](docs/features.md) | Not registered (§4.2). |
| `markdownstudio.com/embed/` as an embed URL; `themeVars` is sanitised | [docs/integration-threejs.md](docs/integration-threejs.md) | That URL serves the standalone app; `themeVars` is not sanitised. |
| Associations appear in backlinks and the graph | [src/integration/associations.ts](src/integration/associations.ts) (header comment) | They appear in neither. |
| Autosave "~5 s after editing stops" | [README.md](README.md), [docs/features.md](docs/features.md) | About 5 s after the *first* change. |
| `.mdown` / `.txt` imported as Markdown | [README.md](README.md) | Plain text. |
| Internal docs cite test counts, version 1.72.0, Vite 6, 5 palettes, MD-only on mobile | [README.md](README.md), [HANDOVER.md](HANDOVER.md), [docs/](docs/) | Superseded: 196 test files, 1.77.0, Vite 8, 6 palettes, stacked split on phones. |

### 7.4 Unknowns (not answerable from the code)

- **Whether markdownstudio.com runs this build.** The deploy config and a QA script target it; nothing in the repo proves it.
- **Whether `@perssonify/editor` is published on npm**, and at which version.
- **Adoption and usage.** There is no analytics, so there are no product metrics beyond the hosting provider's request logs.
- **Who embeds it.** Code comments mention a host serving it at `/meridien/editor/` ([vite.embed.config.ts](vite.embed.config.ts)) and a Three.js scene integration ([docs/integration-threejs.md](docs/integration-threejs.md); the `bg=transparent` parameter in [src/embed.tsx](src/embed.tsx)). No customer is named in code.
- **Real-browser behaviour of PWA install.** Offline use and update delivery are tested in a real browser ([e2e/cases/pwa.mjs](e2e/cases/pwa.mjs)); installing is not ([e2e/README.md](e2e/README.md)).
- **⌘N for "New document".** It is handled in code, but browsers usually reserve that key for a new window.
- **Everything marked as a code trace in this document** was established by reading, not by running the app. The one finding confirmed by executing the pinned library, a nested-checklist defect, has since been fixed.
