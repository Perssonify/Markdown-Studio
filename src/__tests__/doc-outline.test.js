import { describe, expect, it } from "vitest";
import { ancestorHeadingIndices, buildHeadingTree, extractHeadings } from "../store/doc-outline";

const heading = (level, text) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});

describe("extractHeadings", () => {
  it("returns [] for empty/invalid canonical", () => {
    expect(extractHeadings(null)).toEqual([]);
    expect(extractHeadings(undefined)).toEqual([]);
    expect(extractHeadings({})).toEqual([]);
    expect(extractHeadings({ type: "doc", content: [] })).toEqual([]);
  });

  it("extracts headings in document order with levels", () => {
    const doc = {
      type: "doc",
      content: [
        heading(1, "Title"),
        { type: "paragraph", content: [{ type: "text", text: "body" }] },
        heading(2, "Section"),
        heading(3, "Sub"),
      ],
    };
    const out = extractHeadings(doc);
    expect(out.map((h) => h.text)).toEqual(["Title", "Section", "Sub"]);
    expect(out.map((h) => h.level)).toEqual([1, 2, 3]);
    // ids are unique even when text repeats
    expect(new Set(out.map((h) => h.id)).size).toBe(3);
  });

  it("clamps levels to 1..6 and keeps empty headings as (untitled) for DOM index parity", () => {
    const doc = {
      type: "doc",
      content: [heading(0, "Zero"), heading(9, "Nine"), { type: "heading", attrs: { level: 2 }, content: [] }],
    };
    const out = extractHeadings(doc);
    // Empty headings still render as <h*> elements — they must stay in the
    // flat list so outline index N always matches DOM heading N.
    expect(out).toHaveLength(3);
    expect(out[0].level).toBe(1);
    expect(out[1].level).toBe(6);
    expect(out[2].text).toBe("(untitled)");
  });

  it("finds headings nested inside other blocks", () => {
    const doc = {
      type: "doc",
      content: [{ type: "blockquote", content: [heading(2, "Quoted")] }],
    };
    expect(extractHeadings(doc).map((h) => h.text)).toEqual(["Quoted"]);
  });

  it("honors the limit", () => {
    const doc = { type: "doc", content: Array.from({ length: 50 }, (_, i) => heading(1, `H${i}`)) };
    expect(extractHeadings(doc, 10)).toHaveLength(10);
  });
});

describe("buildHeadingTree", () => {
  const h = (level, text) => ({ id: text, level, text });

  it("nests deeper headings under shallower ones", () => {
    const tree = buildHeadingTree([h(1, "A"), h(2, "A1"), h(2, "A2"), h(3, "A2a")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].text).toBe("A");
    expect(tree[0].children.map((c) => c.text)).toEqual(["A1", "A2"]);
    expect(tree[0].children[1].children.map((c) => c.text)).toEqual(["A2a"]);
  });

  it("preserves the flat document-order index for navigation", () => {
    const tree = buildHeadingTree([h(1, "A"), h(2, "A1"), h(1, "B")]);
    expect(tree[0].index).toBe(0);
    expect(tree[0].children[0].index).toBe(1);
    expect(tree[1].index).toBe(2);
  });

  it("handles level gaps without creating empty nodes (H1 -> H3)", () => {
    const tree = buildHeadingTree([h(1, "A"), h(3, "deep")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((c) => c.text)).toEqual(["deep"]);
  });

  it("supports multiple roots and documents that open below H1", () => {
    expect(buildHeadingTree([h(1, "A"), h(1, "B")]).map((n) => n.text)).toEqual(["A", "B"]);
    const opensAtH2 = buildHeadingTree([h(2, "X"), h(3, "X1"), h(2, "Y")]);
    expect(opensAtH2.map((n) => n.text)).toEqual(["X", "Y"]);
    expect(opensAtH2[0].children.map((c) => c.text)).toEqual(["X1"]);
  });

  it("returns [] for no headings", () => {
    expect(buildHeadingTree([])).toEqual([]);
  });
});

describe("ancestorHeadingIndices", () => {
  // Levels: [H1, H2, H3, H2, H1]  (indices 0..4)
  const H = [{ level: 1 }, { level: 2 }, { level: 3 }, { level: 2 }, { level: 1 }];

  it("returns [] for a top-level heading (no parent)", () => {
    expect(ancestorHeadingIndices(H, 0)).toEqual([]);
    expect(ancestorHeadingIndices(H, 4)).toEqual([]);
  });

  it("returns the parent chain root-first", () => {
    expect(ancestorHeadingIndices(H, 2)).toEqual([0, 1]); // H3 → [H1, H2]
    expect(ancestorHeadingIndices(H, 1)).toEqual([0]);    // H2 → [H1]
    expect(ancestorHeadingIndices(H, 3)).toEqual([0]);    // second H2 → [H1] (skips the H3)
  });

  it("returns [] for null/out-of-range indices", () => {
    expect(ancestorHeadingIndices(H, null)).toEqual([]);
    expect(ancestorHeadingIndices(H, -1)).toEqual([]);
    expect(ancestorHeadingIndices(H, 99)).toEqual([]);
  });

  it("handles a level gap (H1 then H4)", () => {
    expect(ancestorHeadingIndices([{ level: 1 }, { level: 4 }], 1)).toEqual([0]);
  });
});
