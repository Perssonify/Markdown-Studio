import { beforeEach, describe, expect, it } from "vitest";
import { formatEstBytes, historyCache } from "../store/history-cache";

const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("historyCache", () => {
  beforeEach(() => historyCache._resetForTests());

  it("captures and restores when content matches", () => {
    const d = doc("hello");
    historyCache.capture("a", { pm: 1 }, d, { cm: 1 }, "hello", 3);
    const hit = historyCache.takeForRestore("a", d, "hello");
    expect(hit).toBeTruthy();
    expect(hit.tiptapState).toEqual({ pm: 1 });
    expect(hit.cmValid).toBe(true);
  });

  it("REFUSES to restore when the content diverged, and drops the entry", () => {
    historyCache.capture("a", { pm: 1 }, doc("hello"), { cm: 1 }, "hello", 3);
    const miss = historyCache.takeForRestore("a", doc("CHANGED elsewhere"), "hello");
    expect(miss).toBeNull();
    // Entry must be gone — a stale cache can never be restored later either.
    expect(historyCache.getStats().entryCount).toBe(0);
  });

  it("flags cm as invalid separately when only the md projection diverged", () => {
    const d = doc("hello");
    historyCache.capture("a", { pm: 1 }, d, { cm: 1 }, "hello", 0);
    const hit = historyCache.takeForRestore("a", d, "different md");
    expect(hit).toBeTruthy();
    expect(hit.cmValid).toBe(false);
  });

  it("evicts least-recently-captured beyond maxDocs", () => {
    historyCache.setConfig({ maxDocs: 2 });
    historyCache.capture("a", {}, doc("a"), {}, "a", 0);
    historyCache.capture("b", {}, doc("b"), {}, "b", 0);
    historyCache.capture("c", {}, doc("c"), {}, "c", 0);
    const ids = historyCache.getStats().entries.map((e) => e.docId);
    expect(ids).toEqual(["b", "c"]);
  });

  it("re-capturing a doc refreshes its LRU position", () => {
    historyCache.setConfig({ maxDocs: 2 });
    historyCache.capture("a", {}, doc("a"), {}, "a", 0);
    historyCache.capture("b", {}, doc("b"), {}, "b", 0);
    historyCache.capture("a", {}, doc("a2"), {}, "a2", 0); // refresh a
    historyCache.capture("c", {}, doc("c"), {}, "c", 0);   // should evict b
    const ids = historyCache.getStats().entries.map((e) => e.docId).sort();
    expect(ids).toEqual(["a", "c"]);
  });

  it("evicts to stay under the estimated byte budget", () => {
    historyCache.setConfig({ maxDocs: 50, maxMB: 1 });
    const big = "x".repeat(400_000); // ~800KB estimated per entry
    historyCache.capture("a", {}, doc(big), {}, "", 0);
    historyCache.capture("b", {}, doc(big), {}, "", 0);
    const stats = historyCache.getStats();
    expect(stats.entryCount).toBe(1);
    expect(stats.entries[0].docId).toBe("b");
    expect(stats.totalEstBytes).toBeLessThanOrEqual(stats.budgetBytes);
  });

  it("disabling clears the cache and blocks capture/restore", () => {
    historyCache.capture("a", {}, doc("a"), {}, "a", 0);
    historyCache.setConfig({ enabled: false });
    expect(historyCache.getStats().entryCount).toBe(0);
    historyCache.capture("b", {}, doc("b"), {}, "b", 0);
    expect(historyCache.getStats().entryCount).toBe(0);
    expect(historyCache.takeForRestore("a", doc("a"), "a")).toBeNull();
  });

  it("drop() removes a single entry; clear() removes all", () => {
    historyCache.capture("a", {}, doc("a"), {}, "a", 0);
    historyCache.capture("b", {}, doc("b"), {}, "b", 0);
    historyCache.drop("a");
    expect(historyCache.getStats().entries.map((e) => e.docId)).toEqual(["b"]);
    historyCache.clear();
    expect(historyCache.getStats().entryCount).toBe(0);
  });

  it("clamps config to sane ranges and notifies subscribers", () => {
    let notified = 0;
    const unsub = historyCache.subscribe(() => notified++);
    historyCache.setConfig({ maxDocs: 0, maxMB: 100000 });
    const cfg = historyCache.getConfig();
    expect(cfg.maxDocs).toBe(1);
    expect(cfg.maxMB).toBe(512);
    expect(notified).toBeGreaterThan(0);
    unsub();
  });

  it("getStats returns a stable snapshot between mutations (for useSyncExternalStore)", () => {
    historyCache.capture("a", {}, doc("a"), {}, "a", 0);
    const s1 = historyCache.getStats();
    const s2 = historyCache.getStats();
    expect(s1).toBe(s2);
    historyCache.drop("a");
    expect(historyCache.getStats()).not.toBe(s1);
  });

  it("formatEstBytes renders sensible units", () => {
    expect(formatEstBytes(512)).toBe("512 B");
    expect(formatEstBytes(4096)).toBe("4 KB");
    expect(formatEstBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
