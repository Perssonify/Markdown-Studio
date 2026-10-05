// Cloud sync end to end on the device side (app/cloud/engine.ts): two devices,
// each with its own real (fake-indexeddb) library, syncing through an
// in-memory account that keeps the server's rules (apps/api routes/sync.ts:
// conditional writes, tombstones, verified images).
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { SyncEngine } from "../app/cloud/engine";
import { sha256Hex } from "../store/asset-store";
import { createDocument } from "../store/document";
import { IndexedDBStorageAdapter } from "../store/idb-storage-adapter";

const T = (m) => `2026-10-05T10:${String(m).padStart(2, "0")}:00.000Z`;
const para = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const textOf = (rec) => rec?.canonical?.content?.[0]?.content?.[0]?.text;

/** The account, as the API keeps it. */
function fakeAccount() {
  const docs = new Map(); // id -> { updated, deleted, record }
  const assets = new Map(); // hash -> { mime, bytes }
  const staged = new Map(); // url -> { hash, mime }
  let library = null;
  let libRev = 0;
  const conflict = (row) => ({ ok: false, current: row ? { updated: row.updated, deleted: row.deleted } : null });
  return {
    docs,
    assets,
    get library() {
      return library;
    },
    api: {
      async state() {
        return {
          documents: [...docs].map(([id, d]) => ({ id, title: d.record?.title ?? "", updated: d.updated, deleted: d.deleted, size: 1 })),
          library,
        };
      },
      async getDocument(id) {
        const d = docs.get(id);
        return d && !d.deleted ? structuredClone(d.record) : null;
      },
      async putDocument(id, base, record) {
        const row = docs.get(id);
        if ((row ? row.updated : null) !== base) return conflict(row);
        docs.set(id, { updated: record.updated, deleted: false, record: structuredClone(record) });
        return { ok: true };
      },
      async deleteDocument(id, base, at) {
        const row = docs.get(id);
        if (!row) return { ok: true };
        if (row.updated !== base) return conflict(row);
        docs.set(id, { updated: at, deleted: true, record: null });
        return { ok: true };
      },
      async putLibrary(base, tree) {
        if ((library ? library.updated : null) !== base) return { ok: false };
        library = { tree: structuredClone(tree), updated: `rev-${++libRev}` };
        return { ok: true, updated: library.updated };
      },
      async assetUploads(list) {
        const uploads = [];
        for (const a of list) {
          if (assets.has(a.hash)) continue;
          const url = `mem://up/${a.hash}`;
          staged.set(url, { hash: a.hash, mime: a.mime });
          uploads.push({ hash: a.hash, url, headers: {} });
        }
        return { uploads, present: list.filter((a) => assets.has(a.hash)).map((a) => a.hash) };
      },
      async putBytes(t, bytes) {
        const s = staged.get(t.url);
        // S3 checks the checksum the URL was signed with.
        if ((await sha256Hex(bytes)) !== s.hash) throw new Error("checksum mismatch");
        s.bytes = bytes;
      },
      async commitAssets(hashes) {
        const committed = [];
        for (const [url, s] of staged) {
          if (hashes.includes(s.hash) && s.bytes) {
            assets.set(s.hash, { mime: s.mime, bytes: s.bytes });
            staged.delete(url);
            committed.push(s.hash);
          }
        }
        return { committed, missing: hashes.filter((h) => !committed.includes(h)) };
      },
      async assetDownloads(hashes) {
        return {
          downloads: hashes.filter((h) => assets.has(h)).map((h) => ({ hash: h, mime: assets.get(h).mime, url: `mem://dl/${h}` })),
          missing: hashes.filter((h) => !assets.has(h)),
        };
      },
      async getBytes(t) {
        return assets.get(t.url.slice("mem://dl/".length)).bytes;
      },
    },
  };
}

function memAssets() {
  const m = new Map();
  return {
    m,
    async hasMany(hs) {
      return new Set([...hs].filter((h) => m.has(h)));
    },
    async get(h) {
      return m.get(h) ?? null;
    },
    async put(bytes, mime) {
      const h = await sha256Hex(bytes);
      m.set(h, { mime, bytes });
      return h;
    },
  };
}

let seq = 0;
function device(account, userId = "u1") {
  const storage = new IndexedDBStorageAdapter({ dbName: `cloud-test-${++seq}`, snapshots: false });
  const snapshots = [];
  const announced = [];
  const kv = new Map();
  const assets = memAssets();
  const engine = new SyncEngine({
    userId,
    api: account.api,
    storage,
    snapshots: { record: async (docId, title, canonical, reason) => void snapshots.push({ docId, text: textOf({ canonical }), reason }) },
    assets,
    announce: (events) => announced.push(...events),
    kv: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    now: () => T(59),
  });
  const write = async (id, text, updated, extra = {}) => {
    const doc = createDocument({ id, title: `Doc ${id}`, canonical: extra.canonical ?? para(text) });
    await storage.save({ ...doc, updated, _preserveUpdated: true });
  };
  const read = (id) => storage.get(id);
  return { storage, engine, snapshots, announced, kv, assets, write, read };
}

