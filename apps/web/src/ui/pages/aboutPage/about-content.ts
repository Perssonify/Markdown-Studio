/**
 * The About page's prose. Like help-content.ts this is CONTENT, not interface
 * labels, so it is not in the translation catalog: a translation is another
 * object of this shape added to `ABOUT_CONTENT` under its locale. Headings,
 * buttons and table headers on the page ARE labels and live in the catalog
 * (`pages.*`); the credits table is data (src/data/credits.ts).
 *
 * Paragraphs may carry `{app}` / `{licenses}` placeholders and `<b>…</b>` /
 * `<link>…</link>` spans, rendered with `renderRich` (src/i18n).
 */
import type { LocalizedContent } from "@/i18n";

export interface AboutContent {
  /** Under the product name. */
  intro: string;
  principles: {
    privacy: { title: string; body: string };
    offline: { title: string; body: string };
    formats: { title: string; body: string };
  };
  /** `{app}`, `{licenses}` inside `<b>`. */
  creditsIntro: string;
  /** `<link>` is the third-party licences page. */
  creditsNote: string;
  diagnostics: string;
  /** `{app}`. */
  footer: string;
}

const en: AboutContent = {
  intro:
    "A dual-pane Markdown editor that keeps a raw-Markdown source and a rich-text preview perfectly in sync — with math, diagrams, music, tables, folders, a knowledge graph, a card board, and one-click export. It runs in your browser: there is no account, and your documents are stored on your device, not on a server.",
  principles: {
    privacy: {
      title: "Private by design",
      body: "Your documents are stored in this browser. There is no account, and no server stores or reads them. Importing from a URL asks before using our relay, and remote images can be blocked — both in Settings ▸ Privacy.",
    },
    offline: {
      title: "Works offline",
      body: "Installable as an app and cached for offline use, so you can keep writing without a connection.",
    },
    formats: {
      title: "Open formats",
      body: "Import Markdown, HTML, JSON and Word; export all of those and PDF — your work is never locked in.",
    },
  },
  creditsIntro:
    "{app} stands on the shoulders of these projects. Versions reflect what this build was tested against. Licenses in use: <b>{licenses}</b>.",
  creditsNote:
    "These are the highlights. The complete list of open-source software in this build, with every licence and notice text, is in the <link>third-party licences</link>.",
  diagnostics:
    "Copy a diagnostics report and include it when you get in touch. It lists recent errors, the app version and your browser — never the contents of your documents.",
  footer: "© {app} · Made with 💗 by Perssonify. All trademarks and licenses belong to their respective owners.",
};

/** About-page prose per interface language (English required). */
export const ABOUT_CONTENT: LocalizedContent<AboutContent> = { en };
