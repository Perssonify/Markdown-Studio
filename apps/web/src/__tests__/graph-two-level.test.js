import { describe, it, expect } from "vitest";
import {
  ALPHA_DECAY,
  FOLDER_LAYOUT_MAX,
  REGION_GAP,
  clampToRegion,
  planFolderLayout,
  seedPositions,
  shouldFreeze,
  stepLayout,
  twoLevel,
} from "../store/graph/graph-physics";
import { crossesForeignContainer, folderBounds, placeLabels, truncateLabel } from "../store/graph/graph-metrics";
import { groupDocsByFolder } from "../store/documents/folders";
import { mapLibrary } from "../../e2e/map-library.mjs";

/**
 * A088 follow-up — a folder map above FOLDER_LAYOUT_MAX is laid out on TWO
 * levels: the folders' regions are packed first (planFolderLayout), then each
 * note is laid out inside its own region (stepLayout with a plan). The
 * single-level layout stacked such maps: at 2,000 notes in 60 folders the
 * browser measured 340–751 distinct positions and stacks of up to 89 notes.
 *
 * The libraries are the ones the browser probes open (e2e/map-library.mjs:
 * sixty skewed folders, a quarter of the notes in none, hubs, broken links),
 * turned into the graph the map is handed, plus a shape of our own with many
 * small folders and long folder names.
 *
 * Not asserted: that repulsion is summed per REGION rather than over the whole
 * map. It is a cost choice, not an invariant — measured, the whole map's
 * repulsion rests at the same layout quality and doubles the cost of a step —
 * so no layout property can tell the two apart.
 */

/** The map's input for a generated library, as PerssonifyEditor builds it:
 *  links resolved by title, folders grouped by `groupDocsByFolder`. */
function fromLibrary(n, seed) {
  const { docs, folderTree } = mapLibrary(n, { seed });
  const byTitle = new Map(docs.map((d) => [d.title.toLowerCase(), d.id]));
  const edges = [];
  const seen = new Set();
  for (const d of docs) {
    const para = d.canonical.content.find((c) => c.type === "paragraph" && c.content[0].text.startsWith("Related:"));
    for (const m of para ? para.content[0].text.matchAll(/\[\[([^\]]+)\]\]/g) : []) {
      const t = byTitle.get(m[1].toLowerCase());
      if (!t || t === d.id || seen.has(`${d.id}|${t}`)) continue;
      seen.add(`${d.id}|${t}`);
      edges.push({ source: d.id, target: t });
    }
  }
  const back = new Map();
  for (const e of edges) back.set(e.target, (back.get(e.target) || 0) + 1);
  const nodes = docs.map((d) => ({ id: d.id, title: d.title, backlinks: back.get(d.id) || 0 }));
  const folders = groupDocsByFolder(nodes.map((x) => x.id), folderTree.folders, folderTree.docParents);
  return withMeta({ nodes, edges, folders });
}

/** Many small folders (one per 8 notes) with LONG names, a dozen of them
 *  holding a single short-named note — where a folder's name tab, not its
 *  notes, decides how wide its container is. */
function smallFolders(n) {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `d${i}`, title: i % 5 ? `Note ${i}` : `Quarterly planning review ${i}` }));
  const edges = nodes.slice(1).map((d, i) => ({ source: d.id, target: `d${(i * 7) % (i + 1)}` }));
  const count = Math.round(n / 8);
  const folders = Array.from({ length: count }, (_, f) => ({ id: `f${f}`, name: `A rather long folder name ${f}`, docIds: [] }));
  nodes.forEach((d, i) => { if (i % 4 && i >= 12) folders[(i * 13) % count].docIds.push(d.id); });
  for (let i = 0; i < 12; i++) {
    nodes[i].title = `Memo ${i}`;
    folders.push({ id: `solo${i}`, name: `The folder with one note in it ${i}`, docIds: [nodes[i].id] });
  }
  const back = new Map();
  for (const e of edges) back.set(e.target, (back.get(e.target) || 0) + 1);
  for (const d of nodes) d.backlinks = back.get(d.id) || 0;
  return withMeta({ nodes, edges, folders: folders.filter((f) => f.docIds.length) });
}

/** The drawn sizes GraphView hands the layout (`metaRef`). */
function withMeta(ws) {
  const radius = new Map(ws.nodes.map((d) => [d.id, 7 + Math.min(10, (d.backlinks || 0) * 1.5)]));
  const label = new Map(ws.nodes.map((d) => [d.id, truncateLabel(d.title)]));
  return { ...ws, radius: (id) => radius.get(id) ?? 7, label: (id) => label.get(id) ?? "" };
}

const planFor = (ws) => planFolderLayout({ ids: ws.nodes.map((d) => d.id), folders: ws.folders, edges: ws.edges, radius: ws.radius, label: ws.label });

