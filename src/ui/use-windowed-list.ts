import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * A082 — render only the rows that can be seen.
 *
 * The library panel mounted EVERY document row (two Base UI menu roots each),
 * and every autosave replaced the document list, so every row re-rendered: a
 * ~1s freeze per save at 500 documents and 3.8s at 2,000 (4× CPU), a hitch
 * every few seconds while typing. This keeps the DOM to the rows in view plus
 * an overscan margin, whatever the library size.
 *
 * Rows are VARIABLE height (a folder row is shorter than a two-line document
 * row, both grow on coarse pointers, a row being renamed is different again).
 * Each row starts at an estimate and is corrected by measurement — once when
 * it mounts and again whenever a ResizeObserver says it changed — so the
 * offsets below it stay exact without anyone hard-coding a pixel height.
 *
 * `pinned` rows stay mounted even when scrolled out of view. A keyboard user's
 * focused row must: unmounting the focused element drops focus on <body>, and
 * the next arrow key then has nowhere to start from. The same holds for a row
 * whose rename box or menu is open.
 */

/** Row geometry: start offset of every row and the total height. */
export function computeOffsets(count: number, sizeOf: (index: number) => number): { starts: number[]; total: number } {
  const starts = new Array<number>(count);
  let y = 0;
  for (let i = 0; i < count; i++) {
    starts[i] = y;
    y += sizeOf(i);
  }
  return { starts, total: y };
}

