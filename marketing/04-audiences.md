# Audiences

One page per audience. Each has the hook, the argument, and the features that
matter to *them* — resist listing all of them.

---

## Developers and technical writers

**Hook:** Your README deserves better than a preview pane.

You already write Markdown. What you don't have is a way to see the rendered
result without switching tabs, and a way to fix a broken table without counting
pipes. Markdown Studio gives you the rendered page as an editable surface: drag
a column width, tick a checkbox, drop in a Mermaid diagram — and the Markdown
stays clean enough to commit.

**What matters to them:** syntax-highlighted Markdown pane · Mermaid and LaTeX
that round-trip · code blocks with highlighting · front matter · scoped Find &
Replace (only headings, only code) · GitHub-flavoured callouts and task lists ·
export straight to Markdown · embeddable.

**Proof line:** The canonical document is a structured model, not a string —
which is why your `**bold**` never drifts to `__bold__` and your tables don't
collapse on round-trip.

---

## Researchers and academics

**Hook:** Equations, diagrams and citations, without a LaTeX toolchain.

Write `$$\int_0^\infty e^{-x} dx = 1$$` and see it typeset immediately.
Compose an equation in a dialog with a live preview if you'd rather not write
LaTeX from memory. Add footnotes, structure a long argument with an outline you
can navigate, and link papers, notes and sources with `[[wiki links]]` so the
connections between them are visible rather than remembered.

**What matters to them:** KaTeX math inline and display · equation dialog with
live preview · footnotes · document outline · wiki links and backlinks ·
relationship map · export to Word for a co-author, or PDF for a submission ·
everything stays on your machine.

**Proof line:** No account and no upload — which for unpublished work is not a
feature, it's a requirement.

---

## Note-takers and knowledge-base builders

**Hook:** Your notes already have connections. This one shows them.

Link notes with `[[wiki links]]`, and every note tells you what links back to
it. Open the relationship map and your whole library is a graph — folders as
labelled clusters, links as edges. Select a note to see its headings and every
connection in and out, and click through to keep exploring.

For the other half of note-taking, the Cards board is a wall of every note with
one-tap capture, checklists, colours and pinning — jotting, not composing.

**What matters to them:** wiki links and heading anchors · backlinks ·
relationship map with orphan and broken-link checks · Cards board · nested
folders · full-text search · live outline · offline.

**Proof line:** Orphan and broken-link health checks, so a library that's
drifting tells you before it becomes unusable.

---

## Privacy-conscious writers

**Hook:** Write something you'd rather not upload.

Markdown Studio has no account, no server and no sync service. Your documents
are stored by your browser, on your device. Nothing you type is transmitted —
not for rendering, not for backup, not for analytics. Turn off the network and
it keeps working.

**What matters to them:** entirely client-side · no account · works offline ·
installable as an app · one-click full-library export so *you* hold the backups ·
version history and undo held locally.

**Proof line:** There is no server to trust, which is a stronger guarantee than
a privacy policy.

**Be honest with them:** local-only means device-only. Moving to a new machine
is an export and an import, and clearing site data clears your library. Say so.

---

## Teams embedding an editor

**Hook:** Stop building a Markdown editor. Again.

Markdown Studio ships as an embeddable React component and as an iframe embed
with a `postMessage` bridge. Control the chrome, theme, accent colour, read-only
state, starting document and storage layer. It has been embedded in dashboards,
internal tools and 3D scenes.

**What matters to them:** React component *and* iframe embed · postMessage
bridge · pluggable storage adapter · chrome and theme control · TypeScript types ·
No backend to run.

**Proof line:** Bring your own storage adapter — it doesn't assume your
persistence looks anything like ours.

---

## Choosing between them

If you can only run one message, run **the dual pane**. It is the thing no
competitor combination gives you in one place, it is understandable in four
words, and it is visible in a single screenshot. Privacy is the strongest
*second* message: it converts the people the first message attracted.
