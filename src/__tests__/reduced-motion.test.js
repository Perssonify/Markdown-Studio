import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion } from "../utils/reduced-motion";

/**
 * `styles.css` has carried a global reduced-motion guard for a while, and a
 * comment beside it claiming "JS-driven motion (graph camera easing) is gated
 * separately in GraphView". That was false — `grep -rn "prefers-reduced-motion"
 * src/` matched the stylesheet and nothing else, so no JavaScript in the app
 * consulted the preference at all.
 *
 * It also aimed at the wrong code. The graph's 450ms camera move is an inline
 * CSS *transition*, which the stylesheet's `transition-duration: 0.01ms
 * !important` already beats (an important stylesheet declaration wins over a
 * normal inline one). What genuinely ignored the preference was the force
 * simulation: node positions advanced from `requestAnimationFrame`, which no
 * stylesheet can reach, so opening the map animated a ring exploding into a
 * graph however the user had configured their machine.
 */

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  if (originalMatchMedia) window.matchMedia = originalMatchMedia;
  else delete window.matchMedia;
  vi.restoreAllMocks();
});

const stubMatchMedia = (matches) => {
  window.matchMedia = vi.fn((query) => ({ matches, media: query }));
};

describe("prefersReducedMotion", () => {
  it("reports the media query's answer", () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("asks for the right query", () => {
    stubMatchMedia(true);
    prefersReducedMotion();
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });

  it("re-reads every call, so a mid-session change is honoured", () => {
    // A value captured at module load would be wrong for the rest of the page.
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it("fails OPEN where matchMedia is missing", () => {
    // The animated path is the status quo; silently degrading an environment
    // that simply cannot answer would be worse than ignoring the preference.
    delete window.matchMedia;
    expect(prefersReducedMotion()).toBe(false);
  });

  it("fails OPEN when matchMedia throws", () => {
    window.matchMedia = vi.fn(() => { throw new Error("blocked"); });
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("the graph simulation consults it", () => {
  const graph = readFileSync(join(process.cwd(), "src/ui/GraphView.tsx"), "utf8");

  it("settles immediately instead of animating under reduced motion", () => {
    expect(graph).toContain("prefersReducedMotion");
    expect(graph).toContain("settleImmediately");
    // The gate belongs in `reheat`, before the rAF is scheduled — gating the
    // loop body instead would still paint the first frame of the explosion.
    const reheat = graph.slice(graph.indexOf("const reheat = useCallback"));
    const gate = reheat.indexOf("prefersReducedMotion");
    const raf = reheat.indexOf("requestAnimationFrame(loop)");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(raf);
  });
});

describe("styles.css says what is actually true", () => {
  const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

  it("still carries the global CSS guard", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("no longer claims the graph CAMERA is what JS gates", () => {
    // The old comment named the camera, which needs no gate, and implied a
    // gate existed when none did. Documentation that describes code we do not
    // have is worse than none — the same rule the residual list is held to.
    expect(css).not.toContain("graph camera easing) is gated separately");
  });
});
