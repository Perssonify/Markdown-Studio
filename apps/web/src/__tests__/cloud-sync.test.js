// Cloud sync end to end on the device side (app/cloud/engine.ts): two devices,
// each with its own real (fake-indexeddb) library, syncing through an
// in-memory account that keeps the server's rules (apps/api modules/sync/routes/index.ts:
// conditional writes, tombstones, verified images).
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { SyncEngine } from "../app/cloud/engine";
import { sha256Hex } from "../store/assets/asset-store";
import { createDocument } from "../store/documents/document";
import { IndexedDBStorageAdapter } from "../store/persistence/idb-storage-adapter";

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
  /** How each state read was answered: "full", or "unchanged" (a poll with the current version). */
  const stateReads = [];
  /** The account's live shares, as `state` lists them. */
  const published = [];
  return {
    docs,
    assets,
    stateReads,
    published,
    get library() {
      return library;
    },
    api: {
      // Like the API: a version of what the state describes, and "unchanged"
      // to a poll that already holds it (routes/index.ts stateVersion).
      async state(since) {
        const documents = [...docs].map(([id, d]) => ({ id, title: d.record?.title ?? "", updated: d.updated, deleted: d.deleted, size: 1 }));
        const version = JSON.stringify([documents.map((d) => [d.id, d.updated, d.deleted]).sort(), library?.updated ?? null, published]);
        stateReads.push(since === version ? "unchanged" : "full");
        if (since === version) return { unchanged: true, version };
        return { documents, library, published: structuredClone(published), version };
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
function device(account, userId = "u1", extra = {}) {
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
    ...extra,
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

  it("polls cheaply: an account that has not changed is not read again", async () => {
    const acct = fakeAccount();
    const a = device(acct);
    const b = device(acct);
    await a.write("n1", "v1", T(1));
    await a.engine.cycle(); // full read, then a push
    await b.engine.cycle(); // full read, pulls n1
    acct.stateReads.length = 0;
    // Nothing changed anywhere: both are answered "unchanged", and do nothing.
    expect(await b.engine.cycle()).toMatchObject({ pulled: 0, pushed: 0 });
    expect(acct.stateReads).toEqual(["unchanged"]);
    // A's own push moved the account's version: A reads it once more, in full.
    await a.engine.cycle();
    expect(acct.stateReads).toEqual(["unchanged", "full"]);
    await a.engine.cycle();
    expect(acct.stateReads).toEqual(["unchanged", "full", "unchanged"]);
    // A change on one device reaches the other through a full read again.
    await a.write("n1", "v2", T(2));
    await a.engine.cycle();
    expect(await b.engine.cycle()).toMatchObject({ pulled: 1 });
    expect(textOf(await b.read("n1"))).toBe("v2");
    // Local changes are still found while the account is "unchanged".
    await b.engine.cycle();
    await b.write("n2", "new on B", T(3));
    acct.stateReads.length = 0;
    expect(await b.engine.cycle()).toMatchObject({ pushed: 1 });
    expect(acct.stateReads).toEqual(["unchanged"]);
  });

  // Two tabs of the same library: one runs the sync while the user types in
  // either. A save that lands while a note is being downloaded must win.
  it("never writes the account's copy over a save made here while it was being downloaded", async () => {
    const acct = fakeAccount();
    const a = device(acct);
    const b = device(acct);
    await a.write("n1", "v1", T(1));
    await a.engine.cycle();
    await b.engine.cycle();
    await a.write("n1", "from A", T(5));
    await a.engine.cycle();
    // B's cycle plans a pull of A's edit; while it downloads, B's editor saves.
    const realGet = acct.api.getDocument;
    acct.api.getDocument = async (id) => {
      acct.api.getDocument = realGet;
      await b.write("n1", "typed on B meanwhile", T(9));
      return realGet(id);
    };
    expect(await b.engine.cycle()).toMatchObject({ pulled: 0, again: true });
    expect(textOf(await b.read("n1"))).toBe("typed on B meanwhile");
    // The next cycle sees both changed: B's is newer and wins; A's is kept.
    expect(await b.engine.cycle()).toMatchObject({ conflicts: 1, pushed: 1 });
    expect(textOf(acct.docs.get("n1").record)).toBe("typed on B meanwhile");
    expect(b.snapshots).toContainEqual({ docId: "n1", text: "from A", reason: "cloud-sync" });
  });

  it("does not forget a note deleted here while a cycle was running", async () => {
    const acct = fakeAccount();
    const a = device(acct);
    await a.write("n1", "keep", T(1));
    await a.write("n2", "doomed", T(1));
    await a.engine.cycle();
    await a.write("n3", "new", T(2)); // gives the next cycle work to do
    const realPut = acct.api.putDocument;
    acct.api.putDocument = async (id, base, record) => {
      acct.api.putDocument = realPut;
      // The editor deletes n2 mid-cycle (its delete event reaches the engine).
      await a.storage.delete("n2");
      a.engine.recordLocalDelete("n2", T(3));
      return realPut(id, base, record);
    };
    await a.engine.cycle();
    // It used to be dropped from the pending list here — and downloaded again.
    expect(await a.engine.cycle()).toMatchObject({ deletedThere: 1, pulled: 0 });
    expect(acct.docs.get("n2")).toMatchObject({ deleted: true });
    expect(await a.read("n2")).toBeNull();
  });

  describe("live shares", () => {
    // What the app wires in (app/cloud/index.ts → app/publish): the account
    // keeps the published copy; here, a list of what was sent.
    const publisher = (acct) => {
      const calls = [];
      return {
        calls,
        publish: {
          seen: (entries) => calls.push(["seen", entries.map((e) => e.docId)]),
          put: async (docId, live, id) => {
            calls.push(["put", docId, live.revision, live.document.id, live.document.metadata, id]);
            const e = acct.published.find((p) => p.docId === docId);
            if (e) e.revision = live.revision;
          },
          problem: (docId, problem) => calls.push(["problem", docId, problem]),
        },
      };
    };

    it("a published note edited here is published again; an unchanged one is left alone", async () => {
      const acct = fakeAccount();
      const p = publisher(acct);
      const a = device(acct, "u1", { publish: p.publish });
      await a.write("n1", "v1", T(1));
      await a.write("n2", "other", T(1));
      await a.engine.cycle();
      acct.published.push({ docId: "n1", id: "pub1", revision: T(1) });
      await a.engine.cycle();
      expect(p.calls.filter((c) => c[0] === "put")).toEqual([]);
      await a.write("n1", "v2", T(4));
      await a.engine.cycle();
      // The copy carries neither the owner's id nor its metadata, and it is an
      // UPDATE of that share (its id), never a new one.
      expect(p.calls.filter((c) => c[0] === "put")).toEqual([["put", "n1", T(4), undefined, {}, "pub1"]]);
      expect(acct.published[0].revision).toBe(T(4));
      await a.engine.cycle();
      expect(p.calls.filter((c) => c[0] === "put")).toHaveLength(1);
    });

    it("an edit made on another device is published by whichever device has it", async () => {
      const acct = fakeAccount();
      const a = device(acct);
      const p = publisher(acct);
      const b = device(acct, "u1", { publish: p.publish });
      await a.write("n1", "v1", T(1));
      await a.engine.cycle();
      await b.engine.cycle();
      acct.published.push({ docId: "n1", id: "pub1", revision: T(1) });
      await a.write("n1", "v2 from A", T(5)); // A cannot publish (no publisher)
      await a.engine.cycle();
      await b.engine.cycle(); // pulls it…
      await b.engine.cycle(); // …and, holding the newer revision, publishes it
      expect(acct.published[0].revision).toBe(T(5));
    });

    it("a note too large to publish is not rebuilt every cycle — and says so — until it changes", async () => {
      const acct = fakeAccount();
      const puts = [];
      const problems = [];
      const tooLarge = () => Object.assign(new Error("too large"), { name: "PublishTooLargeError" });
      const a = device(acct, "u1", {
        publish: {
          seen() {},
          put: async (docId, live) => { puts.push(live.revision); throw tooLarge(); },
          problem: (docId, problem) => problems.push([docId, problem]),
        },
      });
      await a.write("n1", "v1", T(1));
      await a.engine.cycle();
      acct.published.push({ docId: "n1", id: "pub1", revision: T(0) });
      await a.engine.cycle();
      await a.engine.cycle();
      await a.engine.cycle();
      expect(puts).toEqual([T(1)]);
      expect(problems).toEqual([["n1", "too-large"]]);
      await a.write("n1", "v2, smaller", T(5));
      await a.engine.cycle();
      expect(puts).toEqual([T(1), T(5)]);
    });

    it("a publish that fails never fails the sync", async () => {
      const acct = fakeAccount();
      const a = device(acct, "u1", { publish: { seen() {}, put: async () => { throw new Error("offline"); }, remove: async () => {} } });
      await a.write("n1", "v1", T(1));
      await a.engine.cycle();
      acct.published.push({ docId: "n1", id: "pub1", revision: T(0) });
      await a.write("n2", "new", T(2));
      expect(await a.engine.cycle()).toMatchObject({ pushed: 1 });
    });
  });

  it("leaves alone a document whose id the account cannot store", async () => {
    const acct = fakeAccount();
    const a = device(acct);
    await a.write("bad/id", "x", T(1));
    expect((await a.engine.cycle()).skipped).toEqual(["bad/id"]);
    expect(acct.docs.size).toBe(0);
  });
});
