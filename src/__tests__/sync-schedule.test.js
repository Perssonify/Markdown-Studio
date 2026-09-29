/**
 * The projection scheduler's policy.
 *
 * The behaviour that matters is the CEILING: without it the debounce is purely
 * trailing, every keystroke resets it, and the other pane never updates while
 * you type — the reported symptom this replaced.
 */
import { describe, it, expect } from "vitest";
import { nextSyncCost, nextSyncWait, syncDelayFor, syncMaxWaitFor } from "../hooks/sync-schedule";
import {
  SYNC_MIN_DELAY_MS,
  SYNC_MAX_DELAY_MS,
  SYNC_MIN_MAX_WAIT_MS,
  SYNC_MAX_MAX_WAIT_MS,
} from "../constants";

describe("measured projection cost", () => {
  it("starts from the first sample rather than averaging against zero", () => {
    expect(nextSyncCost(0, 40)).toBe(40);
  });

  it("converges towards a steady cost", () => {
    let c = nextSyncCost(0, 10);
    for (let i = 0; i < 40; i++) c = nextSyncCost(c, 100);
    expect(c).toBeGreaterThan(99);
    expect(c).toBeLessThanOrEqual(100);
  });

  it("moves gradually, so one slow frame does not set the pace", () => {
    const c = nextSyncCost(20, 400);
    expect(c).toBeLessThan(200);
    expect(c).toBeGreaterThan(20);
  });

  it("ignores nonsense samples", () => {
    expect(nextSyncCost(50, NaN)).toBe(50 * 0.7);
    expect(nextSyncCost(50, -5)).toBe(50 * 0.7);
  });
});

describe("delays", () => {
  it("assumes cheap until something has been measured", () => {
    expect(syncDelayFor(0)).toBe(SYNC_MIN_DELAY_MS);
    expect(syncMaxWaitFor(0)).toBe(SYNC_MIN_MAX_WAIT_MS);
  });

  it("is clamped at both ends", () => {
    expect(syncDelayFor(1)).toBe(SYNC_MIN_DELAY_MS);
    expect(syncDelayFor(100000)).toBe(SYNC_MAX_DELAY_MS);
    expect(syncMaxWaitFor(1)).toBe(SYNC_MIN_MAX_WAIT_MS);
    expect(syncMaxWaitFor(100000)).toBe(SYNC_MAX_MAX_WAIT_MS);
  });

  it("backs off as projections get more expensive", () => {
    const cheap = syncMaxWaitFor(20);
    const dear = syncMaxWaitFor(120);
    expect(dear).toBeGreaterThan(cheap);
    // ...and never so far that the mirror is useless.
    expect(dear).toBeLessThanOrEqual(SYNC_MAX_MAX_WAIT_MS);
  });

  it("keeps the idle delay below the ceiling, so a pause always wins", () => {
    for (const cost of [0, 5, 20, 60, 150, 400, 2000]) {
      expect(syncDelayFor(cost)).toBeLessThanOrEqual(syncMaxWaitFor(cost));
    }
  });
});

describe("the ceiling on a burst of changes", () => {
  it("is the plain idle delay at the start of a burst", () => {
    expect(nextSyncWait(60, 0)).toBe(syncDelayFor(60));
  });

  it("shrinks as the burst goes on and reaches zero at the ceiling", () => {
    const cost = 60;
    const ceiling = syncMaxWaitFor(cost);
    let last = Infinity;
    for (let waited = 0; waited <= ceiling; waited += 50) {
      const w = nextSyncWait(cost, waited);
      expect(w).toBeLessThanOrEqual(last);
      expect(w).toBeGreaterThanOrEqual(0);
      last = w;
    }
    expect(nextSyncWait(cost, ceiling)).toBe(0);
    expect(nextSyncWait(cost, ceiling + 5000)).toBe(0);
  });

  it("never lets continuous typing postpone a projection indefinitely", () => {
    // Simulate typing a character every 40ms with the timer reset each time —
    // the exact pattern that starved the old pure-trailing debounce.
    for (const cost of [0, 10, 60, 200]) {
      let waited = 0;
      let fired = false;
      for (let i = 0; i < 200; i++) {
        if (nextSyncWait(cost, waited) === 0) { fired = true; break; }
        waited += 40;
      }
      expect(fired, `cost ${cost} never projected`).toBe(true);
      expect(waited).toBeLessThanOrEqual(SYNC_MAX_MAX_WAIT_MS);
    }
  });

  it("treats a negative or absurd elapsed time as the start of the burst", () => {
    expect(nextSyncWait(60, -1000)).toBe(syncDelayFor(60));
  });
});
