import { beforeEach, describe, expect, it } from "vitest";
import { snapshotStore } from "../store/snapshot-store";

/**
 * Recoverable snapshot net. Under jsdom there is no IndexedDB, so the store runs
 * its in-memory fallback ring — which is exactly the code path these tests drive.
 */

const doc = (text) => ({
  type: "doc",
  content: text
    ? [{ type: "paragraph", content: [{ type: "text", text }] }]
    : [{ type: "paragraph" }],
});

describe("snapshotStore", () => {
  beforeEach(() => {
    snapshotStore._resetForTests();
  });

  it("records and lists a snapshot for a doc, newest-first", async () => {
    await snapshotStore.record("d1", "Doc 1", doc("hello world"), "manual");
    const list = await snapshotStore.listForDoc("d1");
    expect(list).toHaveLength(1);
    expect(list[0].reason).toBe("manual");
    expect(list[0].words).toBe(2);
  });

  it("never records a BLANK canonical (nothing to protect)", async () => {
    await snapshotStore.record("d1", "Doc 1", doc(""), "manual");
    expect(await snapshotStore.listForDoc("d1")).toHaveLength(0);
  });

  it("dedups back-to-back identical content", async () => {
    await snapshotStore.record("d1", "Doc 1", doc("same"), "manual");
    await snapshotStore.record("d1", "Doc 1", doc("same"), "manual");
    expect(await snapshotStore.listForDoc("d1")).toHaveLength(1);
    await snapshotStore.record("d1", "Doc 1", doc("different"), "manual");
    expect(await snapshotStore.listForDoc("d1")).toHaveLength(2);
  });

  it("getCanonical returns the stored content for restore", async () => {
    await snapshotStore.record("d1", "Doc 1", doc("recover me"), "pre-delete");
    const [meta] = await snapshotStore.listForDoc("d1");
    const canonical = await snapshotStore.getCanonical(meta.id);
    expect(JSON.stringify(canonical)).toContain("recover me");
  });

  it("maybeRecordOnSave snapshots immediately on a large shrink (the wiped signature)", async () => {
    // Old content is substantial; new content is blank ⇒ shrink ⇒ snapshot.
    await snapshotStore.maybeRecordOnSave("d1", "Doc 1", doc("a lot of important content here"), doc(""));
    const list = await snapshotStore.listForDoc("d1");
    expect(list).toHaveLength(1);
    expect(list[0].reason).toBe("pre-clear");
  });

  it("maybeRecordOnSave throttles ordinary (non-shrink) autosaves", async () => {
    await snapshotStore.maybeRecordOnSave("d1", "Doc 1", doc("version one text"), doc("version one text plus a bit"));
    // Immediate second non-shrink save is within the throttle interval ⇒ skipped.
    await snapshotStore.maybeRecordOnSave("d1", "Doc 1", doc("version one text plus a bit"), doc("version one text plus a bit more"));
    expect(await snapshotStore.listForDoc("d1")).toHaveLength(1);
  });

  it("caps snapshots per document", async () => {
    for (let i = 0; i < 25; i++) {
      await snapshotStore.record("d1", "Doc 1", doc(`content revision number ${i}`), "manual");
    }
    const list = await snapshotStore.listForDoc("d1");
    expect(list.length).toBeLessThanOrEqual(20);
    expect(list.length).toBeGreaterThan(0);
  });

  it("deleteForDoc clears a doc's snapshots; deleteOne removes a single one", async () => {
    await snapshotStore.record("d1", "Doc 1", doc("one"), "manual");
    await snapshotStore.record("d1", "Doc 1", doc("two"), "manual");
    const before = await snapshotStore.listForDoc("d1");
    expect(before).toHaveLength(2);
    await snapshotStore.deleteOne(before[0].id);
    expect(await snapshotStore.listForDoc("d1")).toHaveLength(1);
    await snapshotStore.deleteForDoc("d1");
    expect(await snapshotStore.listForDoc("d1")).toHaveLength(0);
  });

  it("listAll groups snapshots by document", async () => {
    await snapshotStore.record("d1", "Doc 1", doc("aaa"), "manual");
    await snapshotStore.record("d2", "Doc 2", doc("bbb"), "manual");
    const all = await snapshotStore.listAll();
    expect(all.get("d1")).toHaveLength(1);
    expect(all.get("d2")).toHaveLength(1);
  });
});

describe("snapshot id spaces do not alias", () => {
  it("allocates memory-ring ids that IndexedDB's autoIncrement can never produce", async () => {
    // IndexedDB autoIncrement issues 1, 2, 3… The memory fallback must not reuse
    // that space: readers union both stores, so a memory record sharing an id
    // with a stored one made `getCanonical` return the WRONG snapshot's content
    // — in the one path whose job is recovering content.
    snapshotStore._resetForTests();
    await snapshotStore.record("d1", "Doc one", doc("first version"), "manual");
    await snapshotStore.record("d1", "Doc one", doc("second version"), "manual");
    const recs = await snapshotStore.listForDoc("d1");
    expect(recs.length).toBeGreaterThanOrEqual(2);
    for (const r of recs) expect(r.id).toBeLessThan(0);
    expect(new Set(recs.map((r) => r.id)).size).toBe(recs.length);
  });

  it("resolves and deletes a memory snapshot by its own id", async () => {
    snapshotStore._resetForTests();
    await snapshotStore.record("d2", "Doc two", doc("keep me"), "manual");
    const [rec] = await snapshotStore.listForDoc("d2");
    expect(rec).toBeTruthy();
    const canonical = await snapshotStore.getCanonical(rec.id);
    expect(JSON.stringify(canonical)).toContain("keep me");
    await snapshotStore.deleteOne(rec.id);
    expect(await snapshotStore.listForDoc("d2")).toHaveLength(0);
  });
});
