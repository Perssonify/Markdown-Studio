import { useCallback, useEffect, useRef } from "react";

/**
 * The one implementation of "drag a resize separator", shared by the split-pane
 * divider (`EditorPanes`) and the workspace panel's edge (`WorkspacePanel`).
 *
 * It lives here because those two were the same twenty lines copied, and the
 * copy is what let one defect exist twice:
 *
 * **A cancelled drag never ended.** Both registered `pointermove` and
 * `pointerup` on `window` and nothing else. A `pointercancel` — which a phone
 * fires the instant the browser reclaims the gesture as a scroll, the normal
 * outcome for a 4px separator — left `document.body.style.userSelect = "none"`
 * and `cursor = "col-resize"` set for the rest of the session, so no text
 * anywhere in the app could be selected. And because neither handler filtered
 * by `pointerId`, the still-armed listener then tracked *any* later pointer:
 * one unrelated move was measured dragging the divider from x=932 to x=505.
 *
 * The fix is pointer CAPTURE rather than a third window listener. Capture
 * routes every subsequent event for that pointer to the separator itself —
 * `pointercancel` and `lostpointercapture` included — so the drag cannot
 * outlive the pointer that started it whatever the browser decides to do.
 * `pointerId` is still checked, because capture does not stop a *second*
 * pointer's events reaching the element.
 *
 * Keyboard support lives here too: `role="separator"` with no `tabIndex` and no
 * `aria-valuenow` is invalid ARIA, and both separators shipped that way, so the
 * split ratio and the panel width were pointer-exclusive.
 */

export type DividerOrientation = "horizontal" | "vertical";

export interface DividerDragOptions {
  /** Called for each move of the captured pointer while dragging. */
  onMove: (e: PointerEvent) => void;
  /** `"horizontal"` = a stacked separator the user drags up and down. */
  orientation: DividerOrientation;
  /**
   * Keyboard nudge. `dir` is -1 (Left/Up) or +1 (Right/Down); `toEnd` is true
   * for Home/End, which jump to the respective clamp.
   */
  onKeyAdjust?: (dir: -1 | 1, toEnd: boolean) => void;
}

export function useDividerDrag({ onMove, orientation, onKeyAdjust }: DividerDragOptions) {
  const pointerIdRef = useRef<number | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Read the callbacks through refs so the returned handlers stay
  // identity-stable — the same reason `WorkspacePanel` already kept `onResize`
  // in a ref, and what stops a re-render mid-drag from tearing down listeners.
  const onMoveRef = useRef(onMove);
  useEffect(() => { onMoveRef.current = onMove; }, [onMove]);
  const onKeyAdjustRef = useRef(onKeyAdjust);
  useEffect(() => { onKeyAdjustRef.current = onKeyAdjust; }, [onKeyAdjust]);
  const orientationRef = useRef(orientation);
  useEffect(() => { orientationRef.current = orientation; }, [orientation]);

  const stop = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    pointerIdRef.current = null;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, []);

  // A drag still in flight when the component unmounts would otherwise leave
  // the body unselectable with no element left to end it.
  useEffect(() => stop, [stop]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (pointerIdRef.current !== null) return; // one drag at a time
    e.preventDefault();
    const el = e.currentTarget;
    const id = e.pointerId;
    pointerIdRef.current = id;
    document.body.style.userSelect = "none";
    document.body.style.cursor =
      orientationRef.current === "horizontal" ? "row-resize" : "col-resize";

    try { el.setPointerCapture(id); } catch { /* capture unsupported — listeners still work */ }

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerIdRef.current) return;
      onMoveRef.current(ev);
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerIdRef.current) return;
      stop();
    };

    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("lostpointercapture", end);

    cleanupRef.current = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      el.removeEventListener("lostpointercapture", end);
      // Releasing a pointer that is no longer captured throws in some engines;
      // `lostpointercapture` means it is already gone.
      try { if (el.hasPointerCapture?.(id)) el.releasePointerCapture(id); } catch { /* already released */ }
    };
  }, [stop]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const adjust = onKeyAdjustRef.current;
    if (!adjust) return;
    const back = orientationRef.current === "horizontal" ? "ArrowUp" : "ArrowLeft";
    const forward = orientationRef.current === "horizontal" ? "ArrowDown" : "ArrowRight";
    if (e.key === back) adjust(-1, false);
    else if (e.key === forward) adjust(1, false);
    else if (e.key === "Home") adjust(-1, true);
    else if (e.key === "End") adjust(1, true);
    else return;
    e.preventDefault();
  }, []);

  return { onPointerDown, onKeyDown };
}

/**
 * Classes every resize separator needs, kept beside the hook so the two cannot
 * drift apart:
 *
 * - `touch-none` — without it the 4px stacked separator has `touch-action:auto`
 *   and a phone reclaims the drag as a page scroll. That reclaim IS the
 *   `pointercancel` above, so the two halves of this fix are the same bug seen
 *   from each end.
 * - a `pointer-coarse:` `::before` hit area — 4px against WCAG 2.5.8's 24px
 *   minimum. It is a pseudo-element so the separator's own box, and therefore
 *   the flex layout and the divider maths, are untouched. (The existing pullout
 *   handle cannot do this job: it is `absolute` INSIDE a 4px parent, so it adds
 *   no hit area at all.) Fine pointers keep the precise 4px line.
 * - a visible focus ring, since these are now tab stops.
 */
export const DIVIDER_BASE_CLASS =
  "touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset " +
  "pointer-coarse:before:absolute pointer-coarse:before:content-['']";

/** The `::before` insets that grow the hit area to ≥24px on coarse pointers. */
export const DIVIDER_HIT_AREA: Record<DividerOrientation, string> = {
  // Stacked: a full-width bar the user drags vertically.
  horizontal: "pointer-coarse:before:inset-x-0 pointer-coarse:before:-top-2.5 pointer-coarse:before:-bottom-2.5",
  vertical: "pointer-coarse:before:inset-y-0 pointer-coarse:before:-left-2.5 pointer-coarse:before:-right-2.5",
};
