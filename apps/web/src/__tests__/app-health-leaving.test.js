/**
 * Leaving the page is never overridden by a chunk-failure reload.
 *
 * Firefox rejects the old page's in-flight dynamic imports as it navigates
 * away, and the "a lazy chunk failed" handler reloaded the app — cancelling the
 * user's navigation (measured: 6 of 12 navigations in the first ~0.7s after
 * load; e2e/probes/leave-during-lazy-chunk.mjs). beforeunload and pagehide fire
 * first, so a failure after them is the navigation's doing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _setPageLeavingForTests,
  CHUNK_RELOAD_KEY,
  isPageLeaving,
  pageActions,
  reloadForChunkErrorIfSafe,
  trackPageLeaving,
} from "../utils/app-health";

const realReload = pageActions.reload;
beforeEach(() => {
  sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  pageActions.reload = vi.fn();
  _setPageLeavingForTests(0);
});
afterEach(() => {
  pageActions.reload = realReload;
  _setPageLeavingForTests(0);
});

describe("page leaving", () => {
  it("a chunk failure while the page is being left does not reload", () => {
    trackPageLeaving();
    window.dispatchEvent(new Event("beforeunload"));
    expect(isPageLeaving()).toBe(true);
    expect(reloadForChunkErrorIfSafe()).toBe(false);
    expect(pageActions.reload).not.toHaveBeenCalled();
  });

  it("pagehide counts as leaving too (iOS Safari sends no beforeunload)", () => {
    trackPageLeaving();
    window.dispatchEvent(new Event("pagehide"));
    expect(reloadForChunkErrorIfSafe()).toBe(false);
  });

  it("a page that stayed (a cancelled leave, or restored from bfcache) may reload again", () => {
    trackPageLeaving();
    _setPageLeavingForTests(Date.now() - 11_000); // the leave never happened
    expect(isPageLeaving()).toBe(false);
    window.dispatchEvent(new Event("beforeunload"));
    window.dispatchEvent(new Event("pageshow"));
    expect(isPageLeaving()).toBe(false);
    expect(reloadForChunkErrorIfSafe()).toBe(true);
    expect(pageActions.reload).toHaveBeenCalledTimes(1);
  });
});
