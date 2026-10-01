import { beforeEach, describe, it, expect } from "vitest";
import { fetchImportResource } from "../store/url-import";

const DRIVE_VIEW = "https://drive.google.com/file/d/12a4D7oHxJ7bKlkJV6hpQMS5FX8iPXSnD/view?usp=sharing";

function md(body, ct = "text/markdown") {
  return new Response(body, { status: 200, headers: { "content-type": ct } });
}

// The relay is opt-in (A076): these cases exercise the relay PATH, so the
// visitor says yes. Consent itself is covered by g4-relay-consent.test.js.
const allowRelay = async () => true;
beforeEach(() => localStorage.clear());

describe("fetchImportResource — direct vs proxy fallback", () => {
  it("uses a direct fetch (no proxy) for a CORS-friendly host", async () => {
    const calls = [];
    const fetchImpl = async (href) => {
      calls.push(href);
      return md("# Direct");
    };
    const r = await fetchImportResource("https://example.com/notes.md", { fetchImpl });
    expect(r.kind).toBe("text");
    expect(r.viaProxy).toBe(false);
    expect(r.text).toContain("Direct");
    expect(calls.every((u) => !u.includes("allorigins"))).toBe(true);
  });

  it("falls back to the same-origin import relay when the direct fetch is blocked", async () => {
    const calls = [];
    const fetchImpl = async (href) => {
      calls.push(href);
      if (href.includes("/api/import")) return md("# Relayed", "application/octet-stream");
      throw new TypeError("Failed to fetch"); // simulates a CORS block
    };
    const r = await fetchImportResource(DRIVE_VIEW, { fetchImpl, confirmRelay: allowRelay });
    expect(r.viaProxy).toBe(true);
    expect(r.text).toContain("Relayed");
    // The relay wraps the *normalized* Drive download URL.
    const relayed = calls.find((u) => u.includes("/api/import?url="));
    expect(relayed).toBeTruthy();
    expect(decodeURIComponent(relayed)).toContain("drive.usercontent.google.com/download");
  });

  it("gives a download-and-drop hint when both direct and relay fail", async () => {
    const fetchImpl = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(fetchImportResource("https://example.com/notes.md", { fetchImpl, confirmRelay: allowRelay })).rejects.toThrow(
      /Download the file and drag it in/i,
    );
  });

  it("still rejects a Google sign-in HTML page fetched via the relay (restricted file)", async () => {
    const fetchImpl = async (href) => {
      if (href.includes("/api/import"))
        return md("<!DOCTYPE html><html><head><title>Sign in - Google Accounts</title>", "application/octet-stream");
      throw new TypeError("Failed to fetch");
    };
    await expect(fetchImportResource(DRIVE_VIEW, { fetchImpl, confirmRelay: allowRelay })).rejects.toThrow(/sign-in or confirmation page/i);
  });
});
