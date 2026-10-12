import { describe, expect, it } from "vitest";
import { STARTER_DOCUMENTS } from "../data/starter-documents.ts";
import { DEFAULT_CONTENT } from "../constants.ts";

/**
 * The first-run library must form a CONNECTED graph.
 *
 * The relationship map opened on a single unconnected dot for every new user,
 * because the app seeded exactly one document — there was nothing to relate.
 * These documents fix that only as long as their `[[wiki links]]` keep
 * resolving, and wiki links resolve by TITLE, which is derived from each
 * document's first heading. So a seemingly cosmetic heading edit ("# Changelog"
 * → "# Change log") silently empties the map again.
 *
 * These assertions tie the two together: every link target must be a document
 * that is actually seeded, and every seeded document must be reachable.
 */

/** Title of a markdown document = its first H1, the same rule the app uses. */
const titleOf = (md) => md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;

/**
 * Every `[[Target]]` / `[[Target|Display]]`, minus any `#heading` anchor.
 *
 * Code is stripped first, matching `scanWikiLinks`: the welcome document
 * documents the syntax with a literal `[[Document title]]` example, which is
 * deliberately not a link and must not be counted as a broken one.
 */
const linksIn = (md) => {
  const prose = md
    .replace(/```[\s\S]*?```/g, " ")   // fenced code
    .replace(/`[^`\n]*`/g, " ");        // inline code
  return [...prose.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
};

// The welcome document is titled by its first H1, like every other document.
// App.tsx passes initialDocument.title "Welcome", but that is only the name to
// fall back to when there is no heading (F4 in PerssonifyEditor). This used to
// hard-code "Welcome", so the test agreed with the starters' [[Welcome]] links
// while every new user saw them drawn as broken.
const WELCOME_TITLE = titleOf(DEFAULT_CONTENT);

const docs = [
  { title: WELCOME_TITLE, markdown: DEFAULT_CONTENT },
  ...STARTER_DOCUMENTS.map((d) => ({ title: titleOf(d.markdown), markdown: d.markdown })),
];

describe("first-run documents", () => {
  it("seeds a changelog and a getting-started note", () => {
    const titles = STARTER_DOCUMENTS.map((d) => titleOf(d.markdown));
    expect(titles).toContain("Changelog");
    expect(titles).toContain("Getting started");
  });

  it("files the getting-started note in a folder", () => {
    const guide = STARTER_DOCUMENTS.find((d) => titleOf(d.markdown) === "Getting started");
    expect(guide.folderPath).toEqual(["Guides"]);
  });

  it("gives every starter a derivable title (a first H1)", () => {
    for (const d of STARTER_DOCUMENTS) {
      expect(titleOf(d.markdown), `starter with body "${d.markdown.slice(0, 40)}…"`).toBeTruthy();
    }
  });
});

describe("the seeded graph is connected", () => {
  const known = new Set(docs.map((d) => d.title));

  it.each(docs.map((d) => [d.title, d.markdown]))(
    "%s links only to documents that are actually seeded",
    (_title, markdown) => {
      for (const target of linksIn(markdown)) {
        expect(known, `[[${target}]] does not match any seeded document title`).toContain(target);
      }
    }
  );

  it("links the welcome document to both companions", () => {
    const fromWelcome = linksIn(DEFAULT_CONTENT);
    expect(fromWelcome).toContain("Changelog");
    expect(fromWelcome).toContain("Getting started");
  });

  it("leaves no document orphaned — every one is linked from somewhere", () => {
    const linked = new Set(docs.flatMap((d) => linksIn(d.markdown)));
    for (const d of docs) {
      // The welcome doc is the entry point; the others must be reachable.
      expect(linked, `"${d.title}" is seeded but nothing links to it`).toContain(d.title);
    }
  });

  it("produces at least one edge per document, so the map is never a lone dot", () => {
    const edges = docs.flatMap((d) => linksIn(d.markdown).map((t) => `${d.title}→${t}`));
    expect(new Set(edges).size).toBeGreaterThanOrEqual(docs.length);
  });
});
