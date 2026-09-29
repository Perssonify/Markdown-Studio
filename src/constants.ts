/**
 * Product identity. ONE source of truth — every user-visible occurrence of the
 * name reads from here.
 *
 * Static files that cannot import TypeScript (index.html, embed.html,
 * public/site.webmanifest, the PWA manifest in vite.app.config.ts) necessarily
 * repeat these strings; `src/__tests__/app-identity.test.js` asserts they still
 * agree, so a rename can't half-land again.
 *
 * DO NOT rename data identifiers alongside the product: the `pf:` localStorage
 * keys, the `perssonify-document` export envelope, the `perssonify-backup` zip
 * name, and the `perssonify-snapshots` IndexedDB database are ON-DISK contracts
 * with every existing install. Renaming them orphans people's documents.
 */
export const APP_NAME = "Markdown Studio";
export const APP_BRAND = "labs.perssonify";
/** Public home of the product. */
export const APP_DOMAIN = "markdownstudio.com";
export const APP_URL = `https://${APP_DOMAIN}`;
// Single source of truth: injected from package.json "version" via Vite
// `define` (see vite.config.ts / vite.app.config.ts). Falls back for tests.
declare const __APP_VERSION__: string;
export const VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.4.0";

export const MODES = {
  MD: "md",
  HTML: "html",
  SPLIT: "split",
} as const;

export const THEME_KEYS = {
  DARK: "dark",
  LIGHT: "light",
} as const;

/**
 * Cross-pane projection scheduling.
 *
 * The delays are derived at runtime from the MEASURED cost of recent
 * projections on the device in use (see `useDocumentLifecycle`), and clamped
 * here. Document length used to pick the delay directly (300 / 500 / 800ms by
 * size), which punished a large note on a fast machine and was too eager on a
 * slow one.
 *
 * - DELAY: how long after the last keystroke to wait before projecting.
 * - MAX_WAIT: the longest the other pane may lag while typing CONTINUES. The
 *   debounce used to be purely trailing, so during continuous typing the other
 *   pane never updated at all — it caught up only when you paused.
 */
export const SYNC_MIN_DELAY_MS = 120;
export const SYNC_MAX_DELAY_MS = 800;
export const SYNC_MIN_MAX_WAIT_MS = 250;
export const SYNC_MAX_MAX_WAIT_MS = 1200;
export const AUTOSAVE_MS = 5000;
/**
 * How long a pane may claim to be composing WITHOUT producing any input before
 * that claim stops being believed.
 *
 * Measured, not guessed: an undo dispatched into CodeMirror during a live IME
 * composition destroys the composition WITHOUT a `compositionend` event, so
 * `view.composing` stays true forever. Every consumer of `isComposing()` then
 * defers forever — the 120ms retry loop spins, no projection ever runs, and the
 * two panes are permanently out of step for the rest of the session. A stuck
 * flag must expire; a real composition never goes this long without input, and
 * a genuine long pause costs at most one re-projection.
 */
export const COMPOSITION_STALL_MS = 8000;
export const STORAGE_KEY = "perssonify-md-editor-content";
export const SYNC_MODE_KEY = "perssonify-md-editor-sync-mode";
// Toolbar width (its OWN width, not the window's) below which the full
// control set collapses to the essentials + expand chevron. The full set
// needs roughly this much room before it stops wrapping to a second row.
export const TOOLBAR_COMPACT_BP = 1080;

export const FONT_SIZE_MAP: Record<string, string> = {
  "1": "12px",
  "2": "14px",
  "3": "16px",
  "4": "20px",
  "5": "24px",
  "6": "32px",
};

