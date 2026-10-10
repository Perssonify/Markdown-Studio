/**
 * Preprocessor / markdown-side fidelity, each pinned against a defect the
 * external audit reproduced. Round trips go through the real engine and
 * schema (converter-harness.js).
 */
import { describe, expect, it } from "vitest";
import { findFencedCodeRanges, normalizeMarkdown, preprocessMarkdown } from "../engine/preprocessor";
import { DEFAULT_MARKDOWN_FEATURES } from "../store/preferences/settings";
import { engineFor, roundTrip } from "./converter-harness";

const expectFixedPoint = (md, opts) => {
  const r = roundTrip(md, opts);
  expect(r.md1, "first trip changed the document").toBe(md);
  expect(r.md2, "second trip changed the document").toBe(md);
  return r;
};

describe("A039 — braces in prose are never swallowed", () => {
  it("is OFF by default, everywhere the default is decided", () => {
    expect(DEFAULT_MARKDOWN_FEATURES.curlyBraceFormatting).toBe(false);
    // The preprocessor's own default, with no feature bag at all.
    expect(preprocessMarkdown("{color=red}x{/color}")).toBe("{color=red}x{/color}");
    // And the engine, which is what documents actually go through.
    const html = engineFor().mdToHtml("## Returns {Promise}\n\nText {id}x{/id} and {size=3}big{/size}.");
    expect(html).toContain("Returns {Promise}");
    expect(html).toContain("{id}x{/id}");
    expect(html).toContain("{size=3}big{/size}");
    expect(html).not.toContain("<span");
  });

  it("round-trips a heading and prose full of braces unchanged (default settings)", () => {
    expectFixedPoint("## Returns {Promise}\n\nText {id}x{/id} and {size=3}big{/size}.");
  });

  describe("when a caller turns it on", () => {
    const on = (md) => preprocessMarkdown(md, { curlyBraceFormatting: true });

    it("still renders the constructs it knows", () => {
      expect(on("{color=red}x{/color}")).toBe('<span style="color: red">x</span>');
      expect(on("{size=large}x{/size}")).toBe('<span style="font-size: 20px">x</span>');
      expect(on("{align=center}x{/align}")).toBe('<div style="text-align: center">x</div>');
      expect(on("## Title {color=blue}")).toBe('## <span style="color: blue">Title</span>');
    });

    it("never drops text for a key it does not recognise", () => {
      expect(on("## Returns {Promise}")).toBe("## Returns {Promise}");
      expect(on("# Heading {.lead}")).toBe("# Heading {.lead}");
      expect(on("Text {id}x{/id}")).toBe("Text {id}x{/id}");
      expect(on("{size=huge!}x{/size}")).toBe("{size=huge!}x{/size}");
      expect(on("{foo=bar}x{/foo}")).toBe("{foo=bar}x{/foo}");
      // A closer that does not match its opener is not a construct either.
      expect(on("{color=red}x{/size}")).toBe("{color=red}x{/size}");
      // One unknown key makes the whole group literal — no partial rendering
      // that silently drops the part it did not understand.
      expect(on("{color=red foo=bar}x{/color}")).toBe("{color=red foo=bar}x{/color}");
    });

    it("renders a known construct nested inside one it declines", () => {
      expect(on("{foo=1}a {color=red}b{/color} c{/foo}")).toBe(
        '{foo=1}a <span style="color: red">b</span> c{/foo}'
      );
    });

    it("honours backslash-escaped braces", () => {
      expect(on("\\{color=red}x\\{/color}")).toBe("\\{color=red}x\\{/color}");
    });

    it("escapes every attribute value (A073) — nothing reaches the markup raw", () => {
      const out = on('{title=a"onmouseover="alert(1)}x{/title}');
      expect(out).not.toMatch(/"onmouseover=/);
      expect(out).toContain("&quot;onmouseover=&quot;");
      // Values that are not a colour / length / font are refused outright: the
      // construct stays literal instead of being spliced into an attribute.
      const img = '{color=red"><img/src=x/onerror=alert(1)>}x{/color}';
      expect(on(img)).toBe(img);
      expect(on("{style=position:fixed;inset:0}x{/style}")).toBe("{style=position:fixed;inset:0}x{/style}");
      expect(on("{font=a;position:fixed}x{/font}")).toBe("{font=a;position:fixed}x{/font}");
    });

    it("does not rewrite braces inside code — fenced, indented or inline", () => {
      const md = "```\n{color=red}a{/color}\n```\n\n    {color=red}b{/color}\n\n`{color=red}c{/color}`";
      expect(on(md)).toBe(md);
    });
  });
});

describe("A045 — a wiki-link alias in a table cell round-trips", () => {
  it("keeps the target and does not grow backslashes", () => {
    const md = "| h |\n| --- |\n| [[Doc\\|Alias]] |";
    const r = roundTrip(md);
    const link = r.json2.content[0].content[1].content[0].content[0].content[0];
    expect(link.marks[0].attrs.docLink).toBe("Doc");
    expect(link.text).toBe("Alias");
    expect(r.md1).toBe(r.md2);
    expect(r.md2).toContain("[[Doc\\|Alias]]");
  });

  it("accepts the unescaped form a user types, without splitting the cell", () => {
    const r = roundTrip("| h | x |\n| --- | --- |\n| [[Doc|Alias]] | y |");
    const row = r.json1.content[0].content[1].content;
    expect(row).toHaveLength(2);
    expect(row[0].content[0].content[0].marks[0].attrs.docLink).toBe("Doc");
    expect(row[1].content[0].content[0].text).toBe("y");
  });

  it("treats `\\|` as the separator outside tables too", () => {
    const html = engineFor().mdToHtml("See [[Doc\\|the doc]].");
    expect(html).toContain('data-doc-link="Doc"');
    expect(html).toContain(">the doc</a>");
  });
});

describe("A046 — code inside longer or quoted fences is not normalised", () => {
  it("closes a fence only on a matching, at-least-as-long closer", () => {
    const md = "````md\n```\nx\n```\na  \n\n\n\nb\n````\n";
    expect(normalizeMarkdown(md)).toBe(md);
    expect(findFencedCodeRanges(md)).toEqual([[0, md.length - 1]]);
  });

  it("does not pair a backtick opener with a tilde closer", () => {
    const md = "```\ncode  \n~~~\nstill code  \n```\n";
    expect(normalizeMarkdown(md)).toBe(md);
  });

  it("masks a fence inside a blockquote / callout", () => {
    const md = "> ```js\n> a  \n>\n> b\n> ```\n";
    expect(normalizeMarkdown(md)).toBe(md);
  });

  it("still normalises the prose around a fence", () => {
    expect(normalizeMarkdown("a   \n\n\n\n```\nx  \n```\n\n\n\nb  \n")).toBe("a\n\n```\nx  \n```\n\nb\n");
  });

  it("round-trips the audit's blockquote case byte for byte", () => {
    const r = roundTrip("> ```js\n> a  \n>\n>\n>\n> b\n> ```");
    expect(r.json1.content[0].content[0].content[0].text).toBe("a  \n\n\n\nb\n");
    expect(r.md1).toBe(r.md2);
  });
});

describe("A047 — front matter keeps its entities", () => {
  it("does not decode `&amp;` in a front matter value", () => {
    expectFixedPoint("---\ntitle: Tom &amp; Jerry\n---\n\nBody");
  });

  it("does not wipe the block when a value holds `&quot;`", () => {
    const md = "---\ntitle: say &quot;hi&quot;\ntags: [a, b]\n---\n\nBody";
    const r = expectFixedPoint(md);
    expect(r.json1.content[0].attrs.raw).toBe("title: say &quot;hi&quot;\ntags: [a, b]");
  });
});

describe("A048 — nothing is injected into indented code", () => {
  it("leaves a wiki link inside an indented code block literal", () => {
    const r = roundTrip("Para\n\n    [[Doc]] in code\n\nafter");
    expect(r.html1).not.toContain("data-doc-link");
    expect(r.json1.content[1].type).toBe("codeBlock");
    expect(r.json1.content[1].content[0].text).toBe("[[Doc]] in code\n");
    // Turndown writes code fenced; the CONTENT is what must not change.
    expect(r.md1).toBe("Para\n\n```\n[[Doc]] in code\n```\n\nafter");
    expect(r.md2).toBe(r.md1);
  });

  it("still renders a wiki link in a list item's indented second paragraph", () => {
    const html = engineFor().mdToHtml("- item\n\n  see [[Doc]]");
    expect(html).toContain('data-doc-link="Doc"');
  });

  it("measures indented code from the list item's content column", () => {
    const on = (md) => preprocessMarkdown(md, { curlyBraceFormatting: true });
    // Four columns past the margin, but only two past `- `: a paragraph of the item.
    expect(on("- item\n\n    {color=red}x{/color}")).toContain('<span style="color: red">x</span>');
    // Four columns past the margin with no list: indented code, left alone.
    expect(on("para\n\n    {color=red}x{/color}")).toBe("para\n\n    {color=red}x{/color}");
    // Four past the item's content column: code inside the item.
    expect(on("- item\n\n      {color=red}x{/color}")).toBe("- item\n\n      {color=red}x{/color}");
  });
});

describe("A051 — smaller drift", () => {
  it("keeps `[[My_Doc]]` in its short form", () => {
    expectFixedPoint("See [[My_Doc]] now.");
    expectFixedPoint("See [[a*b*c]] and [[Guide#Set_up]] too.");
  });

  it("does not turn a leading thematic break into front matter", () => {
    const r = expectFixedPoint("---\n\nSome text\n\n---\n\nMore");
    expect(r.json1.content.map((n) => n.type)).toEqual(["horizontalRule", "paragraph", "horizontalRule", "paragraph"]);
  });

  it("still recognises real front matter", () => {
    const r = expectFixedPoint("---\ntitle: Hello\n---\n\nBody");
    expect(r.json1.content[0].type).toBe("frontmatter");
  });
});
