/**
 * A083 — a formula is typeset only when it comes near the rich pane's view.
 *
 * KaTeX markup is dozens of elements per formula, and a formula-heavy note has
 * thousands. Typeset up front, they were work on every keystroke for layout and
 * paint and — measured — for React: before every commit React DOM walks the
 * whole focused contenteditable to record the selection, which with the rich
 * pane focused meant every element of every formula (3.7 s of a 5-keystroke
 * profile at 400 KB and 4x CPU; the mirror's median went from 763 ms to 162 ms
 * when they stopped being typeset out of view). A formula now holds its LaTeX
 * as text until an IntersectionObserver on the pane's scroller sees it within a
 * screen of view — and printing typesets every one first.
 */
import { act, render } from "@testing-library/react";
import { createElement, createRef } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TiptapPane } from "../ui/panes/tiptapPane";

class FakeObserver {
  static instances = [];
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.targets = new Set();
    FakeObserver.instances.push(this);
  }
  observe(target) { this.targets.add(target); }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  /** Report `target` as within the root's margin. */
  enter(target) { this.callback([{ target, isIntersecting: true }], this); }
}

const realIO = globalThis.IntersectionObserver;
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.IntersectionObserver = FakeObserver;
});
afterAll(() => { globalThis.IntersectionObserver = realIO; });
afterEach(() => { FakeObserver.instances.length = 0; });

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

describe("math node views typeset near the view", () => {
  it("holds a formula's source until it nears the view, then typesets it; printing typesets the rest", async () => {
    const ref = createRef();
    let view;
    await act(async () => {
      view = render(createElement(TiptapPane, {
        ref, isDark: false, className: "scroller",
        defaultValue: '<p>a <span data-math-inline="x^2"></span> b</p><div data-math-block="\\frac{1}{2}"></div>',
      }));
    });
    await settle();
    const dom = ref.current.getEditor().view.dom;
    const inline = dom.querySelector(".math-inline span");
    const block = dom.querySelector(".math-block span");
    // Not typeset yet: one text node each, the LaTeX.
    expect(inline.textContent).toBe("x^2");
    expect(block.textContent).toBe("\\frac{1}{2}");
    expect(dom.querySelector(".katex")).toBe(null);

    // One observer, on the pane's scroller, reaching a screen ahead.
    expect(FakeObserver.instances).toHaveLength(1);
    const io = FakeObserver.instances[0];
    expect(io.options.root).toBe(dom.closest(".scroller"));
    expect(io.options.rootMargin).toBe("100% 0px");
    expect(io.targets.has(inline)).toBe(true);
    expect(io.targets.has(block)).toBe(true);

    await act(async () => { io.enter(inline); });
    await settle();
    expect(inline.querySelector(".katex")).not.toBe(null);
    expect(block.querySelector(".katex")).toBe(null);
    expect(io.targets.has(inline)).toBe(false); // typeset once, then left alone

    await act(async () => { window.dispatchEvent(new Event("beforeprint")); });
    await settle();
    expect(block.querySelector(".katex")).not.toBe(null);
    view.unmount();
  }, 20000);

  it("stops watching a formula that is removed before it is typeset", async () => {
    const ref = createRef();
    let view;
    await act(async () => {
      view = render(createElement(TiptapPane, { ref, isDark: false, defaultValue: '<p>a <span data-math-inline="y"></span></p>' }));
    });
    await settle();
    const io = FakeObserver.instances[0];
    expect(io.targets.size).toBe(1);
    await act(async () => { ref.current.getEditor().commands.setContent("<p>plain</p>"); });
    await settle();
    expect(io.targets.size).toBe(0);
    view.unmount();
  }, 20000);
});
