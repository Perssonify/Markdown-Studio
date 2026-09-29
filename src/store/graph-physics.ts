/**
 * graph-physics.ts — the relationship map's force layout, pure and render-less.
 *
 * GraphView owns the ONE mutable position map (`posRef`) and calls `stepLayout`
 * on it once per simulation step. Nothing here keeps state between calls, so a
 * layout is a function of (positions, graph, temperature) alone — which is what
 * makes it deterministic, and testable without a DOM.
 *
 * The simulation runs in its OWN world-space, sized from the node count — NOT
 * from the viewport. That separation is load-bearing: layout used to be keyed
 * to the canvas rect, so every resize (including docking/undocking a panel
 * beside the map) reheated the sim and visibly reshuffled the whole graph. Now
 * a resize only re-aims the camera; the layout is untouched.
 *
 * Two force paths, chosen by node count (`BARNES_HUT_MIN`):
 *  - a small workspace runs the exact all-pairs loop the map has always run,
 *    operation for operation, so it lays out BIT-FOR-BIT as it did (the tests
 *    pin it against a verbatim copy of the old loop);
 *  - a large one approximates the long-range repulsion with a Barnes–Hut
 *    quadtree and finds the short-range label-room pairs through a uniform
 *    grid. The all-pairs loop is O(n²) and at 2,000 notes it WAS the map: see
 *    `BARNES_HUT_MIN`.
 */
import { folderBounds, labelWidth, LABEL_GAP, LABEL_H, type FolderBounds, type FolderInput } from "./graph-metrics";

export interface SimPoint {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

// ── Tuning ───────────────────────────────────────────────────────────────────
// Tuned to settle in well under a second and then FREEZE.
export const PAD = 40;
const REPULSION = 1400;
const SPRING_K = 0.02;
const GRAVITY = 0.015;
// Folder clustering. Cohesion is the SOFT half — it gathers a folder's members.
// Keeping containers off each other and off strangers is a HARD positional
// constraint applied after integration (see `stepLayout`), because as a force it
// simply lost to the springs between two linked folders.
const FOLDER_COHESION = 0.09;
/** Room the LAYOUT reserves for each note's name, so labels are not merely
 *  dropped when they collide — the graph spreads out enough to show them. The
 *  layout measures at 1× (screen units == world units); the draw-time placer is
 *  what actually guarantees no overlap at the current zoom. */
const TEXT_SEPARATION = 0.05;
const TEXT_ROOM_Y = 34;
const FOLDER_GAP = 44;
/** Overlap under this many units is left alone, so clusters stop nudging each
 *  other back and forth instead of settling. */
const FOLDER_SLACK = 6;
const DAMPING = 0.82;
export const SETTLE_V = 0.06;
/** Force cooling (d3-style). Without it the layout relaxed on its own schedule —
 *  measured at 377 frames (~6s of rAF) for a 25-note workspace, and worse as the
 *  graph grows. A decaying alpha makes convergence DETERMINISTIC: forces fade to
 *  nothing in ~110 frames, so the loop always reaches its freeze. */
export const ALPHA_DECAY = 0.965;
export const ALPHA_MIN = 0.02;
/** Hard stop for the force loop. It normally settles in well under a second,
 *  but "settles" must never be a precondition for freezing: a layout that keeps
 *  nudging itself (clusters trading places, nodes pinned on a world edge) once
 *  left the loop running forever, which also meant the post-settle camera fit
 *  NEVER ran — the map stayed framed on its initial ring in a corner. */
export const MAX_FRAMES = 900;

/** Above this many notes the repulsion is approximated (Barnes–Hut) and the
 *  label-room pairs come from a grid; at or below it the exact all-pairs loop
 *  runs unchanged. The exact loop is O(n²) per step: at 2,000 notes it visits
 *  two million pairs, ~16ms a step at full speed (V8, measured), where the
 *  quadtree and the grid together take ~3ms. (The rest of the old step's cost
 *  — ~100-140ms at full speed, ~500ms under 4× throttling in the browser — was
 *  O(n²) container bookkeeping, now a lookup for every size.) Below a few
 *  hundred notes the exact loop costs a millisecond or two, so a small
 *  workspace keeps its exact, familiar layout. */
export const BARNES_HUT_MIN = 300;
/** Opening criterion: a quadtree cell is treated as one mass when its size is
 *  under THETA × its distance. 0.9 is d3-force's default; the tests hold the
 *  approximation to a few percent of the exact force. */
export const BARNES_HUT_THETA = 0.9;

/** Stable layout space for `n` documents (independent of the viewport). */
export function worldFor(n: number) {
  const w = Math.max(720, Math.min(2600, 520 + n * 90));
  return { w, h: Math.round(w * 0.72) };
}

/** Freeze test, shared by the animated loop and the reduced-motion settle. */
export function shouldFreeze(maxV: number, alpha: number, steps: number) {
  return maxV <= SETTLE_V || alpha <= ALPHA_MIN || steps >= MAX_FRAMES;
}

/**
 * Tie-break for two notes on (or within a unit of) the same spot, where the
 * repulsion has no direction. It used to be `Math.random()`, the one thing that
 * made the same library lay out differently on two opens. A hash of the pair is
 * just as good at pulling them apart and gives the same answer every time.
 * Range and scale match the old `(Math.random() - 0.5) * 0.1`.
 */
export function pairJitter(a: number, b: number): number {
  let h = Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967296 - 0.5) * 0.1;
}