/** Index of the last row whose start is ≤ y (binary search over `starts`). */
export function rowAt(starts: number[], y: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The inclusive index range intersecting [from, to) — empty as [0, -1]. */
export function visibleRange(starts: number[], total: number, from: number, to: number): [number, number] {
  if (starts.length === 0 || to <= 0 || from >= total) return [0, -1];
  const first = rowAt(starts, Math.max(0, from));
  const last = rowAt(starts, Math.min(total, to) - 0.5);
  return [first, Math.max(first, last)];
}

/** The indexes to render: the visible range plus pinned rows, sorted and unique
 *  (so DOM order stays index order, which is what a screen reader walks). */
export function indexesToRender(range: [number, number], pinned: readonly number[], count: number): number[] {
  const set = new Set<number>();
  for (let i = range[0]; i <= range[1]; i++) set.add(i);
  for (const p of pinned) if (p >= 0 && p < count) set.add(p);
  return [...set].sort((a, b) => a - b);
}

/** New scrollTop that brings [start, start+size) into [top, top+height), or null. */
export function scrollIntoRange(start: number, size: number, top: number, height: number): number | null {
  if (start < top) return start;
  if (start + size > top + height) return Math.max(0, start + size - height);
  return null;
}

export interface WindowedRow {
  index: number;
  key: string;
  start: number;
  size: number;
}

export interface WindowedListOptions {
  count: number;
  /** MEMOIZE these two on the row list: offsets are recomputed when their
   *  identity changes, which is how a re-sorted list (same count, rows moved)
   *  gets each measured height back under the right row. */
  getKey: (index: number) => string;
  estimateSize: (index: number) => number;
  /** The element that scrolls. */
  scrollRef: RefObject<HTMLElement | null>;
  /** The element the rows are positioned in (it may sit below other content in
   *  the scroller; its offset is measured). */
  listRef: RefObject<HTMLElement | null>;
  /** Extra pixels rendered above and below the viewport. */
  overscan?: number;
  /** Row indexes that must stay mounted (focused, renaming, menu open). */
  pinned?: readonly number[];
}

/**
 * Move focus to a row by key AFTER the render that mounts it. Keyboard
 * navigation in a windowed list asks for a row that may not exist yet (it is
 * about to be scrolled into the window), so the request is parked and honoured
 * by a layout effect once the element is in the DOM.
 */
export function useFocusRowAfterRender(containerRef: RefObject<HTMLElement | null>, attr = "data-key") {
  const pending = useRef<string | null>(null);
  const tryFocus = useCallback((key: string) => {
    const el = containerRef.current?.querySelector<HTMLElement>(`[${attr}="${key.replace(/["\\]/g, "\\$&")}"]`);
    if (!el) return false;
    el.tabIndex = 0; // before focus, so :focus-visible (which skips tabindex=-1) applies at once
    el.focus();
    return true;
  }, [containerRef, attr]);
  useLayoutEffect(() => {
    if (pending.current && tryFocus(pending.current)) pending.current = null;
  });
  return useCallback((key: string) => {
    pending.current = tryFocus(key) ? null : key;
  }, [tryFocus]);
}

/** jsdom and hidden containers report 0; assume a tall panel so SOMETHING
 *  renders (and tests see rows) rather than nothing. */
const FALLBACK_VIEWPORT = 800;
const ROW_KEY_ATTR = "data-row-key";

export function useWindowedList({
  count,
  getKey,
  estimateSize,
  scrollRef,
  listRef,
  overscan = 320,
  pinned = [],
}: WindowedListOptions) {
  // Measured heights by row KEY (not index — rows move when the list re-sorts).
  const measured = useRef(new Map<string, number>());
  const [version, setVersion] = useState(0);
  const [view, setView] = useState({ scrollTop: 0, height: FALLBACK_VIEWPORT, listTop: 0 });

  const getKeyRef = useRef(getKey);
  getKeyRef.current = getKey;
  const estimateRef = useRef(estimateSize);
  estimateRef.current = estimateSize;

  const { starts, total } = useMemo(
    () => computeOffsets(count, (i) => measured.current.get(getKey(i)) ?? estimateSize(i)),
    // `version` is the measurement generation (the Map is mutated in place).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [count, version, getKey, estimateSize],
  );
  const geometry = useRef({ starts, total });
  geometry.current = { starts, total };

  const readView = useCallback(() => {
    const scroller = scrollRef.current;
    const list = listRef.current;
    if (!scroller) return;
    const sRect = scroller.getBoundingClientRect();
    const lRect = list?.getBoundingClientRect();
    const listTop = lRect ? lRect.top - sRect.top + scroller.scrollTop : 0;
    const next = { scrollTop: scroller.scrollTop, height: scroller.clientHeight || FALLBACK_VIEWPORT, listTop };
    setView((v) => (v.scrollTop === next.scrollTop && v.height === next.height && v.listTop === next.listTop ? v : next));
  }, [scrollRef, listRef]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    readView();
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; readView(); });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => readView()) : null;
    ro?.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      ro?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scrollRef, readView]);

  // The list's offset inside the scroller moves when content above it changes
  // (the "No results" line, the rename header); re-read it as the list does.
  useLayoutEffect(() => { readView(); }, [count, readView]);

  // ── measurement ──
  const rowObserver = useRef<ResizeObserver | null>(null);
  const observed = useRef(new Set<Element>());
  /** Mounted since the last commit — measured synchronously once. */
  const fresh = useRef(new Set<Element>());
  const record = useCallback((el: Element) => {
    const key = el.getAttribute(ROW_KEY_ATTR);
    const h = el.getBoundingClientRect().height;
    // 0 means "not laid out" (jsdom, display:none), not "zero tall".
    if (!key || !(h > 0)) return false;
    const prev = measured.current.get(key);
    if (prev !== undefined && Math.abs(prev - h) < 0.5) return false;
    measured.current.set(key, h);
    return true;
  }, []);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    rowObserver.current = new ResizeObserver((entries) => {
      let changed = false;
      for (const e of entries) changed = record(e.target) || changed;
      if (changed) setVersion((v) => v + 1);
    });
    for (const el of observed.current) rowObserver.current.observe(el);
    return () => rowObserver.current?.disconnect();
  }, [record]);

  /** Ref callback for every rendered row wrapper (must carry data-row-key). */
  const measureElement = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    if (!observed.current.has(el)) {
      observed.current.add(el);
      fresh.current.add(el);
      rowObserver.current?.observe(el);
    }
  }, []);

  // After each commit: forget rows that unmounted (an isConnected check, no
  // layout), and measure only the rows that just mounted, synchronously, so
  // their true height lands before the browser paints. Rows already on screen
  // are the ResizeObserver's job — re-reading all of them here would force a
  // layout on every render, which is the cost this hook exists to remove.
  useLayoutEffect(() => {
    for (const el of observed.current) {
      if (!el.isConnected) {
        observed.current.delete(el);
        fresh.current.delete(el);
        rowObserver.current?.unobserve(el);
      }
    }
    if (fresh.current.size === 0) return;
    let changed = false;
    for (const el of fresh.current) changed = record(el) || changed;
    fresh.current.clear();
    if (changed) setVersion((v) => v + 1);
  });

  const from = view.scrollTop - view.listTop - overscan;
  const to = view.scrollTop - view.listTop + view.height + overscan;
  const range = visibleRange(starts, total, from, to);
  const pinnedKey = pinned.join(",");
  const rows: WindowedRow[] = useMemo(
    () =>
      indexesToRender(range, pinned, count).map((index) => ({
        index,
        key: getKeyRef.current(index),
        start: starts[index]!,
        size: measured.current.get(getKeyRef.current(index)) ?? estimateRef.current(index),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [range[0], range[1], pinnedKey, count, starts],
  );

  /** Scroll the minimum needed for row `index` to be in view. Updates the
   *  window synchronously so the row is mounted before the caller focuses it. */
  const scrollToIndex = useCallback((index: number) => {
    const scroller = scrollRef.current;
    const { starts: s } = geometry.current;
    if (!scroller || index < 0 || index >= s.length) return;
    const size = measured.current.get(getKeyRef.current(index)) ?? estimateRef.current(index);
    const list = listRef.current;
    const listTop = list ? list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop : 0;
    const height = scroller.clientHeight || FALLBACK_VIEWPORT;
    const next = scrollIntoRange(listTop + s[index]!, size, scroller.scrollTop, height);
    if (next !== null) scroller.scrollTop = next;
    readView();
  }, [scrollRef, listRef, readView]);

  return { rows, totalSize: total, measureElement, scrollToIndex, rowKeyAttr: ROW_KEY_ATTR };
}
