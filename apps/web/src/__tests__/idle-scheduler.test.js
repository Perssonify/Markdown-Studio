import { afterEach, describe, expect, it, vi } from "vitest";
import { runWhenIdle } from "../utils/idle";

/**
 * runWhenIdle drives the markdown→rich projection's preparation (A083): slices
 * of work in idle time until the work says it is done.
 */
describe("runWhenIdle", () => {
  afterEach(() => {
    delete window.requestIdleCallback;
    delete window.cancelIdleCallback;
    vi.useRealTimers();
  });

  function idle() {
    const queue = [];
    window.requestIdleCallback = vi.fn((cb) => { queue.push(cb); return queue.length; });
    window.cancelIdleCallback = vi.fn();
    return queue;
  }

  it("runs a slice per idle callback until the work is done, with the deadline as its clock", () => {
    const queue = idle();
    const seen = [];
    let left = 3;
    runWhenIdle((timeUp) => {
      seen.push(timeUp());
      return --left === 0;
    });
    expect(queue).toHaveLength(1);
    queue.shift()({ timeRemaining: () => 20 });
    queue.shift()({ timeRemaining: () => 0 });
    queue.shift()({ timeRemaining: () => 20 });
    expect(seen).toEqual([false, true, false]);
    expect(queue).toHaveLength(0); // done: nothing more scheduled
  });

  it("cancels what is still scheduled", () => {
    const queue = idle();
    const work = vi.fn(() => false);
    const cancel = runWhenIdle(work);
    cancel();
    expect(window.cancelIdleCallback).toHaveBeenCalledWith(1);
    queue.shift()?.({ timeRemaining: () => 20 }); // a browser that ran it anyway
    expect(work).not.toHaveBeenCalled();
  });

  it("ends the work when a slice throws", () => {
    const queue = idle();
    const work = vi.fn(() => { throw new Error("boom"); });
    runWhenIdle(work);
    queue.shift()({ timeRemaining: () => 20 });
    expect(work).toHaveBeenCalledTimes(1);
    expect(queue).toHaveLength(0);
  });

  it("falls back to a timer with a budget per slice where there is no requestIdleCallback (Safari)", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    expect(window.requestIdleCallback).toBeUndefined();
    const seen = [];
    let left = 2;
    const cancel = runWhenIdle((timeUp) => {
      seen.push(timeUp());
      vi.advanceTimersByTime(10); // the slice's own work: past its 8 ms budget
      seen.push(timeUp());
      return --left === 0;
    });
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(50);
    expect(seen).toEqual([false, true]);
    vi.advanceTimersByTime(50);
    expect(seen).toEqual([false, true, false, true]);
    vi.advanceTimersByTime(500);
    expect(seen).toHaveLength(4); // done
    cancel();
  });
});
