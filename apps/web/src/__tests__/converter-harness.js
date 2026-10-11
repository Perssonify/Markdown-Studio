/**
 * Shared harness for the converter round-trip suites (not a test file itself —
 * vitest only collects `*.test.{js,jsx}`).
 *
 * Every stage is the REAL code the app runs: `createMarkdownEngine` is the
 * object `useMarkdownEngine` hands the sync engine, and the rich pane is a
 * TipTap editor built from `SERIALIZE_EXTENSIONS`, the headless mirror of the
 * live TiptapPane schema. A projection here is therefore the same trip a
 * document takes when you edit it in either pane:
 *
 *   md ──mdToHtml──▶ html ──TipTap parse──▶ PM doc ──getHTML──▶ html ──htmlToMd──▶ md′
 */
import { Editor } from "@tiptap/core";
import { SERIALIZE_EXTENSIONS } from "../engine/serialize-doc";
import { createMarkdownEngine } from "../engine/useMarkdownEngine";
import { DEFAULT_MARKDOWN_FEATURES } from "../store/preferences/settings";

export function engineFor(features = {}) {
  const f = { ...DEFAULT_MARKDOWN_FEATURES, ...features };
  return createMarkdownEngine(() => f);
}

/** Parse HTML through the editor schema and serialize it back out. */
export function throughRichPane(html) {
  const ed = new Editor({ extensions: SERIALIZE_EXTENSIONS, content: "" });
  try {
    ed.commands.setContent(html, { emitUpdate: false });
    return { html: ed.getHTML(), json: ed.getJSON() };
  } finally {
    ed.destroy();
  }
}

/**
 * md → rich → md′ → rich → md″, in Styled (default) or Clean mode.
 * Returns every intermediate so a failing case can say WHERE it went wrong.
 */
export function roundTrip(md, { features = {}, mode = "styled" } = {}) {
  const engine = engineFor(features);
  const toMd = mode === "clean" ? engine.htmlToCleanMd : engine.htmlToMd;
  const html1 = engine.mdToHtml(md);
  const rich1 = throughRichPane(html1);
  const md1 = toMd(rich1.html);
  const html2 = engine.mdToHtml(md1);
  const rich2 = throughRichPane(html2);
  const md2 = toMd(rich2.html);
  return { html1, rich1: rich1.html, json1: rich1.json, md1, html2, rich2: rich2.html, json2: rich2.json, md2 };
}

/** One rich-pane projection of arbitrary HTML (a paste, an import, a card). */
export function htmlRoundTrip(html, { features = {}, mode = "styled" } = {}) {
  const engine = engineFor(features);
  const toMd = mode === "clean" ? engine.htmlToCleanMd : engine.htmlToMd;
  const rich = throughRichPane(html);
  const md1 = toMd(rich.html);
  const again = throughRichPane(engine.mdToHtml(md1));
  return { rich: rich.html, json: rich.json, md1, rich2: again.html, json2: again.json, md2: toMd(again.html) };
}
