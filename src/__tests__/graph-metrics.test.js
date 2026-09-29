import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import {
  findOrphans,
  matchNodes,
  neighborIds,
  brokenLinks,
  brokenSourceIds,
  placeLabels,
  rankByDegree,
  folderRects,
  folderBounds,
  folderChipLabel,
  labelBoxAt,
  labelWidth,
  stepsPerFrame,
  isLargeMap,
  planFrame,
  PAINT_EVERY_MS,
  SLICE_MS,
  CAMERA_HOLD_MS,
  LARGE_MAP_MIN,
  BoxGrid,
} from "../store/graph-metrics";
import { legacyFolderRects, legacyPlaceLabels } from "./graph-legacy";

const nodes = [
  { id: "a", title: "Alpha", backlinks: 0, forwardLinks: 0 },
  { id: "b", title: "Beta note", backlinks: 2, forwardLinks: 0 },
  { id: "c", title: "Gamma", backlinks: 0, forwardLinks: 1 },
  { id: "d", title: "Delta" }, // undefined counts → treated as 0 (orphan)
];

describe("findOrphans", () => {
  it("flags nodes with no inbound and no outbound links", () => {
    const o = findOrphans(nodes);
    expect(o.has("a")).toBe(true);
    expect(o.has("d")).toBe(true); // undefined counts default to 0
  });
  it("does not flag a node with only backlinks or only forward links", () => {
    const o = findOrphans(nodes);
    expect(o.has("b")).toBe(false);
    expect(o.has("c")).toBe(false);
  });
  it("returns an empty set for empty input", () => {
    expect(findOrphans([]).size).toBe(0);
  });
});

describe("matchNodes", () => {
  it("matches case-insensitively on title", () => {
    expect([...matchNodes(nodes, "alpha")]).toEqual(["a"]);
    expect([...matchNodes(nodes, "ALPHA")]).toEqual(["a"]);
  });
  it("matches a substring, not just a prefix", () => {
    expect([...matchNodes(nodes, "note")]).toEqual(["b"]);
  });
  it("falls back to matching the id", () => {
    expect(matchNodes(nodes, "c").has("c")).toBe(true);
  });
  it("returns an empty set for a blank/whitespace query", () => {
    expect(matchNodes(nodes, "").size).toBe(0);
    expect(matchNodes(nodes, "   ").size).toBe(0);
  });
  it("returns an empty set when nothing matches", () => {
    expect(matchNodes(nodes, "zzz").size).toBe(0);
  });
});

describe("neighborIds", () => {
  const edges = [
    { source: "a", target: "b" },
    { source: "c", target: "a" },
    { source: "a", target: "a" }, // self edge — must be excluded
    { source: "b", target: "a" }, // duplicate neighbor (b) via reverse dir
  ];
  it("collects neighbors in both directions, deduped, excluding self", () => {
    const n = neighborIds(edges, "a");
    expect(n.has("b")).toBe(true);
    expect(n.has("c")).toBe(true);
    expect(n.has("a")).toBe(false);
    expect(n.size).toBe(2);
  });
  it("returns an empty set for an unknown id", () => {
    expect(neighborIds(edges, "zzz").size).toBe(0);
  });
});

describe("brokenLinks / brokenSourceIds", () => {
  const unresolved = new Map([
    ["d2", [{ target: "Missing", displayText: "Missing" }]],
    ["d1", [
      { target: "Ghost", displayText: "Ghost" },
      { target: "Nope", displayText: "the nope" },
    ]],
    ["d3", []], // empty list → not a broken source
  ]);
  it("flattens unresolved into a deterministically ordered list", () => {
    const list = brokenLinks(unresolved);
    expect(list).toEqual([
      { sourceId: "d1", target: "Ghost", displayText: "Ghost" },
      { sourceId: "d1", target: "Nope", displayText: "the nope" },
      { sourceId: "d2", target: "Missing", displayText: "Missing" },
    ]);
  });
  it("collects source ids with at least one broken link", () => {
    const s = brokenSourceIds(unresolved);
    expect(s.has("d1")).toBe(true);
    expect(s.has("d2")).toBe(true);
    expect(s.has("d3")).toBe(false);
  });
  it("handles empty/undefined input", () => {
    expect(brokenLinks(undefined)).toEqual([]);
    expect(brokenLinks(new Map())).toEqual([]);
    expect(brokenSourceIds(undefined).size).toBe(0);
  });
});

