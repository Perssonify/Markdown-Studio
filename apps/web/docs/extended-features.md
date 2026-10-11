# Extended Features (2026)

> **Superseded — see [features.md](features.md).** This file was an early snapshot
> of the 2026 additions and some of its UI descriptions have since drifted (e.g. the
> library now lives in the **Workspace panel's Files tab**, not a standalone sidebar,
> and there is no tab bar). It is kept for its per-subsystem architecture notes, but
> **[features.md](features.md)** is the authoritative feature reference and
> [v1-to-current-changelog.md](v1-to-current-changelog.md) is the full delta.

New capabilities layered onto the dual-pane editor. This complements
[features.md](features.md); read that first for the baseline (documents, wiki links,
graph, find/replace, import/export). Everything here runs in the browser and is
MIT-licensed; the product's one piece of server code, the opt-in URL-import
relay, is described in [import-relay.md](import-relay.md).

> **Latest additions** (see [features.md](features.md) for details): Word (`.docx`)
> export, PDF/print, **YAML front matter**, global full-text search (⌘⇧F),
> multi-select & "all documents" ZIP export, **Import from URL**, an accessible
> knowledge graph, **idle autosave** (browser-local), and **offline (PWA)** support.
> Embedding a host app? Start with the **[integration guide](integration-guide.md)**
> (autosave/persistence contract, theming, default mode, deep links).

---

## Markdown flavors & feature toggles

Configured in the **Settings** panel (gear in the menu bar / File ▸ Settings) and
persisted under `__prefs.markdownFeatures`.

- **Flavor presets** — CommonMark / GitHub Flavored / Markdown Extra. Choosing a
  preset applies its feature defaults (`src/store/preferences/settings.ts`).
- **Per-feature toggles** (Settings ▸ Features) — tables, task lists,
  strikethrough, autolink, footnotes (footnotes are on only in the Markdown
  Extra preset). Implemented in `src/engine/build-marked.ts` via `marked`
  options and tokenizer disables; the engine rebuilds the `marked` instance on
  change and the preview re-syncs immediately (`useMarkdownEngine.ts` →
  `configVersion`). A document whose rich formatting the markdown cannot carry
  (alignment; colour in Clean mode) keeps it through such a change — only its
  markdown pane is re-projected.
- **Always on:** `[[wiki links]]` are a marked inline extension
  (`src/engine/wiki-link-marked.ts`), so they are never rendered inside code.
- **Curly `{key=val}` formatting is off by default** and has no switch in
  Settings (`curlyBraceFormatting`). With it off, braces in prose —
  `## Returns {Promise}` — stay exactly as written; when a caller turns it on, a
  group renders only if every key is known and every value validates.

**Architecture:** `marked` is now a per-instance object (not the global
singleton) so flavors can toggle at runtime. See
[build-marked.ts](../src/engine/build-marked.ts).

## LaTeX math (KaTeX)

- `$…$` inline and `$$…$$` block. Rendered live in the rich pane by dedicated
  TipTap nodes (`src/extensions/MathNodes.tsx`) that lazy-load KaTeX.
- Full round-trip: `src/engine/math-marked.ts` emits `data-math-*` placeholders;
  turndown rules restore the `$…$` source.
- Delimiters follow Pandoc: inline `$…$` must open before a non-space and close
  after one, on one line, so prose like `$5 and $10` is not maths — nor is
  `$5-$10`, where content starting with a digit is followed by one. Block `$$`
  must start a line and its closing `$$` end one; a `$$…$$` in the middle of a
  paragraph stays literal text.
- While maths is on, a literal `$` typed in the rich pane is escaped exactly
  where it would otherwise open a formula, so it stays a dollar sign.

## Diagrams (Mermaid) & music (ABC)

- ```` ```mermaid ```` and ```` ```abc ```` fenced blocks render in one framed
  card — label, Edit/Copy, the (still-editable) source and a live preview — via
  `src/ui/panes/diagramPreview/index.tsx`, which lazy-loads Mermaid / abcjs only when such a
  block appears. They re-render on theme change. A renderer that fails to load
  is tried again next time, and the preview says it could not be loaded.
