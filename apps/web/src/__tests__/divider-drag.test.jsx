import { readFileSync } from "fs";
import { join } from "path";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DIVIDER_BASE_CLASS, DIVIDER_HIT_AREA, useDividerDrag } from "../ui/use-divider-drag";

/**
 * The two resize separators shipped the same defect because they were the same
 * twenty lines copied. Both registered `pointermove` and `pointerup` on
 * `window` and nothing else, so:
 *
 *  - a `pointercancel` — which a phone fires the moment it reclaims the drag as
 *    a page scroll, the normal outcome for a 4px `touch-action:auto` strip —
 *    never ended the drag, leaving `body.style.userSelect = "none"` and
 *    `cursor = "col-resize"` set for the rest of the session; and
 *  - nothing filtered by `pointerId`, so the still-armed listener then tracked
 *    ANY later pointer (measured: one unrelated move dragged the divider from
 *    x=932 to x=505).
 *
 * These cases drive the shared hook, since that is where both call sites now
 * get their behaviour from.
 */

// jsdom implements neither pointer capture nor PointerEvent's pointerId, so
// stub the capture API on the element and dispatch events carrying an explicit
// pointerId. This mirrors what a browser routes to a capturing element; the
// browser-level truth is asserted separately in e2e.
function pointerEvent(type, { pointerId = 1, clientX = 0, clientY = 0 } = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { pointerId, clientX, clientY });
  return e;
}

function Divider({ onMove, orientation = "vertical", onKeyAdjust }) {
  const { onPointerDown, onKeyDown } = useDividerDrag({ onMove, orientation, onKeyAdjust });
  return (
    <div
      data-testid="sep"
      role="separator"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={`${DIVIDER_BASE_CLASS} ${DIVIDER_HIT_AREA[orientation]}`}
    />
  );
}

function mountDivider(props = {}) {
  const onMove = props.onMove ?? vi.fn();
  const utils = render(<Divider {...props} onMove={onMove} />);
  const el = utils.getByTestId("sep");
  // Stand in for the capture API jsdom lacks; the hook try/catches it either way.
  let captured = null;
  el.setPointerCapture = (id) => { captured = id; };
  el.releasePointerCapture = (id) => { if (captured === id) captured = null; };
  el.hasPointerCapture = (id) => captured === id;
  return { ...utils, el, onMove, isCaptured: () => captured };
}

afterEach(() => {
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
});

