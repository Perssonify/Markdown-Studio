/**
 * A dynamic import that failed once must not stay failed for the session, and a
 * chunk-load failure must be told apart from a genuine render error.
 *
 * DiagramPreview kept its `import("mermaid")` promise in a module variable, so
 * one offline moment left every diagram broken until a reload — even after the
 * network came back.
 */
import { describe, expect, it, vi } from "vitest";
import { cachedImport, isChunkLoadError } from "../utils/lazy-import";

describe("cachedImport", () => {
  it("memoises a successful import (one load for many callers)", async () => {
    const load = vi.fn(async () => ({ default: 1 }));
    const get = cachedImport(load);
    const [a, b] = await Promise.all([get(), get()]);
    await get();
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("forgets a FAILED import so the next call tries again", async () => {
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new TypeError("Failed to fetch dynamically imported module: /assets/mermaid.js");
      return "loaded";
    });
    const get = cachedImport(load);
    await expect(get()).rejects.toThrow(/Failed to fetch/);
    fail = false;
    await expect(get()).resolves.toBe("loaded");
    expect(load).toHaveBeenCalledTimes(2);
    // …and once it has succeeded, it is memoised again.
    await get();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("isChunkLoadError", () => {
  it("recognises each browser's wording, and Vite's", () => {
    for (const message of [
      "Failed to fetch dynamically imported module: https://markdownstudio.com/assets/FindReplace-abc.js", // Chromium
      "error loading dynamically imported module: https://markdownstudio.com/assets/x.js", // Firefox
      "Importing a module script failed.", // Safari
      "Unable to preload CSS for /assets/GraphView-abc.css", // Vite preload helper
    ]) {
      expect(isChunkLoadError(new TypeError(message)), message).toBe(true);
    }
    expect(isChunkLoadError(Object.assign(new Error("x"), { name: "ChunkLoadError" }))).toBe(true);
  });

  it("does NOT classify an ordinary render error as a chunk failure", () => {
    for (const err of [
      new TypeError("Cannot read properties of undefined (reading 'type')"),
      new RangeError("Maximum call stack size exceeded"),
      new Error("Parse error on line 2"),
      null,
      undefined,
      "",
    ]) {
      expect(isChunkLoadError(err), String(err)).toBe(false);
    }
  });
});
