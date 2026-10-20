import { describe, it, expect, beforeEach } from "vitest";
import { buildFolderTree, docOrderKey, useFolderStore } from "../store/documents/folders";
import { spliceOrder } from "../ui/workspace/folderTree/folder-dnd";

const doc = (id, updated) => ({
  id,
  title: id,
  updated,
  created: updated,
  wordCount: 0,
  tags: [],
  hasResiduals: false,
  originFormat: "markdown",
});

describe("spliceOrder", () => {
  it("moves an id before/after a target within the group", () => {
    const ids = ["a", "b", "c", "d"];
    expect(spliceOrder(ids, "d", "b", "before")).toEqual(["a", "d", "b", "c"]);
    expect(spliceOrder(ids, "a", "c", "after")).toEqual(["b", "c", "a", "d"]);
  });
  it("inserts a not-yet-present id relative to the target (cross-folder move)", () => {
    expect(spliceOrder(["a", "b"], "x", "a", "before")).toEqual(["x", "a", "b"]);
    expect(spliceOrder(["a", "b"], "x", "b", "after")).toEqual(["a", "b", "x"]);
  });
});

describe("buildFolderTree ordering", () => {
  it("sorts folders by manual order, then unordered by name", () => {
    const folders = [
      { id: "f1", name: "Zebra", parentId: null, order: 0 },
      { id: "f2", name: "Apple", parentId: null, order: 1 },
      { id: "f3", name: "Mango", parentId: null }, // unordered → after ordered, by name
    ];
    const t = buildFolderTree([], folders, {}, {});
    expect(t.rootFolders.map((n) => n.folder.name)).toEqual(["Zebra", "Apple", "Mango"]);
  });

  it("orders docs by docOrder first, remaining by most-recent", () => {
    const docs = [doc("d1", "2020-01-01"), doc("d2", "2024-01-01"), doc("d3", "2022-01-01")];
    // Manually order d3 before d1; d2 unlisted → falls to updated (newest) among the rest.
    const t = buildFolderTree(docs, [], {}, { root: ["d3", "d1"] });
    expect(t.rootDocs.map((d) => d.id)).toEqual(["d3", "d1", "d2"]);
  });

  it("without docOrder, docs sort by most-recently-updated", () => {
    const docs = [doc("old", "2020-01-01"), doc("new", "2024-01-01")];
    const t = buildFolderTree(docs, [], {}, {});
    expect(t.rootDocs.map((d) => d.id)).toEqual(["new", "old"]);
  });
});

// Settings-free: the library's sort menu (LibrarySort). "updated" is the
// default above; the others are what a user who does not want folders A–Z
// (or notes re-sorted on every edit) can choose.
describe("buildFolderTree sort modes", () => {
  const made = (id, name, ms, extra = {}) => ({ id: `fld-${ms.toString(36)}-x-${id}`, name, parentId: null, ...extra });
  const folders = [
    made("b", "Beta", 2000),
    made("a", "alpha", 3000),
    made("c", "Charlie", 1000, { order: 0 }), // dragged first
  ];
  const docs = [
    { ...doc("n2", "2024-01-01"), title: "banana", created: "2021-01-01" },
    { ...doc("n1", "2022-01-01"), title: "Apple", created: "2023-01-01" },
    { ...doc("n10", "2020-01-01"), title: "apple 10", created: "2022-01-01" },
  ];
  const names = (t) => t.rootFolders.map((n) => n.folder.name);
  const ids = (t) => t.rootDocs.map((d) => d.id);

  it("name: folders and documents A–Z, case-insensitively and with numbers in order, ignoring drag order", () => {
    const t = buildFolderTree(docs, folders, {}, { root: ["n2"] }, "name");
    expect(names(t)).toEqual(["alpha", "Beta", "Charlie"]);
    expect(ids(t)).toEqual(["n1", "n10", "n2"]);
  });

  it("created: newest first, for folders (by when they were made) and documents", () => {
    const t = buildFolderTree(docs, folders, {}, { root: ["n10"] }, "created");
    expect(names(t)).toEqual(["alpha", "Beta", "Charlie"]);
    expect(ids(t)).toEqual(["n1", "n10", "n2"]);
  });

  it("manual: dragged items first, the rest in the order they were made — nothing alphabetical", () => {
    const t = buildFolderTree(docs, folders, {}, { root: ["n10"] }, "manual");
    expect(names(t)).toEqual(["Charlie", "Beta", "alpha"]);
    expect(ids(t)).toEqual(["n10", "n2", "n1"]); // n10 dragged; then oldest-created first
  });

  it("updated (the default) is the original order: drag order, then folders A–Z, notes newest-edited", () => {
    expect(names(buildFolderTree(docs, folders, {}, {}, "updated"))).toEqual(["Charlie", "alpha", "Beta"]);
    expect(names(buildFolderTree(docs, folders, {}, {}))).toEqual(["Charlie", "alpha", "Beta"]);
    expect(ids(buildFolderTree(docs, folders, {}, {}))).toEqual(["n2", "n1", "n10"]);
  });

  it("folders without a timestamp in their id fall back to the order they are listed in", () => {
    const plain = [{ id: "x2", name: "Second", parentId: null }, { id: "x1", name: "First", parentId: null }];
    expect(names(buildFolderTree([], plain, {}, {}, "manual"))).toEqual(["Second", "First"]);
    expect(names(buildFolderTree([], plain, {}, {}, "created"))).toEqual(["First", "Second"]);
  });
});

describe("folder store reorder actions", () => {
  beforeEach(() => {
    useFolderStore.setState({ folders: [], docParents: {}, docOrder: {}, expanded: {} });
  });

  it("setFolderOrder assigns order indices to the given ids", () => {
    useFolderStore.setState({
      folders: [
        { id: "a", name: "A", parentId: null },
        { id: "b", name: "B", parentId: null },
        { id: "c", name: "C", parentId: null },
      ],
    });
    useFolderStore.getState().setFolderOrder(["c", "a", "b"]);
    const byId = Object.fromEntries(useFolderStore.getState().folders.map((f) => [f.id, f.order]));
    expect(byId).toEqual({ c: 0, a: 1, b: 2 });
  });

  it("setDocOrder records the ordered list under the folder key", () => {
    useFolderStore.getState().setDocOrder(docOrderKey(null), ["d2", "d1"]);
    expect(useFolderStore.getState().docOrder.root).toEqual(["d2", "d1"]);
    useFolderStore.getState().setDocOrder(docOrderKey("f1"), ["x"]);
    expect(useFolderStore.getState().docOrder.f1).toEqual(["x"]);
  });

  it("move-to-new-folder: createFolder(parent) then moveDoc places the doc inside", () => {
    const id = useFolderStore.getState().createFolder("New", null);
    useFolderStore.getState().moveDoc("docA", id);
    expect(useFolderStore.getState().docParents.docA).toBe(id);
    expect(useFolderStore.getState().folders.find((f) => f.id === id)?.parentId).toBe(null);
  });

  it("serialize round-trips order + docOrder", () => {
    useFolderStore.setState({
      folders: [{ id: "a", name: "A", parentId: null, order: 3 }],
      docOrder: { root: ["d1"] },
    });
    const snap = useFolderStore.getState().serialize();
    expect(snap.folders[0].order).toBe(3);
    expect(snap.docOrder.root).toEqual(["d1"]);
  });
});
