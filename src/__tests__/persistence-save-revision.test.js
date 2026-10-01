import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _knownStoredRevision, useDocumentStore } from "../store/documentStore";
import { computeCounts, createDocument, deserializeFromStorage, serializeForStorage, stampUpdated } from "../store/document";
import { readRevision, StorageReadError, utf8Bytes } from "../store/idb-storage-adapter";
import { snapshotStore } from "../store/snapshot-store";

/**
 * A083 — an autosave of a large note froze the page: it read its own stored
 * record back, parsed and re-sanitized all of it, then (every 90 s) recorded a
 * snapshot that deep-copied the old content and read every version kept. At
 * 4 MB under a 4x CPU slowdown, ~3.5 s of every save.
 *
 * Now a save whose pre-write read finds the revision this tab last wrote or
 * read (`getRevision`) judges against what it already holds. Everything the
 * full read decided must still be decided the same way: another tab's write
 * is still a conflict, a blank editor is still refused over real content (and
 * judged against storage itself), a failed read still writes nothing.
 */

const canonical = (text) => text
  ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
  : { type: "doc", content: [{ type: "paragraph" }] };

/** An adapter that keeps records as text, as the IndexedDB one does. */
function textAdapter(docs, { revisions = true } = {}) {
  const rows = new Map(docs.map((d) => [d.id, serializeForStorage(d)]));
  const summary = (id) => {
    const d = deserializeFromStorage(rows.get(id));
    return { id, title: d.title, updated: d.updated, created: d.created, wordCount: 0, tags: [], hasResiduals: false, originFormat: "markdown" };
  };
  const adapter = {
    rows,
    list: async () => [...rows.keys()].map(summary),
    get: vi.fn(async (id) => (rows.has(id) ? deserializeFromStorage(rows.get(id)) : null)),
    save: vi.fn(async (doc) => {
      stampUpdated(doc);
      rows.set(doc.id, serializeForStorage(doc));
    }),
    delete: async (id) => { rows.delete(id); },
    search: async () => [],
    getPrefs: async () => ({}),
    setPrefs: async () => {},
  };
  if (revisions) adapter.getRevision = vi.fn(async (id) => (rows.has(id) ? readRevision(id, rows.get(id)) : null));
  return adapter;
}

let seq = 0;
/** A stored document, opened the way a switch opens it, hydrated, and edited. */
async function open(text = "stored text", opts) {
  const id = `doc-${++seq}`;
  const stored = createDocument({ id, title: id, canonical: canonical(text), updated: "2026-01-01T00:00:00.000Z" });
  const adapter = textAdapter([stored], opts);
  const store = useDocumentStore.getState();
  store.initStorage(adapter);
  useDocumentStore.setState({ activeDoc: null, activeDocId: null, hydratedDocId: null, openTabs: [], _unsavedEdits: new Map(), _draftBases: new Map() });
  await store.switchToDoc(id, null);
  useDocumentStore.getState().markHydrated(id);
  useDocumentStore.getState().setDirty();
  adapter.get.mockClear();
  return { id, adapter };
}
const save = (text) => useDocumentStore.getState().saveActiveDoc({ getJSON: () => canonical(text) });

let warn;
beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { warn.mockRestore(); vi.restoreAllMocks(); });

