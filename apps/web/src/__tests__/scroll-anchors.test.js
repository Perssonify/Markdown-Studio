import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownHeadings } from "../ui/panes/editorPanes/scroll-anchors";

/**
 * C1. The split-pane scroll sync pairs headings on the two sides by normalised
 * text. The markdown side found them with `/^#{1,6}\s+(.*)$/` per line, which
 * is anchored with no tolerance for anything before the hashes — so it saw ATX
 * headings only, unindented and unquoted. The rich side uses a descendant
 * selector over every rendered h1-h6, which includes setext headings, headings
 * inside a blockquote, and headings nested in a list.
 *
 * Those extra anchors existed on one side and not the other. The pairing pass
 * skips what it cannot match, so each one cost an alignment point — and its
 * lookahead window is four, so more than four consecutive unmatched headings
 * breaks pairing for the whole rest of the document.
 */

const headings = (doc) =>
  markdownHeadings(EditorState.create({ doc, extensions: [markdown()] })).map((h) => h.text);

describe("markdownHeadings", () => {
  it("finds ATX headings at every level", () => {
    expect(headings("# One\n\n## Two\n\n###### Six\n")).toEqual(["One", "Two", "Six"]);
  });

  it("finds SETEXT headings — the rich pane renders these as h1/h2", () => {
    expect(headings("Title\n=====\n\nSubtitle\n--------\n")).toEqual(["Title", "Subtitle"]);
  });

  it("finds headings inside a BLOCKQUOTE", () => {
    expect(headings("> # Quoted\n>\n> body\n")).toEqual(["Quoted"]);
  });

  it("finds a heading nested in a list item", () => {
    expect(headings("- item\n\n  # Nested\n")).toContain("Nested");
  });

  it("strips closing hashes from a closed ATX heading", () => {
    expect(headings("## Middle ##\n")).toEqual(["Middle"]);
  });

  it("returns them in document order whatever their nesting", () => {
    const doc = "# First\n\n> ## Quoted\n\nThird\n=====\n\n#### Fourth\n";
    expect(headings(doc)).toEqual(["First", "Quoted", "Third", "Fourth"]);
  });
});

describe("what must NOT count as a heading", () => {
  it("ignores a # comment inside a fenced code block", () => {
    // The reason the old scanner carried a hand-rolled fence tracker; the parse
    // tree decides this for us.
    expect(headings("# Real\n\n```sh\n# not a heading\n```\n")).toEqual(["Real"]);
  });

  it("ignores a tilde-fenced block too", () => {
    expect(headings("~~~\n# nope\n~~~\n\n# Real\n")).toEqual(["Real"]);
  });

  it("ignores an INDENTED code block — which the old regex also mishandled", () => {
    expect(headings("paragraph\n\n    # indented code\n")).toEqual([]);
  });

  it("ignores a hash that is not a heading marker", () => {
    expect(headings("#hashtag with no space\n")).toEqual([]);
  });

  it("ignores a lone --- (a horizontal rule, not a setext underline)", () => {
    expect(headings("para\n\n---\n\nmore\n")).toEqual([]);
  });

  it("returns nothing for a document with no headings", () => {
    expect(headings("just some prose\n\nand more\n")).toEqual([]);
  });
});

describe("positions", () => {
  it("reports the heading's own start, so lineBlockAt lands on its line", () => {
    const doc = "intro\n\n## Target\n";
    const state = EditorState.create({ doc, extensions: [markdown()] });
    const [h] = markdownHeadings(state);
    expect(state.doc.lineAt(h.from).text).toBe("## Target");
  });

  it("reports a blockquoted heading's start inside the quote", () => {
    const doc = "> ### Deep\n";
    const state = EditorState.create({ doc, extensions: [markdown()] });
    const [h] = markdownHeadings(state);
    expect(state.doc.sliceString(h.from, h.from + 3)).toBe("###");
  });
});