describe("useDividerDrag — a drag cannot outlive its pointer", () => {
  it("ends on pointercancel, restoring body styles", () => {
    const { el } = mountDivider();
    fireEvent.pointerDown(el, { pointerId: 1 });
    expect(document.body.style.userSelect).toBe("none");
    expect(document.body.style.cursor).toBe("col-resize");

    act(() => { el.dispatchEvent(pointerEvent("pointercancel", { pointerId: 1 })); });

    // This is the whole bug: before the fix nothing listened for this event and
    // both of these stayed set for the rest of the session.
    expect(document.body.style.userSelect).toBe("");
    expect(document.body.style.cursor).toBe("");
  });

  it("stops moving after a cancel", () => {
    const { el, onMove } = mountDivider();
    fireEvent.pointerDown(el, { pointerId: 1 });
    act(() => { el.dispatchEvent(pointerEvent("pointermove", { pointerId: 1, clientX: 10 })); });
    expect(onMove).toHaveBeenCalledTimes(1);

    act(() => { el.dispatchEvent(pointerEvent("pointercancel", { pointerId: 1 })); });
    act(() => { el.dispatchEvent(pointerEvent("pointermove", { pointerId: 1, clientX: 400 })); });

    expect(onMove).toHaveBeenCalledTimes(1); // the post-cancel move is ignored
  });

  it("ignores a DIFFERENT pointer while one drag is in flight", () => {
    const { el, onMove } = mountDivider();
    fireEvent.pointerDown(el, { pointerId: 1 });
    act(() => { el.dispatchEvent(pointerEvent("pointermove", { pointerId: 2, clientX: 999 })); });
    expect(onMove).not.toHaveBeenCalled();

    act(() => { el.dispatchEvent(pointerEvent("pointermove", { pointerId: 1, clientX: 12 })); });
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("also ends on lostpointercapture", () => {
    const { el } = mountDivider();
    fireEvent.pointerDown(el, { pointerId: 3 });
    act(() => { el.dispatchEvent(pointerEvent("lostpointercapture", { pointerId: 3 })); });
    expect(document.body.style.userSelect).toBe("");
  });

  it("captures the pointer and releases it when the drag ends", () => {
    const { el, isCaptured } = mountDivider();
    fireEvent.pointerDown(el, { pointerId: 7 });
    expect(isCaptured()).toBe(7);
    act(() => { el.dispatchEvent(pointerEvent("pointerup", { pointerId: 7 })); });
    expect(isCaptured()).toBe(null);
  });

  it("restores body styles when unmounted mid-drag", () => {
    const { el, unmount } = mountDivider();
    fireEvent.pointerDown(el, { pointerId: 1 });
    expect(document.body.style.userSelect).toBe("none");
    unmount();
    expect(document.body.style.userSelect).toBe("");
  });

  it("uses row-resize for a stacked separator", () => {
    const { el } = mountDivider({ orientation: "horizontal" });
    fireEvent.pointerDown(el, { pointerId: 1 });
    expect(document.body.style.cursor).toBe("row-resize");
  });
});

describe("useDividerDrag — keyboard", () => {
  it("maps arrows to -1/+1 and Home/End to the clamps", () => {
    const onKeyAdjust = vi.fn();
    const { el } = mountDivider({ onKeyAdjust });

    fireEvent.keyDown(el, { key: "ArrowLeft" });
    fireEvent.keyDown(el, { key: "ArrowRight" });
    fireEvent.keyDown(el, { key: "Home" });
    fireEvent.keyDown(el, { key: "End" });

    expect(onKeyAdjust.mock.calls).toEqual([[-1, false], [1, false], [-1, true], [1, true]]);
  });

  it("uses Up/Down when the separator is horizontal, not Left/Right", () => {
    const onKeyAdjust = vi.fn();
    const { el } = mountDivider({ orientation: "horizontal", onKeyAdjust });

    fireEvent.keyDown(el, { key: "ArrowLeft" });
    expect(onKeyAdjust).not.toHaveBeenCalled();

    fireEvent.keyDown(el, { key: "ArrowUp" });
    fireEvent.keyDown(el, { key: "ArrowDown" });
    expect(onKeyAdjust.mock.calls).toEqual([[-1, false], [1, false]]);
  });

  it("leaves other keys alone so they still reach the page", () => {
    const onKeyAdjust = vi.fn();
    const { el } = mountDivider({ onKeyAdjust });
    fireEvent.keyDown(el, { key: "Tab" });
    fireEvent.keyDown(el, { key: "a" });
    expect(onKeyAdjust).not.toHaveBeenCalled();
  });
});

describe("separator classes", () => {
  it("sets touch-action:none — without it a phone reclaims the drag as a scroll", () => {
    // That reclaim IS the pointercancel path above, so this class and the
    // cancel handling are the same defect from opposite ends.
    expect(DIVIDER_BASE_CLASS).toContain("touch-none");
  });

  it("is focusable-visible, since the separators are now tab stops", () => {
    expect(DIVIDER_BASE_CLASS).toContain("focus-visible:ring-2");
  });

  it("grows the hit area on coarse pointers, on the axis that needs it", () => {
    // 4px against WCAG 2.5.8's 24px minimum. A pseudo-element, so the
    // separator's own box — and the divider maths — are untouched.
    expect(DIVIDER_HIT_AREA.vertical).toContain("before:-left-2.5");
    expect(DIVIDER_HIT_AREA.vertical).toContain("before:-right-2.5");
    expect(DIVIDER_HIT_AREA.horizontal).toContain("before:-top-2.5");
    expect(DIVIDER_HIT_AREA.horizontal).toContain("before:-bottom-2.5");
    for (const v of Object.values(DIVIDER_HIT_AREA)) {
      expect(v).toContain("pointer-coarse:");
    }
  });
});

/**
 * The hook is only half the fix — a call site that does not use it is still
 * broken, and testing the helper alone has survived exactly that mutation in
 * this repo before. Rendering `EditorPanes` in jsdom would drag in CodeMirror
 * and TipTap for a question about six attributes, so these are source pins,
 * the same device `graph-metrics.test.js` uses for draw order.
 */
describe("both separators are wired to the shared hook", () => {
  const read = (p) => readFileSync(join(process.cwd(), p), "utf8");
  const files = {
    "EditorPanes.tsx": read("src/ui/panes/editorPanes/index.tsx"),
    "WorkspacePanel.tsx": read("src/ui/WorkspacePanel.tsx"),
  };

  for (const [name, src] of Object.entries(files)) {
    it(`${name} drives its separator through useDividerDrag`, () => {
      expect(src).toContain("useDividerDrag");
      // The old shape: hand-rolled window listeners that could not see a cancel.
      expect(src).not.toContain('window.addEventListener("pointermove"');
      expect(src).not.toContain('window.addEventListener("pointerup"');
    });

    it(`${name} gives its separator a value and a tab stop`, () => {
      // role="separator" with neither is invalid ARIA, and both shipped that way.
      expect(src).toContain("tabIndex={0}");
      expect(src).toContain("aria-valuenow");
      expect(src).toContain("aria-valuemin");
      expect(src).toContain("aria-valuemax");
      expect(src).toContain("onKeyDown={onDividerKeyDown}");
    });

    it(`${name} applies the shared separator classes`, () => {
      // Strip the import line first. Asserting on the raw source passed with
      // the USE removed and only the import left — a check that could not fail,
      // caught by mutating the call site rather than by reading it.
      const body = src.replace(/^import .*use-divider-drag.*$/m, "");
      expect(body).toContain("DIVIDER_BASE_CLASS");
      expect(body).toContain("DIVIDER_HIT_AREA");
    });
  }

  it("has no separator that skips the hook", () => {
    // A third one added later must come through here too. Line comments are
    // stripped first: this file's own prose mentions role="separator", and a
    // count that included it would fail for the wrong reason.
    const code = (src) => src.replace(/^\s*\/\/.*$/gm, "");
    for (const [name, src] of Object.entries(files)) {
      const separators = code(src).match(/role="separator"/g) ?? [];
      const wired = code(src).match(/onKeyDown=\{onDividerKeyDown\}/g) ?? [];
      expect(separators.length, `${name}: has a separator to check`).toBeGreaterThan(0);
      expect(wired.length, `${name}: every separator wired`).toBe(separators.length);
    }
  });
});
