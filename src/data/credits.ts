// Third-party technology credits shown on the About page.
//
// A CURATED HIGHLIGHT of what powers what — not the licence notice. The
// complete notice (every package actually present in the app build, with its
// licence text) is generated at build time by scripts/third-party-licenses.mjs
// and served as /third-party-licenses.txt, linked from the About page.
// `src/__tests__/g4-third-party-licenses.test.js` checks that every runtime
// entry here really ships in that build, at the version shown.
//
// Versions and licences are the ones declared by each package in node_modules.
// Update this list when a notable dependency changes; regenerate the notice
// file with `node scripts/third-party-licenses.mjs --public` after a build.

export interface Credit {
  name: string;
  version: string;
  license: string;
  /** Optional short description of what it powers in this app. */
  role?: string;
}

export interface CreditGroup {
  group: string;
  items: Credit[];
}

/** The group that lists build tools: credited, but not shipped in the app. */
export const TOOLING_GROUP = "Build & tooling";

export const CREDITS: CreditGroup[] = [
  {
    group: "Core framework",
    items: [
      { name: "react", version: "18.3.1", license: "MIT", role: "UI runtime" },
      { name: "react-dom", version: "18.3.1", license: "MIT", role: "DOM renderer" },
      { name: "zustand", version: "5.0.12", license: "MIT", role: "State stores" },
    ],
  },
  {
    group: "Editor engines",
    items: [
      { name: "@tiptap/core", version: "3.31.3", license: "MIT", role: "Rich-text engine" },
      { name: "@tiptap/react", version: "3.31.3", license: "MIT", role: "Rich-text React bindings" },
      { name: "@tiptap/starter-kit", version: "3.31.3", license: "MIT", role: "Base rich-text nodes" },
      { name: "prosemirror-model", version: "1.25.12", license: "MIT", role: "ProseMirror document model" },
      { name: "prosemirror-state", version: "1.4.4", license: "MIT", role: "ProseMirror editor state" },
      { name: "prosemirror-view", version: "1.42.6", license: "MIT", role: "ProseMirror editor view" },
      { name: "@codemirror/view", version: "6.39.14", license: "MIT", role: "Markdown source editor" },
      { name: "@codemirror/state", version: "6.5.4", license: "MIT", role: "Editor state" },
      { name: "@codemirror/lang-markdown", version: "6.5.0", license: "MIT", role: "Markdown syntax" },
      { name: "@lezer/highlight", version: "1.2.3", license: "MIT", role: "Syntax highlighting" },
    ],
  },
  {
    group: "Markdown & conversion",
    items: [
      { name: "marked", version: "12.0.2", license: "MIT", role: "Markdown → HTML" },
      { name: "turndown", version: "7.2.4", license: "MIT", role: "HTML → Markdown" },
      { name: "marked-emoji", version: "2.0.3", license: "MIT", role: ":shortcode: emoji" },
      { name: "marked-footnote", version: "1.4.0", license: "MIT", role: "Footnotes" },
      { name: "dompurify", version: "3.4.16", license: "(MPL-2.0 OR Apache-2.0)", role: "HTML sanitising (via Mermaid)" },
    ],
  },
  {
    group: "Rich content",
    items: [
      { name: "katex", version: "0.18.1", license: "MIT", role: "LaTeX math rendering (and its fonts)" },
      { name: "mermaid", version: "11.17.2", license: "MIT", role: "Diagrams" },
      { name: "cytoscape", version: "3.34.0", license: "MIT", role: "Diagram layout (via Mermaid)" },
      { name: "dagre-d3-es", version: "7.0.14", license: "MIT", role: "Graph layout (via Mermaid)" },
      { name: "d3-selection", version: "3.0.0", license: "ISC", role: "Diagram rendering (via Mermaid)" },
      { name: "d3-shape", version: "3.2.0", license: "ISC", role: "Diagram shapes (via Mermaid)" },
      { name: "d3-scale", version: "4.0.2", license: "ISC", role: "Diagram scales (via Mermaid)" },
      { name: "d3-sankey", version: "0.12.3", license: "BSD-3-Clause", role: "Sankey diagrams (via Mermaid)" },
      { name: "abcjs", version: "6.6.4", license: "MIT", role: "Music notation" },
      { name: "lowlight", version: "3.3.0", license: "MIT", role: "Code-block highlighting" },
      { name: "highlight.js", version: "11.11.1", license: "BSD-3-Clause", role: "Language grammars (via lowlight)" },
    ],
  },
  {
    group: "Export & files",
    items: [
      { name: "docx", version: "9.7.1", license: "MIT", role: "Word (.docx) export" },
      { name: "mammoth", version: "1.12.0", license: "BSD-2-Clause", role: "Word (.docx) import" },
      { name: "jszip", version: "3.10.1", license: "(MIT OR GPL-3.0-or-later)", role: "Reading .docx files (inside mammoth and docx)" },
      { name: "pako", version: "1.0.11", license: "(MIT AND Zlib)", role: "Compression (inside JSZip)" },
      { name: "sax", version: "1.6.1", license: "BlueOak-1.0.0", role: "XML parsing (inside docx)" },
      { name: "fflate", version: "0.8.3", license: "MIT", role: "ZIP / TAR archives" },
      { name: "@zip.js/zip.js", version: "2.8.34", license: "BSD-3-Clause", role: "Password-protected ZIP import" },
    ],
  },
  {
    group: "UI & styling",
    items: [
      { name: "@base-ui/react", version: "1.3.0", license: "MIT", role: "Menu & dialog primitives" },
      { name: "tailwindcss", version: "4.3.3", license: "MIT", role: "Styling" },
      { name: "class-variance-authority", version: "0.7.1", license: "Apache-2.0", role: "Variant styling" },
      { name: "tailwind-merge", version: "3.6.0", license: "MIT", role: "Class merging" },
      { name: "clsx", version: "2.1.1", license: "MIT", role: "Class names" },
      { name: "lucide-react", version: "0.577.0", license: "ISC", role: "Icons" },
      { name: "sonner", version: "2.0.7", license: "MIT", role: "Toasts" },
      { name: "tw-animate-css", version: "1.4.0", license: "MIT", role: "Animations" },
      { name: "next-themes", version: "0.4.6", license: "MIT", role: "Light / dark theme" },
    ],
  },
  {
    group: "Fonts",
    items: [
      { name: "@fontsource-variable/geist", version: "5.2.8", license: "OFL-1.1", role: "Geist typeface" },
      { name: "@fontsource-variable/inter", version: "5.2.8", license: "OFL-1.1", role: "Inter typeface" },
    ],
  },
  {
    group: TOOLING_GROUP,
    items: [
      { name: "vite", version: "8.1.5", license: "MIT", role: "Bundler / dev server" },
      { name: "@tailwindcss/vite", version: "4.3.3", license: "MIT", role: "Tailwind build" },
      { name: "typescript", version: "5.9.3", license: "Apache-2.0", role: "Type system" },
      { name: "vitest", version: "4.1.11", license: "MIT", role: "Tests" },
      { name: "vite-plugin-pwa", version: "1.3.0", license: "MIT", role: "Offline / service worker" },
      { name: "@vitejs/plugin-react", version: "6.0.4", license: "MIT", role: "React fast-refresh" },
      { name: "undici", version: "7.30.0", license: "MIT", role: "URL-import relay (SSRF-safe fetch)" },
    ],
  },
];

/** Distinct license identifiers used across all credited packages. */
export const LICENSE_SUMMARY: string[] = Array.from(
  new Set(CREDITS.flatMap((g) => g.items.map((i) => i.license)))
).sort();

/** Where the complete, generated third-party notice is served (public/). */
export const THIRD_PARTY_NOTICES_PATH = "/third-party-licenses.txt";
