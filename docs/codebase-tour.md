# Codebase Tour — The Map

> A guided directory map plus a "where does X live?" lookup. For *what each thing does*, jump to [features.md](features.md) or [architecture.md](architecture.md).

## Directory tree

```
markdown-studio/
├── index.html                  # App HTML entry — mounts #root, loads src/main.tsx; inline pre-paint theme + boot watchdog
├── embed.html                  # iframe-embed HTML entry → src/embed.tsx
├── package.json                # Deps + scripts (dev/build/preview all point at the .ts vite configs)
├── bun.lock                    # Bun lockfile — this is the canonical package manager (Bun 1.4.0, --frozen-lockfile)
├── vite.config.ts              # LIBRARY build (dist/) — 4 entry points; externals derived from package.json
├── vite.app.config.ts          # APP build (dist-app/) — chunk grouping (vite.chunks.ts) + PWA service worker
├── vite.embed.config.ts        # iframe EMBED build (dist-embed/)
├── build/                      # externals.mjs (what the library leaves to the consumer), scope-css.mjs (library stylesheet scoping)
├── scripts/                    # doc-anchors.mjs, strip-sourcemaps.mjs, third-party-licenses.mjs
├── vitest.config.js            # Test config (jsdom, globals; coverage over all of src)
├── eslint.config.js            # `bun run lint` — typescript-eslint + React hook rules
├── tsconfig.json               # TS strict, "@/*" → src/*, jsx: react-jsx
├── components.json             # shadcn/ui config (style: base-mira, lucide icons)
├── vercel.json                 # Deploy: Bun build + sourcemap strip, dist-app/, SPA rewrite (all but /api/, /assets/, /.well-known/), security headers
├── api/import.js               # The only serverless function — same-origin, opt-in import relay (CORS fallback)
├── public/                     # Favicons, PWA manifest, sw-recover.js, third-party-licenses.txt, .well-known/security.txt
│
└── src/
    ├── main.tsx                # App bootstrap: ThemeProvider + <App/>, local error capture, update prompt; opt-in [DIAG] boot logs
    ├── App.tsx                 # Shell: ErrorBoundary + EditorHeader + PerssonifyEditor; routing, URL params
    ├── embed.tsx               # iframe-embed shell: reads the src query string, resolves allowed origins
    ├── index.tsx               # LIBRARY entry — public exports (@perssonify/editor)
    ├── PerssonifyEditor.tsx    # ⭐ Main orchestrator (~3,000 lines) — start reading here
    ├── EditorHeader.tsx        # Top nav bar
    ├── constants.ts            # MODES, debounce/autosave timings, storage keys, default doc
    ├── styles.css              # Global styles (Tailwind v4)
    │
    ├── engine/                 # Markdown ⇄ HTML ⇄ PM-JSON conversion + sync
    │   ├── useMarkdownEngine.ts   # createMarkdownEngine: marked + two Turndown instances (styled/clean); the hook wraps it
    │   ├── useSyncEngine.ts       # ⭐ bidirectional sync + hash guard (the landmine)
    │   ├── build-marked.ts        # per-instance marked: flavors, tasks, callouts, emoji, footnotes, maths, wiki links
    │   ├── wiki-link-marked.ts    # [[wiki links]] as a marked inline extension (never inside code)
    │   ├── preprocessor.ts        # before marked: front matter, `|`→`\|` inside [[Doc|Alias]] (GFM cells), opt-in curly syntax; findFencedCodeRanges; normalizeMarkdown
    │   ├── css-safety.ts          # allowlist for every value written into a style attribute
    │   ├── html-cleaner.ts        # paste sanitization, CSS→semantic tags
    │   ├── serialize-doc.ts       # headless canonical → MD/HTML (SERIALIZE_EXTENSIONS mirrors the live schema)
    │   └── turndown-rules.ts      # ~30 custom Turndown rules (tables, wiki links, task lists, strikethrough, footnotes…) + the escaper
    │
    ├── store/                  # State + persistence + indexing
    │   ├── documentStore.ts       # ⭐ LIVE Zustand doc store (docs, active doc, save status)
    │   ├── graph-metrics.ts       # pure orphan/broken-link/search helpers (graph)
    │   ├── uiStore.ts             # view mode, focus, sidebar/graph/find toggles, sync mode
    │   ├── editorStore.ts         # active formatting state, link index, backlinks, graph
    │   ├── document.ts            # three-layer DocumentRecord model + serialize
    │   ├── storage-adapter.ts     # StorageAdapter interface + createStorageAdapter()
    │   ├── idb-storage-adapter.ts # IndexedDB implementation (perssonify-docs)
    │   ├── link-index.ts          # wiki-link graph: forward/reverse/unresolved/contexts
    │   ├── ingest.ts              # format detection, sanitization, residual analysis
    │   ├── import-export.ts       # file I/O, clipboard, export Markdown/HTML/JSON
    │   ├── fidelity.ts            # serialization-loss analysis
    │   ├── document(Store) tests live in __tests__/
    │   └── index.ts              # store barrel export (used by library entry)
    │
    ├── ui/                     # React components (see features.md for each)
    │   ├── EditorPanes.tsx        # split layout + scroll sync + sync-mode pills
    │   ├── CodeMirrorPane.tsx     # CM6 markdown editor wrapper
    │   ├── TiptapPane.tsx         # Tiptap rich-text editor wrapper (+ extensions list)
    │   ├── Toolbar.tsx            # formatting buttons → dispatch()
    │   ├── WorkspacePanel.tsx     # left-docked Files / Outline tabs
    │   ├── CardsView.tsx          # cards board over the whole library (overlay)
    │   ├── StatusBar.tsx · ModeSwitcher.tsx · MenuBar.tsx
    │   ├── FindReplace.tsx        # Find & Replace panel (matching lives in formatting/find-engine.ts)
    │   ├── GraphView.tsx          # force-directed SVG graph (custom physics)
    │   ├── BacklinksPanel.tsx · LinkBubbleMenu.tsx · TableBubbleMenu.tsx · TableGridPicker.tsx
    │   ├── Dialogs.tsx · ConfirmDialog.tsx · Toast.tsx · ErrorBoundary.tsx
    │   ├── CodeBlockWithCopy.tsx · CodeBlockCopyButton.tsx · AdUnit.tsx (placeholder slots, development builds only)
    │   ├── Icons.tsx · search-colors.ts
    │   └── pages/                  # routed interior pages (About, Help, PageChrome)
    │
    ├── components/ui/         # shadcn/ui primitives — generated, rarely edited
    ├── data/                  # shortcuts.ts, starter-documents.ts, credits.ts
    │
    ├── extensions/            # Custom Tiptap nodes / marks
    │   ├── WikiLink.ts            # Link mark that preserves [[wiki]] attrs
    │   ├── MathNodes.tsx          # KaTeX inline/block math
    │   ├── Callout.ts             # > [!NOTE] admonitions
    │   ├── Details.ts             # collapsible <details>/<summary>
    │   ├── ThemeImage.tsx · SizedImage.ts · EmojiNode.ts · FrontmatterBlock.ts · TableCellAlign.ts
    │   ├── UnresolvedWikiLinks.ts # broken-link decoration (view-only)
    │   ├── BidiAuto.ts · cm-bidi.ts        # dir="auto" per block / per line (view-only)
    │   ├── AltGraphPassthrough.ts · ListKeymapNoTab.ts  # AltGr is typing, not a chord; Tab after a list
    │   ├── BlockId.ts             # ^block-id anchors — DEPRECATED export, registered in neither the editor nor the serializer
    │   ├── FieldBlock.ts          # :::fields … ::: cards — DEPRECATED export, not registered
    │   ├── TransclusionBlock.ts   # ![[…]] embeds — DEPRECATED export, not registered
    │   └── index.ts
    │
    ├── integration/          # Embeddable API
    │   ├── PerssonifyEditorIntegration.tsx  # the public component + EditorHandle
    │   ├── host-bridge.ts        # iframe postMessage bridge (protocol "perssonify")
    │   ├── embed-origins.ts      # who may drive the shipped embed (deploy allowlist, real framer, referrer)
    │   ├── deprecation.ts        # one development-only warning per deprecated prop/call
    │   ├── prompt-builder.ts     # "Copy as Prompt" — XML-tagged LLM context
    │   ├── associations.ts       # external (non-wiki) link edges
    │   └── index.ts
    │
    ├── formatting/           # Command routing + markdown editing helpers
    │   ├── useFormatDispatcher.ts # routes a command to the active pane
    │   ├── md-format-utils.ts     # mdWrapBy (every selection range), clearMdFormatting, isWrapped
    │   ├── md-table-ops.ts        # markdown pipe-table parse/edit/render (cellSeparators)
    │   ├── select-scope.ts        # Select… scopes + THE CommonMark fence tracker (fencedBlocks)
    │   ├── find-engine.ts         # Find & Replace: the one matcher (compileFindQuery, MatchSet)
    │   └── find-worker.ts         # runs a regex in a Web Worker with a 1.5 s timeout
    │
    ├── hooks/
    │   ├── useDocumentLifecycle.ts # ⭐ debounced sync, switch/close/new/delete, paste
    │   ├── useKeyboardShortcuts.ts # all Cmd/Ctrl bindings
    │   ├── useLinkIndex.ts         # builds/derives link index, wires link clicks
    │   ├── useDialogs.ts           # promise-based prompt()/confirm()
    │   ├── useActiveHeading.ts     # read-only active-heading tracker (Outline)
    │   └── use-mobile.ts           # 768px breakpoint
    │
    ├── theme/                # createTheme(isDark) + accent palettes (palette.ts) + useThemeMode.ts
    ├── pwa/sw-updates.ts     # service-worker update prompt ("Update ready — Reload"), hourly check
    ├── lib/utils.ts          # cn() classname helper (clsx + tailwind-merge)
    ├── utils/
    │   ├── index.ts             # quickHash + shared helpers
    │   ├── safe-storage.ts      # every localStorage access (blocked storage never crashes boot)
    │   ├── diagnostics.ts       # local, redacted error ring ("Copy diagnostics"); setErrorReporter
    │   ├── build-gates.ts       # development-only surfaces (ads, the Admin section)
    │   ├── alt-graph.ts         # isAltGraphInput — AltGr typing is never a shortcut
    │   └── diag.ts              # opt-in [DIAG] structured console logging
    │
    └── __tests__/            # Vitest suites (see workflows.md)
```

