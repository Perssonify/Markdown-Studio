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
import { DEFAULT_MARKDOWN_FEATURES } from "../store/settings";

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
  };

  for (const [name, src] of Object.entries(CASES)) {
    it(`preserves ${name}`, () => {
      expect(body(roundTrip(src))).toBe(body(src));
    });
  }

  // KNOWN DEVIATION, pre-existing and NOT fixed here. marked expands leading
  // tabs to four spaces for every line of the source before it tokenises —
  // `blockTokens` does `src.replace(/^( *)(\t+)/gm, ...)` unconditionally, not
  // only in pedantic mode — so tabs inside a fence are expanded too. CommonMark
  // says tabs in code CONTENT are preserved, so this is a marked deviation, and
  // it matters: a Makefile snippet is not a Makefile once its tabs are spaces.
  //
  // TODO(markdown-engine): preserve tabs inside a fence. Fixing it means
  // masking fence bodies across marked's own lexer (its preprocess/postprocess
  // hooks are the place), which is a change to the whole markdown rendering
  // path and deserves its own verification rather than riding along.
  //
  // This was an `it.fails` — a trap, not a signal: vitest reports a passing
  // `fails` test as a FAILURE, so the day someone fixed the bug CI would go red
  // and blame the fix. The deviation is pinned below as the behaviour it
  // actually is; when it changes, that assertion fails and names the reason.
  it("documents exactly what happens to a tab today (a marked deviation)", () => {
    const src = "```go\nfunc main() {\n\tprintln(1)\n}\n```\n";
    expect(body(roundTrip(src))).toBe("func main() {\n    println(1)\n}\n");
  });

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