export interface StepInput {
  /** Every node's point, in a stable (insertion) order. Mutated IN PLACE. */
  positions: Map<string, SimPoint>;
  edges: readonly { source: string; target: string }[];
  folders: readonly FolderInput[];
  world: { w: number; h: number };
  /** Force temperature; the caller decays it. */
  alpha: number;
  /** Drawn size of each node and its label — the layout reserves room for text. */
  radius: (id: string) => number;
  label: (id: string) => string;
  /** A node being dragged: held exactly where the pointer put it. */
  pinned?: string | null;
  /** Force-path override (tests). Default: exact at or below BARNES_HUT_MIN. */
  exact?: boolean;
}

/**
 * Advance the layout one step, mutating the points in place. Returns the
 * largest per-node speed, for the settle test.
 */
export function stepLayout(input: StepInput): number {
  const { positions, edges, folders, world, alpha, pinned = null } = input;
  const radiusOf = input.radius;
  const labelOf = input.label;
  const ps = Array.from(positions.values());
  const { w, h } = world;
  const cx = w / 2, cy = h / 2;
  // Spread scales with the NUMBER of notes, not the world area: world size
  // already grows with the node count, so scaling by area double-counted it
  // (10× the repulsion at 25 notes) and stretched out the relaxation.
  const spread = Math.max(1, Math.min(5, ps.length / 6));
  const repulsion = REPULSION * spread * alpha;
  const springLen = Math.max(70, Math.min(170, Math.min(w, h) / 4));
  const minX = PAD, maxX = Math.max(PAD + 1, w - PAD);
  const minY = PAD, maxY = Math.max(PAD + 1, h - PAD);

  // Half the drawn width of each node's own name — how much horizontal room
  // that note needs to be readable.
  const halfW = ps.map((p) => Math.max(radiusOf(p.id), labelWidth(labelOf(p.id)) / 2));

  if (input.exact ?? ps.length <= BARNES_HUT_MIN) {
    pairForcesExact(ps, halfW, repulsion, alpha);
  } else {
    repulseBarnesHut(ps, repulsion, BARNES_HUT_THETA);
    separateLabelsGrid(ps, halfW, alpha);
  }

  for (const e of edges) {
    const a = positions.get(e.source), b = positions.get(e.target);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = (d - springLen) * SPRING_K * alpha;
    const fx = (dx / d) * f, fy = (dy / d) * f;
    a.vx += fx; a.vy += fy;
    b.vx -= fx; b.vy -= fy;
  }
  // Cohesion holds a folder's members together…
  for (const folder of folders) {
    if (folder.docIds.length < 2) continue;
    const pts: SimPoint[] = [];
    let fcx = 0, fcy = 0;
    for (const id of folder.docIds) {
      const p = positions.get(id);
      if (p) { pts.push(p); fcx += p.x; fcy += p.y; }
    }
    if (pts.length < 2) continue;
    fcx /= pts.length; fcy /= pts.length;
    for (const p of pts) {
      p.vx += (fcx - p.x) * FOLDER_COHESION * alpha;
      p.vy += (fcy - p.y) * FOLDER_COHESION * alpha;
    }
  }

  let maxV = 0;
  for (const p of ps) {
    p.vx += (cx - p.x) * GRAVITY * alpha;
    p.vy += (cy - p.y) * GRAVITY * alpha;
    if (pinned === p.id) { p.vx = 0; p.vy = 0; continue; }
    p.vx *= DAMPING; p.vy *= DAMPING;
    p.x = Math.max(minX, Math.min(maxX, p.x + p.vx));
    p.y = Math.max(minY, Math.min(maxY, p.y + p.vy));
    const v = Math.abs(p.vx) + Math.abs(p.vy);
    if (v > maxV) maxV = v;
  }

  // ── Hard container constraints ───────────────────────────────────────────
  // Applied to POSITIONS after integration, and deliberately NOT scaled by
  // alpha. As a velocity nudge this lost: springs pulling two linked folders
  // together simply out-pulled it, and whatever overlap was left when the
  // forces cooled was the overlap the user saw. As a positional constraint it
  // is the last word each frame, so the resting layout always satisfies it —
  // and once alpha has decayed there is nothing left to fight it.
  const shift = (p: SimPoint, dx: number, dy: number) => {
    p.x = Math.max(minX, Math.min(maxX, p.x + dx));
    p.y = Math.max(minY, Math.min(maxY, p.y + dy));
  };
  // A node's footprint for the outsider test is fixed for the step.
  const outHW = new Float64Array(ps.length), outVH = new Float64Array(ps.length);
  for (let i = 0; i < ps.length; i++) {
    const id = ps[i]!.id;
    outHW[i] = Math.max(radiusOf(id), labelWidth(labelOf(id)) / 2) + FOLDER_SLACK;
    outVH[i] = radiusOf(id) + LABEL_GAP + LABEL_H + FOLDER_SLACK;
  }
  // Who is in which container. The passes below recompute the rectangles (they
  // move as notes are shifted) but never their membership — no position is
  // added or removed mid-step, so every pass yields the same folders in the
  // same order — so this is worked out once.
  let members: SimPoint[][] | null = null;
  const ownRects = new Map<string, number[]>();
  for (let pass = 0; pass < 3; pass++) {
    const rects = folderBounds({ folders: folders as FolderInput[], positions, radius: radiusOf, label: labelOf, k: 1 });
    if (!rects.length) break;
    if (!members) {
      members = rects.map((r) => r.docIds.map((id) => positions.get(id)).filter((q): q is SimPoint => !!q));
      // Which containers each note belongs to, as a lookup. It used to be a
      // scan of every member list for every note and every container —
      // O(notes × filed notes), three times a step — to answer exactly the
      // same question.
      rects.forEach((r, i) => {
        for (const id of r.docIds) {
          const list = ownRects.get(id);
          if (list) { if (list[list.length - 1] !== i) list.push(i); } else ownRects.set(id, [i]);
        }
      });
    }
    // Container ↔ container.
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const A = rects[i]!, B = rects[j]!;
        const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0) + FOLDER_GAP;
        const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0) + FOLDER_GAP;
        if (ox <= 0 || oy <= 0) continue;
        const horizontal = ox <= oy;
        const dir = horizontal
          ? ((A.x0 + A.x1) <= (B.x0 + B.x1) ? 1 : -1)
          : ((A.y0 + A.y1) <= (B.y0 + B.y1) ? 1 : -1);
        const step = (horizontal ? ox : oy) / 2;
        for (const p of members[i]!) shift(p, horizontal ? -step * dir : 0, horizontal ? 0 : -step * dir);
        for (const p of members[j]!) shift(p, horizontal ? step * dir : 0, horizontal ? 0 : step * dir);
      }
    }
    // Container ↔ outsider: measured with the outsider's own label footprint,
    // so a foreign NAME cannot lie across a container it has nothing to do with.
    // Only the FIRST foreign container a note overlaps is acted on, so that is
    // all this looks for — box test first, membership only on a hit.
    for (let pi = 0; pi < ps.length; pi++) {
      const p = ps[pi]!;
      const hw = outHW[pi]!, vh = outVH[pi]!;
      const mine = ownRects.get(p.id);
      let first = -1;
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i]!;
        if (p.x + hw > r.x0 && p.x - hw < r.x1 && p.y + vh > r.y0 && p.y - vh < r.y1
          && !(mine && mine.includes(i))) { first = i; break; }
      }
      if (first < 0) continue;
      const ownIds = mine ? mine.map((i) => rects[i]!.id) : [];
      const rect = rects[first]!;
      // All four walls, nearest first — but a wall is only worth using if the
      // node does not land inside the NEXT container along. A note wedged in
      // the corridor between two clusters was otherwise shoved back and forth
      // between them and stayed inside one of the two.
      exitDx[0] = -(p.x + hw - rect.x0); exitDy[0] = 0; exitD[0] = p.x + hw - rect.x0;
      exitDx[1] = rect.x1 - (p.x - hw); exitDy[1] = 0; exitD[1] = rect.x1 - (p.x - hw);
      exitDx[2] = 0; exitDy[2] = -(p.y + vh - rect.y0); exitD[2] = p.y + vh - rect.y0;
      exitDx[3] = 0; exitDy[3] = rect.y1 - (p.y - vh); exitD[3] = rect.y1 - (p.y - vh);
      // Nearest first, ties in wall order: a stable insertion sort of four,
      // the same order the (stable) `Array.prototype.sort` produced.
      exitOrder[0] = 0; exitOrder[1] = 1; exitOrder[2] = 2; exitOrder[3] = 3;
      for (let a = 1; a < 4; a++) {
        const cur = exitOrder[a]!;
        let b = a;
        while (b > 0 && exitD[exitOrder[b - 1]!]! - exitD[cur]! > 0) { exitOrder[b] = exitOrder[b - 1]!; b--; }
        exitOrder[b] = cur;
      }
      let best = exitOrder[0]!;
      for (let a = 0; a < 4; a++) {
        const e = exitOrder[a]!;
        if (!inForeign(rects, ownIds, p.x + exitDx[e]!, p.y + exitDy[e]!, hw, vh)) { best = e; break; }
      }
      shift(p, exitDx[best]!, exitDy[best]!);
    }
  }

  return maxV;
}

