/**
 * Association manager: external relationships provided by host applications.
 *
 * Associations are edges in the document graph that come from OUTSIDE the editor —
 * AI analysis results, search rankings, external knowledge graphs, manual annotations.
 * They're displayed alongside user-created [[wiki links]] in the backlinks panel
 * and graph visualization, but visually distinguished.
 */

// --- Types ---

export interface Association {
  source: string;
  target: string;
  type: string;
  label?: string | null;
  weight?: number;
  metadata?: Record<string, unknown>;
  origin?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  label?: string;
  weight?: number;
  external?: boolean;
  origin?: string;
  metadata?: Record<string, unknown>;
}

export interface GraphNode {
  id: string;
  title?: string;
  external?: boolean;
  [key: string]: unknown;
}

export interface WikiGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface AssociationStore {
  setAll: (newAssociations: Association[]) => void;
  add: (newAssociations: Association[]) => void;
  remove: (predicate: (assoc: Association) => boolean) => void;
  removeByOrigin: (origin: string) => void;
  getIncoming: (docId: string) => Association[];
  getOutgoing: (docId: string) => Association[];
  getAll: (docId: string) => Association[];
  toGraphEdges: () => GraphEdge[];
  getAssociations: () => Association[];
  readonly count: number;
  readonly types: string[];
}

function normalizeAssociation(raw: Partial<Association>): Association {
  return {
    source: String(raw.source ?? ""),
    target: String(raw.target ?? ""),
    type: String(raw.type ?? "related"),
    label: raw.label ?? null,
    weight:
      typeof raw.weight === "number"
        ? Math.max(0, Math.min(1, raw.weight))
        : 1,
    metadata: raw.metadata ?? {},
    origin: raw.origin ?? "external",
  };
}

/**
 * Create an AssociationStore.
 */
export function createAssociationStore(): AssociationStore {
  let associations: Association[] = [];
  let forwardIndex = new Map<string, Set<string>>();
  let reverseIndex = new Map<string, Set<string>>();

  function rebuildIndices(): void {
    forwardIndex = new Map();
    reverseIndex = new Map();
    for (const assoc of associations) {
      if (!forwardIndex.has(assoc.source))
        forwardIndex.set(assoc.source, new Set());
      forwardIndex.get(assoc.source)!.add(assoc.target);
      if (!reverseIndex.has(assoc.target))
        reverseIndex.set(assoc.target, new Set());
      reverseIndex.get(assoc.target)!.add(assoc.source);
    }
  }

  return {
    setAll(newAssociations: Association[]) {
      associations = (newAssociations ?? []).map(normalizeAssociation);
      rebuildIndices();
    },

    add(newAssociations: Association[]) {
      for (const a of newAssociations) {
        const norm = normalizeAssociation(a);
        const exists = associations.some(
          (e) =>
            e.source === norm.source &&
            e.target === norm.target &&
            e.type === norm.type
        );
        if (!exists) associations.push(norm);
      }
      rebuildIndices();
    },

    remove(predicate: (assoc: Association) => boolean) {
      associations = associations.filter((a) => !predicate(a));
      rebuildIndices();
    },

    removeByOrigin(origin: string) {
      associations = associations.filter((a) => a.origin !== origin);
      rebuildIndices();
    },

    getIncoming(docId: string): Association[] {
      const sources = reverseIndex.get(docId);
      if (!sources) return [];
      return associations.filter((a) => a.target === docId);
    },

    getOutgoing(docId: string): Association[] {
      const targets = forwardIndex.get(docId);
      if (!targets) return [];
      return associations.filter((a) => a.source === docId);
    },

    getAll(docId: string): Association[] {
      return [...this.getIncoming(docId), ...this.getOutgoing(docId)];
    },

    toGraphEdges(): GraphEdge[] {
      return associations.map((a) => ({
        source: a.source,
        target: a.target,
        type: a.type,
        label: a.label ?? a.type,
        weight: a.weight ?? 1,
        external: true,
        origin: a.origin,
        metadata: a.metadata ?? {},
      }));
    },

    getAssociations(): Association[] {
      return [...associations];
    },

    get count(): number {
      return associations.length;
    },

    get types(): string[] {
      return [...new Set(associations.map((a) => a.type))];
    },
  };
}

/**
 * Merge wiki-link graph with external associations for unified export.
 */
export function mergeGraphWithAssociations(
  wikiGraph: WikiGraph,
  associationStore: AssociationStore
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = [...(wikiGraph.nodes ?? [])];
  const edges = [...(wikiGraph.edges ?? [])];

  for (const edge of edges) {
    (edge as GraphEdge).external = false;
    (edge as GraphEdge).origin = "wiki-link";
  }

  const externalEdges = associationStore.toGraphEdges();
  edges.push(...externalEdges);

  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const edge of externalEdges) {
    for (const id of [edge.source, edge.target]) {
      if (!nodeIds.has(id)) {
        nodes.push({ id, title: id, external: true });
        nodeIds.add(id);
      }
    }
  }

  return { nodes, edges };
}
