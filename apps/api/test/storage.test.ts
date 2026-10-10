import { CreateBucketCommand, PutBucketVersioningCommand, S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadEnv } from "../src/config/env/index.ts";
import { assertKey, createStorage, storageFromEnv, type Storage } from "../src/lib/storage/index.ts";
import { testApp } from "./helpers.ts";

describe("storage keys", () => {
  it.each(["docs/u1/a.md", "a", "images/2026/10/x.png"])("accepts %s", (key) => {
    expect(() => assertKey(key)).not.toThrow();
  });

  // Keys are built from user input (an id, a file name): none may climb out of
  // its prefix or start at a root.
  it.each(["", "/abs", "a/../b", "../x", "a//b", "a/./b", "x".repeat(1025)])("refuses %j", (key) => {
    expect(() => assertKey(key)).toThrow();
  });
});

// A note synced as it is typed has a version per save: more than one page of
// S3's listing (1000). S3Mock does not page version listings, so S3's answers
// are played here.
describe("listing versions", () => {
  afterEach(() => vi.restoreAllMocks());
  // S3's answers, in place of the client's network round trip.
  const answer = (fn: (input: Record<string, unknown>) => unknown) =>
    vi.spyOn(S3Client.prototype, "send").mockImplementation((async (command: { input: Record<string, unknown> }) => fn(command.input)) as never);

  it("follows every page", async () => {
    const pages = [
      { IsTruncated: true, NextKeyMarker: "k", NextVersionIdMarker: "v2", Versions: [{ Key: "k", VersionId: "v1", IsLatest: true, LastModified: new Date(3000) }, { Key: "k", VersionId: "v2", LastModified: new Date(2000) }] },
      { IsTruncated: true, NextKeyMarker: "k", NextVersionIdMarker: "v3", Versions: [{ Key: "k", VersionId: "v3", LastModified: new Date(1000) }] },
      { IsTruncated: false, Versions: [{ Key: "k", VersionId: "v4", LastModified: new Date(0) }, { Key: "k.other", VersionId: "x", LastModified: new Date(0) }] },
    ];
    const sent: Record<string, unknown>[] = [];
    answer((input) => {
      sent.push(input);
      return pages[sent.length - 1];
    });
    const storage = createStorage({ bucket: "b", region: "us-east-1" });
    expect((await storage.listVersions("k")).map((v) => v.versionId)).toEqual(["v1", "v2", "v3", "v4"]);
    expect(sent.map((i) => [i.KeyMarker, i.VersionIdMarker])).toEqual([[undefined, undefined], ["k", "v2"], ["k", "v3"]]);
  });

  it("stops at about `max`", async () => {
    let calls = 0;
    answer(() => {
      calls++;
      return { IsTruncated: true, NextKeyMarker: "k", NextVersionIdMarker: `v${calls}`, Versions: [{ Key: "k", VersionId: `v${calls}`, LastModified: new Date(0) }] };
    });
    expect(await createStorage({ bucket: "b", region: "us-east-1" }).listVersions("k", 3)).toHaveLength(3);
    expect(calls).toBe(3);
  });
});

describe("storage settings", () => {
  it("is off without S3_BUCKET", () => {
    expect(storageFromEnv(loadEnv({}))).toBeNull();
  });

  it("reads the bucket, region and local endpoint", () => {
    const env = loadEnv({ S3_BUCKET: "b", S3_ENDPOINT: "http://localhost:9540", S3_FORCE_PATH_STYLE: "true" });
    expect(env.S3_REGION).toBe("us-east-1");
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(storageFromEnv(env)?.bucket).toBe("b");
  });

  it("refuses an endpoint that is not a URL", () => {
    expect(() => loadEnv({ S3_ENDPOINT: "localhost:9540" })).toThrow(/S3_ENDPOINT/);
  });
});

// Against a real S3-compatible server: CI's backend job runs one; locally
// `bun run db:up` starts it (TEST_S3_ENDPOINT in apps/api/.env.example). Each
// run makes its own bucket, so parallel runs never share objects.
const endpoint = process.env.TEST_S3_ENDPOINT;
const keys = { accessKeyId: "local", secretAccessKey: "local" };

describe.skipIf(!endpoint)("storage against S3", () => {
  const bucket = `markdown-studio-test-${process.pid}-${Date.now()}`;
  let storage: Storage;

  beforeAll(async () => {
    const admin = new S3Client({ region: "us-east-1", endpoint, forcePathStyle: true, credentials: keys });
    await admin.send(new CreateBucketCommand({ Bucket: bucket }));
    await admin.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: "Enabled" } }));
    storage = createStorage({ bucket, region: "us-east-1", endpoint, forcePathStyle: true, credentials: keys });
  });

  it("pings the bucket, and fails for one that does not exist", async () => {
    await expect(storage.ping()).resolves.toBeUndefined();
    const missing = createStorage({ bucket: `${bucket}-missing`, region: "us-east-1", endpoint, forcePathStyle: true, credentials: keys });
    await expect(missing.ping()).rejects.toThrow();
  });

  it("stores, reads back and deletes an object, byte for byte", async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    await storage.put("docs/u1/blob.bin", bytes, "application/octet-stream");
    const got = await storage.get("docs/u1/blob.bin");
    expect(got?.contentType).toBe("application/octet-stream");
    expect(Array.from(got!.body)).toEqual(Array.from(bytes));

    await storage.put("docs/u1/a.md", "# Hello", "text/markdown");
    expect(new TextDecoder().decode((await storage.get("docs/u1/a.md"))!.body)).toBe("# Hello");

    await storage.remove("docs/u1/blob.bin");
    expect(await storage.get("docs/u1/blob.bin")).toBeNull();
  });

  it("reads a key that was never written as null, and deleting it is not an error", async () => {
    expect(await storage.get("docs/nobody/none.md")).toBeNull();
    await expect(storage.remove("docs/nobody/none.md")).resolves.toBeUndefined();
  });

  it("lists a key's versions newest first, without its neighbours, and reads any of them", async () => {
    for (const text of ["one", "two", "three"]) await storage.put("docs/u1/v.json", text, "application/json");
    await storage.put("docs/u1/v.json.other", "neighbour", "application/json");
    const versions = await storage.listVersions("docs/u1/v.json");
    expect(versions).toHaveLength(3);
    expect(versions.map((v) => v.isLatest)).toEqual([true, false, false]);
    const texts = [];
    for (const v of versions) texts.push(new TextDecoder().decode((await storage.get("docs/u1/v.json", v.versionId))!.body));
    expect(texts).toEqual(["three", "two", "one"]);
  });

  it("/health reports the bucket up", async () => {
    const res = await testApp({}, { pingStorage: () => storage.ping() }).request("/health");
    expect(await res.json()).toMatchObject({ status: "ok", storage: "up" });
  });
});