/** Scratch for the four exits of the outsider constraint (one note at a time). */
const exitDx = new Float64Array(4), exitDy = new Float64Array(4), exitD = new Float64Array(4);
const exitOrder = new Int32Array(4);

/** Would a note of this footprint at (x, y) lie in a container it is not a
 *  member of? */
function inForeign(rects: FolderBounds[], ownIds: string[], x: number, y: number, hw: number, vh: number) {
  for (const r of rects) {
    if (x + hw > r.x0 && x - hw < r.x1 && y + vh > r.y0 && y - vh < r.y1 && !ownIds.includes(r.id)) return true;
  }
  return false;
}

/** The exact all-pairs loop — repulsion plus the label-room term, the map's
 *  original physics, unchanged except that coincident notes are separated by a
 *  deterministic `pairJitter` instead of `Math.random()`. */
function pairForcesExact(ps: SimPoint[], halfW: number[], repulsion: number, alpha: number) {
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i]!, b = ps[j]!;
      let dx = b.x - a.x, dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) { d2 = 1; dx = pairJitter(i, j); dy = pairJitter(j, i); }
      const d = Math.sqrt(d2);
      const f = repulsion / d2;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx -= fx; a.vy -= fy;
      b.vx += fx; b.vy += fy;
      // Radial repulsion alone is blind to TEXT: two notes a comfortable
      // distance apart can still have names that run straight through each
      // other. Resolve the label boxes on whichever axis they overlap least.
      const needX = halfW[i]! + halfW[j]!;
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax < needX && ay < TEXT_ROOM_Y) {
        const ox = needX - ax, oy = TEXT_ROOM_Y - ay;
        if (ox / needX <= oy / TEXT_ROOM_Y) {
          const push = ox * TEXT_SEPARATION * alpha * (dx < 0 ? -1 : 1);
          a.vx -= push; b.vx += push;
        } else {
          const push = oy * TEXT_SEPARATION * alpha * (dy < 0 ? -1 : 1);
          a.vy -= push; b.vy += push;
        }
      }
    }
  }
}

