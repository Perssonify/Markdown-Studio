/**
 * A browser that BLOCKS site data must still run the app.
 *
 * Every call site guarded SSR with `typeof localStorage === "undefined"`. That
 * does not cover what actually happens in a browser: with site data blocked the
 * `localStorage` getter throws a SecurityError, and `typeof localStorage`
 * evaluates the getter, so the guard throws too. `uiStore`'s reads run at MODULE
 * SCOPE with no try anywhere, which means the store module fails to evaluate and
 * the app never renders. The e2e fault tier blocks IndexedDB, not this.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** Replace `localStorage` with a property whose getter throws, as Chrome does. */
function blockSiteData() {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() { throw new DOMException("Access is denied for this document.", "SecurityError"); },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  };
}

describe("safeStorage never throws", () => {
  let restore;
  beforeEach(() => { restore = blockSiteData(); });
  afterEach(() => { restore(); });

  it("reads, writes and reports availability without throwing", async () => {
    const { safeStorage } = await import("../utils/safe-storage");
    expect(() => safeStorage.get("pf:anything")).not.toThrow();
    expect(safeStorage.get("pf:anything")).toBeNull();
    expect(() => safeStorage.set("pf:anything", "1")).not.toThrow();
    expect(() => safeStorage.remove("pf:anything")).not.toThrow();
    expect(safeStorage.available()).toBe(false);
  });

  it("a blocked read is indistinguishable from an unset one, so defaults apply", async () => {
    const { safeStorage } = await import("../utils/safe-storage");
    // This is what every uiStore initialiser relies on.
    expect(safeStorage.get("pf:paste-styled") !== "false").toBe(true);   // styled paste default
    expect(safeStorage.get("pf:show-ads") === "true").toBe(false);       // ads default off
    expect(Number(safeStorage.get("pf:font-size")) || 15).toBe(15);
  });

  it("the crash-recovery stash degrades instead of throwing", async () => {
    const { stashUnsaved, takeStashed, clearStash } = await import("../store/persistence/crash-recovery");
    expect(stashUnsaved([{ docId: "a", canonical: { type: "doc" }, at: Date.now() }])).toBe(0);
    expect(takeStashed()).toEqual([]);
    expect(() => clearStash()).not.toThrow();
  });

  it("choosing a storage adapter does not throw", async () => {
    const { createStorageAdapter } = await import("../store/persistence/storage-adapter");
    expect(() => createStorageAdapter()).not.toThrow();
  });

  it("the palette falls back to its default", async () => {
    const { getStoredPalette, setPalette } = await import("../theme/palette");
    expect(() => getStoredPalette()).not.toThrow();
    expect(() => setPalette("blue")).not.toThrow();
  });
});

describe("no module reads localStorage unguarded at module scope", () => {
  it("uiStore evaluates with site data blocked", async () => {
    // The boot-blocker: these run inside the store initialiser, at import time.
    const restore = blockSiteData();
    try {
      const mod = await import("../store/preferences/uiStore");
      expect(typeof mod.useUIStore.getState().mode).toBe("string");
      expect(mod.useUIStore.getState().editorFontSize).toBe(15);
    } finally {
      restore();
    }
  });
});
