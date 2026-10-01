import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { SERIALIZE_EXTENSIONS } from "../engine/serialize-doc";
import { createMarkdownEngine } from "../engine/useMarkdownEngine";
import { canonicalJsonText, canonicalOf } from "../store/canonical-json";
import { computeCounts } from "../store/document";
import { DEFAULT_MARKDOWN_FEATURES } from "../store/settings";

/**
 * A083 — a save of a large note serialized the whole document, and counted
 * its words, from scratch. The editor's canonical is now built from each
 * block's cached JSON (canonicalOf), its TEXT from each block's cached text
 * (canonicalJsonText), and its counts from each block's cached counts
 * (computeCounts). Each must equal the plain computation exactly, whatever
 * changed, and fall back to it for anything it did not build.
 */

const engine = createMarkdownEngine(() => DEFAULT_MARKDOWN_FEATURES);
const MD = [
  "# Title with **bold**, *em* and `code`",
  "Para one with a [link](https://example.com) and ~~strike~~ and $x^2$.",
  "- a\n- b\n  - nested\n- [ ] task\n- [x] done",
  "| a | b |\n| :-- | --: |\n| 1 | <u>2</u> |",
  "> [!NOTE]\n> callout",
  "```js\nconst a = 1;\n```",
  "Line one  \nhard break, 東京 and Привет мир, emoji :smile:",
  "<details><summary>S</summary>\n\nbody\n\n</details>",
  "$$\n\\int x\\,dx\n$$",
].join("\n\n");

let ed;
afterEach(() => { ed?.destroy(); ed = null; });

function editor(md = MD) {
  ed = new Editor({ extensions: SERIALIZE_EXTENSIONS, content: "" });
  ed.commands.setContent(engine.mdToHtml(md), { emitUpdate: false });
  return ed;
}

describe("canonicalOf / canonicalJsonText", () => {
  it("is getJSON(), and its text is JSON.stringify's, byte for byte", () => {
    const e = editor();
    const c = canonicalOf(e);
    expect(c).toEqual(e.getJSON());
    expect(canonicalJsonText(c)).toBe(JSON.stringify(c));
    expect(canonicalJsonText(c)).toBe(JSON.stringify(e.getJSON()));
  });

  it("stays exact through edits, reusing every unchanged block's JSON", () => {
    const e = editor();
    const before = canonicalOf(e);
    canonicalJsonText(before); // fill the text cache
    e.commands.setTextSelection(3);
    e.commands.insertContent("typed ");
    const after = canonicalOf(e);
    expect(canonicalJsonText(after)).toBe(JSON.stringify(e.getJSON()));
    let shared = 0;
    for (let k = 0; k < after.content.length; k++) if (after.content[k] === before.content[k]) shared++;
    expect(shared).toBe(after.content.length - 1); // only the heading changed
    // Delete a block, add one at the end, change marks: still exact.
    const { state } = e;
    e.view.dispatch(state.tr.delete(0, state.doc.child(0).nodeSize));
    e.commands.insertContentAt(e.state.doc.content.size, "<p>end <strong>bold</strong></p>");
    expect(canonicalJsonText(canonicalOf(e))).toBe(JSON.stringify(e.getJSON()));
  });

  it("falls back to JSON.stringify for anything it did not build, or that changed since", () => {
    const e = editor();
    const plain = e.getJSON();
    expect(canonicalJsonText(plain)).toBe(JSON.stringify(plain));
    // A block replaced in the array…
    const swapped = canonicalOf(e);
    swapped.content[1] = { type: "paragraph", content: [{ type: "text", text: "swapped in" }] };
    expect(canonicalJsonText(swapped)).toBe(JSON.stringify(swapped));
    // …a block added…
    const grown = canonicalOf(e);
    grown.content.push({ type: "paragraph" });
    expect(canonicalJsonText(grown)).toBe(JSON.stringify(grown));
    // …or a key added to the document.
    const keyed = canonicalOf(e);
    keyed.extra = 1;
    expect(canonicalJsonText(keyed)).toBe(JSON.stringify(keyed));
  });

  it("gives an editor with no document its own getJSON()", () => {
    const json = { type: "doc", content: [{ type: "paragraph" }] };
    expect(canonicalOf({ getJSON: () => json })).toBe(json);
    expect(canonicalOf({ state: null, getJSON: () => json })).toBe(json);
  });
});

describe("computeCounts per block", () => {
  /** The single walk it replaced, as a reference. */
  function walked(c) {
    return computeCounts({ type: "doc", content: [{ type: "text", text: "" }, ...(c.content ?? [])] });
  }

  it("equals one walk of the whole document — words never run across blocks", () => {
    const e = editor();
    const c = canonicalOf(e);
    expect(computeCounts(c)).toEqual(walked(c));
    // A four-item list is four words, not one.
    expect(computeCounts({ type: "doc", content: ["a", "b", "c", "d"].map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })) }).words).toBe(4);
  });

  it("counts a changed block afresh, and an unchanged one from its cache", () => {
    const e = editor("one two\n\nthree four");
    expect(computeCounts(canonicalOf(e))).toEqual({ words: 4, chars: 17 });
    e.commands.setTextSelection(2);
    e.commands.insertContent("x ");
    const c = canonicalOf(e);
    expect(computeCounts(c)).toEqual(walked(c));
    expect(computeCounts(c).words).toBe(5);
  });

  it("walks a document with text at the top, where a word may run on", () => {
    const odd = { type: "doc", content: [{ type: "text", text: "un" }, { type: "text", text: "broken" }] };
    expect(computeCounts(odd)).toEqual({ words: 1, chars: 8 });
  });
});
