/**
 * Shared by the markdown→rich projection walks (A083) — not a test file itself
 * (vitest collects only `*.test.{js,jsx}`): the corpora and edits the random
 * walks are made of, and the oracle every projection is compared with.
 * `incremental-rich.test.js` walks from a model the first projection builds;
 * `incremental-rich-prebuild.test.js` from one prepared ahead.
 */
import { Editor } from "@tiptap/core";
import { expect } from "vitest";
import { SERIALIZE_EXTENSIONS } from "../engine/serialize-doc";

/** mulberry32 — a small seeded PRNG, so a failing sequence can be replayed. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CORPUS = [
  "# Title\n\nIntro with **bold**, *em*, `code`, ~~strike~~ and a [link](https://example.com).\n\nSecond paragraph\nwith a soft break.",
  "Setext heading\n==============\n\nAnother\n-------\n\ntext",
  "- a\n- b\n  - nested\n- c\n\n1. one\n2. two\n\n3) paren\n\n* star\n+ plus",
  "- loose\n\n- list\n\n  continuation para\n\n- end",
  "- [ ] task\n- [x] done\n  - [ ] nested task",
  "```js\nconst a = 1;\n\n\nconst b = 2;\n```\n\n~~~\ntilde\n~~~\n\n    indented code\n    more\n\nafter",
  "> quote\n> more\n\n> [!NOTE]\n> callout body\n\n> [!WARNING]\n> careful",
  "| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |\n| x | <u>y</u> | [[Doc]] |\n\nafter table",
  "$$\nx^2 + y^2\n$$\n\nInline $a_1$ and $5 and $10.",
  "<details><summary>Sum</summary>\n\nHidden body\n\n</details>\n\nafter",
  "<div align=\"center\">\n<img src=\"logo.png\" width=\"40\">\n</div>\n\ntext",
  "<picture><source media=\"(prefers-color-scheme: dark)\" srcset=\"d.png\"><img src=\"l.png\" alt=\"x\"></picture>\n\nafter picture",
  "Text with <span style=\"color: #ff0000\">red</span> and H<sub>2</sub>O and x<sup>3</sup>.",
  "---\n\nthematic\n\n***\n\n___\n\nend",
  "A claim[^1].\n\n[^1]: The source.",
  "[ref link][r]\n\n[r]: https://example.com \"Title\"",
  "---\ntitle: Front\ntags: [a, b]\n---\n\n# After front matter\n\nbody",
  "Emoji :smile: and :rocket: here.\n\nWiki [[Page]] and [[Page#Heading]] and [[#Local]].",
  "<!-- a comment\n\nspanning -->\n\nafter comment",
  "Line one  \nhard break\\\nbackslash break",
  "1. item\n\n   ```\n   code in item\n   ```\n\n2. next",
  "Para\n    lazy indented continuation\n\n    real indented code\n\nend",
  "Visit example.com\n\nand www.example.org and https://example.net/x.",
  "![image](a.png) alone\n\n![](b.png)\n\ntext ![inline](c.png) text",
];

/**
 * The corpus without what makes a whole document uncuttable (definitions,
 * footnotes, front matter) — for the long walks, which are there to exercise
 * many runs. The snippets still type those constructs in.
 */
export const CUTTABLE = CORPUS.filter((md) => !/\[\^|\]: |^---\ntitle/m.test(md));

/** Text chosen to open, close and merge every kind of block. */
export const SNIPPETS = [
  "x", "word ", " ", "\n", "\n\n", "\n\n\n", "- ", "* ", "1. ", "# ", "## ", "> ", "    ", "\t",
  "```", "```\n", "~~~\n", "$$", "$x$", "|", "| a | b |\n| - | - |\n| 1 | 2 |\n", "[[Doc]]",
  "[[Doc|Alias]]", "[^1]", "[^1]: note\n", "[r]: http://x\n", "<b>", "</b>", "<div>", "</div>",
  "<!--", "-->", "---\n", "===\n", "***", "**", "_", "`", "<u>u</u>", "<a href=\"x\">", "</a>",
  "<code>", "http://example.com ", "example.com ", ":smile:", "- [ ] ", "\\", "&amp;", "<",
  "<details>\n<summary>S</summary>\n\nx\n\n</details>\n", "<img src=\"a.png\" width=\"20\">",
  "{color=red}c{/color}", "---\ntitle: t\n---\n", "  \n", "<span>", "</span>", "<p>", "</p>",
  "> [!TIP]\n> tip\n", "[x]: y\n", "<table>", "<pre>", "</pre>", "\n    code\n",
  "<kbd>K</kbd>", "<a href=\"y\">l</a>", "<code>c</code> ", "<x y ", "<!--pf-a083-cut-->", "<p></p>",
  "<span>\ninline block\n</span>\n", "<div>x</div> tail", "\n\n\n\n", "-x", "1)",
];

