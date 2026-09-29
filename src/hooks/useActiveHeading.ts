import { useEffect, useRef, useState } from "react";

/**
 * useActiveHeading — reports which heading the reader is currently scrolled to
 * in the rich (TipTap) pane, so a table-of-contents can highlight it live.
 *
 * STRICTLY READ-ONLY: it only reads element rects and listens to scroll/resize;
 * it NEVER writes `scrollTop`. This is deliberate — the two-pane scroll-sync in
 * EditorPanes uses value-based echo suppression, and any programmatic scroll
 * from here would masquerade as a user scroll and fight it. Tracking must
 * observe, never drive.
 *
 * The returned index is the flat document-order index into the `h1..h6`
 * NodeList of the rich pane — the SAME order `extractHeadings` produces, so a
 * TOC built from `extractHeadings`/`buildHeadingTree` can index by it directly
 * with no mapping.
 */

/**
 * Pure core: given each heading's top offset RELATIVE to the scroll container's
 * top (px), return the index of the "current" heading — the last one at or above
 * the activation line (`threshold` px below the container top). Returns null when
 * the reader is above the first heading (nothing is active yet). Assumes tops are
 * in ascending document order (true for headings within one scroll position).
 */
export function computeActiveHeadingIndex(
  relativeTops: number[],
  threshold = 88
): number | null {
  let idx = -1;
  for (let i = 0; i < relativeTops.length; i++) {
    const t = relativeTops[i];
    if (t !== undefined && t <= threshold) idx = i;
    else break;
  }
  return idx === -1 ? null : idx;
}

/** Nearest scrollable ancestor of `el` (falls back to `el` itself). */
function getScrollParent(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if ((oy === "auto" || oy === "scroll" || oy === "overlay") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return el;
}

interface UseActiveHeadingOpts {
  /** Returns the rich-pane editor root (the `.ProseMirror` element), or null. */
  getEditorDom: () => HTMLElement | null | undefined;
  /** When false, tracking is torn down and the result is null. */
  active: boolean;
  /** Bump to force re-attachment (doc switch, heading count change, mode change). */
  revision?: unknown;
  /** px below the scroller top that counts as the activation line. */
  threshold?: number;
}

export function useActiveHeading({
  getEditorDom,
  active,
  revision,
  threshold = 88,
}: UseActiveHeadingOpts): number | null {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // Keep the latest getter/threshold in refs so the effect body can stay on a
  // small, stable dep list (active + revision) and not re-subscribe on every
  // render — the getter identity churns as the parent re-renders.
  const getDomRef = useRef(getEditorDom);
  getDomRef.current = getEditorDom;
  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;

  useEffect(() => {
    if (!active) {
      setActiveIndex(null);
      return;
    }
    const dom = getDomRef.current();
    if (!dom) {
      setActiveIndex(null);
      return;
    }
    const scroller = getScrollParent(dom);
    let raf = 0;
    const compute = () => {
      raf = 0;
      const heads = dom.querySelectorAll("h1,h2,h3,h4,h5,h6");
      if (!heads.length) {
        setActiveIndex((p) => (p === null ? p : null));
        return;
      }
      const top = scroller.getBoundingClientRect().top;
      const tops: number[] = [];
      for (let i = 0; i < heads.length; i++) {
        tops.push((heads[i] as HTMLElement).getBoundingClientRect().top - top);
      }
      const idx = computeActiveHeadingIndex(tops, thresholdRef.current);
      setActiveIndex((p) => (p === idx ? p : idx));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    compute();
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Layout shifts (content edits, image loads, pane resize) move heading tops.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(dom);
    return () => {
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active, revision]);

  return activeIndex;
}
