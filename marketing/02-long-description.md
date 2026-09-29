# Long description

Three lengths of the full story. Use the one that fits, or lift sections.

---

## The full version (~1,000 words)

### Markdown on the left. Rich text on the right.

Every Markdown editor asks you to pick a side. Either you write in raw syntax
and hold the formatted result in your head, or you write in a rich-text editor
that hides the Markdown and hands you back something you can't quite trust.

Markdown Studio refuses the choice. It puts a raw-Markdown editor and a
formatted rich-text editor side by side, showing the same document, and keeps
them in sync as you type. Write `## Findings` on the left and the heading
appears on the right. Bold something on the right and `**` wraps it on the left.
There is no preview button, no export step to check your work, no mode to switch
between — the two panes are two views of one document, and you use whichever one
suits what you're doing right now.

That sounds simple. Making it true is the hard part, and it's what the product
is.

### It is genuinely both editors

The rich-text side is a real editor, not a preview. Tables have a grid picker
and per-cell formatting. Task lists have tick-boxes you can actually tick. Code
blocks carry their language tag and a copy button. Formulas and diagrams are
edited in place. Everything you do there comes back as clean, portable Markdown.

The Markdown side is a real editor too, with syntax highlighting, list-aware
wrapping, multi-cursor selection and a Find & Replace that can scope itself to
just headings, or just code, or everything except links.

Underneath both sits a single structured document — not the Markdown text, not
the HTML, but a document model both editors agree on. That is why the round-trip
holds: your `**bold**` doesn't drift into `__bold__`, your tables don't collapse,
and your footnotes come back as footnotes.

### The things you'd normally need a plugin for

- **Math** — LaTeX inline (`$E = mc^2$`) and as display blocks, rendered with
  KaTeX, with a live-preview dialog for composing an equation.
- **Diagrams** — Mermaid flowcharts, sequence diagrams and the rest, edited in
  place with the source and the rendered picture in one frame.
- **Music** — ABC notation, rendered as a score.
- **Callouts** — GitHub-style `> [!NOTE]` and `> [!WARNING]` blocks.
- **Collapsible sections**, footnotes, front matter, emoji shortcodes, and
  theme-aware images that swap between light and dark mode.

Every one of these round-trips to Markdown. Nothing is a one-way rendering
trick.

### Notes that know about each other

Type `[[Document title]]` to link to another document. Type `[[Doc#Heading]]`
and link to a specific section. Every document shows what links to it, and the **relationship
map** draws your whole library as a graph: documents as nodes, links as edges,
folders as labelled clusters. Select any note and you see its headings, every
note it links out to, and every note that links in — click through and keep
exploring without leaving the map.

There's a **Cards board** too, for the other half of note-taking: a
Google-Keep-style wall of every note, with one-tap capture, checklists, colours
and pinning, for the times when you want to jot rather than compose.

### Your documents stay in your browser

No account. No sync service. No copy of your documents on a server. Every
document lives in your browser's own storage, and no server stores or reads
it — not for processing, not for backup. There are no analytics, tracking or
telemetry at all. After your first visit the whole app is cached, so it opens
and keeps working with the network off, installed or not.

Two features do use the network, and both are yours to control. Importing from
a link fetches that link; if the site won't let a browser read it, the app asks
before fetching it through its own server, which passes the file straight back
without keeping a copy. And images in a document load from wherever they are
hosted, which lets that host see when the document is opened — Settings ▸
Privacy can block them.

This is a real trade-off and worth being clear about: your documents live on the
device you wrote them on. That is the point — but it means you own the backups,
and a browser can clear a site's storage (Safari does after seven days without
a visit, unless the app is on your Home Screen or Dock). The app asks the
browser to keep your library, reminds you when your last full backup is more
than a week old, and makes that backup a one-click export that restores the
whole library, folders included.

### Your work is hard to lose

For a tool that keeps your documents locally, "don't lose the work" is the
whole job. Markdown Studio takes it seriously:

- **Autosave** as you write.
- **A blank-document backstop** that refuses to overwrite a document that has
  content with one that doesn't.
- **Per-document undo history**, so switching documents doesn't cost you your
  undo stack.
- **Version history** — a recoverable snapshot net in a separate database, so
  you can roll back a document even after saving over it.
- **Multi-tab conflict detection**, so two windows can't quietly overwrite each
  other.
- **A guard against browser clean-ups** — the app asks the browser to keep your
  library, and if it ever comes back empty, says so instead of quietly starting
  over.

### It leaves as easily as it arrives

Export a document as Markdown, HTML, Word (.docx), PDF or JSON. Export your
whole library as a ZIP that re-imports with folders, tags and timestamps intact.
Import Markdown, HTML, Word documents, or a ZIP of any of those — including
password-protected archives.

Nothing here is a lock-in format. The Markdown you write is Markdown you can
take anywhere.

### And it drops into other products

The same editor ships as an embeddable component. Put it in an iframe with a
`postMessage` bridge, or install the React library and mount it directly, with
control over the chrome, theme, accent colour, read-only state and starting
document. It's used inside 3D scenes, dashboards and internal tools — anywhere
a text box isn't enough.

---

**Markdown Studio** · [markdownstudio.com](https://markdownstudio.com)
Free. Private. Offline-capable. Built by
[Perssonify Labs](https://labs.perssonify.com/).

---

## The medium version (~300 words)

### Markdown on the left. Rich text on the right.

Markdown Studio is a Markdown editor and a rich-text editor showing the same
document at the same time. Write `## Findings` in the Markdown pane and the
heading appears in the formatted pane; bold a word in the formatted pane and the
asterisks appear in the Markdown. Two views, one document, always in sync — no
preview button, no mode switching.

Both panes are real editors. The rich side has table grids, tickable task lists,
and formulas and diagrams you edit in place. The Markdown side has syntax
highlighting, multi-cursor editing and a Find & Replace that can target only
headings, or only code. Underneath is a structured document model both agree on,
which is why the round-trip actually holds.

It handles the things that usually need plugins: LaTeX math, Mermaid diagrams,
ABC music notation, callouts, collapsible sections, footnotes, front matter and
theme-aware images — all of which round-trip back to Markdown.

Notes link to each other with `[[wiki links]]`, and the relationship map draws
your whole library as a graph you can explore: select a note to see its
headings and every link in and out. A Cards board gives you a Keep-style wall
for quick capture when you want to jot rather than compose.

Your documents stay in your browser: no account, no server copy, no analytics,
and after your first visit it works offline. Your work is
protected by autosave, per-document undo history, recoverable version snapshots
and a backstop that won't let a blank document overwrite a full one.

Export to Markdown, HTML, Word, PDF or JSON — or your whole library as a ZIP
that re-imports intact. The same editor is also available as an embeddable
component for your own product.

Free, at [markdownstudio.com](https://markdownstudio.com).

---

## The short version (~100 words)

Markdown Studio is a dual-pane Markdown editor: raw Markdown on one side,
formatted rich text on the other, always in sync — edit whichever suits you.
Both panes are real editors, backed by a shared document model that keeps the
round-trip clean.

It includes LaTeX math, Mermaid diagrams, tables, task lists, callouts, and
`[[wiki links]]` with a relationship map of your whole library. Export to
Markdown, HTML, Word, PDF or JSON.

Your documents stay in your browser — no account, no server copy, and it works
offline. Free, at [markdownstudio.com](https://markdownstudio.com).
