/**
 * A083 — the rich→markdown projection converts only what changed, and is
 * EXACTLY the whole-document conversion it replaced.
 *
 * `engine.docToMd` caches each top-level block's cleaned HTML and turndown
 * output on its (immutable) ProseMirror node and joins the document from the
 * cache. The one property that matters is equivalence: after ANY sequence of
 * edits, its output must be byte-identical to `htmlToMd(editor.getHTML())`,
 * and `docHtmlHash` must equal `quickHash(editor.getHTML())` — the sync
 * engine's gate compares that number against hashes taken the old way.
 *
 * So random edit sequences (seeded, reproducible: the seed and step are in
 * every failure message) run over the round-trip corpora — inserting,
 * deleting, moving, splitting and joining blocks (adjacent lists merge),
 * typing escaper-sensitive text, toggling marks, editing tables, adding and
 * removing the footnote section, empty paragraphs and <details> blocks,
 * replacing the whole document, and switching the escaper's features — and
 * compare both modes after every step, in a random order, so neither mode's
 * cache can stand in for the other's.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { Editor } from "@tiptap/core";
import { canJoin, canSplit } from "@tiptap/pm/transform";
import TurndownService from "turndown";
import { describe, expect, it, vi } from "vitest";
import { cleanHtmlForTurndown } from "../engine/html-cleaner";
import { createIncrementalConverter } from "../engine/incremental-md";
import { withPortableBreaks } from "../engine/portable-breaks";
import { normalizeMarkdown } from "../engine/preprocessor";
import { SERIALIZE_EXTENSIONS } from "../engine/serialize-doc";
import { addBaseRules, installEscape, turndownLinear } from "../engine/turndown-rules";
import { createMarkdownEngine } from "../engine/useMarkdownEngine";
import { DEFAULT_MARKDOWN_FEATURES } from "../store/preferences/settings";
import { quickHash } from "../utils/index";

/** mulberry32 — a small seeded PRNG, so a failing sequence can be replayed. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LOREM = "Perssonify builds custom technology for teams that move fast.";

const CORPUS = [
  "Jane Doe\n12 Oak Street\nSpringfield\nUSA",
  "Intro.\n\nRoses are red\nViolets are blue\nSugar is sweet\n\nOutro.",
  "- [ ] parent\n  - [x] child\n  - [ ] child2",
  "- [ ] parent\n  1. one\n  2. two",
  "- [ ] parent\n\n  ```js\n  const a = 1;\n\n  const b = 2;\n  ```",
  "- item\n\n  ```js\n  a\n\n\n  b\n  ```\n- two",
  "- para one\n\n  para two\n- next",
  "1. first\n\n   > quoted\n2. second",
  "- a\n  - b\n  - c\n- d",
  "1. a\n   1. b\n2. c",
  "| a   | b   | c   | d   |\n| :-- | :-: | --: | --- |\n| 1   | 2   | 3   | 4   |",
  '| a | b |\n| --- | --- |\n| ~~x~~ | <img src="a.png" width="20"> |',
  "| h |\n| --- |\n| one<br>two |",
  "A claim[^1].\n\n[^1]: The source.",
  "A[^1] and B[^2].\n\n[^1]: One.\n[^2]: Two, first paragraph.\n\n    Second paragraph.",
  "---\ntitle: Front\n---\n\n# H\n\n![img](a.png)",
  "> quote\n>\n> more\n\n> [!NOTE]\n> callout\n\n---\n\n```js\na\n\n\nb\n```\n\ntext",
  "$$x^2$$\n\nInline $y$ and [[Doc|Alias]] and [[Plain]].",
  "<details><summary>S</summary>\n\nbody\n\n</details>\n\nafter",
  "## Learn C \\#\n\nUse `code` and **bold** and *em* and ~~gone~~ and <u>under</u> and H<sub>2</sub>O.",
  'Logo <picture><source media="(prefers-color-scheme: dark)" srcset="d.png"><img src="l.png" alt="x"></picture> inline.',
  // Raw HTML whose code holds a fence line: the markdown's fence scanner sees a
  // fence open there, and the whitespace pass must not be split around it.
  "<details><summary>S</summary>\n\n````\n```\nx\n```\n````\n\n</details>\n\nafter the details",
  "> quoted\n>\n> ```\n> code in a quote\n> ```\n\nafter",
  "Text that spells @@PFNORMCODE0@@ here.\n\n```\nfenced\n```\n\nand @@PFNORMCODE1@@ again.",
  `# Big\n\n${Array.from({ length: 40 }, (_, i) => `Para ${i} ${LOREM} **b${i}** and \`c${i}\`.`).join("\n\n")}`,
];

/** Text chosen to exercise the escaper and the seam rules. */
const TYPED = [
  "x", " ", "word ", "*", "_", "$5", "$x$", "~~", "#", "1) ", "- ", "<b>", "&amp;", "[[Doc]]",
  "`", "Footnotes", "\\", "{color=red}", "  ", "1. ", " ", "@@PFNORMCODE0@@", "\uE006",
];

