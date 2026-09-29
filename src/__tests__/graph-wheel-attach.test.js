import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphView } from "../ui/GraphView";

/**
 * A065. Wheel zoom was attached in an effect that ran once, on mount — but the
 * map's <svg> only exists once there is a graph to draw. Every open after the
 * first mounts with NO graph data (the empty state renders instead), so the
 * listener was never attached and a trackpad pinch zoomed the browser page.
 */

afterEach(() => cleanup());

const EMPTY = { nodes: [], edges: [] };
const GRAPH = {
  nodes: [{ id: "a", title: "Alpha" }, { id: "b", title: "Beta" }],
  edges: [{ source: "a", target: "b" }],
};

function props(graph) {
  return { graph, onNavigate: vi.fn(), onClose: vi.fn() };
}

function wheel(svg) {
  const e = new WheelEvent("wheel", { deltaY: -400, clientX: 10, clientY: 10, bubbles: true, cancelable: true });
  svg.dispatchEvent(e);
  return e;
}

describe("map wheel zoom (A065)", () => {
  it("works when the graph data arrives AFTER the map mounted (every open after the first)", () => {
    const { container, rerender } = render(createElement(GraphView, props(EMPTY)));
    expect(container.querySelector("svg[role='group']")).toBeNull(); // the empty state

    act(() => { rerender(createElement(GraphView, props(GRAPH))); });
    const svg = container.querySelector("svg[role='group']");
    expect(svg).not.toBeNull();
    // preventDefault is the listener's first act: it is what stops the page
    // itself from zooming.
    expect(wheel(svg).defaultPrevented).toBe(true);
  });

  it("works when the data is there from the start", () => {
    const { container } = render(createElement(GraphView, props(GRAPH)));
    expect(wheel(container.querySelector("svg[role='group']")).defaultPrevented).toBe(true);
  });

  it("re-attaches when the svg is replaced (data gone, then back)", () => {
    const { container, rerender } = render(createElement(GraphView, props(GRAPH)));
    act(() => { rerender(createElement(GraphView, props(EMPTY))); });
    act(() => { rerender(createElement(GraphView, props(GRAPH))); });
    expect(wheel(container.querySelector("svg[role='group']")).defaultPrevented).toBe(true);
  });
});
