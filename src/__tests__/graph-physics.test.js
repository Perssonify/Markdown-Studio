import { describe, it, expect } from "vitest";
import {
  ALPHA_DECAY,
  BARNES_HUT_MIN,
  BARNES_HUT_THETA,
  FOLDER_LAYOUT_MAX,
  PAD,
  buildQuadTree,
  pairJitter,
  repulseBarnesHut,
  seedPositions,
  separateLabelsGrid,
  shouldFreeze,
  stepLayout,
  worldFor,
} from "../store/graph-physics";
import { folderBounds, labelWidth, truncateLabel } from "../store/graph-metrics";
import { legacyStep, LEGACY_ALPHA_DECAY } from "./graph-legacy";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** mulberry32: the same sequence on every machine. */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ["Plan", "Notes", "Research", "Q3 roadmap review", "Hiring", "A", "Design system audit", "Retro", "Budget"];

/** A workspace shaped like a real one: folders, hubs, unlinked notes, long names. */
function workspace(n, seed = 1) {
  const r = prng(seed * 7919 + n);
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `d${i}`, title: `${WORDS[i % WORDS.length]} ${i}` }));
  const edges = [];
  const seen = new Set();
  for (let i = 1; i < n; i++) {
    const links = r() < 0.1 ? 0 : 1 + Math.floor(r() * 3);
    for (let k = 0; k < links; k++) {
      const j = Math.floor(Math.pow(r(), 2) * i);
      if (j === i || seen.has(`${i}|${j}`)) continue;
      seen.add(`${i}|${j}`);
      edges.push({ source: `d${i}`, target: `d${j}` });
    }
  }
  const back = new Map();
  for (const e of edges) back.set(e.target, (back.get(e.target) || 0) + 1);
  for (const node of nodes) node.backlinks = back.get(node.id) || 0;
  const folderCount = Math.max(1, Math.round(n / 8));
  const folders = Array.from({ length: folderCount }, (_, f) => ({ id: `f${f}`, name: `Folder ${f}`, docIds: [] }));
  for (const node of nodes) if (r() < 0.7) folders[Math.floor(r() * folderCount)].docIds.push(node.id);
  return { nodes, edges, folders: folders.filter((f) => f.docIds.length) };
}

/** The seeding the map used before folders got their own clusters: one ring
 *  in the fixed node-count world. The reference loop always starts here. */
function ringSeed(nodes) {
  const n = nodes.length || 1;
  const world = worldFor(n);
  const { w, h } = world;
  const r = Math.min(Math.min(w, h) / 2 - PAD - 10, 60 + n * 22);
  const pos = new Map();
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / n;
    pos.set(node.id, { id: node.id, x: w / 2 + r * Math.cos(angle), y: h / 2 + r * Math.sin(angle), vx: 0, vy: 0 });
  });
  return { pos, world };
}

/** The drawn sizes the component hands the loop (`metaRef`). */
function meta(nodes) {
  return {
    radius: new Map(nodes.map((d) => [d.id, 7 + Math.min(10, (d.backlinks || 0) * 1.5)])),
    label: new Map(nodes.map((d) => [d.id, truncateLabel(d.title)])),
  };
}

/** Run the NEW physics to rest (or `maxSteps`); returns positions, steps and every maxV. */
function settleNew(ws, { maxSteps = Infinity, exact, pinned } = {}) {
  const world = worldFor(ws.nodes.length || 1, ws.folders.length > 0);
  const pos = seedPositions(ws.nodes.map((d) => d.id), ws.folders, world);
  const m = meta(ws.nodes);
  let alpha = 1, steps = 0;
  const speeds = [];
  for (;;) {
    const maxV = stepLayout({
      positions: pos, edges: ws.edges, folders: ws.folders, world, alpha,
      radius: (id) => m.radius.get(id) ?? 7, label: (id) => m.label.get(id) ?? "",
      pinned: pinned ?? null, exact,
    });
    speeds.push(maxV);
    alpha *= ALPHA_DECAY;
    steps++;
    if (shouldFreeze(maxV, alpha, steps) || steps >= maxSteps) break;
  }
  return { pos, steps, speeds };
}

