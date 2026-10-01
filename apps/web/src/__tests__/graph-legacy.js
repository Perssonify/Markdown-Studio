/**
 * The relationship map's layout and placement code AS IT WAS before the A088
 * scale work — copied verbatim (types stripped), so the tests can prove the
 * rewritten versions give a small map the SAME answer, bit for bit. Not a test
 * file (vitest only collects *.test.js); imported by graph-physics.test.js and
 * graph-metrics.test.js. Do not "fix" anything here: its only job is to be the
 * old behaviour.
 */
import {
  folderChipLabel,
  folderChipWidth,
  labelWidth,
  shortLabel,
  FOLDER_CHIP_H,
  FOLDER_CHIP_INSET,
  FOLDER_PAD,
  LABEL_GAP,
  LABEL_H,
} from "../store/graph-metrics";

const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const inside = (outer, inner) =>
  inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1;

/** graph-metrics.ts `placeLabels`, before the spatial index. */
export function legacyPlaceLabels(opts) {
  const { order, forced, positions, radius, label, cam, obstacles = [], bounds, reject, limit } = opts;
  const boxes = [...obstacles];
  const out = new Map();
  const forcedSet = forced ?? new Set();
  const max = limit == null ? order.length : Math.min(order.length, limit + forcedSet.size);

  for (let i = 0; i < max; i++) {
    const id = order[i];
    const p = positions.get(id);
    if (!p) continue;
    const text = label(id);
    if (!text) continue;
    const r = radius(id);
    const sx = p.x * cam.k + cam.tx;
    const sy = p.y * cam.k + cam.ty;
    const half = LABEL_H / 2;
    const forms = [text, shortLabel(text)];
    let done = false;
    for (const form of forms) {
      const w = labelWidth(form);
      const candidates = [
        {
          box: { x0: sx - w / 2, y0: sy + r + LABEL_GAP, x1: sx + w / 2, y1: sy + r + LABEL_GAP + LABEL_H },
          place: { dx: 0, dy: r + LABEL_GAP + LABEL_H - 4, anchor: "middle", text: form },
        },
        {
          box: { x0: sx - w / 2, y0: sy - r - LABEL_GAP - LABEL_H, x1: sx + w / 2, y1: sy - r - LABEL_GAP },
          place: { dx: 0, dy: -r - LABEL_GAP - 4, anchor: "middle", text: form },
        },
        {
          box: { x0: sx + r + LABEL_GAP, y0: sy - half, x1: sx + r + LABEL_GAP + w, y1: sy + half },
          place: { dx: r + LABEL_GAP, dy: 4, anchor: "start", text: form },
        },
        {
          box: { x0: sx - r - LABEL_GAP - w, y0: sy - half, x1: sx - r - LABEL_GAP, y1: sy + half },
          place: { dx: -r - LABEL_GAP, dy: 4, anchor: "end", text: form },
        },
      ];
      for (const c of candidates) {
        if (bounds && !inside(bounds, c.box)) continue;
        if (boxes.some((o) => overlaps(c.box, o))) continue;
        if (reject?.(id, c.box)) continue;
        boxes.push(c.box);
        out.set(id, c.place);
        done = true;
        break;
      }
      if (done || form === forms[1]) break;
    }
  }
  return out;
}

