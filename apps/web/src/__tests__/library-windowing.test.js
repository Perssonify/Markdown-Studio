import { describe, expect, it } from "vitest";
import { buildFolderTree } from "../store/documents/folders";
import { docRowDrop, flattenTree, treeKeyAction } from "../ui/FolderTree";
import {
  computeOffsets,
  indexesToRender,
  rowAt,
  scrollIntoRange,
  visibleRange,
} from "../ui/use-windowed-list";

/**
 * The pure halves of the library rework (A082 windowing, A094 tree keys, A066
 * drop handling). The components are driven in library-tree-keyboard.test.jsx.
 */

describe("windowing geometry (variable row heights)", () => {
  const sizes = [28, 40, 40, 28, 40, 64, 40]; // folder / doc / rename rows mixed
  const { starts, total } = computeOffsets(sizes.length, (i) => sizes[i]);

  it("lays rows end to end", () => {
    expect(starts).toEqual([0, 28, 68, 108, 136, 176, 240]);
    expect(total).toBe(280);
  });

  it("finds the row under a y offset", () => {
    expect(rowAt(starts, 0)).toBe(0);
    expect(rowAt(starts, 27.9)).toBe(0);
    expect(rowAt(starts, 28)).toBe(1);
    expect(rowAt(starts, 239)).toBe(5);
    expect(rowAt(starts, 10_000)).toBe(6);
    expect(rowAt([], 5)).toBe(-1);
  });

  it("returns exactly the rows intersecting the window", () => {
    expect(visibleRange(starts, total, 0, 60)).toEqual([0, 1]);
    expect(visibleRange(starts, total, 100, 180)).toEqual([2, 5]);
    // A window that ends exactly on a row boundary does not include the next row.
    expect(visibleRange(starts, total, 0, 68)).toEqual([0, 1]);
    expect(visibleRange(starts, total, 500, 900)).toEqual([0, -1]); // past the end
    expect(visibleRange([], 0, 0, 100)).toEqual([0, -1]);
  });

  it("keeps pinned rows mounted, in index order, without duplicates", () => {
    // The focused row scrolled far away must stay in the DOM, or focus drops
    // on <body> and the next arrow key has nowhere to start.
    expect(indexesToRender([10, 12], [3, 11, 99], 50)).toEqual([3, 10, 11, 12]);
    expect(indexesToRender([0, -1], [4], 10)).toEqual([4]);
  });

  it("scrolls the minimum to bring a row into view", () => {
    expect(scrollIntoRange(100, 40, 0, 300)).toBeNull(); // already visible
    expect(scrollIntoRange(10, 40, 50, 300)).toBe(10); // above → align top
    expect(scrollIntoRange(400, 40, 0, 300)).toBe(140); // below → align bottom
  });
});

const doc = (id, updated = "2026-09-01T00:00:00Z") => ({
  id, title: id, updated, created: updated, wordCount: 1, tags: [], hasResiduals: false, originFormat: "md",
});

/** Root: folder A (docs a1, a2; subfolder B with b1), folder C (empty), doc r1. */
function sample(expanded) {
  const folders = [
    { id: "A", name: "A", parentId: null },
    { id: "B", name: "B", parentId: "A" },
    { id: "C", name: "C", parentId: null },
  ];
  const docs = [doc("a1"), doc("a2"), doc("b1"), doc("r1")];
  const tree = buildFolderTree(docs, folders, { a1: "A", a2: "A", b1: "B" }, { A: ["a1", "a2"] });
  return flattenTree(tree, expanded);
}

describe("flattenTree", () => {
  it("lists only what is visible, children under their parent", () => {
    expect(sample({}).map((r) => r.key)).toEqual(["f:A", "f:C", "d:r1"]);
    expect(sample({ A: true }).map((r) => r.key)).toEqual(["f:A", "f:B", "d:a1", "d:a2", "f:C", "d:r1"]);
    expect(sample({ A: true, B: true }).map((r) => r.key))
      .toEqual(["f:A", "f:B", "d:b1", "d:a1", "d:a2", "f:C", "d:r1"]);
  });

  it("records the hierarchy ARIA needs for a flat tree", () => {
    const rows = sample({ A: true, B: true });
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by["f:A"]).toMatchObject({ depth: 0, posinset: 1, setsize: 3, parentIndex: null, expanded: true });
    expect(by["f:B"]).toMatchObject({ depth: 1, posinset: 1, setsize: 3, parentIndex: 0 });
    expect(by["d:b1"]).toMatchObject({ depth: 2, posinset: 1, setsize: 1, parentIndex: 1, folderId: "B" });
    expect(by["d:a2"]).toMatchObject({ depth: 1, posinset: 3, setsize: 3, folderId: "A" });
    expect(by["d:r1"]).toMatchObject({ depth: 0, posinset: 3, setsize: 3, folderId: null });
    expect(by["d:a1"].siblingDocIds).toEqual(["a1", "a2"]);
  });
});

