/**
 * Help content model. Keeping copy as data (not JSX) makes the Help page a thin
 * renderer, keeps the table of contents in sync automatically, and lets tests
 * assert on coverage (e.g. "every section has an id and a title").
 */

export interface HelpBlock {
  /** A short paragraph. */
  p?: string;
  /** A bulleted list. */
  list?: string[];
  /** A "tip" callout. */
  tip?: string;
}

export interface HelpSection {
  id: string;
  title: string;
  blocks: HelpBlock[];
}

export type { ShortcutGroup, ShortcutRow } from "../../data/shortcuts";
export { SHORTCUT_GROUPS } from "../../data/shortcuts";

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    blocks: [
      {
        p: "Markdown Studio is a dual-pane Markdown editor. The left pane holds raw Markdown; the right pane is a rich-text preview you can also type into. Edit either side and the other updates instantly — they are always two views of the same document. It runs entirely in your browser: no account, no server, and nothing you write is uploaded.",
      },
      {
        list: [
          "Pick a layout with the MD / HTML / Split switcher in the top-right of the menu bar.",
          "Create a document from File → New, or the “New” button in the workspace panel's Files tab.",
          "Everything you write is saved automatically to this browser — no account needed.",
        ],
      },
      { tip: "New here? Use Help → Take a guided tour for a 60-second spotlight walkthrough of the interface." },
    ],
  },
  {
    id: "interface",
    title: "The interface",
    blocks: [
      {
        list: [
          "Menu bar — File, Edit, Insert, View, Format, Tools, Help. Every command lives here.",
          "Mode switcher (top-right) — flip between Markdown only, Rich text only, or Split. On a phone it collapses to icons.",
          "Workspace panel (left) — a tabbed tray with two tabs: Files (your documents and folders) and Outline (a live table of contents for the current document). The document you are editing is marked with a coloured bar down its left edge. Toggle the panel from View → Toggle workspace panel (shortcut listed under Keyboard shortcuts below).",
          "Surface switcher (top right, beside the layout buttons) — Editor, Cards and Map: exactly one is showing at a time. Cards and the map are whole-library views that cover the editor; pick Editor (or press Esc, or choose a layout) to come back. ⌘⇧K and ⌘⇧G also toggle straight back.",
          "Formatting toolbar — quick bold/italic/lists/etc. for the current pane, plus Save and Undo/Redo. The block selector covers Paragraph and Heading 1–6.",
          "Right-click menu — right-click in either pane for format, insert, link, and clipboard actions in context.",
          "Status bar (bottom) — the active document, current view mode, document-link count, save state, and word/character counts. Two warnings can appear beside them: a fidelity note (e.g. “2 colors, 1 alignment not in MD”) when the open document holds formatting the Markdown pane cannot write, and a “N residuals” button — click it — listing what an import could not bring across. It sheds the least-important details first as the window narrows so it stays readable on phones.",
          "Pane headers — the Markdown pane's header carries the Styled switch (and, in Split, a scroll-sync toggle); the rich pane's carries an images on/off toggle and Styled paste.",
          "Panel tray — the “Panel” chevron button at the far-left of the status bar expands a tabbed tray (Document Links, plus a read-only diagnostics Console tab when it has been switched on for a support session). Click it (or the links count) to open, and again to collapse.",
        ],
      },
      {
        p: "In Split view, drag the divider between the panes to resize them. On mobile the panes stack vertically and the divider has a pull-handle so you can resize by touch.",
      },
    ],
  },
  {
    id: "writing",
    title: "Writing & formatting",
    blocks: [
      {
        p: "Type Markdown on the left (**bold**, _italic_, # headings, - lists, > quotes) or use the toolbar / Format menu in either pane. Selection-based formatting works the same in both.",
      },
      {
        list: [
          "Headings — Format → Heading, or type # … ###### in Markdown, or ⌘⇧1–6.",
          "Lists — bulleted, numbered, and task lists. Toolbar → Task List (or type - [ ] ) makes clickable checkboxes: tick a box in the rich pane and the Markdown updates to - [x]. Nest an item with the Indent button or ⌘] , and lift it back out with Outdent or ⌘[ — checklist items nest too. Indent does nothing on an ordinary paragraph: Markdown has no paragraph indent, and leading spaces there would turn the paragraph into a code block instead.",
          "Tables — Insert → Table, then edit cells inline in the rich pane.",
          "Links — ⌘K, or Insert → Link.",
          "Find & replace — ⌘F opens Find, ⌥⌘F (Alt+Ctrl+F on Windows/Linux) opens Replace (a Find | Replace selector at the top of the panel switches modes; it opens on whichever pane your cursor was in). Find mode has Find + Find all (Find all selects every match in the Markdown pane); Replace mode has Replace + Replace All. The panel floats and can be dragged; it opens centered over your content and remembers wherever you last dragged it. Close it from the ✕ in its header or with Esc. Match ticks appear on the pane's scrollbar so you can see where results are. Options (match-case, whole-word, regex) persist between sessions.",
          "Search scope & format filter (Markdown) — the funnel button opens a compact filter panel. Each chip cycles through three states: off → only (search only inside that region) → exclude (skip it). Structure chips are Headings / Code / Links; formatting chips are Bold / Italic / Strikethrough / Highlight. An ℹ︎ tooltip in the panel explains it, and the chips show ✓ (only) or ⃠ (exclude) in each state.",
          "Format matches — the Find & Replace panel can apply bold/italic/underline/highlight or a case change (UPPER/lower/Title) to every match at once. Set the Headings scope to “only” with an empty search box to target every heading for one-click bulk styling or recasing.",
          "Select by type — Edit ▸ Select (or right-click ▸ Select) selects the whole document or the current block, and can act on every heading, paragraph, list, code block, link, table or image at once — Copy, Delete, or apply a style / case change. Edit also has Cut / Copy / Paste.",
          "Change case — Format → Change case (or right-click) converts the selection to UPPERCASE, lowercase, or Title Case; \"Content only\" skips code and link URLs. Edit → Select all selects the whole document.",
        ],
      },
      {
        p: "Link to a heading with a wiki-style anchor: [[Document#Heading]] jumps to a heading in another note, and [[#Heading]] to one in the current note. The right-click menu’s “Link to heading” builds these for you.",
      },
      {
        p: "The “Styled” switch in the Markdown pane header controls whether decorative formatting is kept as inline HTML in your Markdown (Styled) or stripped back to plain Markdown (Clean).",
      },
      {
        p: "“Styled paste”, in the rich pane's header, decides what happens to formatting you paste in. It is on by default — pasting keeps the source's bold, links, headings and colours — and it is remembered. Hold ⇧ while pasting to do the opposite just once.",
      },
      {
        p: "What Markdown carries, and what it doesn't. Bold, italic, strikethrough, headings, lists (checklists included), tables, links, quotes, code and math are ordinary Markdown: they survive both panes, every export, and anywhere you paste them.",
      },
      {
        list: [
          "Carried as inline HTML, in both modes — underline, superscript and subscript, and an image given a size. Markdown has no syntax for these, so they are written as small HTML tags (<u>, <sub>, <sup>, <img width>) inside your Markdown. They round-trip here and render on most Markdown sites, but a strict Markdown-only tool will show the tags.",
          "Carried only while “Styled” is on — text colour, highlight colour and font family, written as <span style=\"…\">. Switching the Markdown pane header to Clean strips them, which is what Clean is for.",
          "Not representable at all — text alignment. Left / centre / right / justify look right in the rich pane, but plain Markdown has no way to record them, so they do not survive a round-trip or an export.",
          "The status bar warns you before any of this costs you anything. A fidelity note — “2 colors, 1 alignment not in MD” — counts what the open document holds that the Markdown pane cannot write; hover it for the breakdown. (It is hidden in Rich-text-only view, where nothing is being written to Markdown.) Separately, a “N residuals” button appears after an import that could not bring everything across: click it for a plain-language list of what it was, where it was, and why.",
        ],
      },
    ],
  },
  {
    id: "rich-content",
    title: "Inserting rich content",
    blocks: [
      {
        p: "The Insert menu adds content that renders live in the preview and round-trips cleanly back to Markdown source:",
      },
      {
        list: [
          "Math — LaTeX with $…$ (inline) and $$…$$ (block), rendered with KaTeX. Insert → Formula opens an editor with a live preview so you can see the equation as you type (⌘/Ctrl+Enter to insert); click a rendered formula to edit its source in place.",
          "Callouts — Insert → Callout (or type > [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION] in a blockquote) makes a colored admonition card. Collapsible details — Insert → Collapsible details adds a <details> disclosure block you can expand/collapse.",
          "Diagrams — Mermaid flowcharts, sequence diagrams and more, in a ```mermaid code block.",
          "Music — ABC notation rendered as a score, in an ```abc code block.",
          "Code — fenced code blocks with syntax highlighting and a copy button.",
          "Emoji — type :shortcodes: like :rocket: :sparkles:.",
          "Images — Insert → Image with a URL; size one with an <img … width=\"120\" /> HTML tag.",
          "Theme-aware images — follow the in-app Light/Dark theme via GitHub-style #gh-light-mode-only / #gh-dark-mode-only URL fragments, or a <picture> element with prefers-color-scheme sources.",
          "Tables — Insert → Table opens a grid picker; drag to choose the size.",
        ],
      },
      { tip: "Edit a rendered diagram or score by double-clicking it (or its Edit button) to reveal the source — then press Done — exactly like the math blocks. Diagrams and music are just fenced code blocks, so they stay valid Markdown anywhere you paste them." },
    ],
  },
  {
    id: "organizing",
    title: "Organizing documents",
    blocks: [
      {
        p: "Use the workspace panel's Files tab to keep documents in folders. Folders are listed above loose documents at each level.",
      },
      {
        list: [
          "Drag a document onto a folder to move it in; drag onto empty space to move it to the top level.",
          "Drag between items to reorder within a level — the order is remembered.",
          "Use a document or folder’s “…” menu → “New folder here…” to create a folder at that level and move the item into it.",
          "Rename, duplicate, or delete from the same “…” menu.",
        ],
      },
    ],
  },
  {
    id: "import-export",
    title: "Import & export",
    blocks: [
      {
        list: [
          "Import — File → Open file… or Import → File(s) / archive… ( .md, .txt, .html, .json, .docx, and .zip/.tar/.gz archives that preserve folders). You can also drag files straight onto the editor or onto the workspace panel's Files tab.",
          "Word (.docx) import — a Word document is converted to a rich document in the browser (best-effort: headings, bold/italic, lists, tables and images come through; Word equations, text boxes and complex page layout do not).",
          "Import from URL — File → Import → From URL… pulls a document from a link (Google Drive, GitHub, Dropbox, or any public URL).",
          "Export — File → Export to Markdown, HTML, ProseMirror JSON, Word (.docx), or PDF (via print).",
          "Export any note from the library — right-click (or long-press) a document in the workspace panel's Files tab, or use its ⋮ menu, and choose Export ▸ Markdown / HTML / Word / Backup. It works without opening the note first. Right-click a folder to export it (or a full backup) as a ZIP.",
          "Export everything — Export → All documents (.zip) packages your whole library, folders included.",
          "Full backup (restorable) — Export → “Full backup (.zip) — restorable” writes every document as full-fidelity JSON (styling, tags and metadata preserved), in its folders. Re-import the ZIP to return the library to exactly that state — a simple, portable snapshot system.",
          "Timestamped filenames — every exported ZIP is named with the date and time down to the millisecond (YYYYMMDD-HHMMSSmmm), so successive backups sort chronologically and never overwrite each other.",
        ],
      },
      {
        p: "Shareable import links — any page URL can carry an ?import_url=<link> parameter; opening it opens the importer with that link already filled in (top-level documents only). Nothing is fetched until you press Fetch, so a link someone sends you can never make your browser call out on its own. The Share / embed builder (see “Sharing & embedding”) can generate one, and the Import-from-URL dialog offers a “Copy share link” for the source you just imported.",
      },
      {
        p: "Password-protected archives — importing an encrypted .zip (by file or by URL) is detected automatically; you’re prompted for the password, and the archive is decrypted and opened in the browser (nothing is uploaded). A wrong password just asks again.",
      },
      {
        p: "Version history (recover earlier content) — Tools ▸ Version history keeps automatic snapshots of a document before content is overwritten, cleared, or deleted, and these survive reloads. If something ever looks lost, open it and Restore an earlier version in place (your current content is snapshotted first, so a restore is itself reversible) or restore it as a new document — which is also how you recover a deleted document.",
      },
      { tip: "Your work autosaves as you type, and is kept safe in three more ways: closing or reloading the tab saves what you have just typed (the browser's database is too slow to finish during a reload, so a copy is written the moment you leave and picked up next time); the editor refuses to overwrite a document with an empty editor, so an accidental blank never wipes a saved file; and if a save is failing, the status bar says so for as long as it is true rather than reading “Unsaved changes”. Version history is the net beneath all of that." },
      { tip: "If a URL import is blocked by the source site, download the file and drop it onto the editor (or the workspace panel's Files tab) instead." },
    ],
  },
  {
    id: "sharing-embedding",
    title: "Sharing & embedding",
    blocks: [
      {
        p: "Tools ▸ Share / embed link opens a builder that composes two things: a standalone link that opens the app with your chosen settings pre-applied, and an <iframe> snippet for embedding the editor in another site. Copy either with one click. The same builder is on this page, just below — flip parameters on and the two outputs update as you go.",
      },
      {
        p: "Each URL parameter has its own on/off switch plus a selector of its available values — flip a parameter on and pick its value, and only the parameters you enabled are written into the links (so a link carries exactly what you intend, nothing more). Parameters an audience can't act on are left out of the relevant link automatically: Import URL is standalone-only, and Theme / Accent / Chrome / Background apply to the embed only.",
      },
      {
        p: "The standalone app reads these URL parameters on load and then removes them from the address bar:",
      },
      {
        list: [
          "view_mode=md | html | split — which pane(s) to show on open (split is the default).",
          "readonly=true — open read-only: editing is disabled, the formatting toolbar is hidden, and the view mode is locked (the menu bar and reading stay available).",
          "import_url=<link> — open the importer pre-filled with that link (top-level documents only). You review it and press Fetch; the link never fetches by itself.",
        ],
      },
      {
        p: "Embeds (the iframe build) understand all of the above plus theme=light|dark, accent=<palette> (or accentColor=<css color>), chrome=full|minimal|none, and bg=transparent|<css color>. The builder fills these in for you.",
      },
      {
        p: "One embed parameter is for developers, so the builder leaves it out: allowed_origin=<origin> names the page allowed to drive the embedded editor over postMessage (several may be separated by commas; a literal * is refused). Leave it off and the embed trusts the page that framed it, and no one else.",
      },
      { tip: "Read-only mode locks the view so a shared read-only link shows exactly what you intended — turn read-only off (View menu or Settings) to switch panes again." },
    ],
  },
  {
    id: "linking-graph",
    title: "Linking notes & the graph",
    blocks: [
      {
        p: "Link documents together with wiki-style [[Document title]] links. The editor tracks these connections both ways.",
      },
      {
        list: [
          "Outline / table of contents — View → Outline opens a live outline in the Workspace panel on the left. It follows along as you scroll: the heading you're in and all of its parent headings stay highlighted, and parents pin to the top so you always see where you are. Click any heading to jump to it.",
          "Backlinks — when a document is open, a panel shows which notes link to it and which it links out to.",
          "Cards — the sticky-note button top right, View → Cards, ⌘⇧K, or the button in the Workspace panel header opens a board of every note as a card. Use “Take a note…” at the top for quick capture: add a title, type the body, and press Checklist to turn each line into a tick-box. Click a card to open it with Preview, Split and Write views — the preview renders exactly like the main editor and reflects unsaved edits, and Write is plain markdown with no formatting toolbar; pin cards to the top, colour them, and search across all of them. Every card is an ordinary document — “Open in editor” gives you the full editor whenever you need it.",
          "Relationship map — the Map button top right, View → Relationship map, or ⌘⇧G opens a full-screen knowledge graph of your whole workspace: every note is a dot, every [[wiki link]] is a line, and folders are drawn as labeled clusters. It opens on the note you're in, already selected, with its neighbours highlighted.",
          "Inspecting a note in the map — selecting any dot opens an inspector: its folder, its headings, every note it links out to, and every note that links in. Click a heading to open the document at that point; click a linked note to jump the map's selection to it (the arrow beside it opens it instead). Use Isolate to hide everything but the selection and its neighbours, and Focus to centre it. If nothing is linked yet, the map explains what a link is instead of showing a field of loose dots. Export the graph as JSON from the header. Your library starts with three linked documents — Welcome, Changelog, and About Perssonify — so the map has something to show on day one.",
          "Explore the map — click a note to select it and see its inbound/outbound link counts; double-click (or Enter) to open it; drag to rearrange; scroll or use the +/− buttons to zoom.",
          "Find and fix gaps — search the map to find and focus a note, and use the health chips to spotlight orphans (notes nothing links to) and broken links (that point at a note that doesn't exist).",
        ],
      },
    ],
  },
  {
    id: "appearance",
    title: "Appearance & settings",
    blocks: [
      {
        list: [
          "Theme — View → Appearance → Light, Dark, or System (System follows your operating system). Also in File → Settings, shown as color circles.",
          "Accent / style — View → Appearance → pick an accent palette (including Mono). Also in Settings.",
          "Markdown flavor & features — File → Settings / Preferences… toggles tables, footnotes, math, emoji and more.",
          "View mode & read-only — File → Settings also has a Markdown / Rich text / Split selector and a Read-only switch (both mirror the View menu). Read-only locks the view mode.",
          "Reading & typography — File → Settings → Reading & typography sets font size, line height, and reading width (caps the text column for comfortable line lengths) across both panes, plus a spellcheck toggle.",
          "Focus mode — View → Focus mode (or Settings) dims the menus, toolbar, and status bar so the document leads; hover a dimmed area to bring it back.",
        ],
      },
      { p: "Your theme, accent, view mode, typography, and preferences are saved in this browser and restored next time." },
    ],
  },
  {
    id: "offline-privacy",
    title: "Offline & privacy",
    blocks: [
      {
        p: "The editor is completely client-side. Your documents are stored locally in this browser and are never uploaded — there is no backend that can read them.",
      },
      {
        list: [
          "Install it as an app (from your browser’s install/Add-to-Home-Screen option) to work offline.",
          "Clearing your browser’s site data will remove your documents, so export anything important.",
          "If your browser blocks site data altogether — a private window, blocked cookies, or some in-app browsers — the editor still opens and you can still write. Preferences fall back to their defaults and documents cannot be saved between visits, so export before you close the tab.",
        ],
      },
    ],
  },
];
