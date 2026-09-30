/**
 * A083 — the rules the incremental markdown→rich projection cuts by, and every
 * way it declines to cut. The random walks (incremental-rich.test.js) prove
 * the result equals the whole-document parse; these pin WHICH path each
 * situation takes, so a rule that silently stops cutting (slow) or starts
 * cutting where it must not (corruption the walks may take a while to find)
 * is named by its own failing case.
 */
import { createDocument, Editor, elementFromString, getSchema } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import { Marked } from "marked";
import { describe, expect, it } from "vitest";
import { leavesParserClean, parseHtmlDoc, removeTipTapWhitespace, selfContainedHtml } from "../engine/incremental-rich";
import { SERIALIZE_EXTENSIONS } from "../engine/serialize-doc";
import { TableCellFast, TableHeaderFast } from "../engine/table-colwidth";
import { buildMarked } from "../engine/build-marked";
import { createMarkdownEngine } from "../engine/useMarkdownEngine";
import { DEFAULT_MARKDOWN_FEATURES } from "../store/settings";

const LOREM = "Perssonify builds custom technology for teams that move fast.";

/** An engine and an editor, the markdown projected into it once (the model is built). */
function rig(md, { features = {}, runLength = 0, getMarked } = {}) {
  let f = { ...DEFAULT_MARKDOWN_FEATURES, footnotes: true, ...features };
  const engine = createMarkdownEngine(() => f, getMarked, { richRunLength: runLength });
  const ed = new Editor({ extensions: SERIALIZE_EXTENSIONS, content: "" });
  const ref = new Editor({ extensions: SERIALIZE_EXTENSIONS, content: "" });
  const r = {
    engine,
    ed,
    md,
    project(next) {
      r.md = next;
      const plan = engine.planRich(next, ed.state);
      r.tr = plan.tr;
      if (plan.tr) ed.view.dispatch(plan.tr);
      plan.commit(ed.state.doc);
      return engine.lastRichPath();
    },
    /** The whole-document path's document for the current markdown. */
    expected() {
      ref.chain().setMeta("preventAutolink", true).setContent(engine.mdToHtml(r.md), { emitUpdate: false }).run();
      return ed.schema.nodeFromJSON(ref.getJSON());
    },
    same() {
      expect(ed.state.doc.toJSON()).toEqual(r.expected().toJSON());
    },
    setFeatures(next) { f = { ...f, ...next }; },
    destroy() { ed.destroy(); ref.destroy(); },
  };
  r.first = r.project(md);
  return r;
}

const paras = (n, tag = "P") => Array.from({ length: n }, (_, i) => `${tag}${i} ${LOREM}`).join("\n\n");