/** The same with the verbatim pre-change step and the loop's old stop test.
 *  The reference is given the new deterministic tie-break for notes on the
 *  same spot (its Math.random() made it unrepeatable); `coincident` counts how
 *  often that case came up. */
function settleLegacy(ws, { maxSteps = Infinity, pinned } = {}) {
  const { pos, world } = ringSeed(ws.nodes);
  const coincident = { n: 0 };
  const sim = { pos, edges: ws.edges, folders: ws.folders, world, alpha: 1, meta: meta(ws.nodes),
    dragId: pinned ?? null, jitter: pairJitter, coincident };
  let steps = 0;
  const speeds = [];
  for (;;) {
    const maxV = legacyStep(sim);
    speeds.push(maxV);
    steps++;
    if (maxV <= 0.06 || sim.alpha <= 0.02 || steps >= 900 || steps >= maxSteps) break;
  }
  return { pos, steps, speeds, coincident: coincident.n };
}

const flat = (pos) => [...pos.values()].flatMap((p) => [p.id, p.x, p.y, p.vx, p.vy]);

// ── The small-map contract ────────────────────────────────────────────────────

/** The same workspace with no folders. */
const folderless = (ws) => ({ ...ws, folders: [] });

describe("a folderless map lays out exactly as it always has", () => {
  // The physics moved out of the component and its O(n²) bookkeeping was
  // rewritten; this holds the result to the old loop's, bit for bit, across a
  // whole settle — every coordinate and velocity, every step's speed, and the
  // step on which it freezes. Maps WITH folders deliberately changed (they
  // stacked notes on top of each other): see "a map with folders".
  for (const n of [3, 12, 25, 40, 150]) {
    it(`${n} notes: every step matches the pre-change loop exactly`, () => {
      const ws = folderless(workspace(n));
      const now = settleNew(ws);
      const before = settleLegacy(ws);
      expect(now.steps).toBe(before.steps);
      expect(now.speeds).toEqual(before.speeds);
      expect(flat(now.pos)).toEqual(flat(before.pos));
    });
  }

  it("holds a dragged note exactly where the old loop held it", () => {
    const ws = folderless(workspace(40, 3));
    const now = settleNew(ws, { maxSteps: 30, pinned: "d7" });
    const before = settleLegacy(ws, { maxSteps: 30, pinned: "d7" });
    expect(flat(now.pos)).toEqual(flat(before.pos));
  });

  it("the pre-change loop was not even repeatable when notes stacked up", () => {
    // Why the tie-break changed at all: in this workspace notes land on the
    // same spot against a world wall four times during the settle, and each
    // time the old loop shoved them apart in a Math.random() direction — two
    // opens of the same library drew two different maps.
    expect(settleLegacy(workspace(40)).coincident).toBeGreaterThan(0);
  });

  it("takes the exact path at the threshold, and Barnes–Hut above it", () => {
    // Pins BARNES_HUT_MIN: at it, the default IS the exact loop; one note more
    // and the default is the approximation. (How far the two drift apart is
    // not a meaningful bound: the first steps from the seeding ring move notes
    // thousands of units against the world walls in the exact loop too, so any
    // difference at all is amplified. The force accuracy is pinned below.)
    const at = workspace(BARNES_HUT_MIN, 5);
    expect(flat(settleNew(at, { maxSteps: 4 }).pos)).toEqual(flat(settleNew(at, { maxSteps: 4, exact: true }).pos));
    const over = workspace(BARNES_HUT_MIN + 1, 5);
    expect(flat(settleNew(over, { maxSteps: 4 }).pos)).not.toEqual(flat(settleNew(over, { maxSteps: 4, exact: true }).pos));
  });
});

// ── Folders ───────────────────────────────────────────────────────────────────

/** Pairs of notes within one unit of each other: drawn as one dot. */
function stackedPairs(pos) {
  const pts = [...pos.values()];
  let n = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < 1) n++;
  }
  return n;
}
/** Overlapping container pairs, and notes whose dot is inside a container they
 *  do not belong to — the containers the renderer draws, at 1×. */