/** graph-metrics.ts `folderRects`, before the spatial index and the split. */
export function legacyFolderRects(opts) {
  const { folders, positions, radius, label, k, avoid = [] } = opts;
  const out = [];
  const chips = [];
  const gs = 1 / Math.max(k, 1);

  for (const folder of folders) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let any = false;
    for (const id of folder.docIds) {
      const p = positions.get(id);
      if (!p) continue;
      any = true;
      const r = radius(id);
      const hw = Math.max(r, labelWidth(label(id)) / 2) * gs;
      const vh = (r + LABEL_GAP + LABEL_H) * gs;
      if (p.x - hw < x0) x0 = p.x - hw;
      if (p.x + hw > x1) x1 = p.x + hw;
      if (p.y - vh < y0) y0 = p.y - vh;
      if (p.y + vh > y1) y1 = p.y + vh;
    }
    if (!any) continue;

    const pad = FOLDER_PAD * gs;
    x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;

    const name = folder.name;
    const budget = Math.max(46, (x1 - x0) * k * 1.9);
    const maxChars = Math.floor((budget - 20) / 7);
    const labelText = folderChipLabel(name, maxChars);
    const chipW = folderChipWidth(name, maxChars) / k;
    const chipH = FOLDER_CHIP_H / k;
    const inset = FOLDER_CHIP_INSET * gs;
    const shortfall = folderChipWidth(name, maxChars) * gs + 2 * inset - (x1 - x0);
    if (shortfall > 0) { x0 -= shortfall / 2; x1 += shortfall / 2; }

    const slot = (sx, sy) => ({ x0: sx, y0: sy - chipH / 2, x1: sx + chipW, y1: sy + chipH / 2 });
    const left = x0 + inset, right = x1 - inset - chipW;
    const candidates = [];
    const rows = [y0, y1, y0 - chipH, y1 + chipH];
    const stops = [0, 1, 0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875];
    for (const y of rows) {
      for (const t of stops) {
        candidates.push(slot(left + (right - left) * t, y));
      }
    }
    const area = (c, o) =>
      Math.max(0, Math.min(c.x1, o.x1) - Math.max(c.x0, o.x0))
      * Math.max(0, Math.min(c.y1, o.y1) - Math.max(c.y0, o.y0));
    let chip = candidates[0];
    let best = Infinity;
    for (const c of candidates) {
      if (chips.some((o) => overlaps(c, o))) continue;
      let score = 0;
      for (const o of avoid) score += area(c, o);
      if (score < best) { best = score; chip = c; }
      if (score === 0) break;
    }
    chips.push(chip);

    out.push({ id: folder.id, name, label: labelText, docIds: folder.docIds, x0, y0, x1, y1, chip });
  }
  return out;
}

// ── GraphView.tsx `stepOnce`, before the physics moved to graph-physics.ts ──
const PAD = 40;
const REPULSION = 1400;
const SPRING_K = 0.02;
const GRAVITY = 0.015;
const FOLDER_COHESION = 0.09;
const TEXT_SEPARATION = 0.05;
const TEXT_ROOM_Y = 34;
const FOLDER_GAP = 44;
const FOLDER_SLACK = 6;
const DAMPING = 0.82;
export const LEGACY_ALPHA_DECAY = 0.965;

/**
 * One step, as the component ran it. `sim` stands in for the component's refs:
 * `{ pos: Map<id, Pt>, edges, folders, world: {w, h}, alpha, meta: {radius: Map,
 * label: Map}, dragId }`. Mutates `sim.pos` in place and decays `sim.alpha`.
 */
