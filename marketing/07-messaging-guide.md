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
2. **Your documents stay in your browser.** No account, no server that stores
   or reads them, no analytics, and it works offline after the first visit.
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
| "Your documents stay in your browser" / "No server stores or reads your documents" | No backend stores or reads documents; they live in IndexedDB in the browser. The only server code is the URL-import relay, used only with the user's consent, which fetches a link and passes the file straight back without keeping it |
| "No analytics or tracking" | There is no analytics, tracking or telemetry code; error diagnostics stay on the device until the user copies them |
| "Works offline" | The service worker caches the whole app on the first online visit, installed or not — tested in CI. Import from URL and images hosted elsewhere still need a connection |
| "Everything round-trips" | Math, Mermaid, tables, task lists, callouts, footnotes, sized and theme-aware images all have serializer coverage, pinned by tests |
| "Hard to lose work" | Autosave, blank-save backstop, per-document undo, snapshot version history, multi-tab conflict detection, a persistent-storage request and a backup reminder |
| "Export anywhere" | Markdown, HTML, DOCX, PDF, JSON per document; full-library ZIP that re-imports intact |
| "Embeddable" | React component and iframe embed with a postMessage bridge; pluggable storage |

## Claims you must not make

- Real-time collaboration, comments, presence, sharing a live document
- Cloud sync, cross-device continuity, "access anywhere"
- AI writing, summarising or autocomplete
- Encryption of stored documents (they are stored in ordinary browser storage)
- Absolutes about the network: "your data never leaves your device", "nothing
  leaves your browser", "nothing is uploaded", "nothing you write is uploaded",
  "runs entirely in your browser", "100% client-side", "no network calls",
  "never phones home". Importing from a URL can go through our server when a
  site blocks browsers (the user is asked first), images in a document load
  from wherever they are hosted unless the user blocks them, and the app checks
  for updates. Say "your documents stay in your browser" or "no server stores or
  reads your documents" — both are precise, and they are the app's own wording.
- "Works offline" with no qualification in long copy — it needs one online
  visit first. (In a tagline, "works offline" is fine.)
- Permanence: "forever", "your work can never be lost". Browsers can clear a
  site's storage (Safari after seven days without a visit, unless the app is
  installed). The true claim is the protection: the app asks the browser to
  keep the library and reminds the user to back up.

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