describe("the cut rules", () => {
  it("builds a model first, then re-parses only the runs an edit touches", () => {
    const r = rig(paras(40));
    try {
      expect(r.first).toEqual({ path: "build", reason: "no model" });
      const path = r.project(r.md.replace("P20 ", "P20 edited "));
      expect(path.path).toBe("incremental");
      expect(path.reason).toMatch(/^[1-3] of 40 runs$/);
      r.same();
    } finally { r.destroy(); }
  });

  it("never cuts after a list: a paragraph turned into an item joins it", () => {
    const md = `${paras(5)}\n\n- one\n- two\n\nafter the list\n\n${paras(5, "Q")}`;
    const r = rig(md);
    try {
      expect(r.project(r.md.replace("after the list", "- three")).path).toBe("incremental");
      r.same();
      // One list of three, not two lists.
      const lists = [];
      r.ed.state.doc.forEach((n) => { if (n.type.name === "bulletList") lists.push(n.childCount); });
      expect(lists).toEqual([3]);
    } finally { r.destroy(); }
  });

  it("never cuts after a list: a marker completed mid-line joins the list", () => {
    // "-after" is a paragraph; one keystroke later "- after" is a list item,
    // and after a blank line an item continues the list above (a loose list).
    // The edit is one character into the run, so only the no-cut rule — not
    // backing off one run — keeps the list in the window.
    const md = `${paras(5)}\n\n- one\n- two\n\n-after\n\n${paras(5, "Q")}`;
    const r = rig(md);
    try {
      r.project(r.md.replace("-after", "- after"));
      r.same();
      const lists = [];
      r.ed.state.doc.forEach((n) => { if (n.type.name === "bulletList") lists.push(n.childCount); });
      expect(lists).toEqual([3]);
    } finally { r.destroy(); }
  });

  it("never cuts after indented code: a paragraph indented into it joins it", () => {
    const md = `${paras(5)}\n\n    code one\n\nplain\n\n${paras(5, "Q")}`;
    const r = rig(md);
    try {
      r.project(r.md.replace("\nplain", "\n    plain"));
      r.same();
    } finally { r.destroy(); }
  });

  it("an opened fence takes the rest of the document, and closing it gives it back", () => {
    const r = rig(`${paras(10)}\n\n${paras(10, "Q")}`);
    try {
      expect(r.project(r.md.replace("P5 ", "```\nP5 ")).path).toBe("incremental");
      r.same();
      expect(r.ed.state.doc.lastChild.type.name).toMatch(/codeBlock|paragraph/);
      expect(r.project(r.md.replace("Q9 ", "```\nQ9 ")).path).toBe("incremental");
      r.same();
    } finally { r.destroy(); }
  });

  it("an HTML comment opened mid-document runs to its end", () => {
    const r = rig(`${paras(10)}\n\n${paras(10, "Q")}`);
    try {
      r.project(r.md.replace("P3 ", "<!-- P3 "));
      r.same();
      r.project(r.md.replace("Q2 ", "--> Q2 "));
      r.same();
    } finally { r.destroy(); }
  });

  it("keeps a setext underline with its paragraph", () => {
    const r = rig(paras(10));
    try {
      r.project(r.md.replace(`P4 ${LOREM}`, `P4 ${LOREM}\n===`));
      r.same();
      expect(r.ed.state.doc.child(4).type.name).toBe("heading");
    } finally { r.destroy(); }
  });

  it("does not cut after raw HTML that leaves the parser open, and cuts again once it closes", () => {
    const r = rig(`${paras(4)}\n\n<div>\n\n${paras(4, "Q")}\n\n</div>\n\n${paras(4, "R")}`);
    try {
      r.same();
      r.project(r.md.replace("Q1 ", "Q1 changed "));
      r.same();
      r.project(r.md.replace("R2 ", "R2 changed "));
      expect(r.engine.lastRichPath().reason).toMatch(/^1 of/);
      r.same();
    } finally { r.destroy(); }
  });

  it("does not cut while an inline <code> leaves marked's inline state set", () => {
    const r = rig(`${paras(4)}\n\nopen <code>raw & text\n\n${paras(4, "Q")}\n\nclose </code> here\n\n${paras(4, "R")}`);
    try {
      r.same();
      // Inside the raw state marked does not escape text, so "<x y" reaches
      // the HTML parser as a tag; outside it, it is text.
      r.project(r.md.replace("Q2 ", "Q2 <x y "));
      r.same();
      r.project(r.md.replace("R1 ", "R1 <x y "));
      r.same();
    } finally { r.destroy(); }
  });

  it("treats top-level text as needing the block before it (leading space)", () => {
    // ProseMirror keeps a top-level text run's leading space only after a node.
    const r = rig(`${paras(3)}\n\n<div>x</div> tail\n\n${paras(3, "Q")}`);
    try {
      r.project(r.md.replace("<div>x</div> tail", "<div>y</div> tail"));
      r.same();
    } finally { r.destroy(); }
  });

  it("maps a markdown block to as many nodes as it makes, or none", () => {
    // A paragraph holding a raw <div> splits into three nodes; a comment makes none.
    const r = rig(`${paras(3)}\n\nsplit <div>d</div> here\n\n<!-- nothing -->\n\n${paras(3, "Q")}`);
    try {
      r.project(r.md.replace("Q1 ", "Q1 x "));
      r.same();
      r.project(r.md.replace("P1 ", "P1 x "));
      r.same();
    } finally { r.destroy(); }
  });

  it("re-parses the blocks the rich pane changed since, as the whole path does", () => {
    const r = rig(paras(20));
    try {
      const { ed } = r;
      // Centre paragraph 7 in the rich pane: markdown has no alignment, so the
      // whole-document parse would undo it.
      let pos = 0;
      for (let k = 0; k < 7; k++) pos += ed.state.doc.child(k).nodeSize;
      ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { textAlign: "center" }));
      expect(r.project(r.md.replace("P15 ", "P15 x ")).path).toBe("incremental");
      r.same();
      expect(ed.state.doc.child(7).attrs.textAlign).toBe(null);
    } finally { r.destroy(); }
  });

  it("projects nothing for markdown that parses to the same document", () => {
    const r = rig(paras(10));
    try {
      r.project(r.md);
      expect(r.tr).toBe(null);
      expect(r.engine.lastRichPath()).toEqual({ path: "incremental", reason: "unchanged" });
      r.project(r.md.replace("P3 Perssonify", "P3  Perssonify").replace("P3  Perssonify", "P3 Perssonify"));
      expect(r.tr).toBe(null);
    } finally { r.destroy(); }
  });

  it("an emptied document is the whole path's: one empty paragraph", () => {
    const r = rig(paras(3));
    try {
      r.project("");
      r.same();
      expect(r.ed.state.doc.childCount).toBe(1);
    } finally { r.destroy(); }
  });

  it("joins runs where the parser is left with a paragraph open, as the whole parse joins them", () => {
    // `<div>x</div> tail` leaves " tail" in a paragraph ProseMirror opened at
    // the top level; the html block after the blank line continues it.
    const r = rig(`${paras(3)}\n\n<div>x</div> tail\n\n<span>\nnext\n</span>\n\n${paras(3, "Q")}`);
    try {
      r.same();
      r.project(r.md.replace("Q1 ", "Q1 x "));
      r.same();
    } finally { r.destroy(); }
  });

  it("takes in the next run when an edit leaves the window's end with a paragraph open", () => {
    const r = rig(`${paras(3)}\n\n<div>x</div>\n\n<span>\nnext\n</span>\n\n${paras(3, "Q")}`);
    try {
      expect(r.project(r.md.replace("<div>x</div>", "<div>x</div> tail")).path).toBe("incremental");
      r.same();
    } finally { r.destroy(); }
  });

  it("cuts a document that starts with a newline (marked-footnote swallows it)", () => {
    const r = rig(`\n${paras(10)}`);
    try {
      expect(r.first).toEqual({ path: "build", reason: "no model" });
      expect(r.project(r.md.replace("P5 ", "P5 x ")).path).toBe("incremental");
      r.same();
    } finally { r.destroy(); }
  });

  it("text typed at the very start of a run joins that run's first line", () => {
    // The window ends where the next run starts, so the typed text lands at
    // its end — and marked, lexing it alone, reads a trailing tab or four
    // spaces as a blank line. In the document they make the line code.
    const r = rig(paras(8));
    try {
      expect(r.project(r.md.replace("P5 ", "\tP5 ")).path).toBe("incremental");
      r.same();
      r.project(r.md.replace("P2 ", "    P2 "));
      r.same();
      r.project(r.md.replace("\tP5 ", "P5 "));
      r.same();
    } finally { r.destroy(); }
  });

  it("a run after runs that make no node is at the document's start", () => {
    // A comment makes no node, so the text in the unknown element after it is
    // the document's first top-level text: its leading space goes.
    const r = rig(`<!-- note -->\n\n<span>\n spaced</span>\n\n${paras(3)}`);
    try {
      r.same();
      expect(r.project(r.md.replace("P1 ", "P1 x ")).path).toBe("incremental");
      r.same();
    } finally { r.destroy(); }
  });

  it("never cuts where the next piece starts with text: it joins the whitespace before it", () => {
    // `</details>` is ignored and opens an HTML block: its text is top-level,
    // one Text node with the newline the comment's block ends with.
    const r = rig(`<!-- note -->\n\n</details>\ntop-level text\n\n${paras(3)}`);
    try {
      r.same();
      expect(r.project(r.md.replace("P1 ", "P1 x ")).path).toBe("incremental");
      r.same();
    } finally { r.destroy(); }
  });

  it("a window whose first run now starts with text is not parsed on its own", () => {
    // An edit inside run 5 (so the window starts there) makes it begin with
    // text; in the document that text joins the newline run 4 ends with, and
    // keeps its leading space. (Typed at the run's very first character, the
    // window would start a run earlier and see the join itself.)
    const r = rig(paras(8).replace("P5 ", "<div>P5 "));
    try {
      expect(r.project(r.md.replace("<div>P5 ", "</div>P5 ")))
        .toEqual({ path: "build", reason: "text at a run start" });
      r.same();
      expect(r.project(r.md.replace("</div>P5 ", "</div>P5 x ")).path).toBe("incremental");
      r.same();
    } finally { r.destroy(); }
  });

  it("text foster-parented out of an unclosed table lands where the whole parse puts it", () => {
    // `<table>` opening a paragraph line makes an HTML block the parser never
    // closes; its text goes before the table. jsdom puts it at the END of the
    // parent when the node before the table is not Text — so a cut marker
    // there must not be that node.
    const r = rig(paras(8));
    try {
      expect(r.project(r.md.replace("P5 ", "<table>P5 ")).path).toBe("incremental");
      r.same();
      r.project(r.md.replace("P2 ", "<table>P2 "));
      r.same();
    } finally { r.destroy(); }
  });

  it("never cuts a document whose raw <pre> makes ProseMirror keep whitespace from there on", () => {
    // The <pre> holds a paragraph, so its context closes early and the
    // parser marks the DOCUMENT whitespace-preserving: the last paragraph
    // keeps its two leading spaces. The inline `</pre>` later clears marked's
    // raw state (and is ignored by the HTML parser), so without the check the
    // blocks after it would be cut and parsed without that flag.
    const md = `${paras(2)}\n\n- list<pre>\n\n  continuation\n\n- end\n\nclosing </pre> here\n\n${paras(3, "Q")}\n\n  spaced para`;
    const r = rig(md);
    try {
      expect(r.first).toEqual({ path: "whole", reason: "raw <pre> or white-space" });
      r.same();
      expect(r.ed.state.doc.lastChild.textContent).toBe("  spaced para");
      for (const style of ['<span style="white-space: pre">x</span>', '<span style="wh\\69te-space: pre">x</span>']) {
        expect(r.project(`${paras(3)}\n\n${style}\n\n${paras(3, "Q")}`).path).toBe("whole");
        r.same();
      }
    } finally { r.destroy(); }
  });

  it("a markup comment that spells the cut marker is only text to the cuts", () => {
    const r = rig(`${paras(3)}\n\n<!--pf-a083-cut-->\n\n${paras(3, "Q")}`);
    try {
      r.same();
      r.project(r.md.replace("Q0 ", "Q0 x "));
      r.same();
    } finally { r.destroy(); }
  });

  it("an alias in a table cell stays one cell (the preprocessor escapes its pipe)", () => {
    const r = rig(paras(5));
    try {
      r.project(r.md.replace("P2 ", "| a | b |\n| - | - |\n| [[Doc|Alias]] | x |\n\nP2 "));
      r.same();
      r.project(r.md.replace("P4 ", "P4 x "));
      r.same();
    } finally { r.destroy(); }
  });

  it("a trailing paragraph the rich pane aligned is not TrailingNode's, and goes", () => {
    const r = rig(`${paras(5)}\n\n- a\n- b`);
    try {
      const { ed } = r;
      const pos = ed.state.doc.content.size - ed.state.doc.lastChild.nodeSize;
      ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { textAlign: "center" }));
      // The list is unchanged: only the paragraph after it is not TrailingNode's.
      r.project(r.md.replace("P2 ", "P2 x "));
      r.same();
      expect(ed.state.doc.lastChild.attrs.textAlign).toBe(null);
    } finally { r.destroy(); }
  });

  it("an empty paragraph after a paragraph is content, not TrailingNode's", () => {
    const r = rig(`${paras(5)}\n\n<p></p>`);
    try {
      expect(r.ed.state.doc.lastChild.content.size).toBe(0);
      // Another block changes in the same projection, so the range runs from
      // it through the empty paragraph, with the unchanged P4 in between.
      r.project(r.md.replace("P3 ", "P3 x ").replace("\n\n<p></p>", ""));
      r.same();
    } finally { r.destroy(); }
  });

  it("keeps runs of at least the requested length", () => {
    const r = rig(paras(40), { runLength: 2048 });
    try {
      const path = r.project(r.md.replace("P20 ", "P20 x "));
      const [, runs] = /of (\d+) runs/.exec(path.reason);
      expect(Number(runs)).toBeLessThan(40);
      expect(Number(runs)).toBeGreaterThan(1);
      r.same();
    } finally { r.destroy(); }
  });
});

