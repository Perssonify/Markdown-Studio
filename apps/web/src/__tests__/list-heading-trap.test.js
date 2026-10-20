/**
 * "In an ordered list, when you press Enter and start a new empty item, it
 * shifts to heading" (PL-51).
 *
 * A setext underline under a list item's text — `1. foo` then `   -`, which is
 * what Enter, Backspace and `-` (or Tab on a new `- ` item) leave in the
 * markdown pane while a nested item is being started — makes that text an
 * `<h2>` inside the item (CommonMark, and marked). A ProseMirror list item must
 * START with a paragraph, so the rich pane hoisted the heading out of the list
 * and left an empty item behind; the next rich-pane edit then wrote `## foo`
 * and the list was gone. The md→rich projection escapes that underline.
 *
 * Its partner: an EMPTY item made by Enter in the rich pane was dropped from
 * the markdown (a blank node never reaches turndown's list rule).
 */
import { describe, expect, it } from "vitest";
import { escapeListSetextUnderlines } from "../engine/preprocessor";
import { engineFor, htmlRoundTrip, throughRichPane } from "./converter-harness";

const B = "\\";
const rich = (md) => throughRichPane(engineFor().mdToHtml(md)).json;
const topTypes = (json) => json.content.map((n) => n.type);

describe("a heading underline typed under a list item", () => {
  it.each([
    ["Enter, Backspace, - under an ordered item", "Steps\n\n1. foo\n   -"],
    ["…with the space after it", "1. foo\n   - "],
    ["Tab on a new bullet", "- foo\n  - "],
    ["a second item", "1. foo\n2. bar\n   -"],
    ["three dashes", "1. foo\n   ---"],
    ["an = underline", "1. foo\n   ="],
    ["a lazy === under the item", "1. foo\n==="],
    ["a nested item", "- a\n  - foo\n    -"],
    ["a task item", "- [ ] foo\n  -"],
  ])("%s: the item keeps its text, and no heading appears", (_name, md) => {
    const json = rich(md);
    expect(JSON.stringify(json)).not.toContain('"heading"');
    const list = json.content.find((n) => /List$/.test(n.type));
    expect(list, JSON.stringify(json)).toBeTruthy();
    expect(JSON.stringify(list)).toContain('"foo"');
  });

  it("is a nested list again as soon as the item has text", () => {
    const json = rich("1. foo\n   - bar");
    // (The schema keeps an empty paragraph after a list at the end.)
    expect(topTypes(json).filter((t) => t !== "paragraph")).toEqual(["orderedList"]);
    expect(json.content[0].content[0].content.map((n) => n.type)).toEqual(["paragraph", "bulletList"]);
  });

  it("leaves real headings, thematic breaks and sibling items alone", () => {
    expect(escapeListSetextUnderlines("Title\n-----\n\ntext")).toBe("Title\n-----\n\ntext");
    expect(escapeListSetextUnderlines("1. foo\n---")).toBe("1. foo\n---"); // a break after the list
    expect(escapeListSetextUnderlines("- foo\n-\n- bar")).toBe("- foo\n-\n- bar"); // an empty sibling item
    expect(escapeListSetextUnderlines("- a\n  - foo\n  -")).toBe("- a\n  - foo\n  -");
    expect(escapeListSetextUnderlines("1. foo\n\n   bar\n   -")).toBe("1. foo\n\n   bar\n   -"); // not the item's first block
    expect(escapeListSetextUnderlines("```\n1. foo\n   -\n```")).toBe("```\n1. foo\n   -\n```"); // code
    // Under a heading or a quote it is a thematic break, not an underline.
    expect(escapeListSetextUnderlines("- # Title\n  ---")).toBe("- # Title\n  ---");
    expect(escapeListSetextUnderlines("- > quoted\n  ---")).toBe("- > quoted\n  ---");
    expect(escapeListSetextUnderlines("1. foo\n   > bar\n   ---")).toBe("1. foo\n   > bar\n   ---");
  });

  it("escapes in place: same lines, only the underline changes", () => {
    expect(escapeListSetextUnderlines("1. foo\n   -")).toBe(`1. foo\n   ${B}-`);
    expect(escapeListSetextUnderlines("1. foo\n===")).toBe(`1. foo\n${B}===`);
    expect(escapeListSetextUnderlines("x\n\n- foo\n  - \n\ny").split("\n")).toHaveLength(6);
  });

  it("only the projection sees it: the markdown is unchanged", () => {
    // mdToHtml is the only caller (preprocessMarkdown); the markdown pane's
    // text never goes through it on the way back.
    const engine = engineFor();
    expect(engine.mdToHtml("1. foo\n   -")).not.toContain("<h2");
  });
});

describe("an empty list item made in the rich pane", () => {
  const md = (html) => htmlRoundTrip(html).md1;

  it("reaches the markdown as its bare marker, so the item is not lost", () => {
    expect(md("<ol><li><p>one</p></li><li><p>two</p></li><li><p></p></li></ol>")).toBe("1. one\n2. two\n3.");
    expect(md("<ul><li><p>a</p></li><li><p></p></li></ul>")).toBe("- a\n-");
  });

  it("mid-list keeps the list tight and the numbers in order", () => {
    expect(md("<ol><li><p>one</p></li><li><p></p></li><li><p>three</p></li></ol>")).toBe("1. one\n2.\n3. three");
  });

  it("and reads back as the same empty item", () => {
    const r = htmlRoundTrip("<ol><li><p>one</p></li><li><p></p></li><li><p>three</p></li></ol>");
    expect(r.json2.content[0].type).toBe("orderedList");
    expect(r.json2.content[0].content).toHaveLength(3);
    expect(r.md2).toBe(r.md1);
  });

  it("first in a NESTED list it is still left out — `1. foo⏎   -` would be a heading underline", () => {
    expect(md("<ol><li><p>foo</p><ul><li><p></p></li></ul></li></ol>")).toBe("1. foo");
  });
});
