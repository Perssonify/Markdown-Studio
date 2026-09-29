/**
 * When to project one pane into the other.
 *
 * Pure, so the policy can be reasoned about and tested on its own; the hook
 * supplies the measurements and owns the timers.
 *
 * The scheduler answers two different questions:
 *
 *  - `syncDelayFor` — how long to wait after the LAST keystroke. Short, so the
 *    mirror is current the moment you pause.
 *  - `syncMaxWaitFor` — the longest the other pane may lag while typing
 *    CONTINUES. The debounce used to be purely trailing, reset by every
 *    keystroke, so while you typed the other pane never updated at all: it
 *    caught up only when you stopped for the whole window. This ceiling is what
 *    makes it advance as you go.
 *
 * Both are derived from the MEASURED cost of recent projections on the device
 * in use, not from the document's length. Length was a proxy for cost and a
 * poor one — it charged a large note on a fast machine 800ms and let a small
 * note on a slow phone re-project far too eagerly.
 */
import {
  SYNC_MIN_DELAY_MS,
  SYNC_MAX_DELAY_MS,
  SYNC_MIN_MAX_WAIT_MS,
  SYNC_MAX_MAX_WAIT_MS,
} from "../constants";

/** Weight of the newest sample in the moving average of projection cost. */
const COST_ALPHA = 0.3;

/** Idle delay ≈ 1.5x what a projection costs. */
const DELAY_FACTOR = 1.5;

/**
 * Ceiling ≈ 8x what a projection costs, so keeping the mirror current while
 * typing continues takes roughly an eighth of the main thread.
 *
 * Measured on a 50KB note under 4x CPU throttling, typing continuously for ~10s
 * (median of three runs). Keeping the mirror current during typing is not free:
 * total blocking rose from 499ms — when it simply never updated — to 942ms at
 * 8x and 984ms at 5x, for a mirror 331ms and 300ms behind respectively. The two
 * factors are within the run-to-run spread of each other, so this takes the
 * more conservative one. Input latency stays under the threshold that reads as
 * immediate either way (p95 51ms, against 42ms before).
 *
 * Small documents are unaffected: their projections are cheap enough that the
 * floor below decides, not this factor.
 */
const MAX_WAIT_FACTOR = 8;

const clamp = (lo: number, v: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Fold a new measurement into the moving average. 0 means "nothing measured". */
export function nextSyncCost(prev: number, sampleMs: number): number {
  const sample = Number.isFinite(sampleMs) && sampleMs > 0 ? sampleMs : 0;
  if (prev <= 0) return sample;
  return prev * (1 - COST_ALPHA) + sample * COST_ALPHA;
}

/** How long to wait after the last change before projecting. */
export function syncDelayFor(costMs: number): number {
  if (!(costMs > 0)) return SYNC_MIN_DELAY_MS; // nothing measured yet — assume cheap
  return clamp(SYNC_MIN_DELAY_MS, Math.round(costMs * DELAY_FACTOR), SYNC_MAX_DELAY_MS);
}

/** The longest the other pane may lag while changes keep arriving. */
export function syncMaxWaitFor(costMs: number): number {
  if (!(costMs > 0)) return SYNC_MIN_MAX_WAIT_MS;
  return clamp(SYNC_MIN_MAX_WAIT_MS, Math.round(costMs * MAX_WAIT_FACTOR), SYNC_MAX_MAX_WAIT_MS);
}

/**
 * Delay for the next timer: the idle delay, but never past the ceiling measured
 * from when this burst of changes began.
 */
export function nextSyncWait(costMs: number, waitedMs: number): number {
  const remaining = syncMaxWaitFor(costMs) - Math.max(0, waitedMs);
  return Math.max(0, Math.min(syncDelayFor(costMs), remaining));
}
