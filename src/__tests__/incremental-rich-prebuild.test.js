/**
 * A083 — the markdown→rich projection's model, prepared ahead.
 *
 * The first markdown keystroke after opening a document used to parse ALL of
 * it to build the model the later ones re-parse a run or two of (4 MB: 22 s at
 * 4x CPU). `prepareRich` builds that model after the load instead, a window at
 * a time in idle slices, by the same rules an edit's window is cut by; the
 * first keystroke finishes whatever is left. The property is the one the
 * projection always had: after ANY sequence of edits the editor's document is
 * `Node.eq` to `setContent(mdToHtml(md))`'s.
 *
 * The walks load documents the way storage hands them over — NOT always the
 * parse of their own markdown (a code block typed in the rich pane has no
 * trailing newline; alignment has no markdown at all) — prepare them in none,
 * some or all of their slices, sometimes edit the rich pane before the first
 * markdown keystroke, and compare every projection with the oracle.
 */
import { TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { STEP_LIMIT } from "../engine/incremental-rich";
import { createMarkdownEngine } from "../engine/useMarkdownEngine";
import { DEFAULT_MARKDOWN_FEATURES } from "../store/settings";
import {
  CORPUS, CUTTABLE, LOCAL_SNIPPETS, SNIPPETS,
  expectSame, mdEdit, newEditor, oracle, project, richEdit, rng,
} from "./incremental-rich-harness";

const LOREM = "Perssonify builds custom technology for teams that move fast.";
const paras = (n, from = 0) => Array.from({ length: n }, (_, i) => `P${from + i} ${LOREM}`).join("\n\n");

/**
 * A stored document: the parse of `md`, then changed the ways a document from
 * storage differs from the parse of its own markdown — a code block typed in
 * the rich pane has no trailing newline (marked writes one), and a centred
 * paragraph's alignment has no markdown carrier.
 */
function storedCanonical(ref, engine, md, rand) {
  const json = oracle(ref, engine, md);
  const visit = (node) => {
    const text = node.type === "codeBlock" ? node.content?.[0]?.text : undefined;
    if (text && text.length > 1 && text.endsWith("\n") && rand() < 0.8) node.content[0].text = text.slice(0, -1);
    if (node.type === "paragraph" && rand() < 0.1) node.attrs = { ...node.attrs, textAlign: "center" };
    for (const child of node.content ?? []) visit(child);
  };
  visit(json);
  return json;
}

/**
 * What the sync engine does on a load (setCanonical): forget the model, load
 * the document, write its markdown into the pane, prepare. Then idle time runs
 * none, some or all of the slices.
 *
 * `raw`: prepare this markdown instead of the document's own. The app hands
 * over what the converter writes, which never holds a link definition, a raw
 * `</div>` or front matter in mid-document; the projector takes any markdown,
 * and the walks hold it to that.
 */
function load(ed, engine, canonical, slices, raw = null) {
  engine.forgetRich();
  ed.commands.setContent(canonical, { emitUpdate: false });
  const md = raw ?? engine.docToMd(ed.state.doc, "styled");
  const job = engine.prepareRich(md, ed.state);
  if (job) {
    if (slices === Infinity) while (!job.step(() => true));
    else for (let k = 0; k < slices; k++) job.step(() => true);
  }
  return { md, job };
}

function prebuildWalk(seed, { steps = 30, start = 3, richEvery = 0.12, reloadEvery = 0.08, corpus = CORPUS, snippets = SNIPPETS, runLength = 0, chunk = 1 } = {}) {
  const rand = rng(seed);
  let features = { ...DEFAULT_MARKDOWN_FEATURES, footnotes: true };
  const engine = createMarkdownEngine(() => features, undefined, { richRunLength: runLength, richPrebuildMin: 0, richPrebuildChunk: chunk });
  const ed = newEditor();
  const ref = newEditor();
  // `first`: how the first projection after each load went (`firsts` of them;
  // a load can be followed by another before any projection).
  const stats = { loads: 0, firsts: 0, prebuilt: 0, first: {} };
  try {
    let md = "";
    let fresh = false;
    const reload = (step) => {
      let src = Array.from({ length: start }, () => corpus[Math.floor(rand() * corpus.length)]).join("\n\n");
      // Text that is already a mess when it is prepared — stray closing tags,
      // half a list, an open fence — so the windows' own rules are exercised,
      // not only the edits' after them.
      for (let k = Math.floor(rand() * 5); k > 0; k--) [src] = mdEdit(src, rand, corpus, snippets);
      const r = rand();
      const slices = r < 0.55 ? Infinity : r < 0.8 ? 1 + Math.floor(rand() * 4) : 0;
      ({ md } = load(ed, engine, storedCanonical(ref, engine, src, rand), slices, rand() < 0.5 ? src : null));
      stats.loads++;
      fresh = true;
      // The rich pane edited before the first markdown keystroke, sometimes.
      while (rand() < 0.25) md = richEdit(ed, engine, rand);
      // A feature switched in between, now and then: the preparation is then of no use.
      if (rand() < 0.03) features = { ...features, math: !features.math };
      return `reload at step ${step}`;
    };
    reload(0);
    for (let step = 1; step <= steps; step++) {
      let what;
      const before = md;
      const r = rand();
      if (r < reloadEvery) {
        what = reload(step);
        // A forced projection of the markdown just loaded (a flush), sometimes.
        if (rand() > 0.2) continue;
      } else if (r < reloadEvery + richEvery) {
        md = richEdit(ed, engine, rand);
        what = "rich edit";
      } else {
        [md, what] = mdEdit(md, rand, corpus, snippets);
      }
      try {
        project(ed, engine, md);
      } catch (e) {
        throw new Error(`seed ${seed}, step ${step} (${what}) threw ${e}\nfrom ${JSON.stringify(before)}\nto ${JSON.stringify(md)}`, { cause: e });
      }
      const how = engine.lastRichPath();
      if (fresh) {
        fresh = false;
        stats.firsts++;
        if (how.path === "prebuilt") stats.prebuilt++;
        const key = how.path === "prebuilt" ? how.reason.split(";")[0] : `${how.path}: ${how.reason}`;
        stats.first[key] = (stats.first[key] || 0) + 1;
      }
      expectSame(ed, ref, engine, md, `seed ${seed}, step ${step} (${what}; ${how.path}: ${how.reason}) from ${JSON.stringify(before)}\n`);
      // Projecting the same markdown again changes nothing — and dispatches nothing.
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
  return stats;
}

describe("A083 — a model prepared ahead projects exactly as the whole-document parse", () => {
  const totals = { firsts: 0, prebuilt: 0 };

  // RICH_PREBUILD_SEEDS=<n> for a deeper run; RICH_SEED_FROM offsets the seeds.
  const seeds = Number(process.env.RICH_PREBUILD_SEEDS) || 30;
  const from = Number(process.env.RICH_SEED_FROM) || 0;
  it.each(Array.from({ length: seeds }, (_, i) => [3000 + (from + i) * 6007]))("random edit walk from a prepared load, seed %i", (seed) => {
    const s = prebuildWalk(seed);
    totals.firsts += s.firsts;
    totals.prebuilt += s.prebuilt;
  }, 120000);

  it("used the prepared model for most first projections (or the walks test nothing)", () => {
    if (totals.firsts === 0) return; // run on its own
    expect(totals.prebuilt).toBeGreaterThan(totals.firsts / 3);
  });

  it.each([[41], [42], [43]])("a long document, prepared a window at a time, seed %i", (seed) => {
    const s = prebuildWalk(seed, { steps: 30, start: 60, richEvery: 0.1, reloadEvery: 0.1, corpus: CUTTABLE, snippets: LOCAL_SNIPPETS, chunk: 300 });
    expect(s.prebuilt, JSON.stringify(s.first)).toBeGreaterThan(s.firsts / 2);
  }, 300000);

  it.each([[51], [52]])("a long document at the app's run and slice lengths, seed %i", (seed) => {
    const s = prebuildWalk(seed, { steps: 20, start: 400, richEvery: 0.1, reloadEvery: 0.1, corpus: CUTTABLE, snippets: LOCAL_SNIPPETS, runLength: 2048, chunk: 16 * 1024 });
    expect(s.prebuilt, JSON.stringify(s.first)).toBeGreaterThan(s.firsts / 2);
  }, 300000);
});

/** An engine that prepares every document, in the app's run and slice lengths unless told otherwise. */
function rig({ chunk, features = { ...DEFAULT_MARKDOWN_FEATURES } } = {}) {
  let f = features;
  const engine = createMarkdownEngine(() => f, undefined, { richRunLength: 2048, richPrebuildMin: 0, richPrebuildChunk: chunk });
  const ed = newEditor();
  const ref = newEditor();
  return {
    engine, ed, ref,
    setFeatures(next) { f = next; },
    load(canonical, slices = Infinity) { return load(ed, engine, canonical, slices); },
    project(md) {
      const plan = engine.planRich(md, ed.state);
      if (plan.tr) ed.view.dispatch(plan.tr);
      plan.commit(ed.state.doc);
      return plan;
    },
    same(md, where) { expectSame(ed, ref, engine, md, where); },
    destroy() { ed.destroy(); ref.destroy(); },
  };
}

describe("the first keystroke after a prepared load", () => {
  it("re-parses only the window the edit touched", () => {
    const r = rig({ chunk: 4096 });
    try {
      const { md, job } = r.load(oracle(r.ref, r.engine, paras(400)));
      expect(job).not.toBe(null);
      const before = r.ed.state.doc;
      const next = md.replace("P200 ", "P200 edited ");
      const plan = r.project(next);
      const how = r.engine.lastRichPath();
      expect(how.path).toBe("prebuilt");
      expect(how.reason).toMatch(/^ready; 1 of \d+ runs$/);
      expect(plan.tr.steps).toHaveLength(1);
      r.same(next, "prepared, then one edit");
      // Every node but the edited one is the very object the load made.
      let kept = 0;
      for (let k = 0; k < before.childCount; k++) if (r.ed.state.doc.child(k) === before.child(k)) kept++;
      expect(kept).toBe(before.childCount - 1);
      // …and the model it leaves serves the next keystroke as any model does.
      r.project(next.replace("P300 ", "P300 edited "));
      expect(r.engine.lastRichPath().path).toBe("incremental");
    } finally { r.destroy(); }
  });

  it("prepares about a slice of markdown at a time — a window ends after a blank line", () => {
    // A window that ended at a mere line start was never clean (it ends inside
    // a paragraph) and doubled until it had swallowed the document: one
    // "slice" then did all the work, and idle time was no help.
    const r = rig({ chunk: 1024 });
    try {
      const { md, job } = r.load(oracle(r.ref, r.engine, paras(400)), 0);
      let slices = 0;
      while (!job.step(() => true)) slices++;
      slices++;
      expect(slices).toBeGreaterThanOrEqual(Math.floor(md.length / 1024 / 2));
      expect(slices).toBeLessThanOrEqual(Math.ceil(md.length / 1024) + 1);
    } finally { r.destroy(); }
  });

  it("carries front matter in its first window, and edits after it land in the right runs", () => {
    const r = rig({ chunk: 512 });
    try {
      // The preprocessor rewrites front matter to a different length: the
      // first run's length is the SOURCE length, or every run after it is off.
      let md = `---\ntitle: Front\ntags: [a, b]\n---\n\n${paras(120)}`;
      r.engine.forgetRich();
      r.ed.commands.setContent(oracle(r.ref, r.engine, md), { emitUpdate: false });
      const job = r.engine.prepareRich(md, r.ed.state);
      while (!job.step(() => true));
      // Beyond the first run (~2 KB): an edit inside it is the build's, as it
      // always was — the front matter is never re-parsed on its own.
      for (const k of [119, 90, 61, 45, 38]) {
        md = md.replace(`P${k} `, `P${k} edited `);
        r.project(md);
        expect(r.engine.lastRichPath().path, `P${k}`).not.toBe("build");
        r.same(md, `front matter, then an edit to P${k}`);
      }
    } finally { r.destroy(); }
  });

  it("finishes a preparation the idle slices had not", () => {
    for (const slices of [0, 2]) {
      const r = rig({ chunk: 2048 });
      try {
        const { md } = r.load(oracle(r.ref, r.engine, paras(400)), slices);
        const next = md.replace("P399 ", "P399 edited ");
        r.project(next);
        expect(r.engine.lastRichPath().path, `${slices} slices`).toBe("prebuilt");
        expect(r.engine.lastRichPath().reason, `${slices} slices`).toMatch(/^finished on demand; /);
        r.same(next, `${slices} slices, then an edit`);
      } finally { r.destroy(); }
    }
  });

  it("keeps a node the rich pane edited before the first keystroke, when the parse agrees with it", () => {
    // The loaded document IS its markdown's parse, so the prepared model is
    // simply that document's: the rich pane's edit is found by identity, as
    // any edit since a projection is — and the node it made is kept where the
    // re-parse equals it. (Turning the editor's document into the prepared
    // parse first would replace it with the parse of the OLD markdown, then
    // with a copy of itself.)
    const r = rig({ chunk: 2048 });
    try {
      r.load(oracle(r.ref, r.engine, paras(200)));
      const { state } = r.ed;
      let pos = 0;
      for (let k = 0; k < 3; k++) pos += state.doc.child(k).nodeSize;
      r.ed.view.dispatch(state.tr.insertText("rich ", pos + 1));
      const edited = r.ed.state.doc.child(3);
      const md = r.engine.docToMd(r.ed.state.doc, "styled").replace("P150 ", "P150 edited ");
      r.project(md);
      expect(r.engine.lastRichPath().path).toBe("prebuilt");
      r.same(md, "rich edit, then a markdown edit");
      expect(r.ed.state.doc.child(3)).toBe(edited);
    } finally { r.destroy(); }
  });

  /**
   * A stored document of `groups` paragraphs-and-a-code-block groups whose code
   * blocks were typed in the rich pane: none ends in the newline marked
   * writes, so the first projection must replace every one, as the build did.
   */
  function codeHeavy(r, groups) {
    const blocks = Array.from({ length: groups }, (_, i) => `${paras(2, i * 2)}\n\n\`\`\`js\nconst v${i} = ${i};\n\`\`\``).join("\n\n");
    const json = oracle(r.ref, r.engine, blocks);
    let trimmed = 0;
    for (const node of json.content) {
      if (node.type === "codeBlock") {
        node.content[0].text = node.content[0].text.replace(/\n$/, "");
        trimmed++;
      }
    }
    return { json, trimmed };
  }

  /** Where a selection lands when each changed node is replaced by a step of its own. */
  function perStretchSelection(state, want) {
    const tr = state.tr;
    const doc = state.doc;
    const starts = [];
    let pos = 0;
    for (let k = 0; k < doc.childCount; k++) { starts.push(pos); pos += doc.child(k).nodeSize; }
    for (let k = Math.min(doc.childCount, want.childCount) - 1; k >= 0; k--) {
      if (!doc.child(k).eq(want.child(k))) tr.replaceWith(starts[k], starts[k] + doc.child(k).nodeSize, want.child(k));
    }
    return tr.selection;
  }

  const textIndex = (doc, prefix) => {
    for (let k = 0; k < doc.childCount; k++) if (doc.child(k).textContent.startsWith(prefix)) return k;
    throw new Error(`no block starts with ${prefix}`);
  };
  const posIn = (doc, index, offset) => {
    let pos = 0;
    for (let k = 0; k < index; k++) pos += doc.child(k).nodeSize;
    return pos + 1 + offset;
  };

  it("turns a document that is not its own parse into one — in ONE step, the caret where it was", () => {
    // One step per stretch was quadratic (each rebuilds the document's node
    // list); above STEP_LIMIT stretches they go as one.
    const r = rig({ chunk: 2048 });
    try {
      const { json, trimmed } = codeHeavy(r, 40);
      expect(trimmed).toBeGreaterThan(STEP_LIMIT);
      const { md } = r.load(json);
      const doc = r.ed.state.doc;
      // The caret inside an UNCHANGED paragraph between two changed code blocks.
      const para = textIndex(doc, "P21 ");
      r.ed.view.dispatch(r.ed.state.tr.setSelection(TextSelection.create(doc, posIn(doc, para, 4), posIn(doc, para, 9))));
      const want = r.ed.schema.nodeFromJSON(oracle(r.ref, r.engine, md));
      const expected = perStretchSelection(r.ed.state, want);
      // The markdown unchanged (a flush): only the turn into the parse.
      const plan = r.project(md);
      expect(plan.tr.steps).toHaveLength(1);
      r.same(md, "a stored document that is not its own parse");
      // The paragraphs between the code blocks are the very objects they were:
      // the view keeps their DOM.
      let paragraphs = 0;
      for (let k = 0; k < doc.childCount; k++) {
        if (doc.child(k).type.name !== "paragraph" || !doc.child(k).textContent) continue;
        paragraphs++;
        expect(r.ed.state.doc.child(k), `paragraph ${k}`).toBe(doc.child(k));
      }
      expect(paragraphs).toBe(80);
      const { from, to } = r.ed.state.selection;
      expect([from, to]).toEqual([expected.from, expected.to]);
      expect(r.ed.state.doc.textBetween(from, to)).toBe(doc.child(para).textContent.slice(4, 9));
      // And an edit after it is an ordinary incremental one.
      const next = md.replace("P79 ", "P79 edited ");
      r.project(next);
      expect(r.engine.lastRichPath().path).toBe("incremental");
      r.same(next, "then an edit");
    } finally { r.destroy(); }
  });

  it("maps a caret inside a replaced block as a step per stretch would have", () => {
    const r = rig({ chunk: 2048 });
    try {
      const { json } = codeHeavy(r, 30);
      const { md } = r.load(json);
      const doc = r.ed.state.doc;
      const code = textIndex(doc, "const v5 ");
      r.ed.view.dispatch(r.ed.state.tr.setSelection(TextSelection.create(doc, posIn(doc, code, 3))));
      const want = r.ed.schema.nodeFromJSON(oracle(r.ref, r.engine, md));
      const expected = perStretchSelection(r.ed.state, want);
      r.project(md);
      expect([r.ed.state.selection.from, r.ed.state.selection.to]).toEqual([expected.from, expected.to]);
      // Not the end of the whole replaced range, where the one step's own map sends it.
      expect(r.ed.state.selection.from).toBeLessThan(r.ed.state.doc.content.size / 2);
    } finally { r.destroy(); }
  });

  it("keeps the unchanged blocks' own objects when the BUILD takes one step too", () => {
    // With no preparation the parse is all new objects; the one step must
    // still carry the editor's own node wherever it equals the new one.
    const r = rig({ chunk: 2048 });
    try {
      const { json } = codeHeavy(r, 40);
      const { md } = r.load(json, 0);
      r.engine.forgetRich(); // no preparation: the first projection builds
      const doc = r.ed.state.doc;
      const plan = r.project(md);
      expect(r.engine.lastRichPath().path).toBe("build");
      expect(plan.tr.steps).toHaveLength(1);
      r.same(md, "built in one step");
      for (let k = 0; k < doc.childCount; k++) {
        if (doc.child(k).type.name === "paragraph" && doc.child(k).textContent) expect(r.ed.state.doc.child(k), `paragraph ${k}`).toBe(doc.child(k));
      }
    } finally { r.destroy(); }
  });

  it("keeps a step per stretch when there are few", () => {
    const r = rig({ chunk: 2048 });
    try {
      const { json, trimmed } = codeHeavy(r, STEP_LIMIT);
      expect(trimmed).toBe(STEP_LIMIT);
      const { md } = r.load(json);
      const plan = r.project(md);
      expect(plan.tr.steps).toHaveLength(STEP_LIMIT);
      r.same(md, "few stretches");
    } finally { r.destroy(); }
  });
});

describe("a preparation that cannot be used", () => {
  it("gives way to the build when a window refuses the text — and the build is still exact", () => {
    // The markdown is handed over as written: a link definition is not
    // content, so the markdown of a loaded document never holds one — but the
    // preparation is given whatever the pane holds, and must refuse it.
    // What the first keystroke then does is the build's business: it cuts a
    // footnote reference with no definition, and takes the other three whole.
    for (const [extra, path] of [
      ["[r]: https://example.com", { path: "whole", reason: "link definitions" }],
      ["A claim[^1].", { path: "build", reason: "prebuild: footnote syntax" }],
      ["[[Doc|Alias]]", { path: "whole", reason: "alias wiki link" }],
      ['<p style="white-space: pre">kept  apart</p>', { path: "whole", reason: "raw <pre> or white-space" }],
    ]) {
      const r = rig({ chunk: 2048 });
      try {
        const md = `${paras(100)}\n\n${extra}\n\n${paras(100, 100)}`;
        r.engine.forgetRich();
        r.ed.commands.setContent(oracle(r.ref, r.engine, md), { emitUpdate: false });
        const job = r.engine.prepareRich(md, r.ed.state);
        while (!job.step(() => true));
        const next = md.replace("P10 ", "P10 edited ");
        r.project(next);
        expect(r.engine.lastRichPath(), extra).toEqual(path);
        r.same(next, extra);
      } finally { r.destroy(); }
    }
  }, 60000);

  it("grows a window past a node ProseMirror leaves open, and never starts one with text", () => {
    // A stray <li> is clean markup, but ProseMirror wraps it in a list it
    // keeps OPEN — the next stray <li>, past a blank line, joins the same
    // list. A window ending between them must grow. An HTML block that opens
    // with a closing tag starts its window with TEXT, which is refused.
    // Every window size, so a window boundary falls at each blank line.
    for (const mess of ["<li>one</li>\n\n<li>two</li>", "</div> tail text", "<li>a</li>\n\n</div> tail", "</section>\n\n<li>b</li>"]) {
      for (const chunk of [1, 30, 120, 400]) {
        const r = rig({ chunk });
        try {
          let md = `${paras(12)}\n\n${mess}\n\n${paras(12, 12)}`;
          r.engine.forgetRich();
          r.ed.commands.setContent(oracle(r.ref, r.engine, md), { emitUpdate: false });
          const job = r.engine.prepareRich(md, r.ed.state);
          while (!job.step(() => true));
          for (const k of [23, 0, 12, 11]) {
            md = md.replace(`P${k} `, `P${k} edited `);
            r.project(md);
            r.same(md, `${JSON.stringify(mess)}, windows of ${chunk}, an edit to P${k}`);
          }
        } finally { r.destroy(); }
      }
    }
  }, 60000); // sixteen documents loaded and prepared: under a busy suite, more than 5 s

  it("is dropped by a feature switch before the first keystroke", () => {
    const r = rig({ chunk: 2048 });
    try {
      const { md } = r.load(oracle(r.ref, r.engine, paras(100)));
      r.setFeatures({ ...DEFAULT_MARKDOWN_FEATURES, math: !DEFAULT_MARKDOWN_FEATURES.math });
      const next = md.replace("P10 ", "P10 edited ");
      r.project(next);
      expect(r.engine.lastRichPath()).toEqual({ path: "build", reason: "prebuild: configuration" });
      r.same(next, "a feature switched after the load");
    } finally { r.destroy(); }
  });

  it("stops when it is superseded — by forgetting, or by another load", () => {
    const r = rig({ chunk: 512 });
    try {
      const a = r.load(oracle(r.ref, r.engine, paras(100)), 0);
      expect(a.job.step(() => true)).toBe(false); // one slice of many
      r.engine.forgetRich();
      expect(a.job.step(() => false)).toBe(true); // nothing left to do — and nothing done
      const b = r.load(oracle(r.ref, r.engine, paras(100, 500)), 0);
      const c = r.load(oracle(r.ref, r.engine, paras(100, 900)), 0);
      expect(b.job.step(() => false)).toBe(true);
      const next = c.md.replace("P950 ", "P950 edited ");
      r.project(next);
      expect(r.engine.lastRichPath().reason).toMatch(/^finished on demand; /);
      r.same(next, "the last load's preparation");
    } finally { r.destroy(); }
  });

  it("is not made for a small document, or for text the cuts do not cover", () => {
    const small = createMarkdownEngine(() => DEFAULT_MARKDOWN_FEATURES);
    const ed = newEditor();
    try {
      expect(small.prepareRich(paras(10), ed.state)).toBe(null); // ~600 characters, below 64 KB
      const curly = createMarkdownEngine(() => ({ ...DEFAULT_MARKDOWN_FEATURES, curlyBraceFormatting: true }), undefined, { richPrebuildMin: 0 });
      expect(curly.prepareRich(paras(10), ed.state)).toBe(null);
      const any = createMarkdownEngine(() => DEFAULT_MARKDOWN_FEATURES, undefined, { richPrebuildMin: 0 });
      expect(any.prepareRich(paras(10).replace(/\n/g, "\r\n"), ed.state)).toBe(null);
      expect(any.prepareRich(paras(10), ed.state)).not.toBe(null);
    } finally { ed.destroy(); }
  });
});
