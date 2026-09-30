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
 * A folder map above `FOLDER_LAYOUT_MAX` notes is laid out differently again,
 * on two levels — the folders' regions first, then each note inside its own
 * (`planFolderLayout`, `stepTwoLevel`).
 */
import {
  folderBounds,
  folderChipWidth,
  labelWidth,
  FOLDER_CHIP_INSET,
  FOLDER_PAD,
  LABEL_GAP,
  LABEL_H,
  type FolderBounds,
  type FolderInput,
} from "./graph-metrics";

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

/** World area a note in a FOLDER needs: its dot and its name (about 150 × 40 at
 *  1×), the room its container keeps around every member's name on any side,
 *  and the slack a packing of unequal clusters leaves. Measured, not guessed:
 *  with less, folder maps of 200–300 notes were pushed into the walls. */
const FOLDER_NOTE_AREA = 45000;

/**
 * Stable layout space for `n` documents (independent of the viewport).
 *
 * Without folders this is the fixed-growth world the map has always used
 * (2,600 × 1,872 from 23 notes up), and a folderless map lays out exactly as it
 * did. WITH folders that world was far too small from about 150 notes: every
 * container must hold its members' names, the containers could not all fit,
 * and the hard container constraint pushed folders into the walls, where their
 * notes piled up. A folder map's world grows with the area its notes need.
 */
export function worldFor(n: number, withFolders = false) {
  const fixed = Math.max(720, Math.min(2600, 520 + n * 90));
  const w = folderAware(n, withFolders) ? Math.max(fixed, Math.round(Math.sqrt((n * FOLDER_NOTE_AREA) / 0.72))) : fixed;
  return { w, h: Math.round(w * 0.72) };
}

/**
 * The folder-aware layout — folder clusters as the seed, a world sized to the
 * folders, a speed limit, folders moved as units — is measured clean up to 400
 * notes in 40 folders (every note on its own spot, across several libraries).
 * Beyond this it is not: at 600 notes in 60 folders the settle is chaotic, and
 * at 2,000 it measured WORSE than the old layout in the browser (340 distinct
 * positions against 751). Such maps are laid out on two levels instead — the
 * folders as units, then each folder's notes inside its own region
 * (`planFolderLayout`); `worldFor` and `seedPositions` without a plan give
 * them the pre-folder-aware world and ring, as before.
 */
export const FOLDER_LAYOUT_MAX = 500;

/** Whether a map of `n` notes gets the folder-aware layout. */
export function folderAware(n: number, hasFolders: boolean): boolean {
  return hasFolders && n <= FOLDER_LAYOUT_MAX;
}

/** Top speed of a note in a folder map, in world units per step. The repulsion
 *  is 1/d² and uncapped, and the container constraint and the walls keep
 *  producing close pairs: without a limit a pair two units apart was thrown
 *  ~1,700 units in one step, and a 150-note map in 15 folders blew up within
 *  five steps (every note on a wall). Folderless maps never reach it. */
