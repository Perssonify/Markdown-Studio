// Third-party technology credits shown on the About page.
//
// Generated from package.json + each package's declared license in node_modules.
// Regenerate when dependencies change (see docs/runbooks or the About-page task).
// Versions here reflect the versions this app was built and tested against.

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
      { name: "@tiptap/core", version: "3.20.0", license: "MIT", role: "Rich-text engine" },
      { name: "@tiptap/react", version: "3.20.0", license: "MIT", role: "Rich-text React bindings" },
      { name: "@tiptap/starter-kit", version: "3.20.0", license: "MIT", role: "Base rich-text nodes" },
      { name: "@tiptap/pm", version: "3.20.0", license: "MIT", role: "ProseMirror model" },
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
    ],
  },
  {
    group: "Rich content",
    items: [
      { name: "katex", version: "0.18.1", license: "MIT", role: "LaTeX math rendering" },
      { name: "mermaid", version: "11.16.0", license: "MIT", role: "Diagrams" },
      { name: "abcjs", version: "6.6.4", license: "MIT", role: "Music notation" },
      { name: "lowlight", version: "3.3.0", license: "MIT", role: "Code-block highlighting" },
    ],
  },
  {
    group: "Export & files",
    items: [
      { name: "docx", version: "9.7.1", license: "MIT", role: "Word (.docx) export" },
      { name: "fflate", version: "0.8.3", license: "MIT", role: "ZIP / TAR archives" },
    ],
  },
  {
    group: "UI & styling",
    items: [
      { name: "@base-ui/react", version: "1.3.0", license: "MIT", role: "Menu & dialog primitives" },
      { name: "tailwindcss", version: "4.3.3", license: "MIT", role: "Styling" },
      { name: "@tailwindcss/vite", version: "4.3.3", license: "MIT", role: "Tailwind build" },
      { name: "class-variance-authority", version: "0.7.1", license: "Apache-2.0", role: "Variant styling" },
      { name: "tailwind-merge", version: "3.6.0", license: "MIT", role: "Class merging" },
      { name: "clsx", version: "2.1.1", license: "MIT", role: "Class names" },
      { name: "lucide-react", version: "0.577.0", license: "ISC", role: "Icons" },
      { name: "sonner", version: "2.0.7", license: "MIT", role: "Toasts" },
      { name: "vaul", version: "1.1.2", license: "MIT", role: "Mobile drawers" },
      { name: "tw-animate-css", version: "1.4.0", license: "MIT", role: "Animations" },
      { name: "@floating-ui/dom", version: "1.7.6", license: "MIT", role: "Popover positioning" },
      { name: "next-themes", version: "0.4.6", license: "MIT", role: "Light / dark theme" },
    ],
  },
  {
    group: "Fonts",
    items: [
      { name: "@fontsource/geist-sans", version: "5.2.5", license: "OFL-1.1", role: "Geist typeface" },
      { name: "@fontsource-variable/geist", version: "5.2.8", license: "OFL-1.1", role: "Geist variable" },
      { name: "@fontsource-variable/inter", version: "5.2.8", license: "OFL-1.1", role: "Inter variable" },
    ],
  },
  {
    group: "Build & tooling",
    items: [
      { name: "vite", version: "8.1.5", license: "MIT", role: "Bundler / dev server" },
      { name: "typescript", version: "5.9.3", license: "Apache-2.0", role: "Type system" },
      { name: "vitest", version: "4.1.10", license: "MIT", role: "Tests" },
      { name: "vite-plugin-pwa", version: "1.3.0", license: "MIT", role: "Offline / service worker" },
      { name: "@vitejs/plugin-react", version: "6.0.4", license: "MIT", role: "React fast-refresh" },
      { name: "undici", version: "7.29.0", license: "MIT", role: "URL-import relay (SSRF-safe fetch)" },
    ],
  },
];

/** Distinct license identifiers used across all credited packages. */
export const LICENSE_SUMMARY: string[] = Array.from(
  new Set(CREDITS.flatMap((g) => g.items.map((i) => i.license)))
).sort();
