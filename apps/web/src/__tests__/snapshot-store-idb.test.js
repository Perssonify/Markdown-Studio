import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { snapshotStore } from "../store/snapshot-store";

/**
 * The snapshot net against a REAL database.
 *
 * `snapshot-store.test.js` beside this file drives the in-memory fallback ring,
 * because a bare jsdom has no IndexedDB — so the branch that actually ships (the
 * sidecar `perssonify-snapshots` database, the `byDoc` index, autoIncrement ids,
 * pruning across transactions) had never run in a test. That is the code path a
 * user's content is recovered through after a reload, which is the only moment
 * any of this matters: the memory ring does not survive one.
 *
 * `fake-indexeddb` is a real IDB implementation — real transactions, real
 * auto-commit timing — so these exercise it as shipped.
 */

const doc = (text) => ({
  type: "doc",
  content: text
    ? [{ type: "paragraph", content: [{ type: "text", text }] }]
    : [{ type: "paragraph" }],
});

/**
 * Empty the sidecar database, then re-arm the real path.
 *
 * `deleteDatabase` would BLOCK — the store keeps its own connection open and
 * exposes no close() — so this clears the object store through a second
 * connection instead, which needs no version change.
 */
async function freshDb() {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open("perssonify-snapshots", 1);
    req.onupgradeneeded = (e) => {
      // Mirror the store's own schema, in case this runs before it opens.
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
  snapshotStore._resetForTests({ useIndexedDB: true });
}

beforeEach(freshDb);

describe("snapshotStore on IndexedDB", () => {
  it("records into the database and reads it back", async () => {
    await snapshotStore.record("d1", "Doc 1", doc("hello world"), "manual");
    const list = await snapshotStore.listForDoc("d1");
    expect(list).toHaveLength(1);
    expect(list[0].reason).toBe("manual");
    expect(list[0].words).toBe(2);
    // A stored id, not a memory-ring one: the two spaces are told apart by sign.
    expect(list[0].id).toBeGreaterThan(0);
    expect(JSON.stringify(await snapshotStore.getCanonical(list[0].id))).toContain("hello world");
  });

  it("survives a reload — the whole reason for the sidecar database", async () => {
    await snapshotStore.record("d1", "Doc 1", doc("recover me"), "pre-delete");
    // A reload: same database, a store that has never seen this session's state.
    snapshotStore._resetForTests({ useIndexedDB: true });
    const list = await snapshotStore.listForDoc("d1");
    expect(list).toHaveLength(1);
    expect(JSON.stringify(await snapshotStore.getCanonical(list[0].id))).toContain("recover me");
  });

  it("keeps documents apart via the byDoc index", async () => {
    await snapshotStore.record("d1", "One", doc("first doc"), "manual");
    await snapshotStore.record("d2", "Two", doc("second doc"), "manual");
    expect(await snapshotStore.listForDoc("d1")).toHaveLength(1);
    expect(await snapshotStore.listForDoc("d2")).toHaveLength(1);
    const all = await snapshotStore.listAll();
    expect([...all.keys()].sort()).toEqual(["d1", "d2"]);
  });

  it("lists newest-first even when several land in the same millisecond", async () => {
    // ts alone is ambiguous in a burst; the autoIncrement id breaks the tie.
    for (const n of [1, 2, 3, 4]) {
      await snapshotStore.record("d1", "Doc 1", doc(`version ${n}`), "manual");
    }
    const list = await snapshotStore.listForDoc("d1");
    expect(list).toHaveLength(4);
    const ids = list.map((s) => s.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(JSON.stringify(await snapshotStore.getCanonical(ids[0]))).toContain("version 4");
  });

  it("dedups back-to-back identical content", async () => {
    await snapshotStore.record("d1", "Doc 1", doc("same"), "manual");
    await snapshotStore.record("d1", "Doc 1", doc("same"), "manual");
    expect(await snapshotStore.listForDoc("d1")).toHaveLength(1);
  });

  it("never records a blank canonical", async () => {
    await snapshotStore.record("d1", "Doc 1", doc(""), "manual");
    expect(await snapshotStore.listForDoc("d1")).toHaveLength(0);
  });

  it("caps snapshots per document, evicting the OLDEST", async () => {
    for (let i = 0; i < 25; i++) {
      await snapshotStore.record("d1", "Doc 1", doc(`revision ${i}`), "manual");
    }
    const list = await snapshotStore.listForDoc("d1");
    expect(list).toHaveLength(20);
    // The newest survived; the first few did not.
    const texts = await Promise.all(list.map((s) => snapshotStore.getCanonical(s.id)));
    const joined = JSON.stringify(texts);
    expect(joined).toContain("revision 24");
    expect(joined).not.toContain("revision 0\"");
  });

  it("deleteForDoc really deletes from the database, and only that doc", async () => {
    // This is the case that was silently a no-op: the read ran inside the write
    // transaction, which had already auto-committed, so every delete threw.
    await snapshotStore.record("d1", "One", doc("goes away"), "manual");
    await snapshotStore.record("d1", "One", doc("also goes away"), "manual");
    await snapshotStore.record("d2", "Two", doc("stays put"), "manual");

    await snapshotStore.deleteForDoc("d1");
    expect(await snapshotStore.listForDoc("d1")).toHaveLength(0);
    expect(await snapshotStore.listForDoc("d2")).toHaveLength(1);

    // And it is gone from the DATABASE, not just from this session's view.
    snapshotStore._resetForTests({ useIndexedDB: true });
    expect(await snapshotStore.listForDoc("d1")).toHaveLength(0);
    expect(await snapshotStore.listForDoc("d2")).toHaveLength(1);
  });

  it("deleteOne removes exactly one stored snapshot", async () => {
    await snapshotStore.record("d1", "Doc 1", doc("keep this"), "manual");
    await snapshotStore.record("d1", "Doc 1", doc("drop this"), "manual");
    const list = await snapshotStore.listForDoc("d1");
    const drop = list[0]; // newest-first, so this is "drop this"

    await snapshotStore.deleteOne(drop.id);
    const after = await snapshotStore.listForDoc("d1");
    expect(after).toHaveLength(1);
    expect(JSON.stringify(await snapshotStore.getCanonical(after[0].id))).toContain("keep this");
    expect(await snapshotStore.getCanonical(drop.id)).toBeNull();
  });

  it("maybeRecordOnSave snapshots a large shrink immediately", async () => {
    const big = doc("a".repeat(400));
    await snapshotStore.maybeRecordOnSave("d1", "Doc 1", big, doc("a"));
    expect(await snapshotStore.listForDoc("d1")).toHaveLength(1);
    expect((await snapshotStore.listForDoc("d1"))[0].reason).toBe("pre-clear");
  });

  it("maybeRecordOnSave throttles ordinary autosaves", async () => {
    await snapshotStore.maybeRecordOnSave("d1", "Doc 1", doc("one two three"), doc("one two three four"));
    await snapshotStore.maybeRecordOnSave("d1", "Doc 1", doc("one two three four"), doc("one two three four five"));
    expect(await snapshotStore.listForDoc("d1")).toHaveLength(1);
  });

  it("memory-ring entries and stored entries coexist without aliasing", async () => {
    // record() falls back to memory on a write error while the database stays
    // open; readers union both, so the two id spaces must not collide.
    await snapshotStore.record("d1", "Doc 1", doc("in the database"), "manual");
    const stored = (await snapshotStore.listForDoc("d1"))[0];

    // Force one write down the memory path without disturbing the open db.
    const realTx = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (store, mode) {
      if (mode === "readwrite") throw new Error("write blocked");
      return realTx.call(this, store, mode);
    };
    try {
      await snapshotStore.record("d1", "Doc 1", doc("in memory only"), "manual");
    } finally {
      IDBDatabase.prototype.transaction = realTx;
    }

    const list = await snapshotStore.listForDoc("d1");
    expect(list).toHaveLength(2);
    const memEntry = list.find((s) => s.id < 0);
    expect(memEntry).toBeDefined();
    expect(JSON.stringify(await snapshotStore.getCanonical(memEntry.id))).toContain("in memory only");
    expect(JSON.stringify(await snapshotStore.getCanonical(stored.id))).toContain("in the database");
  });

  it("notifies subscribers when the ring changes", async () => {
    let hits = 0;
    const off = snapshotStore.subscribe(() => { hits++; });
    await snapshotStore.record("d1", "Doc 1", doc("something"), "manual");
    await snapshotStore.deleteForDoc("d1");
    off();
    await snapshotStore.record("d1", "Doc 1", doc("after unsubscribe"), "manual");
    expect(hits).toBe(2);
  });
});
