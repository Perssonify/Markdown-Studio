import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphView } from "../ui/graph/graphView";
import { LARGE_MAP_MIN } from "../store/graph/graph-metrics";
import { parseCircles } from "../store/graph/graph-draw";

/**
 * A088 — the relationship map at library scale. Above LARGE_MAP_MIN notes the
 * map draws its ordinary dots, links and arrowheads as a few batched paths and
 * hit-tests the pointer in code; at or below it nothing changes. These drive
 * the real component in jsdom: every note must still be drawn exactly once and
 * stay measurable, paint order must hold, and the pointer must still find the
 * note under it.
 */

afterEach(() => {
  cleanup();
  delete window.matchMedia;
});

function graphOf(n) {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, title: `Note number ${i}`, backlinks: i % 4, forwardLinks: 1 }));
  const edges = nodes.slice(1).map((node, i) => ({ source: node.id, target: `n${Math.floor(i / 3)}` }));
  const folders = [
    { id: "f1", name: "Projects", docIds: nodes.slice(0, 12).map((x) => x.id) },
    { id: "f2", name: "Archive", docIds: nodes.slice(40, 49).map((x) => x.id) },
  ];
  return { graph: { nodes, edges }, folders };
}

function mount(n, extra = {}) {
  const { graph, folders } = graphOf(n);
  const utils = render(
    <GraphView graph={graph} folders={folders} activeDocId="n0" onNavigate={vi.fn()} onClose={vi.fn()} {...extra} />
  );
  return { ...utils, graph };
}

/** Every note id drawn by the batched dot layers, in draw order. */
const batchedIds = (container) => [...container.querySelectorAll(".pf-node-dots")]
  .flatMap((p) => (p.getAttribute("data-doc-ids") || "").split(" ").filter(Boolean));

/** Wait until the layout has frozen: the dots and the camera stop changing.
 *  A large map paints its moving layout only every PAINT_EVERY_MS (250ms), so
 *  "unchanged" has to hold across longer than that to mean anything. */
async function atRest(container) {
  const snap = () => [...container.querySelectorAll(".pf-node-dots")].map((p) => p.getAttribute("d")).join("|")
    + container.querySelector("svg[role='group'] > g")?.style.transform;
  let last = snap(), still = 0;
  for (let i = 0; i < 100; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    const now = snap();
    still = now === last && batchedIds(container).length ? still + 1 : 0;
    if (still >= 3) return;
    last = now;
  }
  throw new Error("the layout never came to rest");
}

describe("a small map is untouched", () => {
  it("draws one element per note, and no batched layer", async () => {
    const { container } = mount(30);
    await waitFor(() => expect(container.querySelectorAll(".pf-node-dot")).toHaveLength(30));
    expect(container.querySelectorAll("[data-doc-id]")).toHaveLength(30);
    expect(container.querySelectorAll(".pf-node-dots")).toHaveLength(0);
  });
});