// ── Barnes–Hut ───────────────────────────────────────────────────────────────

/** Deepest a quadtree cell may split; notes closer than world/2^24 share a leaf
 *  (and are then resolved exactly, pair by pair). */
const QT_MAX_DEPTH = 24;

/** A quadtree over a point set, flattened into arrays. Cells are squares; a
 *  leaf holds a contiguous run of `order`. Built by in-place partitioning, so
 *  the same points in the same order always produce the same tree. */
export interface QuadTree {
  x0: number[];
  y0: number[];
  size: number[];
  /** Number of points under the cell, and their centre of mass. */
  mass: number[];
  mx: number[];
  my: number[];
  /** Leaf: first index into `order` (−1 for an internal cell). */
  first: number[];
  count: number[];
  /** Four child slots per cell (−1 for none), in TL, TR, BL, BR order. */
  child: number[];
  order: Int32Array;
}

export function buildQuadTree(xs: ArrayLike<number>, ys: ArrayLike<number>): QuadTree {
  const n = xs.length;
  const t: QuadTree = {
    x0: [], y0: [], size: [], mass: [], mx: [], my: [], first: [], count: [], child: [],
    order: new Int32Array(n),
  };
  for (let i = 0; i < n; i++) t.order[i] = i;
  if (!n) return t;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!, y = ys[i]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // A hair of slack so the extreme points fall strictly inside the root.
  const size = Math.max(maxX - minX, maxY - minY, 1) * (1 + 1e-9) + 1e-9;
  const order = t.order;
  const partition = (lo: number, hi: number, below: (i: number) => boolean) => {
    let a = lo, b = hi - 1;
    while (a <= b) {
      if (below(order[a]!)) { a++; continue; }
      const tmp = order[a]!; order[a] = order[b]!; order[b] = tmp; b--;
    }
    return a;
  };
  const make = (lo: number, hi: number, x0: number, y0: number, s: number, depth: number): number => {
    const c = t.x0.length;
    t.x0.push(x0); t.y0.push(y0); t.size.push(s);
    t.mass.push(0); t.mx.push(0); t.my.push(0);
    t.first.push(-1); t.count.push(0);
    t.child.push(-1, -1, -1, -1);
    if (hi - lo <= 1 || depth >= QT_MAX_DEPTH) {
      let sx = 0, sy = 0;
      for (let k = lo; k < hi; k++) { sx += xs[order[k]!]!; sy += ys[order[k]!]!; }
      t.first[c] = lo; t.count[c] = hi - lo;
      t.mass[c] = hi - lo; t.mx[c] = sx / (hi - lo); t.my[c] = sy / (hi - lo);
      return c;
    }
    const h = s / 2, midX = x0 + h, midY = y0 + h;
    const m = partition(lo, hi, (i) => ys[i]! < midY);
    const a = partition(lo, m, (i) => xs[i]! < midX);
    const b = partition(m, hi, (i) => xs[i]! < midX);
    const spans: [number, number, number, number][] = [
      [lo, a, x0, y0], [a, m, midX, y0], [m, b, x0, midY], [b, hi, midX, midY],
    ];
    let mass = 0, sx = 0, sy = 0;
    for (let q = 0; q < 4; q++) {
      const [qlo, qhi, qx, qy] = spans[q]!;
      if (qhi <= qlo) continue;
      const ch = make(qlo, qhi, qx, qy, h, depth + 1);
      t.child[c * 4 + q] = ch;
      mass += t.mass[ch]!; sx += t.mx[ch]! * t.mass[ch]!; sy += t.my[ch]! * t.mass[ch]!;
    }
    t.mass[c] = mass; t.mx[c] = sx / mass; t.my[c] = sy / mass;
    return c;
  };
  make(0, n, minX, minY, size, 0);
  return t;
}

