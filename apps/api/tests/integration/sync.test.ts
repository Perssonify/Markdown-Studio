import { CreateBucketCommand, PutBucketVersioningCommand, S3Client } from "@aws-sdk/client-s3";
import { createDatabase, schema, type DatabaseHandle } from "@markdown-studio/db";
import { runMigrations } from "@markdown-studio/db/migrate";
import { freshTestDatabase } from "@markdown-studio/db/testing";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStorage, type Storage } from "../../src/lib/storage/index.ts";
import { MAX_DOCUMENT_BYTES, MAX_LISTED_VERSIONS, SYNC_HEADER, SYNC_HEADER_VALUE, thinVersions } from "../../src/modules/sync/index.ts";
import { testApp } from "../fixtures/index.ts";

describe("the versions listed", () => {
  const MIN = 60_000;
  const now = Date.UTC(2026, 9, 6, 12);
  const at = (minutesAgo: number) => ({ lastModified: now - minutesAgo * MIN });

  it("keeps the newest, then only versions far enough from the last one kept", () => {
    const saves = [0, 1, 2, 3, 4, 6, 9, 20, 26, 30, 60, 61, 90].map(at);
    expect(thinVersions(saves, now).map((v) => (now - v.lastModified) / MIN)).toEqual([0, 6, 20, 26, 60, 90]);
  });

  it("reaches back across a month of continuous typing, in at most 50", () => {
    const saves = Array.from({ length: 30 * 24 * 60 }, (_, i) => at(i)); // one a minute for 30 days
    const kept = thinVersions(saves, now);
    expect(kept.length).toBeLessThanOrEqual(MAX_LISTED_VERSIONS);
    expect((now - kept[kept.length - 1]!.lastModified) / (24 * 60 * MIN)).toBeGreaterThan(20);
  });
});

describe("/api/sync without its dependencies", () => {
  it("is 503 until the database, storage and sign-in are configured", async () => {
    const res = await testApp().request("/api/sync/state");
    expect(res.status).toBe(503);
  });
});

// Against Postgres and an S3-compatible server: CI's backend job runs both;
// locally `bun run db:up` (TEST_DATABASE_URL / TEST_S3_ENDPOINT).
const dbServer = process.env.TEST_DATABASE_URL;
const s3Endpoint = process.env.TEST_S3_ENDPOINT;

