// @vitest-environment node
//
// The CONTRACT between the two halves of cloud sync: the browser's real sync
// code (app/cloud — httpCloudApi + SyncEngine) against the real API
// (apps/api — modules/sync/routes/index.ts) on a real Postgres and an S3-compatible server.
// cloud-sync.test.js tests the device side against an in-memory account and
// apps/api/tests/integration/sync.test.ts the server side on its own; only this test
// notices if they disagree (a field name, compression, a status code).
//
// The only stand-in is the network: `fetch("/api/…")` is answered by the app
// in process — decompressing a gzip response the way a browser does — and
// presigned S3 URLs are fetched for real. CI runs it in the backend job, which
// has both services; elsewhere it reads TEST_DATABASE_URL / TEST_S3_ENDPOINT
// from apps/api/.env (`bun run db:up`) and is skipped without them.
import "fake-indexeddb/auto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { httpAccountArchive, httpCloudApi } from "../app/cloud/api";
import { backUpToAccount, MAX_BACKUP_BYTES } from "../app/cloud/backup";
import { SyncEngine } from "../app/cloud/engine";
import { accountVersionsProvider } from "../app/cloud/versions";
import { extractArchive } from "../store/importExport/archive";
import { sha256Hex } from "../store/assets/asset-store";
import { createDocument } from "../store/documents/document";
import { IndexedDBStorageAdapter } from "../store/persistence/idb-storage-adapter";

const envFile = fileURLToPath(new URL("../../../api/.env", import.meta.url));
const dotenv = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
const dbServer = process.env.TEST_DATABASE_URL ?? dotenv.TEST_DATABASE_URL;
const s3Endpoint = process.env.TEST_S3_ENDPOINT ?? dotenv.TEST_S3_ENDPOINT;

const T = (m) => `2026-10-05T10:${String(m).padStart(2, "0")}:00.000Z`;
const para = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const textOf = (rec) => rec?.canonical?.content?.[0]?.content?.[0]?.text;

