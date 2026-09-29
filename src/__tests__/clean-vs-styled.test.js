import { describe, expect, it } from "vitest";
import TurndownService from "turndown";
import { addBaseRules, addInlineStyleRule } from "../engine/turndown-rules";

/**
 * What the Help page and README PROMISE about Clean vs Styled, pinned.
 *
 * The two claims are easy to get wrong from reading, and the docs did get them
 * wrong: "Styled keeps underline, sub/sup, colour, highlight, font and image
 * sizing; Clean strips them" lumps together two different mechanisms. Underline,
 * sub/sup, strikethrough and image sizing come from `addBaseRules`, which BOTH
 * turndown instances get — they survive Clean. Only the `<span style="…">`
 * carrier (`addInlineStyleRule`, colour / highlight / font family) is
 * Styled-only. And text alignment has no carrier at all, in either mode: it is
 * the one formatting feature with no markdown and no inline-HTML representation,
 * which is why the toolbar and menu tooltips say so and `fidelity.ts` counts it.
 *
 * Mirrors `useMarkdownEngine`'s two instances (`tdClean` / `tdInline`).
 */
const turndownFor = (mode) => {
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", emDelimiter: "*" });
  addBaseRules(td);
  if (mode === "styled") addInlineStyleRule(td);
  return td;
};

const md = (mode, html) => turndownFor(mode).turndown(html);

describe("Clean vs Styled — what each mode actually carries", () => {
  it("carries underline, sub/sup, strikethrough and image sizing in BOTH modes", () => {
    for (const mode of ["clean", "styled"]) {
      expect(md(mode, "<p><u>x</u></p>"), mode).toBe("<u>x</u>");
      expect(md(mode, "<p><sub>x</sub></p>"), mode).toBe("<sub>x</sub>");
      expect(md(mode, "<p><sup>x</sup></p>"), mode).toBe("<sup>x</sup>");
      expect(md(mode, "<p><s>x</s></p>"), mode).toBe("~~x~~");
      expect(md(mode, '<p><img src="a.png" width="120" height="80"></p>'), mode)
        .toContain('width="120"');
    }
  });

  it("carries colour / highlight / font family ONLY while Styled is on", () => {
    const html = '<p><span style="color:#f00">x</span></p>';
    expect(md("styled", html)).toBe('<span style="color:#f00">x</span>');
    // Clean's whole purpose: the decorative span goes, the text stays.
    expect(md("clean", html)).toBe("x");
  });

  // A documentation pin, not a bug guard: it asserts the absence of something
  // that has never existed, so it cannot go red for a regression. What it CAN
  // catch is someone adding an alignment carrier without updating the four
  // places that currently tell users it has none (Help, README, features.md §6,
  // and the toolbar / Format ▸ Align tooltips).
  it("carries text alignment in NEITHER mode — it has no carrier at all", () => {
    const html = '<p style="text-align:center">x</p>';
    expect(md("clean", html)).toBe("x");
    expect(md("styled", html)).toBe("x");
  });
});
