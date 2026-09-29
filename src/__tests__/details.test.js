import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TurndownService from "turndown";
import { describe, expect, it } from "vitest";
import { buildMarked } from "../engine/build-marked";
import { cleanHtmlForTurndown } from "../engine/html-cleaner";
import { addBaseRules } from "../engine/turndown-rules.ts";
import { Details, Summary } from "../extensions/Details.ts";
import { DEFAULT_MARKDOWN_FEATURES } from "../store/settings";

// Collapsible <details><summary> round-trips as raw HTML: marked passes the
// block through, the Details/Summary nodes parse it, turndown re-emits outerHTML.
function td() {
  const t = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", emDelimiter: "*" });
  addBaseRules(t);
  return t;
}

function roundTrip(md) {
  const m = buildMarked(DEFAULT_MARKDOWN_FEATURES);
  const html = m.parse(md, { async: false });
  const ed = new Editor({ extensions: [StarterKit, Details, Summary], content: "" });
  ed.commands.setContent(html);
  const out = td().turndown(cleanHtmlForTurndown(ed.getHTML()));
  ed.destroy();
  return { html, out };
}

describe("collapsible details", () => {
  it("parses a <details> block into details + summary nodes and preserves the body", () => {
    const { out } = roundTrip("<details>\n<summary>More info</summary>\n<p>Hidden body.</p>\n</details>");
    expect(out).toContain("<details");
    expect(out).toContain("<summary>More info</summary>");
    expect(out).toContain("Hidden body.");
    expect(out).toContain("</details>");
  });

  it("round-trips the open state", () => {
    const openRt = roundTrip("<details open>\n<summary>S</summary>\n<p>B</p>\n</details>");
    expect(openRt.out).toMatch(/<details[^>]*\bopen\b/);
    const closedRt = roundTrip("<details>\n<summary>S</summary>\n<p>B</p>\n</details>");
    expect(closedRt.out).not.toMatch(/<details[^>]*\bopen\b/);
  });

  it("survives a full markdown round-trip stable (idempotent second pass)", () => {
    const first = roundTrip("<details>\n<summary>Q</summary>\n<p>A</p>\n</details>");
    const second = roundTrip(first.out);
    expect(second.out).toContain("<summary>Q</summary>");
    expect(second.out).toContain("A");
    expect(second.out).toContain("<details");
  });
});