function containerFaults(ws, pos) {
  const m = meta(ws.nodes);
  const rects = folderBounds({ folders: ws.folders, positions: pos, radius: (id) => m.radius.get(id) ?? 7, label: (id) => m.label.get(id) ?? "", k: 1 });
  let boxBox = 0, strangers = 0;
  for (let i = 0; i < rects.length; i++) {
    const A = rects[i];
    for (let j = i + 1; j < rects.length; j++) {
      const B = rects[j];
      if (A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 && B.y0 < A.y1) boxBox++;
    }
    const own = new Set(A.docIds);
    for (const p of pos.values()) if (!own.has(p.id) && p.x > A.x0 && p.x < A.x1 && p.y > A.y0 && p.y < A.y1) strangers++;
  }
  return { boxBox, strangers };
}

describe("a map with folders", () => {
  // Seeded on one ring, a folder's members started scattered around it, every
  // container started as a box spanning most of the world, and the container
  // constraint threw folders into the walls, where their notes piled up on one
  // coordinate — a 150-note map lost about a quarter of its notes under others.
  // Folder clusters, a world sized to the folders, a speed limit and moving a
  // folder as a unit fixed it. The bounds are what the fix measures on these
  // workspaces (one folder per 8 notes — denser than a real library).
  for (const n of [12, 40, 150]) {
    for (const seedValue of [1, 2, 3]) {
      it(`${n} notes (workspace ${seedValue}): no note under another, none in a stranger's folder`, () => {
        const ws = workspace(n, seedValue);
        expect(ws.folders.length).toBeGreaterThan(0);
        const { pos } = settleNew(ws);
        expect(stackedPairs(pos)).toBe(0);
        const { boxBox, strangers } = containerFaults(ws, pos);
        expect(strangers).toBeLessThanOrEqual(1);
        expect(boxBox).toBeLessThanOrEqual(4);
      });
    }
  }

  it("the old seeding really did stack notes (the regression this guards)", () => {
    const ws = workspace(150, 1);
    const before = settleLegacy(ws);
    expect(stackedPairs(before.pos)).toBeGreaterThan(0);
    expect(stackedPairs(settleNew(ws).pos)).toBe(0);
  });

  it("above FOLDER_LAYOUT_MAX a map with folders keeps the previous layout exactly", () => {
    // Measured worse than the old layout at 2,000 notes, so the folder-aware
    // layout stops at FOLDER_LAYOUT_MAX. The first steps of a larger map (exact
    // forces, the same path the reference loop takes) match it bit for bit.
    const n = FOLDER_LAYOUT_MAX + 100;
    const ws = workspace(n, 4);
    expect(ws.folders.length).toBeGreaterThan(0);
    expect(worldFor(n, true)).toEqual(worldFor(n));
    const now = settleNew(ws, { maxSteps: 4, exact: true });
    const before = settleLegacy(ws, { maxSteps: 4 });
    expect(flat(now.pos)).toEqual(flat(before.pos));
  });

  it("settles to the same layout every time", () => {
    const ws = workspace(150, 2);
    expect(flat(settleNew(ws).pos)).toEqual(flat(settleNew(ws).pos));
  });
});

describe("seedPositions", () => {
  it("without folders is exactly the ring the map always started from", () => {
    const ws = workspace(40, 1);
    const world = worldFor(40);
    const now = seedPositions(ws.nodes.map((d) => d.id), [], world);
    expect(flat(now)).toEqual(flat(ringSeed(ws.nodes).pos));
  });

  it("with folders starts each folder as its own cluster, inside the world, in id order", () => {
    const ws = workspace(150, 3);
    const world = worldFor(150, true);
    const ids = ws.nodes.map((d) => d.id);
    const pos = seedPositions(ids, ws.folders, world);
    expect([...pos.keys()]).toEqual(ids);
    for (const p of pos.values()) {
      expect(p.x).toBeGreaterThanOrEqual(PAD);
      expect(p.x).toBeLessThanOrEqual(world.w - PAD);
      expect(p.y).toBeGreaterThanOrEqual(PAD);
      expect(p.y).toBeLessThanOrEqual(world.h - PAD);
    }
    // No two folders' starting clusters overlap (the ring made every one span
    // most of the world).
    const boxes = ws.folders.map((f) => {
      const ps = f.docIds.map((id) => pos.get(id));
      return { x0: Math.min(...ps.map((p) => p.x)), x1: Math.max(...ps.map((p) => p.x)), y0: Math.min(...ps.map((p) => p.y)), y1: Math.max(...ps.map((p) => p.y)) };
    });
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i], B = boxes[j];
      expect(A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 && B.y0 < A.y1).toBe(false);
    }
  });
});

