/**
 * A051 — exported markdown keeps its hard line breaks outside the app.
 *
 * The app reads markdown with `breaks: true`, so the editor writes a hard break
 * as a bare newline. A strict CommonMark renderer (marked with `breaks: false`,
 * GitHub's file view, most static-site generators) joins those two lines into
 * one. Exports — and only exports — write `\` + newline instead.
 *
 * Three properties, over a corpus that puts a break everywhere a break can be:
 *  - the exported file, rendered STRICTLY, draws the same <br>s the app draws
 *    from its own markdown (and, as the control, the app's own markdown drawn
 *    strictly does NOT — the corpus can see the defect);
 *  - the export differs from the editor's markdown ONLY by a `\` inserted
 *    before some newlines, and never inside a code block or a table;
 *  - re-importing the export reproduces the document the editor's markdown
 *    reproduces.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { Marked } from "marked";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMarked } from "../engine/build-marked";
import { BREAK_MARK, withPortableBreaks, portableBreaksActive } from "../engine/portable-breaks";
import { findFencedCodeRanges } from "../engine/preprocessor";
import { canonicalToMarkdown, canonicalToPortableMarkdown } from "../engine/serialize-doc";
import { createMarkdownEngine } from "../engine/useMarkdownEngine";
import { exportAsMarkdown } from "../store/importExport/import-export";
import { DEFAULT_MARKDOWN_FEATURES } from "../store/preferences/settings";
import { throughRichPane } from "./converter-harness";

const FEATURES = { ...DEFAULT_MARKDOWN_FEATURES, footnotes: true };
const engine = createMarkdownEngine(() => FEATURES);

/** The app's own renderer with ONE option changed: `breaks: false`. */
const strictMarked = buildMarked(FEATURES);
strictMarked.setOptions({ breaks: false });
const strict = createMarkdownEngine(() => FEATURES, () => strictMarked);
/** And a third-party one: stock marked, GFM on, `breaks` off (its default). */
const stock = new Marked({ gfm: true });

/** Markdown in the app's dialect — every place a hard break can sit. */
const CORPUS = [
  "Jane Doe\n12 Oak Street\nSpringfield\nUSA",
  "Intro.\n\nRoses are red\nViolets are blue\n\nOutro.",
  "- one\n  two\n- three\n  four\n  five",
  "1. first\n   line two\n2. second",
  "- [ ] task\n  more of it\n- [x] done",
  "> quoted\n> still quoted\n\n> [!NOTE]\n> callout\n> line two",
  "A claim[^1].\n\n[^1]: The source\n    and its second line.",
  "**bold\nacross** and *em\nhere* and ~~gone\nhere~~ and <u>under\nline</u>",
  "Price $x$\nnext $$y$$ line and `code` end\nlast",
  "| h | i |\n| --- | --- |\n| one<br>two | x |",
  "```js\nconst a = 1; \\\nconst b = 2;  \n\n\nconst c = 3;\n```\n\nafter\nbreak",
  "# Heading\n\ntext\nmore\n\n## Another\n\nend",
  "<details><summary>More</summary>\n\nbody\nline\n\n</details>\n\nafter\nbreak",
  "C:\\path\\\nnext line",
  "- outer\n  - inner\n    inner two\n  - three",
];

/** Rich documents a markdown source cannot produce (breaks at the edges). */
const HTML_CORPUS = [
  "<p>a<br></p><p>b</p>",
  "<p><br>a</p>",
  "<p>a<br><strong></strong><br>b</p>",
  "<p><strong>a<br></strong>b</p>",
  "<p>a<strong><br></strong>b</p>",
  "<p><em>a<br>b</em></p>",
  "<h2>Title<br>continued</h2><p>x</p>",
  "<ul><li><p>a<br></p><ul><li><p>b</p></li></ul></li></ul>",
  '<p><span style="color: #ff0000">red<br>line</span></p>',
  "<blockquote><p>q<br>r</p></blockquote>",
  "<p>tab\t<br>\ttab</p>",
];

const RICH = [
  ...CORPUS.map((md) => throughRichPane(engine.mdToHtml(md))),
  ...HTML_CORPUS.map((html) => throughRichPane(html)),
];

