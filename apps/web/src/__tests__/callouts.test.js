import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TurndownService from "turndown";
import { describe, expect, it } from "vitest";
import { buildMarked } from "../engine/build-marked";
import { cleanHtmlForTurndown } from "../engine/html-cleaner";
import { addBaseRules } from "../engine/turndown-rules.ts";
import { Callout } from "../extensions/Callout.ts";
import { DEFAULT_MARKDOWN_FEATURES } from "../store/preferences/settings";

// GitHub-style callouts: `> [!NOTE]` blockquotes render as callout cards and
// round-trip back to `> [!NOTE]` markdown.
function td() {
  const t = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", emDelimiter: "*" });
  addBaseRules(t);
  return t;
}

function roundTrip(md) {
  const m = buildMarked(DEFAULT_MARKDOWN_FEATURES);
  const html = m.parse(md, { async: false });
  const ed = new Editor({ extensions: [StarterKit, Callout], content: "" });
  ed.commands.setContent(html);
  const out = td().turndown(cleanHtmlForTurndown(ed.getHTML()));
  ed.destroy();
  return { html, out };
}

describe("callouts", () => {
  it("renders a [!NOTE] blockquote as a callout div, not a blockquote", () => {
    const m = buildMarked(DEFAULT_MARKDOWN_FEATURES);
    const html = m.parse("> [!NOTE]\n> Heads up.", { async: false });
    expect(html).toContain('data-type="callout"');
    expect(html).toContain('data-callout="note"');
    expect(html).not.toContain("<blockquote");
    expect(html).toContain("Heads up.");
  });

  it("supports all five callout types", () => {
    const m = buildMarked(DEFAULT_MARKDOWN_FEATURES);
    for (const t of ["note", "tip", "important", "warning", "caution"]) {
      const html = m.parse(`> [!${t.toUpperCase()}]\n> body`, { async: false });
      expect(html).toContain(`data-callout="${t}"`);
    }
  });

  it("round-trips a callout back to > [!TYPE] markdown", () => {
    const { out } = roundTrip("> [!WARNING]\n> Be careful here.");
    expect(out).toMatch(/^> \[!WARNING\]/m);
    expect(out).toMatch(/^> Be careful here\./m);
  });

  it("preserves inline markdown and multiple paragraphs inside a callout", () => {
    const { html, out } = roundTrip("> [!TIP]\n> Use **bold** and [links](/x).\n>\n> Second line.");
    expect(html).toContain("<strong>bold</strong>");
    expect(out).toMatch(/^> \[!TIP\]/m);
    expect(out).toContain("**bold**");
    expect(out).toContain("[links](/x)");
  });

  it("leaves a plain blockquote (no marker) as a blockquote", () => {
    const m = buildMarked(DEFAULT_MARKDOWN_FEATURES);
    const html = m.parse("> just a quote", { async: false });
    expect(html).toContain("<blockquote");
    expect(html).not.toContain('data-type="callout"');
  });

  it("does not treat callouts specially when the feature is off", () => {
    const m = buildMarked({ ...DEFAULT_MARKDOWN_FEATURES, callouts: false });
    const html = m.parse("> [!NOTE]\n> body", { async: false });
    expect(html).not.toContain('data-type="callout"');
    expect(html).toContain("<blockquote");
  });
});
