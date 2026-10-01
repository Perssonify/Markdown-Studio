import { Lexer, Marked } from "marked";
import { describe, expect, it } from "vitest";
import { buildMarked } from "../engine/build-marked";
import { walkTokensLinear } from "../engine/incremental-rich";
import { DEFAULT_MARKDOWN_FEATURES } from "../store/settings";

/**
 * The incremental markdown→rich projection walks every token of the document
 * on its first keystroke. marked's own `walkTokens` rebuilds its result array
 * with `concat` at every token — quadratic: at 4 MB it was 53.7 s of a 73.5 s
 * lex — so the projection uses `walkTokensLinear`. It must be marked's walk
 * minus the array: the SAME tokens, in the SAME order, with the same `this`,
 * or an extension's walkTokens (and the raw-HTML scan) would see a different
 * document.
 */

const DOC = [
  "---",
  "title: Walk",
  "---",
  "# Heading with **bold** and `code` :smile:",
  "",
  "Paragraph with a [link](https://example.com), an ![image](a.png), $x^2$ and a footnote[^1].",
  "",
  "| Left | Right |",
  "| :--- | ----: |",
  "| **a** | `b` |",
  "| c [x](y) | d $z$ |",
  "",
  "- one",
  "  - nested *em*",
  "    1. ordered",
  "- [ ] task",
  "- [x] done ~~gone~~",
  "",
  "> quote with <span style=\"color:red\">html</span>",
  ">",
  "> > nested quote",
  "",
  "> [!NOTE]",
  "> callout body",
  "",
  "<details><summary>More</summary>",
  "",
  "Inside details.",
  "",
  "</details>",
  "",
  "<pre>raw pre</pre>",
  "",
  "$$",
  "\\int_0^1 x\\,dx",
  "$$",
  "",
  "```js",
  "const a = 1;",
  "```",
  "",
  "[^1]: The footnote, with *emphasis*.",
  "",
].join("\n");

function walks(src) {
  const m = buildMarked({ ...DEFAULT_MARKDOWN_FEATURES });
  const tokens = new Lexer({ ...m.defaults, async: false }).lex(src);
  const before = [], after = [];
  let beforeThis = true, afterThis = true;
  m.walkTokens(tokens, function (t) { before.push(t); if (this !== m) beforeThis = false; });
  walkTokensLinear(m, tokens, function (t) { after.push(t); if (this !== m) afterThis = false; });
  return { before, after, beforeThis, afterThis };
}

describe("walkTokensLinear is marked's walkTokens without the quadratic array", () => {
  it("visits the same tokens in the same order, with the Marked instance as this", () => {
    const { before, after, beforeThis, afterThis } = walks(DOC);
    // The document must actually exercise the shapes that branch.
    const types = new Set(before.map((t) => t.type));
    for (const type of ["table", "list", "list_item", "blockquote", "html", "codespan", "link", "image", "del", "code"]) {
      expect(types.has(type), `the fixture has a ${type} token`).toBe(true);
    }
    expect(after.length).toBe(before.length);
    after.forEach((t, i) => expect(t, `token ${i} (${before[i].type})`).toBe(before[i]));
    expect(beforeThis).toBe(true);
    expect(afterThis).toBe(true);
  });

  it("follows an extension's declared childTokens, as marked does", () => {
    // None of the app's own extensions declares childTokens today, so this
    // branch is reached through a small one: a `box` token whose children sit
    // in `inner` (nested arrays, flattened) and whose `tokens` is a decoy.
    const m = new Marked({
      extensions: [{
        name: "box",
        level: "block",
        start: (src) => src.indexOf("[[box"),
        tokenizer(src) {
          const match = /^\[\[box ([^\]]*)\]\]/.exec(src);
          if (!match) return undefined;
          return {
            type: "box", raw: match[0],
            inner: [this.lexer.inlineTokens(match[1]), [this.lexer.inlineTokens("**deep**")]],
            tokens: this.lexer.inlineTokens("decoy"),
          };
        },
        renderer: () => "",
        childTokens: ["inner"],
      }],
    });
    const tokens = new Lexer({ ...m.defaults, async: false }).lex("[[box *one* `two`]]\n\nafter");
    const before = [], after = [];
    m.walkTokens(tokens, (t) => { before.push(t); });
    walkTokensLinear(m, tokens, (t) => { after.push(t); });
    expect(before.some((t) => t.type === "strong")).toBe(true); // reached the nested child
    expect(before.some((t) => t.text === "decoy")).toBe(false); // and not the decoy
    expect(after).toEqual(before);
    after.forEach((t, i) => expect(t).toBe(before[i]));
  });

  it("matches on a large document too", () => {
    const big = Array.from({ length: 60 }, (_, i) => DOC.replace("# Heading", `# Heading ${i}`).replace(/\[\^1\]/g, `[^${i + 1}]`)).join("\n\n");
    const { before, after } = walks(big);
    expect(before.length).toBeGreaterThan(5000);
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) if (after[i] !== before[i]) throw new Error(`differs at token ${i} (${before[i].type})`);
  });
});
