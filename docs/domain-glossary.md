# Domain Glossary

Plain-language definitions of the vocabulary you'll hit reading this codebase, each with a code pointer. Sorted alphabetically.

### Association
An **external** (non-wiki) link edge between documents, supplied by an embedding host rather than parsed from `[[…]]` content. Stored separately and merged into the graph. → [src/integration/associations.ts](../src/integration/associations.ts), `mergeGraphWithAssociations` ([:171](../src/integration/associations.ts#L171)). Contrast with [Wiki link](#wiki-link).

### Autosave
Trailing-timer save of the active document to IndexedDB, `AUTOSAVE_MS = 5000` ([src/constants.ts:17](../src/constants.ts#L17)). → `saveActiveDoc` ([src/store/documentStore.ts:312](../src/store/documentStore.ts#L312)).

### Backlink
The reverse of a wiki link: documents that link **to** the current one. Stored in the link index's `reverse` map. → [src/store/link-index.ts:250](../src/store/link-index.ts#L250), surfaced in [src/ui/BacklinksPanel.tsx](../src/ui/BacklinksPanel.tsx).

### Block ID
A stable per-block anchor so a transclusion or link can target a single block. Markdown form `^abc123`; canonical form a `data-block-id` global attribute. → [src/extensions/BlockId.ts](../src/extensions/BlockId.ts).

### Canonical (canonical document)
The **source of truth**: the document as ProseMirror JSON held by Tiptap and persisted. Markdown and HTML are derived projections of it. → [src/store/document.ts:35](../src/store/document.ts#L35); the central idea in [architecture.md](architecture.md).

### Clean mode / Styled mode
The two markdown serialization modes. **Clean** strips decorative inline styling for portable GFM; **Styled** preserves it as inline `<span style>`/`<div style>`. Selected by `useUIStore.syncMode` (default `"styled"`); the branch is at [src/engine/useSyncEngine.ts:9](../src/engine/useSyncEngine.ts#L9). Implemented as two Turndown instances (`tdClean`/`tdInline`) in [src/engine/useMarkdownEngine.ts:194](../src/engine/useMarkdownEngine.ts#L194).

### DIAG
The diagnostic logging convention: `[DIAG +Xms] [CATEGORY] action [data]` lines emitted to the console. Intentional, not stray debug output. → [src/utils/diag.ts](../src/utils/diag.ts). The `[BOOT]` lines you see on load come from [src/main.tsx](../src/main.tsx).

### Echo loop
The failure mode this app is engineered to prevent: pane A updates pane B, which updates pane A, forever. Prevented by the [hash guard](#quickhash--hash-guard) + the `syncing` re-entrancy ref. → [src/engine/useSyncEngine.ts](../src/engine/useSyncEngine.ts).

### Fidelity / fidelity report
An analysis of what gets **lost** when canonical PM JSON is serialized to markdown: colour, highlight and font family in **Clean** mode, and text alignment in **both** (nothing carries it). Drives the StatusBar warning badge. Its mark sets must mirror the Turndown rule tables — classified from intuition instead, it both missed strikethrough (no rule, so destroyed silently) and warned about underline / sub / sup / image sizing, which have rules and survive. → [src/store/fidelity.ts](../src/store/fidelity.ts), `computeFidelity` ([:162](../src/store/fidelity.ts#L162)).

### Field block
A `:::fields … :::` fenced block holding structured key→value metadata, rendered as a card. Values auto-typed (date/number/boolean/text). → [src/extensions/FieldBlock.ts](../src/extensions/FieldBlock.ts).

### Host bridge / editor client
The two halves of the iframe embedding API. `createHostBridge` runs **inside** the editor iframe; `createEditorClient` runs in the **parent** frame; they talk over `postMessage` with protocol `"perssonify"`. → [src/integration/host-bridge.ts](../src/integration/host-bridge.ts).

### Ingest
The pipeline that turns raw input (typed/pasted/imported) into a document: detect format, sanitize, analyze residuals, produce canonical. → [src/store/ingest.ts](../src/store/ingest.ts), `ingest()` ([:488](../src/store/ingest.ts#L488)). See [data-pipeline.md](data-pipeline.md).

### Link index
The in-memory wiki-link graph: four maps `forward / reverse / unresolved / contexts`. Rebuilt from content, never persisted. → [src/store/link-index.ts:26](../src/store/link-index.ts#L26).

### Manifest (`__manifest`)
The denormalized list of document summaries in the IndexedDB `meta` store, powering the workspace panel's library list without loading full docs. → [database.md#the-meta-store](database.md#the-meta-store).

### Origin (origin layer)
Layer 1 of the document model: the **immutable** original input — `{ format, raw, source, timestamp, alternates }`. Provenance for everything downstream. → [src/store/document.ts:13](../src/store/document.ts#L13).

### Paste Styled
A **persisted preference, on by default** (`pf:paste-styled`): pasting keeps the source's formatting. Holding **⇧ inverts it for one paste**. It was once a one-shot toggle that disarmed itself, which stopped making sense when styled became the default. → [src/ui/EditorPanes.tsx](../src/ui/EditorPanes.tsx).

### PM JSON (ProseMirror JSON)
The serialized form of a ProseMirror/Tiptap document — nodes and marks as nested JSON. This codebase's [canonical](#canonical-canonical-document) format.

### Preprocessor
The markdown-side pass that rewrites custom syntax (task lists, curly-brace styles, and — when enabled — field blocks/transclusions/block IDs) into HTML before `marked` parses it. → [src/engine/preprocessor.ts](../src/engine/preprocessor.ts).

### Prefs (`__prefs`)
User preferences in the IndexedDB `meta` store: last active doc, sync mode, editor mode. → [database.md#the-meta-store](database.md#the-meta-store).

### quickHash / hash guard
A fast 32-bit string hash used to detect whether content actually changed before running a sync, short-circuiting [echo loops](#echo-loop). → `quickHash` [src/utils/index.ts:57](../src/utils/index.ts#L57); guards at [src/engine/useSyncEngine.ts:62](../src/engine/useSyncEngine.ts#L62)/[:124](../src/engine/useSyncEngine.ts#L124).

### Import relay
The app's **own** same-origin serverless function (`/api/import`) that fetches a URL server-side, used **only** as a fallback when a direct browser fetch is blocked by CORS — notably Google Drive, which sends no CORS headers to a browser. It is the only server-side code in the product, and it is deliberately not a general proxy: SSRF-hardened, first-party-only, port- and size-capped. → [api/import.js](../api/import.js), [import-relay.md](import-relay.md).

### Residuals (residuals layer)
Layer 3 of the document model: an array of content ingest **couldn't represent** in the canonical schema (blocked elements, unknown styles/attributes). Categorized by `analyzeHtml()`; typed `ResidualItem[]`, each carrying its type, element, attribute, reason and position. Surfaced as a **clickable count** in the status bar that opens a grouped, plain-language list — see [features.md#13c-import-fidelity--reading-the-residuals](features.md#13c-import-fidelity--reading-the-residuals). → [src/store/document.ts](../src/store/document.ts), [src/store/ingest.ts:238](../src/store/ingest.ts#L238), [src/ui/ResidualsDialog.tsx](../src/ui/ResidualsDialog.tsx).

### Storage adapter
The pluggable persistence interface (`list/get/save/delete/search/getPrefs/setPrefs`) with implementations for IndexedDB, window storage, localStorage, and in-memory. → [src/store/storage-adapter.ts:56](../src/store/storage-adapter.ts#L56).

### Sync engine
The hook that keeps the markdown and rich-text panes in lockstep through HTML, guarded by hashing. → [src/engine/useSyncEngine.ts](../src/engine/useSyncEngine.ts). See [data-pipeline.md#stage-3-bidirectional-sync](data-pipeline.md#stage-3-bidirectional-sync).

### Transclusion
Embedding another document (or one of its sections/blocks) inline via `![[Title]]` / `![[Title#Section]]` / `![[id#^block-id]]`. Resolves recursively and detects circular references. → [src/extensions/TransclusionBlock.ts](../src/extensions/TransclusionBlock.ts).

### Turndown rule
A custom HTML→markdown serialization rule (~30 of them: tables, task lists, wiki links, field blocks, transclusions, strikethrough, underline/sub/sup, sized images, …). Turndown's core covers CommonMark only and this repo does not load `turndown-plugin-gfm`, so an element with **no** rule is silently reduced to its text. → [src/engine/turndown-rules.ts](../src/engine/turndown-rules.ts).

### Unresolved link
A `[[wiki link]]` whose target matches no existing document; tracked per-doc and shown as "broken" in the backlinks panel. → link index `unresolved` map, [src/store/link-index.ts:251](../src/store/link-index.ts#L251).

### Wiki link
A document-to-document link written `[[Title]]` or `[[id|Display]]`, distinct from inline markdown links. Parsed by `scanWikiLinks` (regex `/\[\[([^\]]+)\]\]/g`) and resolved by `resolveTarget`. → [src/store/link-index.ts:236](../src/store/link-index.ts#L236).
