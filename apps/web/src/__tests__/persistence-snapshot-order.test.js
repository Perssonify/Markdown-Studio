/**
 * A035 — same-millisecond snapshots must order newest-first in the memory ring
 * too.
 *
 * Memory-ring ids are allocated NEGATIVE and DESCENDING (-1, -2, -3…) so they
 * can never alias IndexedDB's positive autoIncrement ids. The tie-break sorted
 * by `b.id - a.id`, which is right for the database and exactly backwards for
 * the ring: among snapshots sharing a millisecond the OLDEST was treated as the
 * newest — listed first, restored as "latest", and the per-document cap
 * evicted the newest versions instead of the oldest. (Reproduced by the audit.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { snapshotStore } from "../store/history/snapshot-store";

const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const textOf = async (id) => JSON.stringify(await snapshotStore.getCanonical(id));

beforeEach(() => {
  snapshotStore._resetForTests();          // the in-memory ring
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));   // every record in ONE ms
});
afterEach(() => { vi.useRealTimers(); });

describe("A035: memory-ring ordering within one millisecond", () => {
  it("lists the newest first", async () => {
    for (const n of [1, 2, 3]) await snapshotStore.record("d", "Doc", doc(`version ${n}`), "manual");
    const list = await snapshotStore.listForDoc("d");
    expect(list.every((s) => s.id < 0)).toBe(true);        // really the memory ring
    expect(await textOf(list[0].id)).toContain("version 3");
    expect(await textOf(list[2].id)).toContain("version 1");
  });

  it("the per-document cap evicts the OLDEST versions, not the newest", async () => {
    for (let n = 0; n < 25; n++) await snapshotStore.record("d", "Doc", doc(`revision ${n}`), "manual");
    const list = await snapshotStore.listForDoc("d");
    expect(list).toHaveLength(20);
    const texts = await Promise.all(list.map((s) => textOf(s.id)));
    expect(texts[0]).toContain("revision 24");              // the newest survived, first
    expect(texts.join("|")).not.toContain("revision 0\"");  // the oldest went
  });

  it("listAll orders each document's versions newest-first too", async () => {
    for (const n of [1, 2]) await snapshotStore.record("d", "Doc", doc(`v${n}`), "manual");
    const [first] = (await snapshotStore.listAll()).get("d");
    expect(await textOf(first.id)).toContain("v2");
  });
});