describe("rankByDegree", () => {
  const ranked = [
    { id: "a", title: "Alpha", backlinks: 0, forwardLinks: 0 },
    { id: "b", title: "Beta", backlinks: 3, forwardLinks: 1 },
    { id: "c", title: "Gamma", backlinks: 1, forwardLinks: 0 },
    { id: "d", title: "Delta", backlinks: 0, forwardLinks: 1 },
  ];
  it("orders by total degree, highest first", () => {
    // c and d tie at degree 1, so "Delta" sorts ahead of "Gamma".
    expect(rankByDegree(ranked).map((n) => n.id)).toEqual(["b", "d", "c"]);
    expect(rankByDegree(ranked)[0]).toEqual({ id: "b", title: "Beta", degree: 4 });
  });
  it("drops zero-degree notes — those are orphans, not weak connections", () => {
    expect(rankByDegree(ranked).some((n) => n.id === "a")).toBe(false);
  });
  it("breaks ties by title so the order is stable across renders", () => {
    const tied = [
      { id: "z", title: "Zulu", backlinks: 1, forwardLinks: 0 },
      { id: "m", title: "Mike", backlinks: 1, forwardLinks: 0 },
    ];
    expect(rankByDegree(tied).map((n) => n.id)).toEqual(["m", "z"]);
  });
  it("honours the limit, and returns everything for a negative one", () => {
    expect(rankByDegree(ranked, 2)).toHaveLength(2);
    expect(rankByDegree(ranked, -1)).toHaveLength(3);
  });
});

