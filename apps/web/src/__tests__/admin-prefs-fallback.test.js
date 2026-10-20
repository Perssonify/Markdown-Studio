/**
 * Admin-only switches must not stick once the Admin section is hidden.
 *
 * The Settings "Admin" section (the diagnostics console) is hidden in
 * production unless `pf:admin` is "1" (A081). A value stored before that gate
 * existed would otherwise stick with no control left to change it. The
 * store's initial state is read at module load, so each case loads a fresh
 * store after choosing the build flavour and the stored values.
 *
 * The custom right-click menu USED to be one of them. It is an everyday switch
 * now (Settings ▸ Editor — turning it off brings back the browser's own menu
 * and its spelling suggestions), so a stored choice is honoured in every build.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

async function freshStore({ dev, admin, stored }) {
  vi.resetModules();
  localStorage.clear();
  for (const [k, v] of Object.entries(stored)) localStorage.setItem(k, v);
  if (admin) localStorage.setItem("pf:admin", "1");
  const gates = await import("../utils/build-gates");
  gates._setDevBuildForTests(dev);
  const { useUIStore } = await import("../store/preferences/uiStore");
  return useUIStore.getState();
}

afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

const STALE = { "pf:context-menu": "false", "pf:console": "true" };

describe("admin-only preferences", () => {
  it("fall back to the defaults in production without the admin opt-in", async () => {
    const s = await freshStore({ dev: false, admin: false, stored: STALE });
    expect(s.consoleEnabled).toBe(false);
  });

  it("honour the stored values when the Admin section is available (opt-in)", async () => {
    const s = await freshStore({ dev: false, admin: true, stored: STALE });
    expect(s.consoleEnabled).toBe(true);
  });

  it("honour the stored values in a development build", async () => {
    const s = await freshStore({ dev: true, admin: false, stored: STALE });
    expect(s.consoleEnabled).toBe(true);
  });
});

describe("the custom right-click menu (an everyday setting)", () => {
  it.each([
    ["production", { dev: false, admin: false }],
    ["an admin opt-in", { dev: false, admin: true }],
    ["a development build", { dev: true, admin: false }],
  ])("keeps the user's choice in %s", async (_name, flavour) => {
    expect((await freshStore({ ...flavour, stored: { "pf:context-menu": "false" } })).contextMenuEnabled).toBe(false);
    expect((await freshStore({ ...flavour, stored: {} })).contextMenuEnabled).toBe(true);
  });
});
