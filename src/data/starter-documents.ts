/**
 * First-run companion documents.
 *
 * The app used to seed exactly ONE document, which made the relationship map
 * useless on a first visit: a single dot, no edges, nothing to explore. These
 * ship alongside the welcome document and link to it (and to each other) with
 * `[[wiki links]]`, so the map opens on a real, small graph that demonstrates
 * what it is for.
 *
 * They are seeded ONLY by the standalone app (see `starterDocuments` in
 * `App.tsx`) and only when storage is empty — an embedder's `initialDocument`
 * stays exactly one document. Deleting them is permanent for that browser;
 * they are not re-created on the next load.
 */

export interface StarterDocument {
  /** Folder path to file it under. Empty = the library root. */
  folderPath: string[];
  markdown: string;
}

/**
 * Changelog — a living release log INSIDE the app.
 *
 * Deliberately a document, not a static page: it is meant to be edited as the
 * app changes and cleared back to a bare "Unreleased" section at each release.
 * The entries below are summarised from the repo's root `CHANGELOG.md`.
 */
const CHANGELOG = `# Changelog

A running log of what changes in Markdown Studio, kept **inside** the app.

> [!NOTE]
> This document is a working log. At each release, move everything under
> **Unreleased** into a version section and start the list again — or clear it
> entirely and begin fresh. It is an ordinary document: edit it, export it,
> or delete it.

See also: [[Welcome]] · [[About Perssonify]]

---

## Unreleased

Nothing yet. Add lines here as you go — one bullet per change, newest first.

- [ ] Example: describe a change, then tick it when it ships

---

## Shipped

### 1.77.0 — Five ways to lose a document, closed

An outside review of the code found five defects, three of them paths that lose
your work. All five are fixed.

- Closing a document whose save had failed used to discard it without asking.
  Every unsaved state now asks first.
- A slow save finishing late could delete newer text you had typed since.
- Once the app refused to overwrite another window's changes, leaving the
  document and coming back quietly forgot the conflict and overwrote them
  anyway.
- Two editors embedded on one page could cross each other's messages.
- The embedding API now waits for a document to really open before saying it
  did.

### 1.76.0 — Broken links look broken

- A wiki link pointing at a document that does not exist is drawn dashed and
  muted, so you can see it without clicking it. Dashed rather than red: writing a
  link before its target exists is a normal way to take notes.
- The welcome document's title follows its own heading again, like every other
  document. Renaming it by hand still wins.
- Toasts no longer land on the status bar, and their close button is easier to
  hit on a phone.
- Exported and printed documents stop clipping long links and wide tables — paper
  cannot scroll sideways.
- Two more controls that were too small for a finger are not any more.

### 1.75.0 — Dragging, motion, and reading

- Dragging a divider and having the phone take the gesture back no longer leaves
  the app unable to select any text.
- Both dividers can be moved with the keyboard, and are big enough to hit with a
  finger.
- The bottom panel shares space with the editor instead of pushing the bottom of
  the app off the screen, and animates instead of jumping.
- Split-view scrolling keeps up around underlined, quoted and nested headings.
- Reading width does something in the default split layout.
- If you have asked your system to reduce motion, the map now settles instead of
  animating into place.

### 1.74.1 — Warnings you can trust

- **The formatting warning stopped crying wolf.** The amber note in the status
  bar counted things that are never actually lost — underline, superscript and
  subscript in Clean mode, and an image you had given a size. This document's
  own logo is a sized image, so a brand-new library opened with a warning about
  formatting that was in no danger at all.
- **Help, tooltips and the reference docs say what the editor really does.**
  What Indent means (nest a list item — Markdown has no paragraph indent), what
  Clean and Styled each keep, that text alignment is the one thing Markdown
  cannot record at all, and that Styled paste is on by default with ⇧ to invert
  it for one paste.

### 1.74.0 — Your words stay put

- **Dictation and IME input are safe.** Dictating into the markdown pane and then
  starting a new document used to lose everything you had just said — from both
  panes and from the saved copy. So did pressing ⌘Z or ⌘B in the middle of an
  utterance, in different ways. All four cases are fixed and tested against real
  dictation, not a stand-in.
- **Nothing is lost to a reload.** Type a sentence and reload straight away and it
  is still there. Saving to the browser's database cannot finish while a page is
  closing, so the editor now also keeps a copy the moment you leave and picks it
  up next time.
- **A failing save says so.** The status bar used to read "Unsaved changes" —
  the reassuring message — while every save was failing. It now says what is
  happening, and says it for as long as it is true.
- **⇧ while pasting** switches between keeping and stripping the source's
  formatting. It has been documented for a while; it now actually works.
- **Dropping a file on the editor** imports it instead of navigating the page
  away and taking your unsaved work with it.
- **Strikethrough survives.** Striking text in the rich pane was dropped the
  moment the two panes synced, and lost on export. Nothing warned you, because
  strikethrough is ordinary markdown — it just was not being written.
- **Indent works in checklists, and stops damaging paragraphs.** It did nothing
  inside a task list. In the markdown pane it indented any line at all, so two
  presses on a paragraph quietly turned it into a code block. It now applies
  where indentation means something: nesting a list item, and inside a fenced
  code block.
- **Six shortcuts that only worked in one pane now work in both** — ⌘⇧X,
  ⌘⇧1–6, ⌘⇧0 and ⌘]/⌘[. ⌘⇧9 inserted a checklist in the rich pane and a
  blockquote in the markdown pane; it is a blockquote in both.
- **Every shortcut works after a reload.** ⌘F, ⌘⇧D, ⌘⇧K and ⌘⇧G all did
  nothing once the page had been reloaded, and clicking into the editor first
  did not help.
- **Right-click ▸ Insert ▸ Image / Formula / Inline math** ask for a value
  instead of doing nothing, and **Clear formatting** works in the markdown pane
  too — as do indent, outdent, justify, and clearing a colour.
- **The relationship map keeps its filters and its JSON export on a phone.**
  Both vanished on a narrow screen, and the export has nowhere else to live.
- **Library search finds what you just typed**, and stops finding what you
  just deleted.
- **Deleting a document's version history actually deletes it.**
- **The editor starts when your browser blocks site data** — private windows,
  blocked cookies, some in-app webviews. It used not to load at all.
- Imported and pasted HTML is checked more thoroughly, and an embedded editor
  can now receive commands from the page that hosts it (and only that page).

### 1.73.0 — Both panes keep up

- The other pane now updates **while you type**, not only when you stop. It used
  to wait for a pause, and how long it waited depended on how long your document
  was — so the bigger the note, the further behind it fell.
- How long it waits is now measured, not guessed: the editor times its own work
  and paces itself to your device.
- ⌘B and friends act on the text you have selected, even if you press them the
  instant you finish selecting it.
- The memory and version-history panels keep updating while you look at them.

### 1.72.0 — Cards you can read

- Cards now show **rendered markdown**, not raw text — headings, lists, bold and
  links, on the card face and when you open one.
- Opening a card gives a **Preview / Split / Write** toggle. It opens rendered,
  so you can read a note without meeting its raw markdown; Split shows the
  markdown beside a live preview; Write is the plain source. Full editing is
  still one click away with "Open in editor".

### 1.71.0 — A map you can read, and honest imports

- The relationship map is three docked regions now — header, map, details rail.
  Nothing floats over the canvas, so the note you select is never the note the
  panel is covering.
- Every note that has room gets its name shown, folders are drawn as labelled
  clusters, and **no text is ever drawn over** at any zoom or screen size.
- A large library settles about twice as fast, without the stutter.
- Search the map, or filter it to unlinked notes and broken links.
- **"3 residuals" is a button now.** It opens a plain-language list of what an
  import could not bring across, and says which element and why.
- The share / embed link builder in Help is the real one, with a switch for
  every parameter.
- **Pasting into the rich pane now keeps the formatting you copied**, and
  remembers that you want it to. Hold Shift while pasting to do the opposite.
- Fixed: this document used to open claiming seven things "didn't come through"
  on import. They all came through — the checker was out of date with the
  editor, and was flagging features this document exists to show off.

### 1.70.0 — Markdown Studio

- The product is now called Markdown Studio, at markdownstudio.com.
- Help, About, the starter documents and the repository docs were refreshed.
- Your documents were not touched: every stored identifier stayed the same.

### 1.69.0 — The map got an inspector

- Selecting a note shows its folder, its headings, and *which* notes link to and
  from it — not just how many. Click a heading to open the note there.
- The open document is finally visible in the library: coloured edge, tinted
  row, semibold title.
- Fixed: a blinking rename box appeared in the library on load.
- Fixed: a folder's label covered its own note when the folder held one note.

### 1.68.0 — Three documents to start with

- The first run seeds **Welcome**, this **Changelog**, and **About Perssonify**
  in a folder, linked to each other — so the map opens on a real graph.
- The map explains itself when nothing is linked yet, instead of showing a
  scatter of unconnected dots.

### 1.67.0 — Surfaces and cards

- The view switcher became a three-way choice: **Editor · Cards · Map**.
  Returning to the editor is now its own option rather than un-toggling a view.
- Cards read in the right order — the newest note is top-left and the board
  fills across, not down.
- Card previews no longer run their lines together, and a checklist is not
  printed twice.
- The note composer starts in the body, not the title.

### 1.66.0 — One surface at a time

- Cards and the relationship map became a single exclusive selection. They
  could previously both open at once, with the map hidden underneath Cards.
- The duplicate map toggle left the status bar; the graph's JSON export moved
  into the map's own header.

### 1.65.0 — Cards from the library

- A Cards button in the workspace panel header.

### 1.64.0 — Cards board

- A Google-Keep-style board over the whole library: quick capture, checklists,
  nine note colours, pin-to-top, and search.
- Fixed: **⌘F** used to type the search query into the document.

### 1.63.0 — Packaging

- The published package now ships its CSS and TypeScript types.

### Earlier

The full history — every version back to the first import — lives in the
repository's \`CHANGELOG.md\` and \`docs/v1-to-current-changelog.md\`.

---

## How to use this document

1. Keep **Unreleased** at the top and append as you work.
2. At release, retitle it with the version and date.
3. Group entries as *Added*, *Changed*, *Fixed*, *Removed* once there are
   enough to sort.

Open the **relationship map** (⌘⇧G) to see how this document connects to the
others.
`;

