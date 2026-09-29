import { describe, expect, it } from "vitest";
import { canonicalToHtml, canonicalToMarkdown } from "../engine/serialize-doc.ts";

// The per-document library export (right-click ▸ Export) derives every format
// from the STORED canonical via these helpers — no live editor. These tests pin
// that data path so exporting a non-active document keeps working.

const doc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Plain and " },
        { type: "text", marks: [{ type: "bold" }], text: "bold" },
      ],
    },
  ],
};

describe("canonicalToHtml", () => {
  it("serializes canonical PM JSON to HTML without a live editor", () => {
    const html = canonicalToHtml(doc);
    expect(html).toMatch(/<h1[^>]*>Title<\/h1>/);
    expect(html).toMatch(/<(strong|b)>bold<\/(strong|b)>/);
  });
});

describe("canonicalToMarkdown", () => {
  it("converts via the injected html→md converter", () => {
    // A trivial converter proves the html is produced and piped through.
    const md = canonicalToMarkdown(doc, (html) => html.replace(/<[^>]+>/g, "").trim());
    expect(md).toContain("Title");
    expect(md).toContain("bold");
  });

  it("returns null (not a throw) when the converter throws", () => {
    const md = canonicalToMarkdown(doc, () => {
      throw new Error("boom");
    });
    expect(md).toBeNull();
  });
});

// SERIALIZE_EXTENSIONS must mirror the live TiptapPane schema, or headless
// export (per-doc / backup ZIP) corrupts or throws. These pin that parity.
describe("headless-schema parity with the live editor", () => {
  it("does NOT throw on a themeImage node (regression: unknown node type)", () => {
    const themeDoc = {
      type: "doc",
      content: [
        {
          type: "themeImage",
          attrs: { lightSrc: "l.png", darkSrc: "d.png", alt: "logo" },
        },
      ],
    };
    expect(() => canonicalToHtml(themeDoc)).not.toThrow();
  });

  it("preserves width/height on a sized image", () => {
    const imgDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "image", attrs: { src: "logo.png", width: "200", height: "80" } }],
        },
      ],
    };
    const html = canonicalToHtml(imgDoc);
    expect(html).toMatch(/width="200"/);
    expect(html).toMatch(/height="80"/);
  });

  it("preserves wiki-link attributes (data-doc-link) so [[wiki]] can round-trip", () => {
    const wikiDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Other Doc",
              marks: [{ type: "link", attrs: { href: "#", docLink: "Other Doc" } }],
            },
          ],
        },
      ],
    };
    const html = canonicalToHtml(wikiDoc);
    expect(html).toMatch(/data-doc-link="Other Doc"/);
  });
});