/** The snippets whose effect is local: for the long walks (see CUTTABLE). */
// (`</pre>` too: one deleted slash makes it a `<pre>`, which keeps the text whole.)
export const LOCAL_SNIPPETS = SNIPPETS.filter((s) => !/\]: |\[\^|^---\ntitle|\|Alias|<a |<code>|<\/?pre>|\{color/.test(s));

export const FEATURE_TOGGLES = ["math", "footnotes", "tables", "strikethrough", "taskLists", "callouts", "emoji", "curlyBraceFormatting", "autolink"];

export function newEditor() {
  return new Editor({ extensions: SERIALIZE_EXTENSIONS, content: "" });
}

/** The whole-document path, as the sync engine used to take it (autolinking aside — see incremental-rich.ts). */
export function oracle(ref, engine, md) {
  ref.chain().setMeta("preventAutolink", true).setContent(engine.mdToHtml(md), { emitUpdate: false }).run();
  return ref.getJSON();
}

export function project(ed, engine, md) {
  const plan = engine.planRich(md, ed.state);
  if (plan.tr) ed.view.dispatch(plan.tr);
  plan.commit(ed.state.doc);
}

/** The path to the deepest node where two documents differ, and both nodes there. */
export function firstDiff(a, b, path = []) {
  for (;;) {
    if (!a.sameMarkup(b) || a.childCount !== b.childCount || a.isText) return { path, a, b };
    let k = 0;
    while (k < a.childCount && a.child(k).eq(b.child(k))) k++;
    if (k === a.childCount) return { path, a, b };
    path = [...path, k];
    a = a.child(k);
    b = b.child(k);
  }
}

export function expectSame(ed, ref, engine, md, where) {
  const want = ed.schema.nodeFromJSON(oracle(ref, engine, md));
  if (!ed.state.doc.eq(want)) {
    // Say WHICH block differs, and where inside it; the JSON of both is in
    // the diff below.
    const a = ed.state.doc;
    let at = 0;
    while (at < Math.min(a.childCount, want.childCount) && a.child(at).eq(want.child(at))) at++;
    const d = firstDiff(a, want);
    const inside = `deepest difference at [${d.path}]: ${JSON.stringify(d.a.toJSON()).slice(0, 400)} vs ${JSON.stringify(d.b.toJSON()).slice(0, 400)}`;
    expect(
      JSON.stringify(a.toJSON().content?.slice(at, at + 2)),
      `${where}: block ${at} of ${a.childCount} (expected ${want.childCount}) — ${inside} — markdown:\n${JSON.stringify(md)}`,
    ).toBe(JSON.stringify(want.toJSON().content?.slice(at, at + 2)));
    expect(a.toJSON(), where).toEqual(want.toJSON());
  }
}

export const lineStarts = (md) => {
  const out = [0];
  for (let i = 0; i < md.length; i++) if (md[i] === "\n") out.push(i + 1);
  return out;
};

/** One random markdown edit. Returns [newMarkdown, what]. */
export function mdEdit(md, rand, corpus = CORPUS, snippets = SNIPPETS) {
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const at = () => Math.floor(rand() * (md.length + 1));
  const lineAt = () => pick(lineStarts(md));
  const kind = Math.floor(rand() * 12);
  switch (kind) {
    case 0:
    case 1:
    case 2: { // type a snippet anywhere
      const p = at();
      const s = pick(snippets);
      return [md.slice(0, p) + s + md.slice(p), `type ${JSON.stringify(s)}`];
    }
    case 3: { // type a snippet at a line start (block markers mean most there)
      const p = lineAt();
      const s = pick(snippets);
      return [md.slice(0, p) + s + md.slice(p), `type ${JSON.stringify(s)} at line start`];
    }
    case 4: { // delete a few characters
      const p = at();
      const n = 1 + Math.floor(rand() * 6);
      return [md.slice(0, p) + md.slice(p + n), `delete ${n}`];
    }
    case 5: { // delete whole lines
      const starts = lineStarts(md);
      const k = Math.floor(rand() * starts.length);
      const k2 = Math.min(starts.length, k + 1 + Math.floor(rand() * 3));
      const end = k2 < starts.length ? starts[k2] : md.length;
      return [md.slice(0, starts[k]) + md.slice(end), `delete lines ${k}..${k2}`];
    }
    case 6: { // split: a blank line in the middle of a line
      const p = at();
      return [md.slice(0, p) + "\n\n" + md.slice(p), "split"];
    }
    case 7: { // join: a blank line removed (lists merge, a setext underline meets its paragraph)
      const blanks = [];
      for (let i = md.indexOf("\n\n"); i !== -1; i = md.indexOf("\n\n", i + 1)) blanks.push(i);
      if (!blanks.length) return [md, "noop"];
      const p = pick(blanks);
      return [md.slice(0, p) + (rand() < 0.5 ? "\n" : "") + md.slice(p + 2), "join"];
    }
    case 8: { // move a block (paragraph-separated chunk)
      const chunks = md.split("\n\n");
      if (chunks.length < 3) return [md, "noop"];
      const from = Math.floor(rand() * chunks.length);
      const [c] = chunks.splice(from, 1);
      chunks.splice(Math.floor(rand() * (chunks.length + 1)), 0, c);
      return [chunks.join("\n\n"), "move block"];
    }
    case 9: { // duplicate a block
      const chunks = md.split("\n\n");
      const k = Math.floor(rand() * chunks.length);
      chunks.splice(k, 0, chunks[k]);
      return [chunks.join("\n\n"), "duplicate block"];
    }
    case 10: { // insert a whole corpus document somewhere
      const p = lineAt();
      const doc = pick(corpus);
      return [md.slice(0, p) + doc + "\n\n" + md.slice(p), "insert document"];
    }
    default: { // replace a range with another range of itself
      const a = at();
      const b = at();
      const c = at();
      const [x, y] = a < b ? [a, b] : [b, a];
      const piece = md.slice(Math.min(c, md.length), Math.min(md.length, c + 1 + Math.floor(rand() * 40)));
      return [md.slice(0, x) + piece + md.slice(Math.min(y, x + 40)), "replace range"];
    }
  }
}

export function textblocks(doc) {
  const out = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock && !node.type.spec.code) out.push({ node, pos });
  });
  return out;
}

