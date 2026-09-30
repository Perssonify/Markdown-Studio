"use client";

import { useState, useEffect, useRef } from "react";
import type { Marked } from 'marked';
import type { Node as PMNode } from '@tiptap/pm/model';
import TurndownService from 'turndown';
import { preprocessMarkdown, normalizeMarkdown } from './preprocessor';
import { cleanHtmlForTurndown } from './html-cleaner';
import { addBaseRules, addInlineStyleRule, installEscape, turndownLinear, type EscapeOptions } from './turndown-rules';
import { holdsBreakMark, portableBreaksActive, stripBreakMarks, withoutPortableBreaks } from './portable-breaks';
import { createIncrementalConverter } from './incremental-md';
import { buildMarked } from './build-marked';
import { DEFAULT_MARKDOWN_FEATURES, type MarkdownFeatureSettings } from '../store/settings';
import { useUIStore } from '../store/uiStore';
import { diag } from '../utils/diag';

const PREVIEW_CSS = `
      [data-md-preview] h1 { font-size: 1.75em; font-weight: 700; margin: 16px 0 8px; }
      [data-md-preview] h2 { font-size: 1.45em; font-weight: 700; margin: 14px 0 6px; }
      [data-md-preview] h3 { font-size: 1.25em; font-weight: 600; margin: 12px 0 4px; }
      [data-md-preview] h4 { font-size: 1.1em; font-weight: 600; margin: 10px 0 4px; }
      [data-md-preview] h5, [data-md-preview] h6 { font-size: 1em; font-weight: 600; margin: 8px 0 4px; }
      [data-md-preview] p { margin: 0 0 8px; }
      [data-md-preview] ul, [data-md-preview] ol { margin: 8px 0; padding-left: 24px !important; }
      [data-md-preview] ul { list-style: disc outside none !important; }
      [data-md-preview] ol { list-style: decimal outside none !important; }
      [data-md-preview] li { margin-bottom: 2px; display: list-item !important; }
      [data-md-preview] ul ul, [data-md-preview] ol ol, [data-md-preview] ul ol, [data-md-preview] ol ul { margin: 2px 0; }
      [data-md-preview] ol ol { list-style-type: lower-alpha !important; }
      [data-md-preview] ol ol ol { list-style-type: lower-roman !important; }
      [data-md-preview] ul ul { list-style-type: circle !important; }
      [data-md-preview] ul ul ul { list-style-type: square !important; }
      [data-md-preview] li > input[type="checkbox"] {
        margin-right: 6px; vertical-align: middle; accent-color: var(--primary, #f59e0b);
        pointer-events: auto; cursor: pointer;
      }
      [data-md-preview] ul[data-type="taskList"] { list-style: none !important; padding-left: 0 !important; }
      [data-md-preview] ul[data-type="taskList"] li { display: flex !important; align-items: flex-start; gap: 0.5em; margin-bottom: 2px; }
      [data-md-preview] ul[data-type="taskList"] li > label { flex: 0 0 auto; margin-top: 0.3em; user-select: none; }
      [data-md-preview] ul[data-type="taskList"] li > div { flex: 1 1 auto; min-width: 0; }
      [data-md-preview] ul[data-type="taskList"] li > div > p { margin: 0; }
      [data-md-preview] ol[type="a"] { list-style-type: lower-alpha !important; }
      [data-md-preview] ol[type="A"] { list-style-type: upper-alpha !important; }
      [data-md-preview] ol[type="i"] { list-style-type: lower-roman !important; }
      [data-md-preview] ol[type="I"] { list-style-type: upper-roman !important; }
      [data-md-preview] blockquote {
        border-left: 3px solid var(--primary, #f59e0b);
        padding: 8px 16px;
        margin: 12px 0;
        border-radius: 0 8px 8px 0;
        background: color-mix(in srgb, var(--primary, #f59e0b) 6%, transparent);
      }
      [data-md-preview] div[data-type="callout"] { --callout-color: #3b82f6; border-left: 3px solid var(--callout-color); border-radius: 0 8px 8px 0; padding: 8px 16px; margin: 12px 0; background: color-mix(in srgb, var(--callout-color) 8%, transparent); }
      [data-md-preview] div[data-type="callout"][data-callout="tip"] { --callout-color: #22c55e; }
      [data-md-preview] div[data-type="callout"][data-callout="important"] { --callout-color: #a855f7; }
      [data-md-preview] div[data-type="callout"][data-callout="warning"] { --callout-color: #f59e0b; }
      [data-md-preview] div[data-type="callout"][data-callout="caution"] { --callout-color: #ef4444; }
      [data-md-preview] div[data-type="callout"]::before { content: "Note"; display: block; font-size: 0.8em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--callout-color); margin-bottom: 4px; }
      [data-md-preview] div[data-type="callout"][data-callout="tip"]::before { content: "Tip"; }
      [data-md-preview] div[data-type="callout"][data-callout="important"]::before { content: "Important"; }
      [data-md-preview] div[data-type="callout"][data-callout="warning"]::before { content: "Warning"; }
      [data-md-preview] div[data-type="callout"][data-callout="caution"]::before { content: "Caution"; }
      [data-md-preview] div[data-type="callout"] > :last-child { margin-bottom: 0; }
      [data-md-preview] details { border: 1px solid var(--border, #e5e7eb); border-radius: 8px; padding: 8px 12px; margin: 12px 0; background: color-mix(in srgb, var(--foreground, #111) 3%, transparent); }
      [data-md-preview] details > summary { cursor: pointer; font-weight: 600; user-select: none; }
      [data-md-preview] details[open] > summary { margin-bottom: 8px; }
      [data-md-preview] details > :last-child { margin-bottom: 0; }
      [data-md-preview] code {
        background: color-mix(in srgb, var(--primary, #f59e0b) 12%, transparent);
        color: var(--primary-strong, #b45309);
        padding: 1px 5px;
        border-radius: 4px;
        font-family: "SF Mono", "Fira Code", monospace;
        font-size: 0.9em;
      }
      [data-md-preview] pre {
        padding: 12px;
        border-radius: 8px;
        overflow-x: auto;
        margin: 12px 0;
      }
      [data-md-preview][data-theme="dark"] pre {
        background: rgba(0,0,0,0.3);
        border: 1px solid rgba(255,255,255,0.06);
      }
      [data-md-preview][data-theme="light"] pre {
        background: rgba(0,0,0,0.04);
        border: 1px solid rgba(0,0,0,0.08);
      }
      [data-md-preview] pre code { background: none; padding: 0; color: inherit; }
      [data-md-preview] a { color: var(--primary-strong, #b45309); text-decoration: none; }
      [data-md-preview] a:hover { text-decoration: underline; }
      [data-md-preview][data-theme="dark"] hr { border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 20px 0; }
      [data-md-preview][data-theme="light"] hr { border: none; border-top: 1px solid rgba(0,0,0,0.15); margin: 20px 0; }
      [data-md-preview] table { border-collapse: collapse; width: 100%; margin: 12px 0; }
      [data-md-preview] th, [data-md-preview] td {
        padding: 8px 12px;
        text-align: left;
      }
      [data-md-preview][data-theme="dark"] th,
      [data-md-preview][data-theme="dark"] td {
        border: 1px solid rgba(255,255,255,0.12);
      }
      [data-md-preview][data-theme="dark"] th {
        font-weight: 600; background: rgba(255,255,255,0.04);
      }
      [data-md-preview][data-theme="light"] th,
      [data-md-preview][data-theme="light"] td {
        border: 1px solid rgba(0,0,0,0.12);
      }
      [data-md-preview][data-theme="light"] th {
        font-weight: 600; background: rgba(0,0,0,0.03);
      }
      [data-md-preview] table tr:hover td {
        background: color-mix(in srgb, var(--primary, #f59e0b) 5%, transparent);
      }
      [data-md-preview] td[align="center"], [data-md-preview] th[align="center"] { text-align: center; }
      [data-md-preview] td[align="right"], [data-md-preview] th[align="right"] { text-align: right; }
      [data-md-preview] img { max-width: 100%; height: auto; margin: 8px 0; }
      [data-md-preview] strong { font-weight: 700; }
      [data-md-preview] em { font-style: italic; }
      [data-md-preview] del { text-decoration: line-through; opacity: 0.7; }
      [data-md-preview] u { text-decoration: underline; }
      [data-md-preview] sup { vertical-align: super; font-size: 0.8em; }
      [data-md-preview] sub { vertical-align: sub; font-size: 0.8em; }
      /* Highlight legibility: pin dark ink on inline-background spans so a light
         highlight reads correctly in both light and dark themes (see styles.css). */
      [data-md-preview] span[style*="background-color"] {
        color: #1c1917;
        padding: 0.05em 0.15em;
        border-radius: 3px;
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
      }
      /* GitHub-style theme-aware images in the preview / export. Follows the
         preview's data-theme; a prefers-color-scheme fallback covers exported
         standalone HTML that carries no data-theme. */
      [data-md-preview] img[src$="#gh-dark-mode-only"] { display: none; }
      [data-md-preview][data-theme="dark"] img[src$="#gh-dark-mode-only"] { display: revert; }
      [data-md-preview][data-theme="dark"] img[src$="#gh-light-mode-only"] { display: none; }
      @media (prefers-color-scheme: dark) {
        [data-md-preview]:not([data-theme="light"]) img[src$="#gh-dark-mode-only"] { display: revert; }
        [data-md-preview]:not([data-theme="light"]) img[src$="#gh-light-mode-only"] { display: none; }
      }
`;