const MARKS = [
  ["bold"], ["italic"], ["strike"], ["code"], ["underline"], ["subscript"], ["superscript"],
  ["link", { href: "https://example.com/x" }], ["textStyle", { color: "#ff0000" }],
];

function makeEngine(features) {
  return createMarkdownEngine(() => features);
}

/** Every top-level node of every corpus document, as JSON — the pool of blocks to insert. */
function blockPool(engine) {
  const ed = new Editor({ extensions: SERIALIZE_EXTENSIONS, content: "" });
  const pool = [];
  const docs = [];
  for (const md of CORPUS) {
    ed.commands.setContent(engine.mdToHtml(md), { emitUpdate: false });
    const json = ed.getJSON();
    docs.push(json);
    pool.push(...json.content);
  }
  ed.destroy();
  return { pool, docs };
}

function textblocks(doc) {
  const out = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) out.push({ node, pos });
  });
  return out;
}

/** One random edit. Returns its name (for the failure message). */
function randomEdit(ed, rand, pool, docs, features) {
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const { state } = ed;
  const { doc, schema, tr } = state;
  const topBoundary = () => {
    const i = Math.floor(rand() * (doc.childCount + 1));
    let pos = 0;
    for (let k = 0; k < i; k++) pos += doc.child(k).nodeSize;
    return pos;
  };
  const topRange = () => {
    const i = Math.floor(rand() * doc.childCount);
    let pos = 0;
    for (let k = 0; k < i; k++) pos += doc.child(k).nodeSize;
    return { i, from: pos, to: pos + doc.child(i).nodeSize };
  };
  const inTextblock = () => {
    const tbs = textblocks(doc);
    if (!tbs.length) return null;
    const { node, pos } = pick(tbs);
    const a = pos + 1 + Math.floor(rand() * (node.content.size + 1));
    const b = pos + 1 + Math.floor(rand() * (node.content.size + 1));
    return { node, pos, from: Math.min(a, b), to: Math.max(a, b) };
  };
  const dispatch = (t) => ed.view.dispatch(t);
  const kind = Math.floor(rand() * 17);
  switch (kind) {
    case 0: { // insert a block from the pool
      dispatch(tr.insert(topBoundary(), schema.nodeFromJSON(pick(pool))));
      return "insert block";
    }
    case 1: { // delete a block
      if (doc.childCount < 2) return "noop";
      const { from, to } = topRange();
      dispatch(tr.delete(from, to));
      return "delete block";
    }
    case 2: { // delete a run of blocks
      if (doc.childCount < 4) return "noop";
      const { i, from } = topRange();
      let to = from;
      for (let k = i; k < Math.min(doc.childCount, i + 2 + Math.floor(rand() * 2)); k++) to += doc.child(k).nodeSize;
      if (to >= doc.content.size) return "noop";
      dispatch(tr.delete(from, to));
      return "delete run";
    }
    case 3:
    case 4: { // type
      const at = inTextblock();
      if (!at) return "noop";
      dispatch(tr.insertText(pick(TYPED), at.from));
      return "type";
    }
    case 5: { // delete text
      const at = inTextblock();
      if (!at || at.from === at.to) return "noop";
      dispatch(tr.delete(at.from, at.to));
      return "delete text";
    }
    case 6: { // toggle a mark
      const at = inTextblock();
      if (!at || at.from === at.to) return "noop";
      const [name, attrs] = pick(MARKS);
      const type = schema.marks[name];
      if (rand() < 0.5) dispatch(tr.addMark(at.from, at.to, type.create(attrs)));
      else dispatch(tr.removeMark(at.from, at.to, type));
      return `mark ${name}`;
    }
    case 7: { // block type: paragraph <-> heading (H2 "Footnotes" is the interesting one)
      const i = Math.floor(rand() * doc.childCount);
      const node = doc.child(i);
      let pos = 0;
      for (let k = 0; k < i; k++) pos += doc.child(k).nodeSize;
      if (node.type.name === "paragraph") {
        dispatch(tr.setNodeMarkup(pos, schema.nodes.heading, { level: 1 + Math.floor(rand() * 3) }));
        return "to heading";
      }
      if (node.type.name === "heading") {
        dispatch(tr.setNodeMarkup(pos, schema.nodes.paragraph));
        return "to paragraph";
      }
      return "noop";
    }
    case 8: { // split a textblock
      const at = inTextblock();
      if (!at || !canSplit(doc, at.from)) return "noop";
      dispatch(tr.split(at.from));
      return "split";
    }
    case 9: { // join two neighbours (adjacent lists merge, two paragraphs merge)
      if (doc.childCount < 2) return "noop";
      const i = 1 + Math.floor(rand() * (doc.childCount - 1));
      let pos = 0;
      for (let k = 0; k < i; k++) pos += doc.child(k).nodeSize;
      if (!canJoin(doc, pos)) return "noop";
      // canJoin only asks whether the right node's CONTENT fits the left one;
      // an empty paragraph passes that against a list, and the step refuses.
      try {
        dispatch(tr.join(pos));
      } catch {
        return "noop";
      }
      return "join";
    }
    case 10: { // move a block
      if (doc.childCount < 3) return "noop";
      const { from, to } = topRange();
      const node = doc.slice(from, to).content;
      const t = tr.delete(from, to);
      const target = Math.min(topBoundary(), t.doc.content.size);
      let pos = 0;
      for (let k = 0; k < t.doc.childCount && pos < target; k++) pos += t.doc.child(k).nodeSize;
      dispatch(t.insert(Math.min(pos, t.doc.content.size), node));
      return "move block";
    }
    case 11: { // hard break
      const at = inTextblock();
      if (!at || at.node.type.spec.code) return "noop";
      dispatch(tr.insert(at.from, schema.nodes.hardBreak.create()));
      return "hard break";
    }
    case 12: { // empty paragraph (cleaning removes it) or a <details> (not a block to turndown)
      const node = rand() < 0.6
        ? schema.nodes.paragraph.create()
        : schema.nodeFromJSON(pick(pool.filter((n) => n.type === "details")));
      dispatch(tr.insert(topBoundary(), node));
      return node.type.name === "details" ? "details" : "empty paragraph";
    }
    case 13: { // table: add a row
      let tablePos = -1;
      doc.forEach((n, pos) => { if (n.type.name === "table" && tablePos < 0) tablePos = pos; });
      if (tablePos < 0) return "noop";
      const table = doc.nodeAt(tablePos);
      const last = table.child(table.childCount - 1);
      dispatch(tr.insert(tablePos + table.nodeSize - 1, last));
      return "table row";
    }
    case 14: { // the footnote section (H2 + definition list), anywhere
      const fn = docs.find((d) => d.content.some((n) => n.type === "heading" && JSON.stringify(n).includes("Footnotes")));
      const at = fn.content.findIndex((n) => n.type === "heading" && JSON.stringify(n).includes("Footnotes"));
      const nodes = fn.content.slice(at, at + 2).map((n) => schema.nodeFromJSON(n));
      dispatch(tr.insert(rand() < 0.5 ? doc.content.size : topBoundary(), nodes));
      return "footnotes";
    }
    case 15: { // replace the whole document (every node new: the cold path)
      ed.commands.setContent(pick(docs), { emitUpdate: false });
      return "replace document";
    }
    default: { // the escaper's settings change (the cache must not serve the old output)
      const key = pick(["math", "strikethrough", "curly"]);
      if (key === "curly") features.curlyBraceFormatting = !features.curlyBraceFormatting;
      else features[key] = !features[key];
      return `toggle ${key}`;
    }
  }
}