describe("the whole-document path, and why", () => {
  const cases = [
    ["link definitions", `${paras(5)}\n\n[r]: https://example.com\n\n[see][r]`],
    ["footnotes", `${paras(5)}\n\nA claim[^1].\n\n[^1]: The source.`],
    ["alias wiki link", `${paras(5)}\n\nSee [[Doc|the doc]].`],
  ];
  it.each(cases)("%s", (reason, md) => {
    const r = rig(md);
    try {
      expect(r.first).toEqual({ path: "whole", reason });
      expect(r.project(r.md.replace("P2 ", "P2 x "))).toEqual({ path: "whole", reason });
      r.same();
    } finally { r.destroy(); }
  });

  it("an inline <a> that is never closed", () => {
    const r = rig(`${paras(3)}\n\nopen <a href="x">link\n\n${paras(3, "Q")}`);
    try {
      r.project(r.md.replace("Q1 ", "Q1 www.example.com "));
      r.same();
    } finally { r.destroy(); }
  });

  it("the curly-brace syntax, when switched on", () => {
    const r = rig(paras(5), { features: { curlyBraceFormatting: true } });
    try {
      expect(r.first).toEqual({ path: "whole", reason: "curly braces" });
      r.project(r.md.replace("P1 ", "{color=red}P1{/color} "));
      r.same();
    } finally { r.destroy(); }
  });

  it("marked hooks (they may rewrite anything)", () => {
    const m = buildMarked(DEFAULT_MARKDOWN_FEATURES);
    m.use({ hooks: { postprocess: (html) => html.replace(/P1/g, "hooked") } });
    const r = rig(paras(5), { getMarked: () => m });
    try {
      expect(r.first).toEqual({ path: "whole", reason: "marked hooks" });
      r.same();
      expect(JSON.stringify(r.ed.getJSON())).toContain("hooked");
    } finally { r.destroy(); }
  });

  it("a carriage return (marked normalises line endings)", () => {
    const r = rig(paras(3).replace(/\n\n/g, "\r\n\r\n"));
    try {
      expect(r.first).toEqual({ path: "whole", reason: "carriage return" });
      r.same();
    } finally { r.destroy(); }
  });

  it("a feature change rebuilds the model", () => {
    const r = rig(paras(5));
    try {
      r.setFeatures({ math: false });
      expect(r.project(r.md.replace("P1 ", "P1 $x$ "))).toEqual({ path: "build", reason: "configuration" });
      r.same();
    } finally { r.destroy(); }
  });

  it("front matter: edits after it stay incremental, edits in it rebuild", () => {
    const r = rig(`---\ntitle: T\ntags: [a]\n---\n\n${paras(20)}`);
    try {
      expect(r.first.path).toBe("build");
      r.same();
      expect(r.project(r.md.replace("P10 ", "P10 x ")).path).toBe("incremental");
      r.same();
      expect(r.project(r.md.replace("title: T", "title: Changed"))).toEqual({ path: "build", reason: "front matter" });
      r.same();
    } finally { r.destroy(); }
  });

  it("front matter: an edit that keeps its length still rebuilds (a window may not start inside it)", () => {
    const r = rig(`---\ntitle: T\n---\n\n${paras(20)}`);
    try {
      expect(r.project(r.md.replace("title: T", "title: X"))).toEqual({ path: "build", reason: "front matter" });
      r.same();
    } finally { r.destroy(); }
  });

  it("front matter that appears when a closing line is typed far below", () => {
    const r = rig(`---\ntitle: T\n\n${paras(20)}`);
    try {
      r.same();
      expect(r.project(r.md.replace("P15 ", "---\n\nP15 "))).toEqual({ path: "build", reason: "front matter" });
      r.same();
      expect(r.ed.state.doc.firstChild.type.name).toBe("frontmatter");
    } finally { r.destroy(); }
  });

  it("footnote syntax typed into a window, numbered from 1 as the whole path numbers it", () => {
    // marked-footnote's counter is reset only by RENDERING a reference; a
    // window lexed and then abandoned used to start the real parse at 2.
    const r = rig(paras(20));
    try {
      expect(r.project(r.md.replace("P10 ", "Claim[^n] P10 ").replace("P12 ", "[^n]: note\n\nP12 "))).toEqual({ path: "whole", reason: "footnotes" });
      r.same();
      expect(JSON.stringify(r.ed.getJSON())).toContain('"text":"1"');
    } finally { r.destroy(); }
  });
});