export interface MarkdownEngine {
  mdToHtml: (md: string) => string;
  htmlToMd: (html: string) => string;
  htmlToCleanMd: (html: string) => string;
  /**
   * The rich pane's document as markdown — `htmlToMd` / `htmlToCleanMd` of
   * `editor.getHTML()`, byte for byte — converting only the top-level blocks
   * that changed since they were last converted (A083, incremental-md.ts).
   * Optional, like `docHtmlHash`: an engine without them (a test's, a host's)
   * takes the sync engine's whole-document path.
   */
  docToMd?: (doc: PMNode, mode: "styled" | "clean") => string;
  /** `quickHash(editor.getHTML())`, computed per block (see docToMd). */
  docHtmlHash?: (doc: PMNode) => number;
  /** `quickHash(md)` for the markdown docToMd last returned, from its pieces'
   *  hashes; null when it does not know it. */
  docMdHash?: (md: string) => number | null;
}

/**
 * The three converters as a plain factory. `useMarkdownEngine` is a thin React
 * wrapper around this; it exists on its own so the converter round-trip suite
 * drives the very objects the app uses — the same turndown instances, rules,
 * escaping and whitespace passes — rather than a hand-assembled copy that can
 * drift from them.
 *
 * Both getters are read at CALL time, never captured: the hook keeps the engine
 * object identity stable across settings changes (the sync engine holds it in
 * effect dependencies) and relies on that to pick up new settings.
 */