/** A rendering reduced to its text and its line breaks: tags gone, <br> kept. */
function breaks(html) {
  return html
    .replace(/<br\s*\/?>/g, "\u2424")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}
const countBr = (html) => (html.match(/<br\s*\/?>/g) || []).length;

/**
 * The export must be the editor's markdown with `\` inserted before some
 * newlines and NOTHING else. Returns the offsets (in the editor's markdown) of
 * the newlines that gained one.
 */
function insertedBreaks(appMd, exportMd) {
  const at = [];
  let i = 0;
  let j = 0;
  while (i < appMd.length || j < exportMd.length) {
    if (appMd[i] === exportMd[j]) { i++; j++; continue; }
    if (exportMd[j] === "\\" && exportMd[j + 1] === "\n" && appMd[i] === "\n") { at.push(i); j++; continue; }
    throw new Error(`export differs at ${j}: ${JSON.stringify(exportMd.slice(j - 20, j + 20))} vs ${JSON.stringify(appMd.slice(i - 20, i + 20))}`);
  }
  return at;
}

describe("A051 — exports write hard breaks every renderer draws", () => {
  for (const mode of ["clean", "styled"]) {
    const toMd = mode === "styled" ? engine.htmlToMd : engine.htmlToCleanMd;

    it.each(RICH.map((r, i) => [i, r.html]))(`${mode} #%i: strict rendering of the export = the app's rendering`, (_i, html) => {
      const appMd = toMd(html);
      const exportMd = withPortableBreaks(() => toMd(html));
      const app = engine.mdToHtml(appMd);
      expect(breaks(strict.mdToHtml(exportMd))).toBe(breaks(app));
      expect(countBr(stock.parse(exportMd))).toBe(countBr(app));
      // The export is the editor's markdown plus backslashes, never inside a
      // fence or a table row.
      const fences = findFencedCodeRanges(appMd);
      for (const p of insertedBreaks(appMd, exportMd)) {
        expect(fences.some(([s, e]) => p >= s && p < e), "inside a code block").toBe(false);
        const lineStart = appMd.lastIndexOf("\n", p - 1) + 1;
        expect(appMd.slice(lineStart, p).trimStart().startsWith("|"), "inside a table").toBe(false);
      }
    });
  }

  it("the corpus can see the defect: the editor's own markdown, drawn strictly, loses breaks", () => {
    let lost = 0;
    for (const { html } of RICH) {
      const appMd = engine.htmlToCleanMd(html);
      lost += countBr(engine.mdToHtml(appMd)) - countBr(strict.mdToHtml(appMd));
    }
    expect(lost).toBeGreaterThan(15);
  });

  it.each(RICH.map((r, i) => [i, r.html]))("#%i: re-importing the export reproduces the document", (_i, html) => {
    const appMd = engine.htmlToCleanMd(html);
    const exportMd = withPortableBreaks(() => engine.htmlToCleanMd(html));
    const fromApp = throughRichPane(engine.mdToHtml(appMd)).json;
    const fromExport = throughRichPane(engine.mdToHtml(exportMd)).json;
    expect(fromExport).toEqual(fromApp);
  });

  it("writes `\\` + newline, and leaves the editor's projection alone", () => {
    const html = throughRichPane(engine.mdToHtml("Jane Doe\n12 Oak Street")).html;
    expect(engine.htmlToCleanMd(html)).toBe("Jane Doe\n12 Oak Street");
    expect(withPortableBreaks(() => engine.htmlToCleanMd(html))).toBe("Jane Doe\\\n12 Oak Street");
    // …and the per-block projection the markdown pane uses never does.
    expect(portableBreaksActive()).toBe(false);
  });

  it("keeps a code block's backslashes and trailing spaces exactly", () => {
    const md = "```\nline one \\\nline two  \n```";
    const html = throughRichPane(engine.mdToHtml(md)).html;
    expect(withPortableBreaks(() => engine.htmlToCleanMd(html))).toBe(engine.htmlToCleanMd(html));
  });

  it("keeps a table cell's break as <br>", () => {
    const html = throughRichPane(engine.mdToHtml("| h |\n| --- |\n| one<br>two |")).html;
    const out = withPortableBreaks(() => engine.htmlToCleanMd(html));
    expect(out).toContain("| one<br>two |");
    expect(out).not.toContain("\\");
  });

  it("exports a document holding the marker character with the app's breaks, character intact", () => {
    const html = `<p>a${BREAK_MARK}b here<br>next</p>`;
    const out = withPortableBreaks(() => engine.htmlToCleanMd(html));
    expect(out).toBe(engine.htmlToCleanMd(html));
    expect(out).toContain(`a${BREAK_MARK}b`);
  });

  it("leaves a break inside link text as the editor writes it (the known limit)", () => {
    // marked \u2014 the app's own reader \u2014 does not take `\` + newline inside a
    // link's brackets: `[a\\\nb](u)` would come back as text, not a link.
    const html = throughRichPane(engine.mdToHtml("see [a\nlink](https://example.com) here\nnext")).html;
    const out = withPortableBreaks(() => engine.htmlToCleanMd(html));
    expect(out).toBe("see [a\nlink](https://example.com) here\\\nnext");
    const back = throughRichPane(engine.mdToHtml(out)).json;
    expect(back).toEqual(throughRichPane(engine.mdToHtml(engine.htmlToCleanMd(html))).json);
  });

  it("switches back off, even when the conversion throws", () => {
    expect(() => withPortableBreaks(() => { throw new Error("boom"); })).toThrow("boom");
    expect(portableBreaksActive()).toBe(false);
  });
});

