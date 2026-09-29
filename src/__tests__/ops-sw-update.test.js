/**
 * A deploy must never force-reload a tab (A008).
 *
 * It was autoUpdate + skipWaiting + clientsClaim, a controllerchange listener
 * that called location.reload(), and a worker script that navigated every open
 * window on activation. These cases drive the new prompt flow against a fake
 * `registerSW` (the vite-plugin-pwa contract: onNeedRefresh when a worker is
 * waiting, onNeedReload when a new worker has taken control).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupServiceWorkerUpdates } from "../pwa/sw-updates";
import { _resetDiagnosticsForTests, getDiagnostics } from "../utils/diagnostics";

function harness({ online = true, hidden = false, unsaved = false } = {}) {
  const state = { online, hidden, unsaved };
  const calls = { reload: 0, skipWaiting: 0, notices: [] };
  const timers = [];
  const chances = [];
  let cb = null;
  const registerSW = (options) => {
    cb = options;
    return vi.fn(async () => {
      calls.skipWaiting++;
    });
  };
  const env = {
    online: () => state.online,
    hidden: () => state.hidden,
    unsaved: () => state.unsaved,
    reload: () => calls.reload++,
    notify: (notice) => calls.notices.push(notice),
    onChance: (fn) => {
      chances.push(fn);
      return () => {};
    },
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
  };
  const ctl = setupServiceWorkerUpdates(registerSW, env);
  return {
    state,
    calls,
    ctl,
    waiting: () => cb.onNeedRefresh(),
    tookControl: () => cb.onNeedReload(),
    registerError: (e) => cb.onRegisterError(e),
    /** Something changed (visibility, connectivity): re-take waiting decisions. */
    chance: () => chances.forEach((fn) => fn()),
    runTimers: () => timers.splice(0).forEach((t) => t.fn()),
  };
}

beforeEach(() => {
  localStorage.clear();
  _resetDiagnosticsForTests();
});

describe("a new version is waiting", () => {
  it("prompts — and never reloads or activates by itself, even in a clean background tab", () => {
    const h = harness({ hidden: true, unsaved: false });
    h.waiting();
    h.chance();
    h.runTimers();
    expect(h.calls.notices).toEqual(["ready"]);
    expect(h.calls.reload).toBe(0);
    expect(h.calls.skipWaiting).toBe(0);
  });

  it("the Reload button activates it, then reloads once it has taken control", async () => {
    const h = harness({ unsaved: true, hidden: false });
    h.waiting();
    h.ctl.apply();
    expect(h.calls.skipWaiting).toBe(1);
    expect(h.calls.reload).toBe(0); // not before the new worker controls the page
    h.tookControl();
    expect(h.calls.reload).toBe(1); // the user asked — the beforeunload guard still protects unsaved work
  });

  it("the Reload button does nothing drastic offline", () => {
    const h = harness({ online: false });
    h.waiting();
    h.ctl.apply();
    expect(h.calls.skipWaiting).toBe(0);
    expect(h.calls.reload).toBe(0);
    expect(h.calls.notices).toEqual(["ready", "offline"]);
  });
});

describe("another tab activated the new version (this tab runs the old build)", () => {
  it("does not reload over unsaved work — it asks, then reloads when the tab is clean and in the background", () => {
    const h = harness({ unsaved: true, hidden: false });
    h.waiting();
    h.tookControl();
    expect(h.calls.reload).toBe(0);
    expect(h.calls.notices.at(-1)).toBe("activated");
    h.state.hidden = true; // still unsaved
    h.chance();
    expect(h.calls.reload).toBe(0);
    h.state.unsaved = false; // saved, still in the background
    h.chance();
    expect(h.calls.reload).toBe(1);
  });

  it("does not reload a clean tab the user is looking at", () => {
    const h = harness({ unsaved: false, hidden: false });
    h.waiting();
    h.tookControl();
    expect(h.calls.reload).toBe(0);
    h.state.hidden = true;
    h.chance();
    expect(h.calls.reload).toBe(1);
  });

  it("never reloads offline — not even a clean background tab", () => {
    const h = harness({ online: false, unsaved: false, hidden: true });
    h.waiting();
    h.tookControl();
    expect(h.calls.reload).toBe(0);
    h.state.online = true;
    h.chance();
    expect(h.calls.reload).toBe(1);
  });

  it("reloads a clean background tab straight away", () => {
    const h = harness({ unsaved: false, hidden: true });
    h.waiting();
    h.tookControl();
    expect(h.calls.reload).toBe(1);
  });

  it("offers the update again if the user kept the page (declined the unsaved-changes prompt)", () => {
    const h = harness({ unsaved: true });
    h.waiting();
    h.tookControl();
    h.ctl.apply();
    expect(h.calls.reload).toBe(1);
    h.runTimers(); // still alive after the reload attempt
    expect(h.calls.notices.at(-1)).toBe("activated");
    h.chance(); // unsaved, visible: must not retry on its own
    expect(h.calls.reload).toBe(1);
  });
});

describe("registration problems", () => {
  it("are recorded in the diagnostics ring", () => {
    const h = harness();
    h.registerError(new Error("SecurityError: The operation is insecure."));
    expect(getDiagnostics()[0]).toMatchObject({ kind: "sw", name: "ServiceWorkerRegistration" });
  });
});
