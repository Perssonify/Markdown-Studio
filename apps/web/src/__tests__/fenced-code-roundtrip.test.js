/**
 * Fenced code must survive a markdown -> rich -> markdown round trip
 * BYTE FOR BYTE: blank runs inside it, trailing whitespace on its lines, and
 * indentation. CLAUDE.md states this for `normalizeMarkdown`'s masking, and
 * `preprocessor-code-mask.test.js` covers that one pass — but nothing covered
 * the whole conversion, which is where a reader would actually notice.
 *
 * Written after a browser probe appeared to show blank lines inside a fence
 * doubling on the first round trip. They do not: CodeMirror renders an empty
 * line as `<div class="cm-line"><br></div>`, and `innerText` counts both the
 * block break and the <br>, so the PROBE double-counted them. Reading the
 * document through CodeMirror's own line elements shows the true count. The bug
 * was in the measurement; this test is what makes that answer durable.
 */
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TurndownService from "turndown";
import { describe, expect, it } from "vitest";
import { buildMarked } from "../engine/build-marked";
import { cleanHtmlForTurndown } from "../engine/html-cleaner";
import { addBaseRules, addInlineStyleRule } from "../engine/turndown-rules.ts";
import { preprocessMarkdown, normalizeMarkdown } from "../engine/preprocessor.ts";
import { DEFAULT_MARKDOWN_FEATURES } from "../store/preferences/settings";

/** The engine's own turndown configuration — `codeBlockStyle: "fenced"` is not
 *  optional here: with turndown's default the same input comes back as an
 *  INDENTED block, and the whitespace passes then treat its blank lines as
 *  ordinary ones. */
function td() {
  const t = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", emDelimiter: "*" });
  addBaseRules(t);
  addInlineStyleRule(t);
  return t;
}

/** The real md -> rich -> md path, stage for stage. */
function roundTrip(md) {
  const pre = preprocessMarkdown(md, { taskLists: true, frontmatter: true, wikiLinks: true });
  const html = buildMarked(DEFAULT_MARKDOWN_FEATURES).parse(pre, { async: false });
  const ed = new Editor({ extensions: [StarterKit], content: "" });
  ed.commands.setContent(html);
  const out = normalizeMarkdown(td().turndown(cleanHtmlForTurndown(ed.getHTML())));
  ed.destroy();
  return out;
}

const body = (md) => {
  const m = md.match(/```[a-z]*\n([\s\S]*?)```/);
  return m ? m[1] : null;
};

describe("fenced code round-trips byte for byte", () => {
  const CASES = {
    "blank lines inside the fence": "```js\nconst a = 1;\n\n\nconst b = 2;\n```\n",
    "a single blank line": "```js\nconst a = 1;\n\nconst b = 2;\n```\n",
    "trailing whitespace (a markdown line break in an example)": "```md\nline one  \nline two\n```\n",
    "leading indentation": "```py\ndef f():\n    if True:\n        return 1\n```\n",
    "characters the markdown passes would otherwise rewrite":
      "```md\n- [ ] not a task list\n[[not a wiki link]]\n{not a curly span}\n~~not struck~~\n```\n",
    // Tabs are code CONTENT (CommonMark). marked up to 14.1.0 expanded every
    // leading tab in the source to four spaces before it tokenised, fence
    // bodies included, and this suite pinned that deviation until marked
    // 14.1.1 fixed it upstream: a Makefile snippet is only a Makefile while
    // its recipe lines start with a tab.
    "leading tabs (a Makefile recipe)": "```make\nall:\n\tcc -o app main.c\n\t\t@echo done\n```\n",
    "tabs inside a line": "```go\nfunc main() {\n\tprintln(1)\t// one\n}\n```\n",
  };

  for (const [name, src] of Object.entries(CASES)) {
    it(`preserves ${name}`, () => {
      expect(body(roundTrip(src))).toBe(body(src));
    });
  }

  it("counts blank runs exactly, not approximately", () => {
    // The specific claim the browser probe got wrong.
    const out = roundTrip("```js\nconst a = 1;\n\n\nconst b = 2;\n```\n");
    expect(out.match(/const a = 1;(\n+)const b/)[1]).toBe("\n\n\n");
  });

  it("is a fixed point: a second pass changes nothing", () => {
    for (const src of Object.values(CASES)) {
      const once = roundTrip(src);
      expect(roundTrip(once)).toBe(once);
    }
  });
});
