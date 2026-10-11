import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { __setWordSegmenterForTests, computeCounts } from "../store/documents/document";
import { extractHeadings, findHeadingByAnchor, normalizeHeadingAnchor } from "../store/documents/doc-outline";
import { computeCanonicalStats } from "../store/documents/fidelity";

const heading = (level, text) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const text = (t) => ({ type: "text", text: t });
const para = (...content) => ({ type: "paragraph", content });
const doc = (...content) => ({ type: "doc", content });

/**
 * A063. extractHeadings defaulted to 40 headings — a cap meant for the removed
 * in-graph structure view — and the Outline, "Link to heading" and doc.outline
 * all inherited it.
 */
describe("extractHeadings has no hidden cap (A063)", () => {
  it("returns every heading of a long document by default", () => {
    const d = doc(...Array.from({ length: 120 }, (_, i) => heading(2, `Section ${i}`)));
    const out = extractHeadings(d);
    expect(out).toHaveLength(120);
    expect(out[119].text).toBe("Section 119");
  });

  it("still honours an explicit limit", () => {
    const d = doc(...Array.from({ length: 120 }, (_, i) => heading(2, `S${i}`)));
    expect(extractHeadings(d, 10)).toHaveLength(10);
  });
});

/**
 * A098 — heading anchors. The normaliser was `[^a-z0-9]`: every Cyrillic, CJK
 * or Arabic heading became "", so `[[#Заключение]]` jumped to the FIRST
 * non-Latin heading, and "Über" matched "ber".
 */
describe("heading anchors in every script (A098)", () => {
  it("keeps non-Latin letters", () => {
    expect(normalizeHeadingAnchor("Заключение")).toBe("заключение");
    expect(normalizeHeadingAnchor("Über uns")).toBe("über uns");
    expect(normalizeHeadingAnchor("東京の概要")).toBe("東京の概要");
    expect(normalizeHeadingAnchor("خاتمة")).toBe("خاتمة");
  });

  it("finds the RIGHT non-Latin heading, not the first one", () => {
    expect(findHeadingByAnchor(["Введение", "Заключение"], "Заключение")).toBe(1);
    expect(findHeadingByAnchor(["概要", "結論"], "結論")).toBe(1);
    expect(findHeadingByAnchor(["مقدمة", "خاتمة"], "خاتمة")).toBe(1);
  });

  it("does not match 'Über' to 'ber'", () => {
    expect(findHeadingByAnchor(["ber", "Über"], "Über")).toBe(1);
  });

  it("is NFKC-insensitive (precomposed vs combining, full-width digits)", () => {
    expect(findHeadingByAnchor(["Intro", "Café"], "Café")).toBe(1);
    expect(findHeadingByAnchor(["Other", "Step ＡＢＣ１"], "step abc1")).toBe(1);
  });

  it("stays tolerant of punctuation and spacing", () => {
    expect(findHeadingByAnchor(["Setup: Part 1"], "setup — part 1")).toBe(0);
  });

  it("keeps combining marks, so headings differing only in vowel signs stay distinct", () => {
    // की and कि differ ONLY in the vowel sign (a combining mark). Strip marks
    // and both become "क": the anchor would open the wrong section.
    expect(findHeadingByAnchor(["की", "कि"], "कि")).toBe(1);
  });

  it("compares an emoji-only anchor on its exact text instead of colliding on ''", () => {
    expect(findHeadingByAnchor(["🚀", "🎉"], "🎉")).toBe(1);
    expect(findHeadingByAnchor(["🚀"], "🎉")).toBe(-1);
  });

  it("returns -1 when nothing matches", () => {
    expect(findHeadingByAnchor(["Alpha"], "Beta")).toBe(-1);
  });

  it("is the matcher the editor's anchor navigation actually uses", () => {
    // Source pin: PerssonifyEditor cannot be mounted in a unit test, and the
    // defect was a SECOND, private normaliser living there. The navigation now
    // lives in src/editor/useHeadingNavigation.ts.
    const codeOnly = (p) => readFileSync(join(process.cwd(), p), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, ""); // code only — a comment may quote the old regex
    const src = codeOnly("src/editor/useHeadingNavigation.ts");
    const start = src.indexOf("const scrollToHeadingByAnchor");
    const nav = src.slice(start, src.indexOf("const handleNavigateHeading", start));
    expect(start).toBeGreaterThan(-1);
    expect(nav).toContain("findHeadingByAnchor(");
    expect(nav).not.toMatch(/\[\^a-z0-9\]/);
    // …and it is what the editor's anchor links actually navigate with.
    const pe = codeOnly("src/PerssonifyEditor.tsx");
    expect(pe).toMatch(/scrollToHeadingByAnchor[^}]*\} = useHeadingNavigation\(/);
    expect(pe).toContain("onAnchorNavigate: scrollToHeadingByAnchor,");
    expect(pe).not.toMatch(/\[\^a-z0-9\]/);
  });
});

/**
 * A098 — word counts. A Japanese or Thai paragraph has no spaces, so it was
 * ONE word.
 */
describe("word counts for scripts written without spaces (A098)", () => {
  afterEach(() => __setWordSegmenterForTests(undefined));

  const words = (...runs) => computeCounts(doc(para(...runs.map(text)))).words;

  it("segments Japanese and Thai", () => {
    expect(words("東京は日本の首都です。")).toBe(6);
    expect(words("สวัสดีครับ")).toBe(2);
  });

  it("mixes with spaced text", () => {
    expect(words("Hello 世界")).toBe(2);
    expect(words("東京Tower")).toBe(2);
  });

  it("segments a run that spans text nodes as one run", () => {
    // "東京" + "は日本" is one unbroken run: 東京 | は | 日本.
    expect(words("東京", "は日本")).toBe(3);
    expect(words("東京", "は日本", " next")).toBe(4);
  });

  it("leaves spaced scripts exactly as before", () => {
    expect(words("e-mail don't 3.14")).toBe(3);   // the whitespace rule, not the segmenter's 4
    expect(words("안녕하세요 세계")).toBe(2);        // Korean is spaced
    expect(words("foo", "bar baz")).toBe(2);       // adjacent nodes still join
  });

  it("the single-walk stats path agrees", () => {
    const d = doc(para(text("東京は"), text("日本の首都です。")), para(text("Hello world")));
    expect(computeCanonicalStats(d).counts).toEqual(computeCounts(d));
    // The paragraphs still JOIN into one run ("…です。Hello", as they always
    // have for every script), but segmentation splits it at the punctuation:
    // six Japanese words + Hello + world.
    expect(computeCounts(d).words).toBe(8);
  });

  it("falls back to one word per Han/kana character without Intl.Segmenter", () => {
    __setWordSegmenterForTests(null);
    expect(words("東京は日本")).toBe(5);
    expect(words("東京Tower")).toBe(3);
  });
});
