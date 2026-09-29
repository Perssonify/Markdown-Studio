/**
 * A083 — the rich→markdown conversion is linear, and EXACTLY the conversion it
 * replaced.
 *
 * `turndownLinear` splits the document's top level into runs and joins them
 * with turndown's own separator rule, because turndown's join is quadratic in
 * document length. The one property that matters is equivalence: for any
 * input, the output must be byte-identical to `td.turndown(html)`. Chunk sizes
 * of 1 and 2 put a seam between nearly every pair of blocks, so every kind of
 * block meets every kind of neighbour at a seam somewhere in this corpus.
 */
import TurndownService from "turndown";
import { describe, expect, it } from "vitest";
import { cleanHtmlForTurndown } from "../engine/html-cleaner";
import { addBaseRules, addInlineStyleRule, installEscape, turndownLinear } from "../engine/turndown-rules";
import { engineFor, throughRichPane } from "./converter-harness";

function turndowns() {
  const make = (styled) => {
    const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", emDelimiter: "*", hr: "---" });
    addBaseRules(td);
    if (styled) addInlineStyleRule(td);
    installEscape(td, () => ({ math: true, strikethrough: true, curly: false }));
    return td;
  };
  return [make(true), make(false)];
}

const MARKDOWN = [
  "# Title\n\nPara one.\n\nPara two\nwith a break.\n\n- a\n- b\n  - c\n\n1. x\n2. y",
  "> quote\n>\n> more\n\n> [!NOTE]\n> callout\n\n---\n\n```js\na\n\n\nb\n```\n\ntext",
  "| a | b |\n| :-- | --: |\n| 1 | ~~2~~ |\n\n$$x^2$$\n\nInline $y$ and [[Doc|Alias]].",
  "- [ ] task\n  - [x] done\n\n<details><summary>S</summary>\n\nbody\n\n</details>\n\nafter",
  "---\ntitle: Front\n---\n\n# H\n\n![img](a.png)\n\n<picture><source media=\"(prefers-color-scheme: dark)\" srcset=\"d.png\"><img src=\"l.png\" alt=\"x\"></picture>",
];

// Hand-written HTML with the awkward cases: whitespace between blocks, inline
// content at the top level, empty blocks, plain divs (which join with ONE
// newline), comments, and elements turndown does not count as blocks.
const HTML = [
  "<p>a</p>\n\n<p>b</p>\n<p>c</p>",
  "text at top <em>level</em><p>then a block</p> trailing <strong>inline</strong>",
  "<p></p><p>x</p><p></p><p></p><h2>h</h2><p> </p><p>y</p>",
  "<div>plain one</div><div>plain two</div><p>para</p><div>plain three</div>",
  "<p>a</p><!-- note --><p>b</p><details><summary>s</summary><p>d</p></details><p>c</p>",
  "<ul><li><p>one</p></li></ul><ul><li><p>two</p></li></ul><ol start=\"3\"><li><p>three</p></li></ol>",
  "<p>a<br>b<br><br>c</p><hr><blockquote><p>q</p></blockquote><pre><code>code\n\n  indented</code></pre>",
  "<table><tbody><tr><th><p>h</p></th></tr><tr><td><p>c</p></td></tr></tbody></table><p>after table</p>",
  "<div data-math-block=\"x\">x</div><p><span data-math-inline=\"y\">y</span></p><div data-type=\"callout\" data-callout=\"tip\"><p>t</p></div>",
  // Text BETWEEN two blocks is not a seam; attribute values holding `>` and
  // `</p>` must not confuse the splitter.
  "<p>a</p>stray text<p>b</p><h2>c</h2> and <em>more</em><p>d</p>",
  '<p title="x > y </p> z">a</p><p data-note=\'</div>\'>b</p><p>c</p>',
  // An inline element directly after a block: turndown strips its leading
  // space only because a block precedes it — a seam there would keep it.
  "<p>a</p><strong> bold</strong><p>c</p>",
  // Serialization does not escape `<`/`>` in attribute values, so these are
  // exactly what innerHTML produces for such titles.
  '<p title="a></p><p>">x</p><p>y</p>',
  "<p title='b></p><h2>'>z</p><p>w</p>",
];

describe("A083 — linear conversion is byte-identical to turndown's", () => {
  const engine = engineFor();
  const corpus = [
    ...MARKDOWN.map((md) => throughRichPane(engine.mdToHtml(md)).html),
    ...MARKDOWN.map((md) => engine.mdToHtml(md)), // marked output, "\n" between blocks
    ...HTML,
  ].map((h) => cleanHtmlForTurndown(h));

  it.each(corpus.map((h, i) => [i, h]))("corpus #%i", (_i, html) => {
    for (const td of turndowns()) {
      const plain = td.turndown(html);
      for (const chunk of [1, 2, 3]) {
        expect(turndownLinear(td, html, chunk), `chunk=${chunk}`).toBe(plain);
      }
    }
  });

  it("takes the linear path through markup a naive tag scan would misread", () => {
    // The output can never differ — a run that comes back without its seam
    // markers makes the converter fall back to the plain path — so what the
    // quote-aware tag scan buys is STAYING linear. Count the conversions: one
    // per run means no fallback happened.
    const [td] = turndowns();
    const html = '<p title="a></p><p>">x</p><p>y</p><p>z</p>';
    const plain = td.turndown(html);
    let calls = 0;
    const counting = { ...td, turndown: (input) => (calls++, td.turndown(input)) };
    expect(turndownLinear(counting, html, 1)).toBe(plain);
    expect(calls).toBe(3);
  });

  it("matches on a large generated document too", () => {
    const blocks = [];
    for (let i = 0; i < 400; i++) {
      blocks.push(
        [`## H${i}`, `Para ${i} with *em* and \`code\`.`, `- a${i}\n- b${i}`, "```\nx\n\ny\n```", `| a |\n| --- |\n| ${i} |`][i % 5]
      );
    }
    const html = cleanHtmlForTurndown(throughRichPane(engine.mdToHtml(blocks.join("\n\n"))).html);
    for (const td of turndowns()) {
      expect(turndownLinear(td, html)).toBe(td.turndown(html));
      expect(turndownLinear(td, html, 7)).toBe(td.turndown(html));
    }
  });
});