describe("worldFor", () => {
  it("is unchanged for a folderless map, at every size", () => {
    for (const n of [1, 5, 23, 150, 2000]) {
      const w = Math.max(720, Math.min(2600, 520 + n * 90));
      expect(worldFor(n)).toEqual({ w, h: Math.round(w * 0.72) });
    }
  });

  it("grows with the library when it has folders — up to FOLDER_LAYOUT_MAX", () => {
    expect(worldFor(12, true)).toEqual(worldFor(12));
    expect(worldFor(400, true).w).toBeGreaterThan(worldFor(400).w);
    expect(worldFor(400, true).w).toBeGreaterThan(worldFor(200, true).w);
    // Larger folder maps keep the previous layout, world included.
    expect(worldFor(2000, true)).toEqual(worldFor(2000));
  });
});

// ── Barnes–Hut ────────────────────────────────────────────────────────────────

/** Scattered points, uniform or in a dozen tight clusters. */
function scatter(n, seedValue, clustered) {
  const r = prng(seedValue);
  return Array.from({ length: n }, (_, i) => {
    if (!clustered) return { id: `p${i}`, x: 40 + r() * 2520, y: 40 + r() * 1790, vx: 0, vy: 0 };
    const c = Math.floor(r() * 12);
    return { id: `p${i}`, x: 200 + (c % 4) * 600 + (r() - 0.5) * 300, y: 200 + Math.floor(c / 4) * 600 + (r() - 0.5) * 300, vx: 0, vy: 0 };
  });
}

/** The exact all-pairs repulsion (the loop's force law, tie-break included). */
function exactRepulsion(ps, repulsion) {
  const f = ps.map(() => [0, 0]);
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      let dx = ps[j].x - ps[i].x, dy = ps[j].y - ps[i].y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) { d2 = 1; dx = pairJitter(i, j); dy = pairJitter(j, i); }
      const d = Math.sqrt(d2), g = repulsion / d2;
      f[i][0] -= (dx / d) * g; f[i][1] -= (dy / d) * g;
      f[j][0] += (dx / d) * g; f[j][1] += (dy / d) * g;
    }
  }
  return f;
}

/** ‖approx − exact‖ / ‖exact‖ over the whole force field. Per-node relative
 *  error is the wrong yardstick: where forces nearly cancel, a tiny absolute
 *  error is a huge relative one on a note that barely moves either way. */
function fieldError(ps, exact) {
  let num = 0, den = 0;
  ps.forEach((p, i) => {
    num += (p.vx - exact[i][0]) ** 2 + (p.vy - exact[i][1]) ** 2;
    den += exact[i][0] ** 2 + exact[i][1] ** 2;
  });
  return Math.sqrt(num / den);
}