describe("the transaction", () => {
  it("keeps the nodes it does not change — objects, not just equal ones", () => {
    const r = rig(paras(30));
    try {
      const before = [];
      r.ed.state.doc.forEach((n) => before.push(n));
      r.project(r.md.replace("P14 ", "P14 x "));
      const after = [];
      r.ed.state.doc.forEach((n) => after.push(n));
      const kept = after.filter((n, k) => n === before[k]).length;
      expect(kept).toBe(29);
      r.same();
    } finally { r.destroy(); }
  });

  it("after a load, replaces only the blocks that do not parse back to themselves", () => {
    // A code block gains the trailing newline marked writes; nothing else changes.
    const engine = createMarkdownEngine(() => DEFAULT_MARKDOWN_FEATURES, undefined, { richRunLength: 0 });
    const ed = new Editor({ extensions: SERIALIZE_EXTENSIONS, content: "" });
    try {
      const content = [];
      for (let i = 0; i < 10; i++) {
        content.push({ type: "paragraph", content: [{ type: "text", text: `Para ${i}` }] });
        if (i % 3 === 0) content.push({ type: "codeBlock", attrs: { language: "js" }, content: [{ type: "text", text: `code ${i}` }] });
      }
      ed.commands.setContent({ type: "doc", content }, { emitUpdate: false });
      const md = engine.docToMd(ed.state.doc, "styled");
      const before = [];
      ed.state.doc.forEach((n) => before.push(n));
      const plan = engine.planRich(md, ed.state);
      expect(plan.tr.steps.length).toBe(4); // the four code blocks, one step each
      ed.view.dispatch(plan.tr);
      const kept = [];
      ed.state.doc.forEach((n, _o, k) => { if (n === before[k]) kept.push(n.type.name); });
      expect(kept.every((t) => t === "paragraph")).toBe(true);
      expect(kept).toHaveLength(10);
    } finally { ed.destroy(); }
  });

  it("leaves TrailingNode's paragraph alone when the last block is unchanged", () => {
    const r = rig(`${paras(10)}\n\n- last\n- list`);
    try {
      const tail = r.ed.state.doc.lastChild;
      expect(tail.type.name).toBe("paragraph");
      expect(tail.content.size).toBe(0);
      r.project(r.md.replace("P9 ", "P9 x "));
      expect(r.ed.state.doc.lastChild).toBe(tail);
      r.same();
      // …and lets the plugin decide when the last block does change.
      r.project(r.md.replace("- list", "- list\n\nfinal paragraph"));
      r.same();
      expect(r.ed.state.doc.lastChild.textContent).toBe("final paragraph");
    } finally { r.destroy(); }
  });

  it("is not a rich-pane edit: no update event, no autolink", () => {
    const r = rig(paras(5));
    try {
      const plan = r.engine.planRich(r.md.replace("P0 ", "Visit example.com\n\nP0 "), r.ed.state);
      expect(plan.tr.getMeta("preventUpdate")).toBe(true);
      expect(plan.tr.getMeta("preventAutolink")).toBe(true);
      r.ed.view.dispatch(plan.tr);
      expect(JSON.stringify(r.ed.getJSON())).not.toContain('"type":"link"');
    } finally { r.destroy(); }
  });
});