- Mermaid's configuration keys that paste CSS into the page (`themeCSS`, font
  families, theme variables) are locked, so a `%%{init}%%` block in a document
  cannot restyle the app.
- Because they are ordinary code blocks, the fenced source round-trips for free.

## Emoji

- `:shortcode:` from a curated map (`src/engine/emoji-map.ts`), rendered by
  `marked-emoji` as `<span data-emoji="name">`. The rich pane holds it as an
  inline `emoji` node (`src/extensions/EmojiNode.ts`, registered in both the
  editor and the serializer) that keeps the name, and turndown's `emoji` rule
  writes `:name:` back — so the shortcode survives a rich-pane edit. Typing
  `:name:` in the rich pane converts it too, with a suggestion list as you type.

## Theme / accent selector

- Light/dark/System (next-themes; System is the default) plus six **accent
  palettes** (amber/blue/violet/emerald/rose/mono) applied as `data-palette` on
  `<html>`, orthogonal to light/dark.
- Persisted in localStorage and applied before first paint
  (`src/theme/palette.ts`, `initPalette()` in `main.tsx`). Controls live in
  View ▸ Appearance and the Settings panel (`src/ui/settings/themeControls/index.tsx`).

## Nested folders (file explorer)

- The Workspace panel's **Files** tab renders a **folder tree** (`src/ui/workspace/folderTree/index.tsx`):
  create/rename/delete folders, "Move to…" for docs and folders (cycle-guarded), expand/collapse.
- **Design:** folders are an organizational overlay persisted under
  `__prefs.folderTree` (`src/store/documents/folders.ts`) — documents stay flat in storage,
  their tree position is metadata. This keeps the document save-path and the
  IndexedDB schema untouched. Orphan metadata is pruned when docs are deleted.

## Archive import / export

- **Import** (`src/store/importExport/archive.ts`, fflate): drop or pick a `.zip` / `.tar` /
  `.tar.gz` / `.gz`; text docs (md/html/txt/json) are extracted and their
  directory paths become folders. Junk is skipped — `__MACOSX`, anything inside a
  hidden directory, and non-text files — but a dot-prefixed file name (a note
  called ".env setup") is kept.
- **Export folder → ZIP:** the folder menu's "Export as ZIP" walks the subtree,
  reads the documents in one batch, serializes each doc's canonical to Markdown
  headlessly (`src/engine/serialize-doc.ts`, JSON fallback) and compresses file by
  file, yielding to the event loop, into one archive. A document that cannot be
  read is reported rather than silently missing.

## Settings panel

`src/ui/settings/settingsSheet/index.tsx` — a side sheet hosting Appearance (theme + accent),
Markdown flavor presets, per-feature toggles (Features), the math / diagram /
music / emoji / callout / details switches (Extensions), Editor, Reading &
typography, Storage & backup, Privacy (the import relay, Block remote images),
an Admin section shown only in development builds or when localStorage
`pf:admin` is `"1"`, and Local data ("Erase all local data"). All choices persist
automatically.

---

## Round-trip fidelity summary

| Feature | Renders in rich pane | Survives rich-pane round-trip |
|---|---|---|
| Math `$…$` / `$$…$$` | ✅ (KaTeX) | ✅ (TipTap node) |
| Mermaid / ABC | ✅ | ✅ (fenced code) |
| Background-color / text color / font | ✅ | ✅ in Styled mode (inline `<span style>`); stripped in Clean mode |
| Tables (incl. math/emoji/strikethrough in cells) | ✅ | ✅ |
| Table column alignment `:-:` / `--:` / `:--` | ✅ | ✅ (cell `align` attribute) |
| A list or second paragraph inside a table cell | ✅ | ⚠️ flattened — a GFM cell is one line (reported) |
| Emoji `:name:` | ✅ | ✅ (inline `emoji` node) |
| Footnotes `[^label]` | ✅ (numbered link + list) | ✅ (rebuilt by turndown rules) |
| Text alignment | ✅ | ⚠️ no Markdown carrier (reported) |

The markdown **source pane** always preserves exactly what you type until you
edit the rich pane. See [gotchas.md](gotchas.md) for details.
