/**
 * A083 — the markdown→rich projection re-parses only what changed, and is
 * EXACTLY the whole-document parse it replaced.
 *
 * `engine.planRich` keeps a model of where the markdown can be cut into runs
 * of top-level blocks and how many rich-pane nodes each run produced, and
 * re-parses only the runs an edit touched. The one property that matters is
 * equivalence: after ANY sequence of edits the editor's document must be
 * `Node.eq` to what `setContent(mdToHtml(md))` builds — the whole-document
 * path, with its appended transactions (fixTables) — for the same markdown.
 *
 * So seeded, reproducible random walks (the seed and step are in every failure
 * message) edit the markdown of the round-trip corpora: typing every kind of
 * block marker and inline construct, deleting ranges and lines, splitting and
 * joining blocks (adjacent lists merge, a paragraph becomes a setext heading),
 * opening and closing fences and HTML comments, adding and removing link
 * definitions, footnotes, front matter and alias wiki links (each a fallback),
 * moving and duplicating blocks, replacing the whole document, switching
 * features — and editing the RICH pane in between, projecting it back the way
 * the markdown pane is written. Every projection is compared with the oracle.
 */
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { SERIALIZE_EXTENSIONS } from "../engine/serialize-doc";
import { createMarkdownEngine } from "../engine/useMarkdownEngine";
import { DEFAULT_MARKDOWN_FEATURES } from "../store/settings";

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