const FOLDER_MAX_SPEED = 30;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Seed spacing inside a folder (Vogel's constant): neighbours start about
 *  SEED_SPACING·√π apart. */
const SEED_SPACING = 60;
/** Room a seeded cluster keeps around its dots for the names beside them. */
const SEED_NAME_W = 80;
const SEED_NAME_H = 24;

/**
 * Where the notes start.
 *
 * With no folders, the ring the map has always started from — unchanged, so a
 * folderless map lays out exactly as it did. With folders, each folder starts as
 * its OWN compact cluster (a sunflower spiral), the clusters shelf-packed across
 * the world, and notes in no folder as one more cluster. Seeded on one ring, a
 * folder's members started scattered around it, so every container started as a
 * box spanning most of the world, all of them overlapping; the hard container
 * constraint then threw whole folders into the walls, where their notes piled
 * up — at 2,000 notes in 60 folders, 751 distinct positions for 2,000 notes,
 * and 150 notes in 15 folders lost about a quarter. Deterministic, and returned
 * in `ids` order (the insertion order `stepLayout` iterates).
 */
export function seedPositions(
  ids: readonly string[],
  folders: readonly FolderInput[],
  world: { w: number; h: number },
  plan?: FolderPlan | null,
): Map<string, SimPoint> {
  if (plan) return seedInRegions(ids, plan);
  const { w, h } = world;
  const n = ids.length || 1;
  const folderOf = new Map<string, number>();
  folders.forEach((f, fi) => {
    for (const id of f.docIds) if (!folderOf.has(id)) folderOf.set(id, fi);
  });
  const out = new Map<string, SimPoint>();
  if (!folderAware(ids.length, ids.some((id) => folderOf.has(id)))) {
    const r = Math.min(Math.min(w, h) / 2 - PAD - 10, 60 + n * 22);
    ids.forEach((id, i) => {
      const angle = (2 * Math.PI * i) / n;
      out.set(id, { id, x: w / 2 + r * Math.cos(angle), y: h / 2 + r * Math.sin(angle), vx: 0, vy: 0 });
    });
    return out;
  }

  const groups: string[][] = folders.map(() => []);
  const loose: string[] = [];
  for (const id of ids) {
    const f = folderOf.get(id);
    if (f == null) loose.push(id);
    else groups[f]!.push(id);
  }
  const clusters = groups.filter((g) => g.length);
  if (loose.length) clusters.push(loose);
  const sized = clusters
    .map((members, order) => {
      const r = SEED_SPACING * Math.sqrt(members.length);
      return { members, order, hw: r + SEED_NAME_W, hh: r + SEED_NAME_H };
    })
    .sort((a, b) => b.hw - a.hw || a.order - b.order);

  // Shelf packing, largest first: left to right, a new row when one is full.
  const maxW = Math.max(1, w - 2 * PAD);
  const placed: Array<{ members: string[]; cx: number; cy: number }> = [];
  let x = 0, y = 0, rowH = 0, usedW = 0;
  for (const s of sized) {
    if (x > 0 && x + 2 * s.hw > maxW) {
      y += rowH + FOLDER_GAP;
      x = 0;
      rowH = 0;
    }
    placed.push({ members: s.members, cx: x + s.hw, cy: y + s.hh });
    x += 2 * s.hw + FOLDER_GAP;
    rowH = Math.max(rowH, 2 * s.hh);
    usedW = Math.max(usedW, x - FOLDER_GAP);
  }
  const usedH = y + rowH;
  const ox = PAD + Math.max(0, (maxW - usedW) / 2);
  const oy = PAD + Math.max(0, (h - 2 * PAD - usedH) / 2);
  const seeded = new Map<string, { x: number; y: number }>();
  for (const c of placed) {
    c.members.forEach((id, j) => {
      const rr = SEED_SPACING * Math.sqrt(j + 0.5);
      const a = j * GOLDEN_ANGLE;
      seeded.set(id, { x: ox + c.cx + rr * Math.cos(a), y: oy + c.cy + rr * Math.sin(a) });
    });
  }
  const minX = PAD, maxX = Math.max(PAD + 1, w - PAD), minY = PAD, maxY = Math.max(PAD + 1, h - PAD);
  for (const id of ids) {
    const p = seeded.get(id)!;
    out.set(id, {
      id,
      x: Math.max(minX, Math.min(maxX, p.x)),
      y: Math.max(minY, Math.min(maxY, p.y)),
      vx: 0,
      vy: 0,
    });
  }
  return out;
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
  /** The folder regions of a TWO-LEVEL layout (`planFolderLayout`): each note
   *  is laid out inside its own region, by forces local to it. Absent for
   *  every other map, which lays out exactly as it did. */
  plan?: FolderPlan | null;
}

/**
 * Advance the layout one step, mutating the points in place. Returns the
 * largest per-node speed, for the settle test.
 */
export function stepLayout(input: StepInput): number {
  if (input.plan) return stepTwoLevel(input, input.plan);
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

  // Folderless maps keep their exact, familiar dynamics (the speed limit below
  // is for the container constraint's close pairs), and so does a step without
  // a plan on a map too large for the folder-aware layout (FOLDER_LAYOUT_MAX;
  // the map gives those a plan, above).
  const hasFolders = folderAware(ps.length, folders.length > 0);
  let maxV = 0;
  for (const p of ps) {
    p.vx += (cx - p.x) * GRAVITY * alpha;
    p.vy += (cy - p.y) * GRAVITY * alpha;
    if (pinned === p.id) { p.vx = 0; p.vy = 0; continue; }
    p.vx *= DAMPING; p.vy *= DAMPING;
    if (hasFolders) {
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > FOLDER_MAX_SPEED) { p.vx *= FOLDER_MAX_SPEED / sp; p.vy *= FOLDER_MAX_SPEED / sp; }
    }
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
  /** Move a folder's members TOGETHER. Clamping each member to the world on its
   *  own (`shift`) flattened every member a push drove into a wall onto the SAME
   *  coordinate, so folders pushed apart piled their notes up on the walls. The
   *  shift is limited instead, so the outermost member stops at the wall and the
   *  folder keeps its shape. */
  const shiftGroup = (group: SimPoint[], dx: number, dy: number) => {
    let lo = Infinity, hi = -Infinity, top = Infinity, bottom = -Infinity;
    for (const p of group) {
      if (p.x < lo) lo = p.x;
      if (p.x > hi) hi = p.x;
      if (p.y < top) top = p.y;
      if (p.y > bottom) bottom = p.y;
    }
    const sx = dx < 0 ? Math.max(dx, Math.min(0, minX - lo)) : Math.min(dx, Math.max(0, maxX - hi));
    const sy = dy < 0 ? Math.max(dy, Math.min(0, minY - top)) : Math.min(dy, Math.max(0, maxY - bottom));
    for (const p of group) { p.x += sx; p.y += sy; }
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
        if (hasFolders) {
          shiftGroup(members[i]!, horizontal ? -step * dir : 0, horizontal ? 0 : -step * dir);
          shiftGroup(members[j]!, horizontal ? step * dir : 0, horizontal ? 0 : step * dir);
        } else {
          for (const p of members[i]!) shift(p, horizontal ? -step * dir : 0, horizontal ? 0 : -step * dir);
          for (const p of members[j]!) shift(p, horizontal ? step * dir : 0, horizontal ? 0 : step * dir);
        }
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

// ── Two-level layout (folder maps above FOLDER_LAYOUT_MAX) ─────────────────────
//
// Past a few hundred notes the folder-aware layout above does not converge:
// dozens of containers, each of which must hold its members' NAMES, kept apart
// by a pairwise positional constraint, pinned in by the walls and shoved by an
// uncapped 1/d² repulsion from the whole library. Measured at 2,000 notes in 60
// folders, it came to rest with 340 distinct positions (the old layout: 751) and
// stacks of up to 89 notes — and a stacked dot has no room for a name.
//
// So a large folder map is laid out on two levels. First the FOLDERS, as units:
// each is a rectangle sized for its members and their names, and the rectangles
// are packed — never overlapping, by construction — with linked folders pulled
// towards each other (`planFolderLayout`, once, when the map opens). Then each
// note is laid out INSIDE its own folder's rectangle by forces local to it, and
// held there as a hard constraint (`stepTwoLevel`). The notes in no folder get a
// region of their own. A container is drawn around its members' dots and names
// (`folderRects`), so a region that holds them holds their container too: two
// containers cannot overlap and no note sits in someone else's.

/** Whether a map of `n` notes gets the two-level layout. */
export function twoLevel(n: number, hasFolders: boolean): boolean {
  return hasFolders && n > FOLDER_LAYOUT_MAX;
}

/** One region of a two-level layout: a folder's, or the notes in no folder
 *  (`folderId` null). World coordinates. */
export interface LayoutRegion {
  folderId: string | null;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Its notes, in `ids` order. */
  ids: string[];
}

export interface FolderPlan {
  /** Layout space: the regions and a margin around them. */
  world: { w: number; h: number };
  regions: LayoutRegion[];
  /** The region each note is laid out in. */
  regionOf: Map<string, number>;
  /** Each note's home: a cell of a grid that fills its region, best-connected
   *  notes in the middle. It starts there and is held near it. */
  home: Map<string, { x: number; y: number }>;
}

/** Row pitch of the notes in a region: a dot, and room for its name above or
 *  below it (`folderRects` keeps r + LABEL_GAP + LABEL_H on each side, 26 for
 *  an ordinary note). */
const CELL_H = 56;
/** Room between two names side by side. */
const CELL_GAP_X = 24;
/** A region is this much larger, per axis, than a tight grid of its notes: the
 *  local forces need room to move notes towards the ones they link to. */
const REGION_SLACK = 1.15;
/** Space between two regions. It is also what keeps a big dot clear of the
 *  NEXT container when zoomed out, where a dot's screen-constant size covers
 *  a lot of world. */
export const REGION_GAP = 64;
/** Between a member's footprint (dot and name) and its region's edge: the
 *  container's own padding (`FOLDER_PAD` at 1×, less when zoomed in), and a
 *  little more. */
const REGION_INSET = FOLDER_PAD + 4;
/** Regions are packed into a block about as wide, relative to its height, as
 *  the world the map has always had (w : h = 1 : 0.72) — the shape of a canvas. */
const REGION_ASPECT = 1 / 0.72;
/** How much the packing weighs keeping the whole block small against putting
 *  a region next to the regions it links to. Measured on 600- and 2,000-note
 *  libraries: at 4 the block fills 58–70% of its bounding box (47–59% when
 *  placed by links alone — mostly empty corners) for links between regions
 *  about 7% longer. */
const PACK_COMPACT = 4;
/** Inside a region: the rest length of a link, and the pull of each note
 *  towards its home cell. */
const LOCAL_SPRING_LEN = 120;
const LOCAL_ANCHOR = 0.03;

export interface PlanInput {
  ids: readonly string[];
  folders: readonly FolderInput[];
  edges: readonly { source: string; target: string }[];
  /** Drawn size of each note and its label, as `stepLayout` takes them. */
  radius: (id: string) => number;
  label: (id: string) => string;
}

/**
 * The first level of a two-level layout: where each folder's region goes.
 * Null for a map that does not get one (`twoLevel`) — every other map lays out
 * exactly as it did. Deterministic: a function of the ids, the folders, the
 * links and the names alone.
 */
export function planFolderLayout(input: PlanInput): FolderPlan | null {
  const { ids, folders, edges, radius, label } = input;
  const folderOf = new Map<string, number>();
  folders.forEach((f, fi) => {
    for (const id of f.docIds) if (!folderOf.has(id)) folderOf.set(id, fi);
  });
  const groups: string[][] = folders.map(() => []);
  const loose: string[] = [];
  for (const id of ids) {
    const f = folderOf.get(id);
    if (f == null) loose.push(id);
    else groups[f]!.push(id);
  }
  if (!twoLevel(ids.length, loose.length < ids.length)) return null;

  // One unit per folder with a note on the map (in folder order), then the
  // notes in no folder.
  const units: { folderId: string | null; name: string | null; ids: string[] }[] = [];
  folders.forEach((f, fi) => {
    if (groups[fi]!.length) units.push({ folderId: f.id, name: f.name, ids: groups[fi]! });
  });
  if (loose.length) units.push({ folderId: null, name: null, ids: loose });
  const sizes = units.map((u) => regionSize(u.ids, u.name, radius, label));

  // How many links run between each pair of units.
  const unitOf = new Map<string, number>();
  units.forEach((u, i) => { for (const id of u.ids) unitOf.set(id, i); });
  const links = units.map(() => new Map<number, number>());
  for (const e of edges) {
    const a = unitOf.get(e.source), b = unitOf.get(e.target);
    if (a == null || b == null || a === b) continue;
    links[a]!.set(b, (links[a]!.get(b) ?? 0) + 1);
    links[b]!.set(a, (links[b]!.get(a) ?? 0) + 1);
  }
  const at = packRegions(sizes, links);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  at.forEach((p, i) => {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x + sizes[i]!.w);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y + sizes[i]!.h);
  });
  const margin = PAD + REGION_GAP / 2;
  const regions: LayoutRegion[] = units.map((u, i) => {
    const x0 = at[i]!.x - minX + margin, y0 = at[i]!.y - minY + margin;
    return { folderId: u.folderId, ids: u.ids, x0, y0, x1: x0 + sizes[i]!.w, y1: y0 + sizes[i]!.h };
  });
  const regionOf = new Map<string, number>();
  regions.forEach((r, i) => { for (const id of r.ids) regionOf.set(id, i); });
  // Links inside each region, for where its notes start.
  const near = new Map<string, string[]>();
  for (const e of edges) {
    const g = regionOf.get(e.source);
    if (g == null || e.source === e.target || g !== regionOf.get(e.target)) continue;
    (near.get(e.source) ?? near.set(e.source, []).get(e.source)!).push(e.target);
    (near.get(e.target) ?? near.set(e.target, []).get(e.target)!).push(e.source);
  }
  const home = new Map<string, { x: number; y: number }>();
  for (const r of regions) regionHomes(r, near, radius, label, home);
  return {
    world: { w: Math.ceil(maxX - minX + 2 * margin), h: Math.ceil(maxY - minY + 2 * margin) },
    regions,
    regionOf,
    home,
  };
}

/**
 * Each note of a region gets a cell of a grid that fills the region. Notes are
 * taken breadth-first along the region's own links, starting from its
 * best-connected note, and cells nearest the middle first — so a folder's hub
 * sits in the middle with what it links to around it. A grid is what gives
 * every note room for its NAME: forces alone pack the middle of a cluster
 * densest, and there the names ran through each other.
 */
function regionHomes(
  reg: LayoutRegion,
  near: Map<string, string[]>,
  radius: (id: string) => number,
  label: (id: string) => string,
  out: Map<string, { x: number; y: number }>,
) {
  const m = reg.ids.length;
  const iw = Math.max(1, reg.x1 - reg.x0 - 2 * REGION_INSET), ih = Math.max(1, reg.y1 - reg.y0 - 2 * REGION_INSET);
  const cols = Math.max(1, Math.min(m, Math.round(Math.sqrt((m * iw) / ih))));
  const rows = Math.ceil(m / cols);
  const mx = (cols - 1) / 2, my = (rows - 1) / 2;
  const cells: { c: number; r: number; d: number; a: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Distance from the middle, the grid's aspect taken out; round the cells
      // of a ring clockwise. (Plain arithmetic, no transcendental functions:
      // the order must come out the same on every engine.)
      const dx = (c - mx) / cols, dy = (r - my) / rows;
      cells.push({ c, r, d: dx * dx + dy * dy, a: pseudoAngle(dx, dy) });
    }
  }
  cells.sort((p, q) => p.d - q.d || p.a - q.a || p.r - q.r || p.c - q.c);

  // Breadth-first, best-connected first (ties in `ids` order).
  const index = new Map(reg.ids.map((id, i) => [id, i]));
  const degree = (id: string) => near.get(id)?.length ?? 0;
  const byDegree = [...reg.ids].sort((a, b) => degree(b) - degree(a) || index.get(a)! - index.get(b)!);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const start of byDegree) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue = [start];
    for (let q = 0; q < queue.length; q++) {
      const id = queue[q]!;
      order.push(id);
      const next = (near.get(id) ?? []).filter((n) => !seen.has(n) && index.has(n))
        .sort((a, b) => degree(b) - degree(a) || index.get(a)! - index.get(b)!);
      for (const n of next) { if (!seen.has(n)) { seen.add(n); queue.push(n); } }
    }
  }
  order.forEach((id, i) => {
    const cell = cells[i]!;
    // Off the cell's middle by a fixed, hashed amount: notes with nothing to
    // pull them otherwise rest exactly on the grid, in rows that read as a
    // table rather than a map. (Measured: no fewer names.)
    const x = reg.x0 + REGION_INSET + ((cell.c + 0.5 + HOME_WOBBLE_X * wobble(cell.r, cell.c)) * iw) / cols;
    const y = reg.y0 + REGION_INSET + ((cell.r + 0.5 + HOME_WOBBLE_Y * wobble(cell.c + 7919, cell.r)) * ih) / rows;
    const r = radius(id);
    out.set(id, clampInto(reg, x, y, footHalfW(r, label(id)) + REGION_INSET, footHalfH(r) + REGION_INSET));
  });
}

