/**
 * A slow direct import is a timeout, not a blocked site.
 *
 * `AbortSignal.timeout()` rejects the fetch with a DOMException named
 * "TimeoutError". The importer only recognised "AbortError" (what its
 * setTimeout fallback produces), so on every modern browser a slow origin fell
 * through to the CORS path — and the user was asked to allow the server relay
 * for a site that had simply not answered yet.
 */
import { describe, expect, it, vi } from "vitest";
import { fetchImportResource } from "../store/importExport/url-import";

describe("direct import timeout", () => {
  it.each(["TimeoutError", "AbortError"])("a %s says it timed out and never asks about the relay", async (name) => {
    const fetchImpl = vi.fn(async () => { throw new DOMException("signal timed out", name); });
    const confirmRelay = vi.fn(async () => true);
    await expect(fetchImportResource("https://slow.example/notes.md", { fetchImpl, confirmRelay })).rejects.toThrow(/timed out/);
    expect(confirmRelay).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
