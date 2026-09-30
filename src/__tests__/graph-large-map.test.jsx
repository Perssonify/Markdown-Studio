import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphView } from "../ui/GraphView";
import { LARGE_MAP_MIN } from "../store/graph-metrics";
import { parseCircles } from "../store/graph-draw";

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