describe("a large map", () => {
  const N = LARGE_MAP_MIN + 40;

  it("draws every note exactly once, with geometry the DOM still carries", async () => {
    const { container } = mount(N);
    await waitFor(() => expect(batchedIds(container)).toHaveLength(N));
    expect(new Set(batchedIds(container)).size).toBe(N);
    // Each batched path's circles line up one-to-one with its ids, so a
    // measurement can read every dot's centre and radius back out.
    for (const path of container.querySelectorAll(".pf-node-dots")) {
      const ids = (path.getAttribute("data-doc-ids") || "").split(" ").filter(Boolean);
      expect(parseCircles(path.getAttribute("d") || "")).toHaveLength(ids.length);
    }
    // Only the notes drawn in full are elements of their own: here, the open one.
    expect([...container.querySelectorAll("[data-doc-id]")].map((g) => g.getAttribute("data-doc-id"))).toEqual(["n0"]);
    expect(container.querySelectorAll(".pf-node-label").length).toBeGreaterThan(0);
  });

  it("keeps the paint order: containers first, then notes, folder chips last", async () => {
    const { container } = mount(N);
    await waitFor(() => expect(batchedIds(container)).toHaveLength(N));
    const all = [...container.querySelectorAll(".pf-folder-box, .pf-node-dots, .pf-node-dot, .pf-folder-chip")];
    const kinds = all.map((el) => el.getAttribute("class").split(" ")[0]);
    expect(kinds.lastIndexOf("pf-folder-box")).toBeLessThan(kinds.indexOf("pf-node-dots"));
    expect(kinds.lastIndexOf("pf-node-dot")).toBeLessThan(kinds.indexOf("pf-folder-chip"));
    expect(kinds.lastIndexOf("pf-node-dots")).toBeLessThan(kinds.indexOf("pf-folder-chip"));
  });

  it("finds the note under the pointer: hover draws it in full, a click selects it", async () => {
    const { container } = mount(N);
    await atRest(container);
    const svg = container.querySelector("svg[role='group']");
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 });
    // A note well away from the open one, and where it is on screen.
    const path = [...container.querySelectorAll(".pf-node-dots")].find((p) => p.getAttribute("data-doc-ids"));
    const ids = path.getAttribute("data-doc-ids").split(" ");
    const target = ids.findIndex((id) => id !== "n0");
    const dot = parseCircles(path.getAttribute("d"))[target];
    const cam = container.querySelector("svg[role='group'] > g").style.transform;
    const [, tx, ty, k] = cam.match(/translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\((-?[\d.e+-]+)\)/).map(Number);
    const clientX = dot.x * k + tx, clientY = dot.y * k + ty;

    act(() => { svg.dispatchEvent(new MouseEvent("pointermove", { clientX, clientY, bubbles: true })); });
    await waitFor(() => expect(container.querySelector(`[data-doc-id="${ids[target]}"]`)).not.toBeNull());

    act(() => {
      svg.dispatchEvent(new MouseEvent("pointerdown", { clientX, clientY, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent("pointerup", { clientX, clientY, bubbles: true }));
    });
    await waitFor(() => expect(container.querySelector("aside h3")?.textContent).toBe(`Note number ${ids[target].slice(1)}`));

    // Empty canvas far from every note: no hover.
    act(() => { svg.dispatchEvent(new MouseEvent("pointermove", { clientX: -5000, clientY: -5000, bubbles: true })); });
    await waitFor(() => expect(container.querySelectorAll("[data-doc-id]").length).toBeLessThanOrEqual(2));
  });

  it("holds the layout still while the user zooms, and still rests where it would have", async () => {
    // The hold defers steps; it must not skip them. So a map zoomed mid-settle
    // comes to rest with every note exactly where an untouched map puts it.
    const BIG = 900;
    const version = (c) => c.querySelector('[data-map-layer="notes"]')?.getAttribute("data-layout-version");
    const centres = (c) => {
      const out = new Map();
      for (const p of c.querySelectorAll(".pf-node-dots")) {
        const ids = (p.getAttribute("data-doc-ids") || "").split(" ").filter(Boolean);
        parseCircles(p.getAttribute("d") || "").forEach((dot, i) => out.set(ids[i], dot));
      }
      return out;
    };

    const untouched = mount(BIG);
    await atRest(untouched.container);
    const expected = centres(untouched.container);
    untouched.unmount();

    const zoomed = mount(BIG);
    await waitFor(() => expect(batchedIds(zoomed.container)).toHaveLength(BIG));
    const svg = zoomed.container.querySelector("svg[role='group']");
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 });
    act(() => { svg.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, clientX: 400, clientY: 300, bubbles: true, cancelable: true })); });
    const held = version(zoomed.container);
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(version(zoomed.container)).toBe(held); // nothing moved during the hold
    await waitFor(() => expect(version(zoomed.container)).not.toBe(held), { timeout: 3000 }); // …then it carried on
    await atRest(zoomed.container);
    // Same place to within the path encoding's precision (a hundredth of a
    // world unit; the zoom changed the radius the centre is recovered from).
    const got = centres(zoomed.container);
    expect(got.size).toBe(BIG);
    let worst = 0;
    for (const [id, dot] of expected) worst = Math.max(worst, Math.hypot(dot.x - got.get(id).x, dot.y - got.get(id).y));
    expect(worst).toBeLessThan(0.02);
  }, 30000);

  it("lays a large FOLDER map out on two levels: no note on another, containers apart — even mid-drag", async () => {
    // Above FOLDER_LAYOUT_MAX (500) the map plans the folders' regions and
    // holds each note inside its own (graph-two-level.test.js has the layout
    // itself); this pins that the COMPONENT uses the plan — in every step, and
    // for a note being dragged. 600 notes, 50 folders of 9, 150 in none.
    const n = 600;
    const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, title: `Note number ${i}`, backlinks: i % 4, forwardLinks: 1 }));
    const edges = nodes.slice(1).map((node, i) => ({ source: node.id, target: `n${Math.floor(i / 3)}` }));
    const folders = Array.from({ length: 50 }, (_, f) => ({
      id: `f${f}`, name: `Folder ${f}`, docIds: nodes.filter((_, i) => i < 450 && i % 50 === f).map((x) => x.id),
    }));
    const view = (fs) => <GraphView graph={{ nodes, edges }} folders={fs} activeDocId="n0" onNavigate={vi.fn()} onClose={vi.fn()} />;
    const { container, rerender } = render(view(folders));
    await atRest(container);
    const boxes = () => [...container.querySelectorAll(".pf-folder-box")].map((r) => {
      const x0 = Number(r.getAttribute("x")), y0 = Number(r.getAttribute("y"));
      return { x0, y0, x1: x0 + Number(r.getAttribute("width")), y1: y0 + Number(r.getAttribute("height")),
        docs: new Set(r.closest("[data-folder-docs]").getAttribute("data-folder-docs").split(" ")) };
    });
    const overlapping = (bs) => {
      let hits = 0;
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        const A = bs[i], B = bs[j];
        if (A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 && B.y0 < A.y1) hits++;
      }
      return hits;
    };
    const dots = new Map();
    for (const p of container.querySelectorAll(".pf-node-dots")) {
      const ids = (p.getAttribute("data-doc-ids") || "").split(" ").filter(Boolean);
      parseCircles(p.getAttribute("d") || "").forEach((dot, i) => dots.set(ids[i], dot));
    }
    expect(dots.size).toBe(n);
    expect(new Set([...dots.values()].map((d) => `${Math.round(d.x)},${Math.round(d.y)}`)).size).toBe(n);
    const rested = boxes();
    expect(rested).toHaveLength(50);
    expect(overlapping(rested)).toBe(0);
    let strangers = 0;
    for (const b of rested) for (const [id, d] of dots) if (!b.docs.has(id) && d.x > b.x0 && d.x < b.x1 && d.y > b.y0 && d.y < b.y1) strangers++;
    expect(strangers).toBe(0);

    // The same library handed over again in another order (the graph is
    // rebuilt with the link index) is not a new plan: nothing moves.
    const version = () => container.querySelector('[data-map-layer="notes"]')?.getAttribute("data-layout-version");
    const restVersion = version();
    rerender(<GraphView graph={{ nodes: [...nodes].reverse(), edges: [...edges].reverse() }}
      folders={[...folders].reverse().map((f) => ({ ...f, docIds: [...f.docIds].reverse() }))}
      activeDocId="n0" onNavigate={vi.fn()} onClose={vi.fn()} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    expect(version()).toBe(restVersion);
    rerender(view(folders));

    // Drag a filed note far off the map: it stops at the edge of its folder's
    // region, so its container cannot be stretched over its neighbours'.
    const svg = container.querySelector("svg[role='group']");
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 });
    const id = "n7", dot = dots.get(id);
    const cam = container.querySelector("svg[role='group'] > g").style.transform;
    const [, tx, ty, k] = cam.match(/translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\((-?[\d.e+-]+)\)/).map(Number);
    act(() => {
      svg.dispatchEvent(new MouseEvent("pointerdown", { clientX: dot.x * k + tx, clientY: dot.y * k + ty, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: -4000, clientY: -4000, bubbles: true }));
    });
    const dragged = boxes();
    expect(dragged.find((b) => b.docs.has(id))).toBeTruthy();
    expect(overlapping(dragged)).toBe(0);
    act(() => { window.dispatchEvent(new MouseEvent("pointerup", { clientX: -4000, clientY: -4000, bubbles: true })); });

    // Moving a note to another folder re-plans the regions: without that, it
    // would stay in its old folder's region and stretch its new folder's
    // container across the map.
    const moved = folders.map((f) => ({ ...f, docIds: f.id === "f7" ? f.docIds.filter((d) => d !== id) : f.id === "f30" ? [...f.docIds, id] : f.docIds }));
    rerender(view(moved));
    await atRest(container);
    expect(boxes().filter((b) => b.docs.has(id))).toHaveLength(1);
    expect(overlapping(boxes())).toBe(0);
    // …from scratch: every note starts again at its home, so the map rests
    // exactly where a map opened on this library does (not wherever the old
    // regions had left it).
    const centres = (c) => {
      const out = new Map();
      for (const p of c.querySelectorAll(".pf-node-dots")) {
        const ids = (p.getAttribute("data-doc-ids") || "").split(" ").filter(Boolean);
        parseCircles(p.getAttribute("d") || "").forEach((d, i) => out.set(ids[i], d));
      }
      return out;
    };
    const fresh = render(view(moved));
    await atRest(fresh.container);
    const want = centres(fresh.container), got = centres(container);
    let worst = 0;
    for (const [nid, d] of want) worst = Math.max(worst, Math.hypot(d.x - got.get(nid).x, d.y - got.get(nid).y));
    expect(worst).toBeLessThan(0.02);
  }, 60000);

  it("a folder map that drops back to FOLDER_LAYOUT_MAX notes leaves the two-level layout cleanly", async () => {
    // 501 notes get a plan; 500 do not. The regions' positions mean nothing to
    // the single-level layout, so every note starts again — and the map rests
    // exactly where one opened on those 500 notes does.
    const graphOfN = (n) => {
      const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, title: `Note number ${i}`, backlinks: i % 4, forwardLinks: 1 }));
      const edges = nodes.slice(1).map((node, i) => ({ source: node.id, target: `n${Math.floor(i / 3)}` }));
      const folders = Array.from({ length: 40 }, (_, f) => ({
        id: `f${f}`, name: `Folder ${f}`, docIds: nodes.filter((_, i) => i % 50 === f).map((x) => x.id),
      }));
      return { graph: { nodes, edges }, folders };
    };
    const view = ({ graph, folders }) => <GraphView graph={graph} folders={folders} activeDocId="n0" onNavigate={vi.fn()} onClose={vi.fn()} />;
    const centres = (c) => {
      const out = new Map();
      for (const p of c.querySelectorAll(".pf-node-dots")) {
        const ids = (p.getAttribute("data-doc-ids") || "").split(" ").filter(Boolean);
        parseCircles(p.getAttribute("d") || "").forEach((d, i) => out.set(ids[i], d));
      }
      return out;
    };
    const shrinking = render(view(graphOfN(501)));
    await atRest(shrinking.container);
    shrinking.rerender(view(graphOfN(500)));
    await atRest(shrinking.container);
    const fresh = render(view(graphOfN(500)));
    await atRest(fresh.container);
    const want = centres(fresh.container), got = centres(shrinking.container);
    expect(got.size).toBe(500);
    let worst = 0;
    for (const [id, d] of want) worst = Math.max(worst, Math.hypot(d.x - got.get(id).x, d.y - got.get(id).y));
    expect(worst).toBeLessThan(0.02);
  }, 60000);

  it("under reduced motion, draws nothing until the layout rests — then all of it, still", async () => {
    window.matchMedia = vi.fn((query) => ({ matches: query.includes("reduce"), media: query }));
    const { container } = mount(N);
    // The layout is computed in slices; meanwhile nothing that moves is drawn.
    expect(container.textContent).toContain(`Laying out ${N} notes`);
    expect(batchedIds(container)).toHaveLength(0);
    await waitFor(() => expect(batchedIds(container)).toHaveLength(N), { timeout: 10000 });
    expect(container.textContent).not.toContain("Laying out");
    const drawn = () => [...container.querySelectorAll(".pf-node-dots")].map((p) => p.getAttribute("d")).join("|");
    const first = drawn();
    await new Promise((r) => setTimeout(r, 150));
    expect(drawn()).toBe(first);
  });
});
