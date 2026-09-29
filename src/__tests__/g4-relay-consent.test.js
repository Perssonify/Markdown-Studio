/**
 * A076 — the import relay is opt-in.
 *
 * On a CORS failure `fetchImportResource` used to retry through `/api/import`
 * automatically, sending the address being imported (share links often carry
 * tokens) to our server under a privacy story that said nothing ever leaves the
 * browser. It now asks once — before the first use — and remembers the answer
 * under `pf:import-relay`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RELAY_CONSENT_KEY,
  fetchImportResource,
  getRelayConsent,
  relayConsentPrompt,
  setRelayConsent,
} from "../store/url-import";

const URL_ = "https://example.com/notes.md";

function md(body) {
  return new Response(body, { status: 200, headers: { "content-type": "text/markdown" } });
}

/** Direct fetch blocked (CORS); the relay would answer. Records every call. */
function blockedHost() {
  const calls = [];
  const fetchImpl = async (href) => {
    calls.push(href);
    if (href.startsWith("/api/import")) return md("# relayed");
    throw new TypeError("Failed to fetch");
  };
  return { calls, fetchImpl, relayed: () => calls.some((c) => c.startsWith("/api/import")) };
}

beforeEach(() => localStorage.clear());

describe("before any answer", () => {
  it("never uses the relay without a way to ask", async () => {
    const h = blockedHost();
    const err = await fetchImportResource(URL_, { fetchImpl: h.fetchImpl }).catch((e) => e);
    expect(err.message).toMatch(/Settings ▸ Privacy/);
    expect(err.isCorsLikely).toBe(true);
    expect(h.relayed()).toBe(false);
    expect(getRelayConsent()).toBe(null); // nothing was decided for the user
  });

  it("does not ask when the direct fetch works", async () => {
    const confirmRelay = vi.fn(async () => true);
    const r = await fetchImportResource(URL_, { fetchImpl: async () => md("# direct"), confirmRelay });
    expect(r.viaProxy).toBe(false);
    expect(confirmRelay).not.toHaveBeenCalled();
    expect(getRelayConsent()).toBe(null);
  });
});

describe("asking", () => {
  it("a 'no' keeps the request in the browser — and is remembered", async () => {
    const h = blockedHost();
    const confirmRelay = vi.fn(async () => false);
    await expect(fetchImportResource(URL_, { fetchImpl: h.fetchImpl, confirmRelay })).rejects.toThrow(/turned off/);
    expect(h.relayed()).toBe(false);
    expect(localStorage.getItem(RELAY_CONSENT_KEY)).toBe("deny");

    // Asked ONCE: the next blocked import does not ask again, and still stays local.
    await expect(fetchImportResource(URL_, { fetchImpl: h.fetchImpl, confirmRelay })).rejects.toThrow();
    expect(confirmRelay).toHaveBeenCalledTimes(1);
    expect(h.relayed()).toBe(false);
  });

  it("a 'yes' uses the relay — and is remembered", async () => {
    const h = blockedHost();
    const confirmRelay = vi.fn(async () => true);
    const r = await fetchImportResource(URL_, { fetchImpl: h.fetchImpl, confirmRelay });
    expect(r.viaProxy).toBe(true);
    expect(localStorage.getItem(RELAY_CONSENT_KEY)).toBe("allow");
    // The question names the host being fetched.
    expect(confirmRelay.mock.calls[0][0].hostname).toBe("example.com");

    await fetchImportResource(URL_, { fetchImpl: h.fetchImpl, confirmRelay });
    expect(confirmRelay).toHaveBeenCalledTimes(1);
  });

  it("a prompt that fails counts as 'no'", async () => {
    const h = blockedHost();
    await expect(
      fetchImportResource(URL_, { fetchImpl: h.fetchImpl, confirmRelay: async () => { throw new Error("dialog gone"); } }),
    ).rejects.toThrow(/turned off/);
    expect(h.relayed()).toBe(false);
  });
});

describe("a stored answer (Settings ▸ Privacy)", () => {
  it("'allow' relays without asking", async () => {
    setRelayConsent("allow");
    const h = blockedHost();
    const confirmRelay = vi.fn(async () => false);
    const r = await fetchImportResource(URL_, { fetchImpl: h.fetchImpl, confirmRelay });
    expect(r.viaProxy).toBe(true);
    expect(confirmRelay).not.toHaveBeenCalled();
  });

  it("'deny' never relays, even with a prompt available", async () => {
    setRelayConsent("deny");
    const h = blockedHost();
    const confirmRelay = vi.fn(async () => true);
    await expect(fetchImportResource(URL_, { fetchImpl: h.fetchImpl, confirmRelay })).rejects.toThrow();
    expect(confirmRelay).not.toHaveBeenCalled();
    expect(h.relayed()).toBe(false);
  });

  it("clearing it means 'ask again'", () => {
    setRelayConsent("deny");
    setRelayConsent(null);
    expect(getRelayConsent()).toBe(null);
  });
});

describe("the question itself", () => {
  it("says what the server sees, and where to change the answer", () => {
    const p = relayConsentPrompt("drive.google.com");
    expect(p.description).toMatch(/drive\.google\.com/);
    expect(p.description).toMatch(/server/);
    expect(p.description).toMatch(/logs/);
    expect(p.description).toMatch(/Settings ▸ Privacy/);
    expect(p.confirmLabel).toBeTruthy();
    expect(p.cancelLabel).toBeTruthy();
  });
});