describe("placeLabels", () => {
  const cam = { k: 1, tx: 0, ty: 0 };
  const base = {
    radius: () => 8,
    label: (id) => id,
    cam,
  };
  const ids = (m) => [...m.keys()].sort();

  it("labels well-separated nodes, below the dot by default", () => {
    const positions = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 400, y: 400 }],
    ]);
    const out = placeLabels({ ...base, order: ["a", "b"], positions });
    expect(ids(out)).toEqual(["a", "b"]);
    expect(out.get("a").anchor).toBe("middle");
    expect(out.get("a").dy).toBeGreaterThan(0);
  });

  it("moves a colliding label to another side instead of dropping it", () => {
    // Two dots side by side: "below" collides, so the second label goes
    // somewhere else rather than vanishing.
    const positions = new Map([
      ["aaaaaaaa", { x: 100, y: 100 }],
      ["bbbbbbbb", { x: 112, y: 100 }],
    ]);
    const out = placeLabels({ ...base, order: ["aaaaaaaa", "bbbbbbbb"], positions });
    expect(ids(out)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
    const a = out.get("aaaaaaaa"), b = out.get("bbbbbbbb");
    expect(`${a.dx},${a.dy},${a.anchor}`).not.toBe(`${b.dx},${b.dy},${b.anchor}`);
  });

  it("never draws a label over a reserved box (folder chips draw over the map)", () => {
    const positions = new Map([["a", { x: 100, y: 100 }]]);
    // Blanket the four candidate positions around the dot.
    const obstacles = [{ x0: 0, y0: 0, x1: 300, y1: 300 }];
    expect(placeLabels({ ...base, order: ["a"], positions, obstacles }).size).toBe(0);
    expect(placeLabels({ ...base, order: ["a"], positions }).size).toBe(1);
  });

  it("falls back to a compact form before giving up on a name", () => {
    const positions = new Map([["a", { x: 100, y: 100 }]]);
    const long = "a very long note title indeed";
    // A corridor wide enough for the short form but not the full one.
    const w = labelWidth(long);
    const obstacles = [
      { x0: 100 + w / 2 - 20, y0: 0, x1: 400, y1: 300 },
      { x0: -200, y0: 0, x1: 100 - w / 2 + 20, y1: 300 },
    ];
    const out = placeLabels({ ...base, order: ["a"], positions, label: () => long, obstacles });
    expect(out.get("a").text.length).toBeLessThan(long.length);
    expect(out.get("a").text.endsWith("…")).toBe(true);
  });

  it("keeps labels inside the given bounds", () => {
    const positions = new Map([["a", { x: 5, y: 5 }]]);
    expect(placeLabels({ ...base, order: ["a"], positions, bounds: { x0: 0, y0: 0, x1: 600, y1: 400 } }).size).toBe(0);
    expect(placeLabels({ ...base, order: ["a"], positions }).size).toBe(1);
  });

  it("honours a per-id veto (a name must not cross a foreign container)", () => {
    const positions = new Map([["a", { x: 100, y: 100 }]]);
    const reject = (id) => id === "a";
    expect(placeLabels({ ...base, order: ["a"], positions, reject }).size).toBe(0);
  });

  it("thins labels out as the camera zooms out, and restores them zoomed in", () => {
    // Ten notes in a row with long names. At 1× there is room for every name;
    // squeezed to 0.08× the four candidate positions and the compact form run
    // out, and the map thins rather than overlapping.
    const order = Array.from({ length: 10 }, (_, i) => `n${i}`);
    const positions = new Map(order.map((id, i) => [id, { x: i * 90, y: 0 }]));
    const opts = { ...base, order, positions, label: () => "a fairly long note name" };
    expect(placeLabels({ ...opts, cam: { k: 1, tx: 0, ty: 0 } }).size).toBe(10);
    expect(placeLabels({ ...opts, cam: { k: 0.08, tx: 0, ty: 0 } }).size).toBeLessThan(10);
  });

  it("skips ids with no position and stops at the limit", () => {
    const positions = new Map([["a", { x: 0, y: 0 }], ["c", { x: 500, y: 500 }]]);
    const out = placeLabels({ ...base, order: ["a", "b", "c"], positions, limit: 2 });
    expect(ids(out)).toEqual(["a"]); // "b" has no position and consumes a slot
  });

  it("reports a box matching the placement it returned", () => {
    const positions = new Map([["hello", { x: 50, y: 50 }]]);
    const place = placeLabels({ ...base, order: ["hello"], positions }).get("hello");
    const box = labelBoxAt(50, 50, place);
    expect(box.x1 - box.x0).toBeCloseTo(labelWidth("hello"), 5);
    expect(box.y0).toBeGreaterThan(50);
  });
});