describe("a save judges against what it knows is stored", () => {
  // The snapshot net is its own concern (below); here it must not write in the
  // background into the database the later cases clear.
  beforeEach(() => { vi.spyOn(snapshotStore, "maybeRecordOnSave").mockResolvedValue(undefined); });

  it("reads only the revision after the document was opened — and after its own save", async () => {
    const { id, adapter } = await open();
    expect(await save("edit one")).toBe(true);
    expect(adapter.get).not.toHaveBeenCalled();
    expect(adapter.getRevision).toHaveBeenCalledTimes(1);
    expect(deserializeFromStorage(adapter.rows.get(id)).canonical).toEqual(canonical("edit one"));
    const written = readRevision(id, adapter.rows.get(id));
    expect(_knownStoredRevision(id)).toBe(written);
    useDocumentStore.getState().setDirty();
    expect(await save("edit two")).toBe(true);
    expect(adapter.get).not.toHaveBeenCalled();
    expect(deserializeFromStorage(adapter.rows.get(id)).canonical).toEqual(canonical("edit two"));
  });

  it("reads the record whole when another tab wrote it — and still refuses to overwrite it", async () => {
    const { id, adapter } = await open();
    const theirs = createDocument({ id, title: id, canonical: canonical("their work"), updated: "2026-06-01T00:00:00.000Z" });
    adapter.rows.set(id, serializeForStorage(theirs));
    await expect(save("my edit")).rejects.toThrow();
    expect(adapter.get).toHaveBeenCalledTimes(1);
    expect(useDocumentStore.getState().saveStatus).toBe("conflict");
    expect(deserializeFromStorage(adapter.rows.get(id)).canonical).toEqual(canonical("their work"));
  });

  it("judges a BLANK editor against storage itself, and refuses it over real content", async () => {
    const { id, adapter } = await open();
    expect(await save("")).toBe(false);
    expect(adapter.get).toHaveBeenCalledTimes(1);
    expect(adapter.getRevision).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().saveStatus).toBe("blocked");
    expect(deserializeFromStorage(adapter.rows.get(id)).canonical).toEqual(canonical("stored text"));
  });

  it("writes nothing when the revision cannot be read", async () => {
    const { id, adapter } = await open();
    adapter.getRevision.mockRejectedValueOnce(new StorageReadError("storage did not answer"));
    expect(await save("my edit")).toBe(false);
    expect(adapter.save).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().saveStatus).toBe("error");
    expect(deserializeFromStorage(adapter.rows.get(id)).canonical).toEqual(canonical("stored text"));
  });

  it("hands the snapshot check the counts it knows, and the content stored at that revision", async () => {
    const spy = vi.mocked(snapshotStore.maybeRecordOnSave);
    const { id } = await open("a long stored text that will mostly go");
    expect(await save("short")).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const [docId, , oldCanonical, newCanonical, known] = spy.mock.calls[0];
    expect(docId).toBe(id);
    expect(oldCanonical).toEqual(canonical("a long stored text that will mostly go"));
    expect(newCanonical).toEqual(canonical("short"));
    expect(known).toEqual({ oldChars: computeCounts(oldCanonical).chars, newChars: 5 });
  });

  it("an adapter without getRevision reads the record whole, every time, as before", async () => {
    const { adapter } = await open("stored text", { revisions: false });
    expect(await save("edit one")).toBe(true);
    useDocumentStore.getState().setDirty();
    expect(await save("edit two")).toBe(true);
    expect(adapter.get).toHaveBeenCalledTimes(2);
  });
});

describe("utf8Bytes", () => {
  /** The loop it uses for short strings, for any length. */
  function loop(str) {
    let n = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        const d = str.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { n += 4; i++; } else n += 3;
      } else n += 3;
    }
    return n;
  }

  it("counts a long string as the loop does — lone surrogates included", () => {
    const big = "ascii é 東京 😀 \ud800 x \udc00 ".repeat(5000);
    expect(big.length).toBeGreaterThan(65536);
    expect(utf8Bytes(big)).toBe(loop(big));
    expect(utf8Bytes(big.slice(0, 100))).toBe(loop(big.slice(0, 100)));
    // All ASCII (counted by the regex alone), and ASCII up to a late character.
    const ascii = "plain ascii text ".repeat(5000);
    expect(utf8Bytes(ascii)).toBe(ascii.length);
    expect(utf8Bytes(`${ascii}é`)).toBe(ascii.length + 2);
    expect(utf8Bytes(`${ascii}😀 ${ascii}`)).toBe(loop(`${ascii}😀 ${ascii}`));
    expect(utf8Bytes("")).toBe(0);
  });
});

describe("version history keeps new snapshots as text", () => {
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
    return db;
  }
  const rows = (db) => new Promise((resolve, reject) => {
    const req = db.transaction("snapshots", "readonly").objectStore("snapshots").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  let db;
  beforeEach(async () => { db = await freshDb(); snapshotStore._resetForTests({ useIndexedDB: true }); });
  afterEach(() => db.close());

  it("writes the content as JSON text, and restores it as the object it was", async () => {
    await snapshotStore.record("s", "S", canonical("kept"), "manual");
    const [raw] = await rows(db);
    expect(typeof raw.json).toBe("string");
    expect(raw.canonical).toBeUndefined();
    const [meta] = await snapshotStore.listForDoc("s");
    expect(meta.json).toBeUndefined();
    expect(await snapshotStore.getCanonical(meta.id)).toEqual(canonical("kept"));
    expect(await snapshotStore.scanCanonicals()).toEqual([canonical("kept")]);
  });

  it("still lists, restores and scans a version written as an object, before the change", async () => {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("snapshots", "readwrite");
      tx.objectStore("snapshots").add({ docId: "o", ts: Date.now() - 1000, reason: "autosave", title: "O", bytes: 10, words: 1, hash: 7, canonical: canonical("old format") });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    const [meta] = await snapshotStore.listForDoc("o");
    expect(meta.canonical).toBeUndefined();
    expect(await snapshotStore.getCanonical(meta.id)).toEqual(canonical("old format"));
    expect(await snapshotStore.scanCanonicals()).toEqual([canonical("old format")]);
    // …and a new version of the same document is recorded beside it.
    await snapshotStore.record("o", "O", canonical("new format"), "manual");
    expect(await snapshotStore.listForDoc("o")).toHaveLength(2);
  });
});
