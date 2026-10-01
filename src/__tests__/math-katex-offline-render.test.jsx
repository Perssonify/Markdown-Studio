/**
 * A formula whose renderer could not be downloaded shows its LaTeX, quietly.
 *
 * The node view awaited the KaTeX chunk with no catch, so a failed load
 * (offline, a purged deploy) surfaced as an unhandled promise rejection —
 * noticed while running the browser suites on Firefox — and left the formula
 * blank. It now falls back to the source text.
 */
import { act, render } from "@testing-library/react";
import { createElement, createRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("katex", () => ({
  get default() {
    throw new TypeError("Failed to fetch dynamically imported module: /assets/katex-abc.js");
  },
}));

import { TiptapPane } from "../ui/TiptapPane";

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
});

const unhandled = [];
const onUnhandled = (e) => unhandled.push(e.reason ?? e);
afterEach(() => { process.off?.("unhandledRejection", onUnhandled); });

describe("math node view without KaTeX", () => {
  it("shows the LaTeX source and raises no unhandled rejection", async () => {
    process.on?.("unhandledRejection", onUnhandled);
    const ref = createRef();
    let view;
    await act(async () => {
      view = render(createElement(TiptapPane, { ref, isDark: false, defaultValue: '<p>a <span data-math-inline="x^2"></span> b</p>' }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const dom = ref.current.getEditor().view.dom;
    expect(dom.textContent).toContain("x^2");
    expect(unhandled).toEqual([]);
    view.unmount();
  });
});
