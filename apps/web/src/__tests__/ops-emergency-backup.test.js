/**
 * "Export my documents" on the crash screen (A009).
 *
 * The library's backup export is a hook inside PerssonifyEditor — exactly what
 * is gone when the crash screen shows. This escape hatch builds the same
 * archive from storage and parked drafts alone, and it has to be something the
 * app can IMPORT again, so the round trip goes through the real archive reader.
 */
import { describe, expect, it } from "vitest";
import { archiveEntriesToItems, buildZip, extractArchive } from "../store/importExport/archive";
import { buildBackupFiles, exportEmergencyBackup } from "../utils/emergency-backup";

const para = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const heading = (text, body) => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text }] },
    { type: "paragraph", content: [{ type: "text", text: body }] },
  ],
});
const EMPTY = { type: "doc", content: [{ type: "paragraph" }] };

function record(id, canonical, extra = {}) {
  return {
    id,
    title: "Untitled",
    userTitle: null,
    titlePinnedByUser: false,
    canonical,
    origin: { format: "markdown", raw: "" },
    residuals: [],
    ingestReport: null,
    metadata: { cardColor: "blue" },
    tags: ["t"],
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-02-01T00:00:00.000Z",
    ...extra,
  };
}

function sources({ drafts = new Map(), broken = [] } = {}) {
  const docs = [
    record("a", heading("Plan", "stored text")),
    record("b", para("renamed body"), { userTitle: "My Rename", titlePinnedByUser: true }),
    record("c", heading("Nested", "in a folder")),
    record("d", heading("Keep me", "real content")),
  ];
  return {
    storage: {
      list: async () => [...docs.map((d) => ({ id: d.id })), ...broken.map((id) => ({ id }))],
      get: async (id) => {
        if (broken.includes(id)) throw new Error("corrupt record");
        return docs.find((d) => d.id === id) ?? null;
      },
    },
    drafts,
    folders: [
      { id: "f1", name: "Projects", parentId: null },
      { id: "f2", name: "2026: Q1", parentId: "f1" },
    ],
    docParents: { c: "f2" },
  };
}

describe("buildBackupFiles", () => {
  it("writes one perssonify-document envelope per stored document, in its folders", async () => {
    const files = await buildBackupFiles(sources());
    expect(Object.keys(files).sort()).toEqual(["Keep me.json", "My Rename.json", "Plan.json", "Projects/2026_ Q1/Nested.json"]);
    const plan = JSON.parse(files["Plan.json"]);
    expect(plan).toMatchObject({
      _format: "perssonify-document",
      id: "a",
      title: "Plan",
      tags: ["t"],
      metadata: { cardColor: "blue" },
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-02-01T00:00:00.000Z",
    });
  });

  it("prefers a parked draft (it is newer) but never a blank one over real content", async () => {
    const drafts = new Map([
      ["a", heading("Plan", "UNSAVED EDIT")],
      ["d", EMPTY],
    ]);
    const files = await buildBackupFiles(sources({ drafts }));
    expect(JSON.stringify(JSON.parse(files["Plan.json"]).canonical)).toContain("UNSAVED EDIT");
    expect(JSON.stringify(JSON.parse(files["Keep me.json"]).canonical)).toContain("real content");
  });

  it("skips an unreadable record instead of failing the whole export", async () => {
    const files = await buildBackupFiles(sources({ broken: ["zzz"] }));
    expect(Object.keys(files)).toHaveLength(4);
  });

  it("survives a folder cycle in corrupt metadata", async () => {
    const src = sources();
    src.folders = [
      { id: "f1", name: "A", parentId: "f2" },
      { id: "f2", name: "B", parentId: "f1" },
    ];
    src.docParents = { c: "f1" };
    const files = await buildBackupFiles(src);
    expect(Object.keys(files).some((p) => p.endsWith("Nested.json"))).toBe(true);
  });
});

describe("the archive round-trips through Import", () => {
  it("is recognised as a full backup and keeps its folder paths verbatim", async () => {
    const files = await buildBackupFiles(sources());
    const zip = buildZip(files);
    const entries = await extractArchive(new File([zip], "perssonify-backup-20260929-120000000.zip"));
    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.format === "pmjson")).toBe(true);
    const items = archiveEntriesToItems(entries, "perssonify-backup-20260929-120000000");
    const nested = items.find((i) => i.text.includes('"Nested"'));
    // A backup must NOT be wrapped in a synthetic "<zip name>/" folder.
    expect(nested.folderPath).toEqual(["Projects", "2026_ Q1"]);
    expect(items.find((i) => i.text.includes('"Plan"')).folderPath).toEqual([]);
  });

  it("downloads a timestamped perssonify-backup ZIP and reports the count", async () => {
    const got = [];
    const n = await exportEmergencyBackup(sources(), (blob, name) => got.push({ blob, name }));
    expect(n).toBe(4);
    expect(got).toHaveLength(1);
    expect(got[0].name).toMatch(/^perssonify-backup-\d{8}-\d{9}\.zip$/);
    expect(got[0].blob.type).toBe("application/zip");
  });

  it("downloads nothing when there is nothing stored", async () => {
    const got = [];
    const src = { ...sources(), storage: { list: async () => [], get: async () => null } };
    expect(await exportEmergencyBackup(src, (b, n) => got.push(n))).toBe(0);
    expect(got).toEqual([]);
  });
});
