/**
 * Admin-only switches must not stick once the Admin section is hidden.
 *
 * The Settings "Admin" section (context-menu switch, diagnostics console) is
 * hidden in production unless `pf:admin` is "1" (A081). A user who turned the
 * custom context menu OFF before that gate existed would otherwise keep the
 * native menu forever, with no control left to turn it back on. The store's
 * initial state is read at module load, so each case loads a fresh store after
 * choosing the build flavour and the stored values.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

async function freshStore({ dev, admin, stored }) {
  vi.resetModules();
  localStorage.clear();
  for (const [k, v] of Object.entries(stored)) localStorage.setItem(k, v);
  if (admin) localStorage.setItem("pf:admin", "1");
  const gates = await import("../utils/build-gates");
  gates._setDevBuildForTests(dev);
  const { useUIStore } = await import("../store/uiStore");
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
    expect(s.contextMenuEnabled).toBe(true);
    expect(s.consoleEnabled).toBe(false);
  });

  it("honour the stored values when the Admin section is available (opt-in)", async () => {
    const s = await freshStore({ dev: false, admin: true, stored: STALE });
    expect(s.contextMenuEnabled).toBe(false);
    expect(s.consoleEnabled).toBe(true);
  });

  it("honour the stored values in a development build", async () => {
    const s = await freshStore({ dev: true, admin: false, stored: STALE });
    expect(s.contextMenuEnabled).toBe(false);
    expect(s.consoleEnabled).toBe(true);
  });
});