/** One random RICH-pane edit, projected back into the markdown as the sync engine writes it. */
export function richEdit(ed, engine, rand) {
  const { state } = ed;
  const { doc, schema, tr } = state;
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const kind = Math.floor(rand() * 5);
  const tbs = textblocks(doc);
  if (kind === 0 && tbs.length) {
    const { node, pos } = pick(tbs);
    ed.view.dispatch(tr.insertText(pick(["rich ", "x", "**", "$y$ "]), pos + 1 + Math.floor(rand() * (node.content.size + 1))));
  } else if (kind === 1 && doc.childCount > 1) {
    const i = Math.floor(rand() * doc.childCount);
    let pos = 0;
    for (let k = 0; k < i; k++) pos += doc.child(k).nodeSize;
    ed.view.dispatch(tr.delete(pos, pos + doc.child(i).nodeSize));
  } else if (kind === 2 && tbs.length) {
    const { node, pos } = pick(tbs);
    if (node.content.size > 1) ed.view.dispatch(tr.addMark(pos + 1, pos + node.content.size, schema.marks.bold.create()));
  } else if (kind === 3 && tbs.length) {
    const { node, pos } = pick(tbs);
    ed.view.dispatch(tr.setNodeMarkup(pos, node.type, { ...node.attrs, textAlign: node.type.name === "paragraph" ? "center" : node.attrs.textAlign }));
  } else {
    const i = Math.floor(rand() * (doc.childCount + 1));
    let pos = 0;
    for (let k = 0; k < i; k++) pos += doc.child(k).nodeSize;
    ed.view.dispatch(tr.insert(pos, schema.nodes.paragraph.create(null, schema.text(`Rich ${Math.floor(rand() * 1000)}`))));
  }
  return engine.docToMd(ed.state.doc, rand() < 0.5 ? "styled" : "clean");
}