describe.skipIf(!dbServer || !s3Endpoint)("/api/sync", () => {
  let handle: DatabaseHandle;
  let storage: Storage;
  let app: ReturnType<typeof testApp>;
  const bucket = `markdown-studio-sync-test-${process.pid}-${Date.now()}`;

  beforeAll(async () => {
    handle = createDatabase({ url: await freshTestDatabase(dbServer!, "markdown_studio_test_sync"), max: 4 });
    await runMigrations(handle.pool);
    for (const id of ["alice", "bob"]) {
      await handle.db.insert(schema.user).values({ id, name: id, email: `${id}@example.com` });
    }
    const keys = { accessKeyId: process.env.TEST_S3_ACCESS_KEY_ID ?? "local", secretAccessKey: process.env.TEST_S3_SECRET_ACCESS_KEY ?? "local" };
    const admin = new S3Client({ region: "us-east-1", endpoint: s3Endpoint, forcePathStyle: true, credentials: keys });
    await admin.send(new CreateBucketCommand({ Bucket: bucket }));
    // Like the production bucket (infra FilesStack).
    await admin.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: "Enabled" } }));
    storage = createStorage({ bucket, region: "us-east-1", endpoint: s3Endpoint, forcePathStyle: true, credentials: keys });
    app = testApp(
      {},
      { sync: { db: handle.db, storage, userIdOf: async (c) => c.req.header("x-test-user") ?? null } },
    );
  }, 60_000);
  afterAll(() => handle?.close());

  const as = (user: string, extra: Record<string, string> = {}) => ({ "x-test-user": user, [SYNC_HEADER]: SYNC_HEADER_VALUE, ...extra });
  const record = (id: string, updated: string, text = "hello") => ({
    id,
    title: `Doc ${id}`,
    updated,
    created: updated,
    canonical: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  });
  const put = (user: string, id: string, base: string | null, rec: object) =>
    app.request(`/api/sync/documents/${id}`, {
      method: "PUT",
      headers: as(user, { "Content-Type": "application/json", "Content-Encoding": "gzip" }),
      body: gzipSync(JSON.stringify({ base, record: rec })),
    });
  const get = async (user: string, id: string) => {
    const res = await app.request(`/api/sync/documents/${id}`, { headers: as(user) });
    return { res, body: res.status === 200 ? JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()) : null };
  };
  const state = async (user: string) => (await (await app.request("/api/sync/state", { headers: as(user) })).json()) as {
    documents: { id: string; updated: string; deleted: boolean; title: string }[];
    library: { tree: unknown; updated: string } | null;
  };

  it("needs a signed-in user, and the request header on writes", async () => {
    expect((await app.request("/api/sync/state")).status).toBe(401);
    const noHeader = await app.request("/api/sync/documents/a1", { method: "PUT", headers: { "x-test-user": "alice" }, body: "{}" });
    expect(noHeader.status).toBe(403);
  });

  it("stores a new document and reads it back exactly", async () => {
    const r = record("d1", "2026-10-05T10:00:00.000Z", "first");
    expect((await put("alice", "d1", null, r)).status).toBe(200);
    const { body, res } = await get("alice", "d1");
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(body).toEqual(r);
    expect((await state("alice")).documents).toEqual([{ id: "d1", title: "Doc d1", updated: r.updated, deleted: false, size: expect.any(Number) }]);
  });

  it("refuses a write based on a revision that is no longer current, and says which is", async () => {
    const res = await put("alice", "d1", null, record("d1", "2026-10-05T10:05:00.000Z", "stale"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "conflict", current: { updated: "2026-10-05T10:00:00.000Z", deleted: false } });
    expect((await get("alice", "d1")).body.canonical.content[0].content[0].text).toBe("first");
  });

  it("accepts a write based on the current revision", async () => {
    expect((await put("alice", "d1", "2026-10-05T10:00:00.000Z", record("d1", "2026-10-05T10:10:00.000Z", "second"))).status).toBe(200);
    expect((await get("alice", "d1")).body.canonical.content[0].content[0].text).toBe("second");
  });

  it("lets exactly one of two simultaneous writes from the same revision through", async () => {
    const base = "2026-10-05T10:10:00.000Z";
    const results = await Promise.all([
      put("alice", "d1", base, record("d1", "2026-10-05T10:20:00.000Z", "A")),
      put("alice", "d1", base, record("d1", "2026-10-05T10:20:01.000Z", "B")),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("keeps each user's library to themselves", async () => {
    expect((await get("bob", "d1")).res.status).toBe(404);
    expect((await state("bob")).documents).toEqual([]);
    // Bob writing the same id makes Bob's document, not a change to Alice's.
    expect((await put("bob", "d1", null, record("d1", "2026-10-05T11:00:00.000Z", "bob's"))).status).toBe(200);
    expect((await get("alice", "d1")).body.canonical.content[0].content[0].text).not.toBe("bob's");
  });

  it("refuses bad input", async () => {
    expect((await put("alice", "x/../y", null, record("x", "2026-10-05T10:00:00.000Z"))).status).toBeGreaterThanOrEqual(400);
    expect((await put("alice", "d2", null, record("other", "2026-10-05T10:00:00.000Z"))).status).toBe(400); // id mismatch
    expect((await put("alice", "d2", null, { id: "d2", updated: "nope", canonical: { type: "doc" } })).status).toBe(400);
    expect((await put("alice", "d2", null, { id: "d2", updated: "2026-10-05T10:00:00.000Z", canonical: { type: "html" } })).status).toBe(400);
    // A body that expands past the limit (a gzip bomb) is refused, not inflated.
    const bomb = gzipSync(Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 32));
    const res = await app.request("/api/sync/documents/d2", { method: "PUT", headers: as("alice", { "Content-Encoding": "gzip" }), body: bomb });
    expect(res.status).toBe(400);
  });

  it("deletes as a tombstone, which a stale device is told about instead of re-creating the note", async () => {
    const current = (await state("alice")).documents.find((d) => d.id === "d1")!.updated;
    const stale = await app.request(`/api/sync/documents/d1?base=2026-01-01T00:00:00.000Z&at=2026-10-05T12:00:00.000Z`, { method: "DELETE", headers: as("alice") });
    expect(stale.status).toBe(409);
    const del = await app.request(`/api/sync/documents/d1?base=${encodeURIComponent(current)}&at=2026-10-05T12:00:00.000Z`, { method: "DELETE", headers: as("alice") });
    expect(del.status).toBe(200);
    expect((await state("alice")).documents.find((d) => d.id === "d1")).toMatchObject({ deleted: true, updated: "2026-10-05T12:00:00.000Z" });
    expect((await get("alice", "d1")).res.status).toBe(404);
    // A device that never heard of the deletion is refused...
    expect((await put("alice", "d1", null, record("d1", "2026-10-05T12:30:00.000Z"))).status).toBe(409);
    // ...and one that decided its edit is newer than the deletion restores it.
    expect((await put("alice", "d1", "2026-10-05T12:00:00.000Z", record("d1", "2026-10-05T12:30:00.000Z", "back"))).status).toBe(200);
    expect((await get("alice", "d1")).body.canonical.content[0].content[0].text).toBe("back");
  });

  it("stores the folder tree with the same revision check", async () => {
    const tree = { folders: [{ id: "f1", name: "Work", parentId: null }], docParents: { d1: "f1" }, docOrder: {} };
    const putLib = (base: string | null) =>
      app.request("/api/sync/library", { method: "PUT", headers: as("alice", { "Content-Type": "application/json" }), body: JSON.stringify({ base, tree }) });
    const put1 = await putLib(null);
    expect(put1.status).toBe(200);
    const rev1 = ((await put1.json()) as { updated: string }).updated;
    const stale = await putLib(null);
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { current: { tree: unknown } }).current.tree).toEqual(tree);
    expect((await state("alice")).library).toEqual({ tree, updated: rev1 });
    // Each write gets a new revision, so writing the same tree twice is still ordered.
    const put2 = await putLib(rev1);
    const rev2 = ((await put2.json()) as { updated: string }).updated;
    expect(rev2).not.toBe(rev1);
    expect((await putLib(rev1)).status).toBe(409);
  });

  describe("versions", () => {
    // Saved seconds apart, the three are one listed version (thinVersions);
    // storage.test.ts reads every stored version back.
    it("lists a note's versions, and returns them", async () => {
      await put("alice", "v1", null, record("v1", "2026-10-06T10:00:00.000Z", "one"));
      await put("alice", "v1", "2026-10-06T10:00:00.000Z", record("v1", "2026-10-06T10:01:00.000Z", "two"));
      await put("alice", "v1", "2026-10-06T10:01:00.000Z", record("v1", "2026-10-06T10:02:00.000Z", "three"));
      const list = (await (await app.request("/api/sync/documents/v1/versions", { headers: as("alice") })).json()) as {
        versions: { id: string; at: number; size: number; latest: boolean }[];
      };
      expect(list.versions).toEqual([{ id: expect.any(String), at: expect.any(Number), size: expect.any(Number), latest: true }]);
      const res = await app.request(`/api/sync/documents/v1/versions/${encodeURIComponent(list.versions[0]!.id)}`, { headers: as("alice") });
      expect(JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()).canonical.content[0].content[0].text).toBe("three");
    });

    it("keeps a deleted note's last version readable", async () => {
      await app.request(`/api/sync/documents/v1?base=${encodeURIComponent("2026-10-06T10:02:00.000Z")}&at=2026-10-06T11:00:00.000Z`, { method: "DELETE", headers: as("alice") });
      const list = (await (await app.request("/api/sync/documents/v1/versions", { headers: as("alice") })).json()) as { versions: { id: string; latest: boolean }[] };
      expect(list.versions.map((v) => v.latest)).toEqual([false]);
      const res = await app.request(`/api/sync/documents/v1/versions/${encodeURIComponent(list.versions[0]!.id)}`, { headers: as("alice") });
      expect(res.status).toBe(200);
    });

    it("shows another user nothing", async () => {
      expect(await (await app.request("/api/sync/documents/v1/versions", { headers: as("bob") })).json()).toEqual({ versions: [] });
      const mine = (await (await app.request("/api/sync/documents/v1/versions", { headers: as("alice") })).json()) as { versions: { id: string }[] };
      const res = await app.request(`/api/sync/documents/v1/versions/${encodeURIComponent(mine.versions[0]!.id)}`, { headers: as("bob") });
      expect(res.status).toBe(404);
    });
  });

  describe("backups", () => {
    const zip = new Uint8Array([80, 75, 3, 4, 20, 0, 0, 0, 1, 2, 3]);
    const sha = createHash("sha256").update(zip).digest("hex");
    const postJson = (user: string, path: string, body: object) =>
      app.request(path, { method: "POST", headers: as(user, { "Content-Type": "application/json" }), body: JSON.stringify(body) });

    it("hands out one upload per day, then lists and downloads it", async () => {
      const first = (await (await postJson("alice", "/api/sync/backups/upload", { date: "2026-10-06", size: zip.length, sha256: sha })).json()) as {
        exists: boolean;
        upload: { url: string; headers: Record<string, string> };
      };
      expect(first.exists).toBe(false);
      expect(first.upload.headers["x-amz-tagging"]).toBe("kind=backup");
      expect((await fetch(first.upload.url, { method: "PUT", headers: first.upload.headers, body: zip })).status).toBe(200);
      // The same day again: already there.
      expect(await (await postJson("alice", "/api/sync/backups/upload", { date: "2026-10-06", size: zip.length, sha256: sha })).json()).toEqual({ exists: true });
      // "Back up now" replaces it.
      expect(((await (await postJson("alice", "/api/sync/backups/upload", { date: "2026-10-06", size: zip.length, sha256: sha, force: true })).json()) as { exists: boolean }).exists).toBe(false);

      const list = (await (await app.request("/api/sync/backups", { headers: as("alice") })).json()) as { backups: { date: string; size: number }[] };
      expect(list.backups).toEqual([{ date: "2026-10-06", size: zip.length, at: expect.any(Number) }]);
      const { url } = (await (await app.request("/api/sync/backups/2026-10-06", { headers: as("alice") })).json()) as { url: string };
      expect(url).toContain("markdown-studio-backup-2026-10-06.zip");
      expect(new Uint8Array(await (await fetch(url)).arrayBuffer())).toEqual(zip);
    });

    it("keeps each user's backups to themselves, and refuses bad input", async () => {
      expect(await (await app.request("/api/sync/backups", { headers: as("bob") })).json()).toEqual({ backups: [] });
      expect((await app.request("/api/sync/backups/2026-10-06", { headers: as("bob") })).status).toBe(404);
      expect((await postJson("alice", "/api/sync/backups/upload", { date: "../x", size: 1, sha256: sha })).status).toBe(400);
      expect((await app.request("/api/sync/backups/..%2Fx", { headers: as("alice") })).status).toBe(400);
    });
  });

  describe("images", () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
    const hash = createHash("sha256").update(png).digest("hex");
    const post = (user: string, path: string, body: object) =>
      app.request(`/api/sync/assets/${path}`, { method: "POST", headers: as(user, { "Content-Type": "application/json" }), body: JSON.stringify(body) });

    it("hands out a presigned upload, records it once verified, then reports it present", async () => {
      const res = await post("alice", "upload", { assets: [{ hash, mime: "image/png", size: png.length }] });
      const { uploads, present } = (await res.json()) as { uploads: { hash: string; url: string; headers: Record<string, string> }[]; present: string[] };
      expect(present).toEqual([]);
      expect(uploads).toHaveLength(1);
      expect(uploads[0]!.headers["x-amz-checksum-sha256"]).toBe(Buffer.from(hash, "hex").toString("base64"));
      expect((await fetch(uploads[0]!.url, { method: "PUT", headers: uploads[0]!.headers, body: png })).status).toBe(200);

      expect(await (await post("alice", "commit", { hashes: [hash] })).json()).toEqual({ committed: [hash], missing: [] });
      expect(await (await post("alice", "upload", { assets: [{ hash, mime: "image/png", size: png.length }] })).json()).toEqual({ uploads: [], present: [hash] });
    });

    it("downloads the exact bytes, for its owner only", async () => {
      const { downloads } = (await (await post("alice", "download", { hashes: [hash] })).json()) as { downloads: { url: string; mime: string }[] };
      expect(downloads[0]!.mime).toBe("image/png");
      expect(new Uint8Array(await (await fetch(downloads[0]!.url)).arrayBuffer())).toEqual(png);
      expect(await (await post("bob", "download", { hashes: [hash] })).json()).toEqual({ downloads: [], missing: [hash] });
    });

    it("refuses to record an object that did not come through a verified upload", async () => {
      const other = createHash("sha256").update("x").digest("hex");
      await storage.put(`users/alice/assets/${other}`, new Uint8Array([1, 2, 3]), "image/png"); // no checksum
      expect(await (await post("alice", "commit", { hashes: [other] })).json()).toEqual({ committed: [], missing: [other] });
    });

    it("refuses what is not a stored image type", async () => {
      expect((await post("alice", "upload", { assets: [{ hash, mime: "image/svg+xml", size: 10 }] })).status).toBe(400);
      expect((await post("alice", "upload", { assets: [{ hash: "nothex", mime: "image/png", size: 10 }] })).status).toBe(400);
    });
  });
});