describe("folderRects", () => {
  const positions = new Map([
    ["a", { x: 100, y: 100 }],
    ["b", { x: 200, y: 100 }],
    ["far", { x: 900, y: 900 }],
  ]);
  const base = { positions, radius: () => 8, label: (id) => id, k: 1 };
  const folder = { id: "f", name: "Work", docIds: ["a", "b"] };

  it("encloses each member's dot AND its label", () => {
    const [r] = folderRects({ ...base, folders: [folder] });
    // "a" is 1 character, but the label box is wider than the dot.
    expect(r.x0).toBeLessThan(100 - 8);
    expect(r.y1).toBeGreaterThan(100 + 8 + 15);
    expect(r.docIds).toEqual(["a", "b"]);
  });

  it("skips a folder with no positioned members", () => {
    expect(folderRects({ ...base, folders: [{ id: "g", name: "Gone", docIds: ["nope"] }] })).toEqual([]);
  });

  it("widens a narrow container so its own chip fits", () => {
    const one = { id: "f", name: "A very long folder name", docIds: ["a"] };
    const [r] = folderRects({ ...base, folders: [one] });
    expect(r.x1 - r.x0).toBeGreaterThanOrEqual(r.chip.x1 - r.chip.x0);
  });

  it("moves a chip to a free slot rather than stacking two folder names", () => {
    // Two folders whose top-left corners coincide.
    const rects = folderRects({
      ...base,
      folders: [folder, { id: "g", name: "Other", docIds: ["a", "b"] }],
    });
    expect(rects).toHaveLength(2);
    const [p, q] = rects.map((r) => r.chip);
    const hit = p.x0 < q.x1 && p.x1 > q.x0 && p.y0 < q.y1 && p.y1 > q.y0;
    expect(hit).toBe(false);
  });

  it("keeps a chip off the dots it is told to avoid", () => {
    const clear = folderRects({ ...base, folders: [folder] })[0].chip;
    const blocked = folderRects({
      ...base,
      folders: [folder],
      avoid: [{ x0: clear.x0 - 4, y0: clear.y0 - 4, x1: clear.x1 + 4, y1: clear.y1 + 4 }],
    })[0].chip;
    expect(`${blocked.x0},${blocked.y0}`).not.toBe(`${clear.x0},${clear.y0}`);
  });

  it("holds its world size when zoomed OUT, and tightens when zoomed in", () => {
    const at = (k) => {
      const [r] = folderRects({ ...base, folders: [folder], k });
      return r.x1 - r.x0;
    };
    // Below 1x the box is world-stable: screen-sized padding would otherwise
    // inflate every container as the user zooms out, until they overlapped.
    expect(at(0.3)).toBeCloseTo(at(1), 5);
    expect(at(2)).toBeLessThan(at(1));
  });

  it("trims a chip name that would dwarf its own container", () => {
    expect(folderChipLabel("A very long folder name", 8)).toBe("A very …");
    expect(folderChipLabel("Work", 8)).toBe("Work");
    // Never trims below a legible stub.
    expect(folderChipLabel("Engineering", 0).length).toBeGreaterThanOrEqual(4);
  });
});

