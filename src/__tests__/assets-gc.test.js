import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assetStore } from "../store/asset-store";
import { assetRef } from "../store/asset-refs";
import { GC_GRACE_MS, cleanUpUnusedAssets, defaultReferenceSources, findUnusedAssets } from "../store/asset-gc";
import { snapshotStore } from "../store/snapshot-store";
import { useDocumentStore } from "../store/documentStore";

/**
 * "Clean up unused images" must never delete an image anything can still
 * show (A086). Each reference source is exercised on its own: remove any one
 * of them from the collector and its case goes red.
 */

let n = 0;
const T0 = 1_700_000_000_000;
const LATER = T0 + GC_GRACE_MS * 3; // well past the grace window

function png(seed) {
  const b = new Uint8Array(96);
  b.set([0x89, 0x50, 0x4e, 0x47]);
  for (let i = 4; i < b.length; i++) b[i] = (seed * 17 + i) & 0xff;
  return b;
}
const docWith = (hash) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "image", attrs: { src: assetRef(hash) } }] }],
});

/** Sources where nothing refers to anything, for a case to fill one of. */
const none = () => ({
  documents: async () => [],
  snapshots: async () => [],
  inMemory: () => [],
  stashedText: () => [],
});

let now;
beforeEach(() => {
  assetStore._resetForTests({ useIndexedDB: true, dbName: `assets-gc-${++n}` });
  now = vi.spyOn(Date, "now").mockReturnValue(T0);
});
afterEach(() => { vi.restoreAllMocks(); });

async function stored(seed) {
  const hash = await assetStore.put(png(seed), "image/png");
  now.mockReturnValue(LATER);
  return hash;
}

describe("the collector keeps every referenced image", () => {
  it("deletes an image nothing refers to, once it is past the grace window", async () => {
    const hash = await stored(1);
    const report = await findUnusedAssets(none(), LATER);
    expect(report.unused.map((a) => a.hash)).toEqual([hash]);
    const done = await cleanUpUnusedAssets(none(), LATER);
    expect(done.deleted).toBe(1);
    expect(done.freedBytes).toBe(96);
    expect(await assetStore.get(hash)).toBeNull();
  });

  it("keeps an image a stored DOCUMENT uses (anywhere in its record)", async () => {
    const a = await stored(2);
    const b = await stored(3);
    const src = { ...none(), documents: async () => [
      { id: "d1", canonical: docWith(a) },
      { id: "d2", canonical: { type: "doc", content: [] }, origin: { raw: `<img src="pf-asset:${b}">` } },
    ] };
    await cleanUpUnusedAssets(src, LATER);
    expect(await assetStore.get(a)).not.toBeNull();
    expect(await assetStore.get(b)).not.toBeNull();
  });

  it("keeps an image only a SNAPSHOT uses — a deleted document's pre-delete copy included", async () => {
    const hash = await stored(4);
    const src = { ...none(), snapshots: async () => [docWith(hash)] };
    await cleanUpUnusedAssets(src, LATER);
    expect(await assetStore.get(hash)).not.toBeNull();
  });

  it("keeps an image only UNSAVED state uses (the live editor, a parked draft)", async () => {
    const hash = await stored(5);
    const src = { ...none(), inMemory: () => [null, docWith(hash)] };
    await cleanUpUnusedAssets(src, LATER);
    expect(await assetStore.get(hash)).not.toBeNull();
  });

  it("keeps an image only a localStorage STASH mentions (crash stash, card draft)", async () => {
    const hash = await stored(6);
    const src = { ...none(), stashedText: () => [`[{"docId":"x","canonical":{"src":"pf-asset:${hash}"}}]`] };
    await cleanUpUnusedAssets(src, LATER);
    expect(await assetStore.get(hash)).not.toBeNull();
  });

  it("keeps an unreferenced image stored or shown within the grace window (undo stacks, other tabs)", async () => {
    const hash = await stored(7);
    const report = await findUnusedAssets(none(), T0 + GC_GRACE_MS / 2);
    expect(report.unused).toEqual([]);
    expect(report.recent).toBe(1);
    await cleanUpUnusedAssets(none(), T0 + GC_GRACE_MS / 2);
    expect(await assetStore.get(hash)).not.toBeNull();
  });

  it("an image re-pasted between the report and the deletion survives", async () => {
    const hash = await stored(8);
    const report = await findUnusedAssets(none(), LATER);
    expect(report.unused).toHaveLength(1);
    await assetStore.put(png(8), "image/png"); // re-pasted now (LATER): touched
    const { deleted } = await assetStore.deleteUnused(report.unused.map((a) => a.hash), LATER - GC_GRACE_MS);
    expect(deleted).toEqual([]);
    expect(await assetStore.get(hash)).not.toBeNull();
  });
});

describe("the collector fails CLOSED", () => {
  for (const which of ["documents", "snapshots"]) {
    it(`deletes nothing when the ${which} cannot be read`, async () => {
      const hash = await stored(9);
      const src = { ...none(), [which]: async () => { throw new Error("unreadable"); } };
      await expect(cleanUpUnusedAssets(src, LATER)).rejects.toThrow("unreadable");
      expect(await assetStore.get(hash)).not.toBeNull();
    });
  }

  it("the default sources report an unreadable document instead of skipping it", async () => {
    const storage = {
      list: async () => [{ id: "ok" }, { id: "bad" }],
      get: async (id) => { if (id === "bad") throw new Error("corrupt"); return { id, canonical: { type: "doc", content: [] } }; },
    };
    const spy = vi.spyOn(useDocumentStore.getState(), "getStorage").mockReturnValue(storage);
    try {
      await expect(defaultReferenceSources().documents()).rejects.toThrow(/could not be read/);
    } finally {
      spy.mockRestore();
    }
  });

  it("the default snapshot source reads the real version-history database", async () => {
    snapshotStore._resetForTests({ useIndexedDB: true });
    const hash = await stored(10);
    await snapshotStore.record("doc-x", "Deleted note", docWith(hash), "pre-delete");
    const found = await defaultReferenceSources().snapshots();
    expect(JSON.stringify(found)).toContain(hash);
  });

  it("the default in-memory source includes parked drafts", async () => {
    const hash = await stored(11);
    useDocumentStore.getState().cacheUnsavedEdit("draft-doc", docWith(hash));
    try {
      expect(JSON.stringify(defaultReferenceSources().inMemory())).toContain(hash);
    } finally {
      useDocumentStore.getState().clearUnsavedEdit("draft-doc");
    }
  });

  it("the default stash source reads localStorage", async () => {
    const hash = await stored(12);
    localStorage.setItem("pf:card-draft", `![x](pf-asset:${hash})`);
    try {
      expect(defaultReferenceSources().stashedText().join("")).toContain(hash);
    } finally {
      localStorage.removeItem("pf:card-draft");
    }
  });
});
