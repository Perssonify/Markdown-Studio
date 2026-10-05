// The folder tree across devices (app/cloud/folder-merge.ts): a three-way
// merge, entry by entry, against the tree both sides last agreed on.
import { describe, expect, it } from "vitest";
import { EMPTY_TREE, mergeTrees, syncedPart, treeSignature } from "../app/cloud/folder-merge";

const f = (id, name = id, parentId = null) => ({ id, name, parentId });
const tree = (folders = [], docParents = {}, docOrder = {}) => ({ folders, docParents, docOrder });
const names = (t) => t.folders.map((x) => x.name).sort();

describe("mergeTrees", () => {
  const base = tree([f("work", "Work")], { d1: "work" });

  it("keeps a folder made on each device", () => {
    const local = tree([f("work", "Work"), f("home", "Home")], { d1: "work" });
    const remote = tree([f("work", "Work"), f("trips", "Trips")], { d1: "work" });
    expect(names(mergeTrees(base, local, remote))).toEqual(["Home", "Trips", "Work"]);
  });

  it("takes each side's change to different entries", () => {
    const local = tree([f("work", "Work (renamed)")], { d1: "work" });
    const remote = tree([f("work", "Work")], { d1: "work", d2: "work" });
    const m = mergeTrees(base, local, remote);
    expect(names(m)).toEqual(["Work (renamed)"]);
    expect(m.docParents).toEqual({ d1: "work", d2: "work" });
  });

  it("lets the account win the same entry changed on both", () => {
    const local = tree([f("work", "Mine")], { d1: "work" });
    const remote = tree([f("work", "Theirs")], { d1: "work" });
    expect(names(mergeTrees(base, local, remote))).toEqual(["Theirs"]);
  });

  it("applies a deletion made on either side", () => {
    expect(names(mergeTrees(base, tree([], {}), base))).toEqual([]);
    expect(names(mergeTrees(base, base, tree([], {})))).toEqual([]);
  });

  it("moves notes and subfolders of a deleted folder to the top level", () => {
    const b = tree([f("work"), f("sub", "sub", "work")], { d1: "work" }, { work: ["d1"] });
    const local = tree([f("sub", "sub", "work")], { d1: "work" }, { work: ["d1"] }); // deleted "work" here
    const m = mergeTrees(b, local, b);
    expect(m.folders).toEqual([{ id: "sub", name: "sub", parentId: null }]);
    expect(m.docParents).toEqual({});
    expect(m.docOrder).toEqual({});
  });

  it("with no previous agreement (a first sync), is the union of both", () => {
    const m = mergeTrees(EMPTY_TREE, tree([f("a")], { d1: "a" }), tree([f("b")], { d2: "b" }));
    expect(names(m)).toEqual(["a", "b"]);
    expect(m.docParents).toEqual({ d1: "a", d2: "b" });
  });
});

describe("syncedPart / treeSignature", () => {
  it("drops this browser's expanded folders and anything malformed", () => {
    expect(syncedPart({ folders: [f("a"), { name: "no id" }], docParents: { d: "a", bad: 3 }, docOrder: { root: ["d", 4] }, expanded: { a: true } })).toEqual(
      tree([f("a")], { d: "a" }, { root: ["d"] }),
    );
    expect(syncedPart(null)).toEqual(EMPTY_TREE);
  });

  it("ignores the order of folders and keys", () => {
    expect(treeSignature(tree([f("a"), f("b")], { x: "a", y: "b" }))).toBe(treeSignature(tree([f("b"), f("a")], { y: "b", x: "a" })));
  });
});
