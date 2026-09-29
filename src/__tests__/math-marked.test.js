import { Marked } from "marked";
import { describe, expect, it } from "vitest";
import { mathBlockExtension, mathInlineExtension } from "../engine/math-marked";

/**
 * The `$…$` / `$$…$$` tokenizers. They run over every document the app renders,
 * and their whole job is telling maths apart from prose that merely contains a
 * dollar sign — "$5 and $10" must survive as text. The escaping matters as much:
 * the LaTeX source is written into an HTML ATTRIBUTE, so an unescaped quote in a
 * formula would break out of it.
 */

const md = new Marked({ extensions: [mathBlockExtension, mathInlineExtension] });
const render = (src) => md.parse(src);

describe("inline math", () => {
  it("turns $…$ into a placeholder carrying the source", () => {
    const html = render("Euler: $e^{i\\pi}+1=0$ indeed.");
    expect(html).toContain('data-math-inline="e^{i\\pi}+1=0"');
  });

  it("leaves currency alone — the case the no-whitespace rule exists for", () => {
    const html = render("It costs $5 and then $10.");
    expect(html).not.toContain("data-math-inline");
    expect(html).toContain("$5");
    expect(html).toContain("$10");
  });

  it("rejects a span that opens or closes on whitespace", () => {
    expect(render("a $ x$ b")).not.toContain("data-math-inline");
    expect(render("a $x $ b")).not.toContain("data-math-inline");
  });

  it("does not span a line break", () => {
    expect(render("first $ line\nsecond line $ end")).not.toContain("data-math-inline");
  });

  it("matches more than one formula in a line, non-greedily", () => {
    const html = render("$a$ and $b$");
    expect(html).toContain('data-math-inline="a"');
    expect(html).toContain('data-math-inline="b"');
  });

  it("does not swallow a block delimiter as an inline one", () => {
    const html = render("$$x + y$$");
    expect(html).toContain("data-math-block");
    expect(html).not.toContain("data-math-inline");
  });
});

describe("block math", () => {
  it("turns $$…$$ into a block placeholder and trims the source", () => {
    const html = render("$$\n  x^2 + y^2 = z^2  \n$$");
    expect(html).toContain('data-math-block="x^2 + y^2 = z^2"');
  });

  it("keeps multi-line LaTeX intact", () => {
    const html = render("$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$");
    expect(html).toContain("\\begin{aligned}");
    expect(html).toContain("\\end{aligned}");
  });

  it("renders the source as text too, so the turndown rule sees a non-blank element", () => {
    // An element with an attribute but no text content is treated as blank by
    // turndown and dropped — the formula would round-trip to nothing.
    const html = render("$$a+b$$");
    expect(html).toMatch(/<div data-math-block="a\+b">a\+b<\/div>/);
  });

  it("does not run away to the end of the document", () => {
    const html = render("$$one$$\n\ntext between\n\n$$two$$");
    expect(html).toContain('data-math-block="one"');
    expect(html).toContain('data-math-block="two"');
    expect(html).toContain("text between");
  });
});

describe("attribute escaping", () => {
  it("escapes quotes, angle brackets and ampersands in the source", () => {
    const html = render('$a<b & c="d"$');
    expect(html).toContain("&quot;");
    expect(html).toContain("&lt;");
    expect(html).toContain("&amp;");
    // Nothing raw escaped the attribute.
    expect(html).not.toMatch(/data-math-inline="[^"]*"[^>]*=/);
  });

  it("cannot be used to close the tag and inject markup", () => {
    const html = render('$x"><img src=x onerror=alert(1)>$');
    expect(html).not.toContain("<img");
    expect(html).toContain("&quot;");
  });

  it("escapes the ampersand before the entities it introduces", () => {
    // & must be replaced FIRST, or "&lt;" becomes "&amp;lt;" and the source no
    // longer round-trips.
    const html = render("$a & b$");
    expect(html).toContain('data-math-inline="a &amp; b"');
    expect(html).not.toContain("&amp;amp;");
  });
});

describe("start hints", () => {
  it("point marked at the first candidate delimiter", () => {
    expect(mathBlockExtension.start("no maths here")).toBeUndefined();
    expect(mathBlockExtension.start("text $$x$$")).toBe(5);
    expect(mathInlineExtension.start("no maths here")).toBeUndefined();
    expect(mathInlineExtension.start("text $x$")).toBe(5);
  });
});
