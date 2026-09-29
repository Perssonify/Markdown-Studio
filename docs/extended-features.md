# Extended Features (2026)

> **Superseded — see [features.md](features.md).** This file was an early snapshot
> of the 2026 additions and some of its UI descriptions have since drifted (e.g. the
> library now lives in the **Workspace panel's Files tab**, not a standalone sidebar,
> and there is no tab bar). It is kept for its per-subsystem architecture notes, but
> **[features.md](features.md)** is the authoritative feature reference and
> [v1-to-current-changelog.md](v1-to-current-changelog.md) is the full delta.

New capabilities layered onto the dual-pane editor. This complements
[features.md](features.md); read that first for the baseline (documents, wiki links,
graph, find/replace, import/export). Everything here is client-only.

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
  preset applies its feature defaults (`src/store/settings.ts`).
- **Per-feature toggles** — tables, task lists, strikethrough, autolink,
  footnotes. Implemented in `src/engine/build-marked.ts` via `marked` options and
  tokenizer disables; the engine rebuilds the `marked` instance on change and the
  preview re-syncs immediately (`useMarkdownEngine.ts` → `configVersion`).

**Architecture:** `marked` is now a per-instance object (not the global
singleton) so flavors can toggle at runtime. See
[build-marked.ts](../src/engine/build-marked.ts).

## LaTeX math (KaTeX)

- `$…$` inline and `$$…$$` block. Rendered live in the rich pane by dedicated
  TipTap nodes (`src/extensions/MathNodes.tsx`) that lazy-load KaTeX.
- Full round-trip: `src/engine/math-marked.ts` emits `data-math-*` placeholders;
  turndown rules restore the `$…$` source.
- The inline tokenizer requires no inner whitespace, so prose like `$5 and $10`
  is not treated as math.

## Diagrams (Mermaid) & music (ABC)

- ```` ```mermaid ```` and ```` ```abc ```` fenced blocks render live below the
  (still-editable) code block via `src/ui/DiagramPreview.tsx`, which lazy-loads
  Mermaid / abcjs only when such a block appears. They re-render on theme change.
- Because they are ordinary code blocks, the fenced source round-trips for free.

## Emoji

- `:shortcode:` from a curated map (`src/engine/emoji-map.ts`). A turndown rule
  restores the shortcode on direct HTML→markdown. **Note:** through a rich-pane
  edit it collapses to the unicode glyph (no TipTap emoji node) — see
  [gotchas.md](gotchas.md).

## Theme / accent selector

- Light/dark (next-themes) plus five **accent palettes** (amber/blue/violet/
  emerald/rose) applied as `data-palette` on `<html>`, orthogonal to light/dark.
- Persisted in localStorage and applied before first paint
  (`src/theme/palette.ts`, `initPalette()` in `main.tsx`). Controls live in the
  app header and the Settings panel (`src/ui/ThemeControls.tsx`).

## Nested folders (file explorer)

- The Workspace panel's **Files** tab renders a **folder tree** (`src/ui/FolderTree.tsx`):
  create/rename/delete folders, "Move to…" for docs and folders (cycle-guarded), expand/collapse.
- **Design:** folders are an organizational overlay persisted under
  `__prefs.folderTree` (`src/store/folders.ts`) — documents stay flat in storage,
  their tree position is metadata. This keeps the document save-path and the
  IndexedDB schema untouched. Orphan metadata is pruned when docs are deleted.

## Archive import / export

- **Import** (`src/store/archive.ts`, fflate): drop or pick a `.zip` / `.tar` /
  `.tar.gz` / `.gz`; text docs (md/html/txt/json) are extracted and their
  directory paths become folders. Junk (`__MACOSX`, hidden files, binaries) is
  skipped.
- **Export folder → ZIP:** the folder menu's "Export as ZIP" walks the subtree,
  serializes each doc's canonical to Markdown headlessly
  (`src/engine/serialize-doc.ts`, JSON fallback), and downloads one archive.

## Settings panel

`src/ui/SettingsSheet.tsx` — a side sheet hosting Appearance (theme + accent),
Markdown flavor presets, per-feature toggles, and the math/diagram/music/emoji
extension switches. All choices persist automatically.

---

## Round-trip fidelity summary

| Feature | Renders in rich pane | Survives rich-pane round-trip |
|---|---|---|
| Math `$…$` / `$$…$$` | ✅ (KaTeX) | ✅ (TipTap node) |
| Mermaid / ABC | ✅ | ✅ (fenced code) |
| Background-color / text color | ✅ | ✅ (`textStyle` attrs) |
| Tables (incl. math/emoji in cells) | ✅ | ✅ |
| Emoji `:name:` | ✅ | ⚠️ becomes unicode glyph |
| Footnotes `[^1]` | ✅ | ⚠️ display-only |

The markdown **source pane** always preserves exactly what you type until you
edit the rich pane. See [gotchas.md](gotchas.md) for details.
