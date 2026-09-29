/**
 * Should Split view STACK its two panes (one above the other) rather than sit
 * them side by side?
 *
 * A100. It used to stack whenever the viewport was under 768px WIDE, whatever
 * its height. A landscape phone is narrow AND short, so it stacked two panes —
 * each with its own header — into what was left under the chrome: measured
 * 37–69px of editor apiece. Side by side, the same phone gives each pane its
 * full height and ~330px of width, which is usable. So a narrow viewport only
 * stacks when there is height for two panes.
 *
 * "Height" cannot simply be the viewport's on a touch device: with
 * `interactive-widget=resizes-content` (index.html) Android shrinks the layout
 * viewport while the on-screen keyboard is up, so a phone held upright would
 * flip to side-by-side every time the user started typing, and back when the
 * keyboard closed. A phone's ORIENTATION does not change with the keyboard, so
 * an upright touch device always stacks.
 */

/** Below this width the panes are candidates for stacking (the ☰ breakpoint). */
export const SPLIT_STACK_BELOW_WIDTH = 768;
/** A narrow viewport shorter than this keeps the panes side by side. */
export const SPLIT_STACK_MIN_HEIGHT = 500;

export interface ViewportShape {
  width: number;
  height: number;
  /** A touch device held upright (see isUprightTouchDevice). */
  uprightTouch: boolean;
}

export function splitShouldStack({ width, height, uprightTouch }: ViewportShape): boolean {
  if (width >= SPLIT_STACK_BELOW_WIDTH) return false;
  if (uprightTouch) return true;
  return height >= SPLIT_STACK_MIN_HEIGHT;
}

/**
 * Is this a touch device held upright? Fine pointers answer false: a desktop
 * window's height only changes when the user resizes it, so the height rule is
 * right for it. `screen.orientation` reports the DEVICE (unaffected by the
 * keyboard); older iOS lacks it but keeps the legacy `window.orientation`.
 */
export function isUprightTouchDevice(win: Window = window): boolean {
  try {
    if (!win.matchMedia?.("(pointer: coarse)").matches) return false;
    const type = win.screen?.orientation?.type;
    if (type) return type.startsWith("portrait");
    const legacy = (win as unknown as { orientation?: unknown }).orientation;
    if (typeof legacy === "number") return Math.abs(legacy) !== 90;
    return (win.screen?.height ?? 0) >= (win.screen?.width ?? 0);
  } catch {
    return false;
  }
}

export function currentSplitShouldStack(win: Window = window): boolean {
  return splitShouldStack({
    width: win.innerWidth,
    height: win.innerHeight,
    uprightTouch: isUprightTouchDevice(win),
  });
}
