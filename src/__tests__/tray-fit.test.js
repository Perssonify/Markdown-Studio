import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { EDITOR_FLOOR_PX, TRAY_MIN_PX, trayFits } from "../ui/tray-fit";

/**
 * A1. The bottom tray and the editor are siblings in one `overflow-hidden`
 * column. Height floors were added to both — `max-h-[min(35dvh,16rem)]` on the
 * tray, `min-h-[10rem]` on the editor column — which stopped the editor
 * DISAPPEARING, the original defect. What they cannot do is make space that
 * does not exist: because the editor's floor is not shrinkable, on a short
 * viewport the overflow lands on the tray and the status bar instead, and the
 * bottom of the app is clipped.
 *
 * Below 768px it is worse than the arithmetic looks, because the split panes
 * stack: the surviving height is divided between two panes that each spend part
 * of it on a header, so ~160px of column is ~45-50px of text per pane.
 */

describe("trayFits", () => {
  it("allows the tray when the editor keeps its floor", () => {
    expect(trayFits(EDITOR_FLOOR_PX + TRAY_MIN_PX)).toBe(true);
    expect(trayFits(800)).toBe(true);
  });

  it("refuses when opening would take the editor below its floor", () => {
    expect(trayFits(EDITOR_FLOOR_PX + TRAY_MIN_PX - 1)).toBe(false);
    // The audit's case: a 360px-tall viewport. The shared region is what is
    // left after the menu bar, toolbar and status bar — roughly 250px, not the
    // full 360. (300px, which this first asserted, genuinely DOES fit: it
    // leaves the editor 180px. The expectation was wrong, not the rule.)
    expect(trayFits(250)).toBe(false);
  });

  it("does not block when the height is unmeasurable", () => {
    // A zero reading means the ref is not attached yet, not that there is no
    // room. Refusing on it would make the tray unopenable for the wrong reason.
    expect(trayFits(0)).toBe(true);
    expect(trayFits(NaN)).toBe(true);
    expect(trayFits(-1)).toBe(true);
  });

  it("keeps the editor floor in step with the class that enforces it", () => {
    // `min-h-[10rem]` is 160px. If one moves without the other, the guard
    // starts refusing at a height the layout would have handled, or stops
    // refusing at one it would not.
    const pe = readFileSync(join(process.cwd(), "src/PerssonifyEditor.tsx"), "utf8");
    expect(EDITOR_FLOOR_PX).toBe(160);
    expect(pe).toContain("min-h-[10rem]");
  });
});

describe("the tray toggles consult it", () => {
  const pe = readFileSync(join(process.cwd(), "src/PerssonifyEditor.tsx"), "utf8");

  it("guards both ways of opening the tray", () => {
    // The status-bar chevron and the links chip are separate toggles; guarding
    // only one leaves the defect reachable by the other.
    expect(pe).toContain("refuseTrayIfCramped");
    const uses = pe.match(/refuseTrayIfCramped\(\)/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
  });

  it("never blocks CLOSING the tray", () => {
    // Whatever the height, collapsing must always work — that is the escape
    // hatch from a cramped layout.
    const toggle = pe.slice(pe.indexOf("const toggleTray = useCallback"));
    const body = toggle.slice(0, toggle.indexOf("}, ["));
    expect(body).toContain("if (v) return false;");
  });
});

describe("the tray collapses to zero height without a layout jump (D6)", () => {
  const tray = readFileSync(join(process.cwd(), "src/ui/BottomTray.tsx"), "utf8");

  it("animates grid-template-rows instead of mounting a 256px block", () => {
    expect(tray).toContain("transition-[grid-template-rows]");
    expect(tray).toContain('gridTemplateRows: open ? "1fr" : "0fr"');
  });

  it("still costs zero vertical space when collapsed", () => {
    // The documented invariant. `0fr` plus an `overflow-hidden` child is how it
    // survives the change from `if (!open) return null`.
    expect(tray).toContain('"0fr"');
    expect(tray).toContain("min-h-0 overflow-hidden");
  });

  it("still renders nothing at all when there are no tabs", () => {
    expect(tray).toContain("if (tabs.length === 0) return null;");
  });
});