describe("A051 — every markdown export path writes them", () => {
  const doc = {
    id: "d1",
    title: "Address",
    canonical: throughRichPane(engine.mdToHtml("# Address\n\nJane Doe\n12 Oak Street")).json,
    markdownCache: null,
  };
  let blobs;
  beforeEach(() => {
    blobs = [];
    globalThis.URL.createObjectURL = vi.fn((blob) => { blobs.push(blob); return "blob:mock"; });
    globalThis.URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it("File ▸ Export and the library's per-document export (exportAsMarkdown), in both modes", async () => {
    const html = throughRichPane(engine.mdToHtml("Jane Doe\n12 Oak Street")).html;
    for (const syncMode of ["clean", "styled"]) {
      exportAsMarkdown(doc, {
        getHtml: () => html,
        htmlToMd: engine.htmlToMd,
        htmlToCleanMd: engine.htmlToCleanMd,
        syncMode,
      });
    }
    const written = await Promise.all(blobs.map((b) => b.text()));
    expect(written).toEqual(["Jane Doe\\\n12 Oak Street", "Jane Doe\\\n12 Oak Street"]);
  });

  it("prefers the converter over a stored markdownCache (the editor's dialect)", async () => {
    const html = throughRichPane(engine.mdToHtml("a\nb")).html;
    exportAsMarkdown({ ...doc, markdownCache: "a\nb" }, { getHtml: () => html, htmlToCleanMd: engine.htmlToCleanMd });
    expect(await blobs[0].text()).toBe("a\\\nb");
  });

  it("the ZIP export (canonicalToPortableMarkdown), and only exports", () => {
    expect(canonicalToPortableMarkdown(doc.canonical, engine.htmlToCleanMd)).toBe("# Address\n\nJane Doe\\\n12 Oak Street");
    // Markdown that goes back INTO the app keeps the editor's form.
    expect(canonicalToMarkdown(doc.canonical, engine.htmlToCleanMd)).toBe("# Address\n\nJane Doe\n12 Oak Street");
  });

  it("the ZIP export's call site uses the portable converter", () => {
    // A source pin, because the ZIP is assembled inside the editor component:
    // the line that turns a stored record into a `.md` entry.
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== "__tests__") walk(p); }
        else if (/\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(join(process.cwd(), "src"));
    const sites = files.flatMap((f) =>
      readFileSync(f, "utf8").split("\n").filter((l) => /rec\.markdownCache \?\? \(engine \? canonicalTo/.test(l))
    );
    expect(sites.length).toBeGreaterThan(0);
    for (const line of sites) expect(line).toContain("canonicalToPortableMarkdown(");
  });
});
