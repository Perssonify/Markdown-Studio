import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndexedDBStorageAdapter, StorageQuotaError } from "../store/persistence/idb-storage-adapter";
import { createDocument } from "../store/documents/document";

/**
 * The real persistence layer had NO tests at all.
 *
 * Everything the app is careful about upstream — the blank-canonical backstop,
 * the hydration chokepoint, the stale-overwrite merges — ends here, in a
 * transaction against IndexedDB. Nothing exercised those transactions, the
 * manifest they keep beside the documents, or the quota arithmetic that decides
 * whether a save lands. `fake-indexeddb` is a real IDB implementation (real
 * transactions, real auto-commit semantics), so these run the code as shipped
 * rather than against a stub that agrees with it.
 */

let dbSeq = 0;
/** A fresh database per test — the adapters share a process-wide IDB. */
function freshAdapter(opts = {}) {
  return new IndexedDBStorageAdapter({ dbName: `test-docs-${++dbSeq}`, ...opts });
}

/** A document whose serialized size is roughly `padBytes` bytes.
 *  `preserveUpdated` is set on the RECORD (it is a marker the adapter consumes,
 *  not a createDocument option). */
function docOf(id, { text = "hello", pad = 0, preserveUpdated = false, ...rest } = {}) {
  const doc = createDocument({
    id,
    canonical: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text }] },
        ...(pad
          ? [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(pad) }] }]
          : []),
      ],
    },
    ...rest,
  });
  if (preserveUpdated) doc._preserveUpdated = true;
  return doc;
}

let warn;
beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { warn.mockRestore(); });

describe("IndexedDBStorageAdapter — round trip", () => {
  it("saves and reads a document back whole", async () => {
    const a = freshAdapter();
    await a.isReady();
    const doc = docOf("d1", {
      text: "the body",
      userTitle: "Renamed",
      titlePinnedByUser: true,
      tags: ["alpha", "Beta"],
      metadata: { cardColor: "amber", cardPinned: true },
    });
    await a.save(doc);

    const got = await a.get("d1");
    expect(got).not.toBeNull();
    expect(got.id).toBe("d1");
    expect(got.userTitle).toBe("Renamed");
    expect(got.titlePinnedByUser).toBe(true);
    expect(got.tags).toEqual(["alpha", "Beta"]);
    expect(got.metadata).toEqual({ cardColor: "amber", cardPinned: true });
    expect(JSON.stringify(got.canonical)).toContain("the body");
  });

  it("returns null for an id that was never stored", async () => {
    const a = freshAdapter();
    await a.isReady();
    expect(await a.get("nope")).toBeNull();
  });

  it("persists across a reopen of the same database", async () => {
    // The whole point of the adapter: a reload must find the library again.
    const name = `test-docs-reopen-${++dbSeq}`;
    const first = new IndexedDBStorageAdapter({ dbName: name });
    await first.isReady();
    await first.save(docOf("keep", { text: "survives a reload" }));

    const second = new IndexedDBStorageAdapter({ dbName: name });
    await second.isReady();
    const got = await second.get("keep");
    expect(JSON.stringify(got.canonical)).toContain("survives a reload");
    expect((await second.list()).map((d) => d.id)).toEqual(["keep"]);
    expect(second.getMetrics().docCount).toBe(1);
  });
});

describe("IndexedDBStorageAdapter — the manifest", () => {
  it("list() returns summaries newest-first", async () => {
    const a = freshAdapter();
    await a.isReady();
    await a.save(docOf("old", { updated: "2020-01-01T00:00:00.000Z", preserveUpdated: true }));
    await a.save(docOf("mid", { updated: "2022-01-01T00:00:00.000Z", preserveUpdated: true }));
    await a.save(docOf("new", { updated: "2024-01-01T00:00:00.000Z", preserveUpdated: true }));
    expect((await a.list()).map((d) => d.id)).toEqual(["new", "mid", "old"]);
  });

  it("updates the existing manifest entry rather than appending a second one", async () => {
    const a = freshAdapter();
    await a.isReady();
    await a.save(docOf("d1", { title: "First" }));
    await a.save(docOf("d1", { title: "Second" }));
    const list = await a.list();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Second");
    expect(a.getMetrics().docCount).toBe(1);
  });

  it("delete removes the document AND its manifest row", async () => {
    const a = freshAdapter();
    await a.isReady();
    await a.save(docOf("gone"));
    await a.save(docOf("stays"));
    await a.delete("gone");

    expect(await a.get("gone")).toBeNull();
    expect((await a.list()).map((d) => d.id)).toEqual(["stays"]);
    expect(a.getMetrics().docCount).toBe(1);
  });

  it("search matches title and tags, case-insensitively", async () => {
    const a = freshAdapter();
    await a.isReady();
    await a.save(docOf("t1", { title: "Quarterly Report" }));
    await a.save(docOf("t2", { title: "Notes", tags: ["Finance"] }));
    await a.save(docOf("t3", { title: "Recipes" }));

    expect((await a.search("quarterly")).map((d) => d.id)).toEqual(["t1"]);
    expect((await a.search("finance")).map((d) => d.id)).toEqual(["t2"]);
    expect(await a.search("nothing-here")).toEqual([]);
  });
});

