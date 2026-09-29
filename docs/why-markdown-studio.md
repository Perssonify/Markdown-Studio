# Markdown Studio — Why It's Awesome

*The Markdown editor that finally makes "write in Markdown" and "see it beautifully"
the same act — with your work staying yours, on your own device.*

---

## The one-liner

**Markdown Studio is a dual-pane Markdown editor where the raw Markdown and the
rich, formatted view live side by side and stay perfectly in sync — so you never
have to choose between writing fast and seeing it look right.** It runs in your
browser, keeps your documents there, and has no analytics or tracking.

---

## What it does, in one paragraph

Type Markdown on the left and watch it render on the right — or edit the rich text
directly and watch the Markdown update underneath. Both panes are fully editable,
bidirectionally synced in real time, backed by a single canonical source of truth so
they never drift. Around that core it wraps a complete writing environment: a
document library with nested folders, wiki-style `[[links]]` between notes, a
knowledge graph of how everything connects, live math and diagrams, import/export
across every format that matters, and a version-history safety net. No account, no
server copy of your work, no subscription wall — open the tab and write.

---

## Who it's for

- **Technical writers & developers** who live in Markdown but are tired of blind
  editing and clunky preview panes.
- **Researchers, students & knowledge workers** building a linked web of notes — a
  personal wiki with a real relationship graph, not just a folder of files.
- **Documentation teams** who need clean, portable Markdown *and* rich formatting,
  with export to HTML, DOCX, and PDF.
- **Product teams embedding an editor** in their own app — it ships as a drop-in
  library and iframe with a clean host API.
- **Privacy-conscious writers** who want their words to stay on their own machine.
- **Anyone** who wants a fast, beautiful, offline-capable writing tool that doesn't
  ask them to sign up for anything.

---

## The value it creates

| For you… | Perssonify delivers… |
| --- | --- |
| **No context-switching** | Write and preview are the same surface — edit whichever pane fits the moment. |
| **No lock-in** | Your content is portable Markdown/HTML/JSON/DOCX. Export anytime; nothing is trapped. |
| **No accounts, no server copy** | Documents are stored only in your browser. No backend stores or reads them; the one piece of server code is an opt-in relay that fetches a link you import and passes the file straight back. |
| **No lost work** | A six-layer data-loss defence plus version history means an accidental overwrite or delete is recoverable — and the app asks the browser to keep your library and reminds you to back it up. |
| **No cost of entry** | Free, offline-capable, installable as an app. |
| **No busywork** | Import a `.docx`, a URL, or a whole ZIP archive and keep writing. |

---

## Why people should use it (the problems it solves)

1. **"Preview-pane editors feel disconnected."** Here both panes are live and equal —
   format in rich text, tweak the raw Markdown, either way it just works.
2. **"My notes are a pile of disconnected files."** Wiki links turn them into a graph;
   the relationship map shows the whole web at a glance and flags orphans and broken
   links so nothing gets lost.
3. **"I'm scared of losing work in a browser app."** The canonical source of truth is
   protected by a blank-save backstop, stale-overwrite prevention, rapid-switch
   guards, and a per-document version-history snapshot ring. It's engineered to block
   the known ways of overwriting a document by accident — and anything that slips
   through stays recoverable. Because a browser can clear a site's storage, the app
   also asks it to keep your library, reminds you to take a backup, and tells you if
   the library ever comes back empty.
4. **"Round-tripping between formats mangles my content."** Tables, task lists, math,
   diagrams, callouts, footnotes, sized/theme-aware images, and wiki links all
   survive the Markdown ⇄ rich-text round trip — pinned by an automated test suite.
5. **"I don't trust cloud editors with my writing."** Your writing stays in your
   browser: storage is local IndexedDB, no server stores or reads your documents,
   and there's no analytics or tracking. The only server code is an opt-in relay for
   importing links, and images hosted elsewhere can be blocked in Settings ▸ Privacy.
6. **"I need it to keep working on a plane / behind a firewall."** After one online
   visit the whole app is cached, so it keeps working offline — installed or not.
   (Installing it as a PWA also keeps Safari from clearing your library after a week
   away.)

---

## Standout features

### The core that makes it different
- **True dual-pane bidirectional sync** — CodeMirror 6 (raw Markdown) and
  TipTap/ProseMirror (rich text), kept in lockstep via a hash-gated, debounced,
  re-entrancy-guarded sync engine. Even **voice dictation and IME input** are handled
  correctly.
