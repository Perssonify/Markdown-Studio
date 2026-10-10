/**
 * Converter round-trip / idempotency suite.
 *
 * md → rich → md′ → rich → md″ through the REAL engine and schema (see
 * converter-harness.js). Two properties per case:
 *
 *   - STABLE: md′ === md″. A document that changes again on its second trip
 *     keeps drifting on every edit, and each drift reaches disk.
 *   - FAITHFUL: md′ === md where the input is already in the shape the
 *     serializer writes. Where it legitimately is not (turndown normalises
 *     list markers, table padding, …) the case asserts what must survive.
 *
 * Each block below was written against a reproduced defect from the external
 * production-readiness audit (IDs in the describe titles). Each was
 * mutation-tested: with the fix reverted, the case fails.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { cleanHtmlForTurndown } from "../engine/html-cleaner";
import { computeFidelity } from "../store/documents/fidelity";
import { engineFor, htmlRoundTrip, roundTrip } from "./converter-harness";

/** Assert the input survives two trips unchanged. */
function expectFixedPoint(md, opts) {
  const r = roundTrip(md, opts);
  expect(r.md1, "first trip changed the document").toBe(md);
  expect(r.md2, "second trip changed the document").toBe(md);
  return r;
}

describe("A037 — hard line breaks survive (addresses, verse)", () => {
  it("keeps every break of a multi-line paragraph", () => {
    const r = expectFixedPoint("Jane Doe\n12 Oak Street\nSpringfield\nUSA");
    expect(r.rich1.match(/<br>/g)).toHaveLength(3);
  });

  it("keeps the breaks of a stanza between other paragraphs", () => {
    expectFixedPoint("Intro.\n\nRoses are red\nViolets are blue\nSugar is sweet\n\nOutro.");
  });

  it("still collapses a genuine RUN of breaks to one", () => {
    // The pass exists for contentEditable's `<br><br>` debris; only its
    // sibling test was wrong.
    expect(cleanHtmlForTurndown("<p>a<br><br>b</p>")).toBe("<p>a<br>b</p>");
    expect(cleanHtmlForTurndown("<p>a<br> \n <br>b</p>")).toBe("<p>a<br> \n b</p>");
  });

  it("does not collapse breaks that have text between them", () => {
    expect(cleanHtmlForTurndown("<p>a<br>b<br>c<br>d</p>")).toBe("<p>a<br>b<br>c<br>d</p>");
    // A non-breaking space is content, not padding.
    expect(cleanHtmlForTurndown("<p>a<br> <br>b</p>").match(/<br>/g)).toHaveLength(2);
  });

  it("keeps breaks inside list items and table cells too", () => {
    const r = htmlRoundTrip("<ul><li><p>one<br>two<br>three</p></li></ul>");
    expect(r.md1).toBe("- one\n  two\n  three");
    expect(r.md2).toBe(r.md1);
  });
});

describe("A038 — content nested under a checklist item survives", () => {
  it("keeps a nested task list nested (content column is 2, not 6)", () => {
    const r = expectFixedPoint("- [ ] parent\n  - [x] child\n  - [ ] child2");
    // Structure, not just text: the child is a task item INSIDE the parent.
    const parent = r.json2.content[0].content[0];
    expect(parent.type).toBe("taskItem");
    expect(parent.content.map((n) => n.type)).toEqual(["paragraph", "taskList"]);
    expect(parent.content[1].content).toHaveLength(2);
  });

  it("keeps a nested ordered list", () => {
    const r = expectFixedPoint("- [ ] parent\n  1. one\n  2. two");
    expect(r.json2.content[0].content[0].content[1].type).toBe("orderedList");
  });

  it("keeps a nested bullet list three levels deep", () => {
    expectFixedPoint("- [ ] a\n  - [ ] b\n    - c\n    - d\n  - [x] e");
  });

  it("keeps a code block under a checklist item, blank lines and all", () => {
    const r = expectFixedPoint("- [ ] parent\n\n  ```js\n  const a = 1;\n\n  const b = 2;\n  ```");
    const item = r.json2.content[0].content[0];
    expect(item.content.map((n) => n.type)).toEqual(["paragraph", "codeBlock"]);
    // (marked's <code> ends in a newline, and the code block keeps it.)
    expect(item.content[1].content[0].text).toBe("const a = 1;\n\nconst b = 2;\n");
  });
});