## "Where does X live?"

| Concern | Path |
|---------|------|
| App entry (browser) | [src/main.tsx](../src/main.tsx) → [src/App.tsx](../src/App.tsx) |
| Library entry (npm exports) | [src/index.tsx](../src/index.tsx) |
| The orchestrator that wires everything | [src/PerssonifyEditor.tsx](../src/PerssonifyEditor.tsx) |
| Bidirectional sync logic | [src/engine/useSyncEngine.ts](../src/engine/useSyncEngine.ts) |
| Markdown ⇄ HTML conversion config | [src/engine/useMarkdownEngine.ts](../src/engine/useMarkdownEngine.ts) |
| Document model / record shape | [src/store/document.ts](../src/store/document.ts) |
| App state (Zustand) | [src/store/documentStore.ts](../src/store/documentStore.ts), [uiStore.ts](../src/store/uiStore.ts), [editorStore.ts](../src/store/editorStore.ts) |
| Persistence / IndexedDB | [src/store/idb-storage-adapter.ts](../src/store/idb-storage-adapter.ts), [storage-adapter.ts](../src/store/storage-adapter.ts) |
| Wiki links / graph data | [src/store/link-index.ts](../src/store/link-index.ts) |
| Import / export / clipboard | [src/store/import-export.ts](../src/store/import-export.ts), [src/store/ingest.ts](../src/store/ingest.ts) |
| Keyboard shortcuts | [src/hooks/useKeyboardShortcuts.ts](../src/hooks/useKeyboardShortcuts.ts) |
| Toolbar buttons → commands | [src/ui/Toolbar.tsx](../src/ui/Toolbar.tsx) → [src/formatting/useFormatDispatcher.ts](../src/formatting/useFormatDispatcher.ts) |
| Custom Tiptap nodes | [src/extensions/](../src/extensions/) |
| Embedding / iframe API | [src/integration/](../src/integration/) |
| Shared types (document, link, fidelity) | colocated in their store/ files; no central types file |
| Env config | nothing at runtime; two optional **build-time** variables — `VITE_EMBED_ALLOWED_ORIGINS` (who may drive the iframe embed, [src/integration/embed-origins.ts](../src/integration/embed-origins.ts)) and `VITE_PERSSONIFY_DIAG` (turns on `[DIAG]` logs, [src/utils/diag.ts](../src/utils/diag.ts)) |
| Find & Replace matching | [src/formatting/find-engine.ts](../src/formatting/find-engine.ts), [find-worker.ts](../src/formatting/find-worker.ts) |
| Wiki-link rendering / resolution | [src/engine/wiki-link-marked.ts](../src/engine/wiki-link-marked.ts) / `createWikiResolver` in [src/store/link-index.ts](../src/store/link-index.ts) |
| Library stylesheet scoping | [build/scope-css.mjs](../build/scope-css.mjs) (library build only) |
| Build config (app vs library) | [vite.app.config.ts](../vite.app.config.ts) / [vite.config.ts](../vite.config.ts) |
| Tests | [src/__tests__/](../src/__tests__/) |
| UI primitives (buttons, dialogs) | [src/components/ui/](../src/components/ui/) (shadcn — generated) |
| Theme / dark mode | [src/theme/index.ts](../src/theme/index.ts), [src/theme/palette.ts](../src/theme/palette.ts) + `next-themes` in [src/main.tsx](../src/main.tsx) |
| Frozen data identifiers (`pf:`, `perssonify-*`) | [data-contracts.md](data-contracts.md) |
| Constants / timings | [src/constants.ts](../src/constants.ts) |