/** What GraphView does: plan, seed, step until it freezes. */
function settle(ws, { maxSteps = Infinity, pinned = null } = {}) {
  const plan = planFor(ws);
  const pos = seedPositions(ws.nodes.map((d) => d.id), ws.folders, plan.world, plan);
  let alpha = 1, steps = 0;
  for (;;) {
    const maxV = stepLayout({ positions: pos, edges: ws.edges, folders: ws.folders, world: plan.world, alpha,
      radius: ws.radius, label: ws.label, pinned, plan });
    alpha *= ALPHA_DECAY;
    steps++;
    if (shouldFreeze(maxV, alpha, steps) || steps >= maxSteps) break;
  }
  return { pos, plan, steps };
}

const flat = (pos) => [...pos.values()].flatMap((p) => [p.id, p.x, p.y, p.vx, p.vy]);

/** The closest two dots come, edge to edge (negative: they overlap). */
function closestDots(ws, pos) {
  const ps = [...pos.values()].sort((a, b) => a.x - b.x);
  let gap = Infinity;
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length && ps[j].x - ps[i].x < gap + 40; j++) {
      gap = Math.min(gap, Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y) - ws.radius(ps[i].id) - ws.radius(ps[j].id));
    }
  }
  return gap;
}

/** Overlapping containers, and dots in a container they do not belong to —
 *  the containers the renderer draws. At or below 1× their geometry is the
 *  same in world terms; a dot is drawn at a screen-constant size (damped below
 *  1×), so zoomed out it covers more world. */
function containerFaults(ws, pos, k = 1) {
  const rects = folderBounds({ folders: ws.folders, positions: pos, radius: ws.radius, label: ws.label, k: 1 });
  const dotScale = k >= 1 ? 1 : 0.6 + 0.4 * k;
  let boxBox = 0, strangers = 0;
  for (let i = 0; i < rects.length; i++) {
    const A = rects[i];
    for (let j = i + 1; j < rects.length; j++) {
      const B = rects[j];
      if (A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 && B.y0 < A.y1) boxBox++;
    }
    const own = new Set(A.docIds);
    for (const p of pos.values()) {
      if (own.has(p.id)) continue;
      const r = (ws.radius(p.id) * dotScale) / k;
      if (p.x + r > A.x0 && p.x - r < A.x1 && p.y + r > A.y0 && p.y - r < A.y1) strangers++;
    }
  }
  return { boxBox, strangers, rects };
}

/** How many notes the label placer names at 1× with the whole map in view —
 *  against every dot, and never across a stranger's container. */
function namedAt1x(ws, pos) {
  const rects = folderBounds({ folders: ws.folders, positions: pos, radius: ws.radius, label: ws.label, k: 1 });
  const containers = rects.map((r) => ({ docs: new Set(r.docIds), box: r }));
  const order = [...ws.nodes].sort((a, b) => b.backlinks - a.backlinks || a.id.localeCompare(b.id)).map((d) => d.id);
  const placed = placeLabels({
    order, positions: pos, radius: ws.radius, label: ws.label, cam: { k: 1, tx: 0, ty: 0 },
    obstacles: [...pos.values()].map((p) => {
      const r = ws.radius(p.id);
      return { x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r };
    }),
    reject: (id, box) => crossesForeignContainer(id, pos.get(id), box, containers),
  });
  return placed.size;
}

// Settled once per library and shared by the cases below (a 2,000-note settle
// is ~0.3s, the O(n²) checks about as much again).
const LIBRARIES = [
  ["600 notes in 60 folders (library 7)", () => fromLibrary(600, 7)],
  ["600 notes in 60 folders (library 3)", () => fromLibrary(600, 3)],
  ["2,000 notes in 60 folders (library 7)", () => fromLibrary(2000, 7)],
  ["2,000 notes in 60 folders (library 11)", () => fromLibrary(2000, 11)],
  ["800 notes in 100 small folders with long names", () => smallFolders(800)],
];
const settled = new Map();
const get = (name, make) => {
  if (!settled.has(name)) { const ws = make(); settled.set(name, { ws, ...settle(ws) }); }
  return settled.get(name);
};