/** How often the markdown's hash came from its pieces (it must, mostly). */
const mdHashes = { known: 0, unknown: 0 };

function expectIdentical(engine, ed, rand, where) {
  const html = ed.getHTML();
  expect(engine.docHtmlHash(ed.state.doc), `${where}: hash`).toBe(quickHash(html));
  const modes = rand() < 0.5 ? ["styled", "clean"] : ["clean", "styled"];
  for (const mode of modes) {
    const full = (mode === "styled" ? engine.htmlToMd : engine.htmlToCleanMd)(html);
    const md = engine.docToMd(ed.state.doc, mode);
    expect(md, `${where}: ${mode}`).toBe(full);
    // The markdown's hash, when the pieces give it, is quickHash of it.
    const h = engine.docMdHash(md);
    if (h === null) mdHashes.unknown++;
    else {
      mdHashes.known++;
      expect(h, `${where}: ${mode} markdown hash`).toBe(quickHash(md));
    }
    // …and only for that markdown.
    expect(engine.docMdHash(md + "x"), `${where}: another string`).toBe(null);
  }
}

describe("A083 — the per-block projection is byte-identical to the whole-document one", () => {
  const features = { ...DEFAULT_MARKDOWN_FEATURES, footnotes: true };
  const { pool, docs } = blockPool(makeEngine(features));

  it.each(Array.from({ length: 32 }, (_, i) => [1000 + i * 7919]))("random edit sequence, seed %i", (seed) => {
    const f = { ...features };
    const engine = makeEngine(f);
    const rand = rng(seed);
    const ed = new Editor({ extensions: SERIALIZE_EXTENSIONS, content: "" });
    try {
      // Start from two concatenated corpus documents, so there is always
      // something on both sides of an edit.
      const a = docs[Math.floor(rand() * docs.length)];
      const b = docs[Math.floor(rand() * docs.length)];
      ed.commands.setContent({ type: "doc", content: [...a.content, ...b.content] }, { emitUpdate: false });
      expectIdentical(engine, ed, rand, `seed ${seed}, start`);
      for (let step = 1; step <= 40; step++) {
        const what = randomEdit(ed, rand, pool, docs, f);
        expectIdentical(engine, ed, rand, `seed ${seed}, step ${step} (${what})`);
      }
    } finally {
      ed.destroy();
    }
  }, 120000);

  it("joined most documents from their pieces, hash included", () => {
    // The walks above include every fallback (open fences, placeholder text,
    // edge whitespace); still, most projections must take the piece-wise path,
    // or it is not the path being tested. (Run on its own, with no walk before
    // it, there is nothing to count.)
    if (mdHashes.known + mdHashes.unknown === 0) return;
    expect(mdHashes.known).toBeGreaterThan(mdHashes.unknown);
  });

  it("matches on a large document, cold and after edits (the linear path)", () => {
    const f = { ...features };
    const engine = makeEngine(f);
    const rand = rng(42);
    const ed = new Editor({ extensions: SERIALIZE_EXTENSIONS, content: "" });
    try {
      const content = [];
      for (let i = 0; i < 5; i++) for (const d of docs) content.push(...d.content);
      ed.commands.setContent({ type: "doc", content }, { emitUpdate: false });
      // Several of turndownLinear's runs, and several 64-run batches cold.
      expect(ed.state.doc.childCount).toBeGreaterThan(3 * 64);
      expectIdentical(engine, ed, rand, "large, cold");
      for (let step = 1; step <= 8; step++) {
        const what = randomEdit(ed, rand, pool, docs, f);
        expectIdentical(engine, ed, rand, `large, step ${step} (${what})`);
      }
    } finally {
      ed.destroy();
    }
  }, 300000);
});