## Naming conventions unique to this repo

- **`.tsx` / `.ts` everywhere**, except the test suites and a handful of configs (`vitest.config.js`, `api/import.js`), which are deliberately `.js`. Test files *must* be `.js` — see [gotchas.md](gotchas.md).
- **`use*` files are React hooks** *or* engine hooks. `useMarkdownEngine` / `useSyncEngine` live under `engine/`, not `hooks/`, because they're conversion machinery, not lifecycle glue.
- **`*Store.ts` = Zustand store.** The live stores are `documentStore`, `uiStore`, `editorStore`, plus the `folders` store; other `store/*.ts` files are pure modules (e.g. `link-index`, `doc-outline`, `graph-metrics`, `archive`, `settings`, `snapshot-store`).
- **`md*` functions** (`mdWrapBy`, `mdParseTableAtCursor`, …) operate on raw CodeMirror markdown text; **Tiptap** commands operate on the rich-text canonical.
- **`[DIAG]` console logs** are intentional structured diagnostics ([src/utils/diag.ts](../src/utils/diag.ts)), not stray debug output — and off unless `?diag=1`, localStorage `perssonify-diag` = `1`, or a `VITE_PERSSONIFY_DIAG=true` build turns them on.
- **Integration props are prefixed `_onIntegration*`** where `PerssonifyEditorIntegration` passes its callbacks into the core editor, and the host-bridge events are `onChange`/`onLinkClick` etc. — see [src/integration/PerssonifyEditorIntegration.tsx](../src/integration/PerssonifyEditorIntegration.tsx) for the authoritative names.