export function createMarkdownEngine(
  getFeatures: () => MarkdownFeatureSettings,
  getMarked?: () => Marked,
): MarkdownEngine {
  let cachedFor: MarkdownFeatureSettings | null = null;
  let cached: Marked | null = null;
  const marked = getMarked ?? (() => {
    const f = getFeatures();
    if (f !== cachedFor || !cached) {
      cached = buildMarked(f);
      cachedFor = f;
    }
    return cached;
  });

  // `hr: "---"`: turndown's default `* * *` rewrote every thematic break the
  // user typed on the first rich-pane edit. Its rule always emits the break
  // between blank lines, so `---` cannot read as a setext underline or open
  // front matter.
  const options = { headingStyle: "atx", codeBlockStyle: "fenced", emDelimiter: "*", hr: "---" } as const;

  // Escape exactly what the CURRENT settings give meaning to (turndown-rules.ts
  // escapeMarkdownText): `$` only while maths is on, `~~` only while
  // strikethrough is, `{` only while the curly syntax is.
  const escapeOptions = (): EscapeOptions => {
    const f = getFeatures();
    return {
      math: f.math,
      strikethrough: f.flavor !== "commonmark" && f.strikethrough,
      curly: f.curlyBraceFormatting === true,
    };
  };

  const tdInline = new TurndownService(options);
  addBaseRules(tdInline);
  addInlineStyleRule(tdInline);
  installEscape(tdInline, escapeOptions);

  const tdClean = new TurndownService(options);
  addBaseRules(tdClean);
  installEscape(tdClean, escapeOptions);

  // The whitespace pass, after dropping the markers an export's hard breaks
  // leave behind (A051, portable-breaks.ts) — BEFORE the pass, so it treats
  // the lines they were on exactly as it does in the editor.
  const finish = (md: string): string => normalizeMarkdown(portableBreaksActive() ? stripBreakMarks(md) : md);
  // turndownLinear, not td.turndown: the plain conversion is quadratic in
  // document length (turndown-rules.ts).
  const toMarkdown = (td: TurndownService, html: string): string =>
    portableBreaksActive() && holdsBreakMark(html)
      ? withoutPortableBreaks(() => toMarkdown(td, html))
      : finish(turndownLinear(td, cleanHtmlForTurndown(html)));

  const incremental = createIncrementalConverter({
    converters: { styled: tdInline, clean: tdClean },
    signature: () => {
      const e = escapeOptions();
      return `${e.math ? 1 : 0}${e.strikethrough ? 1 : 0}${e.curly ? 1 : 0}`;
    },
    normalize: normalizeMarkdown,
  });

  return {
    mdToHtml: (md: string) => {
      const features = getFeatures();
      let html = marked().parse(
        preprocessMarkdown(md, {
          taskLists: features.taskLists,
          frontmatter: true,
          // Wiki links / heading anchors are rendered by the marked extension
          // in build-marked.ts (so they can never land inside code); this
          // pass only protects an alias's `|` from GFM table cell splitting.
          wikiLinkTablePipes: true,
          // Undocumented and opt-in: see PreprocessFeatures.
          curlyBraceFormatting: features.curlyBraceFormatting === true,
        }),
        { async: false }
      ) as string;
      // Skip task lists (data-type="taskList"/"taskItem") — they render as
      // a checkbox row, not a disc/decimal marker, and TaskList/TaskItem
      // parse on their data-type so a disc bullet would just sit beside the
      // checkbox. The negative lookaheads leave those elements untouched.
      //
      // Each of these is a backtracking scan of the WHOLE rendered
      // document, run on every projection. Most documents contain no list
      // at all, and an `indexOf` scan is far cheaper than a regex one, so
      // check for the tag before scanning for it.
      if (html.indexOf("<ul") !== -1)
        html = html.replace(/<ul(?![^>]*data-type="taskList")(?=[\s>])/g, '<ul style="list-style:disc outside;padding-left:24px;margin:8px 0"');
      if (html.indexOf("<ol") !== -1)
        html = html.replace(/<ol(?=[\s>])/g, '<ol style="list-style:decimal outside;padding-left:24px;margin:8px 0"');
      if (html.indexOf("<li") !== -1)
        html = html.replace(/<li(?![^>]*data-type="taskItem")(?=[\s>])/g, '<li style="display:list-item;margin-bottom:2px"');
      return html;
    },
    htmlToMd: (html: string) => toMarkdown(tdInline, html),
    htmlToCleanMd: (html: string) => toMarkdown(tdClean, html),
    // The editor's own form, always: this is the markdown pane's projection,
    // and its cache must never hold an export's output.
    docToMd: (doc: PMNode, mode: "styled" | "clean") => withoutPortableBreaks(() => incremental.toMarkdown(doc, mode)),
    docHtmlHash: (doc: PMNode) => incremental.htmlHash(doc),
    docMdHash: (md: string) => incremental.markdownHash(md),
  };
}

