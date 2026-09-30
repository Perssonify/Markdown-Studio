/**
 * graph-draw.ts — path data for the relationship map's BATCHED layers.
 *
 * A small map draws every note, link and arrowhead as its own SVG element. At
 * library scale that is the cost: 2,000 notes and ~4,000 links were ~10,000
 * elements, every one of them rewritten on every frame of the layout and every
 * step of a zoom, and the browser restyles each rewritten element (measured
 * ~60-70µs apiece under 4× CPU throttling). A large map draws the ordinary
 * dots, links and arrowheads as a handful of `<path>`s instead; this module
 * turns positions into their path data. Pure, so the geometry is testable and
 * identical to what the per-element renderer draws.
 *
 * Input coordinates are WORLD units (inside the camera group); sizes that must
 * stay constant on screen are passed in already divided by the zoom (`k`).
 * OUTPUT is in integer hundredths of a world unit, relative after the first
 * point of each shape: the layer that draws it is scaled by 1/BATCH_UNITS.
 * Integers format several times faster than fractions (a batched rebuild runs
 * on every zoom step and every paint of a moving layout), relative steps keep
 * the strings short, and a hundredth of a world unit is 0.03px at the deepest
 * zoom.
 */

/** Path units per world unit; the batched layer is drawn at scale(1/BATCH_UNITS). */
export const BATCH_UNITS = 100;
const I = (v: number) => Math.round(v * BATCH_UNITS);

export interface EdgeGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Control point when the link is one of a reciprocal pair (drawn bowed). */
  qx?: number;
  qy?: number;
  /** Unit direction of travel at the arrow tip. */
  tx: number;
  ty: number;
}

/**
 * A link's drawn segment: trimmed to the two node borders (`r1`/`r2`, world
 * units) so the arrowhead lands on the target's edge, and — for a reciprocal
 * pair — bowed to the left of its own direction of travel. Null when the notes
 * are too close for a visible segment. Mirrors the per-element renderer.
 */
export function edgeGeometry(
  a: { x: number; y: number }, b: { x: number; y: number },
  r1: number, r2: number, twoWay: boolean
): EdgeGeometry | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  if (d <= r1 + r2) return null;
  const x1 = a.x + ux * r1, y1 = a.y + uy * r1;
  const x2 = b.x - ux * r2, y2 = b.y - uy * r2;
  if (!twoWay) return { x1, y1, x2, y2, tx: ux, ty: uy };
  const qx = (x1 + x2) / 2 - uy * d * 0.11, qy = (y1 + y2) / 2 + ux * d * 0.11;
  const ex = x2 - qx, ey = y2 - qy;
  const el = Math.hypot(ex, ey) || 1;
  return { x1, y1, x2, y2, qx, qy, tx: ex / el, ty: ey / el };
}

/** Path data for one link. */
export function edgeD(g: EdgeGeometry): string {
  const X1 = I(g.x1), Y1 = I(g.y1), X2 = I(g.x2), Y2 = I(g.y2);
  if (g.qx === undefined) return "M" + X1 + "," + Y1 + "l" + (X2 - X1) + "," + (Y2 - Y1);
  return "M" + X1 + "," + Y1 + "q" + (I(g.qx) - X1) + "," + (I(g.qy!) - Y1) + " " + (X2 - X1) + "," + (Y2 - Y1);
}

/**
 * The arrowhead the per-element renderer gets from its `<marker>`: a 10×10
 * triangle (0,0 → 10,5 → 0,10) drawn 9 screen px wide with its reference point
 * (9,5) on the tip of the link, turned to the direction of travel.
 */
export function arrowD(x: number, y: number, tx: number, ty: number, k: number): string {
  const s = 0.9 / k;
  // Marker (u, v) → world: along the direction of travel, and across it.
  const ax = I(x + s * (-9 * tx + 5 * ty)), ay = I(y + s * (-9 * ty - 5 * tx));
  const bx = I(x + s * tx), by = I(y + s * ty);
  const cx = I(x + s * (-9 * tx - 5 * ty)), cy = I(y + s * (-9 * ty + 5 * tx));
  return "M" + ax + "," + ay + "l" + (bx - ax) + "," + (by - ay) + "l" + (cx - bx) + "," + (cy - by) + "z";
}

/** A full circle as path data — starting at 3 o'clock and running clockwise,
 *  like the `<circle>` element, so a dash pattern starts where it does there. */
export function circleD(x: number, y: number, r: number): string {
  const X0 = I(x + r), X1 = I(x - r), Y = I(y), R = I(r);
  return "M" + X0 + "," + Y + "a" + R + "," + R + " 0 1 1 " + (X1 - X0) + ",0a" + R + "," + R + " 0 1 1 " + (X0 - X1) + ",0z";
}

/**
 * Read the circles back out of `circleD` path data, in order, in WORLD units —
 * so a measurement (the e2e overlap probe, the unit tests) can recover the exact
 * dot geometry of a batched layer the way it reads `<circle>` elements on a
 * small map.
 */
export function parseCircles(d: string): { x: number; y: number; r: number }[] {
  const out: { x: number; y: number; r: number }[] = [];
  const re = /M(-?\d+),(-?\d+)a(\d+),\d+ 0 1 1 (-?\d+),0/g;
  for (let m = re.exec(d); m; m = re.exec(d)) {
    const x0 = Number(m[1]), span = Number(m[4]);
    out.push({ x: (x0 + span / 2) / BATCH_UNITS, y: Number(m[2]) / BATCH_UNITS, r: Number(m[3]) / BATCH_UNITS });
  }
  return out;
}