/** Horizontal half-footprint of a note: its dot, or half its name. The same
 *  measure `folderRects` encloses (at 1×). */
const footHalfW = (r: number, text: string) => Math.max(r, labelWidth(text) / 2);
/** Vertical half-footprint: room for the name above OR below the dot. */
const footHalfH = (r: number) => r + LABEL_GAP + LABEL_H;

/** A region's size: a grid of its notes' footprints, a canvas-shaped block of
 *  them, with slack, and wide enough for the folder's name tab. */
function regionSize(ids: string[], name: string | null, radius: (id: string) => number, label: (id: string) => string) {
  const m = ids.length;
  let widths = 0;
  for (const id of ids) widths += 2 * footHalfW(radius(id), label(id));
  const cw = widths / m + CELL_GAP_X;
  const cols = Math.max(1, Math.min(m, Math.round(Math.sqrt((m * REGION_ASPECT * CELL_H) / cw))));
  const rows = Math.ceil(m / cols);
  let w = cols * cw * REGION_SLACK + 2 * REGION_INSET;
  const h = rows * CELL_H * REGION_SLACK + 2 * REGION_INSET;
  // The container widens to fit its name tab (at most this wide, at 1×).
  if (name != null) w = Math.max(w, folderChipWidth(name) + 2 * FOLDER_CHIP_INSET + 2 * REGION_INSET);
  return { w, h };
}

