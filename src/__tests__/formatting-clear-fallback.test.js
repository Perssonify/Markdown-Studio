/**
 * Clear formatting (markdown pane) without lookbehind support.
 *
 * clearMdFormatting's emphasis passes need the delimiter's left neighbour.
 * They are compiled from strings at runtime because a lookbehind regex LITERAL
 * is a parse-time SyntaxError on Safari/iOS < 16.4 and would blank the app
 * (A097); where lookbehind is unsupported the same check runs as a captured
 * left neighbour. This pins the fallback to the primary passes on the inputs
 * the A055 fix was about, so an old browser clears formatting the same way.
 */
import { describe, expect, it } from "vitest";
import { emphasisPasses } from "../formatting/md-format-utils";

function strip(text, passes) {
  let t = text;
  for (let round = 0; round < 6; round++) {
    const before = t;
    for (const [re, rep] of passes) t = t.replace(re, rep);
    if (t === before) break;
  }
  return t;
}

const SAMPLES = [
  "**bold** and *italic* and _under_ and __strong__",
  "5 * 3 * 2 stays arithmetic",
  "snake_case_name and __init__ stay put",
  "***both*** at once",
  "*a* *b* next to each other",
  "- a list bullet *with* emphasis",
  "~~gone~~ but ~ tilde stays",
  "line one *x*\n_y_ on line two",
  "word*inside*word and _edge_ case",
];

describe("emphasis passes without lookbehind", () => {
  it.each(SAMPLES)("match the primary passes: %s", (sample) => {
    expect(strip(sample, emphasisPasses(false))).toBe(strip(sample, emphasisPasses(true)));
  });

  it("really strip formatting (the equivalence is not vacuous)", () => {
    expect(strip("**bold** and *italic* and _under_", emphasisPasses(false))).toBe("bold and italic and under");
  });
});