- **Three view modes** — Markdown, Rich text, or Split — switchable instantly, with a
  draggable divider and content-aware scroll sync that keeps both panes lined up by
  heading.

### A real writing environment
- **Document library with nested folders**, drag-and-drop organization, full-text
  search, and a live outline / table of contents.
- **Wiki links (`[[Doc]]`, `[[Doc#Heading]]`)** with backlinks and a **full-screen
  knowledge graph** — every note a node, every link an edge, folders as clusters —
  with search and orphan / broken-link health chips.
- **Find & Replace** that's genuinely powerful: regex, case-sensitive, whole-word,
  scope filters (search only headings, or exclude code), match markers on the
  scrollbar, and "apply formatting to all matches."

### Rich content that round-trips
- **LaTeX math** (KaTeX) with a live-preview equation dialog.
- **Mermaid diagrams and ABC music notation** rendered live, editable inline.
- **Task lists, tables, callouts/admonitions, collapsible details, emoji,
  theme-aware images, and sized images** — all first-class.
- **Clean vs Styled** output — strip decorative styling for portable Markdown, or
  preserve it as inline HTML. Your choice, with one switch.

### Import / export that respects your content
- Import **Markdown, HTML, DOCX, ZIP/TAR archives (incl. password-protected ZIPs),
  and from a URL** (Google Drive / GitHub / Dropbox).
- Export **Markdown, HTML, DOCX, PDF/print, and JSON**, plus a **re-importable
  full-library backup** with timestamped filenames.
- **"Copy as Prompt"** — grab a document plus its linked neighbors, formatted for an
  LLM.

### Built to be trusted
- **Local-first, offline-capable PWA** — no document backend, no login, no analytics
  or telemetry; remote images can be blocked, and the URL-import relay is opt-in.
- **Security-hardened** — sanitized imports, a locked-down import relay, CSS-injection
  and prototype-pollution defenses, deny-by-default embed origins.
- **Data-integrity first** — the six-layer data-loss defence and version history
  described above.

### Made to fit anywhere
- **Embeddable** as an npm library *and* an iframe, with a `postMessage` host bridge
  (set mode, theme, inject/update documents, control chrome, transparent background).
- **Themeable** — light / dark / system, multiple accent palettes, adjustable
  typography (font size, line height, reading width) and a distraction-free focus mode.
- **Responsive & touch-friendly** — works from wide desktop split-view down to a
  phone, with a drill-down mobile menu.
- **Fully keyboard-driven** — comprehensive shortcuts, a searchable help page, and a
  first-run guided tour.

---

## Why it's technically impressive (for the skeptics)

- The **canonical source of truth is ProseMirror JSON** — Markdown and HTML are
  projections of it, which is *why* the two panes can never silently disagree.
- The sync engine is battle-tested against the classic failure modes (infinite echo
  loops, composition/IME aborts, stale overwrites, rapid-switch races) with each fix
  pinned by regression tests.
- It ships **three build targets** (app, npm library, iframe embed) from one codebase,
  with CI running lint, type-checks, ~2,100 unit tests, a real-browser test campaign
  (offline use included) and all three builds on every change.
- Heavy dependencies (math, diagrams, DOCX) are **lazy-loaded**, so the base editor
  stays fast.

---

## The elevator pitch

> **Markdown Studio is what a Markdown editor should have been all along:** write in
> raw Markdown or rich text — whichever you feel like, in the same document, at the
> same time — link your notes into a living knowledge graph, drop in math and diagrams,
> and export to anything. It's free, open-source, works offline, and keeps your
> documents on your own device. No account. No server copy. No lock-in. Just open it
> and write.

---

## Quick facts for a landing page / one-pager

- **Category:** Markdown editor + personal knowledge base
- **Price:** Free
- **Runs:** In any modern browser; works offline after the first visit; installable
  as a PWA
- **Privacy:** Documents stored only in your browser — no account, no analytics or
  telemetry; remote images can be blocked; the URL-import relay is opt-in
- **Formats in:** Markdown, HTML, DOCX, ZIP/TAR (incl. password-protected ZIP), URL
  import
- **Formats out:** Markdown, HTML, DOCX, PDF, JSON, full-library backup
- **Superpowers:** Live dual-pane sync · wiki links + knowledge graph · math & diagrams
  · version history · embeddable
- **Try it:** <https://markdownstudio.com>
