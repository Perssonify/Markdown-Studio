import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { SERIALIZE_EXTENSIONS } from "../engine/serialize-doc";
import { canonicalOf } from "../store/documents/canonical-json";
import { createDocument, serializeForStorage } from "../store/documents/document";
import { readRevision } from "../store/persistence/idb-storage-adapter";
import { CURRENT_SCHEMA_VERSION } from "../store/documents/schema-version";

/**
 * serializeForStorage writes the record field by field so the canonical's text
 * can come from each block's cache (A083). Its output must be what the plain
 * JSON.stringify of the same record wrote — every stored record and backup is
 * that text — and it must END with the revision, which a save reads back.
 */

/** The implementation it replaced, verbatim. */
function before(doc) {
  return JSON.stringify({
    id: doc.id,
    userTitle: doc.userTitle ?? null,
    titlePinnedByUser: doc.titlePinnedByUser,
    title: doc.title,
    origin: doc.origin,
    canonical: doc.canonical,
    residuals: doc.residuals,
    ingestReport: doc.ingestReport,
    metadata: doc.metadata,
    tags: doc.tags,
    created: doc.created,
    updated: doc.updated,
    schemaVersion: Math.max(doc.schemaVersion ?? 0, CURRENT_SCHEMA_VERSION),
  });
}

let ed;
afterEach(() => { ed?.destroy(); ed = null; });

describe("serializeForStorage", () => {
  it("writes exactly what JSON.stringify of the record wrote", () => {
    const records = [
      createDocument({ id: "a", title: "A", updated: "2026-10-01T10:00:00.000Z" }),
      createDocument({ id: "b", title: 'Quotes " and \\ and  ', userTitle: "Mine", titlePinnedByUser: true, tags: ["x"], metadata: { updated: "nested", n: 1, nested: { a: [1, null] } } }),
      { ...createDocument({ id: "c" }), titlePinnedByUser: undefined, origin: undefined, ingestReport: undefined, schemaVersion: 99 },
      { ...createDocument({ id: "d" }), updated: undefined, residuals: [{ type: "unknown-element", tag: "x" }] },
    ];
    for (const r of records) expect(serializeForStorage(r), r.id).toBe(before(r));
  });

  it("is the same text when the canonical comes from the editor's block caches", () => {
    ed = new Editor({ extensions: SERIALIZE_EXTENSIONS, content: "<h1>T</h1><p>one <strong>two</strong></p><ul><li><p>x</p></li></ul>" });
    const record = { ...createDocument({ id: "e", title: "T", updated: "2026-10-01T10:00:00.000Z" }), canonical: canonicalOf(ed) };
    expect(serializeForStorage(record)).toBe(before(record));
    ed.commands.setTextSelection(2);
    ed.commands.insertContent("edited ");
    const next = { ...record, canonical: canonicalOf(ed) };
    expect(serializeForStorage(next)).toBe(before(next));
  });

  it("ends with the revision, which readRevision reads without parsing the rest", () => {
    const r = createDocument({ id: "f", title: "F", metadata: { updated: "not this one" }, updated: "2026-10-01T10:00:00.000Z" });
    const text = serializeForStorage(r);
    expect(text.endsWith(`"updated":"2026-10-01T10:00:00.000Z","schemaVersion":${CURRENT_SCHEMA_VERSION}}`)).toBe(true);
    expect(readRevision("f", text)).toBe("2026-10-01T10:00:00.000Z");
  });
});

describe("readRevision", () => {
  it("parses a record written in another layout, as get() would", () => {
    const older = JSON.stringify({ id: "g", updated: "2026-01-01T00:00:00.000Z", title: "G", canonical: { type: "doc", content: [{ type: "paragraph" }] } });
    expect(readRevision("g", older)).toBe("2026-01-01T00:00:00.000Z");
  });

  it("is never fooled by an `updated` nested in the content or the metadata", () => {
    const sneaky = JSON.stringify({ id: "h", metadata: { x: '"updated":"1999-01-01T00:00:00.000Z","schemaVersion":1}' }, updated: "2026-02-02T00:00:00.000Z", schemaVersion: 3 });
    expect(readRevision("h", sneaky)).toBe("2026-02-02T00:00:00.000Z");
  });

  it("reads the end only — the body is not parsed at all", () => {
    // A body nothing could parse, with a well-formed end: the revision is
    // still read (what parsing it whole would cost is the point). A save that
    // then finds a revision it does not know reads the record whole, which
    // reports it corrupt.
    const tail = `,"updated":"2026-03-03T00:00:00.000Z","schemaVersion":${CURRENT_SCHEMA_VERSION}}`;
    expect(readRevision("j", `{"id":"j","canonical":{ not json at all ${"x".repeat(1000)}${tail}`)).toBe("2026-03-03T00:00:00.000Z");
  });

  it("reports a record that will not parse as corrupt", () => {
    expect(() => readRevision("i", "{ not json")).toThrow(expect.objectContaining({ name: "StorageReadError", corrupt: true }));
  });
});