describe.skipIf(!dbServer || !s3Endpoint)("cloud sync: the browser's sync code against the real API", () => {
  let handle;
  let realFetch;

  beforeAll(async () => {
    const { createDatabase, schema } = await import("@markdown-studio/db");
    const { runMigrations } = await import("@markdown-studio/db/migrate");
    const { freshTestDatabase } = await import("@markdown-studio/db/testing");
    const { S3Client, CreateBucketCommand, PutBucketVersioningCommand } = await import("@aws-sdk/client-s3");
    const { createStorage } = await import("../../../api/src/lib/storage/index.ts");
    const { createApp } = await import("../../../api/src/app.ts");
    const { loadEnv } = await import("../../../api/src/config/env/index.ts");

    handle = createDatabase({ url: await freshTestDatabase(dbServer, "markdown_studio_test_contract"), max: 4 });
    await runMigrations(handle.pool);
    await handle.db.insert(schema.user).values({ id: "u-contract", name: "Contract", email: "contract@example.com" });
    const keys = { accessKeyId: "local", secretAccessKey: "local" };
    const bucket = `markdown-studio-contract-${process.pid}-${Date.now()}`;
    const admin = new S3Client({ region: "us-east-1", endpoint: s3Endpoint, forcePathStyle: true, credentials: keys });
    await admin.send(new CreateBucketCommand({ Bucket: bucket }));
    // Versioned, as the production bucket is (infra FilesStack): past versions.
    await admin.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: "Enabled" } }));
    const storage = createStorage({ bucket, region: "us-east-1", endpoint: s3Endpoint, forcePathStyle: true, credentials: keys });
    const app = createApp({
      env: loadEnv({ NODE_ENV: "test" }),
      pingDatabase: null,
      pingStorage: null,
      auth: null,
      sync: { db: handle.db, storage, userIdOf: async () => "u-contract" },
    });

    realFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith("/api/")) return realFetch(input, init);
      const res = await app.request(url, init);
      if (res.headers.get("content-encoding") !== "gzip") return res;
      // What the browser's network stack does with a gzip response.
      const headers = new Headers(res.headers);
      headers.delete("content-encoding");
      return new Response(gunzipSync(Buffer.from(await res.arrayBuffer())), { status: res.status, headers });
    };
  }, 120_000);

  afterAll(async () => {
    if (realFetch) globalThis.fetch = realFetch;
    await handle?.close();
  });

  let seq = 0;
  function device() {
    const storage = new IndexedDBStorageAdapter({ dbName: `cloud-contract-${++seq}`, snapshots: false });
    const kv = new Map();
    const images = new Map();
    const snapshots = [];
    const assets = {
      hasMany: async (hs) => new Set([...hs].filter((h) => images.has(h))),
      get: async (h) => images.get(h) ?? null,
      put: async (bytes, mime) => {
        const h = await sha256Hex(bytes);
        images.set(h, { mime, bytes });
        return h;
      },
    };
    const engine = new SyncEngine({
      userId: "u-contract",
      api: httpCloudApi,
      storage,
      snapshots: { record: async (docId, title, canonical, reason) => void snapshots.push({ docId, text: textOf({ canonical }), reason }) },
      assets,
      announce: () => {},
      kv: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) },
    });
    const write = async (id, text, updated, canonical = para(text)) => {
      await storage.save({ ...createDocument({ id, title: `Doc ${id}`, canonical }), updated, _preserveUpdated: true });
    };
    return { storage, engine, images, snapshots, assets, write, read: (id) => storage.get(id) };
  }

  const a = device();
  const b = device();

  it("a note goes up from one device and down to the other, exactly", async () => {
    await a.write("c1", "hello from A", T(1));
    expect(await a.engine.cycle()).toMatchObject({ pushed: 1 });
    expect(await b.engine.cycle()).toMatchObject({ pulled: 1 });
    const got = await b.read("c1");
    expect(textOf(got)).toBe("hello from A");
    expect(got.updated).toBe(T(1));
    expect(got.title).toBe("Doc c1");
  });

  it("an edit comes back, and both settle", async () => {
    await b.write("c1", "edited on B", T(2));
    await b.engine.cycle();
    await a.engine.cycle();
    expect(textOf(await a.read("c1"))).toBe("edited on B");
    expect(await a.engine.cycle()).toMatchObject({ pushed: 0, pulled: 0, conflicts: 0 });
    expect(await b.engine.cycle()).toMatchObject({ pushed: 0, pulled: 0, conflicts: 0 });
  });

  it("simultaneous edits: the newer wins on both, the other is kept", async () => {
    await a.write("c1", "A at 5", T(5));
    await b.write("c1", "B at 7", T(7));
    await a.engine.cycle();
    await b.engine.cycle();
    await a.engine.cycle();
    expect(textOf(await a.read("c1"))).toBe("B at 7");
    expect(textOf(await b.read("c1"))).toBe("B at 7");
    expect(b.snapshots).toContainEqual({ docId: "c1", text: "A at 5", reason: "cloud-sync" });
  });

  it("an image goes up through a presigned URL and comes down byte for byte", async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 7, 7, 7, 7]);
    const hash = await a.assets.put(png, "image/png");
    await a.write("c2", "", T(3), { type: "doc", content: [{ type: "image", attrs: { src: `pf-asset:${hash}` } }] });
    await a.engine.cycle();
    await b.engine.cycle();
    expect(b.images.get(hash)?.bytes).toEqual(png);
    expect(b.images.get(hash)?.mime).toBe("image/png");
  });

  it("a deletion reaches the other device", async () => {
    await a.storage.delete("c2");
    a.engine.recordLocalDelete("c2", T(9));
    expect(await a.engine.cycle()).toMatchObject({ deletedThere: 1 });
    expect(await b.engine.cycle()).toMatchObject({ deletedHere: 1 });
    expect(await b.read("c2")).toBeNull();
  });

  it("the folder tree syncs, each device keeping its own expanded folders", async () => {
    await a.storage.setPrefs({ folderTree: { folders: [{ id: "f1", name: "Work", parentId: null }], docParents: { c1: "f1" }, docOrder: {}, expanded: { f1: true } } });
    await a.engine.cycle();
    await b.engine.cycle();
    const tree = (await b.storage.getPrefs()).folderTree;
    expect(tree).toMatchObject({ folders: [{ id: "f1", name: "Work" }], docParents: { c1: "f1" } });
    expect(tree.expanded ?? {}).toEqual({});
  });

  it("a note's version in the account comes back into Version history", async () => {
    const versions = await httpAccountArchive.listVersions("c1");
    expect(versions[0]).toMatchObject({ id: expect.any(String), at: expect.any(Number), latest: true });
    expect(textOf(await httpAccountArchive.getVersion("c1", versions[0].id))).toBe("B at 7");
    expect(await httpAccountArchive.getVersion("c1", "no-such-version")).toBeNull();

    const kept = [];
    const provider = accountVersionsProvider(httpAccountArchive, {
      record: async (docId, title, canonical, reason) => kept.push({ docId, text: textOf({ canonical }), reason }),
    });
    expect(await provider.bringBack("c1", versions[0].id)).toBe(1);
    expect(kept).toEqual([{ docId: "c1", text: "B at 7", reason: "account-version" }]);
  });

  it("a day's backup goes up through its presigned link, and downloads as the ZIP Import restores", async () => {
    const kv = () => {
      const m = new Map();
      return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
    };
    const deps = {
      api: httpAccountArchive,
      sources: () => ({ storage: a.storage, drafts: new Map(), folders: [], docParents: {} }),
      kv: kv(),
      now: () => new Date(2026, 9, 5, 12),
    };
    expect(await backUpToAccount("u-contract", deps)).toBe("stored");
    const [backup] = await httpAccountArchive.listBackups();
    expect(backup).toMatchObject({ date: "2026-10-05" });

    const zip = new Uint8Array(await (await realFetch(await httpAccountArchive.backupDownloadUrl("2026-10-05"))).arrayBuffer());
    expect(zip.length).toBe(backup.size);
    const entries = await extractArchive(new File([zip], "backup.zip"));
    expect(entries.map((e) => JSON.parse(e.text)).map((d) => textOf(d))).toEqual(["B at 7"]);

    // Another device the same day: already there.
    expect(await backUpToAccount("u-contract", { ...deps, kv: kv() })).toBe("exists");
  });

  it("the browser and the API agree on the largest backup", async () => {
    const { MAX_BACKUP_BYTES: apiLimit } = await import("../../../api/src/modules/sync/index.ts");
    expect(MAX_BACKUP_BYTES).toBe(apiLimit);
  });
});