export const DEFAULT_CONTENT = `<img src="/brand/markdown.webp" alt="Markdown Studio" width="84" />

# Markdown Studio

**Tomorrow's Advantage, Delivered Today.**

We build custom technology solutions for companies that need to move fast without breaking things: applications, AI integrations, and automation systems.

**Markdown Studio** is one of those tools — write **Markdown on the left**, see polished **rich text on the right**, always in sync and entirely in your browser. Nothing is uploaded and there is no account to make. Home: [markdownstudio.com](https://markdownstudio.com) · Built by [Perssonify](https://perssonify.com/).

> **New here?** Everything below is live and editable — change either pane and the other updates instantly. Open **Help** in the menu bar for the full guide, or **Help → Take a guided tour**.

**Your library already has two more documents**, linked from here with wiki links:
[[Changelog]] tracks what changes in this app, and [[About Perssonify]] is a deep
dive into the divisions behind it. Type \`[[\` anywhere to link documents together,
then open the **relationship map** (**⌘⇧G**, or *Map* in the top-right switcher) to
see the connections — the three documents below are already a small graph.

---

## Text formatting

**Bold**, *italic*, <u>underline</u>, ~~strikethrough~~, \`inline code\`,
H<sub>2</sub>O, E = mc<sup>2</sup>, and [links](https://perssonify.com).

Highlight: <span style="background-color: #fde68a">highlighted text</span> ·
Color: <span style="color: #e11d48">colored text</span>
*(flip the pill above to **Styled** to keep colors in Markdown)*

## Lists

Nested **unordered**:

- Fruit
  - Apple
  - Citrus
    - Orange
    - Lemon
- Vegetables

Nested **ordered**:

1. Setup
   1. Install
   2. Configure
2. Build
   1. Compile
   2. Bundle

Tasks:

- [x] Try the editor
- [ ] Ship something great

## Math (LaTeX)

Inline: Einstein's $E = mc^2$ and Pythagoras $a^2 + b^2 = c^2$.

$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$

$$\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}$$

$$A = \\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix} \\qquad \\det(A) = ad - bc$$

*Add your own with **Insert → Formula**. Double-click any rendered formula to edit it.*

## Diagrams (Mermaid)

Double-click the diagram below to edit its source, then press **Done**.

\`\`\`mermaid
flowchart TD
  A[Type Markdown] --> B{Sync engine}
  B -->|tokens| C[Rich preview]
  B -->|serialize| D[Markdown source]
  subgraph Live rendering
    C --> E[KaTeX math]
    C --> F[Mermaid diagrams]
    C --> G[ABC scores]
  end
  E --> H[(Saved locally)]
  F --> H
  G --> H
\`\`\`

## Music (ABC notation)

Chords, lyrics, and multi-note chords all render — double-click to edit the source.

\`\`\`abc
X:1
T:Twinkle, Twinkle (arranged)
C:Traditional
M:4/4
L:1/4
K:C
"C"C C "F"F E | "C"[CEG]2 z2 | "G7"G G "C"[CEG]2 |]
w: Twin-kle twin-kle lit-tle star
\`\`\`

## Images & theme-aware images

Insert any image by URL with **Insert → Image**. Size one with an HTML tag — \`<img src="…" width="120" />\` — and it keeps that size (the logo at the top of this document is a sized image).

**Theme-aware images** show a different picture in light vs. dark mode, following the in-app theme. Flip **View → Appearance** and watch the logos in **Explore Perssonify** below swap. There are two ways to author them:

- **GitHub-style** — two images that differ only by a \`#gh-light-mode-only\` / \`#gh-dark-mode-only\` URL fragment (used by *Labs* and *Growth* below).
- **\`<picture>\` element** — one element with \`prefers-color-scheme\` sources (used by *Research* below).

## Emoji

Ship it :rocket: — fast :zap:, polished :sparkles:, tested :white_check_mark:

## Tables (math in cells)

| Symbol  | Meaning        | Value |
| ------- | -------------- | :---: |
| $\\pi$   | Pi             | 3.14  |
| $e$     | Euler's number | 2.72  |
| $\\phi$  | Golden ratio   | 1.62  |

## Code

\`\`\`js
import { PerssonifyEditor } from "@perssonify/editor";
\`\`\`

---

## Everything else

- **Two panes, one document** — edit Markdown or rich text and they stay in sync. Use the **MD · HTML · Split** switch, and drag the divider to resize.
- **Find &amp; replace** — ⌘F to find, ⌥⌘F to find &amp; replace, in a floating, draggable panel.
- **Folders &amp; organization** — drag documents in the workspace panel's **Files** tab; drop onto a folder to nest, or onto empty space for the top level; reorder within a level; a folder's "…" menu makes a new folder in place.
- **Internal links** — type \`[[Document title]]\` to link notes, \`[[Doc#Heading]]\` to jump to a heading, then explore backlinks and the whole web in the **Map** view (**⌘⇧G**).
- **Right-click** anywhere in the editor for formatting, insert, link, and clipboard actions in context.
- **Import** — File → Open / Import for \`.md\`, \`.txt\`, \`.html\`, \`.json\`, \`.docx\`, and \`.zip\`/\`.tar\`/\`.gz\` archives (folders preserved, loose files tidied into a folder), or just drop a file onto the editor; **Import → From URL** pulls from a link, and an \`?import_url=\` share link opens the importer with that link filled in — nothing is fetched until you press Fetch.
- **Export** — Markdown, HTML, ProseMirror JSON, Word (\`.docx\`), PDF (print), or your whole library as a \`.zip\`.
- **Appearance** — Light / Dark / **System** theme plus an accent palette (including Mono), from **View → Appearance** or **Settings**.
- **Markdown flavors** — CommonMark, GitHub, or Markdown Extra, with per-feature toggles (tables, footnotes, math, emoji…), in **Settings**.
- **Offline &amp; private** — install it as an app from your browser; everything is stored locally and never uploaded.

---

## Explore Perssonify

[![Perssonify](/brand/perssonify-teal.svg)](https://perssonify.com/)

**Tomorrow's Advantage, Delivered Today.**

We build custom technology solutions for companies that need to move fast without breaking things: applications, AI integrations, and automation systems. → [perssonify.com](https://perssonify.com/)

---

![Perssonify Labs](/brand/labs-light.svg#gh-light-mode-only)
![Perssonify Labs](/brand/labs-dark.svg#gh-dark-mode-only)

**Built in the open. Free to try.**

Tools, frameworks, and experiments from our workshop. Use them today, scale them tomorrow. → [labs.perssonify.com](https://labs.perssonify.com/)

---

![Perssonify Growth](/brand/growth-light.svg#gh-light-mode-only)
![Perssonify Growth](/brand/growth-dark.svg#gh-dark-mode-only)

### High-performance marketing that drives measurable growth.

**Performance marketing, organic visibility, brand authority, and the operational backbone to make it all work together.** → [growth.perssonify.com](https://growth.perssonify.com/)

---

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="/brand/research-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="/brand/research-light.svg">
  <img alt="Perssonify Research" src="/brand/research-light.svg">
</picture>

**Built on research. Open to explore.**

We explore new ideas and build prototypes to unlock future opportunities. → [research.perssonify.com](https://research.perssonify.com/)

---

Built by **Perssonify Labs**. :sparkles:
`;