export function useMarkdownEngine(): {
  ready: boolean;
  engine: MarkdownEngine | null;
  /** Increments whenever the markdown feature/flavor config changes, so
   *  consumers can force a re-sync of already-rendered content. */
  configVersion: number;
} {
  const [ready, setReady] = useState<boolean>(false);
  const [configVersion, setConfigVersion] = useState<number>(0);
  const engineRef = useRef<MarkdownEngine | null>(null);
  const markedRef = useRef<Marked | null>(null);
  const featuresRef = useRef<MarkdownFeatureSettings>(DEFAULT_MARKDOWN_FEATURES);

  const markdownFeatures = useUIStore((s) => s.markdownFeatures);

  useEffect(() => {
    if (document.getElementById("md-preview-styles")) return;
    const style = document.createElement("style");
    style.id = "md-preview-styles";
    style.textContent = PREVIEW_CSS;
    document.head.appendChild(style);
  }, []);

  // Rebuild the marked instance whenever feature settings change. Engine object
  // identity stays stable (it reads markedRef/featuresRef at call time), so we
  // avoid a re-render cascade through the sync engine; configVersion signals the
  // change instead.
  useEffect(() => {
    featuresRef.current = markdownFeatures;
    markedRef.current = buildMarked(markdownFeatures);
    setConfigVersion((v) => v + 1);
  }, [markdownFeatures]);

  useEffect(() => {
    let cancelled = false;

    function init() {
      try {
        diag("ENGINE", "initializing (bundled)...");
        if (cancelled) return;

        // Ensure a marked instance exists even before the features effect runs.
        if (!markedRef.current) markedRef.current = buildMarked(featuresRef.current);

        engineRef.current = createMarkdownEngine(
          () => featuresRef.current,
          () => markedRef.current ?? (markedRef.current = buildMarked(featuresRef.current)),
        );

        setReady(true);
        diag("ENGINE", "ready=true, engine created successfully");
      } catch (err: any) {
        console.error("[MarkdownEngine] Init failed:", err);
        diag("ENGINE", "INIT_FAILED", err.message);
      }
    }

    init();

    return () => { cancelled = true; };
  }, []);

  return { ready, engine: engineRef.current, configVersion };
}