const CORPUS = [
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
const CUTTABLE = CORPUS.filter((md) => !/\[\^|\]: |^---\ntitle/m.test(md));

/** Text chosen to open, close and merge every kind of block. */
const SNIPPETS = [
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
const LOCAL_SNIPPETS = SNIPPETS.filter((s) => !/\]: |\[\^|^---\ntitle|\|Alias|<a |<code>|<\/?pre>|\{color/.test(s));

const FEATURE_TOGGLES = ["math", "footnotes", "tables", "strikethrough", "taskLists", "callouts", "emoji", "curlyBraceFormatting", "autolink"];

function newEditor() {
  return new Editor({ extensions: SERIALIZE_EXTENSIONS, content: "" });
}

/** The whole-document path, as the sync engine used to take it (autolinking aside — see incremental-rich.ts). */
function oracle(ref, engine, md) {
  ref.chain().setMeta("preventAutolink", true).setContent(engine.mdToHtml(md), { emitUpdate: false }).run();
  return ref.getJSON();
}

function project(ed, engine, md) {
  const plan = engine.planRich(md, ed.state);
  if (plan.tr) ed.view.dispatch(plan.tr);
  plan.commit(ed.state.doc);
}

/** The path to the deepest node where two documents differ, and both nodes there. */
function firstDiff(a, b, path = []) {
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

function expectSame(ed, ref, engine, md, where) {
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

const lineStarts = (md) => {
  const out = [0];
  for (let i = 0; i < md.length; i++) if (md[i] === "\n") out.push(i + 1);
  return out;
};

/** One random markdown edit. Returns [newMarkdown, what]. */
function mdEdit(md, rand, corpus = CORPUS, snippets = SNIPPETS) {
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

function textblocks(doc) {
  const out = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock && !node.type.spec.code) out.push({ node, pos });
  });
  return out;
}

/** One random RICH-pane edit, projected back into the markdown as the sync engine writes it. */
function richEdit(ed, engine, rand) {
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

function walk(seed, { steps = 50, start = 3, richEvery = 0.12, toggleEvery = 0.03, corpus = CORPUS, snippets = SNIPPETS, runLength = 0 } = {}) {
  const rand = rng(seed);
  let features = { ...DEFAULT_MARKDOWN_FEATURES, footnotes: true };
  const engine = createMarkdownEngine(() => features, undefined, { richRunLength: runLength });
  const ed = newEditor();
  const ref = newEditor();
  // `why`: how many times each fallback reason came up (named in a failed ratio).
  const paths = { incremental: 0, build: 0, whole: 0, why: {} };
  try {
    let md = Array.from({ length: start }, () => corpus[Math.floor(rand() * corpus.length)]).join("\n\n");
    project(ed, engine, md);
    expectSame(ed, ref, engine, md, `seed ${seed}, start`);
    for (let step = 1; step <= steps; step++) {
      let what;
      const before = md;
      const r = rand();
      if (r < richEvery) {
        md = richEdit(ed, engine, rand);
        what = "rich edit";
      } else if (r < richEvery + toggleEvery) {
        const key = FEATURE_TOGGLES[Math.floor(rand() * FEATURE_TOGGLES.length)];
        features = { ...features, [key]: !features[key] };
        what = `toggle ${key}`;
      } else if (r < richEvery + toggleEvery + 0.02) {
        // Another document of the same size (a long walk stays long).
        md = Array.from({ length: start }, () => corpus[Math.floor(rand() * corpus.length)]).join("\n\n");
        what = "replace document";
      } else {
        [md, what] = mdEdit(md, rand, corpus, snippets);
      }
      try {
        project(ed, engine, md);
      } catch (e) {
        throw new Error(`seed ${seed}, step ${step} (${what}) threw ${e}\nfrom ${JSON.stringify(before)}\nto ${JSON.stringify(md)}`, { cause: e });
      }
      paths[engine.lastRichPath().path]++;
      if (engine.lastRichPath().path !== "incremental") paths.why[engine.lastRichPath().reason] = (paths.why[engine.lastRichPath().reason] || 0) + 1;
      const how = engine.lastRichPath();
      expectSame(ed, ref, engine, md, `seed ${seed}, step ${step} (${what}; ${how.path}: ${how.reason}) from ${JSON.stringify(before)}\n`);
      // Projecting the same markdown again changes nothing — and dispatches
      // nothing, once there is a model to say so.
      const settled = ed.state.doc;
      const again = engine.planRich(md, ed.state);
      if (engine.lastRichPath().path === "incremental") {
        expect(again.tr, `seed ${seed}, step ${step}: a second projection dispatches nothing`).toBe(null);
      }
      if (again.tr) ed.view.dispatch(again.tr);
      again.commit(ed.state.doc);
      expect(ed.state.doc.eq(settled), `seed ${seed}, step ${step}: a second projection is a no-op`).toBe(true);
    }
  } finally {
    ed.destroy();
    ref.destroy();
  }
  return paths;
}

describe("A083 — the incremental markdown→rich projection is identical to the whole-document parse", () => {
  const totals = { incremental: 0, build: 0, whole: 0 };

  // RICH_SEEDS=500 for a deeper run than CI's; RICH_SEED_FROM=<n> skips the
  // first n seeds (to split a deep run across processes).
  const seeds = Number(process.env.RICH_SEEDS) || 40;
  const from = Number(process.env.RICH_SEED_FROM) || 0;
  it.each(Array.from({ length: seeds }, (_, i) => [2000 + (from + i) * 7919]))("random edit walk, seed %i", (seed) => {
    const paths = walk(seed);
    for (const k in totals) totals[k] += paths[k];
  }, 120000);

  // Seeds that each found a defect in a deep run (600 to 4,000 seeds) — kept,
  // because CI's 40 found none of them. They replay the walk that failed only
  // while the corpus and snippets above are unchanged; after that they are
  // simply more walks.
  const FOUND = [
    532573, 564249, 912685, 1459096, 1641233, 2155968, 2203482, 2243077, 3003301, 3098329,
    3304223, 3423008, 3438846, 3937743, 4214908, 4302017, 4523749, 4777157, 4808833, 7113262,
    7667592, 10257105, 10328376, 11128195, 12909970, 26491055, 34219999, 37704359, 40452252, 62950131, 82145787,
  ];
  it.each(FOUND.map((s) => [s]))("random edit walk that once found a defect, seed %i", (seed) => {
    const paths = walk(seed);
    for (const k in totals) totals[k] += paths[k];
  }, 120000);

  it("took the incremental path for most projections (or the walks test nothing)", () => {
    if (totals.incremental + totals.build + totals.whole === 0) return; // run on its own
    expect(totals.incremental).toBeGreaterThan(totals.build + totals.whole);
  });

  // RICH_LONG_SEEDS=<n> adds n more long walks of each kind (RICH_SEED_FROM
  // offsets them too) — equivalence only, for a deeper run than CI's.
  const longSeeds = Number(process.env.RICH_LONG_SEEDS) || 0;
  it.each(Array.from({ length: longSeeds }, (_, i) => [5000 + (from + i) * 104729]))("a long document, deep-run seed %i", (seed) => {
    walk(seed, { steps: 30, start: 60, richEvery: 0.1, toggleEvery: 0, corpus: CUTTABLE, snippets: LOCAL_SNIPPETS });
    walk(seed + 1, { steps: 30, start: 400, richEvery: 0.1, toggleEvery: 0, corpus: CUTTABLE, snippets: LOCAL_SNIPPETS, runLength: 2048 });
  }, 600000);

  it.each([[91], [92], [93]])("a long document, seed %i (windows grow across many runs)", (seed) => {
    const paths = walk(seed, { steps: 30, start: 60, richEvery: 0.1, toggleEvery: 0, corpus: CUTTABLE, snippets: LOCAL_SNIPPETS });
    expect(paths.incremental, JSON.stringify(paths.why)).toBeGreaterThan(paths.build + paths.whole);
  }, 300000);

  it.each([[71], [72]])("a long document at the app's run length, seed %i", (seed) => {
    // The app cuts no closer than ~2 KB (RUN_LENGTH); the walks above cut as
    // finely as they can, which is the harder test of the rules.
    // ~50 KB: a couple of dozen runs at that length.
    const paths = walk(seed, { steps: 30, start: 400, richEvery: 0.1, toggleEvery: 0, corpus: CUTTABLE, snippets: LOCAL_SNIPPETS, runLength: 2048 });
    expect(paths.incremental, JSON.stringify(paths.why)).toBeGreaterThan(paths.build + paths.whole);
  }, 300000);
});
