# Features — What This System Actually Does

The single most-read doc after the [README](README.md). Each feature is self-contained: what it does, who can use it, where it starts in code, the happy-path flow (files in order), the data it touches, and known limits.

> **Roles:** This is a single-user, client-only app. There is **no permission model** — every capability is available to whoever has the browser tab open. "Who can use it" is therefore "any user" throughout, except where a feature is gated by *mode* or *screen size*. See [auth.md](auth.md).

**Where state lives** (referenced constantly below):
- `useDocumentStore` — [src/store/documentStore.ts:708](../src/store/documentStore.ts#L708) — documents, active doc, tabs, save status, counts, storage handle.
- `useUIStore` — [src/store/uiStore.ts:152](../src/store/uiStore.ts#L152) — view mode, sidebar/graph/find toggles, sync mode.
- `useEditorStore` — [src/store/editorStore.ts:92](../src/store/editorStore.ts#L92) — active formatting state, link index, backlinks, graph data.

---

## Editing

### 1. Dual-pane editing

- **What:** Edit raw markdown (left) and rich text (right) simultaneously; changes in one pane appear in the other.
- **Entry point:** [src/ui/EditorPanes.tsx:204](../src/ui/EditorPanes.tsx#L204) (`EditorLayout`), rendering [src/ui/CodeMirrorPane.tsx](../src/ui/CodeMirrorPane.tsx) and [src/ui/TiptapPane.tsx](../src/ui/TiptapPane.tsx).
- **Happy-path flow** (you type in the markdown pane):
  1. CodeMirror fires its change handler → `handleMdChange()` in [src/hooks/useDocumentLifecycle.ts:242](../src/hooks/useDocumentLifecycle.ts#L242).
  2. The change is debounced, with a ceiling so the other pane keeps up during continuous typing; both delays come from the measured cost of recent projections (see [src/hooks/sync-schedule.ts](../src/hooks/sync-schedule.ts)).
  3. `syncMdToHtml()` runs — [src/engine/useSyncEngine.ts:41](../src/engine/useSyncEngine.ts#L41): `quickHash(md)` guard → `engine.mdToHtml(md)` → `tiptapRef.setHTML(html)`.
  4. Tiptap re-serializes to its canonical ProseMirror JSON; `onCanonicalChange(editor.getJSON())` fires ([src/engine/useSyncEngine.ts:50](../src/engine/useSyncEngine.ts#L50)).
  5. Autosave is scheduled; after `AUTOSAVE_MS` the doc is written to IndexedDB.
- **Data read/written:** Reads/writes `activeDoc.canonical` (PM JSON) in memory; persists to the `documents` IndexedDB store on autosave.
- **Edge cases:** An empty Tiptap doc (`<p></p>`) will *not* overwrite non-empty markdown — guard at [src/engine/useSyncEngine.ts:67](../src/engine/useSyncEngine.ts#L67). The hash guard ([:36](../src/engine/useSyncEngine.ts#L36), [:65](../src/engine/useSyncEngine.ts#L65)) prevents echo loops; if you ever see content fail to sync, the hash is the first suspect.
- **IME / voice dictation:** an IME (and Windows Voice dictation) streams text through a `compositionstart → update → end` cycle; dispatching into an editor mid-composition aborts it and drops what was streamed. Both panes expose `isComposing()`, and a projection defers for **the pane it writes**, and only that pane — checking both froze the mirror for a whole utterance. A stuck flag expires (`COMPOSITION_STALL_MS`), because an undo dispatched into a live composition destroys it with no `compositionend`. Document-**leaving** paths end the composition instead of waiting for it: they are about to hydrate a different document over both panes, so waiting means the dictated text is destroyed. Measured against a real composition driven through CDP, not a mocked boolean. [src/__tests__/composition-guards.test.js](../src/__tests__/composition-guards.test.js), `e2e/cases/journeys.mjs`.
- **Related code:** [data-pipeline.md#stage-3-bidirectional-sync](data-pipeline.md#stage-3-bidirectional-sync), tests in [src/__tests__/sync-engine.test.js](../src/__tests__/sync-engine.test.js).

### 2. View modes (Markdown / Rich Text / Split)

- **What:** Show only the markdown pane, only the rich-text pane, or both side by side.
- **Who:** Any user. **Split is disabled below 768px** — mobile is forced to markdown-only.
- **Entry point:** [src/ui/ModeSwitcher.tsx:22](../src/ui/ModeSwitcher.tsx#L22) → `useUIStore.setMode`. Mode constants: `MODES` = `{ MD, HTML, SPLIT }` ([src/constants.ts:34](../src/constants.ts#L34)).
- **Flow:** `setMode(m)` → `useUIStore.mode` updates → `PerssonifyEditor` re-renders panes ([src/PerssonifyEditor.tsx:240](../src/PerssonifyEditor.tsx#L240)) → persists `editorMode` to prefs ([src/PerssonifyEditor.tsx](../src/PerssonifyEditor.tsx)).
- **Edge cases:** the toolbar collapses below `TOOLBAR_COMPACT_BP = 1080` ([src/constants.ts](../src/constants.ts)); the ☰ menu collapse and the split-pane stack use their own 768px breakpoint (see [src/hooks/use-mobile.ts](../src/hooks/use-mobile.ts)).

### 3. Menu bar (File · Edit · Insert · View · Format · Tools · Help)

- **What (v1.9.0):** A desktop-style application menu bar ([src/ui/MenuBar.tsx](../src/ui/MenuBar.tsx)) replaces the old document tab strip. Every item reuses an existing editor handler — `handleAction(type)` (import/export/copy/clear/prompt/graph), `dispatch(cmd)` (undo/redo + all Insert/Format commands), `handleSave`/`handleRevertDoc`/`handleNewDoc`/`handleCloseTab`, and the sidebar/graph/search/settings toggles — so it is a presentation layer only. Rendered in the `chrome === "full"` slot in [src/PerssonifyEditor.tsx](../src/PerssonifyEditor.tsx); embed/minimal chrome is unaffected.
- **Document switching:** there is no tab strip — switch documents from the **Workspace panel's Files tab** (`onSelect → handleSwitchDoc`), which highlights the active doc; the active title is shown on the right of the menu bar. Save + Undo/Redo also remain as quick buttons on the formatting toolbar.
- **Removed:** the previous full-screen *focus mode* (button, `⌘\` shortcut, and the fixed-position overlay) was dropped in favour of this streamlined chrome. A new, lighter **Focus mode** (chrome-dimming, not an overlay) was reintroduced in v1.35.0 — see "Reading & typography" below.

### 3a. Reading & typography (v1.35.0)

- **What:** Reader-comfort controls that apply to **both** panes: **font size** (S/M/L/XL), **line height** (Tight/Normal/Relaxed/Loose), **reading width** (Full/Narrow/Medium/Wide — caps the text column for comfortable line lengths), **spellcheck** toggle, and **Focus mode** (dims the menu bar, toolbar, status bar, and pane headers to 25% opacity so the document leads; any dimmed region returns to full opacity on hover/focus).
- **Who:** Any user. **Entry points:** Settings ▸ "Reading & typography" ([src/ui/SettingsSheet.tsx](../src/ui/SettingsSheet.tsx)); Focus mode also has a View-menu checkbox ([src/ui/MenuBar.tsx](../src/ui/MenuBar.tsx)).
- **How it works:** All five prefs live in `useUIStore` (persisted `pf:font-size`, `pf:line-height`, `pf:reading-width`, `pf:spellcheck`, `pf:focus-mode`). Font size / line height / reading width are pushed as CSS custom properties (`--editor-font-size`, `--editor-line-height`, `--reading-width`) on the editor split container ([src/ui/EditorPanes.tsx](../src/ui/EditorPanes.tsx)); `.ProseMirror`/`[data-md-preview]` and CodeMirror's `.cm-content` read them (styles.css + `cmTheme()` in [src/ui/CodeMirrorPane.tsx](../src/ui/CodeMirrorPane.tsx)). Reading width caps the **content column** (centered), not the flex pane, so the split-divider math is untouched. Spellcheck rides a CodeMirror `contentAttributes` Compartment (live) and both Tiptap `editorProps.attributes` objects. Focus mode toggles a `.pf-focus` class on the `PerssonifyEditor` container (which encloses all chrome); dimming is **opacity/transition only** so the `h-dvh` viewport lock never reflows.

### 4. Text & block formatting

- **What:** Bold, italic, underline, strikethrough, superscript, subscript, inline code; headings H1–H6, ordered/unordered/task lists, blockquote, code block, horizontal rule.
- **Entry point:** [src/ui/Toolbar.tsx:176](../src/ui/Toolbar.tsx#L176) buttons, or keyboard shortcuts ([src/hooks/useKeyboardShortcuts.ts](../src/hooks/useKeyboardShortcuts.ts)).
- **Happy-path flow:** Toolbar button → `dispatch(cmd)` → `useFormatDispatcher` ([src/formatting/useFormatDispatcher.ts:138](../src/formatting/useFormatDispatcher.ts#L138)) picks the target pane via `getTargetPane()` ([:154](../src/formatting/useFormatDispatcher.ts#L154)):
  - **Rich-text pane active** → `dispatchToTiptap()` ([:336](../src/formatting/useFormatDispatcher.ts#L336)) runs Tiptap commands.
  - **Markdown pane active** → `dispatchToMd()` ([:502](../src/formatting/useFormatDispatcher.ts#L502)) edits the CM6 text directly via `mdWrap`/`mdPrefixLine`/`mdSetHeading` ([src/formatting/md-format-utils.ts](../src/formatting/md-format-utils.ts)).
- **Data:** Operates on the active pane's content; result flows through the sync engine into canonical PM JSON.
- **Indent / outdent (`Cmd+]` / `Cmd+[`, toolbar):** these mean **list nesting**, in both panes. Rich pane → `sinkListItem` / `liftListItem` with the item type taken from the selection (`taskItem` inside a checklist, `listItem` otherwise — hardcoding the latter made indent dead in every checklist). Markdown pane → CodeMirror's `indentMore`/`indentLess`, gated by `mdIndentable` ([src/formatting/useFormatDispatcher.ts](../src/formatting/useFormatDispatcher.ts)) to list lines and lines inside a fenced block. Markdown has no paragraph indent — four leading spaces on a paragraph *is* an indented code block — so on anything else both panes no-op rather than change what the block is.
- **Strikethrough round-trip:** TipTap renders `<s>`; turndown's core is CommonMark and this project does not load `turndown-plugin-gfm`, so an unmatched element is silently reduced to its text. The `strikethrough` rule in [src/engine/turndown-rules.ts](../src/engine/turndown-rules.ts) emits `~~…~~`. Without it, striking text in the rich pane was destroyed by the next sync and lost on export, with no fidelity warning — strikethrough is native Markdown, so nothing classed it as a loss.
- **Edge cases:** Toolbar active-state for the markdown pane is **regex-based** ([src/formatting/useFormatDispatcher.ts:393](../src/formatting/useFormatDispatcher.ts#L393)) — it can mis-detect nested markers (see `isSubmarker` at [src/formatting/md-format-utils.ts:271](../src/formatting/md-format-utils.ts#L271)).
- **Related:** [src/__tests__/md-format-utils.test.js](../src/__tests__/md-format-utils.test.js).

### 4a. Interactive task lists (v1.36.0)

- **What:** `- [ ]` / `- [x]` render as **clickable** checkboxes in the rich pane (TipTap `TaskList`/`TaskItem`); toggling a box updates the Markdown, and inline markdown inside an item (bold, links) is preserved. Nested task lists round-trip.
- **Entry point:** Toolbar "Task List" button, Format ▸ Task list, or type `- [ ] ` in the Markdown pane. Gated on the `taskLists` feature (Settings ▸ Features).
- **How it works:** No preprocessor pass — marked's gfm list tokenizer detects tasks, and `build-marked.ts` overrides the renderer (gated on `taskLists` + gfm) to emit `<ul data-type="taskList"><li data-type="taskItem" data-checked="…">` (suppressing the default disabled `<input>`), which keeps each item's inline markdown. `TaskList`/`TaskItem` are registered in both `TiptapPane.tsx` and `serialize-doc.ts` `SERIALIZE_EXTENSIONS`. Turndown's `taskListItem` rule reads `data-checked` and re-emits `- [x]`/`- [ ]`, indenting nested items.
- **Related:** [src/__tests__/task-lists.test.js](../src/__tests__/task-lists.test.js).

### 5. Tables

- **What:** Insert tables via a grid picker; add/delete rows & columns; alignment.
- **Entry point:** Toolbar table button → [src/ui/TableGridPicker.tsx:17](../src/ui/TableGridPicker.tsx#L17) (8×6 grid). In-table editing surfaces [src/ui/TableBubbleMenu.tsx:67](../src/ui/TableBubbleMenu.tsx#L67).
- **Flow (markdown pane):** Table commands route to [src/formatting/md-table-ops.ts](../src/formatting/md-table-ops.ts) — `mdParseTableAtCursor` ([:29](../src/formatting/md-table-ops.ts#L29)) parses the pipe table, ops mutate the 2-D array, `renderTable` ([:317](../src/formatting/md-table-ops.ts#L317)) re-emits aligned markdown.
- **Flow (rich-text pane):** Tiptap `@tiptap/extension-table` commands via `dispatchToTiptap`.
- **Edge cases:** Deleting the last row/column deletes the whole table ([src/formatting/md-table-ops.ts:125](../src/formatting/md-table-ops.ts#L125), [:166](../src/formatting/md-table-ops.ts#L166)). Pipes inside cells are escaped on render.
- **Related:** [src/__tests__/md-table-ops.test.js](../src/__tests__/md-table-ops.test.js).

### 5a. Equation authoring dialog (v1.37.0)

- **What:** Insert ▸ Formula (block) / Inline formula and the toolbar Σ menu open a **LaTeX dialog with a live KaTeX preview** instead of a bare browser prompt. As you type, the formula renders below the input; a KaTeX parse error is surfaced as a message. ⌘/Ctrl+Enter (or the Insert button) commits.
- **Entry point:** `useDialog().equation(title, { display })` — a promise-based method on the shared `DialogApi` ([src/ui/DialogProvider.tsx](../src/ui/DialogProvider.tsx)), rendered as `EquationDialog` ([src/ui/Dialogs.tsx](../src/ui/Dialogs.tsx)) in `PerssonifyEditor`. On confirm the caller dispatches `insertMathBlock` / `insertMathInline` (the same math commands as before), so round-trip and the `$…$`/`$$…$$` output are unchanged.
- **Editing existing equations:** unchanged — click a rendered math node and edit its source inline via the `MathNodes` node view. KaTeX is lazy-imported (CSS is global), so the dialog adds nothing to the initial bundle.

### 5b. Callouts & collapsible details (v1.38.0 / v1.39.0)

- **Callouts:** `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]` blockquotes render as themed admonition cards (Insert ▸ Callout, or type the marker). Inline markdown inside is preserved; they round-trip to `> [!TYPE]` markdown. Gated on the `callouts` feature (Settings ▸ Extensions). `build-marked.ts` overrides the blockquote renderer; the Callout node ([src/extensions/Callout.ts](../src/extensions/Callout.ts)) is registered in both extension arrays; the turndown `callout` rule sits after `plainDiv` (LIFO). Related: [src/__tests__/callouts.test.js](../src/__tests__/callouts.test.js).
- **Collapsible details:** Insert ▸ Collapsible details drops a `<details><summary>` disclosure block. It's not Markdown, so it round-trips as **raw HTML** (marked passes the block through; the Details/Summary nodes re-parse it; turndown re-emits `outerHTML`) — the Markdown pane shows the raw `<details>` for that block. `details`/`summary` are whitelisted in `KNOWN_ELEMENTS` so imports keep them. Related: [src/__tests__/details.test.js](../src/__tests__/details.test.js).

### 6. Colors, highlight, font family, alignment

- **What:** Text color, highlight color, font-family selector, and text alignment (left/center/right/justify).
- **Entry point:** [src/ui/Toolbar.tsx](../src/ui/Toolbar.tsx) (color/highlight/font controls), shortcuts `Cmd+Shift+L/E/R/J` for alignment ([src/hooks/useKeyboardShortcuts.ts:84](../src/hooks/useKeyboardShortcuts.ts#L84)).
- **Edge cases:** These are **decorative** commands, and they divide into two cases:
  - **Colour, highlight and font family survive as inline HTML.** In the markdown pane they wrap the selection in `<span style="…">` ([src/formatting/useFormatDispatcher.ts](../src/formatting/useFormatDispatcher.ts)); in **Clean** sync mode that HTML is stripped, the toolbar shows a warning toast ([src/ui/Toolbar.tsx](../src/ui/Toolbar.tsx)) and the fidelity report flags the loss.
  - **Alignment is not representable in either mode.** `setTextAlign` sets a paragraph attribute that no turndown rule emits, and a `text-align` style on an inline `<span>` is inert, so alignment is app-only: it does not survive a round-trip through the markdown pane or any export. It is the one formatting feature in this list with no markdown or inline-HTML carrier. `computeFidelity` ([src/store/fidelity.ts](../src/store/fidelity.ts)) counts it as an attribute loss so the status-bar indicator reports it; the toolbar and Format ▸ Align tooltips say so up front.

### 7. Links (inline) & link bubble menu

- **What:** Insert/edit inline `[text](url)` links.
- **Entry point:** `Cmd+K` ([src/hooks/useKeyboardShortcuts.ts:73](../src/hooks/useKeyboardShortcuts.ts#L73)) or toolbar; editing popup is [src/ui/LinkBubbleMenu.tsx:14](../src/ui/LinkBubbleMenu.tsx#L14).
- **Note:** Distinct from wiki links (`[[…]]`), which are document-to-document — see [#wiki-links--knowledge-graph](#wiki-links--knowledge-graph).

### 8. Find & Replace

- **What:** A floating, draggable find/replace panel with a live match counter, Next/Prev navigation, inline replacement preview, and per-match option toggles: **match-case**, **whole-word**, and **regex**. A **Find | Replace** segmented control at the top of the panel switches modes (Find mode shows **Find + Find all**; Replace mode shows **Replace + Replace All**). It can also apply **formatting to every match** — bold/italic/underline/highlight or a case change (UPPER/lower/Title) — in Replace mode only.
- **Who:** Any user; `Cmd+F` opens Find mode, `Cmd+H` opens Replace mode (both work from inside the panel too, since the global shortcut listener is editor-container-scoped). The panel opens on whichever pane the cursor was last in. Close from the ✕ in the panel header or with `Esc`.
- **Position:** The panel is `position: fixed`; it **opens centered over the content** and **remembers its last dragged position** across open/close and sessions (`pf:fr-pos`, restored before paint in a `useLayoutEffect`, clamped on-screen).
- **Entry point:** [src/ui/FindReplace.tsx](../src/ui/FindReplace.tsx); state `useUIStore.showFindReplace`.
- **Flow:** Choose target pane (MD vs Rich Text). All match sites route through one builder (`buildSource`/`buildRegex`) that honors the regex/case/whole-word options. Rich-pane Next/Prev walks `collectTiptapMatches` (ordered by position). Find all multi-selects every match in the MD pane (`EditorState.allowMultipleSelections`). Option toggles persist in localStorage (`pf:fr-*`).
- **Scope / format filter (MD):** A collapsible funnel of per-region chips that each cycle **off → only → exclude**, grouped Structure (headings / code / links) and Formatting (bold / italic / strike / highlight), applied in `scopeMd` (persisted `pf:fr-scope`). The count, scrollbar markers, and **Replace All all honor this filter** — Replace All runs a ranged-change scoped path whenever any region is active, so it mutates exactly the matches shown. **Match ticks** are drawn over the active pane's scrollbar (`MatchScrollbar`, portaled to `document.body` because the panel's `backdrop-blur` is a containing block for fixed children).
- **Select all headings:** Set the **Headings** scope chip to *only* with an empty search box — the "Format matches" row targets every heading at once for one-click bulk styling or recasing (CM: `mdHeadingRanges`; rich: heading text nodes).
- **Edge cases:** Invalid regex shows an inline "ERR" and doesn't throw. Literal replace escapes `$` in the replacement (so `$'`/`$&` aren't treated as substitution patterns) on the full-document path; the scoped ranged-change path inserts literal text verbatim. Rich-pane replace walks text nodes via a ProseMirror transaction (never a regex over serialized HTML, which could corrupt tags).

---

## Sync modes (Clean vs Styled)

- **What:** Controls whether the `<span style="…">` / `<div style="…">` carrier is written back to markdown. That carrier — and **only** that carrier — is what the switch decides.
  - **Clean** — the style carrier is dropped, so text colour, highlight and font family are stripped; output is portable GFM.
  - **Styled** — the carrier is preserved inline, so those three survive the round trip.
  - **Neither mode touches** underline, subscript, superscript or an image's width/height: their rules live in `addBaseRules`, which both Turndown instances receive, so they are written as `<u>`/`<sub>`/`<sup>`/`<img … width>` either way. **Nor does either mode carry text alignment**, which has no rule at all. Measured per case in [src/__tests__/clean-vs-styled.test.js](../src/__tests__/clean-vs-styled.test.js); `fidelity.ts` classifies from these same rule tables, and got it wrong in both directions before that test existed.
- **Entry point:** Pills in the pane header ([src/ui/EditorPanes.tsx:46](../src/ui/EditorPanes.tsx#L46)); state `useUIStore.syncMode` (defaults to `"styled"`, [src/store/uiStore.ts:17](../src/store/uiStore.ts#L17)).
- **Where the branch lives:** [src/engine/useSyncEngine.ts:76](../src/engine/useSyncEngine.ts#L76) — `syncMode === "styled" ? engine.htmlToMd : engine.htmlToCleanMd`. The two converters are two Turndown instances built in [src/engine/useMarkdownEngine.ts:127](../src/engine/useMarkdownEngine.ts#L127): `tdInline` (styled, adds the inline-style rule) vs `tdClean` (base rules only).
- **Paste Styled:** a **persisted preference, on by default** ([src/ui/EditorPanes.tsx](../src/ui/EditorPanes.tsx), `pf:paste-styled`) — pasting keeps the source's formatting. It used to default to stripping and disarm itself after one paste; that one-shot reset was removed, since with styled as the default it turned the preference off the first time it was used. **Holding ⇧ inverts it for a single paste.** The modifier does not come from the paste event (`ClipboardEvent` carries no `shiftKey` — measured); `TiptapPane.handlePaste` reads `view.input.shiftKey` and passes it explicitly.
- **Related:** [data-pipeline.md](data-pipeline.md), [domain-glossary.md#clean-mode--styled-mode](domain-glossary.md#clean-mode--styled-mode).

---

## Document management

### 9. Multi-document management

- **What:** Keep many documents open in the library; switch, rename, duplicate, close.
- **Entry point:** the Workspace panel's Files tab ([src/ui/WorkspacePanel.tsx](../src/ui/WorkspacePanel.tsx)); the tab strip was removed in v1.9 — document switching happens in the Files tab and the active title shows in the menu bar.
- **Flow:** `onSwitch(id)` → `handleSwitchDoc` ([src/hooks/useDocumentLifecycle.ts:509](../src/hooks/useDocumentLifecycle.ts#L509)) flushes pending edits of the current doc, then `useDocumentStore.switchToDoc` ([src/store/documentStore.ts:322](../src/store/documentStore.ts#L322)) loads the target (checking the in-memory unsaved-edits cache first, [:322](../src/store/documentStore.ts#L322)).
- **Edge cases:** Closing a tab with unsaved edits prompts confirmation ([src/hooks/useDocumentLifecycle.ts:195](../src/hooks/useDocumentLifecycle.ts#L195)).

### 10. Files (library) — the Workspace panel's Files tab

- **What:** Browse all documents, search by title/tag/content, bulk-select, and drag files in to import. This is the **Files** tab of the unified left-docked **Workspace panel** (see #15b).
- **Entry point:** [src/ui/WorkspacePanel.tsx](../src/ui/WorkspacePanel.tsx) (`FilesTab`); the panel toggles with `Cmd+Shift+D` / `useUIStore.showSidebar`, and the **Files** tab is selected via `useUIStore.workspaceTab`.
- **Flow (drag-drop):** Files dropped → `onFileDrop(files)` → import pipeline (see [#13-import--export](#13-import--export)).
- **Row actions (⋮ menu or right-click / long-press):** Every document and folder row exposes its actions two ways — the hover **⋮** button and a **right-click / long-press context menu** (honors the admin *Enable right-click menu* toggle). Documents: Rename, Duplicate, Move to, **Export ▸ Markdown / HTML / Word (.docx) / Backup (.json)**, Delete. Folders: New subfolder, Rename, Move to, **Export as ZIP**, **Full backup (.zip)**, Delete. Per-document export derives every format from the stored document, so it works on any note without opening it first. Both surfaces render from one shared menu body ([src/ui/FolderTree.tsx](../src/ui/FolderTree.tsx)); export runs through `handleExportDoc`/`handleExportFolder` in [src/PerssonifyEditor.tsx](../src/PerssonifyEditor.tsx).
- **Views:** unfiltered shows the nested `FolderTree`; searching or select-mode shows a flat filtered list. Order is **insertion order, not re-sorted on update**.

### 11. Create / rename / duplicate / delete

- **What:** Standard document lifecycle ops.
- **Entry points & flow:**
  - New: `Cmd+N` → `handleNewDoc` ([src/hooks/useDocumentLifecycle.ts:733](../src/hooks/useDocumentLifecycle.ts#L733)) → `useDocumentStore.createDoc` ([src/store/documentStore.ts:291](../src/store/documentStore.ts#L291)).
  - Rename: stored as `userTitle` so it survives re-derivation on save ([src/store/documentStore.ts:500](../src/store/documentStore.ts#L500)).
  - Duplicate: [src/store/documentStore.ts:408](../src/store/documentStore.ts#L408).
  - Delete: confirm → `useDocumentStore.deleteDoc` ([src/store/documentStore.ts:329](../src/store/documentStore.ts#L329)) removes from IndexedDB + manifest and closes the tab.

### 12. Auto-save & session restore

- **What:** Edits persist automatically; the last active document reopens on reload.
- **Entry point:** Autosave interval `AUTOSAVE_MS = 5000` ([src/constants.ts:17](../src/constants.ts#L17)). Restore: `useDocumentStore.initialize()` ([src/store/documentStore.ts:290](../src/store/documentStore.ts#L290)) reads the manifest and the `lastActiveDocId` pref.
- **Data:** Writes `doc` records + `__manifest` + `__prefs` to IndexedDB — see [database.md](database.md).
- **Edge cases:** Save can fail on quota (`StorageQuotaError`) — see [runbooks/storage-quota-exceeded.md](runbooks/storage-quota-exceeded.md).
- **A failed save stays visible.** A failed autosave is routed `error` → `editing` after 3s so the re-arm effect fires, which meant that for most of each retry cycle the status bar read "Unsaved changes" — the reassuring message — while saving was failing over and over. `saveError` outlives that transition (cleared only by a save that lands) and the bar reads **"Save failed — retrying"**. The two terminal states say what they are rather than nothing: `"blocked"` (the blank-over-content refusal) reads **"Empty editor — not saving"**, and `"conflict"` reads **"Changed in another tab — not saving"**. Neither re-arms autosave; a later real edit resumes it.
- **Multi-tab conflict:** if another tab/window saves a newer version of the doc you're editing, this tab refuses to save over it (last-writer-wins would silently discard that tab's work). The status bar shows a persistent **"Changed in another tab — not saving"** and the save loop stops re-firing; copy anything you need and reload. A later edit here resumes normal saving. This is a visible surface over the existing guard, not a live cross-tab sync (that stays on the backlog). [src/store/documentStore.ts](../src/store/documentStore.ts) `saveActiveDoc` (`"conflict"` status).
- **Title provenance:** a document remembers whether its title was a real user rename (`titlePinnedByUser`) rather than guessing from the string, so a doc you deliberately name "Untitled 5" keeps that name while an accidental placeholder still heals from your first heading. [src/store/document.ts](../src/store/document.ts) `resolveDocTitle`.

---

### 12a. Version history (recoverable snapshots)

- **What:** A safety net that keeps prior content versions per document so an
  overwrite, an accidental clear, a bad replace-all, or even a delete can be
  undone — and these survive a reload. Open via **Tools ▸ Version history**.
- **How it captures:** `saveActiveDoc` snapshots the previous stored content
  before overwriting it (throttled to ~one per 90s per doc, but a large content
  shrink — the "got wiped" signature — always snapshots); `deleteDoc` snapshots
  the doc before removing it.
- **How it restores:** *Restore* replaces the current document (your current
  content is snapshotted first, so the restore is itself reversible); *As new*
  recreates the version as a separate document (used to recover deleted docs).
- **Entry point / data:** [src/store/snapshot-store.ts](../src/store/snapshot-store.ts) —
  a **sidecar IndexedDB** (`perssonify-snapshots`), independent of the main
  document store, bounded by per-doc count + a global byte budget + age. UI:
  [src/ui/VersionHistorySheet.tsx](../src/ui/VersionHistorySheet.tsx). Falls back
  to an in-memory ring when IndexedDB is unavailable.

---

## Import / export

### 13. Import & export

- **What:** Import `.md`/`.markdown`/`.txt`/`.html`/`.htm`/`.json`/`.docx`; export Markdown, HTML, or ProseMirror JSON; copy any of those to clipboard.
- **Entry point:** the **File** menu ([src/ui/MenuBar.tsx](../src/ui/MenuBar.tsx)) — Import…, Export ▸, Full backup — dispatched through `handleAction` in [src/PerssonifyEditor.tsx](../src/PerssonifyEditor.tsx). (`ActionBar.tsx` no longer exists; the menu bar replaced it.)
- **Dropping a file on the editor imports it** ([src/ui/EditorLayout.tsx](../src/ui/EditorLayout.tsx) `onDragOver`/`onDrop` → PE's `handleFileDropImport`). There was no drop handler anywhere in `src/`, so a file dropped on either pane got the browser default: the tab navigates to the file and everything typed since the last autosave is gone — the one gesture that leaves no draft, no undo and no snapshot. Only drags carrying `Files` are intercepted; a text/HTML drag inside the document still belongs to CodeMirror and ProseMirror. The `preventDefault` happens even with no importer wired, since losing the document is not an acceptable way to say "we can't import this". Pinned by [src/__tests__/editor-file-drop.test.js](../src/__tests__/editor-file-drop.test.js).
- **Flow (import):** File chosen/dropped → `getFileContentAndFormat` → `detectFormat` ([src/store/import-export.ts:65](../src/store/import-export.ts#L65)) → `importFile`/`importFiles` ([:139](../src/store/import-export.ts#L139)) → `ingest()` ([src/store/ingest.ts:488](../src/store/ingest.ts#L488)) → new document.
- **Flow (export):** `exportAsMarkdown`/`exportAsHtml`/`exportAsJson` ([src/store/import-export.ts:306](../src/store/import-export.ts#L306)). Markdown export respects the current sync mode; JSON export wraps the document in a `_format: "perssonify-document"` envelope ([:306](../src/store/import-export.ts#L306)).
- **PDF / print:** "PDF / Print…" renders the rich document into a hidden iframe with a print stylesheet and opens the browser print dialog (use "Save as PDF"). Fidelity matches HTML export. Implemented by `printHtmlDocument` in [src/PerssonifyEditor.tsx](../src/PerssonifyEditor.tsx).
- **Word (.docx):** "Word (.docx)" tokenizes the document's Markdown with marked's lexer and maps tokens to Word elements via the (dynamically imported) `docx` library — headings, paragraphs, nested lists, blockquotes, code, tables, rules, inline formatting. [src/store/docx-export.ts](../src/store/docx-export.ts). Images/math/diagrams fall back to source text.
- **Word (.docx) import:** A `.docx` upload is converted to HTML by the (dynamically imported) `mammoth` library, then fed to the existing `format:"html"` ingest branch — so it gets the same sanitize (`sanitizeForIngest` keeps inlined `data:` raster images, strips scripts) and residual-report (`analyzeHtml`) treatment as any HTML import. PE's import loop branches on `.docx` **before** the text-reading path (a Word file read as text is binary garbage). [src/store/docx-import.ts](../src/store/docx-import.ts) `convertDocxToHtml`. Best-effort/lossy: headings, bold/italic, lists, tables, and embedded raster images convert; Word equations (OMML), text boxes, and complex layout do not. Embedded images inline as base64, so a small `.docx` can expand past the 5 MB import cap once images are embedded. Related: [src/__tests__/docx-import.test.js](../src/__tests__/docx-import.test.js).
- **Archives:** Import `.zip`/`.tar`/`.tgz`/`.gz` (directory structure → folders); export a folder, the current multi-select, or **all documents** as a ZIP of Markdown files (`handleExportFolder`/`handleExportDocs` → `exportDocsToZip` → `buildZip` → `downloadBlob`). Decompression-bomb bounds and **entry-path normalization** (`normalizeArchivePath` strips absolute roots, Windows drives, and `..`/`.` segments so a crafted archive can't traverse the folder tree or a storage key) live in [src/store/archive.ts](../src/store/archive.ts).
- **Full backup (restorable snapshot):** Export → **“Full backup (.zip) — restorable”** (`export-backup-zip`, `exportDocsToZip(..., { canonical: true })`) writes every document as the full `perssonify-document` JSON envelope — canonical ProseMirror content plus title, id, tags, metadata, and timestamps — in its folder path. Re-importing the ZIP restores the library to exactly that state (styled colors/highlights/fonts round-trip losslessly, unlike Markdown export). A rudimentary, fully-local portability/version-control system.
- **Timestamped export filenames:** Every exported ZIP is suffixed with a local `YYYYMMDD-HHMMSSmmm` stamp (`exportTimestamp` in [src/store/import-export.ts](../src/store/import-export.ts)) so successive backups sort chronologically and never collide.
- **Import from URL:** "Import from URL…" fetches a Markdown/HTML/text file **or a `.zip`** client-side ([src/store/url-import.ts](../src/store/url-import.ts)) — https/http only, no cookies, 15 s timeout, streamed cap (**5 MB** text / **20 MB** archive; the archive extractor keeps its own decompression-bomb bounds) — then routes through the same `ingest()` sanitize pipeline. Because a backend-less app can't read cross-origin responses that lack CORS headers, the dialog also offers an always-works paste fallback and steers the user to it on a CORS failure. UI: [src/ui/UrlImportDialog.tsx](../src/ui/UrlImportDialog.tsx).
  - **Provider-aware links** ([src/store/import-url-normalize.ts](../src/store/import-url-normalize.ts)): **Google Drive** file share links (`/file/d/…/view`, `open?id=`) are rewritten to `drive.usercontent.google.com/download` — which sends permissive CORS headers, so public Drive files (and zips) import directly; **GitHub** `/blob/` → `raw.githubusercontent.com`; **Dropbox** → `dl=1`; **Google Docs/Sheets** → best-effort HTML/CSV export. A Drive **folder** link (no public no-auth download) fails with an actionable message (download it as a zip, or share the files).
  - **Preview & select:** after fetching, a preview step lists what will be imported — for a zip, every text entry with its folder path, **all selected by default and individually deselectable** — before anything is written.
  - **Shareable import links:** the preview surfaces a copyable `…/?import_url=<url>` deep link; opening it re-launches the importer **pre-filled but does NOT fetch** — a shared link must never make a visitor's browser hit an attacker-chosen address on load, so the visitor presses Fetch themselves and then confirms in the preview. The parameter is read by the app shell (`App.tsx`) during render and stripped from the URL, never by the editor component — otherwise a library consumer's own query string would open dialogs inside their editor. Top-level only — never auto-imports from a host page's query param into an embed. Builder: `buildImportShareLink`; the parameter is read in [src/App.tsx](../src/App.tsx) and handed to the editor as the `initialImportUrl` prop, which opens the importer pre-filled.
  - **Import relay (Google Drive et al.):** hosts like Google Drive send no CORS headers to a real browser, so a direct fetch is blocked. The importer tries the **direct fetch first** (GitHub raw, Dropbox, and any `Access-Control-Allow-Origin` host resolve directly and never involve the relay) and **only on a CORS/network failure retries through the app's own same-origin serverless function** ([api/import.js](../api/import.js), `IMPORT_RELAY` in `url-import.ts`). Because the relay lives on the app's own origin, the request stays **first-party** (no third party sees it) and it's **reliable** — unlike the public CORS proxies this replaced. The function is **SSRF-hardened**: only public http(s) targets; localhost/`.local`/`.internal` and private/loopback/link-local/CGNAT/cloud-metadata addresses refused **after DNS resolution** — including IPv6 loopback/ULA/link-local and IPv4-embedded forms (`::ffff:`, NAT64 `64:ff9b::`, 6to4 `2002::`); **every redirect hop re-validated**; and the vetted IPs are **pinned to the connection via an undici dispatcher** so `fetch` can't be DNS-rebound to an internal address between validation and connect (TOCTOU). Abuse controls: cross-site browser requests refused via `Sec-Fetch-Site`, responses CORS-restricted to the app's own origins, a best-effort per-IP rate limit, and hard size/time caps. The blocklist and `assertPublicUrl` are covered by [src/__tests__/import-relay.test.js](../src/__tests__/import-relay.test.js). **Full developer guide — request path, threat model control by control, how to run and test it, every current limitation, and a prioritised hardening roadmap: [import-relay.md](import-relay.md).** The preview discloses when the relay was used (`viaProxy`). Deployments without the function (a non-Vercel host, or the embeddable library) simply fall through to the download-and-drag guidance. The `vercel.json` rewrite excludes `/api/*` so the function isn't swallowed by the SPA fallback.
- **Search:** The sidebar filter matches document titles, tags, **and body content**. A global search overlay (**⌘/Ctrl+⇧F**, [src/ui/SearchPanel.tsx](../src/ui/SearchPanel.tsx)) ranks every note by title/body match with highlighted snippets and keyboard nav; opening a result seeds the Find bar. Pure ranking in [src/store/search.ts](../src/store/search.ts).
- **Front matter:** A leading `---` … `---` YAML block round-trips through both panes as a read-only key/value card ([src/extensions/FrontmatterBlock.ts](../src/extensions/FrontmatterBlock.ts)); the preprocessor emits a node ([src/engine/preprocessor.ts](../src/engine/preprocessor.ts)) and a turndown rule restores the block.
- **Edge cases:** Max file size **5 MB** ([src/store/import-export.ts:125](../src/store/import-export.ts#L125)); larger files are skipped with a warning.

### 13a. Autosave (browser-local)

- **What:** The document saves itself ~5s after you stop editing (persisting the canonical ProseMirror JSON, which is cheap — no markdown/HTML conversion on the save path). Manual ⌘S / Save remains as a redundant affordance. Implemented in [src/PerssonifyEditor.tsx](../src/PerssonifyEditor.tsx) (`AUTOSAVE_MS`).
- **Unload is its own data-loss path, and `beforeunload` alone does not cover it.** The handler does fire a best-effort autosave, but IndexedDB is asynchronous — `saveActiveDoc` awaits a read before it writes, so the page is gone before the write is even issued, and the in-memory draft cache does not survive a reload either. Measured: type a sentence, reload inside the autosave window, and it was on neither pane nor disk. localStorage is the only store that completes while a page is torn down, so the handler **also** writes a synchronous stash (`stashUnsaved`, `pf:recovery` — [src/store/crash-recovery.ts](../src/store/crash-recovery.ts)): the live canonical for the document the editor actually holds, plus every parked draft, honouring the same blank-over-content backstop. `initialize` adopts it via `takeStashed()` **before** activating a document, feeding the ordinary cached-draft path. The stash is one-shot (one that survived its own restore would keep resurrecting itself over newer content), bounded to 2 MB newest-first, and expires after a week. It is wired to **`pagehide` as well**: iOS Safari does not fire `beforeunload` when a tab is swiped away.
- **Storage boundary:** Autosave writes **only** to browser storage (IndexedDB, or localStorage / the host `window.storage` shim as fallbacks) via the storage adapter. It never calls the host `onSave` callback — automatic persistence stays on-device. The **only** network requests the app ever makes are user-initiated *Import from URL* fetches (inbound content); nothing is sent out. The one case where data leaves the browser is the **import relay**: if — and only if — a direct import fetch is CORS-blocked (e.g. Google Drive), the requested URL is retried through the app's **own** same-origin serverless function ([api/import.js](../api/import.js)). The URL and fetched file transit that function — which runs on the app's own origin (first-party, no third party) and is SSRF-hardened — not a third-party proxy. Direct-fetchable hosts never touch the relay, and the download-and-drag path stays fully local.

### 13b. Offline (PWA)

- **What:** The standalone app ([`vite.app.config.ts`](../vite.app.config.ts) via `vite-plugin-pwa`, `registerType: 'autoUpdate'`) registers a service worker that precaches the app shell (HTML/CSS/fonts/icons) and cache-first-caches JS chunks on demand, so the editor loads and works fully **offline** across reloads and is installable. Core chunks cache on first load; heavy optional renderers (Mermaid/abcjs/Cytoscape) cache the first time they're used. The embeddable library build ([`vite.config.ts`](../vite.config.ts)) gets **no** service worker.

### 12b. Pasting into the rich pane (styles kept by default)

- **What:** Pasting into the rich pane **keeps the formatting you copied** — bold, links, headings, lists, tables. Hold **Shift** while pasting to do the opposite once.
- **Why the default changed:** it used to strip styles by default, and the "Styled paste" switch was a *one-shot* — you armed it, pasted once, and it disarmed itself. Losing the formatting of something you deliberately copied is the surprising outcome, not the safe one. The switch is a persisted preference now (`pf:paste-styled`), and Shift **inverts** it rather than forcing styled (as `shiftKey || pasteStyled` the modifier could never change the outcome once the default was on).
- **Still sanitized:** "keeps styles" is not "keeps anything". A styled paste runs through `sanitizePastedHtml`; a stripped paste runs through `cleanPasteHtml`. Neither admits scripts or active content.
- **Where:** the "Styled paste" switch in the rich pane's header; `handleHtmlPaste` in [src/hooks/useDocumentLifecycle.ts](../src/hooks/useDocumentLifecycle.ts); default and persistence in [src/store/uiStore.ts](../src/store/uiStore.ts). Pinned by [src/__tests__/paste-styled.test.js](../src/__tests__/paste-styled.test.js).

### 13c. Import fidelity — reading the residuals

- **What:** When an import contains something the document model cannot represent, it is recorded as a **residual** (see [domain-glossary.md](domain-glossary.md)). The status bar shows the count; **clicking it opens the list**.
- **Why it is a button:** the count alone told the reader that some number of elements "could not be mapped to the current schema" and gave them no way to find out which — jargon plus a number, in an editor whose promise is that it does not quietly change your document. The per-item detail (type, tag, attribute, reason, position) was recorded on every import all along; it simply had nowhere to be read.
- **What it shows:** the items grouped into explained categories — *removed for safety* (scripts and active content), *no place in the document model*, *inline style not carried over*, *attribute not kept*, *may not survive a round-trip* — each with the element and where it was, and a plain statement that the original file was not changed. Each group is capped so a badly-formed import cannot turn the answer back into a wall.
- **Drift guard:** `RESIDUAL_KINDS` must have an entry for **every** `type` that `ingest.ts` pushes as a residual, or the dialog renders a raw slug — exactly the jargon it replaces. [src/__tests__/residuals-dialog.test.js](../src/__tests__/residuals-dialog.test.js) scrapes `ingest.ts` and fails if one is missing.
- **Accuracy matters more than the count.** `KNOWN_ELEMENTS`/`SCHEMA_OWNED_ATTRS` in `ingest.ts` must mirror the live schema. They had drifted behind `themeImage`, `Callout` and `SizedImage`, so the shipped welcome document — which *demonstrates* a `<picture>` theme image, a `> [!NOTE]` callout and a sized logo — opened reporting seven losses that never happen. Once the count became a readable list, the inaccuracy was obvious. [src/__tests__/residual-accuracy.test.js](../src/__tests__/residual-accuracy.test.js) pins it.
- **Known limit:** on the HTML/paste path `sanitizeForIngest` runs *before* `analyzeHtml`, so blocked elements (scripts, iframes, form controls) are removed and reported as nothing — the count under-reports there. The markdown path sees everything.
- **Entry point:** [src/ui/ResidualsDialog.tsx](../src/ui/ResidualsDialog.tsx), opened from [src/ui/StatusBar.tsx](../src/ui/StatusBar.tsx). `DocumentRecord.residuals` is typed `ResidualItem[]`.

### 14. Copy as Prompt

- **What:** Copies the active document **plus its linked neighbors** to the clipboard, formatted as XML-tagged context for an LLM.
- **Entry point:** **Tools ▸ Copy as Prompt** ([src/ui/MenuBar.tsx](../src/ui/MenuBar.tsx)) → handled in [src/PerssonifyEditor.tsx:506](../src/PerssonifyEditor.tsx#L506) (action dispatch) → `buildContextPrompt` ([src/integration/prompt-builder.ts:201](../src/integration/prompt-builder.ts#L201)).
- **Flow:** Resolves forward links (and optionally backlinks) of the active doc, caps at `maxDocs` (default 20), wraps each in `<document …>…</document>` and the set in `<documents>` with an optional `<knowledge_graph_summary>`.
- **Data:** Reads the link index ([src/store/link-index.ts](../src/store/link-index.ts)) and document records.

---

## Wiki links & knowledge graph

### 15. Wiki links (`[[…]]`)

- **What:** Link one document to another by title or id; backlinks are tracked automatically.
- **Syntax:** `[[Document Title]]` (resolve by title, case-insensitive) or `[[doc-id|Display Text]]`.
- **Entry point / flow:** On any document change, `useLinkIndex` ([src/hooks/useLinkIndex.ts](../src/hooks/useLinkIndex.ts)) rebuilds the index via `buildLinkIndex` ([src/store/link-index.ts:248](../src/store/link-index.ts#L248)); `scanWikiLinks` ([:77](../src/store/link-index.ts#L77), regex `/\[\[([^\]]+)\]\]/g`) finds links and `resolveTarget` ([:236](../src/store/link-index.ts#L236)) matches them to docs. Clicking a `[[link]]` in the rich-text pane is wired at [src/hooks/useLinkIndex.ts](../src/hooks/useLinkIndex.ts).
- **Data:** Builds the four maps `forward / reverse / unresolved / contexts` — see [database.md#the-link-index-in-memory-not-persisted](database.md#the-link-index-in-memory-not-persisted).

### 16. Backlinks panel (bottom tray)

- **What:** Shows incoming links, outgoing links, and broken (unresolved) references for the active doc; each entry navigates.
- **Where:** It lives as the first tab of the **expandable bottom tray** ([src/ui/BottomTray.tsx](../src/ui/BottomTray.tsx)) above the status bar, opened from the far-left **“Panel”** chevron on the status bar or the status-bar links count (`trayOpen`/`trayTab` in `PerssonifyEditor`). `BacklinksPanel` renders with `hideHeader` inside the tray. The Console (below) is a second, admin-gated tab. (The document outline moved to the left-docked workspace panel — see below.)

### 15b. Workspace panel (Files / Outline)

- **What:** A single **left-docked tabbed panel** ([src/ui/WorkspacePanel.tsx](../src/ui/WorkspacePanel.tsx)) with two tabs — **Files** (the library, #10) and **Outline** (a live table of contents for the active document). It replaced the separate library sidebar, the old outline panel, and the `docNav` expand ladder. Toggle it with `Cmd+Shift+D`; **View ▸ Outline** opens it directly on the Outline tab.
- **Document-first:** the Files tab is the only library. Selecting a document in Files updates the Outline live.
- **Outline (live tracking):** as you scroll the document, the tab highlights the heading you're in and **all of its parent headings up to the root**, and keeps those parents **pinned at the top** so the enclosing section is always visible — the list works as breadcrumb navigation. Click any heading to jump there. Reuses the same outline data as the graph (`extractHeadings` → `buildHeadingTree`, plus `ancestorHeadingIndices`) and a read-only scroll tracker ([src/hooks/useActiveHeading.ts](../src/hooks/useActiveHeading.ts)) that never drives the editor's scroll (so it can't disturb the two-pane scroll-sync).
- **Knowledge graph:** the graph is **not** in this panel. It opens as a full-screen relationship-map overlay (#17) from **View ▸ Relationship map** (or the graph toggle beside the mode switcher), where there's room for it. An in-panel graph tab was tried and removed — the narrow column couldn't show it usefully, and the Outline already covers document navigation.
- **Layout & state:** docks as a resizable column on the left on wide screens and a left-side drawer on phones (where selecting a document closes the drawer). Open/closed persists as `pf:workspace` (default open on desktop, closed on phones), the active tab as `pf:workspace-tab`, and the width as `pf:docnav-width`. When closed, a small reopen button sits at the editor's top-left.

### 16a. Diagnostics console (bottom tray, admin-gated)

- **What:** A read-only diagnostics console — a REPL-style input + scrollback that runs a **curated** command set over the editor's existing read APIs. Commands: `help`, `diag.lifecycle` (active/hydrated/save-status flags), `diag.storage` (local-storage usage), `docs.list`, `doc.outline`, `doc.links` (backlinks + forward links), `graph.stats` (node/edge counts).
- **Not an eval REPL:** every command is an explicit entry in a registry that receives a typed, read-only context of getters — there is no arbitrary property access and no write path. Mutating/automation commands are deliberately out of scope (tracked in [docs/backlog.md](backlog.md)).
- **Gating:** off by default; enable **Settings ▸ Admin ▸ Diagnostics console** (`consoleEnabled`, `pf:console`). Then a **Console** tab appears in the bottom tray. Not shown in the embed/minimal chrome.
- **Entry point:** [src/ui/ConsolePanel.tsx](../src/ui/ConsolePanel.tsx) + the pure registry [src/store/console-commands.ts](../src/store/console-commands.ts). Related: [src/__tests__/console-commands.test.js](../src/__tests__/console-commands.test.js).

### 17. Knowledge graph (the relationship map)

- **What:** A full-screen **relationship map** of the whole workspace — documents are nodes, `[[wiki links]]` are edges, folders are labelled containers. Single-document structure is **not** here: that is the Workspace panel's **Outline** tab (#15b), which stays visible beside the map (the overlay covers `<main>` only). An in-graph structure pane was tried and removed as a duplicate.
- **Layout — three DOCKED regions, nothing floats over the canvas:** a header, the map with one slim footer strip (legend · zoom −/%/+ · Fit), and a details rail — a right column on `lg+`, a docked bottom sheet below that, toggled from the header. Selecting a node on a narrow viewport opens the rail, or a tap would appear to do nothing. The map pane measures **only its own box** (`canvasRef` + `ResizeObserver`), so fit and focus are correct by construction. An earlier build pinned the inspector *over* the canvas while the camera fitted content to the full rect — the graph centred itself underneath the panel, and the note you selected was the one you could no longer see. Do not re-add an overlay over the canvas.
- **Physics runs in its own WORLD space** (`worldFor(n)`), never the viewport, so resizing a panel re-aims the camera instead of reheating the simulation and reshuffling the graph. A single mutate-in-place loop freezes on settle; a decaying `alpha` (`ALPHA_DECAY`/`ALPHA_MIN`) makes convergence deterministic, with a `MAX_FRAMES` backstop. Repulsion scales with the node **count**, not the world area.
- **Performance — the frame is the expensive half, not the physics.** A CPU profile of a 153-note settle never surfaced `stepOnce` or `placeLabels` (~1ms) while the frame measured a 44ms median, almost all of it style and layout for the SVG the render rewrites. Above 60 notes the layout advances several steps per rendered frame (`stepsPerFrame`, capped at 6): **108 rendered frames / 5.6s / 3.9s blocking → 35 frames / 2.3s / 1.7s**. At or below 60 it stays 1:1.
- **Camera is overview-first:** if the whole workspace fits at `OVERVIEW_MIN_K` or better it frames everything; only a workspace too large to read whole falls back to the active note's neighbourhood. It tracks the layout while it unfolds until you pan, zoom or drag. Breathing room is reserved in **screen** pixels, because labels are drawn at a constant size.
- **Everything drawn is sized in screen pixels and divided by the zoom** — dots, strokes, arrowheads, labels, folder chips — so zoom changes how far apart notes are, not how big a note looks. Two deliberate exceptions: dots are damped below 1× (constant dots turn a zoomed-out map into touching circles), and folder container geometry is world-stable below 1× (screen-sized padding inflated every box in world terms when zoomed out).
- **NO TEXT IS EVER DRAWN OVER.** `placeLabels` (pure, unit-tested) resolves every label in screen space against everything already placed — every node dot, then every folder chip, then ghost stubs. Each name gets **four candidate positions** and then a **compact form**; a label is vetoed if it would cross a container the note does not belong to, or fall off the canvas. Dropping a label is the only sanctioned outcome, and the note is still named in the rail and on hover. Re-measured in a browser across 3/12/25/40/153-note workspaces, desktop and phone widths, at fit / 4 clicks out / 8 clicks in.
- **Folder containers have ONE geometry definition — `folderRects`** — shared by the renderer, the label placer and the layout forces (they each used to compute their own approximation, so the box you saw, the box labels avoided, and the box clusters were pushed out of were three different rectangles). A container encloses each member's dot **and its label**. Separation is a **hard positional constraint** applied after integration, not a force that loses to the springs. The cluster's chip straddles a border, fieldset-legend style, and slides along it looking for clear ground.
- **`chip↔dot` is NOT zero and cannot be.** Below ~40% zoom the dots converge into a band by design and a screen-constant chip covers a lot of world, so no border slot is clear; measured, a chip's own letters sat under a node dot. The resolution is **draw order** — containers paint first (a background wash), then edges and nodes, then **folder chips LAST**, so the cluster name wins the pixel. `graph-metrics.test.js` pins that source order.
- **The rail is the whole information layer.** With a node selected: title, folder/state tags, three stat cells (links in · out · headings), Open/Focus/Isolate, the document's **headings** (click one to open the note there), **both link directions as clickable documents**, and that note's broken links — counts alone said a relationship existed but not with what. With nothing selected it is a workspace overview (most connected, unlinked notes, broken links), so the header counts lead somewhere real.
- **Search & health filters:** a header search dims non-matches (the layout never re-simulates; Enter focuses the match) and orphan / broken-link chips filter the map, with an off-by-default ghost-target overlay for missing link targets. Metrics come from the pure, unit-tested [src/store/graph-metrics.ts](../src/store/graph-metrics.ts) (`findOrphans`, `rankByDegree`, `brokenLinks`, `placeLabels`, `folderRects`, `stepsPerFrame`); broken data is passed in from `linkIndex.unresolved`.
- **Zero-edge state:** when there are nodes but no links, the map replaces the scatter of unconnected dots with an explanation of what a link is plus clickable chips for each note — a dot field reads as broken.
- **Navigation:** click = select, double-click / **Enter** = open (closes the overlay), drag = rearrange, wheel / footer buttons / **Fit** = camera.
- **Accessibility:** nodes are focusable (`role="button"`, Enter to open) with a focus ring, and an `sr-only` list mirrors every node. The overlay is a labelled **region**, not a modal — the menu bar, workspace panel and surface switcher stay usable beside it by design, and the covered editor is marked `inert` instead.
- **Entry points:** the **Editor · Cards · Map** switcher in the top bar, **View ▸ Relationship map**, **⌘⇧G**, and the `/graph` route. **Escape** clears an active search/filter first, then closes. The graph's **JSON export** lives in the map's own header (it used to sit in the global status bar, visible to people who had never opened the map). Node/edge data from `exportGraph` ([src/store/link-index.ts](../src/store/link-index.ts)); [src/ui/GraphView.tsx](../src/ui/GraphView.tsx).
- **Testing hooks:** the DOM carries `pf-node-dot` / `pf-node-label` / `pf-folder-box` / `pf-folder-chip` / `pf-chip-label` / `pf-ghost-label` classes plus `data-doc-id` / `data-folder-docs`, specifically so overlap can be **measured** in a browser rather than eyeballed. If you touch the geometry, re-measure.

### 17a. Workspace views (Editor · Cards · Map)

- **What:** Editor, Cards and the relationship map are **one exclusive selection** (`workspaceView: "editor" | "cards" | "map"`), surfaced as a three-way button group beside the mode switcher and mirrored as a radio group in the View menu.
- **Why one value:** they were two independent booleans, and both could mount at once — two dialogs at the same z-index with the map invisible *beneath* Cards, so View ▸ Relationship map looked like a dead menu item.
- **Editor is a first-class option**, not "both overlays off": leaving a view by un-toggling the button you entered through read as an escape hatch. The switcher buttons **select**; the keyboard shortcuts stay **toggles** (⌘⇧K twice returns).
- **Cards and Map are peers** — full-canvas views of the whole library, each an overlay over `<main>` with the live editor still mounted beneath, and both leave by the same "Back to editor" button. Choosing a layout (MD/Rich/Split) returns to the editor, since those panes are invisible under an overlay.
- Pinned by [src/__tests__/workspace-views.test.js](../src/__tests__/workspace-views.test.js).

### 17b. Cards board

- **What:** A Google-Keep-style board over the WHOLE library — every document is a card, with quick capture, checklists, nine note colours, pin-to-top, and search. An overlay over `<main>` with the live editor still mounted beneath ([src/ui/CardsView.tsx](../src/ui/CardsView.tsx) + pure helpers in [src/store/cards.ts](../src/store/cards.ts)).
- **Cards show RENDERED markdown, not raw source.** The face renders each note as real structure — headings, lists, emphasis, links — via `cardPreviewHtml`, a **pure, bounded** PM-JSON→safe-HTML renderer (deliberately not marked or `generateHTML`, which would build a ProseMirror schema per card on every search keystroke). Every text run is escaped and only a fixed structural tag whitelist is emitted; a link renders as an `<a>` with no href, since the card face is itself a button.
- **The opened card is a Preview · Split · Write surface** (persisted `pf:card-view`; default **Preview** on a phone, **Split** on a wide screen). Opening a note shows it *rendered*, not as raw `##` and `**`; Split puts the markdown source beside a live rendered pane; Write is the source alone. The rendered side reuses the app's own markdown engine and sanitizer (`sanitizeForIngest(engine.mdToHtml(...))`), so a card renders identically to the main preview and reflects unsaved edits as you type. Links in the rendered view are for reading — a click never navigates the board away; real navigation is **Open in editor**.
- **Still deliberately reduced.** No formatting toolbar in the card; full authoring is one click away. Editing hands **markdown** back to the host (`handleCardSave`), which parses with the live schema and writes through the same guarded path the host bridge uses — the card view never writes the canonical itself.
- Pure helpers (preview, checklist, colour/pin, sort/filter) are unit-tested in [src/__tests__/cards.test.js](../src/__tests__/cards.test.js).

---

## Structured content (advanced / Tiptap extensions)

These are **custom node types** layered on Tiptap. Most are preprocessed but **disabled by default** in the markdown preprocessor (see notes); they are fully live as editor nodes. See [architecture.md#custom-tiptap-extensions](architecture.md#custom-tiptap-extensions).

### 18. Field blocks (`:::fields … :::`)

- **What:** Structured key→value metadata embedded in a document, rendered as a card.
- **Syntax:**
  ```
  :::fields
  status: in-progress
  priority: high
  :::
  ```
- **Code:** [src/extensions/FieldBlock.ts](../src/extensions/FieldBlock.ts) — `parseFieldBlock` ([:75](../src/extensions/FieldBlock.ts#L75)), `serializeFieldBlock` ([:96](../src/extensions/FieldBlock.ts#L96)), commands `insertFieldBlock`/`updateFieldBlock` ([:42](../src/extensions/FieldBlock.ts#L42)). Value types auto-detected (date/number/boolean/text).

### 19. Transclusions (`![[…]]`)

- **What:** Embed another document (or a section/block of it) inline.
- **Syntax:** `![[Title]]`, `![[Title#Section]]`, `![[id#^block-id]]`.
- **Code:** [src/extensions/TransclusionBlock.ts](../src/extensions/TransclusionBlock.ts) — `resolveTransclusions` ([:163](../src/extensions/TransclusionBlock.ts#L163)) recursively resolves targets, caches rendered HTML, and **detects circular references** (`error: "circular"`). `extractSection` ([:232](../src/extensions/TransclusionBlock.ts#L232)) / `extractBlock` ([:261](../src/extensions/TransclusionBlock.ts#L261)) pull sub-content.

### 20. Block IDs (`^block-id`)

- **What:** Stable per-block anchors so transclusions/links can target a single block.
- **Syntax:** a line ending in `^abc123` (4–12 chars in markdown).
- **Code:** [src/extensions/BlockId.ts](../src/extensions/BlockId.ts) — `extractBlockIds` ([:93](../src/extensions/BlockId.ts#L93)), `injectBlockIds` ([:129](../src/extensions/BlockId.ts#L129)), `assignBlockIds` ([:169](../src/extensions/BlockId.ts#L169)). New IDs are 32-char nanoids.

---

## Embedding (integration API)

### 21. Embed the editor in another app

- **What:** Use the editor as a React component or inside an iframe, with an imperative handle and event callbacks.
- **Entry point:** [`<PerssonifyEditorIntegration>`](../src/integration/PerssonifyEditorIntegration.tsx) (exported from [src/index.tsx](../src/index.tsx)).
- **Imperative handle** (`EditorHandle`, [src/integration/PerssonifyEditorIntegration.tsx:115](../src/integration/PerssonifyEditorIntegration.tsx#L115)): `getCanonicalDocument()`, `getMarkdown()`, `getHTML()`, `getGraph()`, `getDocuments()`, `getActiveDocument()`, `importContent()`, `setDocuments()`, `setFieldSchemas()`, `setAssociations()`, `setTheme()`, `getAssociations()`, `copyAsPrompt()`, `exportAs()`.
- **Iframe bridge:** `createHostBridge` (inside the iframe) ⇄ `createEditorClient` (parent) over `postMessage`, protocol `"perssonify"` — [src/integration/host-bridge.ts](../src/integration/host-bridge.ts).
- **Full reference:** [architecture.md#embedding--integration](architecture.md#embedding--integration).

---

## Theme & responsive

### 22. Dark / light theme

- **What:** Dark (default) and light themes, amber accent, glassmorphic surfaces; persisted to `localStorage`.
- **Entry point:** `next-themes` `ThemeProvider` in [src/main.tsx](../src/main.tsx) (storage key `perssonify-theme`); class strings from `createTheme` ([src/theme/index.ts:32](../src/theme/index.ts#L32)).

### 23. Responsive layout

- **What:** Below 768px the app forces markdown-only mode and a compact toolbar; safe-area insets for notched devices.
- **Entry point:** [src/hooks/use-mobile.ts](../src/hooks/use-mobile.ts), `TOOLBAR_COMPACT_BP` ([src/constants.ts](../src/constants.ts)).

---

## Viewing, sharing & embedding

### 24. Read-only mode

- **What:** Opens the document non-editable: both panes go read-only, the formatting toolbar is hidden, and the **view mode is locked** (Markdown/Rich/Split can't be changed until read-only is turned off). The menu bar and reading stay available.
- **Entry point:** state `useUIStore.readOnly` (localStorage `pf:read-only`). Panes honor it via `editor.setEditable` (Tiptap) and an editability Compartment (`EditorState.readOnly`/`EditorView.editable`, CodeMirror). The view-mode lock lives in [src/ui/ModeSwitcher.tsx](../src/ui/ModeSwitcher.tsx), the View menu ([src/ui/MenuBar.tsx](../src/ui/MenuBar.tsx)), and the Settings selector ([src/ui/SettingsSheet.tsx](../src/ui/SettingsSheet.tsx)).
- **Toggle:** View menu, File → Settings, or the `readonly=true` URL param.

### 25. Optional support ads

- **What:** Placeholder display-ad slots, off by default and **never shown in the embed**. Gated by `useUIStore.showAds` (localStorage `pf:show-ads`) AND full chrome.
- **Entry point:** [src/ui/AdUnit.tsx](../src/ui/AdUnit.tsx). Slots are placeholder-only (no external network — offline/CSP-safe).
- **Toggle:** View menu, File → Settings, or the `ads=true` URL param.

### 26. Share / embed link builder

- **What:** Tools ▸ Share / embed link composes a standalone link (settings pre-applied) and an `<iframe>` embed snippet from a few toggles — view mode, read-only, ads, theme, accent, chrome, background.
- **Entry point:** [src/ui/LinkBuilderDialog.tsx](../src/ui/LinkBuilderDialog.tsx). Defaults are omitted so links stay short.

### 27. Standalone URL parameters

The app reads these on load and strips them via `history.replaceState` ([src/App.tsx](../src/App.tsx)):

| Param | Values | Effect |
|-------|--------|--------|
| `view_mode` | `md`\|`html`\|`split` | initial pane(s); mapped to `setMode` |
| `readonly` | `true` | open read-only (locks the view) |
| `ads` | `true` | show the optional support ads |
| `import_url` | `<link>` | **pre-fills** the importer with that link (top-level only). It never fetches on its own — a shared link must not make a visitor's browser call an attacker-chosen address on load. |

The iframe embed ([src/embed.tsx](../src/embed.tsx)) additionally reads `theme`, `accent`/`accentColor`, `chrome`, `bg`, and `allowed_origin` — the origins permitted to drive it over `postMessage`, defaulting to the origin of `document.referrer` and refusing a literal `*` (see [integration-guide.md](integration-guide.md) §6). `view_mode` there is aliased to `mode`.

### 28. Password-protected archive import

- **What:** Importing an encrypted `.zip` (by file or URL) is detected with no dependency (central-directory general-purpose bit 0), prompts for a masked password, and decrypts in-browser via a lazy `@zip.js/zip.js` import. Wrong password re-prompts.
- **Entry point:** `isZipEncrypted`/`extractArchive` in [src/store/archive.ts](../src/store/archive.ts); `ArchiveEncryptedError`/`ArchiveWrongPasswordError`. Prompt uses `useDialog().prompt({ type: "password" })`.

---

## Editor UX details

### 29. Heading-anchored scroll sync (split view)

- **What:** In split view the two panes stay aligned by a **heading-anchored piecewise-linear** map: corresponding headings on both sides are paired and interpolated between, so each section's scroll speed scales to its own relative height (a global percentage only kept top/bottom aligned). Value-based echo suppression (no timer). Falls back to top↔bottom when a doc has no headings.
- **Entry point:** [src/ui/EditorPanes.tsx](../src/ui/EditorPanes.tsx) (`project`/`rebuild`). CM anchors via `lineBlockAt(line.from).top` (works for off-screen lines); rich anchors via heading `getBoundingClientRect`.

### 30. Image rendering & sizing

- **What:** Editor and preview images render **full, with no border-radius** (rounding clipped corner pixels and truncated logos/screenshots with edge content). Images can be sized with an `<img … width="…" />` tag (`extensions/SizedImage.ts`), and follow the in-app theme via `#gh-light-mode-only`/`#gh-dark-mode-only` fragments or a `<picture>` element (`extensions/ThemeImage.tsx`).
- **Entry point:** `.ProseMirror img` in [src/styles.css](../src/styles.css) + `[data-md-preview] img` in [src/engine/useMarkdownEngine.ts](../src/engine/useMarkdownEngine.ts).

### 31. Graceful mode transitions

- **What:** Imposing a view mode or read-only briefly fades the editor area (`pf-mode-fade`, opacity-only, restarted via reflow — no remount) so panes/toolbar don't snap in and out.
- **Entry point:** [src/ui/EditorPanes.tsx](../src/ui/EditorPanes.tsx) effect on `[mode, readOnly]`; keyframes in [src/styles.css](../src/styles.css).