describe("simulation pacing", () => {
  it("renders every step for a workspace small enough to watch unfold", () => {
    // Below the threshold the frame is cheap, and one step per frame is the
    // smoothest way to see the layout spread out.
    expect(stepsPerFrame(0)).toBe(1);
    expect(stepsPerFrame(25)).toBe(1);
    expect(stepsPerFrame(60)).toBe(1);
  });

  it("advances several steps per frame once the frame is the expensive half", () => {
    // The physics never surfaced in a CPU profile of a 153-note settle while the
    // frame measured a 44ms median, almost all of it style and layout for the
    // SVG the render rewrites. Stepping more than once per frame reaches the
    // same resting layout in a fraction of the frames: measured 108 rendered
    // frames and 5.6s down to 35 frames and 2.3s, with blocking time more than
    // halved.
    expect(stepsPerFrame(61)).toBe(2);
    expect(stepsPerFrame(150)).toBe(3);
    expect(stepsPerFrame(400)).toBe(6);
  });

  it("caps the steps so one frame can never stall on a huge workspace", () => {
    // Without a ceiling a very large library would do unbounded physics inside a
    // single frame, trading a stuttering settle for a frozen tab.
    expect(stepsPerFrame(5000)).toBe(6);
    expect(stepsPerFrame(100000)).toBe(6);
  });

  it("never returns a non-positive count, which would stop the loop dead", () => {
    for (const n of [-5, 0, 1, 7, 59, 60, 61, 120, 999]) {
      expect(stepsPerFrame(n)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("map paint order", () => {
  // Below about 40% zoom the dots converge into a band by design, and no slot
  // along a container's border is clear — measured on 12-, 25- and 40-note
  // workspaces, a folder chip's own letters ended up geometrically under a node
  // dot. Everything else on the map is PLACED so it cannot collide; the chip is
  // the one glyph that sometimes has nowhere free to go, so it is painted last
  // and wins the pixel. Order in the source is order in the SVG, which is what
  // decides this.
  it("draws folder chips after node dots, so a cluster name is never covered", () => {
    const src = readFileSync(join(process.cwd(), "src/ui/GraphView.tsx"), "utf8");
    const dot = src.indexOf('"pf-node-dot"');
    const chip = src.indexOf('className="pf-folder-chip"');
    const chipLabel = src.indexOf('pf-chip-label');
    expect(dot).toBeGreaterThan(-1);
    expect(chip).toBeGreaterThan(-1);
    expect(chip).toBeGreaterThan(dot);
    expect(chipLabel).toBeGreaterThan(dot);
  });

  it("still draws folder containers BEHIND everything they hold", () => {
    // The container is a background wash; drawing it late would grey out its own
    // members and the edges that cross it.
    const src = readFileSync(join(process.cwd(), "src/ui/GraphView.tsx"), "utf8");
    // Guard the anchors first: with the folder render deleted, indexOf returns
    // -1 and `-1 < n` passes — the pin would survive the very change it exists
    // to catch. (Its sibling above already does this.)
    const box = src.indexOf('className="pf-folder-box"');
    const dot = src.indexOf('"pf-node-dot"');
    expect(box).toBeGreaterThan(-1);
    expect(dot).toBeGreaterThan(-1);
    expect(box).toBeLessThan(dot);
  });
});

// ── Scale (A088): the indexed placer and chip scorer give the scan's answers ──

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

const overlapsBox = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const areaOf = (c, o) =>
  Math.max(0, Math.min(c.x1, o.x1) - Math.max(c.x0, o.x0)) * Math.max(0, Math.min(c.y1, o.y1) - Math.max(c.y0, o.y0));

function randomBox(r, span = 1200) {
  const x = (r() - 0.2) * span, y = (r() - 0.2) * span;
  return { x0: x, y0: y, x1: x + r() * 90, y1: y + r() * 40 };
}

describe("BoxGrid", () => {
  it("answers exactly what scanning every box answers — including boxes it cannot index", () => {
    const r = prng(1);
    const boxes = Array.from({ length: 600 }, () => randomBox(r));
    // Degenerate boxes the index must still treat exactly like the scan does.
    boxes.push({ x0: NaN, y0: 0, x1: 10, y1: 10 });                  // not a number
    boxes.push({ x0: 500, y0: 500, x1: 400, y1: 600 });              // inverted
    boxes.push({ x0: -1e7, y0: -1e7, x1: 1e7, y1: 1e7 });            // enormous
    boxes.push({ x0: 1e9, y0: 1e9, x1: 1e9 + 5, y1: 1e9 + 5 });      // far outside any cell range
    const grid = new BoxGrid(40);
    for (const b of boxes) grid.add(b);
    const queries = [
      ...Array.from({ length: 400 }, () => randomBox(r)),
      { x0: 20, y0: 20, x1: 20, y1: 60 },                             // zero width
      { x0: NaN, y0: 1, x1: 2, y1: 3 },
      { x0: -5e6, y0: -5e6, x1: 5e6, y1: 5e6 },
    ];
    for (const q of queries) {
      expect(grid.hits(q)).toBe(boxes.some((o) => overlapsBox(q, o)));
      let scan = 0;
      for (const o of boxes) scan += areaOf(q, o);
      expect(grid.sum(q, (o) => areaOf(q, o))).toBe(scan); // bit for bit
    }
  });

  it("sums in insertion order, so a float sum is identical, not just close", () => {
    // Twelve slivers of area 1e-17 then one box of area 1: in that order the
    // slivers add up to more than half an ulp of 1 and survive (1 + 2⁻⁵²);
    // summed the other way round each one vanishes (exactly 1). The unit box
    // is too wide to index, so an unsorted walk would visit it FIRST.
    const grid = new BoxGrid(10);
    const boxes = [];
    for (let i = 0; i < 12; i++) boxes.push({ x0: 0, y0: 0, x1: 1e-17, y1: 1 });
    boxes.push({ x0: 0, y0: 0, x1: 1e9, y1: 1 });
    for (const b of boxes) grid.add(b);
    const q = { x0: 0, y0: 0, x1: 1, y1: 1 };
    let scan = 0;
    for (const o of boxes) scan += areaOf(q, o);
    expect(scan).toBeGreaterThan(1);
    expect(grid.sum(q, (o) => areaOf(q, o))).toBe(scan);
  });
});

/** A crowded map scene in screen space: dots, chips, a canvas, a folder veto. */
function labelScene(seed) {
  const r = prng(seed);
  const n = 40 + Math.floor(r() * 400);
  const positions = new Map();
  const names = new Map();
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = `n${i}`;
    ids.push(id);
    positions.set(id, { x: r() * 2600, y: r() * 1870 });
    names.set(id, "x".repeat(1 + Math.floor(r() * 24)));
  }
  const k = 0.3 + r() * 2.7;
  const cam = { k, tx: (r() - 0.5) * 400, ty: (r() - 0.5) * 300 };
  const radius = (id) => 7 + (id.length % 5) * 2;
  const obstacles = [];
  for (const id of ids) {
    const p = positions.get(id);
    const s = { x: p.x * k + cam.tx, y: p.y * k + cam.ty };
    const rr = radius(id) + 3;
    obstacles.push({ x0: s.x - rr, y0: s.y - rr, x1: s.x + rr, y1: s.y + rr });
  }
  for (let c = 0; c < 8; c++) obstacles.push(randomBox(r, 1000));
  const foreign = randomBox(r, 800);
  const inFolder = new Set(ids.filter(() => r() < 0.3));
  const forced = new Set(ids.slice(0, Math.floor(r() * 3)));
  return {
    order: ids,
    forced,
    positions,
    radius,
    label: (id) => names.get(id),
    cam,
    obstacles,
    bounds: r() < 0.8 ? { x0: 3, y0: 3, x1: 1100, y1: 800 } : undefined,
    reject: (id, box) => !inFolder.has(id) && overlapsBox(box, foreign),
    limit: r() < 0.5 ? 200 : undefined,
  };
}

describe("placeLabels at scale", () => {
  it("places every label exactly where the unindexed placer did", () => {
    // The placer now tests each candidate against an index of what is near it
    // instead of every box on the map. Same first-fit order, same answers —
    // across crowded and sparse scenes, zoomed in and out, with and without a
    // canvas bound, a folder veto and a candidate limit.
    let placed = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const scene = labelScene(seed);
      const now = placeLabels(scene);
      expect([...now]).toEqual([...legacyPlaceLabels(scene)]);
      placed += now.size;
    }
    expect(placed).toBeGreaterThan(1000); // the scenes really do place labels
  });
});

/** Folders over scattered notes, with dot boxes to steer chips around. */
function folderScene(seed, avoidCount) {
  const r = prng(seed);
  const positions = new Map();
  const folders = [];
  let id = 0;
  for (let f = 0; f < 1 + Math.floor(r() * 12); f++) {
    const cx = r() * 2400, cy = r() * 1700;
    const docIds = [];
    for (let m = 0; m < 1 + Math.floor(r() * 10); m++) {
      const doc = `d${id++}`;
      positions.set(doc, { x: cx + (r() - 0.5) * 300, y: cy + (r() - 0.5) * 200 });
      docIds.push(doc);
    }
    folders.push({ id: `f${f}`, name: r() < 0.5 ? `Folder ${f}` : `A rather long folder name ${f}`, docIds });
  }
  const k = [0.3, 0.45, 1, 1.7, 3][seed % 5];
  const avoid = Array.from({ length: avoidCount }, () => {
    const x = r() * 2600, y = r() * 1900, s = (10 + r() * 20) / k;
    return { x0: x - s, y0: y - s, x1: x + s, y1: y + s };
  });
  return { folders, positions, radius: () => 9, label: (d) => `note ${d}`, k, avoid };
}

describe("folderRects at scale", () => {
  it("resolves every container and chip exactly as the unindexed scorer did", () => {
    // Below 33 dots the scorer scans; above, it sums over an index — with the
    // same terms in the same order, so even ties between two slots break the
    // same way.
    for (const avoidCount of [0, 12, 40, 900]) {
      for (let seed = 1; seed <= 25; seed++) {
        const scene = folderScene(seed, avoidCount);
        expect(folderRects(scene)).toEqual(legacyFolderRects(scene));
      }
    }
  });

  it("gives the layout the same containers, without the chip search", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const scene = folderScene(seed, 0);
      const withChips = folderRects(scene).map(({ chip: _chip, ...rest }) => rest);
      expect(folderBounds(scene)).toEqual(withChips);
    }
  });
});

describe("large-map frame plan", () => {
  const plan = (o) => planFrame({ large: true, running: true, now: 10000, holdUntil: 0, lastPaint: 0, ...o });

  it("never changes a small map: every frame steps (and paints)", () => {
    for (const o of [{ holdUntil: 20000 }, { lastPaint: 0 }, { lastPaint: 9999 }]) {
      expect(plan({ ...o, large: false })).toBe("step");
    }
  });

  it("holds the layout while the user moves the camera or points", () => {
    expect(plan({ holdUntil: 10000 + 1 })).toBe("hold");
    // Even when a paint is overdue: the user's own render comes first.
    expect(plan({ holdUntil: 10000 + 1, lastPaint: 0 })).toBe("hold");
    expect(plan({ holdUntil: 10000, lastPaint: 10000 - 10 })).toBe("step");
  });

  it("paints a few times a second, in a frame with no step", () => {
    // A frame carrying a step AND the paint measured 300-440ms at 2,000 notes
    // under 4× throttling; either alone stayed under 200ms.
    expect(plan({ lastPaint: 10000 - PAINT_EVERY_MS })).toBe("paint");
    expect(plan({ lastPaint: 10000 - PAINT_EVERY_MS + 1 })).toBe("step");
    expect(PAINT_EVERY_MS).toBeGreaterThanOrEqual(100);
  });

  it("takes no step in the frame that shows a paint", () => {
    // That frame restyles and paints the new paths; with a step in it too its
    // task measured 170-190ms, and a zoom arriving then waited for all of it.
    expect(plan({ afterPaint: true, lastPaint: 10000 - 16 })).toBe("hold");
    // Not even when another paint would be due.
    expect(plan({ afterPaint: true, lastPaint: 0 })).toBe("hold");
    expect(plan({ afterPaint: false, lastPaint: 10000 - 16 })).toBe("step");
    expect(plan({ afterPaint: true, large: false })).toBe("step");
  });

  it("does nothing special once the loop has stopped", () => {
    expect(plan({ running: false, holdUntil: 20000 })).toBe("step");
  });

  it("keeps the step budget and the hold short enough to stay responsive", () => {
    // One step always runs, so SLICE_MS bounds the EXTRA steps a frame may
    // take; the hold must end soon after the user stops.
    expect(SLICE_MS).toBeLessThanOrEqual(16);
    expect(CAMERA_HOLD_MS).toBeGreaterThanOrEqual(PAINT_EVERY_MS);
    expect(CAMERA_HOLD_MS).toBeLessThanOrEqual(500);
  });
});

describe("large-map threshold", () => {
  it("keeps every workspace up to LARGE_MAP_MIN on the small-map renderer", () => {
    // CLAUDE.md: 3–150 notes must look and behave exactly as before.
    expect(LARGE_MAP_MIN).toBeGreaterThanOrEqual(150);
    for (const n of [0, 3, 150, LARGE_MAP_MIN]) expect(isLargeMap(n)).toBe(false);
    expect(isLargeMap(LARGE_MAP_MIN + 1)).toBe(true);
    expect(isLargeMap(2000)).toBe(true);
  });
});