describe("A041 — list items keep their blank lines", () => {
  it("keeps blank lines inside a fenced code block in a list item", () => {
    const r = expectFixedPoint("- item\n\n  ```js\n  a\n\n\n  b\n  ```\n- two");
    const code = r.json2.content[0].content[0].content[1];
    expect(code.type).toBe("codeBlock");
    expect(code.content[0].text).toBe("a\n\n\nb\n");
  });

  it("keeps two paragraphs in one item as two paragraphs", () => {
    const r = expectFixedPoint("- para one\n\n  para two\n- next");
    const first = r.json2.content[0].content[0];
    expect(first.content.map((n) => n.type)).toEqual(["paragraph", "paragraph"]);
  });

  it("keeps an ordered item's blocks under its wider content column", () => {
    const r = expectFixedPoint("1. first\n\n   > quoted\n2. second");
    expect(r.json2.content[0].content[0].content[1].type).toBe("blockquote");
  });

  it("still prints an ordinary nested list tight", () => {
    expectFixedPoint("- a\n  - b\n  - c\n- d");
    expectFixedPoint("1. a\n   1. b\n2. c");
  });

  it("keeps a loose nested item's blank lines when its parent is tight", () => {
    // The parent's own separator is the only blank line it may remove.
    expectFixedPoint("- outer\n  - inner para\n\n    ```\n    x\n\n    y\n    ```");
  });
});

describe("A044 — tables keep alignment and in-cell formatting", () => {
  it("keeps every column alignment, including an explicit left", () => {
    const md = "| a   | b   | c   | d   |\n| :-- | :-: | --: | --- |\n| 1   | 2   | 3   | 4   |";
    const r = expectFixedPoint(md);
    const header = r.json2.content[0].content[0].content;
    expect(header.map((c) => c.attrs.align)).toEqual(["left", "center", "right", null]);
    // …and shows it: the attribute renders as an inline text-align.
    expect(r.rich2).toMatch(/<th style="text-align: center;?"/);
  });

  it("keeps strikethrough and a sized image inside a cell", () => {
    const r = roundTrip('| a | b |\n| --- | --- |\n| ~~x~~ | <img src="a.png" width="20"> |');
    expect(r.md1).toContain("~~x~~");
    expect(r.md1).toContain('width="20"');
    const cells = r.json2.content[0].content[1].content;
    expect(cells[0].content[0].content[0].marks.map((m) => m.type)).toEqual(["strike"]);
    expect(cells[1].content[0].content[0].attrs.width).toBe("20");
    expect(r.md2).toBe(r.md1);
  });

  it("keeps a hard break inside a cell as a break", () => {
    const r = roundTrip("| h |\n| --- |\n| one<br>two |");
    const para = r.json2.content[0].content[1].content[0].content[0];
    expect(para.content.map((n) => n.type)).toEqual(["text", "hardBreak", "text"]);
    expect(r.md2).toBe(r.md1);
  });

  it("gives a cell the Clean/Styled treatment the rest of the document gets", () => {
    const html =
      '<table><tbody><tr><th><p>h</p></th></tr><tr><td><p><span style="color: #ff0000">red</span></p></td></tr></tbody></table>';
    expect(htmlRoundTrip(html, { mode: "clean" }).md1).not.toContain("<span");
    // (the colour comes back CSSOM-normalised, e.g. rgb(255, 0, 0))
    expect(htmlRoundTrip(html, { mode: "styled" }).md1).toMatch(/<span style="color: [^"]+">red<\/span>/);
  });

  it("reports what a markdown table cannot carry", () => {
    const cell = (content, attrs = {}) => ({ type: "tableCell", attrs: { colspan: 1, rowspan: 1, ...attrs }, content });
    const p = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const table = (cells) => ({ type: "doc", content: [{ type: "table", content: [{ type: "tableRow", content: cells }] }] });
    expect(computeFidelity(table([cell([p("a")])])).lossless).toBe(true);
    expect(computeFidelity(table([cell([p("a"), p("b")])])).lossless).toBe(false);
    expect(computeFidelity(table([cell([p("a")], { colspan: 2 })])).lossless).toBe(false);
  });

  it("is registered in BOTH schemas (the headless export mirrors the live editor)", () => {
    const pane = readFileSync(join(process.cwd(), "src/ui/TiptapPane.tsx"), "utf8");
    const headless = readFileSync(join(process.cwd(), "src/engine/serialize-doc.ts"), "utf8");
    expect(pane).toMatch(/TableHeader, TableCellAlign/);
    expect(headless).toMatch(/\n\s+TableCellAlign,\r?\n/);
  });
});

