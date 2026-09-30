/**
 * The association store and the graph merge (public exports of the library,
 * `createAssociationStore` / `mergeGraphWithAssociations`) had no test at all.
 * Pinned here when their types were tightened (A113 lint pass): setAll/add
 * take PARTIAL records because every record is normalised, and the merge takes
 * the editor's own graph export, whose nodes and edges carry more than the
 * association types declare.
 */
import { describe, expect, it } from "vitest";
import { createAssociationStore, mergeGraphWithAssociations } from "../integration/associations";

describe("createAssociationStore", () => {
  it("normalises partial records: default type and origin, weight clamped to 0..1", () => {
    const store = createAssociationStore();
    store.setAll([{ source: "a", target: "b" }, { source: "a", target: "c", type: "cites", weight: 7 }]);
    expect(store.getAssociations()).toEqual([
      { source: "a", target: "b", type: "related", label: null, weight: 1, metadata: {}, origin: "external" },
      { source: "a", target: "c", type: "cites", label: null, weight: 1, metadata: {}, origin: "external" },
    ]);
    expect(store.getOutgoing("a").map((x) => x.target)).toEqual(["b", "c"]);
    expect(store.getIncoming("c").map((x) => x.source)).toEqual(["a"]);
  });

  it("add() skips an association it already holds (same source, target and type)", () => {
    const store = createAssociationStore();
    store.add([{ source: "a", target: "b" }]);
    store.add([{ source: "a", target: "b" }, { source: "a", target: "b", type: "cites" }]);
    expect(store.count).toBe(2);
  });
});

describe("mergeGraphWithAssociations", () => {
  it("marks the wiki edges, appends the external ones, and adds nodes only the associations name", () => {
    const store = createAssociationStore();
    store.setAll([{ source: "doc1", target: "ext:paper", type: "cites" }]);
    // The shape store/link-index exports: richer nodes, edges with a context.
    const wiki = {
      nodes: [{ id: "doc1", title: "One", tags: [], metadata: {}, wordCount: 3, backlinks: 0, forwardLinks: 1 }],
      edges: [{ source: "doc1", target: "doc1", context: "self" }],
    };
    const merged = mergeGraphWithAssociations(wiki, store);
    expect(merged.edges).toHaveLength(2);
    expect(merged.edges[0]).toMatchObject({ source: "doc1", context: "self", external: false, origin: "wiki-link" });
    expect(merged.edges[1]).toMatchObject({ source: "doc1", target: "ext:paper", type: "cites", external: true });
    expect(merged.nodes.map((n) => n.id)).toEqual(["doc1", "ext:paper"]);
    expect(merged.nodes[1]).toEqual({ id: "ext:paper", title: "ext:paper", external: true });
  });
});