describe("selfContainedHtml", () => {
  const yes = [
    "<p>plain <strong>bold</strong> <em>em</em> <code>c</code> <a href=\"x\">l</a></p>\n",
    "<ul style=\"list-style:disc\">\n<li><p>a</p>\n<ul>\n<li>b</li>\n</ul>\n</li>\n</ul>\n",
    "<table>\n<thead>\n<tr>\n<th align=\"center\">h</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>1 <img src=\"a.png\" width=\"20\"><br>two</td>\n</tr>\n</tbody></table>\n",
    "<details><summary>S</summary>\n<p>body</p>\n</details>",
    "<picture><source media=\"(prefers-color-scheme: dark)\" srcset=\"d.png\"><img src=\"l.png\" alt=\"x\"></picture>",
    "<div data-type=\"callout\" data-callout=\"note\">\n<p>x</p>\n</div>\n",
    "<p>a < b and 3<4</p>",
    "<pre><code class=\"language-js\">x &lt; y\n</code></pre>\n",
    "<DIV>upper</DIV>",
    "<p>x</p><!-- a comment --><!----><!-->",
  ];
  const no = [
    ["an unclosed element", "<div>\n<p>x</p>\n"],
    ["an unclosed formatting element", "<p><b>bold</p>"],
    ["misnested end tags", "<b><i>x</b></i>"],
    ["a block inside a paragraph", "<p>a <div>b</div></p>"],
    ["a block inside a span", "<span><p>x</p></span>"],
    ["a link inside a link", "<a href=\"a\"><a href=\"b\">x</a></a>"],
    ["an unclosed comment", "<p>x</p><!-- c"],
    ["a comment closed with --!>", "<!-- c --!> <p>x</p> -->"],
    ["a doctype", "<!DOCTYPE html><p>x</p>"],
    ["a script", "<script>x</script>"],
    ["an end tag for a void element", "<p>a</br></p>"],
    ["a self-closed non-void element", "<div/>"],
    ["a list item outside a list", "<li>x</li>"],
    ["text directly in a table", "<table>text<tr><td>x</td></tr></table>"],
    ["an unknown element", "<custom-el>x</custom-el>"],
    ["a bogus end tag", "<p>x</ p>"],
    ["a table caption", "<table><caption>c</caption></table>"],
  ];
  it.each(yes.map((h) => [h]))("accepts %s", (html) => expect(selfContainedHtml(html)).toBe(true));
  it.each(no)("rejects %s", (_what, html) => expect(selfContainedHtml(html)).toBe(false));
});