/**
 * Pack rectangles, largest first, each at the free spot that best balances
 * being next to the rectangles it links to (their link-weighted middle; with
 * none placed yet, the middle of everything placed) against how much it grows
 * the block (its bounding box, canvas-shaped). Candidate spots are flush
 * against a side of a rectangle already placed, so a spot is always found (the
 * right of the rightmost rectangle is free), and a rectangle is only ever put
 * where nothing is: NO two overlap, by construction, with REGION_GAP between
 * them. Returns top-left corners.
 */
function packRegions(sizes: { w: number; h: number }[], links: Map<number, number>[]): { x: number; y: number }[] {
  const order = sizes.map((_, i) => i)
    .sort((a, b) => sizes[b]!.w * sizes[b]!.h - sizes[a]!.w * sizes[a]!.h || a - b);
  const at: ({ x: number; y: number } | null)[] = sizes.map(() => null);
  const placed: number[] = [];
  const G = REGION_GAP;
  let area = 0, sx = 0, sy = 0; // area-weighted middle of what is placed
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity; // …and its bounds
  // The placed rectangles by grid cell, so a spot is tested only against the
  // rectangles near it. Tested against every placed rectangle, planning was
  // cubic in the number of folders: 2.5 s for 1,000 of them. Each rectangle is
  // filed under every cell its gap-widened extent (plus a unit, for rounding)
  // touches, so any rectangle the exact test below would hit is found.
  let side = 0;
  for (const s of sizes) side += Math.sqrt(s.w * s.h);
  const cell = Math.max(G, side / (sizes.length || 1));
  const grid = new Map<number, number[]>();
  const stamp = new Int32Array(sizes.length);
  let query = 0;
  const key = (gx: number, gy: number) => (gx + 1048576) * 2097152 + (gy + 1048576);
  const file = (j: number) => {
    const p = at[j]!, s = sizes[j]!;
    for (let gx = Math.floor((p.x - G - 1) / cell), gx1 = Math.floor((p.x + s.w + G + 1) / cell); gx <= gx1; gx++) {
      for (let gy = Math.floor((p.y - G - 1) / cell), gy1 = Math.floor((p.y + s.h + G + 1) / cell); gy <= gy1; gy++) {
        const list = grid.get(key(gx, gy));
        if (list) list.push(j); else grid.set(key(gx, gy), [j]);
      }
    }
  };
  const free = (x: number, y: number, w: number, h: number) => {
    query++;
    for (let gx = Math.floor(x / cell), gx1 = Math.floor((x + w) / cell); gx <= gx1; gx++) {
      for (let gy = Math.floor(y / cell), gy1 = Math.floor((y + h) / cell); gy <= gy1; gy++) {
        for (const j of grid.get(key(gx, gy)) ?? []) {
          if (stamp[j] === query) continue;
          stamp[j] = query;
          const p = at[j]!, s = sizes[j]!;
          if (x < p.x + s.w + G && x + w + G > p.x && y < p.y + s.h + G && y + h + G > p.y) return false;
        }
      }
    }
    return true;
  };
  for (const i of order) {
    const { w, h } = sizes[i]!;
    if (placed.length) {
      const gx = sx / area, gy = sy / area;
      let tx = 0, ty = 0, tw = 0;
      for (const [j, c] of links[i]!) {
        const p = at[j];
        if (!p) continue;
        tx += c * (p.x + sizes[j]!.w / 2); ty += c * (p.y + sizes[j]!.h / 2); tw += c;
      }
      const dx = tw ? tx / tw : gx, dy = tw ? ty / tw : gy;
      let best: { x: number; y: number } | null = null, bestScore = Infinity;
      const consider = (x: number, y: number) => {
        const cx = x + w / 2, cy = y + h / 2;
        // Distances are measured with y stretched by the aspect, so the block
        // grows canvas-shaped rather than square.
        const span = Math.max(Math.max(bx1, x + w) - Math.min(bx0, x), (Math.max(by1, y + h) - Math.min(by0, y)) * REGION_ASPECT);
        const score = (cx - dx) ** 2 + ((cy - dy) * REGION_ASPECT) ** 2 + PACK_COMPACT * span ** 2;
        if (score < bestScore && free(x, y, w, h)) { bestScore = score; best = { x, y }; }
      };
      for (const j of placed) {
        const p = at[j]!, s = sizes[j]!;
        for (const y of [dy - h / 2, p.y, p.y + s.h - h]) {
          consider(p.x - G - w, y);
          consider(p.x + s.w + G, y);
        }
        for (const x of [dx - w / 2, p.x, p.x + s.w - w]) {
          consider(x, p.y - G - h);
          consider(x, p.y + s.h + G);
        }
      }
      at[i] = best!;
    } else {
      at[i] = { x: -w / 2, y: -h / 2 };
    }
    placed.push(i);
    file(i);
    bx0 = Math.min(bx0, at[i]!.x); by0 = Math.min(by0, at[i]!.y);
    bx1 = Math.max(bx1, at[i]!.x + w); by1 = Math.max(by1, at[i]!.y + h);
    const a = w * h;
    area += a; sx += a * (at[i]!.x + w / 2); sy += a * (at[i]!.y + h / 2);
  }
  return at as { x: number; y: number }[];
}

