import { describe, expect, it } from "vitest";
import { ingest } from "../store/importExport/ingest";

/**
 * The residual analyzer must reflect the schema the editor ACTUALLY has.
 *
 * It drifted: `KNOWN_ELEMENTS` predated the themeImage node, the callout node
 * and the SizedImage extension, so the shipped welcome document — which
 * deliberately demonstrates a `<picture>` theme-aware image, a `> [!NOTE]`
 * callout and a sized logo — opened reporting seven things that "could not be
 * mapped to the current schema". Every one of them round-trips. Once the count
 * became a readable list, the inaccuracy became visible; these tests keep it
 * from coming back.
 *
 * The rule: an element or attribute belongs in this file's "supported" list ONLY
 * if the live editor can parse it AND turndown can serialize it back.
 */
const analyze = (html) => ingest(html, "html", "import").doc.residuals;

describe("residual analysis reflects the live schema", () => {
  it("does not flag a <picture> theme image — themeImage parses and re-emits it", () => {
    // src/extensions/ThemeImage.tsx: parseHTML -> { tag: "picture" };
    // turndown-rules.ts: the `themeImagePicture` rule writes it back out.
    const html = `<p>x</p><picture>
      <source media="(prefers-color-scheme: dark)" srcset="/d.svg">
      <source media="(prefers-color-scheme: light)" srcset="/l.svg">
      <img src="/l.svg" alt="Logo">
    </picture>`;
    const r = analyze(html);
    expect(r.filter((x) => ["picture", "source"].includes(x.tag))).toEqual([]);
  });

  it("does not flag a sized image — SizedImage keeps width and height", () => {
    // src/extensions/SizedImage.ts declares both with parseHTML/renderHTML.
    const r = analyze('<p><img src="/a.webp" alt="A" width="84" height="20" /></p>');
    expect(r.filter((x) => x.element === "img" && ["width", "height"].includes(x.attribute))).toEqual([]);
  });

  it("STILL flags loading on an image, which genuinely is dropped", () => {
    // The counterpart to the test above: the fix must not silence a real loss.
    const r = analyze('<p><img src="/a.webp" alt="A" loading="lazy" /></p>');
    expect(r.some((x) => x.element === "img" && x.attribute === "loading")).toBe(true);
  });

  it("does not flag a <div> — callouts are divs, and plainDiv handles the rest", () => {
    const html = '<div data-type="callout" data-callout="note"><p>Note body</p></div>';
    expect(analyze(html).filter((x) => x.tag === "div")).toEqual([]);
  });

  it("still flags an element the schema really has no node for", () => {
    // The guard against over-correcting: this must remain a residual.
    const r = analyze("<p>x</p><marquee>scroll</marquee>");
    expect(r.some((x) => x.type === "unknown-element" && x.tag === "marquee")).toBe(true);
  });

  it("still reports active content as blocked, on the path where it can", () => {
    // The markdown path hands `analyzeHtml` the renderer's output directly, so
    // that is where a blocked element is seen and counted.
    const r = ingest("x", "markdown", "import", {
      mdToHtml: () => '<p>x</p><iframe src="https://example.com"></iframe>',
    }).doc.residuals;
    expect(r.some((x) => x.type === "blocked-element" && x.tag === "iframe")).toBe(true);
  });

  it("documents a real limit: on the HTML path, blocked elements are removed BEFORE analysis", () => {
    // Worth knowing rather than glossing: `ingest(html)` runs `sanitizeForIngest`
    // first, so scripts, iframes and form controls are gone by the time
    // `analyzeHtml` looks. They are removed correctly and reported as NOTHING —
    // the fidelity count under-reports on this path. Recording residuals from
    // inside the sanitizer is the fix, and is deliberately not attempted here.
    expect(analyze('<p>x</p><iframe src="https://example.com"></iframe>')).toEqual([]);
    expect(analyze('<p>x</p><script>alert(1)</script>')).toEqual([]);
  });

  it("reports NOTHING for a document built only from supported constructs", () => {
    // The end-to-end version of the bug: a document made of features the editor
    // advertises must not announce that parts of it were lost.
    const html = [
      "<h1>Title</h1>",
      "<p>Text with <strong>bold</strong>, <em>italic</em> and <a href='#'>a link</a>.</p>",
      '<div data-type="callout" data-callout="note"><p>An admonition.</p></div>',
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>A task</p></li></ul>',
      "<blockquote><p>Quoted</p></blockquote>",
      "<pre><code>code()</code></pre>",
      "<table><tbody><tr><td>a</td></tr></tbody></table>",
      '<img src="/a.webp" alt="A" width="84" />',
      "<picture><source media=\"(prefers-color-scheme: dark)\" srcset=\"/d.svg\"><img src=\"/l.svg\" alt=\"L\"></picture>",
      "<details><summary>More</summary><p>Body</p></details>",
      "<hr>",
    ].join("\n");
    expect(analyze(html)).toEqual([]);
  });
});
