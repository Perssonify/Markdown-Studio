/**
 * A KaTeX chunk that failed to load is retried, not remembered (A085).
 *
 * The maths node view memoised `import("katex")` for the session, so one failed
 * fetch (offline, a purged deploy) left every formula unrendered until a
 * reload. It now memoises only a pending or fulfilled import.
 */
import { describe, expect, it, vi } from "vitest";

let fail = true;
vi.mock("katex", () => ({
  get default() {
    if (fail) throw new TypeError("Failed to fetch dynamically imported module: /assets/katex-abc.js");
    return { render: () => {} };
  },
}));

import { getKatex } from "../extensions/MathNodes";

describe("getKatex", () => {
  it("tries again after a failed load instead of replaying the failure", async () => {
    await expect(getKatex()).rejects.toThrow(/dynamically imported module/);
    fail = false;
    const katex = await getKatex();
    expect(typeof katex.render).toBe("function");
  });
});