/**
 * Repulsion on each point from all the others, approximated with a quadtree:
 * a cell far enough away (size < theta × distance) acts as ONE mass at its
 * centre. Same force law as the exact loop (repulsion / d², directed away), and
 * pairs that are resolved individually use the same coincident-point tie-break.
 * A cell that contains the point itself is always opened, so a point never
 * repels itself through an aggregate. Writes into velocities, like the loop.
 */
export function repulseBarnesHut(ps: SimPoint[], repulsion: number, theta: number) {
  const n = ps.length;
  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = ps[i]!.x; ys[i] = ps[i]!.y; }
  const t = buildQuadTree(xs, ys);
  const theta2 = theta * theta;
  const stack = new Int32Array(4 * QT_MAX_DEPTH + 8);
  for (let i = 0; i < n; i++) {
    const xi = xs[i]!, yi = ys[i]!;
    let fx = 0, fy = 0;
    let sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const c = stack[--sp]!;
      const first = t.first[c]!;
      if (first >= 0) {
        for (let k = first, end = first + t.count[c]!; k < end; k++) {
          const j = t.order[k]!;
          if (j === i) continue;
          let dx = xs[j]! - xi, dy = ys[j]! - yi;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            // The exact loop's tie-break, seen from this end of the pair.
            d2 = 1;
            const lo = i < j ? i : j, hi = i < j ? j : i, s = i < j ? 1 : -1;
            dx = s * pairJitter(lo, hi); dy = s * pairJitter(hi, lo);
          }
          const d = Math.sqrt(d2);
          const f = repulsion / d2;
          fx -= (dx / d) * f; fy -= (dy / d) * f;
        }
        continue;
      }
      const s = t.size[c]!, x0 = t.x0[c]!, y0 = t.y0[c]!;
      const inside = xi >= x0 && xi <= x0 + s && yi >= y0 && yi <= y0 + s;
      if (!inside) {
        const dx = t.mx[c]! - xi, dy = t.my[c]! - yi;
        const d2 = dx * dx + dy * dy;
        if (d2 >= 1 && s * s < theta2 * d2) {
          const d = Math.sqrt(d2);
          const f = (repulsion * t.mass[c]!) / d2;
          fx -= (dx / d) * f; fy -= (dy / d) * f;
          continue;
        }
      }
      for (let q = 3; q >= 0; q--) {
        const ch = t.child[c * 4 + q]!;
        if (ch >= 0) stack[sp++] = ch;
      }
    }
    ps[i]!.vx += fx; ps[i]!.vy += fy;
  }
}