/** How far a home may sit from its cell's middle, in cells. */
const HOME_WOBBLE_X = 0.3;
const HOME_WOBBLE_Y = 0.2;
/** A deterministic value in [-1, 1) for a pair of integers. */
const wobble = (a: number, b: number) => pairJitter(a, b) * 20;

/** An angle's ORDER without trigonometry: 0 ≤ result < 4, increasing with the
 *  angle of (dx, dy) (the "diamond angle"). */
function pseudoAngle(dx: number, dy: number): number {
  if (!dx && !dy) return 0;
  if (dy >= 0) return dx >= 0 ? dy / (dx + dy) : 1 - dx / (dy - dx);
  return dx < 0 ? 2 - dy / (-dx - dy) : 3 + dx / (dx - dy);
}

/** Where a two-level layout's notes start: at home (`FolderPlan.home`), in
 *  `ids` order (the insertion order `stepLayout` iterates). */
function seedInRegions(ids: readonly string[], plan: FolderPlan): Map<string, SimPoint> {
  const out = new Map<string, SimPoint>();
  for (const id of ids) {
    const p = plan.home.get(id) ?? { x: plan.world.w / 2, y: plan.world.h / 2 };
    out.set(id, { id, x: p.x, y: p.y, vx: 0, vy: 0 });
  }
  return out;
}

