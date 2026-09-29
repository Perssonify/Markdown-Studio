# FAQ and objections

Answers you can publish as-is. The limitation answers are written honestly on
purpose: a buyer who discovers a limit after switching is a refund and a bad
review, and the honesty makes the other claims land.

---

## Basics

**What is Markdown Studio?**
A Markdown editor with two panes: raw Markdown on one side, formatted rich text
on the other, showing the same document and staying in sync as you type. Edit
whichever side suits what you're doing.

**What does it cost?**
It's free.

**Do I need an account?**
No. There's nothing to sign up for.

**Where are my documents stored?**
In your browser's own storage (IndexedDB), on your device. They are not uploaded
anywhere.

**Does it work offline?**
Yes. You can install it as an app and use it with no network at all.

---

## The editing model

**Is the right pane just a preview?**
No — it's a full editor. Tick a checkbox, drag an image's size, use the table
grid picker, format inside a table cell. Everything you do there comes back as
Markdown.

**Will it mangle my Markdown?**
This is the question the product is built around. Neither the Markdown text nor
the HTML is treated as the source of truth — both panes are views of one
structured document, and the Markdown is generated from it. That's what keeps
`**bold**` from drifting to `__bold__`, keeps tables intact, and keeps Mermaid
blocks, LaTeX, footnotes and sized images surviving the trip in both directions.

**Can I use just one pane?**
Yes. Markdown only, rich text only, or split. The split divider is draggable.

**Which Markdown flavour?**
CommonMark, GitHub Flavored, or Markdown Extra — with individual features
(tables, footnotes, math, emoji, task lists, callouts) switchable in Settings.

---

## Features

**Does it do LaTeX?**
Yes — inline `$…$` and display `$$…$$`, rendered with KaTeX, plus a dialog with
a live preview for composing an equation.

**Diagrams?**
Mermaid, edited in place with the source and rendered picture in one frame. ABC
music notation too.

**Can I link notes together?**
Yes. `[[Document]]` links a note, `[[Document#Heading]]` links a section. Every
note shows its backlinks, and the relationship map draws the whole library as a
graph you can explore.

**Can I get my work out?**
Markdown, HTML, Word (.docx), PDF or JSON per document; the whole library as a
ZIP that re-imports with folders, tags and timestamps intact.

**What can I import?**
Markdown, HTML, plain text, Word documents, and ZIP/TAR archives — including
password-protected ZIPs. Also directly from a URL (Google Drive, GitHub,
Dropbox, or any direct link).

---

## Limitations — the honest answers

**Can I collaborate with someone in real time?**
No. There's no multiplayer editing, no comments and no presence. If real-time
collaboration is a requirement, this isn't the tool.

**Does it sync between my devices?**
No. Documents live in the browser you wrote them in. To move them, export
(one click for the whole library) and import on the other device. This is the
direct consequence of having no server — the same reason nothing is uploaded.

**What if I clear my browser data?**
Your library goes with it. Local-only storage means the backups are yours to
keep: export the library ZIP periodically. The app also keeps recoverable
version snapshots, but those are local too, so they don't survive clearing site
data.

**Can I use it on my phone?**
Yes — the interface adapts down to phone widths with touch-sized controls. The
two panes stack rather than sitting side by side on narrow screens. It's
genuinely usable, though a large document is more comfortable on a bigger
display.

**Is my data recoverable if something goes wrong?**
There are several layers: autosave, per-document undo history, a backstop that
refuses to let a blank editor overwrite a document with content, recoverable
version snapshots in a separate database, and multi-tab conflict detection. None
of that survives clearing your browser storage, which is why the export exists.

**How big a library does it handle?**
Hundreds of documents is fine for writing and browsing. The relationship map is
the one place size shows: a very large library takes a couple of seconds to lay
itself out the first time you open the map, and past a few hundred notes it
becomes a picture of the shape of your library rather than something you read
note by note — that is what the search and filters are for.

**Does it have AI features?**
No. It's an editor.

---

## For developers

**Can I embed it?**
Yes — as a React component or an iframe with a `postMessage` bridge. You control
the chrome, theme, accent colour, read-only state, view mode and starting
document.

**Will importing its stylesheet wreck my app's styling?**
No. The editor is built on Tailwind, whose reset is global by design — so the
published stylesheet confines that reset to the editor's own subtrees, including
the menus and dialogs that mount outside them. Your headings keep their size,
your links keep their underline, your elements keep their margins.

**Can I use my own storage?**
Yes. The storage layer is a pluggable adapter, so you can persist wherever your
app already does.

**Does it need a backend?**
No. The one server-side piece is an optional relay used for importing from a
URL, and only if you use that feature.

**What's the package called?**
`@perssonify/editor`. The npm coordinate hasn't changed with the product name —
renaming it would break existing installs for no benefit.
