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
import { describe, expect, it } from "vitest";
import { createMarkdownEngine } from "../engine/useMarkdownEngine";
import { DEFAULT_MARKDOWN_FEATURES } from "../store/preferences/settings";
import {
  CORPUS, CUTTABLE, FEATURE_TOGGLES, LOCAL_SNIPPETS, SNIPPETS,
  expectSame, mdEdit, newEditor, project, richEdit, rng,
} from "./incremental-rich-harness";

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