/** The nearest point to (x, y) where a note of this footprint lies wholly in
 *  its region, container padding included — for a note being dragged. (Null
 *  when the note has no region.) */
export function clampToRegion(plan: FolderPlan, id: string, x: number, y: number, r: number, text: string) {
  const g = plan.regionOf.get(id);
  if (g == null) return null;
  return clampInto(plan.regions[g]!, x, y, footHalfW(r, text) + REGION_INSET, footHalfH(r) + REGION_INSET);
}

function clampInto(reg: LayoutRegion, x: number, y: number, hw: number, vh: number) {
  const lo = reg.x0 + hw, hi = reg.x1 - hw, top = reg.y0 + vh, bottom = reg.y1 - vh;
  return {
    x: lo <= hi ? Math.max(lo, Math.min(hi, x)) : (reg.x0 + reg.x1) / 2,
    y: top <= bottom ? Math.max(top, Math.min(bottom, y)) : (reg.y0 + reg.y1) / 2,
  };
}

/**
 * One step of the second level: every note moved by forces LOCAL to its
 * region, then held inside it.
 *  - Repulsion and links act only between notes of the SAME region. The
 *    folders' placement already answered where the regions go. A link pulling
 *    across thousands of units only drove notes into their region's wall
 *    (measured at 2,000 notes: three times as many notes on a wall, notes
 *    stacked again, a fifth fewer named at 1×), and the rest of the
 *    library's repulsion changed nothing but the cost of a step, which it
 *    doubled.
 *  - Each note is pulled towards its home cell (`FolderPlan.home`) rather than
 *    towards the middle: pulled to the middle, a cluster packs densest THERE,
 *    and measured at 2,000 notes the names in the middle of the notes in no
 *    folder ran through each other (91% of notes could be named at 1×, 70% in
 *    full; anchored, 99% and 91%).
 *  - A note is held where its dot and name, and its container's padding, lie
 *    wholly inside its region; a container whose name tab widens it past its
 *    region is moved back in as a unit.
 */