describe("A083 — the cases the random walk must not leave to chance", () => {
  const features = { ...DEFAULT_MARKDOWN_FEATURES, footnotes: true };

  function editorWith(md, f = features) {
    const engine = makeEngine(f);
    const ed = new Editor({ extensions: SERIALIZE_EXTENSIONS, content: engine.mdToHtml(md) });
    return { engine, ed };
  }
  const same = (engine, ed, mode = "styled") =>
    expect(engine.docToMd(ed.state.doc, mode)).toBe(
      (mode === "styled" ? engine.htmlToMd : engine.htmlToCleanMd)(ed.getHTML())
    );

  it("keeps the footnote heading with its list when either one is edited", () => {
    const { engine, ed } = editorWith("A claim[^1] here.\n\nMore.\n\n[^1]: The source.");
    try {
      const before = engine.docToMd(ed.state.doc, "styled");
      expect(before).not.toContain("Footnotes");
      // Edit the definition list: the heading's piece is unchanged and cached,
      // but it must still be converted beside the list, or it is written out.
      let listPos = 0;
      ed.state.doc.forEach((n, pos) => { if (n.type.name === "orderedList") listPos = pos; });
      ed.view.dispatch(ed.state.tr.insertText(" More", listPos + 4));
      same(engine, ed);
      expect(engine.docToMd(ed.state.doc, "styled")).not.toContain("Footnotes");
    } finally {
      ed.destroy();
    }
  });

  it("serves neither the other mode's nor the other settings' output", () => {
    const { engine, ed } = editorWith(`Colour <span style="color: #ff0000">red</span> costs $5 and $x$ here.`, { ...features });
    try {
      const styled = engine.docToMd(ed.state.doc, "styled");
      const clean = engine.docToMd(ed.state.doc, "clean");
      expect(styled).toContain("<span");
      expect(clean).not.toContain("<span");
      same(engine, ed, "styled");
      same(engine, ed, "clean");
    } finally {
      ed.destroy();
    }
  });

  it("re-converts cached blocks when the escaper's settings change", () => {
    const f = { ...features };
    const { engine, ed } = editorWith("Price ~~a~~ and \\$x\\$ here.", f);
    try {
      const on = engine.docToMd(ed.state.doc, "clean");
      expect(on).toContain("\\$x"); // one escaped dollar is enough to keep it from being maths
      f.math = false; // `$` no longer means anything: it must not be escaped
      const off = engine.docToMd(ed.state.doc, "clean");
      expect(off).toBe(engine.htmlToCleanMd(ed.getHTML()));
      expect(off).toContain("$x$");
      expect(off).not.toBe(on);
    } finally {
      ed.destroy();
    }
  });

  it("never cuts beside a <details>, which turndown does not treat as a block", () => {
    // A summary that begins with a space shows the difference: after a block,
    // turndown's whitespace pass drops that space from the details' markup;
    // behind a run's sentinel it would keep it. The space has to be put there
    // by an edit — parsing HTML drops it.
    for (const at of ["start", "middle", "end"]) {
      const md = {
        start: "<details><summary>Lead</summary>\n\nbody\n\n</details>\n\nafter",
        middle: "before\n\n<details><summary>Lead</summary>\n\nbody\n\n</details>\n\nafter",
        end: "before\n\n<details><summary>Lead</summary>\n\nbody\n\n</details>",
      }[at];
      const { engine, ed } = editorWith(md);
      try {
        let summaryPos = -1;
        ed.state.doc.descendants((n, pos) => { if (n.type.name === "summary" && summaryPos < 0) summaryPos = pos; });
        ed.view.dispatch(ed.state.tr.insertText("  ", summaryPos + 1));
        expect(ed.getHTML()).toContain("<summary>  Lead");
        same(engine, ed, "styled");
        same(engine, ed, "clean");
      } finally {
        ed.destroy();
      }
    }
  });

  it("drops the trailing whitespace turndown drops, not only what normalizeMarkdown does", () => {
    // A no-break space is `\s` to turndown's final trim, but not `[ \t]` to
    // normalizeMarkdown's — so only the join's own trim removes it.
    const { engine, ed } = editorWith("First.\n\nLast");
    try {
      ed.view.dispatch(ed.state.tr.insertText(" ", ed.state.doc.content.size - 1));
      same(engine, ed, "clean");
      expect(engine.docToMd(ed.state.doc, "clean").endsWith("Last")).toBe(true);
    } finally {
      ed.destroy();
    }
  });

  it("is the editor's form even inside an export, and caches nothing of the export's", () => {
    const { engine, ed } = editorWith("Jane Doe\n12 Oak Street");
    try {
      const inside = withPortableBreaks(() => engine.docToMd(ed.state.doc, "clean"));
      expect(inside).toBe("Jane Doe\n12 Oak Street");
      expect(engine.docToMd(ed.state.doc, "clean")).toBe(engine.htmlToCleanMd(ed.getHTML()));
    } finally {
      ed.destroy();
    }
  });

  it("normalizes in pieces only where that equals normalizing the whole", () => {
    // Each of these puts something at a seam that the whitespace pass reads
    // across: a fence line inside raw HTML (the scanner sees a fence opened
    // and never closed), text spelling the pass's own fence placeholder, and
    // a paragraph whose first line the pass empties (a leading hard break).
    for (const md of [
      "Intro.\n\n<details><summary>S</summary>\n\n````\n```\nx\n```\n````\n\n</details>\n\nAfter.\n\nMore after.",
      "Spells @@PFNORMCODE0@@ here.\n\n```\nfenced\n```\n\nAnd @@PFNORMCODE1@@.",
      "> quoted\n>\n> ```\n> code\n> ```\n\nafter",
    ]) {
      const { engine, ed } = editorWith(md);
      try {
        same(engine, ed, "clean");
        same(engine, ed, "styled");
        // …and after an edit, when every other block comes from the cache.
        ed.view.dispatch(ed.state.tr.insertText("x", ed.state.doc.content.size - 2));
        same(engine, ed, "clean");
      } finally {
        ed.destroy();
      }
    }
    const { engine, ed } = editorWith("First.\n\nSecond paragraph.\n\nThird.");
    try {
      engine.docToMd(ed.state.doc, "clean");
      for (const at of [1, 0]) { // the second paragraph, then the first: the document's own edge
        let pos = 0;
        ed.state.doc.forEach((n, p, i) => { if (i === at) pos = p; });
        ed.view.dispatch(ed.state.tr.insert(pos + 1, ed.state.schema.nodes.hardBreak.create()));
        same(engine, ed, "clean");
      }
      expect(engine.docToMd(ed.state.doc, "clean").startsWith("First.")).toBe(true);
    } finally {
      ed.destroy();
    }
  });

  it("joins in pieces only where the pieces' lines stay apart and the ends stay put", () => {
    // Turndown never writes these — every block ends in a newline, and its
    // whitespace pass leaves no tab at the start of a block — so a converter
    // that does stands in for it. Whatever the converter writes, the per-block
    // result must equal the whitespace pass over the joined runs.
    const P = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
    for (const [label, turndown, texts, expected] of [
      ["no newline between runs", (x) => x.replace(/<p>([^<]*)<\/p>/g, "$1"), ["first", "second", "third"], "firstsecondthird"],
      ["a tab where the document starts", (x) => x.replace(/<p>([^<]*)<\/p>/g, "\n\n$1\n\n"), ["\tfirst", "second"], "first\n\nsecond"],
    ]) {
      const fake = { turndown };
      const inc = createIncrementalConverter({ converters: { styled: fake, clean: fake }, signature: () => "", normalize: normalizeMarkdown });
      const ed = new Editor({ extensions: SERIALIZE_EXTENSIONS, content: { type: "doc", content: texts.map(P) } });
      try {
        expect(inc.toMarkdown(ed.state.doc, "clean"), label).toBe(expected);
      } finally {
        ed.destroy();
      }
    }
  });

  it("knows normalizeMarkdown's fence placeholder", () => {
    // A document whose text spells the placeholder is normalized whole
    // (incremental-md.ts FENCE_PLACEHOLDER). If the pass ever changes its
    // placeholder, that check must change with it.
    const pre = readFileSync(join(process.cwd(), "src/engine/preprocessor.ts"), "utf8");
    const inc = readFileSync(join(process.cwd(), "src/engine/incremental-md.ts"), "utf8");
    const prefix = /`@@([A-Z]+)\$\{fences\.push/.exec(pre)?.[1];
    expect(prefix).toBeTruthy();
    expect(inc).toContain(`/@@${prefix}\\d+@@/`);
  });

  it("serializes into an inert document, never the page's", () => {
    // An element created in the live document loads its resources at once:
    // each serialized <img> fetched its src (a stored image's pf-asset:
    // reference broke the CSP; a remote image was requested unasked).
    const { ed } = editorWith("Text ![pic](https://example.com/a.png) here.\n\nMore.");
    const fresh = makeEngine(features); // cold: every block is serialized
    const expected = fresh.htmlToCleanMd(ed.getHTML());
    const spies = ["createElement", "createElementNS", "createTextNode"].map((m) => vi.spyOn(document, m));
    let md;
    try {
      md = fresh.docToMd(ed.state.doc, "clean");
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      spies.forEach((s) => s.mockRestore());
      ed.destroy();
    }
    expect(md).toBe(expected);
    expect(md).toContain("![pic](https://example.com/a.png)");
  });

  it("converts text holding the batch separators exactly", () => {
    // The batched clean and the batched turndown separate pieces with private-
    // use characters; a document that contains them takes the one-by-one path.
    const { ed } = editorWith(Array.from({ length: 6 }, (_, i) => `Para ${i}`).join("\n\n"));
    try {
      ed.view.dispatch(ed.state.tr.insertText("\uE002 and \uE003", 3));
      const fresh = makeEngine(features); // cold: every piece goes through the batches
      expect(fresh.docToMd(ed.state.doc, "clean")).toBe(fresh.htmlToCleanMd(ed.getHTML()));
      expect(fresh.docToMd(ed.state.doc, "clean")).toContain("\uE002 and \uE003");
    } finally {
      ed.destroy();
    }
  });

  it("converts only the block that changed", () => {
    // Counting converters: after the first (cold) conversion, one typed
    // character must cost ONE turndown pass over one paragraph, and the
    // whitespace pass must see that paragraph, not the document. This is the
    // whole point of the module, and nothing else observes it.
    const td = makeTd();
    let calls = 0;
    let chars = 0;
    let normalized = 0;
    const counting = { turndown: (x) => (calls++, (chars += x.length), td.turndown(x)) };
    const inc = createIncrementalConverter({
      converters: { styled: counting, clean: counting },
      signature: () => "",
      normalize: (md) => ((normalized += md.length), normalizeMarkdown(md)),
    });
    const full = (html) => normalizeMarkdown(turndownLinear(td, cleanHtmlForTurndown(html)));
    const engine = makeEngine(features);
    // Empty paragraphs between the blocks: cleaning removes them, and they
    // must not glue their neighbours into one run either.
    const ed = new Editor({ extensions: SERIALIZE_EXTENSIONS, content: "" });
    ed.commands.setContent(engine.mdToHtml(Array.from({ length: 300 }, (_, i) => `Para ${i} ${LOREM}`).join("\n\n")), { emitUpdate: false });
    const withGaps = [];
    ed.state.doc.forEach((n) => withGaps.push(n.toJSON(), { type: "paragraph" }));
    ed.commands.setContent({ type: "doc", content: withGaps }, { emitUpdate: false });
    try {
      expect(inc.toMarkdown(ed.state.doc, "clean")).toBe(full(ed.getHTML()));
      expect(calls).toBeGreaterThan(1);
      expect(calls).toBeLessThanOrEqual(Math.ceil(301 / 64)); // batched: 64 runs per pass
      calls = 0;
      chars = 0;
      normalized = 0;
      ed.view.dispatch(ed.state.tr.insertText("x", 5));
      expect(inc.toMarkdown(ed.state.doc, "clean")).toBe(full(ed.getHTML()));
      expect(calls).toBe(1);
      expect(chars).toBeLessThan(200); // the one paragraph, not the document
      expect(normalized).toBeLessThan(200);
      calls = 0;
      inc.toMarkdown(ed.state.doc, "clean");
      expect(calls).toBe(0); // nothing changed: nothing converted
    } finally {
      ed.destroy();
    }
  });
});

/** A TurndownService configured exactly like the engine's clean converter. */
function makeTd() {
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", emDelimiter: "*", hr: "---" });
  addBaseRules(td);
  installEscape(td, () => ({ math: true, strikethrough: true, curly: false }));
  return td;
}
