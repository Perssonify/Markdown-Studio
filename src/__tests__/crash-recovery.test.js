/**
 * Edits typed inside the autosave window must survive a reload.
 *
 * `beforeunload` fires a best-effort autosave, but IndexedDB is asynchronous —
 * `saveActiveDoc` awaits a read before it writes, so the page is gone before
 * the write is issued. Measured in a browser: type a sentence, press ⌘R inside
 * the autosave window, and the text was on neither pane nor disk afterwards.
 * The in-memory draft cache does not survive a reload either.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECOVERY_KEY, clearStash, stashUnsaved, takeStashed } from "../store/crash-recovery";

const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("the unload stash", () => {
  beforeEach(() => { clearStash(); });

  it("round-trips an unsaved document", () => {
    expect(stashUnsaved([{ docId: "a", canonical: doc("hello"), at: Date.now() }])).toBe(1);
    const out = takeStashed();
    expect(out).toHaveLength(1);
    expect(out[0].docId).toBe("a");
    expect(out[0].canonical).toEqual(doc("hello"));
  });

  it("is ONE-SHOT — a stash cannot resurrect itself over newer content", () => {
    stashUnsaved([{ docId: "a", canonical: doc("hello"), at: Date.now() }]);
    expect(takeStashed()).toHaveLength(1);
    expect(takeStashed()).toEqual([]);   // taken means gone
    expect(localStorage.getItem(RECOVERY_KEY)).toBeNull();
  });

  it("drops entries older than a week", () => {
    const old = Date.now() - 8 * 24 * 60 * 60 * 1000;
    stashUnsaved([{ docId: "a", canonical: doc("stale"), at: old }]);
    expect(takeStashed()).toEqual([]);
  });

  it("ignores a corrupt stash instead of throwing", () => {
    localStorage.setItem(RECOVERY_KEY, "{not json");
    expect(takeStashed()).toEqual([]);
    localStorage.setItem(RECOVERY_KEY, JSON.stringify({ docId: "a" })); // not an array
    expect(takeStashed()).toEqual([]);
  });

  it("keeps the NEWEST entries when the budget runs out", () => {
    // localStorage is ~5MB for the whole origin; the stash must not try to be
    // the whole document store.
    const big = "x".repeat(1_500_000);
    const now = Date.now();
    const written = stashUnsaved([
      { docId: "old", canonical: doc(big), at: now - 60_000 },
      { docId: "new", canonical: doc(big), at: now },
    ]);
    expect(written).toBe(1);
    expect(takeStashed()[0].docId).toBe("new");
  });

  it("never throws when the store refuses the write", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => stashUnsaved([{ docId: "a", canonical: doc("x"), at: Date.now() }])).not.toThrow();
    expect(stashUnsaved([{ docId: "a", canonical: doc("x"), at: Date.now() }])).toBe(0);
    setItem.mockRestore();
  });

  it("skips a document it cannot serialise, and keeps the rest", () => {
    const cyclic = {};
    cyclic.self = cyclic;
    expect(stashUnsaved([
      { docId: "bad", canonical: cyclic, at: Date.now() },
      { docId: "good", canonical: doc("fine"), at: Date.now() - 1 },
    ])).toBe(1);
    expect(takeStashed()[0].docId).toBe("good");
  });
});

describe("the unload handler stashes what it cannot write", () => {
  const read = (p) => require("fs").readFileSync(require("path").join(process.cwd(), p), "utf8");
  const src = read("src/PerssonifyEditor.tsx");
  const handler = src.slice(
    src.indexOf("const handleBeforeUnload"),
    src.indexOf('window.addEventListener("beforeunload"')
  );

  it("writes the stash synchronously in the unload handler", () => {
    expect(handler).toContain("stashUnsaved(stash)");
    // No await: the whole point is that nothing asynchronous survives here.
    expect(handler).not.toMatch(/await\s/);
  });

  it("only stashes the editor's content for the document it actually holds", () => {
    // The editor's JSON belongs to hydratedDocId. Stashing it under activeDocId
    // when those differ is a cross-document overwrite.
    expect(handler).toMatch(/hydratedDocId === s\.activeDocId/);
  });

  it("honours the blank-over-content backstop", () => {
    expect(handler).toMatch(/isBlankCanonical\(live\)/);
  });

  it("also runs on pagehide (iOS never fires beforeunload)", () => {
    expect(src).toContain('window.addEventListener("pagehide"');
  });
});
