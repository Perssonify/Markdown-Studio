import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildZipAsync, readDocuments } from "../store/zip-builder";
import { extractArchive, isZipEncrypted } from "../store/archive";
import { IndexedDBStorageAdapter } from "../store/idb-storage-adapter";
import { MemoryStorageAdapter } from "../store/storage-adapter";
import { createDocument } from "../store/document";

/**
 * A088 (export half) — a library export must not read one document at a time
 * or compress the whole ZIP in one frozen task. Measured by the audit: ~3 s of
 * blocked main thread at 2,000 documents.
 */

const doc = (id, text) => createDocument({ id, title: id, canonical: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } });

let warn, error;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { warn.mockRestore(); error.mockRestore(); });

describe("buildZipAsync", () => {
  it("produces a ZIP the app itself can read back", async () => {
    const files = { "notes/a.md": "# A\n\nalpha", "b.json": '{"x":1}', "deep/er/c.md": "gamma ".repeat(500) };
    const zip = await buildZipAsync(files);
    expect(isZipEncrypted(zip)).toBe(false);
    const entries = await extractArchive(new File([zip], "backup.zip"));
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e.text]));
    expect(byPath["notes/a.md"]).toBe(files["notes/a.md"]);
    expect(byPath["deep/er/c.md"]).toBe(files["deep/er/c.md"]);
  });

  it("yields to the event loop while it works (no single long task)", async () => {
    const files = {};
    for (let i = 0; i < 200; i++) files[`n${i}.md`] = `note ${i} `.repeat(200);
    let timerRan = false;
    setTimeout(() => { timerRan = true; }, 0);
    const zip = await buildZipAsync(files, { sliceMs: 0 });
    // A synchronous build would have finished before the timer could run.
    expect(timerRan).toBe(true);
    expect((await extractArchive(new File([zip], "x.zip")))).toHaveLength(200);
  });
});

describe("readDocuments", () => {
  it("reads an IndexedDB library in ONE transaction, not one per document", async () => {
    const a = new IndexedDBStorageAdapter({ dbName: `a088-${Math.random()}` });
    await a.isReady();
    const ids = [];
    for (let i = 0; i < 20; i++) { await a.save(doc(`d${i}`, `body ${i}`)); ids.push(`d${i}`); }
    const tx = vi.spyOn(IDBDatabase.prototype, "transaction");
    try {
      const { docs, unreadable } = await readDocuments(a, ids);
      expect(docs.size).toBe(20);
      expect(unreadable).toEqual([]);
      expect(tx).toHaveBeenCalledTimes(1);
    } finally { tx.mockRestore(); }
  });

  it("reports a document it cannot read instead of dropping it silently", async () => {
    const m = new MemoryStorageAdapter();
    await m.save(doc("ok", "fine"));
    const real = m.get.bind(m);
    m.get = async (id) => { if (id === "bad") throw new Error("unreadable"); return real(id); };
    const { docs, unreadable } = await readDocuments(m, ["ok", "bad", "missing"]);
    expect([...docs.keys()]).toEqual(["ok"]);
    expect(unreadable).toEqual(["bad"]);   // a missing id is simply absent; a failed read is reported
  });
});
