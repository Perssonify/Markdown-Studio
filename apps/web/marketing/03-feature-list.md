# Feature list

Every item is in the shipped product. Grouped for feature grids and spec tables.

---

## The headline six

For a homepage grid. Each is a genuine differentiator, not table stakes.

| Feature | One line |
| --- | --- |
| **Two panes, always in sync** | Raw Markdown and formatted rich text, side by side — edit either, both update |
| **Everything round-trips** | Math, diagrams, tables and callouts all come back as clean Markdown |
| **Linked notes and a live map** | `[[wiki links]]` plus a relationship map you can explore and click through |
| **Your documents stay in your browser** | No account, no server copy, no analytics — and it works offline |
| **Hard to lose work** | Autosave, per-document undo, version snapshots, blank-overwrite protection |
| **Leaves as easily as it arrives** | Export to Markdown, HTML, Word, PDF, JSON, or your whole library as a ZIP |

---

## Editing

- Dual-pane editing with bidirectional live sync
- Three layouts: Markdown only, rich text only, or split — with a draggable divider
- Heading-anchored scroll sync, so the two panes stay aligned section by section
- Full formatting toolbar: bold, italic, underline, strikethrough, inline code,
  headings H1–H6, lists, quotes, alignment, text and highlight colour, fonts
- Tables with a grid picker, per-cell rich formatting, and row/column operations
- Interactive task lists (`- [ ]`) with tick-boxes that work, including nesting
- Code blocks with a language tag and a copy button
- Images that keep their width and height, and theme-aware images that swap for
  light/dark
- Right-click context menu for formatting, insertion and linking
- Change case (UPPER / lower / Title), with a content-only mode that skips code
- Structured selection: select every heading, paragraph, list item, code block,
  link, table row or image at once

## Rich content

- **LaTeX math** — inline `$…$` and display `$$…$$`, rendered with KaTeX, with a
  live-preview equation dialog
- **Mermaid diagrams** — edited in place, source and rendered output in one frame
- **ABC music notation** — rendered as a score
- **Callouts** — `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`
- **Collapsible sections** — `<details>` / `<summary>`
- **Footnotes**, **YAML front matter**, **emoji shortcodes**
- Markdown flavours: CommonMark, GitHub Flavored, or Markdown Extra, with
  per-feature toggles

## Organising

- Multiple documents with nested folders, drag-and-drop reordering and moving
- Full-text search across every document
- Live document outline that follows your scroll position
- `[[wiki links]]` between documents, and `[[Doc#Heading]]` to a section
- Backlinks — every document shows what links to it
- **Relationship map** — the whole library as a force-directed graph, with
  folder clusters, search, orphan and broken-link health checks, and a docked
  inspector showing a note's headings and every link in and out. Names are
  placed so nothing is ever drawn over text, at any zoom or screen size
- **Cards board** — a Keep-style wall of every note with quick capture,
  checklists, nine colours, pinning and search

## Finding and changing

- Find & Replace in a floating, draggable panel
- Regex, case-sensitive and whole-word matching
- Scope filters — search only headings, or only code, or everything except links
- Match markers drawn on the scrollbar
- Apply formatting to every match at once

## Import and export

- **Export** a document as Markdown, HTML, Word (.docx), PDF or JSON
- **Export** the whole library as a ZIP that re-imports with folders, tags,
  metadata and timestamps intact
- **Import** Markdown, HTML, plain text, Word documents, or ZIP/TAR archives —
  including password-protected ZIPs
- **Import from a URL** — Google Drive, GitHub, Dropbox or any direct link. Your
  browser fetches it directly; if a site blocks that, the app asks before using
  its own hardened relay (never a third-party proxy)
- **Import fidelity you can read** — if a source contains something the editor
  cannot represent, it says so, and shows you exactly what and why
- ZIP exports are timestamped in their filenames

## Keeping your work

- Autosave, with a visible save state
- **Blank-document backstop** — an empty editor can never overwrite a document
  that has content
- **Per-document undo history** — switching documents doesn't cost your undo stack
- **Version history** — recoverable snapshots in a separate database; restore in
  place or as a new document
- **Multi-tab conflict detection** — two windows can't silently overwrite each other
- **Persistent storage** — the app asks the browser not to clear your library,
  and Settings shows whether it agreed and how much space the library uses
- **Backup reminder** — a nudge when your last full backup is more than a week old
- **Wiped-library detection** — if the browser ever empties your library, the app
  says so and offers to restore a backup instead of quietly starting over

## Privacy

- Documents are stored only in your browser — no account, no server copy
- No analytics, tracking or telemetry; error diagnostics stay on the device
  until you copy them
- **Import from a URL** asks before using the app's relay, and remembers your answer
- **Block remote images** — stop images hosted elsewhere from loading, and from
  telling their host when you open a document
- No referrer is sent with image or import requests
- **Erase all local data** — one confirmed button removes every document,
  version and setting from this browser

## Look and feel

- Light, dark and system themes, plus accent palettes including monochrome
- Reading controls: font size, line height, reading width, spellcheck
- Focus mode that dims the interface around your text
- Full keyboard shortcuts, listed in-app and switchable between Mac and
  Windows/Linux notation
- Responsive from phone to desktop, with touch-sized controls
- Installable as an app; works offline after one online visit, installed or not

## For developers

- Ships as an **embeddable React component** and as an **iframe embed** with a
  `postMessage` bridge
- Host control over chrome, theme, accent colour, read-only state, view mode and
  the starting document
- Pluggable storage adapter — bring your own persistence
- Shareable links with view mode, read-only and theme baked in
- TypeScript types included; MIT licensed

---

## What it deliberately is not

Stating these makes the rest believable, and saves everyone's time:

- **Not a collaboration tool.** No real-time multiplayer, comments or presence.
- **Not a sync service.** Documents live in the browser you wrote them in;
  moving between devices means exporting and importing.
- **Not a publishing platform.** It exports files; it doesn't host a site.
- **Not an AI writing assistant.** It's an editor.
