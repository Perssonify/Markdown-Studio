import { describe, it, expect } from "vitest";
import { arrowD, BATCH_UNITS, circleD, edgeD, edgeGeometry, parseCircles } from "../store/graph-draw";

/** The per-element link geometry, as GraphView's small-map renderer computes it. */
function elementGeometry(a, b, r1, r2, twoWay) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  if (d <= r1 + r2) return null;
  const x1 = a.x + ux * r1, y1 = a.y + uy * r1;
  const x2 = b.x - ux * r2, y2 = b.y - uy * r2;
  return twoWay
    ? { x1, y1, x2, y2, qx: (x1 + x2) / 2 - uy * d * 0.11, qy: (y1 + y2) / 2 + ux * d * 0.11 }
    : { x1, y1, x2, y2 };
}

/** Absolute points of a batched path (M/L/Q/A endpoints; relative steps summed), in world units. */
function points(d) {
  const out = [];
  let x = 0, y = 0;
  const re = /([MlqaAz])([^MlqaAz]*)/g;
  for (let m = re.exec(d); m; m = re.exec(d)) {
    const n = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (m[1] === "M") { x = n[0]; y = n[1]; out.push([x, y]); }
    else if (m[1] === "l") { x += n[0]; y += n[1]; out.push([x, y]); }
    else if (m[1] === "q") { out.push([x + n[0], y + n[1]]); x += n[2]; y += n[3]; out.push([x, y]); }
  }
  return out.map(([px, py]) => [px / BATCH_UNITS, py / BATCH_UNITS]);
}

const EPS = 0.011; // a hundredth of a world unit, plus rounding

describe("batched link geometry", () => {
  const a = { x: 120.37, y: 80.91 }, b = { x: 911.2, y: 433.05 };

  it("is the geometry the per-element renderer draws", () => {
    for (const twoWay of [false, true]) {
      const g = edgeGeometry(a, b, 9 / 0.4, 16 / 0.4, twoWay);
      const e = elementGeometry(a, b, 9 / 0.4, 16 / 0.4, twoWay);
      for (const key of Object.keys(e)) expect(g[key]).toBe(e[key]);
    }
    // Too close for a visible segment: drawn nowhere, in either renderer.
    expect(edgeGeometry(a, { x: a.x + 5, y: a.y }, 10, 10, false)).toBeNull();
  });

  it("writes path data whose points are that geometry", () => {
    const straight = edgeGeometry(a, b, 20, 30, false);
    const [p0, p1] = points(edgeD(straight));
    expect(Math.abs(p0[0] - straight.x1)).toBeLessThan(EPS);
    expect(Math.abs(p0[1] - straight.y1)).toBeLessThan(EPS);
    expect(Math.abs(p1[0] - straight.x2)).toBeLessThan(EPS);
    expect(Math.abs(p1[1] - straight.y2)).toBeLessThan(EPS);

    const bowed = edgeGeometry(a, b, 20, 30, true);
    const [q0, qc, q1] = points(edgeD(bowed));
    expect(Math.abs(q0[0] - bowed.x1)).toBeLessThan(EPS);
    expect(Math.abs(qc[0] - bowed.qx)).toBeLessThan(EPS);
    expect(Math.abs(qc[1] - bowed.qy)).toBeLessThan(EPS);
    expect(Math.abs(q1[1] - bowed.y2)).toBeLessThan(EPS);
  });

  it("points a bowed link's arrow along the curve's own end, not the chord", () => {
    const g = edgeGeometry(a, b, 20, 30, true);
    const ex = g.x2 - g.qx, ey = g.y2 - g.qy, el = Math.hypot(ex, ey);
    expect(g.tx).toBeCloseTo(ex / el, 12);
    expect(g.ty).toBeCloseTo(ey / el, 12);
  });
});

describe("batched arrowheads", () => {
  it("are the marker's triangle: 9px wide, reference point (9,5) on the tip, turned to the link", () => {
    // <marker viewBox="0 0 10 10" refX=9 refY=5 markerWidth=9/k> drawing
    // M0,0 L10,5 L0,10 z, oriented along the direction of travel.
    for (const k of [0.3, 1, 2.4]) {
      const angle = 0.7, tx = Math.cos(angle), ty = Math.sin(angle);
      const x = 500, y = 300, s = 0.9 / k;
      const marker = [[0, 0], [10, 5], [0, 10]].map(([u, v]) => {
        const du = (u - 9) * s, dv = (v - 5) * s;
        return [x + du * tx - dv * ty, y + du * ty + dv * tx];
      });
      const drawn = points(arrowD(x, y, tx, ty, k));
      expect(drawn).toHaveLength(3);
      drawn.forEach((p, i) => {
        expect(Math.abs(p[0] - marker[i][0])).toBeLessThan(EPS);
        expect(Math.abs(p[1] - marker[i][1])).toBeLessThan(EPS);
      });
    }
  });
});

describe("batched dots", () => {
  it("round-trip through the path data, so a batched layer stays measurable", () => {
    const dots = [{ x: 10.5, y: 20.25, r: 7 }, { x: 1999.99, y: 1.01, r: 17 / 0.3 }, { x: 640, y: 480, r: 2.33 }];
    const back = parseCircles(dots.map((c) => circleD(c.x, c.y, c.r)).join(""));
    expect(back).toHaveLength(dots.length);
    back.forEach((c, i) => {
      expect(Math.abs(c.x - dots[i].x)).toBeLessThan(EPS);
      expect(Math.abs(c.y - dots[i].y)).toBeLessThan(EPS);
      expect(Math.abs(c.r - dots[i].r)).toBeLessThan(EPS);
    });
  });

  it("start at 3 o'clock like <circle>, so a dash pattern starts where it does there", () => {
    const [start] = points(circleD(100, 50, 8));
    expect(start[0]).toBeCloseTo(108, 2);
    expect(start[1]).toBeCloseTo(50, 2);
  });
});
