/**
 * Style injection through canonical attrs (A070), the ingest sanitizer's
 * hardening (A073), and residual reporting that matches the live schema
 * (A050).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalToHtml } from "../engine/serialize-doc";
import { sanitizeStyleDeclarations } from "../engine/css-safety";
import { sanitizeCanonicalNode } from "../store/canonical-sanitize";
import { ingest, sanitizeForIngest } from "../store/ingest";
import { engineFor } from "./converter-harness";

const para = (marks, text = "x") => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text, marks }] }] });
const textStyle = (attrs) => [{ type: "textStyle", attrs }];
const markAttrs = (doc) => doc.content[0].content[0].marks[0].attrs;

describe("A070 — canonical attrs cannot inject CSS", () => {
  const OVERLAY = "red; position: fixed; inset: 0; z-index: 9999";

  it("drops a colour, highlight or font that is not one", () => {
    const clean = sanitizeCanonicalNode(para(textStyle({ color: OVERLAY, backgroundColor: "url(https://t.example/p)", fontFamily: "a; position: fixed" })));
    const attrs = markAttrs(clean);
    expect(attrs.color).toBeUndefined();
    expect(attrs.backgroundColor).toBeUndefined();
    expect(attrs.fontFamily).toBeUndefined();
  });

  it("keeps the values the editor itself writes", () => {
    const clean = sanitizeCanonicalNode(para(textStyle({ color: "#ff0000", backgroundColor: "rgb(254, 240, 138)", fontFamily: '"Courier New", monospace' })));
    expect(markAttrs(clean)).toEqual({ color: "#ff0000", backgroundColor: "rgb(254, 240, 138)", fontFamily: '"Courier New", monospace' });
  });

  it("validates alignment, cell alignment and column widths", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { textAlign: "left; position: fixed" }, content: [{ type: "text", text: "a" }] },
        { type: "paragraph", attrs: { textAlign: "center" }, content: [{ type: "text", text: "b" }] },
        {
          type: "table",
          content: [{ type: "tableRow", content: [
            { type: "tableHeader", attrs: { align: "right", colwidth: [120] }, content: [{ type: "paragraph" }] },
            { type: "tableHeader", attrs: { align: "x;y", colwidth: ["100px; position: fixed"] }, content: [{ type: "paragraph" }] },
          ] }],
        },
      ],
    };
    const clean = sanitizeCanonicalNode(doc);
    expect(clean.content[0].attrs.textAlign).toBeUndefined();
    expect(clean.content[1].attrs.textAlign).toBe("center");
    const [good, bad] = clean.content[2].content[0].content;
    expect(good.attrs).toEqual({ align: "right", colwidth: [120] });
    expect(bad.attrs).toEqual({});
  });

  it("drops a script URL on a theme image's light/dark sources", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "themeImage", attrs: { lightSrc: "javascript:alert(1)", darkSrc: "d.png" } }] }] };
    const attrs = sanitizeCanonicalNode(doc).content[0].content[0].attrs;
    expect(attrs.lightSrc).toBeUndefined();
    expect(attrs.darkSrc).toBe("d.png");
  });

  it("never renders the overlay, through an import or straight from JSON", () => {
    const json = JSON.stringify(para([...textStyle({ color: OVERLAY, backgroundColor: OVERLAY }), { type: "link", attrs: { href: "https://example.com" } }]));
    const { doc } = ingest(json, "pmjson", "file-import");
    expect(canonicalToHtml(doc.canonical)).not.toMatch(/position|inset|z-index/);
    // The highlight renderer validates on its own, for a canonical that never
    // passed through the import boundary.
    expect(canonicalToHtml(para(textStyle({ backgroundColor: OVERLAY })))).not.toMatch(/position/);
  });
});

describe("A073 — ingest sanitizer hardening", () => {
  const attrOf = (html, sel, attr) =>
    new DOMParser().parseFromString(sanitizeForIngest(html), "text/html").querySelector(sel)?.getAttribute(attr) ?? null;

  it("does not let a CSS escape smuggle a property or a URL past the filter", () => {
    expect(attrOf('<p style="posit\\ion: fixed; top: 0">x</p>', "p", "style")).toBeNull();
    expect(attrOf('<p style="background-color: u\\rl(https://t.example/p)">x</p>', "p", "style")).toBeNull();
    expect(attrOf('<p style="color: red; -webkit-transform: scale(9)">x</p>', "p", "style")).toBe("color: red");
    expect(sanitizeStyleDeclarations("color: red; posit\\ion: fixed")).toBe("color: red");
  });

  it("keeps a highlight written with the background shorthand, as a colour only", () => {
    expect(attrOf('<span style="background: yellow">x</span>', "span", "style")).toBe("background-color: yellow");
    expect(attrOf('<span style="background: url(x) yellow">x</span>', "span", "style")).toBeNull();
  });

  it("strips class, id and name — except a code block's language", () => {
    const out = sanitizeForIngest('<div class="fixed inset-0 z-50" id="app" name="x">a</div><img src="a.png" name="cookie"><pre><code class="language-js hljs">x</code></pre>');
    const d = new DOMParser().parseFromString(out, "text/html");
    expect(d.querySelector("div").getAttributeNames()).toEqual([]);
    expect(d.querySelector("img").hasAttribute("name")).toBe(false);
    expect(d.querySelector("code").getAttribute("class")).toBe("language-js");
  });

  describe("without a DOM parser", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("fails closed: markup becomes text", () => {
      vi.stubGlobal("DOMParser", class { parseFromString() { throw new Error("no DOM"); } });
      const out = sanitizeForIngest('<p onclick="x()">hi</p><a href="javascript:alert(1)">y</a>');
      expect(out).not.toMatch(/<a|<p onclick|onclick="/);
      expect(out).toContain("&lt;a href=");
    });
  });
});

describe("A050 — residuals report what the live schema really drops", () => {
  const residualsOf = (raw, format = "html", features = {}) =>
    ingest(raw, format, "file-import", format === "markdown" ? { mdToHtml: engineFor(features).mdToHtml } : {}).doc.residuals;

  it("records an HTML comment instead of deleting it silently", () => {
    const r = residualsOf("<p>a</p><!-- reviewer: check this --><p>b</p>");
    expect(r).toEqual([expect.objectContaining({ type: "html-comment", value: "reviewer: check this" })]);
    expect(residualsOf("Text\n\n<!-- a note -->\n\nMore", "markdown").map((x) => x.type)).toEqual(["html-comment"]);
  });

  it("ignores the empty separator comment the serializer writes", () => {
    expect(residualsOf("<p>a<!---->b</p>")).toEqual([]);
  });

  it("does not flag front matter, which the schema keeps", () => {
    expect(residualsOf("---\ntitle: Hello\n---\n\nBody", "markdown")).toEqual([]);
  });

  it("does not flag footnotes, which round-trip", () => {
    expect(residualsOf("A claim[^1].\n\n[^1]: The source.", "markdown", { footnotes: true })).toEqual([]);
  });

  it("flags a <mark> and a font size, which the schema drops", () => {
    const r = residualsOf('<p><mark>hi</mark> <span style="font-size: 20px">big</span></p>');
    expect(r).toContainEqual(expect.objectContaining({ type: "unknown-element", tag: "mark" }));
    expect(r).toContainEqual(expect.objectContaining({ type: "unknown-style", property: "font-size" }));
  });

  it("flags a data attribute the schema does not keep", () => {
    const r = residualsOf('<p data-block-id="abc">x</p>');
    expect(r).toContainEqual(expect.objectContaining({ type: "dropped-attribute", attribute: "data-block-id" }));
  });
});
