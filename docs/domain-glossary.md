# Domain Glossary

Plain-language definitions of the vocabulary you'll hit reading this codebase, each with a code pointer. Sorted alphabetically.

### Association
An **external** (non-wiki) link edge between documents, supplied by an embedding host rather than parsed from `[[…]]` content. Stored separately and merged into the graph. → [src/integration/associations.ts](../src/integration/associations.ts), `mergeGraphWithAssociations` ([:171](../src/integration/associations.ts#L171)). Contrast with [Wiki link](#wiki-link).

### Autosave
Trailing-timer save of the active document to IndexedDB, `AUTOSAVE_MS` (5000 ms, [src/constants.ts:63](../src/constants.ts#L63)). → `saveActiveDoc` ([src/store/documentStore.ts:348](../src/store/documentStore.ts#L348)), which resolves `true` only when the write committed. Three save statuses are terminal — autosave does not re-arm on them: `blocked` (a blank editor over stored content, or a document from a newer build), `conflict` (another tab saved newer content) and `full` (the browser's storage quota is exhausted).

### Backlink
The reverse of a wiki link: documents that link **to** the current one. Stored in the link index's `reverse` map. → [src/store/link-index.ts:250](../src/store/link-index.ts#L250), surfaced in [src/ui/BacklinksPanel.tsx](../src/ui/BacklinksPanel.tsx).

### Block ID
A per-block anchor (Markdown form `^abc123`; canonical form a `data-block-id` global attribute) that a transclusion or link could target. **Deprecated:** the `BlockId` extension is exported by the package but registered in neither the editor nor the serializer, and its ids do not survive a Markdown round trip — in the editor a trailing `^abc123` is plain text. → [src/extensions/BlockId.ts](../src/extensions/BlockId.ts).

### Canonical (canonical document)
The **source of truth**: the document as ProseMirror JSON held by Tiptap and persisted. Markdown and HTML are derived projections of it. → `DocumentRecord`'s `canonical` field ([src/store/document.ts:48](../src/store/document.ts#L48)); the central idea in [architecture.md](architecture.md). A stored canonical that does not fit this build's schema (content from a newer build) is opened read-only as a display copy, never loaded as an empty document.

### Clean mode / Styled mode
The two markdown serialization modes. **Clean** strips decorative inline styling for portable GFM; **Styled** preserves it as inline `<span style>`/`<div style>`. Selected by `useUIStore.syncMode` (default `"styled"`); the branch is where the sync engine reads the rich pane (`readRich`), where `convert` picks the converter ([src/engine/useSyncEngine.ts:70](../src/engine/useSyncEngine.ts#L70)). Implemented by `createMarkdownEngine` as two Turndown instances, `tdClean` and `tdInline` ([src/engine/useMarkdownEngine.ts:210](../src/engine/useMarkdownEngine.ts#L210)). A Cards edit always uses Styled, so a card never strips a note's colours.

### DIAG
The diagnostic logging convention: `[DIAG +Xms] [CATEGORY] action [data]` lines emitted to the console. Intentional, not stray debug output — and off unless turned on with `?diag=1`, localStorage `perssonify-diag` = `1`, or a `VITE_PERSSONIFY_DIAG=true` build. → [src/utils/diag.ts](../src/utils/diag.ts). The `[BOOT]` lines come from [src/main.tsx](../src/main.tsx). Not to be confused with the **diagnostics ring** ([src/utils/diagnostics.ts](../src/utils/diagnostics.ts)): a local, redacted record of the last 25 errors and failed saves — never document content — that the user can copy from the crash screen or the About page. The app sends it nowhere; a library host can subscribe with `setErrorReporter`.

### Echo loop
The failure mode this app is engineered to prevent: pane A updates pane B, which updates pane A, forever. Prevented by the [hash guard](#quickhash--hash-guard) + the `syncing` re-entrancy ref. → [src/engine/useSyncEngine.ts](../src/engine/useSyncEngine.ts).

### Fidelity / fidelity report
An analysis of what gets **lost** when canonical PM JSON is serialized to markdown: colour, highlight and font family in **Clean** mode, text alignment in **both** (nothing carries it), and block structure inside a table cell (a list, a second paragraph) or merged cells, which a GFM table cannot hold. Drives the StatusBar warning badge. Its mark sets must mirror the Turndown rule tables — classified from intuition instead, it both missed strikethrough (no rule, so destroyed silently) and warned about underline / sub / sup / image sizing, which have rules and survive. → [src/store/fidelity.ts](../src/store/fidelity.ts), `computeFidelity` ([:180](../src/store/fidelity.ts#L180)).

### Field block
A `:::fields … :::` fenced block holding structured key→value metadata, rendered as a card. **Deprecated:** the `FieldBlock` extension is exported by the package but registered in neither the editor nor the serializer, and the preprocessor pass that would produce it is off — in the editor the block is plain text. → [src/extensions/FieldBlock.ts](../src/extensions/FieldBlock.ts).

### Host bridge / editor client
The two halves of the iframe embedding API. `createHostBridge` runs **inside** the editor iframe; `createEditorClient` runs in the **parent** frame; they talk over `postMessage` with protocol `"perssonify"`. → [src/integration/host-bridge.ts](../src/integration/host-bridge.ts). The shipped embed decides which parent it trusts with `resolveEmbedAllowedOrigins` ([src/integration/embed-origins.ts](../src/integration/embed-origins.ts)).

### Ingest
The pipeline that turns raw input (typed/pasted/imported) into a document: detect format, sanitize, analyze residuals, produce canonical. → [src/store/ingest.ts](../src/store/ingest.ts), `ingest()` ([:488](../src/store/ingest.ts#L488)). Imports are converted to canonical headlessly — the ingest HTML parsed against the editor's schema (`captureIngestHeadless`), never by borrowing the live editor. See [data-pipeline.md](data-pipeline.md).

### Link index
The in-memory wiki-link graph: four maps `forward / reverse / unresolved / contexts`. Rebuilt from content (only the changed document after an edit; in full when documents are added, removed or renamed), never persisted. → `LinkIndex` ([src/store/link-index.ts:37](../src/store/link-index.ts#L37)).

### Manifest (`__manifest`)
The denormalized list of document summaries in the IndexedDB `meta` store, powering the workspace panel's library list without loading full docs. It is checked against the ids actually stored and rebuilt from the documents when it is missing, unreadable or out of step. → [database.md#the-meta-store](database.md#the-meta-store).

### Origin (origin layer)
Layer 1 of the document model: the **immutable** original input — `{ format, raw, source, timestamp, alternates }`. Provenance for everything downstream. JSON and backup exports keep the provenance but leave out `raw` and `alternates` — text the user may have deleted since. → `OriginRecord` ([src/store/document.ts:17](../src/store/document.ts#L17)).

### Paste Styled
A **persisted preference, on by default** (`pf:paste-styled`): pasting keeps the source's formatting. Holding **⇧ inverts it for one paste**. It was once a one-shot toggle that disarmed itself, which stopped making sense when styled became the default. → [src/ui/EditorPanes.tsx](../src/ui/EditorPanes.tsx).

### PM JSON (ProseMirror JSON)
The serialized form of a ProseMirror/Tiptap document — nodes and marks as nested JSON. This codebase's [canonical](#canonical-canonical-document) format.

### Preprocessor
The pass over the markdown source that runs before `marked`. As the engine calls it, it does three things: turns a leading YAML front-matter block into a placeholder the `FrontmatterBlock` node parses; rewrites the `|` inside `[[Doc|Alias]]` as `\|`, so a GFM table does not split the link across cells; and — only when a caller turns it on (off by default, with no switch in Settings) — renders the curly `{key=val}` syntax, where a group is formatted only if every key is known and every value validates. It masks code (fenced, indented and inline) first, so none of that touches code. It is **not** where wiki links, task lists, callouts or maths are rendered: those are `marked` extensions and renderer overrides in [build-marked.ts](../src/engine/build-marked.ts) and [wiki-link-marked.ts](../src/engine/wiki-link-marked.ts). The field-block, transclusion and block-id passes still exist but are off. The same file holds the engine's one fence detector, `findFencedCodeRanges` (CommonMark rules, blockquote-aware), shared with `normalizeMarkdown`, the whitespace pass over turndown's output. → [src/engine/preprocessor.ts](../src/engine/preprocessor.ts).

### Prefs (`__prefs`)
User preferences in the IndexedDB `meta` store: last active doc, sync mode, editor mode, the Markdown feature settings and the folder tree. (Most display preferences — theme, fonts, panel sizes — are `pf:` keys in localStorage instead.) → [database.md#the-meta-store](database.md#the-meta-store).

### quickHash / hash guard
A fast 32-bit string hash used to detect whether content actually changed before running a sync, short-circuiting [echo loops](#echo-loop). The rich side first compares its ProseMirror doc node by identity (`lastHtmlDoc`) and hashes only when that changed; each gate is committed only after its conversion succeeds. → `quickHash` [src/utils/index.ts:57](../src/utils/index.ts#L57); guards in `syncMdToHtml` and `syncHtmlToMd` ([src/engine/useSyncEngine.ts](../src/engine/useSyncEngine.ts)).

### Import relay
The app's **own** same-origin serverless function (`/api/import`) that fetches a URL server-side, used **only** as a fallback when a direct browser fetch is blocked by CORS — notably Google Drive, which sends no CORS headers to a browser — and **only after the user agrees** (asked once, remembered in `pf:import-relay`, changeable in Settings ▸ Privacy). It is the only server-side code in the product: it fetches only global-unicast addresses (checked after DNS resolution and on every redirect), caps bodies at 4,000,000 bytes, refuses cross-site browser requests and logs one line per request (the host, never the path or query). A script can still call it directly, so it is a bounded proxy rather than a closed one; rate limiting and spend alerts are deployment setup. → [api/import.js](../api/import.js), [import-relay.md](import-relay.md).

### Residuals (residuals layer)
Layer 3 of the document model: an array of content ingest **couldn't represent** in the canonical schema (blocked elements, unknown styles/attributes, HTML comments). Categorized by `analyzeHtml()`; typed `ResidualItem[]`, each carrying its type, element, attribute, reason and position. Surfaced as a **clickable count** in the status bar that opens a grouped, plain-language list — see [features.md#13c-import-fidelity--reading-the-residuals](features.md#13c-import-fidelity--reading-the-residuals). → [src/store/document.ts](../src/store/document.ts), [src/store/ingest.ts:238](../src/store/ingest.ts#L238), [src/ui/ResidualsDialog.tsx](../src/ui/ResidualsDialog.tsx).

### Storage adapter
The pluggable persistence interface (`list/get/save/delete/search/getPrefs/setPrefs`, plus an optional `clear` used by `clearLocalData`) with implementations for IndexedDB, window storage, localStorage, and in-memory. `get()` returns `null` only for a document that genuinely does not exist and throws `StorageReadError` for a read that failed, so the save path can fail closed. → `StorageAdapter` ([src/store/storage-adapter.ts:75](../src/store/storage-adapter.ts#L75)).

### Sync engine
The hook that keeps the markdown and rich-text panes in lockstep through HTML, guarded by hashing. → [src/engine/useSyncEngine.ts](../src/engine/useSyncEngine.ts). See [data-pipeline.md — Stage 3](data-pipeline.md#stage-3--bidirectional-sync-the-heart).

### Transclusion
Embedding another document (or one of its sections/blocks) inline via `![[Title]]` / `![[Title#Section]]` / `![[id#^block-id]]`, resolved recursively with circular references detected. **Deprecated:** the `TransclusionBlock` extension is exported by the package but registered in neither the editor nor the serializer — in the editor `![[Title]]` reads as `!` followed by an ordinary wiki link. → [src/extensions/TransclusionBlock.ts](../src/extensions/TransclusionBlock.ts).

### Turndown rule
A custom HTML→markdown serialization rule (~30 of them: tables, task lists, wiki links, footnotes, emoji, maths, strikethrough, underline/sub/sup, sized images, …). Turndown's core covers CommonMark only and this repo does not load `turndown-plugin-gfm`, so an element with **no** rule is silently reduced to its text. The same file installs the engine's escaper, which backslash-escapes literal text that would otherwise read back as markup. → [src/engine/turndown-rules.ts](../src/engine/turndown-rules.ts).

### Unresolved link
A `[[wiki link]]` whose target matches no existing document; tracked per-doc, shown as "broken" in the backlinks panel and the map, and marked in the rich pane by a view-only decoration (`UnresolvedWikiLinks`). → link index `unresolved` map, [src/store/link-index.ts:251](../src/store/link-index.ts#L251).

### Wiki link
A document-to-document link written `[[Title]]`, `[[Title|Display]]`, `[[Title#Heading]]` or `[[#Heading]]` (a heading in the current document), distinct from inline markdown links. Rendered by a marked inline extension (`wikiLinkExtension`, [src/engine/wiki-link-marked.ts](../src/engine/wiki-link-marked.ts)) as a link mark carrying `data-doc-link` / `data-anchor`, so it is never rendered inside code; indexed by `scanWikiLinks`. Resolved by the one resolver shared by the index, clicks and broken-link marking — the whole `docLink#anchor` as a title first, then an exact id, then an exact title (NFKC, case-insensitive, whitespace-normalised), never a partial match. Titles containing `|` or `]` cannot be linked. → `createWikiResolver` ([src/store/link-index.ts:193](../src/store/link-index.ts#L193)).
