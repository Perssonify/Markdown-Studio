import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { DOCNAV_WIDTH_MIN, DOCNAV_WIDTH_MAX, docNavWidthMax, useUIStore } from "../store/uiStore";

/**
 * C2. Half of this was already fixed and the backlog had not noticed: the
 * persisted width IS re-clamped on load, so choosing a wide panel on a big
 * monitor no longer poisons every later narrow session.
 *
 * What was still open is the LIVE path. Drag the panel wide on a maximised
 * window, restore the window to 800px, and the panel keeps its old width with
 * an ~80px editor beside it until the divider is dragged again — nothing
 * re-applied the clamp on resize.
 */

describe("docNavWidthMax", () => {
  const setViewport = (w) => { window.innerWidth = w; };
  const original = window.innerWidth;

  it("reserves room for the editor on a narrow viewport", () => {
    setViewport(800);
    expect(docNavWidthMax()).toBe(380); // 800 - 420
    setViewport(original);
  });

  it("never exceeds the absolute cap on a wide one", () => {
    setViewport(2560);
    expect(docNavWidthMax()).toBe(DOCNAV_WIDTH_MAX);
    setViewport(original);
  });

  it("never drops below the minimum, however small the window", () => {
    setViewport(320);
    expect(docNavWidthMax()).toBe(DOCNAV_WIDTH_MIN);
    setViewport(original);
  });
});

describe("setDocNavWidth clamps against the CURRENT viewport", () => {
  const original = window.innerWidth;

  it("shrinks a too-wide value", () => {
    window.innerWidth = 800;
    useUIStore.getState().setDocNavWidth(720);
    expect(useUIStore.getState().docNavWidth).toBe(380);
    window.innerWidth = original;
  });

  it("re-applying the stored width is enough to re-clamp it", () => {
    // This is exactly what the resize listener does: hand the setter back the
    // width it already has, and let the clamp do the work against the new
    // viewport. No second copy of the bounds.
    window.innerWidth = 2560;
    useUIStore.getState().setDocNavWidth(700);
    expect(useUIStore.getState().docNavWidth).toBe(700);

    window.innerWidth = 800;
    useUIStore.getState().setDocNavWidth(useUIStore.getState().docNavWidth);
    expect(useUIStore.getState().docNavWidth).toBe(380);
    window.innerWidth = original;
  });
});

describe("the panel re-clamps on window resize", () => {
  const panel = readFileSync(join(process.cwd(), "src/ui/WorkspacePanel.tsx"), "utf8");

  it("listens for resize and re-applies the width", () => {
    expect(panel).toContain('window.addEventListener("resize"');
    expect(panel).toContain('window.removeEventListener("resize"');
    expect(panel).toContain("onResizeRef.current?.(width)");
  });

  it("reports the viewport-aware maximum to assistive tech", () => {
    // An aria-valuemax of a flat 720 would be a lie on an 800px window.
    expect(panel).toContain("aria-valuemax={docNavWidthMax()}");
  });
});