describe("leavesParserClean (the probe, for markup the rules do not know)", () => {
  const clean = [
    "<center>x</center>",
    "<dl><dt>t</dt><dd>d</dd></dl>",
    "<p>a <custom-el>b</custom-el></p>",
    "<video src=\"v.mp4\"></video>",
    "<p>x</p></body>", // "after body" recovers into <body> exactly as the next piece would
  ];
  const unclean = [
    ["an open element", "<center>x"],
    ["a pending formatting element", "<p><b>x</p>"],
    ["an open table (the probe is foster-parented before it)", "<table><tr><td>x</td></tr>"],
    ["an unclosed comment", "<!-- x"],
    ["raw text", "<textarea>x"],
    ["foreign content", "<svg><circle/></svg>"],
    ["a select", "<select><option>x"],
    ["a template", "<template><p>x</p>"],
    ["an unterminated tag", "<p>x</p><img src=\"a"],
  ];
  it.each(clean.map((h) => [h]))("clean after %s", (html) => expect(leavesParserClean(html)).toBe(true));
  it.each(unclean)("not clean after %s", (_what, html) => expect(leavesParserClean(html)).toBe(false));

  it("keeps cutting after an element the rules do not know", () => {
    const r = rig(`${paras(3)}\n\n<center>\nold style\n</center>\n\n${paras(20, "Q")}`);
    try {
      const path = r.project(r.md.replace("Q15 ", "Q15 x "));
      expect(path.path).toBe("incremental");
      expect(path.reason).toMatch(/^[12] of/);
      r.same();
    } finally { r.destroy(); }
  });
});