function stepTwoLevel(input: StepInput, plan: FolderPlan): number {
  const { positions, edges, folders, world, alpha, pinned = null } = input;
  const radiusOf = input.radius;
  const labelOf = input.label;
  const { regions, regionOf } = plan;
  const ps = Array.from(positions.values());
  const halfW = ps.map((p) => footHalfW(radiusOf(p.id), labelOf(p.id)));
  const members: SimPoint[][] = regions.map(() => []);
  for (const p of ps) {
    const g = regionOf.get(p.id);
    if (g != null) members[g]!.push(p);
  }

  for (const group of members) {
    if (group.length < 2) continue;
    const repulsion = REPULSION * Math.max(1, Math.min(5, group.length / 6)) * alpha;
    if (group.length > BARNES_HUT_MIN) repulseBarnesHut(group, repulsion, BARNES_HUT_THETA);
    else repulseExact(group, repulsion);
  }
  // Names never overlap across a region boundary (each is held inside its own
  // region, with a gap between regions), so the whole map can be one pass.
  separateLabelsGrid(ps, halfW, alpha);
  for (const e of edges) {
    const g = regionOf.get(e.source);
    if (g == null || g !== regionOf.get(e.target)) continue;
    const a = positions.get(e.source), b = positions.get(e.target);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = (d - LOCAL_SPRING_LEN) * SPRING_K * alpha;
    const fx = (dx / d) * f, fy = (dy / d) * f;
    a.vx += fx; a.vy += fy;
    b.vx -= fx; b.vy -= fy;
  }

  let maxV = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]!;
    const g = regionOf.get(p.id);
    const reg = g == null ? null : regions[g]!;
    const at = plan.home.get(p.id) ?? { x: world.w / 2, y: world.h / 2 };
    p.vx += (at.x - p.x) * LOCAL_ANCHOR * alpha;
    p.vy += (at.y - p.y) * LOCAL_ANCHOR * alpha;
    if (pinned === p.id) { p.vx = 0; p.vy = 0; continue; }
    p.vx *= DAMPING; p.vy *= DAMPING;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > FOLDER_MAX_SPEED) { p.vx *= FOLDER_MAX_SPEED / sp; p.vy *= FOLDER_MAX_SPEED / sp; }
    const x = p.x + p.vx, y = p.y + p.vy;
    const r = radiusOf(p.id);
    const to = reg
      ? clampInto(reg, x, y, halfW[i]! + REGION_INSET, footHalfH(r) + REGION_INSET)
      : { x: Math.max(PAD, Math.min(world.w - PAD, x)), y: Math.max(PAD, Math.min(world.h - PAD, y)) };
    // A wall stops the note: velocity into it is spent, not stored.
    if (to.x !== x) p.vx = 0;
    if (to.y !== y) p.vy = 0;
    p.x = to.x; p.y = to.y;
    const v = Math.abs(p.vx) + Math.abs(p.vy);
    if (v > maxV) maxV = v;
  }

  // The container is drawn around its members (`folderRects`); where its name
  // tab makes it wider than they are, it widens about their middle — which can
  // reach past the region when they sit to one side of it. Move them back in.
  const regionOfFolder = new Map<string, LayoutRegion>();
  for (const reg of regions) if (reg.folderId != null) regionOfFolder.set(reg.folderId, reg);
  const boxes = folderBounds({ folders: folders as FolderInput[], positions, radius: radiusOf, label: labelOf, k: 1 });
  for (const b of boxes) {
    const reg = regionOfFolder.get(b.id);
    if (!reg) continue;
    const dx = shiftInto(b.x0, b.x1, reg.x0, reg.x1), dy = shiftInto(b.y0, b.y1, reg.y0, reg.y1);
    if (!dx && !dy) continue;
    for (const id of b.docIds) {
      const p = positions.get(id);
      if (p) { p.x += dx; p.y += dy; }
    }
  }
  return maxV;
}

/** The shift that brings the span [lo, hi] inside [rlo, rhi] — or centres it,
 *  if it is the wider (a region is sized for its name tab, so only a name
 *  lengthened since the map opened can make it so). */
function shiftInto(lo: number, hi: number, rlo: number, rhi: number) {
  if (hi - lo > rhi - rlo) return (rlo + rhi - lo - hi) / 2;
  return lo < rlo ? rlo - lo : hi > rhi ? rhi - hi : 0;
}

/** Exact all-pairs repulsion alone (the small-map loop's force law and
 *  tie-break, without its label term) — for one region's notes. */
function repulseExact(ps: SimPoint[], repulsion: number) {
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
    }
  }
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
