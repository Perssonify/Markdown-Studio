// The sync planner (app/cloud/plan.ts): what one cycle does for each document,
// from this device's revision, the account's, and the last agreement.
import { describe, expect, it } from "vitest";
import { isNewer, planSync } from "../app/cloud/plan";

const T = (m) => `2026-10-05T10:${String(m).padStart(2, "0")}:00.000Z`;
const plan = ({ local = {}, server = {}, synced = {}, pending = {} }) =>
  planSync({
    local: new Map(Object.entries(local).map(([id, updated]) => [id, { updated }])),
    server: new Map(Object.entries(server).map(([id, s]) => [id, typeof s === "string" ? { updated: s, deleted: false } : s])),
    synced,
    pendingDeletes: pending,
  });

describe("one side changed", () => {
  it("uploads a document the account has never had", () => {
    expect(plan({ local: { a: T(1) } })).toEqual([{ kind: "push", id: "a", base: null }]);
  });
  it("downloads a document this device has never had", () => {
    expect(plan({ server: { a: T(1) } })).toEqual([{ kind: "pull", id: "a" }]);
  });
  it("uploads a local edit, based on the account's current revision", () => {
    expect(plan({ local: { a: T(5) }, server: { a: T(1) }, synced: { a: { local: T(1), server: T(1) } } })).toEqual([{ kind: "push", id: "a", base: T(1) }]);
  });
  it("downloads an edit made elsewhere", () => {
    expect(plan({ local: { a: T(1) }, server: { a: T(5) }, synced: { a: { local: T(1), server: T(1) } } })).toEqual([{ kind: "pull", id: "a" }]);
  });
  it("does nothing when neither changed", () => {
    expect(plan({ local: { a: T(1) }, server: { a: T(1) }, synced: { a: { local: T(1), server: T(1) } } })).toEqual([]);
  });
  it("records agreement when both already hold the same revision", () => {
    expect(plan({ local: { a: T(1) }, server: { a: T(1) } })).toEqual([{ kind: "markSynced", id: "a", revision: T(1) }]);
  });
});

describe("both changed: the newer change wins", () => {
  const synced = { a: { local: T(1), server: T(1) } };
  it("local newer", () => {
    expect(plan({ local: { a: T(9) }, server: { a: T(5) }, synced })).toEqual([
      { kind: "conflict", id: "a", winner: "local", server: { updated: T(5), deleted: false } },
    ]);
  });
  it("account newer", () => {
    expect(plan({ local: { a: T(5) }, server: { a: T(9) }, synced })).toEqual([
      { kind: "conflict", id: "a", winner: "remote", server: { updated: T(9), deleted: false } },
    ]);
  });
  it("first sync of a document both sides have, with different revisions", () => {
    expect(plan({ local: { a: T(3) }, server: { a: T(2) } })[0]).toMatchObject({ kind: "conflict", winner: "local" });
  });
  it("a tie goes to the account, so two devices settle on the same answer", () => {
    expect(isNewer(T(5), T(5))).toBe(false);
  });
});

describe("deletions", () => {
  it("deletes in the account only what this browser deleted", () => {
    expect(plan({ server: { a: T(1) }, synced: { a: { local: T(1), server: T(1) } }, pending: { a: T(3) } })).toEqual([
      { kind: "deleteRemote", id: "a", base: T(1), at: T(3) },
    ]);
  });

  // The rule that keeps a wiped browser from erasing the account.
  it("never deletes from the account a document that is merely MISSING here", () => {
    expect(plan({ server: { a: T(1) }, synced: { a: { local: T(1), server: T(1) } } })).toEqual([{ kind: "pull", id: "a" }]);
  });

  it("an edit made elsewhere after this browser's delete wins: the note comes back", () => {
    expect(plan({ server: { a: T(9) }, synced: { a: { local: T(1), server: T(1) } }, pending: { a: T(5) } })).toEqual([{ kind: "pull", id: "a" }]);
  });
  it("a delete after an edit made elsewhere still deletes (based on the current revision)", () => {
    expect(plan({ server: { a: T(5) }, synced: { a: { local: T(1), server: T(1) } }, pending: { a: T(9) } })).toEqual([
      { kind: "deleteRemote", id: "a", base: T(5), at: T(9) },
    ]);
  });
  it("deleting a note the account never had just forgets it", () => {
    expect(plan({ pending: { a: T(3) } })).toEqual([{ kind: "forget", id: "a" }]);
  });

  it("deletes here what the account deleted, when it was not edited here since", () => {
    expect(plan({ local: { a: T(1) }, server: { a: { updated: T(5), deleted: true } }, synced: { a: { local: T(1), server: T(1) } } })).toEqual([
      { kind: "deleteLocal", id: "a", serverUpdated: T(5) },
    ]);
  });
  it("an edit here after the account's deletion wins: it is uploaded again", () => {
    expect(plan({ local: { a: T(9) }, server: { a: { updated: T(5), deleted: true } }, synced: { a: { local: T(1), server: T(1) } } })).toEqual([
      { kind: "push", id: "a", base: T(5) },
    ]);
  });
  it("a deletion after the edit here still deletes it here", () => {
    expect(plan({ local: { a: T(3) }, server: { a: { updated: T(9), deleted: true } }, synced: { a: { local: T(1), server: T(1) } } })).toEqual([
      { kind: "deleteLocal", id: "a", serverUpdated: T(9) },
    ]);
  });
  it("forgets a tombstone for a note this device does not have", () => {
    expect(plan({ server: { a: { updated: T(5), deleted: true } }, synced: { a: { local: T(1), server: T(1) } } })).toEqual([{ kind: "forget", id: "a" }]);
  });
});

it("plans every document, in a stable order", () => {
  const actions = plan({ local: { b: T(1), a: T(1) }, server: { c: T(1) } });
  expect(actions.map((a) => a.id)).toEqual(["a", "b", "c"]);
});