describe("the HTML → document half, as TipTap does it", () => {
  const samples = [
    "<p>a</p>\n<p>b</p>\n",
    "<p>a</p>\n  \n<ul>\n<li>x</li>\n\n</ul>\n",
    "<pre><code>\n</code></pre>\n<pre><code>a\n\n  \n</code></pre>",
    "\n<p>lead</p>\n\n\n<p>trail</p>\n",
    "<div>\n  <span> x </span>\n</div>\n text \n",
    "<table>\n<tr>\n<td>\n</td>\n</tr>\n</table>\n",
  ];

  it.each(samples.map((s) => [s]))("removes the same whitespace as elementFromString: %j", (html) => {
    const body = new window.DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
    removeTipTapWhitespace(body);
    expect(body.innerHTML).toBe(elementFromString(html).innerHTML);
  });

  it.each(samples.map((s) => [s]))("parses the same document as setContent's own parse: %j", (html) => {
    // setContent's document before the plugins' appended transactions
    // (TrailingNode, fixTables) — createDocument, as setContent calls it.
    const schema = getSchema(SERIALIZE_EXTENSIONS);
    const want = createDocument(html, schema, {}, { errorOnInvalidContent: false });
    expect(parseHtmlDoc(html, schema).toJSON()).toEqual(want.toJSON());
  });

  it("reads a table cell's width from <colgroup> exactly as TipTap's own cells do", () => {
    const stock = getSchema([StarterKit, Table, TableRow, TableCell, TableHeader]);
    const fast = getSchema([StarterKit, Table, TableRow, TableCellFast, TableHeaderFast]);
    const tables = [
      "<table><colgroup><col width=\"40\"><col><col width=\"70\"></colgroup><tr><th>a</th><th>b</th><th>c</th></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>",
      "<table><tr><td colwidth=\"25,35\" colspan=\"2\">x</td></tr></table>",
      "<table><tr><td>no cols</td></tr></table>",
      // Nested: the inner table's cols count in the outer one's query too.
      "<table><colgroup><col width=\"10\"></colgroup><tr><td><table><colgroup><col width=\"99\"><col width=\"77\"></colgroup><tr><td>i</td><td>j</td></tr></table></td><td>o</td></tr></table>",
    ];
    for (const html of tables) {
      const a = PMDOMParser.fromSchema(stock).parse(elementFromString(html)).toJSON();
      const b = PMDOMParser.fromSchema(fast).parse(elementFromString(html)).toJSON();
      expect(b).toEqual(a);
    }
    // (And the fixture does carry widths, or the comparison proves nothing.)
    expect(JSON.stringify(PMDOMParser.fromSchema(stock).parse(elementFromString(tables[0])).toJSON())).toContain("[40]");
  });

  it("uses no querySelectorAll per cell (its cost grows with the whole document)", () => {
    const qsa = Element.prototype.querySelectorAll;
    let calls = 0;
    Element.prototype.querySelectorAll = function (...args) { calls++; return qsa.apply(this, args); };
    try {
      const fast = getSchema([StarterKit, Table, TableRow, TableCellFast, TableHeaderFast]);
      PMDOMParser.fromSchema(fast).parse(elementFromString("<table><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>"));
      expect(calls).toBe(0);
    } finally {
      Element.prototype.querySelectorAll = qsa;
    }
  });
});

it("Marked stays importable the way the projector uses it", () => {
  // The projector re-runs marked.parse's own steps (Lexer, walkTokens, Parser).
  const m = new Marked();
  expect(typeof m.walkTokens).toBe("function");
});