describe("a folder map above FOLDER_LAYOUT_MAX is laid out on two levels", () => {
  for (const [name, make] of LIBRARIES) {
    describe(name, () => {
      it("gets a plan; every note has a region and starts inside it", () => {
        const { ws, plan } = get(name, make);
        expect(twoLevel(ws.nodes.length, true)).toBe(true);
        expect(plan).not.toBeNull();
        expect(plan.regionOf.size).toBe(ws.nodes.length);
        const filed = new Set(ws.folders.flatMap((f) => f.docIds));
        // One region per folder, and one for the notes in no folder.
        expect(plan.regions.length).toBe(ws.folders.length + (filed.size < ws.nodes.length ? 1 : 0));
        const seed = seedPositions(ws.nodes.map((d) => d.id), ws.folders, plan.world, plan);
        for (const [id, p] of seed) {
          const r = plan.regions[plan.regionOf.get(id)];
          expect(p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1).toBe(true);
        }
      });

      it("packs the regions apart: no two within REGION_GAP of each other, all inside the world", () => {
        const { plan } = get(name, make);
        const R = plan.regions;
        for (let i = 0; i < R.length; i++) {
          const A = R[i];
          expect(A.x0).toBeGreaterThan(0);
          expect(A.y0).toBeGreaterThan(0);
          expect(A.x1).toBeLessThan(plan.world.w);
          expect(A.y1).toBeLessThan(plan.world.h);
          for (let j = i + 1; j < R.length; j++) {
            const B = R[j];
            const apart = Math.max(A.x0 - B.x1, B.x0 - A.x1, A.y0 - B.y1, B.y0 - A.y1);
            expect(apart).toBeGreaterThan(REGION_GAP - 1e-6);
          }
        }
      });

      it("rests with no note on another: every dot clear of every other", () => {
        const { ws, pos } = get(name, make);
        expect(closestDots(ws, pos)).toBeGreaterThan(0);
      });

      it("rests with every container inside its region: none overlap, no stranger inside one", () => {
        const { ws, pos, plan } = get(name, make);
        const { boxBox, strangers, rects } = containerFaults(ws, pos);
        expect(boxBox).toBe(0);
        expect(strangers).toBe(0);
        for (const b of rects) {
          const r = plan.regions.find((g) => g.folderId === b.id);
          expect(b.x0).toBeGreaterThanOrEqual(r.x0 - 1e-6);
          expect(b.x1).toBeLessThanOrEqual(r.x1 + 1e-6);
          expect(b.y0).toBeGreaterThanOrEqual(r.y0 - 1e-6);
          expect(b.y1).toBeLessThanOrEqual(r.y1 + 1e-6);
        }
      });

      it("keeps a stranger's dot out of every container when the whole map is in view", () => {
        // Fitted to a 1000 × 680 canvas, the zoom GraphView's frame() would pick.
        const { ws, pos, plan } = get(name, make);
        const k = Math.min((1000 - 152) / plan.world.w, (680 - 80) / plan.world.h);
        expect(containerFaults(ws, pos, k).strangers).toBe(0);
      });

      it("leaves room to name nearly every note at 1×", () => {
        // Measured: 99% of notes named (a single-level folder map of 2,000
        // notes: 10–14%). The rest are named when zoomed in further.
        const { ws, pos } = get(name, make);
        expect(namedAt1x(ws, pos)).toBeGreaterThanOrEqual(Math.floor(ws.nodes.length * 0.95));
      });

      it("freezes on the cooling schedule", () => {
        const { steps } = get(name, make);
        expect(steps).toBeLessThanOrEqual(Math.ceil(Math.log(0.02) / Math.log(ALPHA_DECAY)) + 1);
      });
    });
  }

  it("is deterministic: the same library plans and settles to the same layout", () => {
    const one = settle(fromLibrary(600, 7));
    const two = settle(fromLibrary(600, 7));
    expect(one.plan.regions).toEqual(two.plan.regions);
    expect(one.steps).toBe(two.steps);
    expect(flat(one.pos)).toEqual(flat(two.pos));
  });

  it("plans the same way whatever order the notes, folders and links arrive in", () => {
    // The map's graph is rebuilt with the link index, not always in the same
    // order; a re-plan must not move a single region or home for that.
    const ws = fromLibrary(600, 7);
    const shuffled = {
      ...ws,
      nodes: [...ws.nodes].reverse(),
      edges: [...ws.edges].reverse(),
      folders: [...ws.folders].reverse().map((f) => ({ ...f, docIds: [...f.docIds].reverse() })),
    };
    const a = planFor(ws), b = planFor(shuffled);
    const byFolder = (plan) => new Map(plan.regions.map((r) => [r.folderId, r]));
    expect(byFolder(b)).toEqual(byFolder(a));
    expect(new Map([...b.home].sort())).toEqual(new Map([...a.home].sort()));
    // …and it rests in the same place — to within rounding: the forces still
    // sum in the order the notes and links came in.
    const one = settle(ws).pos, two = settle(shuffled).pos;
    let worst = 0;
    for (const [id, p] of one) worst = Math.max(worst, Math.hypot(p.x - two.get(id).x, p.y - two.get(id).y));
    expect(worst).toBeLessThan(1e-6);
  });

  it("puts linked folders nearer each other than a packing that ignores links would", () => {
    // Where the packing sends a region is decided partly by the regions it
    // links to. Scrambling which folder the links run between must make the
    // links between regions longer on average.
    const ws = fromLibrary(2000, 7);
    const meanCrossLink = (edges) => {
      const plan = planFor({ ...ws, edges });
      const mid = (id) => { const r = plan.regions[plan.regionOf.get(id)]; return [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2]; };
      let sum = 0, n = 0;
      for (const e of ws.edges) {
        if (plan.regionOf.get(e.source) === plan.regionOf.get(e.target)) continue;
        const [ax, ay] = mid(e.source), [bx, by] = mid(e.target);
        sum += Math.hypot(ax - bx, ay - by); n++;
      }
      return sum / n;
    };
    const ids = ws.nodes.map((d) => d.id);
    const scrambled = ws.edges.map((e, i) => ({ source: e.source, target: ids[(i * 7919) % ids.length] }));
    expect(meanCrossLink(ws.edges)).toBeLessThan(meanCrossLink(scrambled));
  });
});

