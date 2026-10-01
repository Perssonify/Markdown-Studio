/**
 * Run `work` in idle time, a slice at a time, until it reports it is done.
 *
 * `work(timeUp)` does what it can until `timeUp()` says stop and returns true
 * when nothing is left. A slice that throws ends the work: what runs here is
 * preparation that a later, ordinary path does anyway. Returns a function that
 * cancels whatever is still scheduled.
 *
 * `requestIdleCallback` where the browser has it — its deadline is how long
 * the browser expects to stay idle, so slices yield to input and rendering.
 * Safari has none: there a timer, with `budgetMs` of work per slice.
 */
export function runWhenIdle(work: (timeUp: () => boolean) => boolean, budgetMs = 8): () => void {
  let cancelled = false;
  let idle: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const ric = typeof window !== "undefined" && typeof window.requestIdleCallback === "function" ? window : null;

  const run = (timeUp: () => boolean): void => {
    idle = null;
    timer = null;
    if (cancelled) return;
    let done: boolean;
    try {
      done = work(timeUp);
    } catch {
      done = true;
    }
    if (!done) schedule();
  };

  const schedule = (): void => {
    if (cancelled) return;
    if (ric) {
      idle = ric.requestIdleCallback((deadline) => run(() => deadline.timeRemaining() <= 1));
    } else {
      timer = setTimeout(() => {
        const until = performance.now() + budgetMs;
        run(() => performance.now() >= until);
      }, 50);
    }
  };

  schedule();
  return () => {
    cancelled = true;
    if (idle !== null && ric) ric.cancelIdleCallback(idle);
    if (timer !== null) clearTimeout(timer);
    idle = null;
    timer = null;
  };
}
