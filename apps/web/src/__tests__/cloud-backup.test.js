/**
 * The account's daily backup (app/cloud/backup.ts): the same restorable ZIP
 * as File ▸ Export ▸ Full backup, stored in the account once a day, through a
 * presigned upload whose checksum S3 verifies.
 */
import { describe, expect, it, vi } from "vitest";
import { backedUpToday, backupDay, backUpToAccount } from "../app/cloud/backup";
import { extractArchive } from "../store/importExport/archive";
import { sha256Hex } from "../store/assets/asset-store";

const para = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const record = (id, text) => ({
  id,
  title: text,
  userTitle: null,
  titlePinnedByUser: false,
  canonical: para(text),
  origin: { format: "markdown", raw: "" },
  residuals: [],
  ingestReport: null,
  metadata: {},
  tags: [],
  created: "2026-10-01T00:00:00.000Z",
  updated: "2026-10-02T00:00:00.000Z",
});

function sources(docs) {
  return () => ({
    storage: { list: async () => docs.map((d) => ({ id: d.id })), get: async (id) => docs.find((d) => d.id === id) ?? null },
    drafts: new Map(),
    folders: [{ id: "f1", name: "Work", parentId: null }],
    docParents: { b: "f1" },
  });
}

function setup({ docs = [record("a", "Alpha"), record("b", "Beta")], exists = false, day = new Date(2026, 9, 5, 9) } = {}) {
  const kvMap = new Map();
  const uploaded = [];
  let now = day;
  const api = {
    backupUpload: vi.fn(async () => (exists ? { exists: true } : { exists: false, upload: { hash: "", url: "https://s3.example/put", headers: { "x-amz-tagging": "kind=backup" } } })),
    putBytes: vi.fn(async (t, bytes) => void uploaded.push({ t, bytes })),
  };
  const deps = {
    api,
    sources: sources(docs),
    kv: { get: (k) => kvMap.get(k) ?? null, set: (k, v) => void kvMap.set(k, v) },
    backedUp: vi.fn(),
    now: () => now,
  };
  return { deps, api, uploaded, kvMap, setDay: (d) => (now = d) };
}

describe("the day's backup", () => {
  it("uploads the full-backup ZIP, with the checksum of exactly those bytes, once a day", async () => {
    const { deps, api, uploaded } = setup();
    expect(await backUpToAccount("u1", deps)).toBe("stored");
    expect(uploaded).toHaveLength(1);
    const zip = uploaded[0].bytes;
    expect(api.backupUpload).toHaveBeenCalledWith({ date: "2026-10-05", size: zip.length, sha256: await sha256Hex(zip), force: false });
    expect(uploaded[0].t.url).toBe("https://s3.example/put");
    expect(deps.backedUp).toHaveBeenCalledTimes(1);

    // The same day again: nothing built, nothing asked.
    expect(await backUpToAccount("u1", deps)).toBe("exists");
    expect(api.backupUpload).toHaveBeenCalledTimes(1);
    expect(backedUpToday("u1", deps)).toBe(true);
    expect(backedUpToday("u2", deps)).toBe(false);
  });

  it("is the archive Import restores: every document, in its folder", async () => {
    const { deps, uploaded } = setup();
    await backUpToAccount("u1", deps);
    const zip = uploaded[0].bytes;
    const entries = await extractArchive(new File([zip], "backup.zip"));
    expect(entries.map((e) => e.path).sort()).toEqual(["Alpha.json", "Work/Beta.json"]);
    expect(JSON.parse(entries.find((e) => e.path === "Work/Beta.json").text)).toMatchObject({ _format: "perssonify-document", canonical: para("Beta") });
  });

  it("backs up again the next day", async () => {
    const { deps, api, setDay } = setup();
    await backUpToAccount("u1", deps);
    setDay(new Date(2026, 9, 6, 0, 5));
    expect(await backUpToAccount("u1", deps)).toBe("stored");
    expect(api.backupUpload.mock.calls.map(([b]) => b.date)).toEqual(["2026-10-05", "2026-10-06"]);
  });

  it("uploads nothing when another device already stored today's", async () => {
    const { deps, api } = setup({ exists: true });
    expect(await backUpToAccount("u1", deps)).toBe("exists");
    expect(api.putBytes).not.toHaveBeenCalled();
    expect(backedUpToday("u1", deps)).toBe(true);
    expect(deps.backedUp).toHaveBeenCalledTimes(1);
  });

  it("replaces today's when asked to (Back up now)", async () => {
    const { deps, api } = setup();
    await backUpToAccount("u1", deps);
    expect(await backUpToAccount("u1", deps, { force: true })).toBe("stored");
    expect(api.backupUpload).toHaveBeenLastCalledWith(expect.objectContaining({ force: true }));
    expect(api.putBytes).toHaveBeenCalledTimes(2);
  });

  it("stores nothing for an empty library, and does not count it as backed up", async () => {
    const { deps, api } = setup({ docs: [] });
    expect(await backUpToAccount("u1", deps)).toBe("empty");
    expect(api.backupUpload).not.toHaveBeenCalled();
    expect(backedUpToday("u1", deps)).toBe(false);
  });

  it("does not count a failed upload as backed up", async () => {
    const { deps, api } = setup();
    api.putBytes.mockRejectedValueOnce(new Error("offline"));
    await expect(backUpToAccount("u1", deps)).rejects.toThrow("offline");
    expect(backedUpToday("u1", deps)).toBe(false);
    expect(deps.backedUp).not.toHaveBeenCalled();
  });

  it("is dated by the user's own calendar day", () => {
    expect(backupDay(new Date(2026, 0, 2, 23, 59))).toBe("2026-01-02");
    expect(backupDay(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });
});
