import TurndownService from "turndown";
import { describe, expect, it } from "vitest";
import { buildMarked } from "../engine/build-marked";
import { addBaseRules } from "../engine/turndown-rules";
import { DEFAULT_MARKDOWN_FEATURES } from "../store/preferences/settings";

/**
 * Strikethrough must be DOUBLE-tilde only. marked's default GFM `del` tokenizer
 * also matches a single `~…~`, so stray tildes in prose (e.g. "~32 000") and any
 * unpaired `~` rendered as strikethrough. See build-marked.ts.
 */
describe("strikethrough is double-tilde only", () => {
  const md = buildMarked(DEFAULT_MARKDOWN_FEATURES); // gfm, strikethrough on

  it("does NOT strike through a single stray tilde span", () => {
    const html = md.parse("Around ~32 000 tiny **white** spheres fly in ~ from the camera");
    expect(html).not.toContain("<del>");
    expect(html).toContain("~32 000"); // the tilde stays literal
  });

  it("still strikes through double tildes", () => {
    const html = md.parse("this is ~~gone~~ now");
    expect(html).toContain("<del>");
    expect(html).toContain("gone");
  });

  it("leaves a lone tilde literal", () => {
    const html = md.parse("a ~ b");
    expect(html).not.toContain("<del>");
    expect(html).toContain("~");
  });

  it("respects the strikethrough feature toggle (off ⇒ no del even for ~~)", () => {
    const off = buildMarked({ ...DEFAULT_MARKDOWN_FEATURES, strikethrough: false });
    const html = off.parse("this is ~~kept~~ now");
    expect(html).not.toContain("<del>");
  });
});

/**
 * …and the OTHER direction, which is where it was broken.
 *
 * Turndown's core has no rule for `<s>` / `<del>` / `<strike>` — that lives in
 * turndown-plugin-gfm, which this project does not load — so those elements
 * fell through to the default "keep the text, drop the tag" and strikethrough
 * was SILENTLY DESTROYED on every rich→markdown projection. TipTap's Strike
 * renders `<s>`, so the toolbar button, ⌘⇧X and Format ▸ Strikethrough all
 * vanished the moment the panes synced, and `fidelity.ts` lists strike among
 * the NATIVE marks, so nothing warned about it either.
 *
 * The tests above covered md → html, the direction that worked. A format needs
 * both directions held or it is only half tested.
 */
describe("strikethrough survives html → markdown", () => {
  const td = () => addBaseRules(new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", emDelimiter: "*" }));

  it("serializes the tag TipTap actually renders", () => {
    expect(td().turndown("<p><s>gone</s></p>").trim()).toBe("~~gone~~");
  });

  it("serializes the other two spellings", () => {
    expect(td().turndown("<p><del>gone</del></p>").trim()).toBe("~~gone~~");
    expect(td().turndown("<p><strike>gone</strike></p>").trim()).toBe("~~gone~~");
  });

  it("keeps the surrounding prose intact", () => {
    expect(td().turndown("<p>a <s>b c</s> d</p>").trim()).toBe("a ~~b c~~ d");
  });

  it("round-trips back to a del element", () => {
    const md = buildMarked(DEFAULT_MARKDOWN_FEATURES);
    expect(md.parse(td().turndown("<p><s>gone</s></p>"))).toContain("<del>");
  });

  it("emits nothing for an empty strike — `~~~~` would read as a code fence", () => {
    expect(td().turndown("<p><s></s>text</p>").trim()).toBe("text");
  });
});