describe("Barnes–Hut repulsion", () => {
  for (const [n, clustered] of [[400, false], [400, true], [1500, true]]) {
    it(`approximates the exact force field to within 2% (${n} notes, ${clustered ? "clustered" : "uniform"})`, () => {
      // Measured at θ = 0.9 (d3-force's default): 0.6% on 2,000 uniform notes.
      const ps = scatter(n, n + (clustered ? 1 : 0), clustered);
      const exact = exactRepulsion(ps, 7000);
      repulseBarnesHut(ps, 7000, BARNES_HUT_THETA);
      expect(fieldError(ps, exact)).toBeLessThan(0.02);
    });
  }

  it("is the exact force when no cell may be approximated (θ = 0)", () => {
    // Every cell is opened, so every pair is summed individually — the same
    // terms as the loop, in tree order instead of index order.
    const ps = scatter(300, 11, true);
    const exact = exactRepulsion(ps, 5000);
    repulseBarnesHut(ps, 5000, 0);
    expect(fieldError(ps, exact)).toBeLessThan(1e-12);
  });

  it("never lets a note repel itself through a cell that contains it", () => {
    // A lone note in the corner of the root cell, a tight clump of 100 in the
    // opposite corner. The root's centre of mass is far enough from the lone
    // note to pass the opening test — so without the containment check the
    // root is taken as ONE mass that includes the lone note itself (101, not
    // 100: a 1% error). The clump alone is far enough to be one mass, so the
    // only error left with the check is the clump's own spread (~0.02%).
    const r = prng(99);
    const ps = [{ id: "lone", x: 0, y: 0, vx: 0, vy: 0 },
      ...Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, x: 1000 + r() * 20, y: 1000 + r() * 20, vx: 0, vy: 0 }))];
    const exact = exactRepulsion(ps, 1000);
    repulseBarnesHut(ps, 1000, BARNES_HUT_THETA);
    const err = Math.hypot(ps[0].vx - exact[0][0], ps[0].vy - exact[0][1]) / Math.hypot(exact[0][0], exact[0][1]);
    expect(err).toBeLessThan(0.002);
  });

  it("builds a tree that holds every point exactly once", () => {
    const ps = scatter(500, 4, true);
    const t = buildQuadTree(ps.map((p) => p.x), ps.map((p) => p.y));
    expect(t.mass[0]).toBe(500);
    expect([...t.order].sort((a, b) => a - b)).toEqual(ps.map((_, i) => i));
    // Leaves cover disjoint runs of `order` that add up to the whole.
    let covered = 0;
    t.first.forEach((f, c) => { if (f >= 0) covered += t.count[c]; });
    expect(covered).toBe(500);
  });

  it("separates notes stacked on the same spot, and deterministically", () => {
    const stacked = () => [
      { id: "a", x: 500, y: 500, vx: 0, vy: 0 },
      { id: "b", x: 500, y: 500, vx: 0, vy: 0 },
      ...scatter(398, 9, false),
    ];
    const one = stacked(), two = stacked();
    repulseBarnesHut(one, 7000, BARNES_HUT_THETA);
    repulseBarnesHut(two, 7000, BARNES_HUT_THETA);
    expect(one.map((p) => [p.vx, p.vy])).toEqual(two.map((p) => [p.vx, p.vy]));
    // The two stacked notes are pushed in opposite directions.
    expect(Math.sign(one[0].vx - one[1].vx) || Math.sign(one[0].vy - one[1].vy)).not.toBe(0);
  });
});

describe("pairJitter", () => {
  it("is deterministic, in the old Math.random() range, and not constant", () => {
    const seen = new Set();
    for (let a = 0; a < 50; a++) {
      for (let b = 0; b < 50; b++) {
        const v = pairJitter(a, b);
        expect(v).toBe(pairJitter(a, b));
        expect(v).toBeGreaterThanOrEqual(-0.05);
        expect(v).toBeLessThan(0.05);
        seen.add(v);
      }
    }
    expect(seen.size).toBeGreaterThan(2000);
  });

  it("makes the exact loop deterministic for notes on the same spot", () => {
    // Math.random() made two opens of the same library differ here.
    const ws = workspace(12, 8);
    const run = () => {
      const { pos, world } = ringSeed(ws.nodes);
      pos.get("d1").x = pos.get("d0").x; pos.get("d1").y = pos.get("d0").y;
      const m = meta(ws.nodes);
      stepLayout({ positions: pos, edges: ws.edges, folders: ws.folders, world, alpha: 1,
        radius: (id) => m.radius.get(id), label: (id) => m.label.get(id) });
      return flat(pos);
    };
    expect(run()).toEqual(run());
  });
});

// ── The label-room grid ───────────────────────────────────────────────────────

/** The exact loop's label-room term alone, pair by pair in index order. */
function exactLabelTerm(ps, halfW, alpha) {
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const needX = halfW[i] + halfW[j];
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax < needX && ay < 34) {
        const ox = needX - ax, oy = 34 - ay;
        if (ox / needX <= oy / 34) {
          const push = ox * 0.05 * alpha * (dx < 0 ? -1 : 1);
          a.vx -= push; b.vx += push;
        } else {
          const push = oy * 0.05 * alpha * (dy < 0 ? -1 : 1);
          a.vy -= push; b.vy += push;
        }
      }
    }
  }
}

