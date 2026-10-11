import { describe, expect, it } from "vitest";
import { computeCounts } from "../store/documents/document";
import { computeCanonicalStats, computeFidelity } from "../store/documents/fidelity";

/**
 * The status bar's word count and fidelity report are recomputed on every
 * projection. Two things are pinned here:
 *
 * 1. A node boundary ends a word. Only adjacent TEXT nodes (which differ only
 *    in marks) continue one; paragraphs, headings, list items, cells and hard
 *    breaks do not. The counter used to run the last word of each block into
 *    the first of the next, so a four-item list was ONE word.
 * 2. computeCanonicalStats caches per top-level block (A083) and must equal a
 *    walk of the whole document — computeCounts and computeFidelity, which do
 *    not use the cache, are the reference.
 */

const text = (t, marks) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });
const para = (...c) => ({ type: "paragraph", content: c });
const heading = (t, align) => ({ type: "heading", attrs: { level: 2, textAlign: align ?? null }, content: [text(t)] });
const doc = (...c) => ({ type: "doc", content: c });
const list = (...items) => ({ type: "bulletList", content: items.map((t) => ({ type: "listItem", content: [para(text(t))] })) });
const COLOR = (c) => [{ type: "textStyle", attrs: { color: c, fontFamily: null } }];

describe("word boundaries", () => {
  const words = (d) => computeCounts(d).words;
  const both = (d) => {
    const w = words(d);
    expect(computeCanonicalStats(d).counts.words).toBe(w);
    return w;
  };

  it("a block boundary ends a word", () => {
    expect(both(doc(para(text("Hello world")), para(text("Second line"))))).toBe(4);
    expect(both(doc(heading("Title"), para(text("Body text"))))).toBe(3);
    expect(both(doc(list("milk", "eggs", "bread", "coffee")))).toBe(4);
  });

  it("a hard break ends a word", () => {
    expect(both(doc(para(text("line1"), { type: "hardBreak" }, text("line2"))))).toBe(2);
  });

  it("table cells are separate words", () => {
    const cell = (t) => ({ type: "tableCell", attrs: {}, content: [para(text(t))] });
    const table = { type: "table", content: [{ type: "tableRow", content: [cell("a"), cell("b"), cell("c")] }] };
    expect(both(doc(table))).toBe(3);
  });

  it("formatting inside a word does not split it", () => {
    expect(both(doc(para(text("un"), text("believ", [{ type: "bold" }]), text("able"))))).toBe(1);
  });

  it("unspaced scripts still segment within a block, and blocks stay separate", () => {
    const one = both(doc(para(text("東京は日本の首都です"))));
    expect(one).toBeGreaterThan(1);
    expect(both(doc(para(text("東京は日本の首都です")), para(text("東京は日本の首都です"))))).toBe(one * 2);
  });

  it("characters are unchanged by word boundaries", () => {
    const d = doc(para(text("one two")), para(text("three")));
    expect(computeCounts(d).chars).toBe(12);
    expect(computeCanonicalStats(d).counts.chars).toBe(12);
  });
});

describe("per-block stats cache", () => {
  function rng(seed) {
    let s = seed >>> 0;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  }
  const WORDS = ["alpha", "beta", "東京は", "gamma delta", " ", "x", "日本の首都です"];
  function randomBlock(r) {
    const k = Math.floor(r() * 5);
    const w = () => WORDS[Math.floor(r() * WORDS.length)];
    if (k === 0) return heading(w(), r() < 0.3 ? "center" : null);
    if (k === 1) return list(w(), w());
    if (k === 2) return para(text(w(), r() < 0.5 ? COLOR(r() < 0.5 ? "red" : "blue") : undefined), text(w()));
    if (k === 3) return para(text(w()), { type: "hardBreak" }, text(w(), [{ type: "highlight", attrs: { color: "yellow" } }]));
    return para(text(w()));
  }
  const reference = (d, mode) => ({ fidelity: computeFidelity(d, mode), counts: computeCounts(d) });

  it.each([1, 2, 3, 4, 5, 6])("equals a whole-document walk through a random edit sequence (seed %i)", (seed) => {
    const r = rng(seed);
    let blocks = Array.from({ length: 30 }, () => randomBlock(r));
    for (let step = 0; step < 40; step++) {
      // Keep untouched blocks as the SAME objects, as the sync engine does.
      const i = Math.floor(r() * blocks.length);
      const op = Math.floor(r() * 3);
      blocks = blocks.slice();
      if (op === 0) blocks[i] = randomBlock(r);
      else if (op === 1) blocks.splice(i, 0, randomBlock(r));
      else if (blocks.length > 1) blocks.splice(i, 1);
      const d = doc(...blocks);
      for (const mode of ["clean", "styled"]) {
        expect(computeCanonicalStats(d, mode), `seed ${seed} step ${step} ${mode}`).toEqual(reference(d, mode));
      }
    }
  });

  it("repeated calls do not accumulate counts into the cached entries", () => {
    const d = doc(para(text("red", COLOR("red"))), para(text("red again", COLOR("red"))));
    const first = computeCanonicalStats(d);
    const again = computeCanonicalStats(d);
    const third = computeCanonicalStats(doc(...d.content));
    expect(again).toEqual(first);
    expect(third).toEqual(first);
    expect(first.fidelity.totalLossCount).toBe(2);
  });

  it("keeps the two sync modes apart for the same block objects", () => {
    const d = doc(para(text("red", COLOR("red"))));
    expect(computeCanonicalStats(d, "styled").fidelity.lossless).toBe(true);
    expect(computeCanonicalStats(d, "clean").fidelity.lossless).toBe(false);
    expect(computeCanonicalStats(d, "styled").fidelity.lossless).toBe(true);
  });

  it("is keyed on block identity — the canonical is read, never mutated in place", () => {
    // Pins that the cache is actually used (and documents its one contract):
    // editing a cached block object in place is NOT seen; the sync engine
    // builds a new JSON object for any block that changed.
    const block = para(text("one two three"));
    const d = doc(block);
    expect(computeCanonicalStats(d).counts.words).toBe(3);
    block.content[0].text = "one";
    expect(computeCanonicalStats(doc(block)).counts.words).toBe(3);
    expect(computeCanonicalStats(doc(para(text("one")))).counts.words).toBe(1);
  });
});