describe("A043 — footnotes survive a rich-pane edit", () => {
  const features = { footnotes: true };

  it("keeps a numbered footnote as footnote syntax", () => {
    const r = expectFixedPoint("A claim[^1].\n\n[^1]: The source.", { features });
    // …and it really was rendered as a footnote in between, not left as text.
    expect(r.html1).toContain("data-footnote-ref");
  });

  it("keeps a named label (the rich pane shows its number, the source keeps the name)", () => {
    expectFixedPoint("Text[^note] and again[^note].\n\n[^note]: A named note.", { features });
  });

  it("keeps several footnotes and a multi-paragraph definition", () => {
    expectFixedPoint("A[^1] and B[^2].\n\n[^1]: One.\n[^2]: Two, first paragraph.\n\n    Second paragraph.", { features });
  });

  it("converts the renderer's own markup too (the import path skips the rich pane)", () => {
    // marked writes <sup><a>1</a></sup>; the rich pane re-nests it as <a><sup>.
    const engine = engineFor(features);
    const md = "A claim[^1].\n\n[^1]: The source.";
    expect(engine.htmlToMd(engine.mdToHtml(md))).toBe(md);
  });

  it("keeps footnote syntax even when footnotes are switched off later", () => {
    // Written back as markdown, not as a link and a numbered list — so the
    // footnote is still there the moment the feature is switched back on.
    const on = roundTrip("A claim[^1].\n\n[^1]: The source.", { features });
    const off = htmlRoundTrip(on.rich1, { features: { footnotes: false } });
    expect(off.md1).toBe("A claim[^1].\n\n[^1]: The source.");
  });
});

describe("A051 — assorted drift", () => {
  it("keeps a heading that ends in ` #`", () => {
    const r = htmlRoundTrip("<h2>Learn C #</h2>");
    expect(r.md1).toBe("## Learn C \\#");
    expect(r.json2.content[0].content[0].text).toBe("Learn C #");
    expect(r.md2).toBe(r.md1);
  });

  it("keeps a <details> whose code has blank lines in one block", () => {
    const html = "<details open><summary>More</summary><pre><code>a\n\n\nb</code></pre><p>after</p></details>";
    const r = htmlRoundTrip(html);
    const details = r.json2.content[0];
    expect(details.type).toBe("details");
    expect(details.content.map((n) => n.type)).toEqual(["summary", "codeBlock", "paragraph"]);
    expect(details.content[1].content[0].text).toBe("a\n\n\nb");
    expect(r.md2).toBe(r.md1);
  });

  it("keeps an inline theme image inside its paragraph", () => {
    const md =
      'Logo <picture><source media="(prefers-color-scheme: dark)" srcset="d.png"><img src="l.png" alt="x"></picture> inline text.';
    const r = roundTrip(md);
    expect(r.json1.content).toHaveLength(1);
    expect(r.json2.content).toHaveLength(1);
    expect(r.json2.content[0].content.map((n) => n.type)).toEqual(["text", "themeImage", "text"]);
    expect(r.md2).toBe(r.md1);
  });

  it("still writes a picture that is alone in its paragraph on its own lines", () => {
    const r = roundTrip(
      '<picture><source media="(prefers-color-scheme: dark)" srcset="d.png"><img src="l.png" alt="x"></picture>\n\nText'
    );
    expect(r.md1.startsWith("<picture>")).toBe(true);
    expect(r.md1).toContain("</picture>\n\nText");
  });
});
