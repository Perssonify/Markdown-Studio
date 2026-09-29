import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { snapshotStore } from "../store/snapshot-store";

/**
 * A088 (snapshot half) — pruning the snapshot ring reads it ONCE.
 *
 * Every snapshot (and so, throttled, every autosave) ran a prune that read the
 * document's snapshots and then ALL records twice more — payloads included —
 * so its cost grew with the whole history. The caps it enforces must not
 * change: per-document count, age, and the global byte budget, never evicting
 * a document's newest snapshot.
 */

const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

async function freshDb() {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open("perssonify-snapshots", 1);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains("snapshots")) {
        const os = d.createObjectStore("snapshots", { keyPath: "id", autoIncrement: true });
        os.createIndex("byDoc", "docId", { unique: false });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction("snapshots", "readwrite");
    tx.objectStore("snapshots").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
  db.close();
}

describe("A088: one read per prune", () => {
  beforeEach(async () => { await freshDb(); snapshotStore._resetForTests({ useIndexedDB: true }); });

  it("a snapshot reads the ring once for its prune (plus the dedup read of its own document)", async () => {
    await snapshotStore.record("d", "Doc", doc("first"), "manual");
    const storeGetAll = vi.spyOn(IDBObjectStore.prototype, "getAll");
    const indexGetAll = vi.spyOn(IDBIndex.prototype, "getAll");
    try {
      await snapshotStore.record("d", "Doc", doc("second"), "manual");
      expect(storeGetAll).toHaveBeenCalledTimes(1);   // the prune — was 2
      expect(indexGetAll).toHaveBeenCalledTimes(1);   // the dedup — was 2
    } finally {
      storeGetAll.mockRestore();
      indexGetAll.mockRestore();
    }
  });
});

describe("the caps are unchanged", () => {
  beforeEach(() => { snapshotStore._resetForTests(); });
  afterEach(() => { vi.useRealTimers(); });

  it("the age cap drops old versions but keeps each document's newest", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await snapshotStore.record("a", "A", doc("a old 1"), "manual");
    await snapshotStore.record("a", "A", doc("a old 2"), "manual");
    await snapshotStore.record("b", "B", doc("b only, old"), "manual");
    vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));          // two months later
    await snapshotStore.record("a", "A", doc("a new"), "manual");  // triggers the prune
    const a = await snapshotStore.listForDoc("a");
    expect(a).toHaveLength(1);                                      // the two old ones went
    expect(await snapshotStore.listForDoc("b")).toHaveLength(1);    // b's newest stays, however old
  });

  it("the byte budget evicts oldest-first and never a document's newest", async () => {
    const big = (tag) => doc(`${tag} ${"x".repeat(1024 * 1024)}`);  // ~2 MB per snapshot as counted
    for (let round = 0; round < 3; round++) {
      for (const id of ["p", "q", "r"]) await snapshotStore.record(id, id, big(`${id}${round}`), "manual");
    }
    const all = await snapshotStore.listAll();
    let total = 0;
    for (const [, metas] of all) for (const m of metas) total += m.bytes;
    expect(total).toBeLessThanOrEqual(12 * 1024 * 1024);
    for (const id of ["p", "q", "r"]) {
      const [newest] = await snapshotStore.listForDoc(id);
      expect(JSON.stringify(await snapshotStore.getCanonical(newest.id))).toContain(`${id}2`);
    }
  });
});
