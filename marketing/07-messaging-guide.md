# Messaging guide

The rules that keep the copy consistent and true across properties.

---

## The name

**Markdown Studio.** Two words, both capitalised, always in full on first use.

- ✅ Markdown Studio
- ❌ MarkdownStudio · markdown studio · MD Studio · The Studio · Markdown Editor

After first use in a long piece, "the app" or "Studio" is acceptable in casual
copy. Never abbreviate it in a headline, a title tag or an app-store field.

**Attribution:** *Built by Perssonify Labs* — Labs specifically, not Perssonify
generally. On developer-facing pages the npm package `@perssonify/editor` may
appear; it's a coordinate, not a brand, and never belongs in consumer copy.

**Home:** markdownstudio.com

---

## The core message, in priority order

1. **Two panes, one document, always in sync.** The whole product in one line,
   understandable with no prior knowledge, visible in a single screenshot.
2. **It runs entirely in your browser.** No account, no server, nothing
   uploaded, works offline.
3. **Everything round-trips.** Math, diagrams, tables and callouts all return to
   clean Markdown — the reason to trust the rich pane.
4. **Notes link, and the links are visible.** Wiki links, backlinks, the map.
5. **Your work is hard to lose.** Autosave, undo history, version snapshots,
   blank-overwrite protection.

Lead with 1. Convert with 2. Everything else is support.

---

## Tone

Plain, specific, unhurried. The product is unusual enough that describing it
accurately is more persuasive than selling it.

**Do:**
- Name the concrete thing. "Tick a checkbox in the formatted pane and the
  Markdown updates" beats "seamless bidirectional editing experience".
- Use the reader's problem as the opening. Most people have felt the
  preview-tab friction.
- Admit the trade-offs. Local-only means device-only; saying so first is worth
  more than the sentence costs.

**Don't:**
- Use "revolutionary", "seamless", "powerful", "game-changing", "effortless".
- Claim AI features. There are none.
- Imply collaboration or cross-device sync. There is neither.
- Compare by name to Obsidian, Notion, Typora or iA Writer. Describe what this
  does; let the reader draw the comparison.

---

## Claims you can make, and the proof

| Claim | Why it's true |
| --- | --- |
| "Always in sync" | Both panes are views of one ProseMirror document; the Markdown is a projection of it |
| "Nothing is uploaded" | No backend for documents; storage is IndexedDB in the browser |
| "Works offline" | Service worker; installable as an app |
| "Everything round-trips" | Math, Mermaid, tables, task lists, callouts, footnotes, sized and theme-aware images all have serializer coverage, pinned by tests |
| "Hard to lose work" | Autosave, blank-save backstop, per-document undo, snapshot version history, multi-tab conflict detection |
| "Export anywhere" | Markdown, HTML, DOCX, PDF, JSON per document; full-library ZIP that re-imports intact |
| "Embeddable" | React component and iframe embed with a postMessage bridge; pluggable storage |

## Claims you must not make

- Real-time collaboration, comments, presence, sharing a live document
- Cloud sync, cross-device continuity, "access anywhere"
- AI writing, summarising or autocomplete
- Encryption of stored documents (they are stored in ordinary browser storage)
- "Your data never leaves your device" *if* the reader has used the URL importer
  — that feature fetches through a relay. Prefer "nothing you write is
  uploaded", which is precise.

---

## Words for the concepts

Use these consistently so the docs, the app and the marketing agree.

| Concept | Say | Not |
| --- | --- | --- |
| The two-pane layout | the Markdown pane / the rich-text pane | source pane, preview, WYSIWYG pane |
| The three surfaces | Editor, Cards, Map | views, tabs, modes |
| The graph | the relationship map | knowledge graph, graph view |
| `[[links]]` | wiki links | internal links, backlinks (that's the reverse) |
| The library panel | the workspace panel | sidebar, explorer |
| The note board | the Cards board | Keep view, kanban |
| Saved versions | version history | snapshots (internal term) |

---

## Screenshot guidance

The dual pane is the product, so every hero image should show both panes with
recognisable content — a heading, a table or list, and something rendered
(math or a diagram) so the round-trip claim is visible.

- Take matched **light and dark** pairs; the site can swap them by theme.
- Show the **relationship map with more than three notes** — a small graph reads
  as a demo, a real one reads as a product.
- Avoid lorem ipsum. Use content a reader would plausibly write.
- Don't crop out the second pane to make a screenshot fit. If it won't fit,
  choose a different image.