/**
 * About Perssonify — the deep dive.
 *
 * Sourced from the copy the app already ships (the welcome document's "Explore
 * Perssonify" section and the About page): the four divisions, their taglines,
 * and their URLs. Nothing here is invented — no clients, headcount, pricing, or
 * case studies — so it can be expanded from the source of truth rather than
 * corrected.
 */
const ABOUT_PERSSONIFY = `# About Perssonify

**Tomorrow's Advantage, Delivered Today.**

Perssonify builds custom technology solutions for companies that need to move
fast without breaking things: applications, AI integrations, and automation
systems. → [perssonify.com](https://perssonify.com/)

This document is a deep dive into the divisions and what each one is for. The
editor you are reading it in was built by **Perssonify Labs** — see [[Welcome]]
for a tour of the product, and [[Changelog]] for what has changed recently.

---

## The four divisions

Perssonify is organised into four divisions. They share a way of working —
research first, build in the open, measure what ships — but each one answers a
different question.

| Division | The question it answers | Where |
| --- | --- | --- |
| Perssonify | "Can you build this for us?" | [perssonify.com](https://perssonify.com/) |
| Labs | "Is there already a tool for this?" | [labs.perssonify.com](https://labs.perssonify.com/) |
| Growth | "Can you make this reach people?" | [growth.perssonify.com](https://growth.perssonify.com/) |
| Research | "What becomes possible next?" | [research.perssonify.com](https://research.perssonify.com/) |

---

## Perssonify — custom technology solutions

The core practice. Applications, AI integrations, and automation systems built
for companies that need to move quickly without accumulating the kind of
technical debt that makes the next move slower.

**What that tends to look like in practice:**

- Custom applications built around an existing workflow rather than replacing it
- AI integrations wired into systems that already hold the data
- Automation that removes repeated manual steps between tools

→ [perssonify.com](https://perssonify.com/)

---

## Perssonify Labs — built in the open, free to try

Tools, frameworks, and experiments from the workshop. The Labs principle is
that a tool you can open and use right now teaches you more than a demo: use
them today, scale them tomorrow.

**Markdown Studio is a Labs product.** It is client-only — every document lives in
your browser and nothing is uploaded — and it ships both as a standalone app
and as an embeddable library. That combination is the Labs pattern: something
genuinely useful on its own, which also drops into a larger system.

→ [labs.perssonify.com](https://labs.perssonify.com/)

---

## Perssonify Growth — measurable growth

High-performance marketing: performance marketing, organic visibility, brand
authority, and the operational backbone that makes those work together rather
than as four disconnected efforts.

The through-line with the rest of Perssonify is measurement — the same
preference for things you can observe and adjust, applied to reach instead of
software.

→ [growth.perssonify.com](https://growth.perssonify.com/)

---

## Perssonify Research — built on research, open to explore

Where new ideas get explored and prototyped to unlock future opportunities.
Research feeds Labs: an idea that survives a prototype becomes a tool, and a
tool that people keep using becomes a product.

→ [research.perssonify.com](https://research.perssonify.com/)

---

## How the divisions fit together

\`\`\`mermaid
graph LR
  R[Research<br/>explore] --> L[Labs<br/>build in the open]
  L --> P[Perssonify<br/>custom solutions]
  P --> G[Growth<br/>reach]
  G -.feedback.-> R
\`\`\`

Research explores what is possible. Labs turns the promising parts into tools
anyone can try. The core practice builds those ideas into systems for specific
companies. Growth makes sure the result reaches the people it was built for —
and what it learns there points Research at the next question.

---

## Where to go next

- **Try the product you are holding** — [[Welcome]] is a full tour of Markdown Studio
- **Track what changes** — [[Changelog]]
- **Everything else** — [perssonify.com](https://perssonify.com/)

*This document ships with Markdown Studio as an example of a linked, structured
note. Edit it freely — it is yours now.*
`;

export const STARTER_DOCUMENTS: StarterDocument[] = [
  { folderPath: [], markdown: CHANGELOG },
  // Filed in a folder, which also gives the relationship map a labelled
  // cluster to draw on a first visit.
  { folderPath: ["Perssonify"], markdown: ABOUT_PERSSONIFY },
];