describe("two devices, one account", () => {
  it("a note written on one device appears on the other, revision and all", async () => {
    const acct = fakeAccount();
    const a = device(acct);
    const b = device(acct);
    await a.write("n1", "from A", T(1));
    expect(await a.engine.cycle()).toMatchObject({ pushed: 1 });
    expect(await b.engine.cycle()).toMatchObject({ pulled: 1 });
    const got = await b.read("n1");
    expect(textOf(got)).toBe("from A");
    expect(got.updated).toBe(T(1));
    // The editor on B is told, the way another tab would tell it.
    expect(b.announced).toContainEqual({ type: "doc", id: "n1", updated: T(1) });
    // Nothing more to do on either side.
    expect(await a.engine.cycle()).toMatchObject({ pushed: 0, pulled: 0 });
    expect(await b.engine.cycle()).toMatchObject({ pushed: 0, pulled: 0 });
  });

  it("an edit travels back, and the version it replaced is kept in Version history", async () => {
    const acct = fakeAccount();
    const a = device(acct);
    const b = device(acct);
    await a.write("n1", "v1", T(1));
    await a.engine.cycle();
    await b.engine.cycle();
    await b.write("n1", "v2 from B", T(2));
    await b.engine.cycle();
    await a.engine.cycle();
    expect(textOf(await a.read("n1"))).toBe("v2 from B");
    expect(a.snapshots).toContainEqual({ docId: "n1", text: "v1", reason: "cloud-sync" });
  });

  it("when both change a note, the newer change wins on both, and the other is kept", async () => {
    const acct = fakeAccount();
    const a = device(acct);
    const b = device(acct);
    await a.write("n1", "base", T(1));
    await a.engine.cycle();
    await b.engine.cycle();
    await a.write("n1", "A, older", T(5));
    await b.write("n1", "B, newer", T(7));
    await a.engine.cycle(); // A uploads first (the account had not changed)
    const rb = await b.engine.cycle(); // B finds both changed: its own is newer
    expect(rb.conflicts).toBe(1);
    await a.engine.cycle();
    expect(textOf(await a.read("n1"))).toBe("B, newer");
    expect(textOf(await b.read("n1"))).toBe("B, newer");
    expect(textOf(acct.docs.get("n1").record)).toBe("B, newer");
    // Both devices keep the losing version.
    expect(b.snapshots).toContainEqual({ docId: "n1", text: "A, older", reason: "cloud-sync" });
    expect(a.snapshots).toContainEqual({ docId: "n1", text: "A, older", reason: "cloud-sync" });
  });

  it("a deletion reaches the other device, which keeps the note in Version history", async () => {
    const acct = fakeAccount();
    const a = device(acct);
    const b = device(acct);
    await a.write("n1", "doomed", T(1));
    await a.engine.cycle();
    await b.engine.cycle();
    await a.storage.delete("n1");
    a.engine.recordLocalDelete("n1", T(3)); // the editor's delete event
    expect(await a.engine.cycle()).toMatchObject({ deletedThere: 1 });
    expect(acct.docs.get("n1")).toMatchObject({ deleted: true });
    expect(await b.engine.cycle()).toMatchObject({ deletedHere: 1 });
    expect(await b.read("n1")).toBeNull();
    expect(b.snapshots).toContainEqual({ docId: "n1", text: "doomed", reason: "pre-delete" });
    expect(b.announced).toContainEqual({ type: "deleted", id: "n1" });
  });

  it("an edit made after a deletion elsewhere brings the note back", async () => {
    const acct = fakeAccount();
    const a = device(acct);
    const b = device(acct);
    await a.write("n1", "v1", T(1));
    await a.engine.cycle();
    await b.engine.cycle();
    await a.storage.delete("n1");
    a.engine.recordLocalDelete("n1", T(3));
    await a.engine.cycle();
    await b.write("n1", "edited after", T(9));
    await b.engine.cycle();
    await a.engine.cycle();
    expect(textOf(await a.read("n1"))).toBe("edited after");
    expect(acct.docs.get("n1")).toMatchObject({ deleted: false });
  });

  // The guarantee that matters most: a browser that loses its storage must
  // not take the account down with it.
  it("a browser whose library was wiped downloads it again — and deletes nothing from the account", async () => {
    const acct = fakeAccount();
    const a = device(acct);
    for (const id of ["n1", "n2", "n3"]) await a.write(id, id, T(1));
    await a.engine.cycle();
    for (const id of ["n1", "n2", "n3"]) await a.storage.delete(id); // wiped, no delete events
    const r = await a.engine.cycle();
    expect(r).toMatchObject({ deletedThere: 0, pulled: 3 });
    expect([...acct.docs.values()].every((d) => !d.deleted)).toBe(true);
    expect(textOf(await a.read("n2"))).toBe("n2");
  });

  it("a new device with an existing library uploads it, and gets the account's too", async () => {
    const acct = fakeAccount();
    const a = device(acct);
    const b = device(acct);
    await a.write("fromA", "A", T(1));
    await a.engine.cycle();
    await b.write("fromB", "B", T(2));
    await b.engine.cycle();
    expect((await b.storage.list()).map((d) => d.id).sort()).toEqual(["fromA", "fromB"]);
    await a.engine.cycle();
    expect((await a.storage.list()).map((d) => d.id).sort()).toEqual(["fromA", "fromB"]);
  });

  it("images go with the note, and arrive byte for byte", async () => {
    const acct = fakeAccount();
    const a = device(acct);
    const b = device(acct);
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9, 9, 9]);
    const hash = await a.assets.put(png, "image/png");
    const canonical = { type: "doc", content: [{ type: "image", attrs: { src: `pf-asset:${hash}` } }] };
    await a.write("pic", "", T(1), { canonical });
    await a.engine.cycle();
    expect(acct.assets.get(hash)?.mime).toBe("image/png");
    await b.engine.cycle();
    expect(b.assets.m.get(hash)?.bytes).toEqual(png);
    expect((await b.read("pic")).canonical.content[0].attrs.src).toBe(`pf-asset:${hash}`);
  });

  it("an image that arrives corrupted is not stored, and is tried again", async () => {
    const acct = fakeAccount();
    const a = device(acct);
    const b = device(acct);
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const hash = await a.assets.put(png, "image/png");
    await a.write("pic", "", T(1), { canonical: { type: "doc", content: [{ type: "image", attrs: { src: `pf-asset:${hash}` } }] } });
    await a.engine.cycle();
    const real = acct.api.getBytes;
    acct.api.getBytes = async () => new Uint8Array([0, 0, 0]);
    await b.engine.cycle();
    expect(b.assets.m.has(hash)).toBe(false);
    acct.api.getBytes = real;
    await b.engine.cycle(); // retried
    expect(b.assets.m.get(hash)?.bytes).toEqual(png);
  });

  it("folders made on each device both survive", async () => {
    const acct = fakeAccount();
    const a = device(acct);
    const b = device(acct);
    await a.write("n1", "x", T(1));
    await a.storage.setPrefs({ folderTree: { folders: [{ id: "work", name: "Work", parentId: null }], docParents: { n1: "work" }, docOrder: {}, expanded: { work: true } } });
    await a.engine.cycle();
    await b.engine.cycle();
    expect((await b.storage.getPrefs()).folderTree).toMatchObject({ folders: [{ id: "work" }], docParents: { n1: "work" } });
    expect(b.announced).toContainEqual({ type: "library" });
    // Both add a folder at once.
    const bTree = (await b.storage.getPrefs()).folderTree;
    await b.storage.setPrefs({ folderTree: { ...bTree, folders: [...bTree.folders, { id: "home", name: "Home", parentId: null }] } });
    const aTree = (await a.storage.getPrefs()).folderTree;
    await a.storage.setPrefs({ folderTree: { ...aTree, folders: [...aTree.folders, { id: "trips", name: "Trips", parentId: null }] } });
    await a.engine.cycle();
    await b.engine.cycle();
    await a.engine.cycle();
    for (const d of [a, b]) {
      expect((await d.storage.getPrefs()).folderTree.folders.map((f) => f.id).sort()).toEqual(["home", "trips", "work"]);
    }
    // Which folders are open stays each browser's own.
    expect((await a.storage.getPrefs()).folderTree.expanded).toEqual({ work: true });
  });

  it("a write that loses a race is re-decided on the next cycle, not forced", async () => {
    const acct = fakeAccount();
    const a = device(acct);
    await a.write("n1", "v1", T(1));
    await a.engine.cycle();
    await a.write("n1", "v2", T(2));
    // Someone else changes it between A's look at the account and its upload.
    const realPut = acct.api.putDocument;
    acct.api.putDocument = async (id, base, record) => {
      acct.docs.set(id, { updated: T(3), deleted: false, record: { ...record, updated: T(3), canonical: para("someone else") } });
      acct.api.putDocument = realPut;
      return realPut(id, base, record);
    };
    expect(await a.engine.cycle()).toMatchObject({ pushed: 0, again: true });
    expect(textOf(acct.docs.get("n1").record)).toBe("someone else");
    await a.engine.cycle(); // both changed: the newer (theirs, T3) wins; A's is kept
    expect(textOf(await a.read("n1"))).toBe("someone else");
    expect(a.snapshots).toContainEqual({ docId: "n1", text: "v2", reason: "cloud-sync" });
  });

  it("leaves alone a document whose id the account cannot store", async () => {
    const acct = fakeAccount();
    const a = device(acct);
    await a.write("bad/id", "x", T(1));
    expect((await a.engine.cycle()).skipped).toEqual(["bad/id"]);
    expect(acct.docs.size).toBe(0);
  });
});
