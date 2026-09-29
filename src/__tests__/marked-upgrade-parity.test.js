/**
 * A113 — what the markdown → HTML path renders is pinned across marked
 * upgrades.
 *
 * `fixtures/marked-parity.json` holds a corpus and what it rendered BEFORE
 * marked moved from 12 to 18 (`baseline`): every markdown string the unit
 * suite feeds to marked (captured from a full run, with the feature set it was
 * rendered under), the starter documents and DEFAULT_CONTENT under three
 * flavors, and a curated set aimed at every behaviour change in marked 13–18's
 * release notes and at each construct this codebase customises (task lists,
 * callouts, double-tilde strikethrough, maths, wiki links, emoji, footnotes,
 * front matter, details, the curly syntax). Each case is replayed through the
 * path it was recorded from:
 *
 *   engine — `createMarkdownEngine(...).mdToHtml`, the converter the app uses
 *            (preprocessor + marked + the list-style post-pass);
 *   marked — `buildMarked(features).parse`, as the renderer-override suites
 *            drive it;
 *   global — marked's default instance, which some suites use as an oracle.
 *
 * The Word export (`docx-export.ts`) walks marked's LEXER tokens, not its
 * HTML, so its cases compare the generated `word/document.xml` body.
 *
 * Comparison is exact. A case whose output differs from the baseline carries
 * a `changed` record: `why` (the release that changed it, and the CommonMark
 * or GFM rule it now follows), `was` (the baseline HTML) and `editor`. When
 * `editor` is "same" the difference is claimed to be invisible in the rich
 * pane, and that claim is checked here: TipTap must parse `was` and `html` to
 * the identical document.
 *
 * To re-record after a deliberate change, run with MARKED_PARITY_UPDATE=1.
 * Every case whose output moved gets a `changed` record with an EMPTY `why`,
 * and this suite fails until each one says why the new output is right.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { marked } from "marked";
import { afterAll, describe, expect, it, vi } from "vitest";
import { buildMarked } from "../engine/build-marked";
import { createMarkdownEngine } from "../engine/useMarkdownEngine";
import { exportAsDocx } from "../store/docx-export";
import { throughRichPane } from "./converter-harness";

const FIXTURE = join(process.cwd(), "src/__tests__/fixtures/marked-parity.json");
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
const UPDATE = !!process.env.MARKED_PARITY_UPDATE;

const engines = new Map();
function render(c) {
  if (c.via === "engine") {
    if (!engines.has(c.features)) {
      const f = fixture.featureSets[c.features];
      engines.set(c.features, createMarkdownEngine(() => f));
    }
    return engines.get(c.features).mdToHtml(c.md);
  }
  if (c.via === "marked") return buildMarked(fixture.featureSets[c.features]).parse(c.md, { async: false });
  return marked.parse(c.md);
}

/** The document the rich pane builds from `html`. */
const richDoc = (html) => JSON.stringify(throughRichPane(html).json);

/** The body of the exported document.xml, with the random relationship ids numbered. */
async function docxBody(md) {
  let blob = null;
  globalThis.URL.createObjectURL = vi.fn((b) => {
    blob = b;
    return "blob:mock";
  });
  globalThis.URL.revokeObjectURL = vi.fn();
  await exportAsDocx("parity", md);
  const whole = strFromU8(unzipSync(new Uint8Array(await blob.arrayBuffer()))["word/document.xml"]);
  const body = whole.slice(whole.indexOf("<w:body>"), whole.lastIndexOf("</w:body>") + "</w:body>".length);
  const ids = new Map();
  return body.replace(/r:id="([^"]*)"/g, (_m, id) => {
    if (!ids.has(id)) ids.set(id, ids.size + 1);
    return `r:id="rel${ids.get(id)}"`;
  });
}

describe("marked parity: rendered HTML", () => {
  it("covers the corpus it claims to", () => {
    // A fixture that silently lost its cases would pass everything below.
    expect(fixture.cases.length).toBeGreaterThan(950);
    expect(new Set(fixture.cases.map((c) => c.via))).toEqual(new Set(["engine", "marked", "global"]));
  });

  it("says why every changed case changed", () => {
    for (const c of [...fixture.cases, ...fixture.docx].filter((x) => x.changed)) {
      expect(c.changed.why, `${c.id} ${c.from}`).toMatch(/\S/);
    }
    for (const c of fixture.cases.filter((x) => x.changed)) {
      expect(["same", "changed"], `${c.id} ${c.from}`).toContain(c.changed.editor);
    }
  });

  for (const c of fixture.cases) {
    it(`${c.id} ${c.from} [${c.via}${c.features === null ? "" : `/f${c.features}`}]`, () => {
      const html = render(c);
      if (UPDATE) {
        if (html !== c.html) {
          c.changed = { why: "", editor: richDoc(c.html) === richDoc(html) ? "same" : "changed", was: c.html };
          c.html = html;
        }
        return;
      }
      expect(html).toBe(c.html);
      if (c.changed?.editor === "same") expect(richDoc(c.html)).toBe(richDoc(c.changed.was));
    });
  }
});

describe("marked parity: Word export (lexer tokens)", () => {
  for (const d of fixture.docx) {
    it(`${d.id} ${d.from}`, async () => {
      const xml = await docxBody(d.md);
      if (UPDATE) {
        if (xml !== d.xml) {
          d.changed = { why: "" };
          d.xml = xml;
        }
        return;
      }
      expect(xml).toBe(d.xml);
    });
  }
});

afterAll(() => {
  if (!UPDATE) return;
  const version = (n) => JSON.parse(readFileSync(join(process.cwd(), "node_modules", n, "package.json"), "utf8")).version;
  fixture.recordedWith = { marked: version("marked"), "marked-emoji": version("marked-emoji"), "marked-footnote": version("marked-footnote") };
  writeFileSync(FIXTURE, JSON.stringify(fixture, null, 1) + "\n");
});
