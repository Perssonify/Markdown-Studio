import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndexedDBStorageAdapter } from "../store/persistence/idb-storage-adapter";
import { LocalStorageAdapter } from "../store/persistence/storage-adapter";
import { createDocument } from "../store/documents/document";
import { useFolderStore } from "../store/documents/folders";

/**
 * A030 — the document list must not be a single point of failure.
 *
 * The adapters keep a manifest (the list of summaries) beside the documents.
 * An unreadable manifest read as an EMPTY list, and the next save wrote a list
 * containing one document: every other document vanished from the library
 * while still stored, and nothing ever rebuilt it. A transiently empty list
 * also made the folder tree prune every membership, permanently.
 */

const doc = (id, text) => createDocument({ id, title: id.toUpperCase(), canonical: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } });

let warn, err;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { warn.mockRestore(); err.mockRestore(); });

let seq = 0;
async function rawMeta(dbName, fn) {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readwrite");
    fn(tx.objectStore("meta"));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function library(name) {
  const a = new IndexedDBStorageAdapter({ dbName: name });
  await a.isReady();
  for (const [id, t] of [["a", "alpha"], ["b", "beta"], ["c", "gamma"]]) await a.save(doc(id, t));
  return a;
}
const ids = (list) => list.map((d) => d.id).sort();

describe("IndexedDB: the manifest is rebuilt, never trusted blindly", () => {
  it("an UNREADABLE manifest is rebuilt from the documents", async () => {
    const name = `a030-corrupt-${++seq}`;
    const a = await library(name);
    await rawMeta(name, (store) => store.put("{definitely not json", "__manifest"));
    expect(ids(await a.list())).toEqual(["a", "b", "c"]);
  });

  it("…and a save made while it is unreadable keeps every other document listed", async () => {
    const name = `a030-save-${++seq}`;
    const a = await library(name);
    await rawMeta(name, (store) => store.put("{definitely not json", "__manifest"));
    await a.save(doc("d", "delta"));                      // the save that used to shrink the list to one
    // The STORED list is whole — read raw, because list() would heal a short
    // one on the way out and hide a write that shrank it (an older build
    // reading this database would not).
    let raw;
    await rawMeta(name, (store) => { const r = store.get("__manifest"); r.onsuccess = () => { raw = r.result; }; });
    expect(ids(JSON.parse(raw).documents)).toEqual(["a", "b", "c", "d"]);
    expect(ids(await a.list())).toEqual(["a", "b", "c", "d"]);
  });

  it("a MISSING manifest is rebuilt", async () => {
    const name = `a030-missing-${++seq}`;
    const a = await library(name);
    await rawMeta(name, (store) => store.delete("__manifest"));
    expect(ids(await a.list())).toEqual(["a", "b", "c"]);
  });

  it("a manifest out of step with the stored documents is rebuilt", async () => {
    const name = `a030-drift-${++seq}`;
    const a = await library(name);
    await rawMeta(name, (store) => store.put(JSON.stringify({ documents: [{ id: "a", title: "A", updated: "", created: "", wordCount: 1, tags: [], hasResiduals: false, originFormat: "x" }, { id: "ghost", title: "Ghost", updated: "", created: "", wordCount: 0, tags: [], hasResiduals: false, originFormat: "x" }] }), "__manifest"));
    expect(ids(await a.list())).toEqual(["a", "b", "c"]);
  });

  it("a deletion made while the manifest is unreadable leaves the rest listed", async () => {
    const name = `a030-delete-${++seq}`;
    const a = await library(name);
    await rawMeta(name, (store) => store.put("nope", "__manifest"));
    await a.delete("b");
    expect(ids(await a.list())).toEqual(["a", "c"]);
  });
});

describe("localStorage: the manifest is rebuilt from the stored keys", () => {
  afterEach(() => { localStorage.clear(); });

  it("survives an unreadable manifest and a save made on top of it", async () => {
    const a = new LocalStorageAdapter();
    await a.save(doc("a", "alpha"));
    await a.save(doc("b", "beta"));
    localStorage.setItem("doc:__manifest", "{broken");
    await a.save(doc("c", "gamma"));
    expect(ids(await a.list())).toEqual(["a", "b", "c"]);
  });
});

describe("the folder tree does not prune on an empty listing", () => {
  beforeEach(() => {
    useFolderStore.getState().setInitialTree({
      folders: [{ id: "f1", name: "Work", parentId: null }],
      docParents: { a: "f1", b: "f1" },
      docOrder: { f1: ["a", "b"] },
    });
  });

  it("keeps every membership when the listing is empty", () => {
    useFolderStore.getState().pruneOrphans(new Set());
    expect(useFolderStore.getState().docParents).toEqual({ a: "f1", b: "f1" });
  });

  it("still prunes a genuinely deleted document", () => {
    useFolderStore.getState().pruneOrphans(new Set(["a"]));
    expect(useFolderStore.getState().docParents).toEqual({ a: "f1" });
  });
});