describe("the plan is only made where it is needed", () => {
  it("not for a folderless map, at any size", () => {
    for (const n of [12, 600, 2000]) {
      const ids = Array.from({ length: n }, (_, i) => `d${i}`);
      expect(planFolderLayout({ ids, folders: [], edges: [], radius: () => 7, label: () => "x" })).toBeNull();
    }
  });

  it("not for a folder map at or below FOLDER_LAYOUT_MAX (it keeps the folder-aware layout)", () => {
    const ws = fromLibrary(FOLDER_LAYOUT_MAX, 7);
    expect(ws.folders.length).toBeGreaterThan(0);
    expect(planFor(ws)).toBeNull();
    expect(planFor(fromLibrary(FOLDER_LAYOUT_MAX + 1, 7))).not.toBeNull();
  });

  it("not when no note on the map is in a folder", () => {
    const ids = Array.from({ length: 600 }, (_, i) => `d${i}`);
    const folders = [{ id: "f", name: "Elsewhere", docIds: ["not-on-the-map"] }];
    expect(planFolderLayout({ ids, folders, edges: [], radius: () => 7, label: () => "x" })).toBeNull();
  });
});

describe("holding notes in their regions", () => {
  it("a dragged note is held where the pointer puts it — inside its own region", () => {
    const ws = fromLibrary(600, 3);
    const { plan } = settle(ws, { maxSteps: 1 });
    const id = ws.folders[0].docIds[0];
    const r = plan.regions[plan.regionOf.get(id)];
    // Far outside its region: held at the nearest point that keeps its dot,
    // its name and its container's padding inside.
    const held = clampToRegion(plan, id, -5000, r.y0 + (r.y1 - r.y0) / 2, ws.radius(id), ws.label(id));
    expect(held.x).toBeGreaterThan(r.x0);
    expect(held.x).toBeLessThan(r.x1);
    expect(held.y).toBe(r.y0 + (r.y1 - r.y0) / 2);
    // Inside it: exactly where the pointer is.
    const mid = { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
    expect(clampToRegion(plan, id, mid.x, mid.y, ws.radius(id), ws.label(id))).toEqual(mid);
    expect(clampToRegion(plan, "not-a-note", 0, 0, 7, "x")).toBeNull();

    // And the step leaves a pinned note exactly there.
    const settledPinned = settle(ws, { maxSteps: 30, pinned: id });
    const start = seedPositions(ws.nodes.map((d) => d.id), ws.folders, plan.world, plan).get(id);
    expect(settledPinned.pos.get(id).x).toBe(start.x);
    expect(settledPinned.pos.get(id).y).toBe(start.y);
  });

  it("a container its name tab widens is moved back inside its region", () => {
    // A folder whose short-named notes sit against one side of their region:
    // the container widens about their middle to fit the folder's long name,
    // past the region's edge — until the step moves the folder back in.
    const ws = smallFolders(800);
    const { plan, pos } = settle(ws, { maxSteps: 1 });
    const folder = ws.folders.find((f) => f.docIds.length >= 2 && f.docIds.every((id) => ws.label(id).length <= 8));
    expect(folder).toBeTruthy();
    const r = plan.regions.find((g) => g.folderId === folder.id);
    for (const id of folder.docIds) {
      const p = pos.get(id);
      const at = clampToRegion(plan, id, r.x0, p.y, ws.radius(id), ws.label(id)); // hard against the left wall
      p.x = at.x; p.vx = 0; p.vy = 0;
    }
    const box = () => folderBounds({ folders: [folder], positions: pos, radius: ws.radius, label: ws.label, k: 1 })[0];
    expect(box().x0).toBeLessThan(r.x0); // the premise: it pokes out
    stepLayout({ positions: pos, edges: [], folders: ws.folders, world: plan.world, alpha: 0,
      radius: ws.radius, label: ws.label, plan });
    expect(box().x0).toBeGreaterThanOrEqual(r.x0 - 1e-9);
    expect(box().x1).toBeLessThanOrEqual(r.x1 + 1e-9);
  });
});
