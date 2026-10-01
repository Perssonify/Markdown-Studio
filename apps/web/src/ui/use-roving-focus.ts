import { type RefObject, useEffect, useRef } from "react";

/**
 * Roving tabindex for a composite widget (a `role="toolbar"`, a `role="tablist"`):
 * the group is ONE tab stop, and the arrow keys move between its controls.
 *
 * A094. The formatting toolbar was ~40 separate tab stops, so reaching the
 * document by keyboard meant pressing Tab through every one of them on every
 * pass. The WAI-ARIA toolbar pattern makes the whole bar a single stop that
 * remembers the control you last used.
 *
 * It works on the DOM rather than on React state because the controls are
 * heterogeneous (plain buttons, Base UI menu triggers, a colour picker) and
 * appear and disappear with the selection (the table controls) and with the
 * toolbar's own width (compact mode). A MutationObserver re-applies the
 * tabindexes whenever the set changes, so a control that mounts later cannot
 * become a second tab stop. Only `childList` and `disabled` are observed — the
 * hook's own `tabindex` writes must not trigger it.
 */

export type RovingOrientation = "horizontal" | "vertical";

export interface RovingFocusOptions {
  /** Which arrow pair moves focus. Default horizontal (Left/Right). */
  orientation?: RovingOrientation;
  /** What counts as an item. Default: every button in the container. */
  itemSelector?: string;
  /**
   * Reorder the DOM-order item list into VISUAL order. The toolbar's Save
   * button comes first in the DOM (it floats right) but last on screen.
   */
  orderItems?: (items: HTMLElement[]) => HTMLElement[];
  /** Called after focus moves by keyboard (a tablist activates here). */
  onNavigate?: (el: HTMLElement) => void;
  /** Turn the behaviour off without unmounting (e.g. an empty container). */
  disabled?: boolean;
}

const DEFAULT_SELECTOR = "button";

/** An element the hook may make tabbable: enabled, not opted out, not hidden. */
export function isRovingCandidate(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.getAttribute("aria-disabled") === "true") return false;
  if (el.closest("[data-roving-ignore], [hidden], [inert]")) return false;
  return true;
}

/** The next index for a key, or null when the key is not a navigation key. */
export function rovingNextIndex(
  key: string,
  index: number,
  count: number,
  orientation: RovingOrientation = "horizontal",
): number | null {
  if (count === 0) return null;
  const back = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
  const forward = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  // An index of -1 means "focus is on something that is not an item" — start
  // from the edge the key points away from.
  if (key === forward) return index < 0 ? 0 : (index + 1) % count;
  if (key === back) return index < 0 ? count - 1 : (index - 1 + count) % count;
  return null;
}

export function useRovingFocus(
  containerRef: RefObject<HTMLElement | null>,
  options: RovingFocusOptions = {},
) {
  // Options through a ref: the listeners are attached once per container, and
  // a caller passing an inline object must not re-attach them every render.
  const optsRef = useRef(options);
  optsRef.current = options;
  const currentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || options.disabled) return;

    const items = (): HTMLElement[] => {
      const { itemSelector = DEFAULT_SELECTOR, orderItems } = optsRef.current;
      const found = Array.from(container.querySelectorAll<HTMLElement>(itemSelector)).filter(isRovingCandidate);
      return orderItems ? orderItems(found) : found;
    };

    const normalize = () => {
      const list = items();
      if (list.length === 0) return;
      let current = currentRef.current;
      if (!current || !list.includes(current)) current = list[0]!;
      currentRef.current = current;
      for (const el of list) {
        const want = el === current ? 0 : -1;
        if (el.tabIndex !== want) el.tabIndex = want;
      }
    };

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      const list = items();
      const hit = list.find((el) => el === target || el.contains(target));
      if (!hit) return;
      currentRef.current = hit;
      normalize();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement;
      // Text entry inside the group keeps its own arrows.
      if (target.closest("input, textarea, select, [contenteditable='true']")) return;
      const list = items();
      const index = list.findIndex((el) => el === target || el.contains(target));
      if (index < 0) return;
      const next = rovingNextIndex(e.key, index, list.length, optsRef.current.orientation);
      if (next === null) return;
      e.preventDefault();
      const el = list[next]!;
      currentRef.current = el;
      normalize();
      el.focus();
      optsRef.current.onNavigate?.(el);
    };

    normalize();
    container.addEventListener("focusin", onFocusIn);
    container.addEventListener("keydown", onKeyDown);
    const mo = typeof MutationObserver !== "undefined"
      ? new MutationObserver(normalize)
      : null;
    mo?.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "hidden"] });
    return () => {
      container.removeEventListener("focusin", onFocusIn);
      container.removeEventListener("keydown", onKeyDown);
      mo?.disconnect();
    };
  }, [containerRef, options.disabled]);
}