describe("treeKeyAction — the WAI-ARIA tree keyboard model (A094)", () => {
  const rows = sample({ A: true }); // A, B, a1, a2, C, r1
  const idx = (key) => rows.findIndex((r) => r.key === key);

  it("moves up and down the visible rows, and to the ends", () => {
    expect(treeKeyAction(rows, 0, "ArrowDown")).toEqual({ type: "focus", index: 1 });
    expect(treeKeyAction(rows, 1, "ArrowUp")).toEqual({ type: "focus", index: 0 });
    expect(treeKeyAction(rows, 0, "ArrowUp")).toBeNull();
    expect(treeKeyAction(rows, rows.length - 1, "ArrowDown")).toBeNull();
    expect(treeKeyAction(rows, 3, "Home")).toEqual({ type: "focus", index: 0 });
    expect(treeKeyAction(rows, 0, "End")).toEqual({ type: "focus", index: rows.length - 1 });
  });

  it("Right opens a closed folder, then steps into it", () => {
    expect(treeKeyAction(rows, idx("f:B"), "ArrowRight")).toEqual({ type: "expand", index: idx("f:B") });
    expect(treeKeyAction(rows, idx("f:A"), "ArrowRight")).toEqual({ type: "focus", index: idx("f:B") });
    // An open folder with no visible children has nowhere to step.
    expect(treeKeyAction(sample({ C: true }), 1, "ArrowRight")).toBeNull();
    expect(treeKeyAction(rows, idx("d:a1"), "ArrowRight")).toBeNull();
  });

  it("Left closes an open folder, otherwise climbs to the parent", () => {
    expect(treeKeyAction(rows, idx("f:A"), "ArrowLeft")).toEqual({ type: "collapse", index: idx("f:A") });
    expect(treeKeyAction(rows, idx("d:a2"), "ArrowLeft")).toEqual({ type: "focus", index: idx("f:A") });
    expect(treeKeyAction(rows, idx("f:B"), "ArrowLeft")).toEqual({ type: "focus", index: idx("f:A") });
    expect(treeKeyAction(rows, idx("d:r1"), "ArrowLeft")).toBeNull(); // top level
  });

  it("Enter and Space activate; anything else is not the tree's", () => {
    expect(treeKeyAction(rows, idx("d:a1"), "Enter")).toEqual({ type: "activate", index: idx("d:a1") });
    expect(treeKeyAction(rows, idx("f:C"), " ")).toEqual({ type: "activate", index: idx("f:C") });
    expect(treeKeyAction(rows, 0, "a")).toBeNull();
    expect(treeKeyAction(rows, 99, "ArrowDown")).toBeNull();
  });
});

describe("docRowDrop — A066", () => {
  const target = { docId: "a2", folderId: "A", siblingDocIds: ["a1", "a2"] };

  it("puts a FOLDER dropped on a document into that document's folder", () => {
    // It used to fall through un-handled and bubble to the root drop handler,
    // which moved the folder to the TOP LEVEL.
    expect(docRowDrop({ kind: "folder", id: "C" }, target, "before")).toEqual({ kind: "moveFolder", parentId: "A" });
    expect(docRowDrop({ kind: "folder", id: "C" }, { ...target, folderId: null }, "after"))
      .toEqual({ kind: "moveFolder", parentId: null });
  });

  it("still re-orders a DOCUMENT among its new siblings", () => {
    expect(docRowDrop({ kind: "doc", id: "r1" }, target, "before"))
      .toEqual({ kind: "reorderDoc", folderId: "A", order: ["a1", "r1", "a2"] });
    expect(docRowDrop({ kind: "doc", id: "r1" }, target, "after"))
      .toEqual({ kind: "reorderDoc", folderId: "A", order: ["a1", "a2", "r1"] });
    expect(docRowDrop({ kind: "doc", id: "a2" }, target, "after")).toEqual({ kind: "none" });
  });
});