/**
 * The label-room term for a large layout. It only acts on pairs whose name
 * boxes actually overlap (|dx| < the two half-widths, |dy| < TEXT_ROOM_Y), so
 * a grid with cells that wide and that tall finds every such pair among the
 * nine cells around a point — the same pairs the all-pairs loop would find,
 * each visited once, for O(n) work instead of O(n²).
 */
export function separateLabelsGrid(ps: SimPoint[], halfW: number[], alpha: number) {
  const n = ps.length;
  if (!n) return;
  let widest = 1;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (halfW[i]! > widest) widest = halfW[i]!;
    const p = ps[i]!;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  let cw = 2 * widest, ch = TEXT_ROOM_Y;
  // Bucket by cell with a counting sort into flat arrays: points are confined
  // to the world, so the grid is small and dense, and this runs every step.
  // Cells may be LARGER than a label box (more candidates, never a missed
  // pair), which bounds the grid for points spread arbitrarily far.
  const cap = 4 * n + 1024;
  const spanCells = ((maxX - minX) / cw + 1) * ((maxY - minY) / ch + 1);
  if (spanCells > cap) {
    const f = Math.sqrt(spanCells / cap);
    cw *= f; ch *= f;
  }
  const cols = Math.floor((maxX - minX) / cw) + 1, rows = Math.floor((maxY - minY) / ch) + 1;
  const cellOf = new Int32Array(n);
  const start = new Int32Array(cols * rows + 1);
  for (let i = 0; i < n; i++) {
    const c = Math.floor((ps[i]!.y - minY) / ch) * cols + Math.floor((ps[i]!.x - minX) / cw);
    cellOf[i] = c;
    start[c + 1]!++;
  }
  for (let c = 0; c < cols * rows; c++) start[c + 1]! += start[c]!;
  const fill = start.slice(0, cols * rows);
  const members = new Int32Array(n);
  for (let i = 0; i < n; i++) members[fill[cellOf[i]!]!++] = i; // ascending within a cell
  for (let i = 0; i < n; i++) {
    const a = ps[i]!;
    const gx = cellOf[i]! % cols, gy = (cellOf[i]! - gx) / cols;
    for (let ox = -1; ox <= 1; ox++) {
      const x = gx + ox;
      if (x < 0 || x >= cols) continue;
      for (let oy = -1; oy <= 1; oy++) {
        const y = gy + oy;
        if (y < 0 || y >= rows) continue;
        const c = y * cols + x;
        for (let s = start[c]!, e = start[c + 1]!; s < e; s++) {
          const j = members[s]!;
          if (j <= i) continue;
          const b = ps[j]!;
          const dx = b.x - a.x, dy = b.y - a.y;
          const needX = halfW[i]! + halfW[j]!;
          const ax = Math.abs(dx), ay = Math.abs(dy);
          if (ax < needX && ay < TEXT_ROOM_Y) {
            const ox2 = needX - ax, oy2 = TEXT_ROOM_Y - ay;
            if (ox2 / needX <= oy2 / TEXT_ROOM_Y) {
              const push = ox2 * TEXT_SEPARATION * alpha * (dx < 0 ? -1 : 1);
              a.vx -= push; b.vx += push;
            } else {
              const push = oy2 * TEXT_SEPARATION * alpha * (dy < 0 ? -1 : 1);
              a.vy -= push; b.vy += push;
            }
          }
        }
      }
    }
  }
}