describe("the label-room grid", () => {
  for (const [label, n, clustered] of [["uniform", 800, false], ["clustered", 800, true], ["on a ring", 600, null]]) {
    it(`finds every overlapping name the all-pairs loop finds (${label})`, () => {
      const base = clustered === null
        ? Array.from({ length: n }, (_, i) => ({ id: `r${i}`, x: 1300 + 700 * Math.cos((2 * Math.PI * i) / n), y: 900 + 700 * Math.sin((2 * Math.PI * i) / n), vx: 0, vy: 0 }))
        : scatter(n, 21, clustered);
      const r = prng(33);
      const halfW = base.map(() => Math.max(7, labelWidth("x".repeat(1 + Math.floor(r() * 24))) / 2));
      const grid = base.map((p) => ({ ...p }));
      const loop = base.map((p) => ({ ...p }));
      separateLabelsGrid(grid, halfW, 0.7);
      exactLabelTerm(loop, halfW, 0.7);
      let touched = 0;
      grid.forEach((p, i) => {
        // Same pushes, summed in a different order: equal to rounding.
        expect(p.vx).toBeCloseTo(loop[i].vx, 9);
        expect(p.vy).toBeCloseTo(loop[i].vy, 9);
        if (loop[i].vx || loop[i].vy) touched++;
      });
      expect(touched).toBeGreaterThan(10); // the case actually exercises the term
    });
  }

  it("still finds every pair when the points are spread far past the world", () => {
    // The flat grid coarsens its cells rather than growing without bound.
    const ps = [
      { id: "a", x: 0, y: 0, vx: 0, vy: 0 }, { id: "b", x: 10, y: 5, vx: 0, vy: 0 },
      { id: "c", x: 5e6, y: 5e6, vx: 0, vy: 0 }, { id: "d", x: 5e6 + 12, y: 5e6 - 3, vx: 0, vy: 0 },
    ];
    const loop = ps.map((p) => ({ ...p }));
    separateLabelsGrid(ps, [40, 40, 40, 40], 1);
    exactLabelTerm(loop, [40, 40, 40, 40], 1);
    expect(ps.map((p) => [p.vx, p.vy])).toEqual(loop.map((p) => [p.vx, p.vy]));
    // Both far-apart pairs really were pushed.
    expect(Math.abs(ps[0].vx) + Math.abs(ps[0].vy)).toBeGreaterThan(0);
    expect(Math.abs(ps[2].vx) + Math.abs(ps[2].vy)).toBeGreaterThan(0);
  });
});

// ── Whole layouts ─────────────────────────────────────────────────────────────

describe("a large map", () => {
  it("settles to the same layout every time", () => {
    const ws = workspace(700, 2);
    const one = settleNew(ws);
    const two = settleNew(ws);
    expect(one.steps).toBe(two.steps);
    expect(flat(one.pos)).toEqual(flat(two.pos));
  });

  it("still freezes on the same cooling schedule", () => {
    // Deterministic convergence (ALPHA_DECAY / ALPHA_MIN / MAX_FRAMES) is not
    // the small map's alone: a large map freezes too, within the budget.
    const { steps } = settleNew(workspace(700, 6));
    expect(steps).toBeLessThanOrEqual(Math.ceil(Math.log(0.02) / Math.log(ALPHA_DECAY)) + 1);
    expect(ALPHA_DECAY).toBe(LEGACY_ALPHA_DECAY);
  });

  it("keeps every note inside the world", () => {
    const ws = workspace(700, 4);
    const { pos } = settleNew(ws);
    const { w, h } = worldFor(700, ws.folders.length > 0);
    for (const p of pos.values()) {
      expect(p.x).toBeGreaterThanOrEqual(PAD);
      expect(p.x).toBeLessThanOrEqual(w - PAD);
      expect(p.y).toBeGreaterThanOrEqual(PAD);
      expect(p.y).toBeLessThanOrEqual(h - PAD);
    }
  });
});
