/**
 * The boot watchdog in index.html must recover a load that CANNOT boot — and
 * must never wipe a slow or offline one (A011).
 *
 * It used to fire on an 8 s timer alone: a slow phone (the startup bundle does
 * not load in 8 s on slow 3G) had its service worker unregistered and every
 * cache deleted, then reloaded — offline, onto the browser's error page.
 *
 * These cases execute the SHIPPED inline script (read out of index.html) in a
 * sandbox with fake browser APIs, so they test the code users actually run.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const WATCHDOG = scripts.find((s) => s.includes("Boot watchdog"));

function boot({ online = true, recoveredAt = null } = {}) {
  const listeners = {};
  const timers = [];
  const session = new Map(recoveredAt ? [["pf:boot-recover-at", String(recoveredAt)]] : []);
  const local = new Map();
  const calls = { reload: 0, unregistered: 0, cachesDeleted: [] };
  const sandbox = {
    __PF_BOOTED: false,
    navigator: {
      onLine: online,
      serviceWorker: { getRegistrations: async () => [{ unregister: async () => calls.unregistered++ }] },
    },
    caches: { keys: async () => ["workbox-precache-v2-x", "app-scripts"], delete: async (k) => calls.cachesDeleted.push(k) },
    sessionStorage: { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => session.set(k, String(v)) },
    localStorage: { getItem: (k) => local.get(k) ?? null, setItem: (k, v) => local.set(k, String(v)) },
    location: { reload: () => calls.reload++ },
    setTimeout: (fn, ms) => timers.push({ fn, ms }) && timers.length,
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
    Promise,
    Date,
    JSON,
    Number,
    String,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(WATCHDOG, sandbox);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return {
    sandbox,
    calls,
    local,
    /** Advance time: run every pending timer, then let the cleanup promises settle. */
    async elapse() {
      for (const t of timers.splice(0)) t.fn();
      await settle();
      await settle();
    },
    fire(type, event) {
      for (const fn of listeners[type] || []) fn(event);
    },
    scriptFailed() {
      this.fire("error", { target: { tagName: "SCRIPT" } });
    },
  };
}

describe("boot watchdog", () => {
  it("is present in index.html", () => {
    expect(WATCHDOG).toBeTruthy();
  });

  it("does NOTHING to a slow boot with no evidence of failure (the A011 wipe)", async () => {
    const w = boot();
    await w.elapse(); // however long it takes
    await w.elapse();
    expect(w.calls.reload).toBe(0);
    expect(w.calls.cachesDeleted).toEqual([]);
    expect(w.calls.unregistered).toBe(0);
  });

  it("recovers online after a script failed to load: unregisters, clears caches, leaves a note, reloads once", async () => {
    const w = boot({ online: true });
    w.scriptFailed();
    await w.elapse();
    expect(w.calls.unregistered).toBe(1);
    expect(w.calls.cachesDeleted).toEqual(["workbox-precache-v2-x", "app-scripts"]);
    expect(w.calls.reload).toBe(1);
    expect(JSON.parse(w.local.get("pf:boot-recovered")).reason).toBe("failed-to-load:script");
  });

  it("never touches the caches offline — and recovers once back online", async () => {
    const w = boot({ online: false });
    w.scriptFailed();
    await w.elapse();
    expect(w.calls.reload).toBe(0);
    expect(w.calls.cachesDeleted).toEqual([]);
    w.sandbox.navigator.onLine = true;
    w.fire("online", {});
    await w.elapse();
    expect(w.calls.reload).toBe(1);
  });

  it("stands down if the app boots within the grace period (e.g. only a stylesheet failed)", async () => {
    const w = boot();
    w.fire("error", { target: { tagName: "LINK" } });
    w.sandbox.__PF_BOOTED = true;
    await w.elapse();
    expect(w.calls.reload).toBe(0);
  });

  it("treats an uncaught error before boot as evidence too", async () => {
    const w = boot();
    w.fire("error", { target: w.sandbox, error: new SyntaxError("Unexpected token '<'"), message: "Unexpected token '<'" });
    await w.elapse();
    expect(w.calls.reload).toBe(1);
    expect(JSON.parse(w.local.get("pf:boot-recovered")).reason).toBe("boot-error");
  });

  it("does not loop: no second recovery within 30 s", async () => {
    const w = boot({ recoveredAt: Date.now() - 5_000 });
    w.scriptFailed();
    await w.elapse();
    expect(w.calls.reload).toBe(0);
  });

  it("ignores errors after the app has booted", async () => {
    const w = boot();
    w.sandbox.__PF_BOOTED = true;
    w.scriptFailed();
    await w.elapse();
    expect(w.calls.reload).toBe(0);
  });
});
