/**
 * The behave-* rig seeds documents with the dates the fixture gives them (A107).
 *
 * `seededAdapter` used to go through `save()`, which stamps `updated` with the
 * current time. The fixtures' dates were discarded, and which document boot
 * opened — the newest — depended on whether consecutive saves shared a
 * millisecond. Under load they did not, and behave-editor-surfaces failed at
 * file level (12 cases skipped) about one loaded full run in ten, clicking a
 * library row that had not rendered yet. The pause below makes the old
 * behaviour lose deterministically: the second document would be newer.
 */
import { describe, expect, it } from "vitest";
import { heading, seededAdapter, storedDoc } from "./behave-harness";

describe("seededAdapter", () => {
  it("keeps each fixture's `updated`, so the library order is the fixture's, not the clock's", async () => {
    const older = storedDoc("older", "Older", [heading(1, "Older")], { updated: "2026-09-01T10:00:00.000Z" });
    const newer = storedDoc("newer", "Newer", [heading(1, "Newer")], { updated: "2026-09-05T10:00:00.000Z" });
    const adapter = await seededAdapter([newer]);
    await new Promise((r) => setTimeout(r, 5)); // a later save, in a later millisecond
    await adapter.save(Object.assign(older, { _preserveUpdated: true }));

    const list = await adapter.list();
    expect(list.map((d) => d.id)).toEqual(["newer", "older"]);
    expect((await adapter.get("newer")).updated).toBe("2026-09-05T10:00:00.000Z");
  });

  it("seeds in one call with the dates intact, whatever the insertion order", async () => {
    const adapter = await seededAdapter([
      storedDoc("first-seeded", "First", [heading(1, "First")], { updated: "2026-09-01T10:00:00.000Z" }),
      storedDoc("last-seeded", "Last", [heading(1, "Last")], { updated: "2026-08-01T10:00:00.000Z" }),
    ]);
    const list = await adapter.list();
    expect(list.map((d) => [d.id, d.updated])).toEqual([
      ["first-seeded", "2026-09-01T10:00:00.000Z"],
      ["last-seeded", "2026-08-01T10:00:00.000Z"],
    ]);
  });
});
