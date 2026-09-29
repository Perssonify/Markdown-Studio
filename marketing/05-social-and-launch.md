# Social and launch copy

Draft posts. Adjust voice to the account; keep the claims exactly as written.

---

## X / Bluesky

**Launch (261):**
> Markdown editors make you choose: write the syntax and imagine the result, or
> use a rich editor and lose the file.
>
> Markdown Studio shows both at once. Two panes, one document, always in sync.
>
> Free, runs entirely in your browser, works offline.
>
> markdownstudio.com

**Feature — the map (204):**
> Link notes with [[wiki links]] and Markdown Studio draws your library as a
> map. Pick any note: its headings, everything it links to, everything linking
> back. Click through without leaving the map.
>
> markdownstudio.com

**Feature — privacy (163):**
> No account. No server. Nothing uploaded.
>
> Markdown Studio stores your documents in your own browser and works with the
> network off.
>
> markdownstudio.com

**Feature — round-trip (192):**
> Drop a Mermaid diagram into the rich-text pane. Look at the Markdown pane:
> it's a clean fenced code block.
>
> Math, tables, callouts, task lists — all of it round-trips.
>
> markdownstudio.com

---

## LinkedIn

**Launch:**
> **Markdown Studio is live at markdownstudio.com.**
>
> Markdown tools generally force a choice. Write in raw syntax and hold the
> formatted result in your head, or write in a rich-text editor that hides the
> Markdown and hands back something you can't quite trust.
>
> We built the version that refuses the choice: a raw-Markdown editor and a
> rich-text editor, side by side, showing the same document and staying in sync
> as you type. Edit whichever one suits what you're doing.
>
> It also handles what usually needs plugins — LaTeX math, Mermaid diagrams,
> tables, task lists, callouts — and all of it round-trips back to clean
> Markdown. Notes link to each other with [[wiki links]], and a relationship map
> draws the whole library as a graph you can explore.
>
> It runs entirely in your browser. No account, no server, nothing uploaded, and
> it works offline.
>
> Free to use. Built by Perssonify Labs.

**Short version:**
> We kept wanting a Markdown editor that showed the finished page while we wrote
> it, without hiding the Markdown. So we built one.
>
> Markdown Studio: two panes, one document, always in sync. Free, private, in
> your browser. markdownstudio.com

---

## Product Hunt

**Tagline (57):** Markdown on the left, rich text on the right, always in sync

**Description:**
> Markdown Studio is a dual-pane Markdown editor. Raw Markdown on one side,
> formatted rich text on the other, showing the same document and staying in
> sync as you type — edit whichever side suits the moment.
>
> Both panes are real editors. The rich side has table grids, tickable task
> lists and resizable images; the Markdown side has syntax highlighting,
> multi-cursor editing and a Find & Replace that can target only headings, or
> only code. A shared structured document model underneath is why the
> round-trip actually holds.
>
> Also included: LaTeX math, Mermaid diagrams, ABC music notation, callouts,
> footnotes, front matter, `[[wiki links]]` with backlinks and a relationship
> map, a Keep-style Cards board, and export to Markdown, HTML, Word, PDF or
> JSON.
>
> It runs entirely in your browser — no account, no server, nothing uploaded —
> and works offline. Free, and embeddable in your own product.

**First comment:**
> Maker here. The thing that took the longest wasn't the features, it was making
> the two panes genuinely trustworthy. Sync between a Markdown string and a
> rich-text tree is easy to get 90% right and miserable at the last 10% — bold
> markers drifting, tables collapsing, a diagram surviving one direction but not
> the other.
>
> The answer was to stop treating either text as the truth. Both panes are views
> of one structured document, and the Markdown is a projection of it. That's why
> you can bold a word on the right and get exactly the asterisks you expected on
> the left.
>
> Happy to go into any of it.

---

## Hacker News

Understated; this audience punishes marketing language.

**Title:** Markdown Studio – a dual-pane Markdown editor that runs entirely in the browser

**Text:**
> Raw Markdown in one pane, a rich-text editor in the other, both showing the
> same document and kept in sync.
>
> The interesting part is the sync. Rather than treating either the Markdown
> text or the HTML as canonical, both panes are views of a ProseMirror document,
> and the Markdown is a projection of it. Content hashing prevents echo loops.
> That's what makes the round-trip stable for the awkward cases — Mermaid
> blocks, LaTeX, footnotes, theme-aware `<picture>` images, sized images, nested
> task lists.
>
> No backend. Documents are in IndexedDB, and there's a snapshot sidecar
> database for version history plus a backstop that refuses to persist a blank
> document over one with content — the failure mode that actually loses work.
>
> The same code ships as an embeddable component.

---

## Newsletter

**Subject lines:**
- Markdown that shows its work
- We built the Markdown editor we kept wishing existed
- Two panes, one document

**Body:**
> Markdown is a good format and an awkward writing experience. You write `##` and
> picture a heading. You write a table and count pipe characters. You hit preview
> to check, then go back.
>
> **Markdown Studio** puts the preview beside you and makes it editable. Two
> panes — raw Markdown and formatted rich text — showing the same document,
> synced as you type. Write in whichever one fits: syntax when you're moving
> fast, the formatted side when you're building a table or placing an image.
>
> It handles the parts that usually need plugins (LaTeX, Mermaid, callouts,
> footnotes), links notes with `[[wiki links]]` and maps them, and exports to
> Markdown, HTML, Word, PDF or JSON.
>
> It's free, it runs entirely in your browser, and it works offline. Nothing you
> write is uploaded.
>
> → [markdownstudio.com](https://markdownstudio.com)

---

## Reddit (r/Markdown, r/PKM, r/selfhosted)

Lead with the fact, not the pitch. Disclose that you made it.

> I built a Markdown editor that shows raw Markdown and editable rich text side
> by side, kept in sync.
>
> The reason it exists: I wanted to stop choosing between seeing my syntax and
> seeing my output. Both panes edit the same document, so you can write
> Markdown for speed and switch to the formatted pane when you're fighting a
> table.
>
> It's browser-only — no account, no server, IndexedDB storage, works offline.
> Math, Mermaid, wiki links with a relationship map, and export to
> Markdown/HTML/Word/PDF.
>
> markdownstudio.com — feedback welcome, especially on the round-trip fidelity.
> That's the part that's hard to get right and the part I most want broken.
