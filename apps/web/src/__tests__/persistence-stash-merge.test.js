/**
 * A027 — closing a window with two dirty tabs must keep BOTH tabs' stashes.
 *
 * Every tab of the origin writes the single `pf:recovery` key from its unload
 * handler, and the write was a whole-value `setItem`: the second tab's unload
 * erased the first tab's stash, so one tab's unsaved edits were gone after the
 * browser came back. The stash is now read-merge-written, newest entry per
 * document winning.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  RECOVERY_KEY, clearStash, configureRecovery, stashUnsaved, takeStashed,
} from "../store/persistence/crash-recovery";

const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

beforeEach(() => { configureRecovery(); clearStash(); });

describe("the unload stash across tabs", () => {
  it("a second tab's unload does not erase the first tab's stash", () => {
    const now = Date.now();
    // Tab 1 unloads, then tab 2 — the way a window close runs them.
    stashUnsaved([{ docId: "one", canonical: doc("tab one"), at: now }]);
    stashUnsaved([{ docId: "two", canonical: doc("tab two"), at: now + 5 }]);
    const out = takeStashed();
    expect(out.map((e) => e.docId).sort()).toEqual(["one", "two"]);
  });

  it("keeps the NEWEST entry when both tabs stashed the same document", () => {
    const now = Date.now();
    stashUnsaved([{ docId: "d", canonical: doc("older"), at: now }]);
    stashUnsaved([{ docId: "d", canonical: doc("newer"), at: now + 10 }]);
    // …and an older write arriving LAST does not win either.
    stashUnsaved([{ docId: "d", canonical: doc("stale"), at: now - 10 }]);
    const out = takeStashed();
    expect(out).toHaveLength(1);
    expect(out[0].canonical).toEqual(doc("newer"));
  });

  it("drops expired entries while merging", () => {
    const old = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem(RECOVERY_KEY, JSON.stringify([{ docId: "gone", canonical: doc("x"), at: old }]));
    stashUnsaved([{ docId: "fresh", canonical: doc("y"), at: Date.now() }]);
    expect(takeStashed().map((e) => e.docId)).toEqual(["fresh"]);
  });

  it("carries the draft's base and conflict marker through", () => {
    stashUnsaved([{ docId: "d", canonical: doc("x"), at: Date.now(), base: "2026-01-01T00:00:00.000Z", conflict: true }]);
    const [e] = takeStashed();
    expect(e.base).toBe("2026-01-01T00:00:00.000Z");
    expect(e.conflict).toBe(true);
  });
});

describe("host control of the stash (A103)", () => {
  it("a host can namespace the key without touching the default one", () => {
    configureRecovery({ key: "pf:recovery:tenant-7" });
    stashUnsaved([{ docId: "d", canonical: doc("tenant"), at: Date.now() }]);
    expect(localStorage.getItem(RECOVERY_KEY)).toBeNull();
    expect(localStorage.getItem("pf:recovery:tenant-7")).toContain("tenant");
    expect(takeStashed()).toHaveLength(1);
  });

  it("a host can turn the stash off entirely", () => {
    configureRecovery({ enabled: false });
    expect(stashUnsaved([{ docId: "d", canonical: doc("x"), at: Date.now() }])).toBe(0);
    expect(localStorage.getItem(RECOVERY_KEY)).toBeNull();
    expect(takeStashed()).toEqual([]);
  });
});
