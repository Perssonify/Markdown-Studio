import TurndownService from 'turndown';
import { describe, expect, it } from 'vitest';
import { buildMarked } from '../engine/build-marked.ts';
import { createMarkdownEngine } from '../engine/useMarkdownEngine.ts';
import { cleanHtmlForTurndown } from '../engine/html-cleaner.ts';
import { addBaseRules, addInlineStyleRule } from '../engine/turndown-rules.ts';
import { DEFAULT_MARKDOWN_FEATURES } from '../store/settings.ts';

// Mirror the engine's htmlToMd path (clean → turndown) so span-stripping
// regressions are caught, not just raw turndown behavior.
function htmlToMd(html) {
  const td = new TurndownService({ headingStyle: 'atx', emDelimiter: '*' });
  addBaseRules(td);
  addInlineStyleRule(td);
  return td.turndown(cleanHtmlForTurndown(html));
}

const feat = (over) => ({ ...DEFAULT_MARKDOWN_FEATURES, ...over });

describe('markdown flavors & features', () => {
  it('GFM renders pipe tables; CommonMark does not', () => {
    const table = '| a | b |\n|---|---|\n| 1 | 2 |';
    expect(buildMarked(feat({ flavor: 'gfm', tables: true })).parse(table)).toContain('<table');
    expect(
      buildMarked(feat({ flavor: 'commonmark' })).parse(table)
    ).not.toContain('<table');
  });

  it('honors the per-feature tables toggle within GFM', () => {
    const table = '| a | b |\n|---|---|\n| 1 | 2 |';
    expect(buildMarked(feat({ tables: false })).parse(table)).not.toContain('<table');
  });

  it('honors the per-feature strikethrough toggle', () => {
    expect(buildMarked(feat({ strikethrough: true })).parse('~~x~~')).toContain('<del');
    expect(buildMarked(feat({ strikethrough: false })).parse('~~x~~')).not.toContain('<del');
  });

  it('honors the autolink toggle', () => {
    const src = 'see https://example.com now';
    expect(buildMarked(feat({ autolink: true })).parse(src)).toContain('<a ');
    expect(buildMarked(feat({ autolink: false })).parse(src)).not.toContain('<a ');
  });

  it('renders emoji shortcodes when enabled', () => {
    expect(buildMarked(feat({ emoji: true })).parse('hi :smile:')).toContain('data-emoji="smile"');
    expect(buildMarked(feat({ emoji: false })).parse('hi :smile:')).toContain(':smile:');
  });

  it('renders footnotes only in Markdown Extra', () => {
    const src = 'text[^1]\n\n[^1]: a note';
    expect(buildMarked(feat({ footnotes: true })).parse(src)).toContain('footnote');
    expect(buildMarked(feat({ footnotes: false })).parse(src)).not.toContain('footnote');
  });

  it('renders footnotes in a document that opens with a display formula (A083)', () => {
    // marked tries the last-registered extension first; with maths asked
    // before marked-footnote, the footnote section token was not tokens[0] and
    // every reference threw — and kept throwing for the next document too.
    const m = buildMarked(feat({ footnotes: true, math: true }));
    const html = m.parse('$$\nx^2\n$$\n\nA claim[^1].\n\n[^1]: The source.');
    expect(html).toContain('data-math-block');
    expect(html).toContain('The source.');
    expect(html).toContain('href="#footnote-1"');
    expect(m.parse('Plain[^a].\n\n[^a]: note')).toContain('note');
  });

  it('numbers footnote references from 1 in every parse (A083)', () => {
    // A reference inside a definition nothing refers to is lexed (counted)
    // and never rendered (the only thing that resets the count), so the next
    // document's first reference came out as "2", "3", … on every parse.
    // One settings object: a new one per call would rebuild marked (and its
    // counter) for every parse, as a settings change does.
    const settings = feat({ footnotes: true });
    const engine = createMarkdownEngine(() => settings);
    const dirty = 'x\n\n[^a]: unreferenced, holding a reference[^b]\n\n[^b]: other';
    for (let k = 0; k < 3; k++) {
      engine.mdToHtml(dirty);
      expect(engine.mdToHtml('y[^1]\n\n[^1]: n')).toMatch(/<sup><a [^>]*>1<\/a><\/sup>/);
    }
  });

  it('tokenizes LaTeX math into placeholders when enabled', () => {
    const html = buildMarked(feat({ math: true })).parse('inline $x^2$ here');
    expect(html).toContain('data-math-inline="x^2"');
    // Does not false-match currency-style prose.
    expect(buildMarked(feat({ math: true })).parse('costs $5 and $10 total')).not.toContain(
      'data-math-inline'
    );
  });

  it('round-trips emoji and math via turndown', () => {
    const td = new TurndownService();
    addBaseRules(td);
    expect(td.turndown('<p>hi <span data-emoji="smile">😄</span></p>')).toContain(':smile:');
    expect(td.turndown('<p>a <span data-math-inline="x^2">x^2</span> b</p>')).toContain('$x^2$');
    expect(td.turndown('<div data-math-block="\\int x">\\int x</div>')).toContain('$$\\int x$$');
  });

  it('preserves emoji/inline-math spans through the full clean→turndown path', () => {
    // cleanHtmlForTurndown must NOT unwrap these semantic spans.
    expect(htmlToMd('<p>Go <span data-emoji="rocket">🚀</span> now</p>')).toContain(':rocket:');
    expect(htmlToMd('<p>a <span data-math-inline="x^2">x^2</span> b</p>')).toContain('$x^2$');
    expect(htmlToMd('<div data-math-block="\\int x">\\int x</div>')).toContain('$$\\int x$$');
    // Bare spans still get unwrapped.
    expect(htmlToMd('<p>x <span>plain</span> y</p>')).toContain('plain');
  });

  it('round-trips math and emoji inside table cells', () => {
    const td = new TurndownService();
    addBaseRules(td);
    const html =
      '<table><thead><tr><th>H</th></tr></thead><tbody><tr>' +
      '<td>a <span data-math-inline="x^2">x^2</span> <span data-emoji="fire">🔥</span></td>' +
      '</tr></tbody></table>';
    const md = td.turndown(html);
    expect(md).toContain('$x^2$');
    expect(md).toContain(':fire:');
  });

  it('round-trips sub/sup and wiki links inside table cells', () => {
    const td = new TurndownService();
    addBaseRules(td);
    const html =
      '<table><thead><tr><th>H</th></tr></thead><tbody><tr>' +
      '<td>H<sub>2</sub>O E=mc<sup>2</sup> ' +
      '<a data-doc-link="Other">Other</a></td>' +
      '</tr></tbody></table>';
    const md = td.turndown(html);
    expect(md).toContain('H<sub>2</sub>O');
    expect(md).toContain('mc<sup>2</sup>');
    expect(md).toContain('[[Other]]');
  });

  it('honors an ordered list start attribute (does not reset to 1)', () => {
    const td = new TurndownService({ headingStyle: 'atx', emDelimiter: '*' });
    addBaseRules(td);
    const md = td.turndown('<ol start="5"><li>five</li><li>six</li></ol>');
    expect(md).toContain('5. five');
    expect(md).toContain('6. six');
    expect(md).not.toContain('1. five');
  });
});

describe("normalizeMarkdown preserves code content", () => {
  it("keeps blank lines and trailing spaces inside a fenced block", async () => {
    const { normalizeMarkdown } = await import("../engine/preprocessor");
    const md = [
      "Intro",
      "",
      "```js",
      "const a = 1;",
      "",
      "",
      "const b = 2;   ",
      "```",
      "",
      "Outro",
    ].join("\n");
    const out = normalizeMarkdown(md);
    expect(out).toContain("const a = 1;\n\n\nconst b = 2;   ");
  });

  it("still collapses blank runs and trailing spaces OUTSIDE code", () => {
    return import("../engine/preprocessor").then(({ normalizeMarkdown }) => {
      const out = normalizeMarkdown("a   \n\n\n\nb");
      expect(out).toBe("a\n\nb");
    });
  });
});
