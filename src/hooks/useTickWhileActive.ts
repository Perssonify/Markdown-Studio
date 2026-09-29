import { useEffect, useState } from "react";

/**
 * Re-render on an interval while `active`.
 *
 * For panels that read a LIVE value AT RENDER — the JS heap gauge, a "2 min ago"
 * timestamp — which is neither a prop, nor state, nor a store subscription.
 *
 * Those panels used to tick only by accident: they re-rendered because the
 * editor shell around them re-rendered, i.e. on every keystroke. Memoizing them
 * (which is right — they are mounted while closed so their sheet can animate
 * out) makes their props stop changing, and the reading then freezes at whatever
 * it was when the panel opened. That is worst for exactly the reader who opens
 * the memory panel to watch whether the heap is growing.
 *
 * An explicit interval is also better than the accident it replaces: it ticks
 * while the user is READING and not typing, which is when they are looking.
 */
export function useTickWhileActive(active: boolean, ms: number): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => (n + 1) % 1_000_000), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}
