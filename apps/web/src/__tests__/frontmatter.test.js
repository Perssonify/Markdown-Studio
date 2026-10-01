import { describe, it, expect } from "vitest";
import TurndownService from "turndown";
import { preprocessMarkdown } from "../engine/preprocessor";
import { addBaseRules } from "../engine/turndown-rules";
import { parseFrontmatter } from "../extensions/FrontmatterBlock";

function td() {
  return addBaseRules(new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" }));
}

describe("front matter preprocessing", () => {
  it("converts a leading --- block into a frontmatter node", () => {
    const md = "---\ntitle: Hello\ntags: a, b\n---\n\n# Body";
    const html = preprocessMarkdown(md, { frontmatter: true });
    expect(html).toContain('data-type="frontmatter"');
    expect(html).toContain("# Body");
  });

  it("does not treat a mid-document --- as front matter", () => {
    const md = "# Title\n\nsome text\n\n---\n\nmore";
    const html = preprocessMarkdown(md, { frontmatter: true });
    expect(html).not.toContain('data-type="frontmatter"');
  });

  it("is a no-op when the frontmatter feature is off", () => {
    const md = "---\ntitle: Hello\n---\n\nBody";
    const html = preprocessMarkdown(md, { frontmatter: false });
    expect(html).not.toContain('data-type="frontmatter"');
  });
});

describe("parseFrontmatter", () => {
  it("parses key: value lines, skipping blanks and comments", () => {
    const rows = parseFrontmatter("title: Hi\n# comment\n\ntags: a, b");
    expect(rows).toEqual([
      { key: "title", value: "Hi" },
      { key: "tags", value: "a, b" },
    ]);
  });
});

describe("front matter round-trip", () => {
  it("markdown → node → turndown restores the --- block", () => {
    const raw = "title: Hello World\ndate: 2026-01-01";
    const md = `---\n${raw}\n---\n\n# Heading`;
    const html = preprocessMarkdown(md, { frontmatter: true });
    const back = td().turndown(html);
    expect(back).toContain("---");
    expect(back).toContain("title: Hello World");
    expect(back).toContain("date: 2026-01-01");
    // The --- block should come before the heading.
    expect(back.indexOf("---")).toBeLessThan(back.indexOf("# Heading"));
  });

  it("preserves newlines in the body across the JSON-encoded attribute", () => {
    const md = "---\na: 1\nb: 2\nc: 3\n---\n\ntext";
    const back = td().turndown(preprocessMarkdown(md, { frontmatter: true }));
    expect(back).toMatch(/a: 1\nb: 2\nc: 3/);
  });
});
