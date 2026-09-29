import { afterEach, describe, expect, it, vi } from "vitest";

async function importFreshDiag() {
  vi.resetModules();
  return import("../utils/diag");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  localStorage.clear();
  history.replaceState(null, "", "/");
});

describe("diagnostic logging gate", () => {
  it("does not write console info by default", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { diag, isDiagEnabled } = await importFreshDiag();

    expect(isDiagEnabled()).toBe(false);
    diag("BOOT", "rendered");

    expect(info).not.toHaveBeenCalled();
  });

  it("can be enabled for explicit troubleshooting", async () => {
    localStorage.setItem("perssonify-diag", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { diag, isDiagEnabled } = await importFreshDiag();

    expect(isDiagEnabled()).toBe(true);
    diag("BOOT", "rendered");

    expect(info).toHaveBeenCalledWith(expect.stringContaining("[DIAG"));
    expect(info).toHaveBeenCalledWith(expect.stringContaining("[BOOT] rendered"));
  });
});