## Files you'll touch often

- [src/PerssonifyEditor.tsx](../src/PerssonifyEditor.tsx) — anything cross-cutting (new action, new panel).
- [src/ui/Toolbar.tsx](../src/ui/Toolbar.tsx) + [src/formatting/useFormatDispatcher.ts](../src/formatting/useFormatDispatcher.ts) — new formatting commands.
- [src/hooks/useDocumentLifecycle.ts](../src/hooks/useDocumentLifecycle.ts) — document open/close/save behavior.
- [src/store/documentStore.ts](../src/store/documentStore.ts) — state and persistence behavior.

## Files you should almost never touch (and why)

- [src/engine/useSyncEngine.ts](../src/engine/useSyncEngine.ts) — the empty-deps invariant on `forceSyncMdToHtml` ([:190](../src/engine/useSyncEngine.ts#L190)) and its twin is load-bearing; a careless dependency reintroduces infinite sync loops. Read [gotchas.md](gotchas.md) before editing.
- [src/components/ui/](../src/components/ui/) — generated shadcn primitives; regenerate via shadcn rather than hand-editing.
- [src/store/idb-storage-adapter.ts](../src/store/idb-storage-adapter.ts) `idbTransaction` internals — the await rules are subtle ([:200](../src/store/idb-storage-adapter.ts#L200)).