export function legacyStep(sim) {
  const posRef = { current: sim.pos };
  const graphRef = { current: { edges: sim.edges } };
  const foldersRef = { current: sim.folders };
  const worldRef = { current: sim.world };
  const alphaRef = { current: sim.alpha };
  const metaRef = { current: sim.meta };
  const dragRef = { current: sim.dragId ? { id: sim.dragId } : null };

  const ps = Array.from(posRef.current.values());
  const edges = graphRef.current.edges;
  const { w, h } = worldRef.current;
  const cx = w / 2, cy = h / 2;
  const alpha = alphaRef.current;
  const spread = Math.max(1, Math.min(5, ps.length / 6));
  const repulsion = REPULSION * spread * alpha;
  const springLen = Math.max(70, Math.min(170, Math.min(w, h) / 4));
  const minX = PAD, maxX = Math.max(PAD + 1, w - PAD);
  const minY = PAD, maxY = Math.max(PAD + 1, h - PAD);

  const meta = metaRef.current;
  const radiusOf = (id) => meta.radius.get(id) ?? 7;
  const labelOf = (id) => meta.label.get(id) ?? "";
  const halfW = ps.map((p) => Math.max(radiusOf(p.id), labelWidth(labelOf(p.id)) / 2));

  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      // The ONE deliberate departure, and only when the caller asks for it: the
      // old tie-break for two notes on the same spot was Math.random(), which
      // makes this reference itself unrepeatable (notes stacked against a world
      // wall hit it routinely in the first steps). `sim.jitter` substitutes the
      // new deterministic tie-break so everything else can be compared exactly.
      if (d2 < 1) {
        d2 = 1;
        if (sim.jitter) { dx = sim.jitter(i, j); dy = sim.jitter(j, i); if (sim.coincident) sim.coincident.n++; }
        else { dx = (Math.random() - 0.5) * 0.1; dy = (Math.random() - 0.5) * 0.1; }
      }
      const d = Math.sqrt(d2);
      const f = repulsion / d2;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx -= fx; a.vy -= fy;
      b.vx += fx; b.vy += fy;
      const needX = halfW[i] + halfW[j];
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
  for (const e of edges) {
    const a = posRef.current.get(e.source), b = posRef.current.get(e.target);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = (d - springLen) * SPRING_K * alpha;
    const fx = (dx / d) * f, fy = (dy / d) * f;
    a.vx += fx; a.vy += fy;
    b.vx -= fx; b.vy -= fy;
  }
  for (const folder of foldersRef.current) {
    if (folder.docIds.length < 2) continue;
    const pts = [];
    let fcx = 0, fcy = 0;
    for (const id of folder.docIds) {
      const p = posRef.current.get(id);
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
    if (dragRef.current?.id === p.id) { p.vx = 0; p.vy = 0; continue; }
    p.vx *= DAMPING; p.vy *= DAMPING;
    p.x = Math.max(minX, Math.min(maxX, p.x + p.vx));
    p.y = Math.max(minY, Math.min(maxY, p.y + p.vy));
    const v = Math.abs(p.vx) + Math.abs(p.vy);
    if (v > maxV) maxV = v;
  }

  const clusterRects = () => legacyFolderRects({
    folders: foldersRef.current,
    positions: posRef.current,
    radius: radiusOf,
    label: labelOf,
    k: 1,
  });
  const shift = (p, dx, dy) => {
    p.x = Math.max(minX, Math.min(maxX, p.x + dx));
    p.y = Math.max(minY, Math.min(maxY, p.y + dy));
  };
  for (let pass = 0; pass < 3; pass++) {
    const rects = clusterRects();
    if (!rects.length) break;
    const members = rects.map((r) => r.docIds.map((id) => posRef.current.get(id)).filter((q) => !!q));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const A = rects[i], B = rects[j];
        const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0) + FOLDER_GAP;
        const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0) + FOLDER_GAP;
        if (ox <= 0 || oy <= 0) continue;
        const horizontal = ox <= oy;
        const dir = horizontal
          ? ((A.x0 + A.x1) <= (B.x0 + B.x1) ? 1 : -1)
          : ((A.y0 + A.y1) <= (B.y0 + B.y1) ? 1 : -1);
        const step = (horizontal ? ox : oy) / 2;
        for (const p of members[i]) shift(p, horizontal ? -step * dir : 0, horizontal ? 0 : -step * dir);
        for (const p of members[j]) shift(p, horizontal ? step * dir : 0, horizontal ? 0 : step * dir);
      }
    }
    for (const p of ps) {
      const hw = Math.max(radiusOf(p.id), labelWidth(labelOf(p.id)) / 2) + FOLDER_SLACK;
      const vh = radiusOf(p.id) + LABEL_GAP + LABEL_H + FOLDER_SLACK;
      const violating = rects.filter((rect, i) =>
        !members[i].some((q) => q.id === p.id)
        && p.x + hw > rect.x0 && p.x - hw < rect.x1
        && p.y + vh > rect.y0 && p.y - vh < rect.y1
      );
      if (!violating.length) continue;
      const own = new Set();
      rects.forEach((rect, i) => { if (members[i].some((q) => q.id === p.id)) own.add(rect.id); });
      const inAny = (x, y) => rects.some((rect) =>
        !own.has(rect.id)
        && x + hw > rect.x0 && x - hw < rect.x1 && y + vh > rect.y0 && y - vh < rect.y1
      );
      const rect = violating[0];
      const exits = [
        { dx: -(p.x + hw - rect.x0), dy: 0, d: p.x + hw - rect.x0 },
        { dx: rect.x1 - (p.x - hw), dy: 0, d: rect.x1 - (p.x - hw) },
        { dx: 0, dy: -(p.y + vh - rect.y0), d: p.y + vh - rect.y0 },
        { dx: 0, dy: rect.y1 - (p.y - vh), d: rect.y1 - (p.y - vh) },
      ].sort((a, b) => a.d - b.d);
      const best = exits.find((e) => !inAny(p.x + e.dx, p.y + e.dy)) ?? exits[0];
      shift(p, best.dx, best.dy);
    }
  }

  sim.alpha = alpha * LEGACY_ALPHA_DECAY;
  return maxV;
}
