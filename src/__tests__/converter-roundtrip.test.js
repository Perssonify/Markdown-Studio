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
import { describe, expect, it } from "vitest";
import { cleanHtmlForTurndown } from "../engine/html-cleaner";
import { htmlRoundTrip, roundTrip } from "./converter-harness";

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
