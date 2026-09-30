# Changelog

All notable changes to `@perssonify/editor`, newest first. Format follows
[Keep a Changelog](https://keepachangelog.com/); this project uses a single
source of truth for the version number (`package.json` → `__APP_VERSION__` →
`src/constants.ts` `VERSION`). Dates are approximate; `git log` is authoritative
and every feature commit subject after v1.35 carries its `(vX.Y.Z)` tag.

> **Rebuilding or extending the app?** See
> [`docs/v1-to-current-changelog.md`](docs/v1-to-current-changelog.md) — the full,
> area-grouped feature delta from the initial import ("v1") to the current release.

## [Unreleased]

An external production-readiness audit of 1.77.0 (18 September 2026) raised 114
findings. This release fixes 90 of them in code and does the code side of 17
more; what remains — mostly accounts, settings and legal pages that need a
person — is listed in [`docs/audit-2026-09.md`](docs/audit-2026-09.md). The
finding IDs (A001–A114) are cited below.

### Changed — what you will notice
- **Exported markdown keeps its line breaks in other apps.** A line break inside a
  paragraph is written as a backslash at the end of the line in exported markdown
  (File ▸ Export, the per-document export and ZIP exports), which every markdown
  renderer honours; before, most renderers joined the lines. The editor's own
  markdown pane is unchanged. (A051)
- **Images are stored once.** A pasted, dropped or imported image is kept once in
  this browser, however many documents or saved versions use it, instead of as
  text inside every copy. Exports and backups still carry the image, and a Word
  export now shows it as a picture instead of an `<img>` tag. Settings ▸ Storage
  shows the space images use and can clean up unused ones; nothing is deleted
  automatically. Documents saved before this keep their images as they are. (A086)
- **The interface can be translated.** Every label, message and menu now comes
  from a translation catalog (English is the only language shipped so far), and
  the Help and About pages are per-language content. Exported HTML and printouts
  no longer declare the document English. (A099)
- **Older browsers get a message instead of a blank page.** The supported floor
  is Safari/iOS 16.4, Chrome/Edge 111 and Firefox 128; below it the app says so
  and touches nothing stored. (A097)
- **A heading link inserted from the rich pane is written `[[#Heading]]`**, the
  way the markdown pane writes it, instead of `[[#Heading|Heading]]`.
- **Updates are offered, never forced.** A new version shows "Update ready —
  Reload" and waits for you. Every deploy used to reload every open tab,
  mid-sentence, losing undo history, dictation in progress and open dialogs. A
  tab left open checks for a new version every hour; a background tab with
  nothing unsaved updates itself when another tab applies the update. (A008)
- **Works offline after one visit.** The whole app — maths, diagrams, sheet music,
  Find, the map, Cards, Word export — is cached in the background on the first
  online visit. Before, any feature you had not already opened online failed
  offline. (A085)
- **The `{…}` formatting syntax is off by default.** The undocumented curly-brace
  syntax (`{color=red}text{/color}`) was on by default and deleted text inside
  braces it did not recognise: `## Returns {Promise}` became `## Returns`.
  Documents that used it now show the braces as written. It is an opt-in engine
  feature with no Settings switch, and even when enabled a group it does not
  recognise stays exactly as typed. (A039)
- **The markdown pane writes `---` for a horizontal rule**, not `* * *`, when it
  is regenerated from the rich pane. (A051)
- **Literal `<` and `&` are escaped where they would become markup.** A sentence
  about `<details>` or the text `&lt;br&gt;`, typed in the rich pane, is written
  `\<details>` and `\&lt;br&gt;` in the markdown instead of turning into a
  collapsible block or a line break on the next pass. A number followed by `)` at
  the start of a line is escaped too, and `$` and `~~` while maths and
  strikethrough are on. Ordinary prose — `a < b`, `Tom & Jerry`, `$5 and $10` —
  gets no backslashes. (A040)
- **Importing through our server asks first.** When a site blocks browsers from
  reading a link, the import used to go silently through Markdown Studio's
  server. It now asks once, remembers the answer, and lets you change it in
  Settings ▸ Privacy; say no and that import fails instead. (A076)
- **Formatting shortcuts act only inside the document.** ⌘B, ⌘I, ⌘K and the
  heading chords used to format the document hidden under Cards or the map when
  typed in a search box, the Cards composer or a rename field. They now do
  nothing unless the caret is in one of the two panes and the editor is showing.
  Find, Save, New and the view shortcuts still work from anywhere. (A025)
- **AltGr types characters, never shortcuts.** On German, Nordic, Swiss, Spanish,
  French and other AltGr keyboards, `[`, `]` and `\` can be typed again — so can
  markdown links, task lists and `[[wiki links]]`. As a result the undocumented
  Ctrl+Alt+digit heading shortcuts no longer work on Windows and Linux (use the
  documented Ctrl+Shift+1–6), and on an AltGr layout Ctrl+Alt+F types its
  character — use Ctrl+H for Replace. (A052)
- **Tab next to a list keeps its old meaning.** The editor-library upgrade in
  this release would have made Tab, pressed in a paragraph right after a list,
  pull that paragraph into the list. That is switched off; Tab inside a list item
  still indents it.
- **Inserting an image asks for a description** (alt text) after the address —
  leave it empty for a decorative image. The markdown pane now inserts the image
  you asked for instead of a placeholder, and ⌘K there links to the address you
  typed. (A096)
- **The placeholder ads and the Admin settings are gone from the shipped app.**
  "Your Ad Here" slots could be switched on by anyone from the View menu,
  Settings or a `?ads=1` link; they exist only in development builds now. The
  Admin section (console, context-menu switch) is hidden unless enabled for a
  support session. (A078, A081)
- **The app refuses to load inside another page's frame** (anti-framing is
  enforced). `/embed.html` remains the page meant for iframes. (A068)
- **Remote images can be blocked.** Settings ▸ Privacy ▸ Block remote images stops
  images in a document from loading from other sites, which otherwise learn when
  the document is opened. The app no longer sends a Referer. (A076)
- **Split view keeps both panes side by side on a landscape phone**, where
  stacking left each editor 37–69px tall, and **printing prints the document**
  rather than one page of the app's chrome. (A100)

### Fixed — content that was lost or changed
- In a long document the footnotes section could come back as a literal
  `## Footnotes` heading when the conversion split it from its definitions.
- Tabs inside code blocks survive a round trip, text such as `<snake_case>` no
  longer vanishes, Word export no longer shows HTML entities, and bold or italic
  after a code span that ends in a backslash renders correctly (the markdown
  parser, marked, is updated from 12 to 18).
- A formula whose maths renderer could not be downloaded shows its LaTeX instead
  of staying blank.
- Hard line breaks — addresses, poems, verse — are kept (A037); anything nested
  under a checklist item is kept (A038); blank lines inside list items and inside
  code in a list are kept (A041).
- Footnotes survive editing in the rich pane (A043).
- Table column alignment survives, line breaks in cells are kept, and a cell
  holding something a markdown table cannot carry is reported (A044).
- A wiki-link alias in a table no longer gains a backslash on every round trip
  (A045); wiki links and `{…}` inside indented code are left alone (A048).
- Code in longer fences and in fences inside quotes or callouts is no longer
  reformatted (A046); front matter containing `&` or quotes is no longer wiped
  (A047).
- `$5 and $10` and `$5-$10` stay prose, and `$$…$$` in the middle of a line no
  longer splits the paragraph (A049). HTML comments are reported instead of
  silently deleted (A050).
- The toolbar's own "Mono" font no longer turns into literal tag text in Styled
  mode (A042). Toggling a Markdown feature no longer strips alignment and colour
  (A033). Editing a card no longer strips colour, highlight, font and alignment
  from the whole note (A020).
- Select ▸ All headings + Bold bolds every heading instead of destroying the first
  (A054); markdown-pane Clear formatting no longer deletes images, links, code and
  bullets (A055); markdown table operations no longer split cells on `\|` or on a
  wiki-link alias, and keep `:---` and a table's indentation in a list (A053);
  `# comments` in code blocks are no longer treated as headings (A062).
- Smaller round-trip drift: `[[My_Doc]]` keeps its short form, a leading `---`
  plus a blank line is a rule rather than front matter, a heading ending in `#`
  keeps it (A051).

### Fixed — data safety
- **Unmounting an emptied editor never writes a blank document** over the stored
  one (hosts that unmount the editor inside the autosave window).
- **A document from a newer version is no longer reported as "empty"** when a
  save is refused; the message says it is open read-only.
- **The first-run documents' links to the welcome document work** — they were
  drawn as broken for every new user.
- **A slow URL import says it timed out**, instead of asking to use the server
  relay for a site that simply had not answered yet.
- **Reloading after a two-tab conflict no longer overwrites the other tab's work**,
  and closing a window with two unsaved tabs keeps both tabs' recovery copies
  (A018, A027).
- **A document written by a newer version opens read-only instead of blank** —
  loading it blank and autosaving would have replaced it (A021).
- **Read-only keeps protecting the markdown pane after a document switch**, and the
  first edit after a switch is always saved — one paste into the markdown pane was
  never synced, marked dirty or saved (A019).
- ⌘S says "Changes saved" only when something was saved, and a host's `onSave`
  fires only then (A026).
- Rename, card pin/colour and host patches respect a conflict with another tab
  (A028); a storage read error is treated as an error, not "document not found"
  (A029); a damaged document list rebuilds itself instead of hiding documents
  (A030).
- A click during a multi-file import no longer saves a file as an empty
  "Untitled" (A031); New document during a pending switch no longer leaves every
  later save refused (A032); a host's `importContent` saves the open document
  first (A034); remounting the editor inside a host app no longer overwrites the
  last document (A024).
- Version history: deleting a version asks first (A023), same-millisecond versions
  list in the right order (A035), and restoring in place is refused while
  read-only (A036).
- **The storage limit is the browser's real quota** — saves used to stop at about
  18 MB of markdown and retry forever — and a full disk is a clear "Storage full —
  not saving" state that deleting a document or pressing Save recovers from (A086).
- **Protection against the browser clearing its storage**: the app asks for
  persistent storage, reminds you to take a full backup, notices when a library it
  knew about comes back empty (instead of greeting you with the starter documents)
  and shows a "Not saving" banner whenever storage is unavailable; Safari users get
  an install tip (A017, A022). The old address shows a "we've moved" banner with a
  one-click backup (A004).

### Security and privacy
- **Exporting, copying or sending a document to a host no longer fetches its
  images.** The document's HTML was built in the live page, so every image in it
  started loading: a remote image was requested on every export, and WebKit
  reported a failed load for each stored image.
- **The full app can no longer be framed at `/embed.html`.** The production
  deploy has no embed build, so that address served the full app under the
  embed's anti-framing exemption; it now returns 404 unless an embed build is
  deployed there.
- **Erasing local data removes the Cards composer's unsent draft**, and the
  integration handle exposes `clearLocalData()` for a host's logout.
- **No export carries the imported originals**: the crash screen's "Export my
  documents" uses the same envelope as every other export, and that envelope
  no longer includes the pre-import HTML.
- A Content-Security-Policy (report-only, hash-pinned) and hardening headers;
  hashed assets cache as immutable; a missing chunk returns 404 instead of the app
  page (A068, A012, A016).
- Diagram directives can no longer restyle the page outside the diagram (A069);
  style attributes in imported JSON are validated (A070); a hostile `.docx` can no
  longer freeze the tab (A071); sanitiser hardening (A073).
- The import relay reaches only public addresses, stops at 4 MB with a message you
  can act on, logs one line per request with the host only, and grants
  cross-origin access to markdownstudio.com alone (A010, A013, A074).
- The embed's host bridge trusts only the page that actually frames it, and a
  deploy-time allowlist has the last word (A072).
- **Erase all local data** (Settings ▸ Local data); **Erase history** after
  deleting a document; deleted documents' copies expire after 30 days; exports no
  longer carry the original imported text (A079). A host's own storage keeps
  version history and crash recovery in its namespace, and `clearLocalData()`
  logs a shared device out cleanly (A103).
- The privacy copy says what is true: documents stay in the browser; the import
  relay and remote images are the two things that reach the network (A076).
- Third-party licence notices ship with the app at `/third-party-licenses.txt`, and
  the About page's credits are corrected (A077). `/.well-known/security.txt`
  names a security contact (A007).

### Accessibility
- In Windows high-contrast (forced colours) mode the focus ring uses the system
  highlight colour in every browser, on menu items, tabs, tree rows and options
  too; before, only Chromium showed it correctly. (A095)
- Both editors have accessible names (A089); a visible focus ring in every palette
  (A090); the editor stays usable at 400% zoom (A091); accent-coloured text meets
  contrast in every palette (A092).
- The collapsed bottom panel is out of the Tab order and its tabs are a real
  tablist (A093); a "Skip to editor" link, a keyboard-operable library tree, a
  toolbar that is one Tab stop with arrow keys, and a DOM order that matches the
  screen (A094); further contrast and Windows High Contrast fixes, including dimmed
  text on the Cards board (A095).
- Save announcements speak only when something goes wrong or recovers; visible
  labels are part of each control's name; reduced motion reaches scripted
  scrolling; images get alt text; the Find box is labelled (A096). Help documents
  the keyboard navigation keys.

### Editor, links and search
- **The word count counts every paragraph, heading, list item and table cell
  separately.** It ran the last word of each block into the first word of the
  next, so a four-item list counted as one word and every heading lost one.
- Escape in the Find box closes the panel once (it closed it twice).
- **Broken wiki links are marked** — the 1.76.0 marking never actually fired
  (A058). Links go to the right document, titles containing `#` can be linked
  (A059), and link clicks keep working after the editor remounts (A064).
- Find & Replace: a regular expression runs off the main thread with a time limit,
  so a catastrophic pattern cannot freeze the tab (A061); replacements that depend
  on context now happen (A060); `^`/`$` mean line start/end in the markdown pane,
  highlights honour Match case and Whole word, and Replace inserts text rather
  than HTML (A067).
- The Outline shows every heading, not the first 40 (A063); non-Latin heading
  links, whole-word search and Chinese/Japanese/Thai word counts work (A098);
  right-to-left text renders right-to-left (A099).
- Cards update in place, pin and colour show at once, and Escape keeps the
  composer's draft (A087, A056, A057); Escape in a dialog over Cards or the map
  closes only the dialog (A057). The map's wheel zoom works on every open (A065).
  A folder dropped on a document row lands in that document's folder (A066).
  "Link to heading" inserts the heading's words, not its markup.

### Performance
- The library panel no longer freezes the editor on every autosave: at 2,000
  documents a save went from ~2.3 s to ~16 ms (measured in jsdom) (A082).
- **Typing in a large document no longer stalls the markdown pane.** Only the
  blocks you changed are re-converted: in a 1.6 MB document the markdown pane
  follows a keystroke in 0.17 s instead of 2.5 s (0.6 s instead of 23 s with the
  CPU slowed 4×), and in a 4 MB one in 0.4 s. The right-to-left handling and the
  right-click menu no longer cost time on every keystroke, the maths scan is
  bounded, and markdown→rich for a 1.6 MB document went from ~0.4 s to ~0.1 s.
  Opening a very large document, and edits made in the markdown pane, still
  convert the whole document (A083, partly done).
- Startup download 915 → 680 KiB gzip (A084); the Cards board reloads only what
  changed (A087); snapshot pruning, batched backup export and a single KaTeX copy
  (A088).
- **Images no longer weigh down saving.** With five ~880 KB images in a document,
  the saved record went from 5.74 MB to 1.3 KB, one version-history copy from
  11.5 MB to 2 KB, and a save from 42–50 ms to 19–32 ms; a document with images now
  fits the crash-recovery stash, which it used to exceed. (A086)
- **Opening a document with many code blocks is no longer quadratic.** A 1.6 MB
  document with a code block every 12 blocks opens in 5.4 s instead of 58.5 s,
  and the mixed large-document fixture in 3.2 s instead of 13.1 s. The word
  count, the export-fidelity check and broken-link marking now look only at the
  blocks an edit touched. (A083)
- **Notes in folders are no longer drawn on top of each other on the map.** A
  map with folders piled notes onto the same spot — a 150-note map in 15 folders
  hid about a quarter of its notes under others. Each folder now starts as its
  own cluster in a space sized to the library, and folders move as units; every
  note gets its own spot up to 500 notes. Maps without folders look exactly as
  before, and folder maps over 500 notes keep the previous layout for now. (A088)
- **The relationship map at 2,000 notes** (measured with the CPU slowed 4×): the
  first frame appears in 1.0 s instead of 8.9 s, the page is blocked for 6 s
  instead of 64 s, the layout settles in 17–23 s instead of 65 s, and zooming
  answers in under 0.1 s while it settles. Maps of 250 notes or fewer are drawn
  exactly as before. (A088)
- React 19 adds about 22 KiB gzip to the startup download.

### Reliability
- A local, redacted error log behind **Copy diagnostics** (the crash screen and
  the About page) and an **Export my documents** button on the crash screen; no
  telemetry leaves the device (A009).
- The boot watchdog acts only on evidence of a failed app script, and only online
  — a slow device no longer has its offline cache wiped (A011). A diagram or
  formula whose renderer failed to download says so, instead of showing the fetch
  error as a diagram error, and the app no longer caches the failure (Chromium
  itself still needs a reload to fetch a failed module again) (A085).
- Leaving the page is no longer cancelled by the app reloading itself: Firefox
  aborts a page's pending downloads as it navigates away, which the app took for
  a failed update.

### npm library
- `importFile` names a document by its first heading (it used the file name
  until the host finished the import).
- Every runtime import is declared (A101); the stylesheet no longer restyles the
  host page or its design tokens (A102); the tarball is 0.66 MB instead of 13 MB,
  the ES build mounts in browser bundles and the CommonJS build loads in Node
  (A104).
- Public API that did nothing — `setFieldSchemas`, the `fieldSchemas` and
  `linkResolver` props, the `BlockId`/`FieldBlock`/`TransclusionBlock` exports —
  is deprecated and warns once in development (A105). A second editor on the
  same page now refuses to start, with a message, instead of silently sharing the
  first one's state; it takes over when the first unmounts (A106).
- New: `clearLocalData()` and `setErrorReporter()`; `storageConfig` accepts
  `namespace`, `snapshots` and `crashRecovery`. **Consumers must import KaTeX's
  stylesheet themselves** (`katex/dist/katex.min.css`). Tiptap is 3.31.3 across
  every `@tiptap/*` package and the peer ranges are bounded (A113).
- **React 19 is supported; the React floor rises to 18.3.** The peer range is
  `^18.3.0 || ^19.0.0`, and CI runs the type check and unit suite on both. The
  CommonJS build can be `require`d in Node — it threw on the Tiptap starter kit —
  and marked is 18 (ESM-only since 16: CommonJS consumers need Node 20.19+/22.12+
  or a bundler, and Jest users must transform it) (A113).
- **Stored images are opt-in for hosts** (`storageConfig.assets: true`): without it
  a host's content keeps its images inline, since a stored-image reference resolves
  only in the browser that stored it (A086).
- On the app's own hosts the embed keeps its documents in a database of its own
  (`perssonify-embed-docs`), so a page framing it can never reach the app's
  library; a self-hosted embed keeps `perssonify-docs` (A072).
- The integration's handle always calls the host's latest callbacks: after the
  host re-rendered, document updates kept calling the old graph-update callback
  (A108).

### Developer
- ESLint with the React hook rules (`bun run lint`, 0 errors) and `noImplicitAny`
  (A109); coverage measured over all of `src`, now 81.8% of lines after sixteen
  behavioural suites that mount the real editor (A108); the unit suite no longer
  fails intermittently (A107).
- `PerssonifyEditor.tsx` is split from 2,992 lines into fifteen hooks under
  `src/editor/` (A110). TypeScript 6.0 (7 waits for typescript-eslint, A113).
- The browser campaign runs five suites on Firefox and WebKit as well as
  Chromium (`E2E_BROWSER`, CI job `e2e-engines`, A100), plus `bun run e2e:floor`
  for the unsupported-browser message (A097).
- Bun pinned to 1.4.0 with `--frozen-lockfile`, actions pinned to commit SHAs,
  least-privilege CI and Dependabot (A014); npm publishing only from CI, with
  provenance (A006); an uptime check (A001); `bun audit` 34 → 0 (A114).
- New browser suites `bun run e2e:csp` (the build under an enforced CSP) and
  `bun run e2e:pwa` (offline after one visit; updates never force a reload).
- `build:app` generates the third-party licence notice; the deploy strips
  sourcemaps after it (A077, A016). Line endings are pinned to LF. The
  documentation anchor script runs on Windows.
- Deployment owner steps, decision records and five new runbooks (A005, A003,
  A015); docs, `CLAUDE.md` and the backlog reconciled with the code (A111).

## [1.77.0]

An external review of the codebase found five defects, three of them paths that
lose a document. All five are fixed; each is covered by a test that was
confirmed to fail before its fix.

### Fixed
- **Closing a document whose save had failed no longer discards it silently.**
  If saving hit a conflict with another tab — or was blocked, erroring or still
  in flight — closing that document asked nothing, saved nothing and dropped
  the text. Only the ordinary "editing" state prompted. Every unsaved state now
  prompts, and choosing Save keeps the document open unless the write actually
  committed.
- **An older save no longer deletes newer unsaved work.** When a slow save
  finished after the user had typed more and switched away, its cleanup removed
  the newer draft it had never written. The same applied to renaming. Only the
  content that actually reached storage is retired now.
- **A conflict with another tab is no longer forgotten by switching away and
  back.** Once the app had refused to overwrite another window's work, leaving
  the document and returning re-based the draft onto that window's version — and
  the next save overwrote it with no warning. An unsaved draft now remembers the
  version it was written against.
- **A host page embedding two editors no longer crosses their messages.** Events
  and replies from one iframe could resolve calls made to another.
- **`openDocument` waits for the document to actually open.** The embed's host
  API reported success immediately, before the switch had finished, and a
  failure part-way through was reported as success.

### Testing
- Five new regression tests, each mutation-tested.
- **Two of the three data-loss sequences are now reproduced in a real browser**
  (`bun run e2e:dataloss`): two real tabs, real IndexedDB, real autosave timing,
  driven through the actual menus and library list. Against a deliberately
  reverted build the conflicted draft really does overwrite the other tab's text
  on disk, and closing really does happen without asking — so the fixes are
  measured, not just reasoned about. The third (an older save deleting a newer
  draft) stays unit-tested: reproducing it needs a storage call held open from
  outside the page, which would test the injection rather than the app.
- **An existing test was found unable to fail** and is repaired: the check that
  the embed client ignores messages from a foreign origin used the wrong
  protocol name, so its message was rejected before origin was ever considered.
  With both guards deleted it still passed. It now varies only the origin and
  is paired with a positive control proving the same message gets through when
  it should.

## [1.76.0]

### Fixed
- **Broken `[[wiki links]]` now look broken.** A link pointing at a document that
  does not exist rendered exactly like one that works, so the only way to find a
  broken link was to click it. Unresolved links are drawn dashed and muted in
  both panes — dashed rather than red, because writing a link before its target
  exists is a normal way to take notes, not a mistake.
- **The welcome document's title follows its own heading.** Editing its `# H1`
  renamed nothing, alone among every document in the app, because seeding it
  recorded the name as if a person had typed it. Renaming it by hand still pins
  the name, as everywhere else.
- **A toast no longer lands on the status bar**, which is where the save state
  and the fidelity warning live.
- **Exported and printed documents no longer clip long lines and wide tables.**
  The export stylesheet relied on horizontal scrolling, which paper does not
  have, so a long URL, hash or base64 fragment ran off the page.
- **Small controls a finger has to hit.** The scroll-sync toggle in the pane
  header and the "Edit source" chip on a diagram both sat under the 24px minimum
  on a phone; the visible controls are unchanged, the areas you can hit are not.
- **The document title in the menu bar no longer clips tall accents** (Å, Ą) or
  descenders.
- **The second pane's header stops wasting 44px on a phone.** That space exists
  to clear the workspace button, which sits over exactly one of the two headers.

### Changed
- The toast close button's hit area is padded to the 24px accessibility minimum.
  It still looks the same and still straddles the toast's corner, which is
  deliberate.

### Testing
- A new browser suite (`bun run e2e:deep`) opens the six surfaces nothing else
  opened: Settings, Version history, the bottom panel, the About and Help pages,
  the guided tour and the Outline tab. Each is opened, proved to have rendered
  something real, and proved not to have logged a console error — which makes it
  a regression net for the rest of the app, not a screenshot.
- Breakpoints now assert five real layout switches rather than two, including
  the two that key off an element's own measured width rather than the window's
  (the toolbar's compaction and the cards board's column count). Those are
  driven by narrowing the editor inside a wide window, because resizing the
  window cannot tell a correct implementation from a broken one.
- The count of undersized touch targets is an assertion instead of a printed
  number. Writing it found the one remaining offender, which is fixed above.

## [1.75.0]

### Fixed
- **A resize drag can no longer outlive the pointer that started it.** Dragging
  the split divider or the workspace panel's edge and having the browser take
  the gesture back — which is the *normal* outcome on a phone, where the
  separator is a 4px strip the browser reclaims as a page scroll — left the app
  in a state where no text anywhere could be selected, and the divider then
  followed any later pointer. Both separators are also operable from the
  keyboard now (arrows, Home/End) and have a finger-sized target on touch.
- **The bottom panel no longer clips the bottom of the app.** On a short window
  it could push the panel and the status bar off the screen instead of sharing
  space with the editor. It now declines to open when there is genuinely no
  room, and says so. Opening and closing it animates rather than jumping.
- **Split-view scrolling keeps up around every kind of heading.** Headings
  written with an underline (`Title` / `=====`), headings inside a quote and
  headings inside a list were invisible to the side that keeps the two panes
  aligned, so scrolling drifted around them. A `#` inside an indented code block
  was counted as a heading, too.
- **The workspace panel follows the window.** Make the window smaller after
  widening the panel and the panel stayed wide, leaving a sliver of editor
  beside it until you dragged it back.
- **"Reading width" does something.** Narrow / Medium / Wide were fixed pixel
  widths applied to a pane that was usually narrower than all of them, so in the
  normal side-by-side layout all four settings were identical. They are measured
  in characters now, so they bind — and they follow your font size, which is
  what a reading measure should do.
- **Find & Replace tick marks follow your edits.** The marks on the scrollbar
  froze wherever they were first drawn; typing above them left them pointing at
  the wrong places until you retyped the search.
- **The active pane is visible again.** The pane label was meant to change
  colour when you clicked into it and never had — a 6px dot was doing the whole
  job.
- **Leaving Focus mode fades back in** instead of snapping.
- **Switching theme no longer stutters.** Part of the page faded while the rest
  changed instantly; the switch is now a single clean step.
- **Long document and folder names can be read.** Names too long for the library
  were cut off with no way to see the rest.

### Accessibility
- **Reduced motion is honoured by the relationship map.** Opening it animated
  the whole graph spreading out from a ring regardless of the system setting.
  With reduced motion on it now appears already settled. The app's stylesheet
  had claimed this was handled; it was not.

## [1.74.1]

### Fixed
- **The fidelity warning stopped crying wolf.** It counted three things that
  survive a round-trip intact: underline, subscript and superscript in **Clean**
  mode (they are written as `<u>`/`<sub>`/`<sup>` by rules both sync modes get —
  only the `<span style="…">` carrier is Styled-only), and an image's width and
  height (the `sizedImage` rule serializes a sized image as an `<img … width>`
  tag precisely so the size survives). The shipped Welcome document carries one
  sized logo, so every new user was greeted by an amber "1 other not in MD"
  about formatting that was never at risk. Same lesson as the residual list one
  release earlier: a warning that flags our own renderer's output is worse than
  no warning.

### Documentation
- **The two changelogs now agree about what 1.74.0 was.** The root entry covered
  only the second half of the release; the composition/IME data-loss work, the
  unload stash, the visible save-failure states, the file-drop import and the
  generation guards were recorded only in the app's own Changelog document. Both
  halves are now in both places.
- **Indent, alignment and Clean-vs-Styled are documented as they behave.** Help
  said "nest by indenting" and left the rest to be discovered: indent nests a
  list item (checklists included) and does nothing on a paragraph, because
  Markdown has no paragraph indent. Text alignment is the one formatting feature
  with no Markdown *and* no inline-HTML carrier — the toolbar buttons, the
  Format ▸ Align submenu, the shortcut lists, Help, the README and
  `features.md` §6 now all say so instead of leaving the fidelity badge to break
  the news afterwards. And underline, super/subscript, strikethrough and image
  sizing survive **both** sync modes; only colour, highlight and font family are
  Styled-only. `clean-vs-styled.test.js` pins all three claims.
- Shortcut groups can carry a scope note (`ShortcutGroup.note`), rendered on the
  Help page and in the shortcuts dialog from the same single source.
- The status bar's fidelity tooltip, and the residuals dialog, say what they mean
  in plain language — including the residual list's own blind spot: elements
  blocked for safety are removed before the check runs, so they never appear in
  it.
- `integration-guide.md` and `features.md` document `allowed_origin` and how the
  shipped embed resolves who may drive it; `import_url` is described as
  pre-filling, never fetching. `contributing.md` records the verification gate
  that actually runs (both builds, e2e, the doc-anchor script) and the
  mutation-testing rule.
- The in-app Welcome and Changelog documents, `docs/README.md`,
  `docs/v1-to-current-changelog.md` (extended to 1.74.0, and the data-loss
  defence renumbered from four layers to six) and `docs/codebase-tour.md` were
  brought up to date.

## [1.74.0]

### Fixed
- **Dictated and IME-composed text is not destroyed by the other pane.** Windows
  Voice dictation, and any IME, streams text through a composition; projecting
  the other pane into a live composition aborts it and drops what was streamed.
  Four separate paths did exactly that — a projection for the pane being
  dictated into, a composition left permanently "live" by an undo, a document
  switch that hydrated over the composition instead of committing it, and a
  formatting chord dispatched mid-utterance. All four are fixed and measured
  against a real composition driven through the browser, not a stand-in flag.
- **Reloading the page no longer loses the last few seconds.** Saving to the
  browser's database cannot finish while a page is being torn down, so typing a
  sentence and reloading immediately left it on neither pane nor disk. The
  editor now also writes a synchronous copy as you leave — on `pagehide` too,
  because iOS Safari never fires the other event — and adopts it on next start.
- **A failing save says that it is failing.** For most of each retry cycle the
  status bar read "Unsaved changes" — the reassuring message — while every save
  was failing; and the terminal refusal to overwrite a document with an empty
  editor had no message at all. Both now say what is happening, for as long as
  it is true.
- **Dropping a file on the editor imports it.** There was no drop handler at
  all, so the browser's default took over: the tab navigated to the file, and
  everything typed since the last autosave went with it — the one gesture that
  leaves no draft, no undo and no snapshot.
- **A document switch that lands mid-operation can no longer write into the
  wrong document.** Every asynchronous path that ends by hydrating the editor
  now claims and re-checks a generation, so a slow read for an abandoned switch
  cannot settle over the document you moved on to.
- **Quick-capturing a card no longer discards what you were typing.** Taking a
  note from the Cards board left the open document without saying goodbye, so
  anything typed in the previous few seconds was gone — not on disk, not in the
  draft cache, not in undo. The same gap existed when a host app added documents
  through the embed API.
- **⇧+paste inverts the "keep formatting" preference, as documented.** It never
  could: the browser's paste event does not carry the Shift key at all, so the
  modifier was read as "not pressed" every time.
- **Read-only documents are read-only in the table and link bubble menus.** Both
  still edited the document — hiding the toolbar and blocking typing does not
  reach a command run from a floating menu.
- **The editor starts when the browser blocks site data.** In Safari's private
  mode, with cookies blocked, and in some in-app webviews the app did not load at
  all: the check written to detect missing storage was itself the thing that
  threw. Preferences degrade to defaults; the editor runs.
- **An iframe embed can receive messages from the page that hosts it.** It never
  could — it was told to trust its own address rather than its host's, so every
  host command was ignored. It now trusts the page that framed it (or the origins
  you name), and it will not talk to anyone else.
- **Six documented keyboard shortcuts work in the rich pane.** ⌘⇧X, ⌘⇧1–6, ⌘⇧0
  and ⌘]/⌘[ did nothing there, and ⌘⇧9 inserted a task list instead of a
  blockquote — so the same shortcut did two different things depending on which
  pane you were in, while the Help page advertised one.
- **Right-click ▸ Insert ▸ Image / Formula / Inline math ask for a value.** All
  three silently did nothing in the rich pane, despite the promising ellipsis.
- **Clear formatting works from the Edit menu and the right-click menu in the
  markdown pane**, where it used to be a no-op while the identically named item
  one menu over worked.
- **Indent, outdent and justify work in the markdown pane**, as does clearing a
  text or highlight colour.
- **The relationship map keeps its filters and its JSON export on a phone.** Both
  vanished below 640px — and the export has no other home. The header wraps now.
- **Library search finds what you just typed, and stops finding what you just
  deleted.** It could serve the previous version of a note until some document
  was added, removed or renamed.
- **A conversion error can no longer freeze one pane.** If converting between the
  panes threw, the sync recorded that they agreed and stopped mirroring for the
  rest of the session, silently.
- **Deleting a document's version history actually deletes it.** It cleared the
  in-memory copy and left the stored snapshots in place.
- The **Cards checklist button** is a button, so it is reachable by keyboard and
  announced by a screen reader.
- **Strikethrough survives.** Striking text in the rich pane — the toolbar
  button, ⌘⇧X, or Format ▸ Strikethrough — was silently dropped the moment the
  two panes synced, and lost on export. The markdown never carried it, and
  because strikethrough is native markdown nothing warned you.
- **Indent works on task lists, and stops damaging paragraphs.** Indent did
  nothing at all inside a checklist. In the markdown pane it indented any line,
  so two presses on a paragraph silently turned it into a code block; it now
  applies where indentation means something — list nesting, and inside fenced
  code — matching what the rich pane already did.
- **Every keyboard shortcut works after a page reload.** ⌘F, ⌘⇧D, ⌘⇧K and ⌘⇧G
  all did nothing once the page had been reloaded — and clicking into the editor
  first did not help. Introduced by an earlier performance change in this same
  release and caught before it shipped.
- The Welcome document and the shortcut reference now name **⌥⌘F** for Find &
  Replace. ⌘H is documented too, but macOS takes it before the page sees it.

### Security
- **Imported and pasted HTML is sanitised more thoroughly.** `srcset`, `poster`
  and `background` were not checked for dangerous URLs, and inline `style` was
  passed through whole — so a crafted document could carry a script URL or make
  the page fetch a remote resource. Sizing styles still survive, so tables and
  images keep their layout.
- **The embed no longer defaults to talking to any origin.** The host client
  addressed the editor with a wildcard in both directions; it now derives the
  editor's address from the iframe it was handed.

### Internal
- A full-repo sweep by defect class, and the test suite it produced: 1066 unit
  tests across 89 files (up from ~900), covering the IndexedDB persistence layer,
  the snapshot store's real database path, the Select… engine, the link index's
  hook, the markdown engine, and four other modules that had no tests at all.
  Every guard was mutation-tested; where a guard genuinely cannot be observed,
  that is stated in place rather than covered by a test that passes either way.
- The browser campaign gained a **self-test**: its markdown-pane reader was wrong
  twice — once reading 1.6% of a long document, once counting the same line
  several times — so it is now measured against a document whose every line is
  known. New suites drive the two shipped artefacts nothing had ever loaded: the
  published stylesheet on a page that already has its own styles, and the embed's
  host bridge from a genuine second origin.
- 89 stale line-number references in the documentation were repaired and are now
  checked by the test suite.

## [1.73.0]

### Changed
- **The two panes keep up with you.** The other pane used to update only once
  you stopped typing, and how long it waited was decided by how big the document
  was — up to nearly a second on a long note, and during continuous typing it
  never updated at all. Now it advances *while* you type, on delays derived from
  what a projection measurably costs on your device rather than from the
  document's length. Measured on a throttled machine, the mirror is 2.4× faster
  on a small note, 11× on a medium one and 2.8× on a 50KB one, with the editor
  blocking the main thread 45–70% less at every size; typing latency improved
  too. Nothing else about the sync changed — same document, same undo, same
  IME/dictation guards.

### Fixed
- Formatting commands now act on the selection you can see. A ⌘B pressed
  immediately after selecting with Shift+Arrow could run against the previous
  selection — the browser reports selection changes asynchronously — so it set a
  formatting mark at the caret instead of bolding the selected text, and looked
  like nothing happened.
- The Memory & undo history panel's heap reading and Version history's relative
  timestamps update while you watch them, instead of freezing at the moment you
  opened the panel.
- Closing a tab or deleting a document no longer leaves the editor thinking a
  sync is pending. It could cause the next document switch to overwrite live
  rich-pane edits with a stale markdown pane, losing the edit and stripping
  inline styles in clean mode.

## [1.72.0]

### Changed
- **The Cards board shows rendered markdown, not raw source.** A card face used
  to print flat grey text — a heading, a bold word and a bullet list all run
  together — so you could not tell the shape of a note without opening it. Now
  the face renders real structure (headings, lists, emphasis, links), and
  **opening a card shows it rendered** rather than handing you `##` and `**`: the
  editor is a Preview · Split · Write surface (remembered per browser), defaulting
  to a rendered preview on a phone and a source-beside-rendered split on a wide
  screen. The rendered side reuses the app's own markdown engine, so a card looks
  exactly like the main preview and updates live as you type. Full authoring is
  still one click away with "Open in editor"; the card save path is unchanged.

## [1.71.0]

### Added
- **The relationship map is a real workspace, not an overlay with a card on top.**
  Three docked regions — header, map, details rail — and nothing floats over the
  canvas. The rail is a right column on wide screens and a bottom sheet on narrow
  ones, and selecting a note on a phone opens it. Previously the inspector was
  pinned *over* the map while the camera framed content to the full canvas, so
  the map centred itself underneath the panel and the note you selected was the
  one you could no longer see.
- **The map names things.** Every note's label is placed by a solver that tries
  four positions and a compact form before giving up, so a crowded neighbour no
  longer silently costs a note its name. Folder clusters are drawn as containers
  with a legend chip, and the layout reserves room for the names, not just the
  dots.
- **Search and health filters on the map** — dim non-matches without disturbing
  the layout, and filter to unlinked notes or notes with broken links. The chips
  are the filter; the rail lists the actual notes behind each count.
- **See what an import dropped.** The status bar's residual count is a button
  now. It opens a grouped, plain-language list of what the source contained that
  the document model cannot represent — removed for safety, no place in the
  model, style not carried over, attribute not kept — with the element, the
  reason and where it was. The detail was always recorded; it had nowhere to be
  read.
- **One share/embed link builder**, with an enable switch per URL parameter,
  used by both Tools ▸ Share / embed link and the Help page. Help previously
  carried a cut-down copy that could only produce `?import_url=` links, so the
  reference list documented far more than the widget beside it could build.
- **`docs/import-relay.md`** — a developer's guide to the one piece of server
  code in the product: what it does, the threat model control by control, how to
  test it, its current limitations, and a concrete hardening roadmap.

### Changed
- **Pasting into the rich pane keeps the formatting you copied**, and remembers
  that you want it to. It used to strip styles by default, and the "Styled
  paste" switch was a one-shot that disarmed itself after a single paste. Hold
  **Shift** while pasting to do the opposite once — the modifier inverts the
  preference instead of forcing styled, so it is useful whichever way you have
  it set. Pastes are still sanitized either way.
- **The published stylesheet no longer restyles the page that imports it.**
  Tailwind's preflight is a global reset — correct for the app and the iframe
  embed, which own their document, and wrong for a stylesheet a consumer imports
  into an application that already has styles. Measured in a browser, importing
  it dropped a host's `<h1>` from 32px/700 to 16px/400, removed its links'
  underlines, took 16px of margin and 40px of padding off its `<ul>`, and
  switched every element to `border-box`. The library build now confines the
  `base` layer to the editor's own subtrees, including the portalled menus,
  dialogs and toasts that mount outside it. Design tokens deliberately stay on
  `:root`, which is where those portalled surfaces read them from.
- **The map settles without stalling on a large library.** A profile of a
  153-note layout showed the physics costing nothing measurable while each
  rendered frame cost 44ms, almost all of it style and layout for the SVG.
  Above 60 notes the layout now advances several steps per rendered frame:
  108 rendered frames, a 5.6s settle and 3.9s of blocking became **35 frames,
  2.3s and 1.7s**. Smaller workspaces are unchanged.
- Reading the library — Cards, the map, backup and bulk export — now sees your
  most recent edit rather than the last saved copy.
- The link index updates incrementally on a content edit instead of re-reading
  the whole library on every autosave.

### Fixed
- **The shipped welcome document reported seven losses that never happened.**
  The import-fidelity analyser's list of what the schema supports had drifted
  behind the editor: it predated the theme-aware `<picture>` node, the callout
  node and image sizing, so a document that deliberately *demonstrates* all
  three announced them as content that "could not be mapped to the current
  schema". Every one of them round-trips. The count now reflects the schema the
  editor actually has — and, honestly, it still under-reports on the HTML/paste
  path, where blocked elements are removed before the analysis runs.
- **A pinned theme now actually pins the editor.** `?theme=light` on the embed
  themed the page and left the editor dark: everything that picked a theme in
  JavaScript read the *stored preference* rather than the theme in force.
- **Portalled surfaces are themed in a library mount.** Menus, dialogs, sheets,
  tooltips and toasts mount on `document.body`, outside the editor's themed
  wrapper, and rendered light under a dark editor.
- **⌥⌘F opens Find & Replace.** The documented shortcut opened plain Find, and
  since ⌘H is swallowed by macOS, Replace had no keyboard route there at all.
- **A full backup restores the library it captured.** Restore dropped tags,
  metadata and timestamps, and a note whose title began with a dot was silently
  omitted.
- **Content-loss paths found by a state audit**, each one a way for an edit to be
  lost or a document to be overwritten by another: a host adding documents
  destroying unsaved work in the open one, an import leaving the editor showing
  the previous document under the new identity, a blank draft written on tab
  close after the save path had refused it, and a save racing a delete.
- **The snapshot ring — the last line of recovery — could return the wrong
  version.** Its in-memory fallback numbered entries from 1, and IndexedDB's
  autoincrement also starts at 1, so the two could collide.
- The covering surfaces (map, Cards, interior pages) no longer tell a screen
  reader to ignore the controls they are designed to leave usable; the editor
  underneath is marked inert instead.
- **Nothing on the map is drawn over text**, re-measured across 3/12/25/40/153-note
  workspaces at desktop and phone widths and three zoom levels. A folder's own
  name could previously end up under a note's dot at low zoom; chips are painted
  last now. The earlier claim that every overlap class was zero was wrong, and is
  corrected in the docs rather than narrowed.

### Notes
- `DocumentRecord.residuals` is now typed `ResidualItem[]` rather than
  `unknown[]`; it always held those.
- No data identifiers changed. See the 1.70.0 notes.

## [1.70.0]

### Changed
- **The product is now called Markdown Studio**, and will live at
  [markdownstudio.com](https://markdownstudio.com). Every user-visible surface
  reads the name from one constant; the browser tab, the installed-app manifest,
  the PWA manifest and the embed page — which cannot import it — are pinned to
  it by `src/__tests__/app-identity.test.js`, so a future rename cannot
  half-land.
- Documentation refreshed across the app and the repo: Help, About, the welcome
  and starter documents, README and `docs/`.

### Notes
- **Data identifiers deliberately did NOT change.** The `pf:` preference keys,
  the `perssonify-document` export envelope, the `perssonify-backup` archive
  name and the `perssonify-snapshots` database are on-disk contracts with every
  existing install; renaming them would orphan people's documents. The npm
  package stays `@perssonify/editor` for the same reason.

### Added
- A marketing kit in `marketing/` — short and long descriptions, feature list,
  audience pages, launch copy, FAQ (including the honest limitations) and a
  messaging guide.

## [1.69.0]

### Added
- **The relationship map got a real inspector.** Selecting a note now shows its folder,
  its headings, and — the point of a graph — *which* notes it links out to and which
  link in, not just how many. Click a heading to open the document at that point; click
  a linked note to move the map's selection to it, or its arrow to open it.

### Fixed
- **A blinking cursor sat in the library on load.** Creating a folder programmatically
  (first-run seeding, archive import) reused the "user just made this folder" signal, so
  the tree opened a focused rename box on a folder nobody had created. Auto-naming is
  now opt-in, which also fixes it for every archive import that contains folders.
- **The open document was invisible in the library.** The active row was `bg-card` —
  the exact colour of the panel behind it. It now has a coloured edge marker, a tinted
  row, and a semibold title, in both the folder tree and the search results.
- **Folder labels in the map overlapped their own contents.** The name now straddles the
  cluster's top border and the box widens to fit it, so a one-document folder no longer
  covers its own note.

### Changed
- The guided tour and Help describe the map inspector and the active-document marker.

## [1.68.0]

### Added
- **The first-run library is now three linked documents**, not one: **Welcome**, a
  **Changelog** to track changes to the app (clear it at each release), and **About
  Perssonify** — a deep dive into the four divisions — filed in a `Perssonify` folder.
  They link to each other with `[[wiki links]]`, so the relationship map opens on a
  real graph with a labelled folder cluster.
- **The map's detail panel lists the selected document's headings**, so a node answers
  "what is in this note?" rather than just "how many links does it have?".

### Changed
- **The map explains itself when nothing is linked yet.** A scatter of unconnected dots
  reads as broken; it now says what a link is, how to make one, and lists the notes as
  clickable chips.

## [1.67.0]

### Changed
- **The surface switcher is a three-way choice: Editor · Cards · Map.** Returning to
  the editor was previously "un-toggle whichever view you opened", which reads as an
  escape hatch rather than a destination. Editor is now its own option, mirrored as a
  radio group in the View menu. The shortcuts stay toggles — ⌘⇧K twice still returns —
  and choosing a layout (Markdown / Rich / Split) now returns to the editor too, since
  those panes are invisible under an overlay.
- **Cards: the composer starts in the note body.** The title field is still there above
  it, but "Take a note…" promises you can just start writing, and most quick captures
  never get an explicit title.

### Fixed
- **Cards were laid out in the wrong reading order.** CSS multi-column fills each column
  top-to-bottom, so a newest-first board put notes 1, 2, 3 *down* the first column and
  note 4 at the top of the second — the top row read 1, 4, 7, 10. The board now deals
  cards across the columns, so the top row is the newest notes, left to right.
- **Column count ignored the actual board width**, using the window's: with the workspace
  panel open, a 1280px window packed four columns into ~940px of board.
- **Multi-line note previews ran their lines together** — a four-item list previewed as
  "milkeggsbreadcoffee" and a three-line note as "line1line2line3".
- **Checklist notes printed their items twice** — once as a prose blob, then again as
  the tick-boxes underneath.

## [1.66.0]

### Changed
- **Cards and the relationship map are now one surface switcher.** They are peers —
  full-canvas views of the whole library — so they became a single exclusive
  selection with one control: a two-button group beside the layout switcher in the
  top bar. The same button opens and closes its view, and it stays visible while the
  view is open. Cards also gained the map's "Back to editor" button in place of a
  bare X.

### Fixed
- **Opening the relationship map while Cards was open did nothing visible.** The two
  views were independent booleans, so both mounted: two `aria-modal` dialogs at the
  same z-index with the map (and its running force simulation) hidden underneath
  Cards, sharing one ref so focus and Escape targeted whichever mounted last.

### Removed
- The **duplicate graph toggle in the status bar** — the same `Network` icon firing
  the same action as the top-bar button, from the opposite corner of the screen.
- The **graph JSON export from the status bar**; it now lives in the map's own
  header, where it is a map action rather than global chrome.

## [1.64.0]

### Added
- **Cards board** — a Google-Keep-style board over the whole library (View ▸ Cards,
  **⌘⇧K**): quick-capture composer with one-tap checklist mode, live checklists on
  every card, 9 note colours, pin-to-top, search, and plain-text (reduced-formatting)
  editing. Every card is an ordinary document.
- **Three.js / in-scene integration guide** (`docs/integration-threejs.md`).

### Fixed
- **⌘F typed the search query into the document.** The generated `Input`/`Textarea`
  primitives target React 19 (ref-as-prop) while the app runs React 18, which strips
  `ref` from function components — so Find never took focus. Also broke inline rename
  and prompt-dialog autofocus. Both are now `forwardRef`.
- **The bottom tray collapsed both editor panes to 0–2px** — the document vanished.
- **No keyboard shortcut worked until the user clicked inside the editor.**
- **Find & Replace had no working shortcut on macOS** (⌘H is Hide Application); added
  **⌥⌘F**.
- Split scroll-sync paired headings by index, so one fenced code block containing a
  `#` line mis-aligned the whole document (measured 216px of drift).
- Workspace resize handle sat over the rich pane as an invisible drag strip that
  snapped the library to 720px; the width clamp ignored the viewport (an 800px window
  could be left with a 40px editor).
- Full-viewport light flash on every cold load in dark mode (up to 895ms on a phone).
- The emoji `:` autocomplete never flipped above the caret and could grow the page.
- The Find & Replace panel could grow past the viewport with its buttons unreachable.
- The shipped welcome document reported **"94 residuals"** and **"0 links · 2 broken"** —
  the editor's own attributes were counted as data loss, and `[[wiki links]]` inside
  code spans were indexed as real (broken) links.
- Split pane header clipped its controls off-screen between 768–965px.
- Ads bar covered the entire status bar and the last 100px of the document on phones.
- Four search fields rendered below 16px, causing irreversible iOS/WebView auto-zoom.
- `prefers-reduced-motion` is now honored.
- SPA routes update `document.title`.

### Security
- The iframe embed applied `?readonly=`/`?ads=` with the **persisting** setters, so one
  embed permanently wrote those settings for the whole origin — including the
  standalone app. Now session-only.

## [1.63.0]

### Fixed
- The published package shipped **no CSS** (`./styles.css` pointed at a file the build
  never emitted) and **no TypeScript types**; `fitParent` was not forwarded by the
  integration wrapper, so the editor was `100dvh` inside a fixed-size host container.
  Added `files`/`sideEffects` and a parity test suite that fails the build on drift.

## [1.60.0]

### Changed
- Documentation refreshed for team handoff: rewrote `HANDOVER.md`, this changelog,
  and the top-level docs to match the shipped app; added the v1→current delta doc.
- Removed the dead `docNav` size-machine from `uiStore` (the live Workspace panel
  uses `docNavWidth`, which stays).

### Fixed
- `next-themes` declared as a `peerDependency` (it is externalized in the library
  build and imported by library code — it was only in `devDependencies`).

## [1.59.0]

### Changed
- **Knowledge graph is now a map-only relationship overlay.** It opens full-screen
  directly on the whole-workspace map (documents as nodes, `[[wiki links]]` as
  edges, folders as labeled clusters) with the active doc focused. Single-doc
  structure lives in the Workspace panel's Outline tab; the in-graph structure pane
  was removed.

### Added
- Graph **search** (dim non-matches, Enter focuses the match) and **orphan +
  broken-link health chips** with an off-by-default ghost-target overlay.

## [1.58.0]
### Added
- Segmented **Files / Outline** tabs in the Workspace panel (matching the
  MD/HTML/split control); touch-sized mobile ☰ menus and interior menus.

## [1.57.0]
### Removed
- The in-panel **Map tab** — the Workspace panel is **Files + Outline** only; the
  full-screen relationship overlay is the graph.

## [1.54.0 – 1.55.0]
### Changed
- **Unified Workspace panel** — one left-docked tabbed tray consolidating the former
  library sidebar and the document outline; drill-down ☰ menu on phones.

## [1.51.0 – 1.52.0]
### Fixed
- Bidirectional sync is **IME / voice-dictation aware** (composition guards) so
  dictated text isn't dropped.
- Audit round: export fidelity, save/dup/nav races, rename-ignored-by-export,
  import hardening.

## [1.48.0]
### Changed
- **Incremental link index** — content edits splice only the changed doc(s) instead
  of a full library re-read per autosave.

## [1.42.0 – 1.45.0]
### Added
- Admin-gated read-only **diagnostics console** tray tab.
- Library **right-click / long-press** row menu with per-doc export in any format.
- Read-only **active-heading tracker** and a live **Outline / table-of-contents**
  panel.

## [1.35.0 – 1.40.0]
### Added
- **Reading & typography** controls (font size, line height, reading width,
  spellcheck) + focus mode.
- **Interactive task lists** (`- [ ]` / `- [x]`) with round-trip and correct nesting.
- **Equation authoring dialog** (live KaTeX preview).
- **Callouts** (`> [!NOTE]`) and **collapsible details** blocks.
- **DOCX import** (lazy `mammoth` → HTML → ingest).

### Fixed
- Strikethrough restricted to double-tilde; sub/superscript round-trip as HTML.

## [1.30.0 – 1.32.3]
### Added
- **Share / embed link builder** (per-parameter switches).
- **Version history** — recoverable per-doc snapshot net (sidecar IndexedDB).

### Fixed
- **Four-layer data-loss defence**: blank-save backstop, live-canonical merge
  (stale-overwrite prevention), switch-generation guards (rapid-switch settle),
  recoverable snapshots. Switch-completion desync and multi-range selection
  (`drawSelection`) fixes.

### Security
- Antagonistic audit: relay XSS/SSRF, CSS-injection (`sanitizeCssColor`),
  prototype-pollution (`normalizeArchivePath`), DOMParser hardening.

## [1.21.0 – 1.29.0]
### Added
- **Case transforms** (UPPER/lower/Title, content-only aware) + format-via-Find/Replace.
- Optional **ads** behind a setting/param; **read-only mode**; `?view_mode=` /
  `?readonly=` / `?ads=` URL params; **encrypted-ZIP** password prompt.
- **Find/Replace redesign** — Find|Replace modes, scope/format filters, scrollbar
  match markers.
- **Bottom tray** (Document Links) + **status-bar redesign**; re-importable
  full-library backup with timestamped filenames.

### Fixed
- Content-aware (heading-anchored) scroll sync; images no longer clipped by rounded
  corners.

## [1.16.0 – 1.20.1]
### Added
- **Right-click context menu**, **heading anchor links** (`[[Doc#Heading]]`),
  graph folder clustering, System theme, inline diagram editing, theme-aware images.

### Fixed
- Mobile ☰ menu crash (Base UI #31) + app-shell overflow; doc titles derive from the
  first heading; wiki links no longer escaped in the Markdown pane.

## [1.9.0]
### Added
- **Menu bar** (File / Edit / Insert / View / Format / Tools / Help) replacing the
  tab bar; explorer drag-reorder; routed **/about**, **/help**, **/graph** pages and
  a first-run guided tour; resizable split.

## [1.5.0 – 1.8.1]
### Added
- **Import from URL** (Google Drive / GitHub / Dropbox / generic) via a hardened
  first-party Vercel relay, with preview/selection and `?import_url=` links.
- **Official iframe embed** build + `postMessage` host bridge (`setMode`/`setAccent`/
  `openDocument`/`addDocuments`/`updateDocument`/`appendToDocument`, chrome control,
  transparent background).
- DOCX/PDF export, **YAML front matter**, full-text search, **offline (PWA)** support,
  idle autosave + lazy sync.

### Security
- Import relay forces `application/octet-stream` + attachment + locked CSP, never
  reflects upstream `Content-Type`, requires same-origin `Sec-Fetch-Site`.

## [1.4.x] — Foundation (initial import + hardening)

### Added
- **Markdown flavors** (CommonMark / GFM / Markdown Extra) with per-feature toggles,
  a **Settings** panel, and a per-instance `marked` build.
- **LaTeX math** (KaTeX, round-trip), **Mermaid** diagrams, **ABC** music notation,
  **emoji** shortcodes.
- **Theme / accent selector** (light/dark + accent palettes, saved by default).
- **Nested folders** in the file explorer (create/rename/delete/move, cycle-safe)
  with drag-and-drop; **archive import/export** (`.zip`/`.tar`).
- `LICENSE`, **CI workflow**, coverage tooling, `CLAUDE.md`.

### Fixed
- **Background-color / highlight** round-trip (canonicalized on a `textStyle`
  `backgroundColor` attribute).
- **Table-cell rich formatting** round-trip (the per-cell converter had relied on an
  unset `window.TurndownService` global).
- All 34 `tsc --noEmit` type errors — the gate is green and CI-enforced.

### Security
- Ingest/paste sanitizers strip `on*` handlers and `javascript:` / non-image `data:`
  URLs.
- iframe host bridge `allowedOrigins` defaults to deny (`[]`) — embedders opt in.

### Changed
- `marked` configured per-instance (not a global singleton) so flavor toggles apply
  at runtime.
- Removed dead code (`useDocumentStore.ts`, committed `archive/*.zip`); moved
  `shadcn`/`typescript`/`@types/node` to devDependencies.

### Baseline (initial import, `9c331d1`)
- Dual-pane editing (CodeMirror 6 + TipTap/ProseMirror, ProseMirror JSON canonical),
  view modes, tables, Find & Replace, Clean vs Styled sync, multi-document management,
  auto-save to IndexedDB, Markdown/HTML/JSON import-export, Copy as Prompt, wiki links,
  backlinks, knowledge graph, embed API. See
  [`docs/v1-to-current-changelog.md`](docs/v1-to-current-changelog.md) for the baseline
  detail.

---

## Known limitations
- Emoji collapses to its unicode glyph and footnotes are display-only when edited
  through the rich pane (no dedicated round-trip nodes yet). See
  [`docs/gotchas.md`](docs/gotchas.md).
- No live cross-tab sync — after another tab saves, this tab parks a terminal
  `"conflict"` save status until a fresh edit (no `BroadcastChannel` invalidation yet).
- Heading-anchor wiki links resolve by normalized heading text; auto-updating them on
  heading rename is a tracked follow-up.