describe("IndexedDBStorageAdapter — touchUpdated:false", () => {
  it("honours _preserveUpdated instead of stamping now", async () => {
    // CLAUDE.md invariant: recolouring or pinning a card must not re-sort the
    // board as if the note had been edited. The flag is consumed by the ADAPTER,
    // so this is the layer that has to prove it.
    const a = freshAdapter();
    await a.isReady();
    const doc = docOf("d1", { updated: "2001-02-03T04:05:06.000Z" });
    doc._preserveUpdated = true;
    await a.save(doc);
    expect((await a.get("d1")).updated).toBe("2001-02-03T04:05:06.000Z");
    expect((await a.list())[0].updated).toBe("2001-02-03T04:05:06.000Z");
  });

  it("stamps `updated` on an ordinary save", async () => {
    const a = freshAdapter();
    await a.isReady();
    const before = new Date().toISOString();
    await a.save(docOf("d1", { updated: "2001-02-03T04:05:06.000Z" }));
    expect((await a.get("d1")).updated >= before).toBe(true);
  });

  it("consumes the flag — the NEXT save stamps again", async () => {
    const a = freshAdapter();
    await a.isReady();
    const doc = docOf("d1", { updated: "2001-02-03T04:05:06.000Z" });
    doc._preserveUpdated = true;
    await a.save(doc);
    await a.save(doc);
    expect((await a.get("d1")).updated).not.toBe("2001-02-03T04:05:06.000Z");
  });
});

describe("IndexedDBStorageAdapter — quota", () => {
  it("throws StorageQuotaError and writes NOTHING when the save would not fit", async () => {
    // The check is inside the write transaction on purpose; a rejected save must
    // leave neither a partial document nor a manifest row pointing at one.
    const a = freshAdapter({ maxBytes: 4000 });
    await a.isReady();
    await a.save(docOf("small", { pad: 200 }));
    const usedBefore = a.getMetrics().usedBytes;

    await expect(a.save(docOf("huge", { pad: 20000 }))).rejects.toThrow(StorageQuotaError);

    expect(await a.get("huge")).toBeNull();
    expect((await a.list()).map((d) => d.id)).toEqual(["small"]);
    expect(a.getMetrics().docCount).toBe(1);
    expect(a.getMetrics().usedBytes).toBe(usedBefore);
  });

  it("reports how much room the rejected save needed", async () => {
    const a = freshAdapter({ maxBytes: 4000 });
    await a.isReady();
    const err = await a.save(docOf("huge", { pad: 20000 })).catch((e) => e);
    expect(err).toBeInstanceOf(StorageQuotaError);
    expect(err.maxBytes).toBe(4000);
    expect(err.requiredBytes).toBeGreaterThan(0);
  });

  it("counts an overwrite as a DELTA, not as a second copy", async () => {
    // Charging the full size again would make repeated autosaves of one note
    // walk into the quota wall for no reason.
    const a = freshAdapter({ maxBytes: 200000 });
    await a.isReady();
    await a.save(docOf("d1", { pad: 5000 }));
    const afterFirst = a.getMetrics().usedBytes;
    await a.save(docOf("d1", { pad: 5000 }));
    expect(a.getMetrics().usedBytes).toBe(afterFirst);
    expect(a.getMetrics().docCount).toBe(1);
  });

  it("a shrinking overwrite frees the difference", async () => {
    const a = freshAdapter({ maxBytes: 200000 });
    await a.isReady();
    await a.save(docOf("d1", { pad: 20000 }));
    const big = a.getMetrics().usedBytes;
    await a.save(docOf("d1", { pad: 10 }));
    expect(a.getMetrics().usedBytes).toBeLessThan(big);
  });

  it("delete frees the bytes back", async () => {
    const a = freshAdapter({ maxBytes: 200000 });
    await a.isReady();
    await a.save(docOf("d1", { pad: 5000 }));
    const used = a.getMetrics().usedBytes;
    expect(used).toBeGreaterThan(0);
    await a.delete("d1");
    expect(a.getMetrics().usedBytes).toBe(0);
    expect(a.getMetrics().available).toBe(200000);
  });

  it("metrics stay internally consistent (pct/available track usedBytes)", async () => {
    const a = freshAdapter({ maxBytes: 100000 });
    await a.isReady();
    await a.save(docOf("d1", { pad: 10000 }));
    const m = a.getMetrics();
    expect(m.available).toBe(100000 - m.usedBytes);
    expect(m.pct).toBe(Math.round((m.usedBytes / 100000) * 100));
  });

  it("getMetrics hands back a copy, not the live object", async () => {
    const a = freshAdapter();
    await a.isReady();
    a.getMetrics().usedBytes = 999999;
    expect(a.getMetrics().usedBytes).toBe(0);
  });
});

describe("IndexedDBStorageAdapter — prefs", () => {
  it("merges rather than replacing, so one key does not wipe the rest", async () => {
    const a = freshAdapter();
    await a.isReady();
    await a.setPrefs({ syncMode: "auto", markdownFeatures: { gfm: true } });
    await a.setPrefs({ lastActiveDocId: "d1" });

    expect(await a.getPrefs()).toEqual({
      syncMode: "auto",
      markdownFeatures: { gfm: true },
      lastActiveDocId: "d1",
    });
  });

  it("returns {} when nothing has been stored", async () => {
    const a = freshAdapter();
    await a.isReady();
    expect(await a.getPrefs()).toEqual({});
  });

  it("prefs survive a reopen", async () => {
    const name = `test-docs-prefs-${++dbSeq}`;
    const first = new IndexedDBStorageAdapter({ dbName: name });
    await first.isReady();
    await first.setPrefs({ lastActiveDocId: "d7" });

    const second = new IndexedDBStorageAdapter({ dbName: name });
    await second.isReady();
    expect(await second.getPrefs()).toEqual({ lastActiveDocId: "d7" });
  });
});
