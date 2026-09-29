import { describe, expect, it } from "vitest";
import { useDocumentStore, sameMetrics } from "../store/documentStore";

/**
 * State/sync hardening:
 *  - a multi-tab write conflict parks a TERMINAL "conflict" saveStatus (so the
 *    UI can surface it) and refuses to overwrite the other tab's newer version;
 *  - storage-metrics refresh is de-duplicated (no new object reference when the
 *    numbers are unchanged) so it can't churn re-renders on every save.
 */

const fakeEditor = (json) => ({ getJSON: () => json });
const realContent = (text) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const fakeDoc = (id, updated, canonical) => ({
  _ingestHtml: "",
  id,
  userTitle: null,
  titlePinnedByUser: false,
  title: `Doc ${id}`,
  origin: { format: "markdown", source: "user-typed", timestamp: "", raw: "" },
  canonical: canonical ?? realContent("stored"),
  residuals: [],
  ingestReport: null,
  markdownCache: null,
  htmlCache: null,
  fidelityReport: null,
  metadata: {},
  tags: [],
  created: "2026-01-01T00:00:00.000Z",
  updated: updated ?? "2026-01-01T00:00:00.000Z",
});

describe("multi-tab conflict save status", () => {
  it("parks a terminal 'conflict' status and refuses to overwrite a newer stored version", async () => {
    // Stored copy is 10s NEWER than the version this tab loaded → another tab wrote.
    const stored = fakeDoc("doc-a", "2026-01-01T00:00:10.000Z");
    const mine = fakeDoc("doc-a", "2026-01-01T00:00:00.000Z");
    let saved = null;
    useDocumentStore.getState().initStorage({
      initialize: async () => {},
      list: async () => [stored],
      get: async () => stored,
      save: async (d) => { saved = d; },
      delete: async () => {},
      getPrefs: async () => ({}),
      setPrefs: async () => {},
    });
    useDocumentStore.setState({
      activeDoc: mine, activeDocId: "doc-a", hydratedDocId: "doc-a", saveStatus: "editing",
    });

    await expect(
      useDocumentStore.getState().saveActiveDoc(fakeEditor(realContent("my edits")))
    ).rejects.toThrow(/changed in another tab/i);

    expect(saved).toBeNull(); // never overwrote the other tab's work
    expect(useDocumentStore.getState().saveStatus).toBe("conflict"); // terminal, visible
  });

  it("does not trip when the stored version is within the same-tab timestamp tolerance", async () => {
    const stored = fakeDoc("doc-a", "2026-01-01T00:00:01.000Z"); // 1s drift (< 2s tolerance)
    const mine = fakeDoc("doc-a", "2026-01-01T00:00:00.000Z");
    let saved = null;
    useDocumentStore.getState().initStorage({
      initialize: async () => {},
      list: async () => [stored],
      get: async () => stored,
      save: async (d) => { saved = d; },
      delete: async () => {},
      getPrefs: async () => ({}),
      setPrefs: async () => {},
    });
    useDocumentStore.setState({
      activeDoc: mine, activeDocId: "doc-a", hydratedDocId: "doc-a", saveStatus: "editing",
    });
    await useDocumentStore.getState().saveActiveDoc(fakeEditor(realContent("ok")));
    expect(saved).not.toBeNull();
    expect(useDocumentStore.getState().saveStatus).not.toBe("conflict");
  });
});

describe("storage-metrics de-duplication (sameMetrics)", () => {
  const m = { usedBytes: 100, maxBytes: 1000, pct: 10, docCount: 1, available: 900 };

  it("treats two distinct objects with identical values as equal (no churn)", () => {
    // getMetrics() returns a FRESH object each call; refreshMetrics uses this to
    // avoid pushing a new reference (and re-rendering subscribers) on a no-op.
    expect(sameMetrics({ ...m }, { ...m })).toBe(true);
  });

  it("detects a change in any field", () => {
    expect(sameMetrics(m, { ...m, usedBytes: 200 })).toBe(false);
    expect(sameMetrics(m, { ...m, docCount: 2 })).toBe(false);
    expect(sameMetrics(m, { ...m, pct: 11 })).toBe(false);
    expect(sameMetrics(m, { ...m, available: 800 })).toBe(false);
    expect(sameMetrics(m, { ...m, maxBytes: 2000 })).toBe(false);
  });

  it("handles null on either side", () => {
    expect(sameMetrics(null, null)).toBe(true);
    expect(sameMetrics(null, m)).toBe(false);
    expect(sameMetrics(m, null)).toBe(false);
  });
});
