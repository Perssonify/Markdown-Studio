import { Button } from "@/components/ui/button";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Crosshair, Info, Maximize2, Network, PanelRight, Search,
  Share2, Unlink, X, ZoomIn, ZoomOut,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "../utils/reduced-motion";
import { overlayShouldHandleEscape } from "./overlay-escape";
import {
  stepsPerFrame,
  brokenLinks as computeBrokenLinks,
  brokenSourceIds as computeBrokenSourceIds,
  FOLDER_CHIP_H,
  folderRects,
  findOrphans,
  LABEL_GAP,
  LABEL_H,
  labelBoxAt,
  labelWidth,
  matchNodes,
  neighborIds,
  placeLabels,
  rankByDegree,
  truncateLabel,
  type LabelBox,
} from "../store/graph-metrics";

export interface GraphNode {
  id: string;
  title: string;
  backlinks?: number;
  forwardLinks?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphFolder {
  id: string;
  name: string;
  docIds: string[];
}

export interface GraphViewProps {
  graph: GraphData;
  /** Folder grouping — documents sharing a folder are drawn inside a labeled
   *  dashed container (+ a gentle cohesion force). */
  folders?: GraphFolder[];
  /** Flat {id,title} for EVERY document — only used to label a node whose title
   *  is missing from `graph.nodes` (e.g. an unlinked doc). */
  allDocs?: { id: string; title: string }[];
  activeDocId?: string | null;
  onNavigate: (docId: string) => void;
  onClose: () => void;
  /** Download the graph as JSON. Lives in this header rather than the status
   *  bar: it is a map action, and it used to sit in the global chrome where it
   *  was visible even to users who had never opened the map. */
  onExport?: () => void;
  /** The selected document's top headings, for the details rail.
   *
   *  This is deliberately NOT an in-graph structure pane — that existed once,
   *  duplicated the Workspace Outline, and was removed. It answers the much
   *  narrower question a selected dot raises ("what is actually in this note?")
   *  in the panel that already describes the selection. */
  headingsFor?: (docId: string) => { text: string; level: number }[];
  /** Open a document scrolled to one of its headings (flat index, matching
   *  `extractHeadings` order). Without it, headings render as plain labels. */
  onOpenHeading?: (docId: string, headingIndex: number) => void;
  /** Broken (unresolved) links, from `linkIndex.unresolved`. Surfaced as a
   *  health chip + optional ghost targets; never added to the simulation. */
  unresolved?: Map<string, { target: string; displayText: string }[]>;
}

// `allDocs` was removed from the prop set — map node labels come straight from
// `graph.nodes` (which now includes every document via `exportGraph`).

interface Pt {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

// ── Physics ──────────────────────────────────────────────────────────────────
// Tuned to settle in well under a second and then FREEZE.
//
// The simulation runs in its OWN world-space, sized from the node count — NOT
// from the viewport. That separation is load-bearing: layout used to be keyed to
// the canvas rect, so every resize (including docking/undocking a panel beside
// the map) reheated the sim and visibly reshuffled the whole graph. Now a resize
// only re-aims the camera; the layout is untouched.
const PAD = 40;
const REPULSION = 1400;
const SPRING_K = 0.02;
const GRAVITY = 0.015;
// Folder clustering. Cohesion is the SOFT half — it gathers a folder's members.
// Keeping containers off each other and off strangers is a HARD positional
// constraint applied after integration (see `stepOnce`), because as a force it
// simply lost to the springs between two linked folders.
const FOLDER_COHESION = 0.09;
/** Room the LAYOUT reserves for each note's name, so labels are not merely
 *  dropped when they collide — the graph spreads out enough to show them. The
 *  layout measures at 1× (screen units == world units); the draw-time placer is
 *  what actually guarantees no overlap at the current zoom. */
const TEXT_SEPARATION = 0.05;
const TEXT_ROOM_Y = 34;
const FOLDER_GAP = 44;
/** Overlap under this many units is left alone, so clusters stop nudging each
 *  other back and forth instead of settling. */
const FOLDER_SLACK = 6;
const DAMPING = 0.82;
const SETTLE_V = 0.06;
/** Force cooling (d3-style). Without it the layout relaxed on its own schedule —
 *  measured at 377 frames (~6s of rAF) for a 25-note workspace, and worse as the
 *  graph grows. A decaying alpha makes convergence DETERMINISTIC: forces fade to
 *  nothing in ~110 frames, so the loop always reaches its freeze. */
const ALPHA_DECAY = 0.965;
const ALPHA_MIN = 0.02;
/** Hard stop for the force loop. It normally settles in well under a second,
 *  but "settles" must never be a precondition for freezing: a layout that keeps
 *  nudging itself (clusters trading places, nodes pinned on a world edge) once
 *  left the loop running forever, which also meant the post-settle camera fit
 *  NEVER ran — the map stayed framed on its initial ring in a corner. */
const MAX_FRAMES = 900;

/** Stable layout space for `n` documents (independent of the viewport). */
function worldFor(n: number) {
  const w = Math.max(720, Math.min(2600, 520 + n * 90));
  return { w, h: Math.round(w * 0.72) };
}

const CAM_MIN = 0.3;
const CAM_MAX = 3;
// Auto-fit ceiling. 1.5 left a small workspace as a cluster of specks in a
// mostly-empty canvas; labels are counter-scaled, so zooming in further costs
// nothing in legibility.
const FIT_MAX = 2.4;
const clampCam = (k: number) => Math.max(CAM_MIN, Math.min(CAM_MAX, k));

const FOLDER_HUES = [210, 150, 275, 25, 340, 90, 190, 50];

/** If the whole workspace fits at this zoom or better, open on the OVERVIEW
 *  rather than zooming into the active note's neighbourhood. Opening focused on
 *  one cluster of a 25-note map pinned the graph into a corner and left most of
 *  the canvas empty — the first thing a map should answer is "what is here". */
const OVERVIEW_MIN_K = 0.45;
/** Labels are placed greedily in screen space; only this many candidates are
 *  considered, best-connected first (a 2000-note map does not need to try). */
const LABEL_CANDIDATES = 200;

const HEADING_CAP = 10;
const LIST_CAP = 8;

const isWideViewport = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(min-width: 1024px)").matches
    : true;

/**
 * GraphView — the MAP-ONLY knowledge-graph overlay: the force-directed
 * relationship map of the whole workspace (documents + wiki-links + folder
 * clusters). It opens directly on the map with the active document highlighted
 * and its neighbourhood focused. Single-document structure lives in the
 * Workspace panel's Outline tab, NOT here (an in-graph structure pane was
 * removed — it duplicated the Outline that sits beside the graph).
 *
 * LAYOUT — the details rail is DOCKED, never floating. It used to be an
 * `absolute` card pinned over the canvas, while the camera fitted content to the
 * FULL canvas rect: the map centred itself underneath the panel, so the thing
 * you selected was the thing you could no longer see. The rail is now a flex
 * sibling (right column on `lg+`, bottom sheet below that) and the canvas
 * measures only its own box, so focus/fit are correct by construction and
 * nothing occludes the graph. Map chrome (legend, zoom, zoom %) lives in one
 * slim docked footer strip instead of three floating boxes.
 *
 * Physics: a single-`posRef` mutate-in-place loop over world-space that FREEZES
 * on settle (`maxV <= SETTLE_V`) — do NOT reintroduce a per-loop snapshot
 * (jump/drift bug) and do NOT key it back to the viewport (resize reshuffle).
 * On open the camera lands on the active document via `focusActive` until the
 * user pans/zooms/drags (`camTouchedRef`). The rail tracks the SELECTED node
 * (hover only highlights — a rail that follows the pointer flickers). Escape
 * clears an active search/filter first, else closes.
 */
function RawGraphView({ graph, folders = [], activeDocId, onNavigate, onClose, onExport, headingsFor, onOpenHeading, unresolved }: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<Map<string, Pt>>(new Map());
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const activeIdRef = useRef(activeDocId ?? null);
  activeIdRef.current = activeDocId ?? null;

  /** Viewport (the canvas box) — camera only. */
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const dimsRef = useRef(dims);
  dimsRef.current = dims;
  /** Layout space — physics only. */
  const worldRef = useRef(worldFor(graph.nodes.length));
  /** Force temperature; decays to nothing so the loop always converges. */
  const alphaRef = useRef(1);
  /** Drawn size of each node and its label, for the forces that reserve room for
   *  text. Refreshed every render; the loop reads it at frame time. */
  const metaRef = useRef<{ radius: Map<string, number>; label: Map<string, string> }>({
    radius: new Map(), label: new Map(),
  });

  const [, render] = useReducer((n: number) => n + 1, 0);

  // ── Camera ─────────────────────────────────────────────────────────────────
  const camRef = useRef({ k: 1, tx: 0, ty: 0 });
  const camTouchedRef = useRef(false);
  const camSmoothRef = useRef(false);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(activeDocId ?? null);
  const [railOpen, setRailOpen] = useState(isWideViewport);

  // ── Filters / utility state ─────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [isolate, setIsolate] = useState(false);      // selected + neighbours only
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [brokenHi, setBrokenHi] = useState(false);    // highlight broken-source nodes
  const [showGhosts, setShowGhosts] = useState(false); // dashed edges to missing targets

  const dragRef = useRef<{ id: string; moved: boolean; startX: number; startY: number } | null>(null);

  // ── Derived metrics (pure) ───────────────────────────────────────────────────
  const matchSet = useMemo(() => matchNodes(graph.nodes, query), [graph.nodes, query]);
  const filterActive = query.trim().length > 0;
  const orphanSet = useMemo(() => findOrphans(graph.nodes), [graph.nodes]);
  // linkIndex.unresolved is mutated in place with a stable Map identity across
  // incremental updates — re-key on graph.nodes so the overlay's fresh payload
  // recomputes broken data.
  const brokenSources = useMemo(
    () => computeBrokenSourceIds(unresolved),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unresolved, graph.nodes]
  );
  const brokenList = useMemo(
    () => computeBrokenLinks(unresolved),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unresolved, graph.nodes]
  );
  const isoSet = useMemo(
    () => (isolate && selectedId ? neighborIds(graph.edges, selectedId) : new Set<string>()),
    [isolate, selectedId, graph.edges]
  );
  const mostConnected = useMemo(() => rankByDegree(graph.nodes, 5), [graph.nodes]);
  /** Every node, best-connected first — the priority order for label placement. */
  const byImportance = useMemo(
    () => rankByDegree(graph.nodes, -1).map((n) => n.id),
    [graph.nodes]
  );
  const orphanDocs = useMemo(
    () => graph.nodes.filter((n) => orphanSet.has(n.id)).sort((a, b) => a.title.localeCompare(b.title)),
    [graph.nodes, orphanSet]
  );

  const anyFilter = filterActive || (isolate && !!selectedId) || orphansOnly;
  const isVisible = useCallback(
    (id: string) => {
      if (filterActive && !matchSet.has(id)) return false;
      if (isolate && selectedId && !(id === selectedId || isoSet.has(id))) return false;
      if (orphansOnly && !orphanSet.has(id)) return false;
      return true;
    },
    [filterActive, matchSet, isolate, selectedId, isoSet, orphansOnly, orphanSet]
  );

  // ── Simulation ───────────────────────────────────────────────────────────────
  const stepOnce = useCallback(() => {
    const ps = Array.from(posRef.current.values());
    const edges = graphRef.current.edges;
    const { w, h } = worldRef.current;
    const cx = w / 2, cy = h / 2;
    const alpha = alphaRef.current;
    // Spread scales with the NUMBER of notes, not the world area: world size
    // already grows with the node count, so scaling by area double-counted it
    // (10× the repulsion at 25 notes) and stretched out the relaxation.
    const spread = Math.max(1, Math.min(5, ps.length / 6));
    const repulsion = REPULSION * spread * alpha;
    const springLen = Math.max(70, Math.min(170, Math.min(w, h) / 4));
    const minX = PAD, maxX = Math.max(PAD + 1, w - PAD);
    const minY = PAD, maxY = Math.max(PAD + 1, h - PAD);

    const meta = metaRef.current;
    const radiusOf = (id: string) => meta.radius.get(id) ?? 7;
    const labelOf = (id: string) => meta.label.get(id) ?? "";
    // Half the drawn width of each node's own name — how much horizontal room
    // that note needs to be readable.
    const halfW = ps.map((p) => Math.max(radiusOf(p.id), labelWidth(labelOf(p.id)) / 2));

    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i]!, b = ps[j]!;
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { d2 = 1; dx = (Math.random() - 0.5) * 0.1; dy = (Math.random() - 0.5) * 0.1; }
        const d = Math.sqrt(d2);
        const f = repulsion / d2;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
        // Radial repulsion alone is blind to TEXT: two notes a comfortable
        // distance apart can still have names that run straight through each
        // other. Resolve the label boxes on whichever axis they overlap least.
        const needX = halfW[i]! + halfW[j]!;
        const ax = Math.abs(dx), ay = Math.abs(dy);
        if (ax < needX && ay < TEXT_ROOM_Y) {
          const ox = needX - ax, oy = TEXT_ROOM_Y - ay;
          if (ox / needX <= oy / TEXT_ROOM_Y) {
            const push = ox * TEXT_SEPARATION * alpha * (dx < 0 ? -1 : 1);
            a.vx -= push; b.vx += push;
          } else {
            const push = oy * TEXT_SEPARATION * alpha * (dy < 0 ? -1 : 1);
            a.vy -= push; b.vy += push;
          }
        }
      }
    }
    for (const e of edges) {
      const a = posRef.current.get(e.source), b = posRef.current.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - springLen) * SPRING_K * alpha;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
    // Cohesion holds a folder's members together…
    for (const folder of foldersRef.current) {
      if (folder.docIds.length < 2) continue;
      const pts: Pt[] = [];
      let fcx = 0, fcy = 0;
      for (const id of folder.docIds) {
        const p = posRef.current.get(id);
        if (p) { pts.push(p); fcx += p.x; fcy += p.y; }
      }
      if (pts.length < 2) continue;
      fcx /= pts.length; fcy /= pts.length;
      for (const p of pts) {
        p.vx += (fcx - p.x) * FOLDER_COHESION * alpha;
        p.vy += (fcy - p.y) * FOLDER_COHESION * alpha;
      }
    }

    let maxV = 0;
    for (const p of ps) {
      p.vx += (cx - p.x) * GRAVITY * alpha;
      p.vy += (cy - p.y) * GRAVITY * alpha;
      if (dragRef.current?.id === p.id) { p.vx = 0; p.vy = 0; continue; }
      p.vx *= DAMPING; p.vy *= DAMPING;
      p.x = Math.max(minX, Math.min(maxX, p.x + p.vx));
      p.y = Math.max(minY, Math.min(maxY, p.y + p.vy));
      const v = Math.abs(p.vx) + Math.abs(p.vy);
      if (v > maxV) maxV = v;
    }

    // ── Hard container constraints ───────────────────────────────────────────
    // Applied to POSITIONS after integration, and deliberately NOT scaled by
    // alpha. As a velocity nudge this lost: springs pulling two linked folders
    // together simply out-pulled it, and whatever overlap was left when the
    // forces cooled was the overlap the user saw. As a positional constraint it
    // is the last word each frame, so the resting layout always satisfies it —
    // and once alpha has decayed there is nothing left to fight it.
    const clusterRects = () => folderRects({
      folders: foldersRef.current,
      positions: posRef.current,
      radius: radiusOf,
      label: labelOf,
      k: 1,
    });
    const shift = (p: Pt, dx: number, dy: number) => {
      p.x = Math.max(minX, Math.min(maxX, p.x + dx));
      p.y = Math.max(minY, Math.min(maxY, p.y + dy));
    };
    for (let pass = 0; pass < 3; pass++) {
      const rects = clusterRects();
      if (!rects.length) break;
      const members = rects.map((r) => r.docIds.map((id) => posRef.current.get(id)).filter((q): q is Pt => !!q));
      // Container ↔ container.
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const A = rects[i]!, B = rects[j]!;
          const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0) + FOLDER_GAP;
          const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0) + FOLDER_GAP;
          if (ox <= 0 || oy <= 0) continue;
          const horizontal = ox <= oy;
          const dir = horizontal
            ? ((A.x0 + A.x1) <= (B.x0 + B.x1) ? 1 : -1)
            : ((A.y0 + A.y1) <= (B.y0 + B.y1) ? 1 : -1);
          const step = (horizontal ? ox : oy) / 2;
          for (const p of members[i]!) shift(p, horizontal ? -step * dir : 0, horizontal ? 0 : -step * dir);
          for (const p of members[j]!) shift(p, horizontal ? step * dir : 0, horizontal ? 0 : step * dir);
        }
      }
      // Container ↔ outsider: measured with the outsider's own label footprint,
      // so a foreign NAME cannot lie across a container it has nothing to do with.
      for (const p of ps) {
        const hw = Math.max(radiusOf(p.id), labelWidth(labelOf(p.id)) / 2) + FOLDER_SLACK;
        const vh = radiusOf(p.id) + LABEL_GAP + LABEL_H + FOLDER_SLACK;
        const violating = rects.filter((rect, i) =>
          !members[i]!.some((q) => q.id === p.id)
          && p.x + hw > rect.x0 && p.x - hw < rect.x1
          && p.y + vh > rect.y0 && p.y - vh < rect.y1
        );
        if (!violating.length) continue;
        const own = new Set<string>();
        rects.forEach((rect, i) => { if (members[i]!.some((q) => q.id === p.id)) own.add(rect.id); });
        const inAny = (x: number, y: number) => rects.some((rect) =>
          !own.has(rect.id)
          && x + hw > rect.x0 && x - hw < rect.x1 && y + vh > rect.y0 && y - vh < rect.y1
        );
        const rect = violating[0]!;
        // All four walls, nearest first — but a wall is only worth using if the
        // node does not land inside the NEXT container along. A note wedged in
        // the corridor between two clusters was otherwise shoved back and forth
        // between them and stayed inside one of the two.
        const exits: { dx: number; dy: number; d: number }[] = [
          { dx: -(p.x + hw - rect.x0), dy: 0, d: p.x + hw - rect.x0 },
          { dx: rect.x1 - (p.x - hw), dy: 0, d: rect.x1 - (p.x - hw) },
          { dx: 0, dy: -(p.y + vh - rect.y0), d: p.y + vh - rect.y0 },
          { dx: 0, dy: rect.y1 - (p.y - vh), d: rect.y1 - (p.y - vh) },
        ].sort((a, b) => a.d - b.d);
        const best = exits.find((e) => !inAny(p.x + e.dx, p.y + e.dy)) ?? exits[0]!;
        shift(p, best.dx, best.dy);
      }
    }

    alphaRef.current = alpha * ALPHA_DECAY;
    return maxV;
  }, []);

  /** Aim the camera at a world-space box, letterboxed into the canvas.
   *  `smooth` animates the move — correct for a discrete jump (Focus, Fit), but
   *  it must be off while the camera tracks a moving layout frame-by-frame.
   *
   *  The breathing room around the content is reserved in SCREEN pixels, not
   *  world units: labels are drawn at a constant size, so a world-space pad
   *  shrank exactly when it was needed most and clipped the outermost names off
   *  the edge of the canvas when zoomed out. */
  const frame = useCallback((x0: number, y0: number, x1: number, y1: number, smooth = true) => {
    const { w, h } = dimsRef.current;
    const mx = Math.min(76, w * 0.16), my = Math.min(40, h * 0.12);
    const spanX = Math.max(1, x1 - x0), spanY = Math.max(1, y1 - y0);
    const k = Math.max(CAM_MIN, Math.min(FIT_MAX, Math.min((w - 2 * mx) / spanX, (h - 2 * my) / spanY)));
    camRef.current = { k, tx: (w - k * (x0 + x1)) / 2, ty: (h - k * (y0 + y1)) / 2 };
    camSmoothRef.current = smooth;
    render();
  }, []);

  /** Padded world-space bounds of every placed node. */
  const contentBox = useCallback(() => {
    const ps = Array.from(posRef.current.values());
    if (!ps.length) return null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of ps) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    return { x0: x0 - 20, y0: y0 - 16, x1: x1 + 20, y1: y1 + 28 };
  }, []);

  const fitToContent = useCallback((smooth = true) => {
    const b = contentBox();
    if (b) frame(b.x0, b.y0, b.x1, b.y1, smooth);
  }, [contentBox, frame]);

  const focusOnNode = useCallback((id: string) => {
    const p = posRef.current.get(id);
    if (!p) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const acc = (q?: Pt) => {
      if (!q) return;
      if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x;
      if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y;
    };
    acc(p);
    for (const e of graphRef.current.edges) {
      if (e.source === id) acc(posRef.current.get(e.target));
      else if (e.target === id) acc(posRef.current.get(e.source));
    }
    frame(x0 - 24, y0 - 20, x1 + 24, y1 + 34);
  }, [frame]);

  const focusActive = useCallback((id: string) => {
    const folder = foldersRef.current.find((f) => f.docIds.includes(id) && f.docIds.length >= 2);
    if (folder) {
      const pts = folder.docIds.map((d) => posRef.current.get(d)).filter((p): p is Pt => !!p);
      if (pts.length >= 2) {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const q of pts) { if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y; }
        frame(x0 - 30, y0 - 34, x1 + 30, y1 + 40);
        return;
      }
    }
    focusOnNode(id);
  }, [frame, focusOnNode]);

  /** Re-aim the camera after a viewport change, unless the user has taken over.
   *  Overview first: only a workspace too large to read whole falls back to the
   *  active note's neighbourhood. */
  const recenter = useCallback((smooth = true) => {
    if (camTouchedRef.current) return;
    const active = activeIdRef.current;
    const hasActive = !!active && posRef.current.has(active);
    const b = contentBox();
    if (b) {
      const { w, h } = dimsRef.current;
      const mx = Math.min(76, w * 0.16), my = Math.min(40, h * 0.12);
      const fitK = Math.min((w - 2 * mx) / Math.max(1, b.x1 - b.x0), (h - 2 * my) / Math.max(1, b.y1 - b.y0));
      if (!hasActive || fitK >= OVERVIEW_MIN_K) { fitToContent(smooth); return; }
    }
    if (hasActive) focusActive(active!);
    else fitToContent(smooth);
  }, [contentBox, focusActive, fitToContent]);

  const framesRef = useRef(0);
  const loop = useCallback(() => {
    // `framesRef` counts STEPS, not rendered frames, so MAX_FRAMES stays the
    // same hard budget on the simulation however many steps a frame takes.
    const steps = stepsPerFrame(graphRef.current.nodes.length);
    let maxV = 0;
    for (let i = 0; i < steps; i++) {
      maxV = stepOnce();
      framesRef.current += 1;
      if (maxV <= SETTLE_V || alphaRef.current <= ALPHA_MIN || framesRef.current >= MAX_FRAMES) break;
    }
    // Keep the frame on the content WHILE it spreads out, un-animated. Fitting
    // only once the layout had stopped meant an unsettled graph stayed framed on
    // the ring it started from, parked in a corner of an otherwise empty canvas.
    recenter(false);
    render();
    if (maxV > SETTLE_V && alphaRef.current > ALPHA_MIN && runningRef.current && framesRef.current < MAX_FRAMES) {
      rafRef.current = requestAnimationFrame(loop);
    } else {
      runningRef.current = false;
      rafRef.current = null;
      recenter();
    }
  }, [stepOnce, recenter]);

  /** Run the layout to its resting state without painting a single intermediate
   *  frame — same steps, same resulting positions, the user simply never sees
   *  the ring explode into a graph. This is the ONE piece of motion in the app
   *  that `styles.css`'s reduced-motion guard cannot reach: it is neither a CSS
   *  animation nor a transition but node positions advanced by rAF. (The 450ms
   *  camera move looks like the same problem and is not — it is an inline CSS
   *  transition, which the stylesheet's `!important` duration already beats.) */
  const settleImmediately = useCallback(() => {
    runningRef.current = false;
    while (framesRef.current < MAX_FRAMES) {
      const maxV = stepOnce();
      framesRef.current += 1;
      if (maxV <= SETTLE_V || alphaRef.current <= ALPHA_MIN) break;
    }
    recenter();
    render();
  }, [stepOnce, recenter]);

  /** Restart the loop. `alpha` is the temperature: 1 for a fresh layout, a small
   *  value for a nudge (dragging a node must not re-explode the whole map). */
  const reheat = useCallback((alpha = 1) => {
    if (runningRef.current) {
      alphaRef.current = Math.max(alphaRef.current, alpha);
      return;
    }
    framesRef.current = 0;
    alphaRef.current = alpha;
    if (prefersReducedMotion()) {
      settleImmediately();
      return;
    }
    runningRef.current = true;
    rafRef.current = requestAnimationFrame(loop);
  }, [loop, settleImmediately]);

  // (Re)initialise positions when the SET of node ids changes; run the sim (the
  // overlay is only mounted while open, so "always" == "while visible").
  const nodeKey = graph.nodes.map((n) => n.id).sort().join("|");
  useEffect(() => {
    const cur = posRef.current;
    const next = new Map<string, Pt>();
    const n = graph.nodes.length || 1;
    worldRef.current = worldFor(n);
    const { w, h } = worldRef.current;
    const r = Math.min(Math.min(w, h) / 2 - PAD - 10, 60 + n * 22);
    graph.nodes.forEach((node, i) => {
      const existing = cur.get(node.id);
      if (existing) { next.set(node.id, existing); return; }
      const angle = (2 * Math.PI * i) / n;
      next.set(node.id, { id: node.id, x: w / 2 + r * Math.cos(angle), y: h / 2 + r * Math.sin(angle), vx: 0, vy: 0 });
    });
    posRef.current = next;
    reheat();
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); runningRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey]);

  // Track the canvas's real size. A resize NEVER reheats the simulation — the
  // layout lives in world-space, so all a new viewport changes is the camera.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 40 && r.height > 40) {
        const w = Math.round(r.width), h = Math.round(r.height);
        if (dimsRef.current.w === w && dimsRef.current.h === h) return;
        dimsRef.current = { w, h };
        setDims({ w, h });
        recenter();
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [recenter]);

  const clearFilters = useCallback(() => {
    setQuery("");
    setIsolate(false);
    setOrphansOnly(false);
    setBrokenHi(false);
    setShowGhosts(false);
  }, []);
  const anyFilterRef = useRef(anyFilter || brokenHi);
  anyFilterRef.current = anyFilter || brokenHi;

  // Escape: clear an active search/filter first, else exit the graph — but
  // only an Escape meant for the map. It used to act on EVERY Escape in the
  // window: in a library rename box beside the map it closed the map, and the
  // blur that followed committed the rename the user was cancelling. See
  // overlayShouldHandleEscape.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!overlayShouldHandleEscape(e, rootRef.current)) return;
      e.preventDefault();
      if (anyFilterRef.current) clearFilters();
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, clearFilters]);

  // Follow the active doc until the user selects a different one.
  const userPickedRef = useRef(false);
  useEffect(() => {
    if (userPickedRef.current || !activeDocId) return;
    setSelectedId(activeDocId);
    if (!camTouchedRef.current && posRef.current.has(activeDocId)) focusActive(activeDocId);
  }, [activeDocId, focusActive]);

  /** Selecting a note is a request to SEE it: below `lg` the details panel is a
   *  collapsed bottom sheet, so a tap on the map would otherwise appear to do
   *  nothing at all. */
  const revealRail = useCallback(() => {
    if (!isWideViewport()) setRailOpen(true);
  }, []);

  /** Select a node from a list row: show it in the map, keep the user's place. */
  const pick = useCallback((id: string, alsoFocus = true) => {
    userPickedRef.current = true;
    setSelectedId(id);
    revealRail();
    if (alsoFocus) focusOnNode(id);
  }, [focusOnNode, revealRail]);

  // ── Pointer → world mapping ──────────────────────────────────────────────────
  const toRaw = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const { w, h } = dimsRef.current;
    return {
      x: ((clientX - rect.left) / rect.width) * w,
      y: ((clientY - rect.top) / rect.height) * h,
    };
  }, []);
  const toView = useCallback((clientX: number, clientY: number) => {
    const raw = toRaw(clientX, clientY);
    const { k, tx, ty } = camRef.current;
    return { x: (raw.x - tx) / k, y: (raw.y - ty) / k };
  }, [toRaw]);

  // Wheel zoom is attached by a CALLBACK REF on the <svg>, not an effect. The
  // effect ran once, on mount — and the <svg> only exists once there is a graph
  // to draw: every open after the first mounts with no graph data yet (the
  // empty state renders instead), so the listener was never attached and a
  // trackpad pinch zoomed the whole browser page. A callback ref runs whenever
  // that element actually appears or goes away.
  const wheelCleanupRef = useRef<(() => void) | null>(null);
  const setSvgRef = useCallback((svg: SVGSVGElement | null) => {
    wheelCleanupRef.current?.();
    wheelCleanupRef.current = null;
    svgRef.current = svg;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const raw = toRaw(e.clientX, e.clientY);
      const { k, tx, ty } = camRef.current;
      const nk = clampCam(k * Math.exp(-e.deltaY * 0.0016));
      if (nk === k) return;
      camRef.current = {
        k: nk,
        tx: raw.x - ((raw.x - tx) * nk) / k,
        ty: raw.y - ((raw.y - ty) * nk) / k,
      };
      camTouchedRef.current = true;
      camSmoothRef.current = false;
      render();
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    wheelCleanupRef.current = () => svg.removeEventListener("wheel", onWheel);
  }, [toRaw]);

  const zoomBy = useCallback((factor: number) => {
    const { w, h } = dimsRef.current;
    const { k, tx, ty } = camRef.current;
    const nk = clampCam(k * factor);
    if (nk === k) return;
    camRef.current = {
      k: nk,
      tx: w / 2 - ((w / 2 - tx) * nk) / k,
      ty: h / 2 - ((h / 2 - ty) * nk) / k,
    };
    camTouchedRef.current = true;
    camSmoothRef.current = false;
    render();
  }, []);
  const handleFit = useCallback(() => {
    camTouchedRef.current = false;
    fitToContent();
  }, [fitToContent]);

  const panRef = useRef<{ sx: number; sy: number; tx0: number; ty0: number; moved: boolean } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!svgRef.current) return;
      const pan = panRef.current;
      if (pan) {
        if (!pan.moved && Math.hypot(e.clientX - pan.sx, e.clientY - pan.sy) < 4) return;
        pan.moved = true;
        const rect = svgRef.current.getBoundingClientRect();
        const { w, h } = dimsRef.current;
        camRef.current = {
          ...camRef.current,
          tx: pan.tx0 + ((e.clientX - pan.sx) / rect.width) * w,
          ty: pan.ty0 + ((e.clientY - pan.sy) / rect.height) * h,
        };
        camTouchedRef.current = true;
        camSmoothRef.current = false;
        render();
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.moved) {
        const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
        if (dist < 4) return;
        drag.moved = true;
        // Rearranging a node is an intentional camera-touch: without this, the
        // post-settle auto-focus would snap the camera back after every drag.
        camTouchedRef.current = true;
      }
      const { x, y } = toView(e.clientX, e.clientY);
      const { w, h } = worldRef.current;
      const p = posRef.current.get(drag.id);
      if (p) { p.x = Math.max(PAD, Math.min(w - PAD, x)); p.y = Math.max(PAD, Math.min(h - PAD, y)); p.vx = 0; p.vy = 0; }
      reheat(0.25);
      render();
    };
    const onUp = () => {
      panRef.current = null;
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag && !drag.moved) {
        userPickedRef.current = true;
        setSelectedId(drag.id);
        if (!isWideViewport()) setRailOpen(true);
      } else if (drag) {
        reheat(0.25);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [toView, reheat]);

  const onNodeDown = useCallback((e: React.PointerEvent, id: string) => {
    e.preventDefault();
    dragRef.current = { id, moved: false, startX: e.clientX, startY: e.clientY };
  }, []);

  const focusSearch = useCallback(() => {
    const first = graph.nodes.find((n) => matchSet.has(n.id));
    if (first) pick(first.id);
  }, [graph.nodes, matchSet, pick]);

  const orphanCount = orphanSet.size;
  const brokenCount = brokenList.length;

  const positions = posRef.current;
  const detail = (selectedId && graph.nodes.find((n) => n.id === selectedId)) || null;

  // ── Rail data for the selected node ───────────────────────────────────────
  // Headings carry their FLAT INDEX (the same order `extractHeadings` yields),
  // because that is what the editor's scroll-to-heading takes.
  const allDetailHeadings = useMemo(
    () => (detail && headingsFor ? headingsFor(detail.id).map((h, index) => ({ ...h, index })) : []),
    [detail, headingsFor]
  );
  const detailHeadings = allDetailHeadings.slice(0, HEADING_CAP);
  const detailHeadingOverflow = Math.max(0, allDetailHeadings.length - detailHeadings.length);

  const titleById = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n.title])),
    [graph.nodes]
  );
  const detailFolder = useMemo(
    () => (detail ? folders.find((f) => f.docIds.includes(detail.id))?.name ?? null : null),
    [detail, folders]
  );
  /** Which notes this one points at, and which point at it — as real, clickable
   *  documents. The panel used to show only the two counts, which told you a
   *  relationship existed but not with what. */
  const outboundDocs = useMemo(() => {
    if (!detail) return [];
    const ids = new Set(graph.edges.filter((e) => e.source === detail.id).map((e) => e.target));
    return [...ids].map((id) => ({ id, title: titleById.get(id) ?? "Untitled" }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [detail, graph.edges, titleById]);
  const inboundDocs = useMemo(() => {
    if (!detail) return [];
    const ids = new Set(graph.edges.filter((e) => e.target === detail.id).map((e) => e.source));
    return [...ids].map((id) => ({ id, title: titleById.get(id) ?? "Untitled" }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [detail, graph.edges, titleById]);
  const detailBroken = useMemo(
    () => (detail ? brokenList.filter((b) => b.sourceId === detail.id) : []),
    [detail, brokenList]
  );

  const nodeRadius = useCallback(
    (node: GraphNode) => 7 + Math.min(10, (node.backlinks || 0) * 1.5),
    []
  );
  const radiusById = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of graph.nodes) m.set(n.id, nodeRadius(n));
    return m;
  }, [graph.nodes, nodeRadius]);
  const labelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of graph.nodes) m.set(n.id, truncateLabel(n.title));
    return m;
  }, [graph.nodes]);
  // Hand the force loop the drawn sizes, so the LAYOUT can reserve room for text.
  metaRef.current = { radius: radiusById, label: labelById };
  const labelOf = useCallback((id: string) => labelById.get(id) ?? "", [labelById]);

  /** Ordered pairs that are linked in BOTH directions (see the edge renderer). */
  const reciprocal = useMemo(() => {
    const seen = new Set(graph.edges.map((e) => `${e.source}|${e.target}`));
    const both = new Set<string>();
    for (const e of graph.edges) {
      if (e.source !== e.target && seen.has(`${e.target}|${e.source}`)) both.add(`${e.source}|${e.target}`);
    }
    return both;
  }, [graph.edges]);

  // Everything the map DRAWS is sized in screen pixels and divided by `k`, so
  // only POSITIONS scale with the camera. Sizing the glyphs in world units made
  // zooming in inflate dots, strokes and arrowheads into chunky blobs (and
  // shrink them to invisible specks on the way out) — zoom should change how far
  // apart notes are, not how big a note looks.
  const k = camRef.current.k;
  // Dots hold ONE screen size while zooming in, but are damped on the way out:
  // fully constant dots turn a zoomed-out map into a blob of touching circles,
  // and the extra ink crowds out the labels and folder chips that a zoomed-out
  // reader is actually navigating by.
  const dotScale = k >= 1 ? 1 : 0.6 + 0.4 * k;
  const drawnRadius = (id: string) => (radiusById.get(id) ?? 7) * dotScale;
  const zoomPct = Math.round(k * 100);

  // ── Geometry shared by the drawing, the labels and the layout ─────────────
  // ONE set of folder rectangles at the CURRENT zoom: the boxes drawn on the
  // canvas, the chips reserved against labels, and (measured at 1×) the boxes
  // the forces keep apart are all this same function.
  const toScreen = (b: LabelBox): LabelBox => ({
    x0: b.x0 * k + camRef.current.tx, y0: b.y0 * k + camRef.current.ty,
    x1: b.x1 * k + camRef.current.tx, y1: b.y1 * k + camRef.current.ty,
  });
  const visibleNodes = anyFilter ? graph.nodes.filter((n) => isVisible(n.id)) : graph.nodes;
  /** Every drawn dot, in world space — chips and labels both steer around these. */
  const dotBoxes: LabelBox[] = [];
  for (const node of visibleNodes) {
    const p = positions.get(node.id);
    if (!p) continue;
    const r = (drawnRadius(node.id) + 3) / k;
    dotBoxes.push({ x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r });
  }
  const rects = folderRects({ folders, positions, radius: drawnRadius, label: labelOf, k, avoid: dotBoxes });

  // ── Which labels get drawn, and where ─────────────────────────────────────
  // Resolved every render (NOT memoized): node positions live in a mutable ref,
  // so a memo keyed on the camera would hand back a placement computed against
  // already-stale coordinates while the simulation is still moving.
  //
  // Reserved BEFORE any text: every node's dot, and every folder chip. A label
  // is never drawn over either — it moves to another side of its dot, and only
  // if all four sides are taken is it dropped (the note is still named in the
  // rail, and zooming in frees the space up again).
  const obstacles: LabelBox[] = dotBoxes.map(toScreen);
  for (const rect of rects) obstacles.push(toScreen(rect.chip));
  /** Foreign containers, in screen space. A note's name drawn across someone
   *  else's folder box reads as membership — the one thing the box exists to
   *  say. The layout keeps DOTS out of foreign boxes; a label placed to the SIDE
   *  of its dot reaches further than that, so the placer vetoes it here. */
  const foreignBoxes = rects.map((r) => ({ docs: new Set(r.docIds), box: toScreen(r) }));
  const crossesForeignFolder = (id: string, box: LabelBox) =>
    foreignBoxes.some((f) => !f.docs.has(id)
      && box.x0 < f.box.x1 && box.x1 > f.box.x0 && box.y0 < f.box.y1 && box.y1 > f.box.y0);

  // Ghost targets are an explicit request ("show me the broken links"), so their
  // stub labels claim their space before ordinary node labels compete for it.
  const ghostPoints = new Map<string, { x: number; y: number }>();
  const ghostText = new Map<string, string>();
  if (showGhosts) {
    brokenList.forEach((bl, i) => {
      const src = positions.get(bl.sourceId);
      if (!src) return;
      const ang = i * 2.399963; // golden-angle spread around the source
      ghostPoints.set(`ghost:${i}`, { x: src.x + (Math.cos(ang) * 52) / k, y: src.y + (Math.sin(ang) * 52) / k });
      ghostText.set(`ghost:${i}`, truncateLabel(bl.target));
    });
  }
  const canvasBounds: LabelBox = { x0: 3, y0: 3, x1: Math.max(4, dims.w - 3), y1: Math.max(4, dims.h - 3) };
  const ghostLabels = placeLabels({
    order: [...ghostPoints.keys()],
    positions: ghostPoints,
    radius: () => 5,
    label: (id) => ghostText.get(id) ?? "",
    cam: { k, tx: camRef.current.tx, ty: camRef.current.ty },
    obstacles,
    bounds: canvasBounds,
  });
  for (const [id, place] of ghostLabels) {
    const p = ghostPoints.get(id)!;
    obstacles.push(labelBoxAt(p.x * k + camRef.current.tx, p.y * k + camRef.current.ty, place));
  }

  // Priority: what the user is looking at, then best-connected, then the rest
  // (`byImportance` drops zero-degree notes, which still deserve a name).
  const forcedLabels = new Set(
    [selectedId, activeDocId ?? null, hoveredId].filter((v): v is string => !!v)
  );
  const rankedSet = new Set(byImportance);
  const labelPlacements = placeLabels({
    order: [
      ...forcedLabels,
      ...byImportance.filter((id) => !forcedLabels.has(id)),
      ...graph.nodes.map((n) => n.id).filter((id) => !forcedLabels.has(id) && !rankedSet.has(id)),
    ],
    forced: forcedLabels,
    positions: anyFilter
      ? new Map([...positions].filter(([id]) => isVisible(id)))
      : positions,
    radius: drawnRadius,
    label: labelOf,
    cam: { k, tx: camRef.current.tx, ty: camRef.current.ty },
    obstacles,
    bounds: canvasBounds,
    reject: crossesForeignFolder,
    limit: LABEL_CANDIDATES,
  });

  // ── Header ────────────────────────────────────────────────────────────────────
  const header = (
    // Wraps rather than hiding: the filter chips and the JSON export used to be
    // `hidden sm:flex`, and CLAUDE.md says the export deliberately has no other
    // home (it was moved off the status bar) while the chips ARE the filter. On
    // a phone both simply vanished. They stay, and the header takes a second row
    // when it has to.
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
      <div className="hidden min-w-0 shrink-0 items-center gap-2 lg:flex">
        <Network className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 leading-tight">
          <h2 className="truncate text-xs font-semibold text-foreground">Relationship map</h2>
          <p className="truncate text-[10px] text-muted-foreground">
            {graph.nodes.length} note{graph.nodes.length === 1 ? "" : "s"} · {graph.edges.length} link{graph.edges.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="relative min-w-0 flex-1 lg:max-w-xs">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusSearch(); } }}
          placeholder="Search notes…"
          aria-label="Search notes in the map"
          className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-7 text-base md:text-xs outline-none focus-visible:ring-1 focus-visible:ring-primary"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* Health filters — the counts have a home in the rail, which lists the
          actual notes behind each number. */}
      <div className="flex shrink-0 items-center gap-1">
        <HealthChip
          icon={<Unlink className="size-3.5" />}
          count={orphanCount}
          active={orphansOnly}
          onClick={() => setOrphansOnly((v) => !v)}
          label="unlinked"
          title="Show only notes with no links"
        />
        <HealthChip
          icon={<AlertTriangle className="size-3.5" />}
          count={brokenCount}
          active={brokenHi}
          onClick={() => { setBrokenHi((v) => { const nv = !v; if (!nv) setShowGhosts(false); return nv; }); }}
          label="broken"
          title="Highlight notes with broken [[links]]"
          warn
        />
        {/* The ghost-target switch lives HERE, beside the chip that turns broken
            highlighting on — its only other home was a rail section that
            disappears the moment a note is selected, so it became unreachable
            exactly when a user chasing a broken link would want it. */}
        {brokenHi && brokenCount > 0 && (
          <button
            type="button"
            aria-pressed={showGhosts}
            onClick={() => setShowGhosts((v) => !v)}
            title="Draw the missing link targets on the map"
            className={cn(
              "h-8 rounded-md border px-2 text-[11px] font-medium transition-colors",
              showGhosts
                ? "border-amber-500/50 bg-amber-500/15 text-amber-600"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            targets
          </button>
        )}
      </div>

      {anyFilter && (
        <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1 text-[11px] text-muted-foreground" onClick={clearFilters}>
          <X className="size-3.5" /> <span className="hidden sm:inline">Clear filters</span>
        </Button>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {onExport && (
          <Button variant="ghost" size="icon-sm" aria-label="Export map data as JSON" title="Export map data (JSON)" onClick={onExport}><Share2 /></Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-pressed={railOpen}
          aria-label={railOpen ? "Hide details panel" : "Show details panel"}
          title={railOpen ? "Hide details panel" : "Show details panel"}
          className={cn(railOpen && "bg-accent text-accent-foreground")}
          onClick={() => setRailOpen((v) => !v)}
        >
          <PanelRight />
        </Button>
      </div>
      <Button variant="default" size="sm" className="shrink-0 gap-1.5" aria-label="Back to the editor" title="Back to editor (Esc)" onClick={onClose}>
        <ArrowLeft className="size-4" /> <span className="hidden sm:inline">Back to editor</span>
      </Button>
    </div>
  );

  const emptyState = !graph?.nodes?.length ? (
    <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
      <Info className="mb-2 size-8 opacity-20" />
      <p className="text-sm font-medium">No notes yet</p>
      <p className="mt-1 text-xs opacity-70">Create notes and link them with [[wiki links]] to see them here.</p>
    </div>
  ) : graph.edges.length === 0 ? (
    /* Nodes but no edges — the map is technically drawing, but a scatter of
       unconnected dots tells the user nothing and reads as broken. Say what
       the map is waiting for, and still list the notes so it isn't a blank. */
    <div className="flex h-full flex-col items-center justify-center px-6 text-center text-muted-foreground">
      <Network className="mb-3 size-8 opacity-20" />
      <p className="text-sm font-medium text-foreground">
        {graph.nodes.length === 1 ? "One note, nothing linked yet" : `${graph.nodes.length} notes, none linked yet`}
      </p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed">
        This map draws a line between two notes when one links to the other. Type{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">[[</code>{" "}
        in any document and pick a note to link it — the connection appears here.
      </p>
      <ul className="mt-4 flex max-w-md flex-wrap justify-center gap-1.5">
        {graph.nodes.slice(0, 12).map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => onNavigate(n.id)}
              className="max-w-[16rem] truncate rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-foreground hover:bg-accent"
              title={`Open ${n.title}`}
            >
              {n.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  ) : null;

  const canvas = (
    <svg
      ref={setSvgRef}
      viewBox={`0 0 ${dims.w} ${dims.h}`}
      className="h-full w-full touch-none select-none"
      role="group"
      aria-label={`Relationship map: ${graph.nodes.length} documents, ${graph.edges.length} links`}
      style={{ cursor: dragRef.current || panRef.current?.moved ? "grabbing" : "default" }}
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        panRef.current = { sx: e.clientX, sy: e.clientY, tx0: camRef.current.tx, ty0: camRef.current.ty, moved: false };
      }}
    >
      <defs>
        <marker
          id="pf-arrow" viewBox="0 0 10 10" refX="9" refY="5"
          markerUnits="userSpaceOnUse" markerWidth={9 / k} markerHeight={9 / k}
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground/50" />
        </marker>
        <marker
          id="pf-arrow-hot" viewBox="0 0 10 10" refX="9" refY="5"
          markerUnits="userSpaceOnUse" markerWidth={9 / k} markerHeight={9 / k}
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className="fill-primary/80" />
        </marker>
      </defs>

      <g
        style={{
          transform: `translate(${camRef.current.tx}px, ${camRef.current.ty}px) scale(${camRef.current.k})`,
          transformOrigin: "0 0",
          transition: camSmoothRef.current ? "transform 450ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
        }}
      >
        {rects.map((rect, fi) => {
          const hue = FOLDER_HUES[fi % FOLDER_HUES.length]!;
          return (
            <g key={`folder-${rect.id}`} className="pointer-events-none" data-folder-docs={rect.docIds.join(" ")}>
              <rect
                className="pf-folder-box"
                x={rect.x0} y={rect.y0} width={rect.x1 - rect.x0} height={rect.y1 - rect.y0} rx={16 / k}
                fill={`hsl(${hue} 70% 55% / 0.055)`}
                stroke={`hsl(${hue} 70% 55% / 0.45)`}
                strokeWidth={1.5 / k}
                strokeDasharray={`${6 / k} ${5 / k}`}
              />
            </g>
          );
        })}

        {graph.edges.map((edge, i) => {
          const a = positions.get(edge.source), b = positions.get(edge.target);
          if (!a || !b) return null;
          const hot = edge.source === selectedId || edge.target === selectedId
            || edge.source === hoveredId || edge.target === hoveredId;
          const dim = anyFilter && (!isVisible(edge.source) || !isVisible(edge.target));
          // Trim the segment to the node borders so the arrowhead lands on the
          // target's edge instead of under its dot (it used to rely on a fixed
          // marker offset, which was wrong for every non-default radius).
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1;
          const ux = dx / d, uy = dy / d;
          const r1 = ((radiusById.get(edge.source) ?? 7) + 2) / k;
          const r2 = ((radiusById.get(edge.target) ?? 7) + 9) / k;
          if (d <= r1 + r2) return null;
          const x1 = a.x + ux * r1, y1 = a.y + uy * r1;
          const x2 = b.x - ux * r2, y2 = b.y - uy * r2;
          // Two notes that link to EACH OTHER produced two identical straight
          // lines stacked on top of one another — indistinguishable from a single
          // link, and its two arrowheads read as one ambiguous double-arrow. Bow
          // a reciprocal pair to the left of its own direction of travel, so each
          // direction gets its own visible arc.
          const twoWay = reciprocal.has(`${edge.source}|${edge.target}`);
          const path = twoWay
            ? `M${x1},${y1} Q${(x1 + x2) / 2 - uy * d * 0.11},${(y1 + y2) / 2 + ux * d * 0.11} ${x2},${y2}`
            : `M${x1},${y1} L${x2},${y2}`;
          return (
            <path
              key={`${edge.source}-${edge.target}-${i}`}
              d={path}
              fill="none"
              className={hot ? "stroke-primary/70" : "stroke-muted-foreground/35"}
              strokeWidth={(hot ? 1.75 : 1) / k}
              markerEnd={hot ? "url(#pf-arrow-hot)" : "url(#pf-arrow)"}
              opacity={dim ? 0.07 : 1}
            />
          );
        })}

        {/* Broken-link ghost targets — never part of the simulation. */}
        {showGhosts && brokenList.map((bl, i) => {
          const src = positions.get(bl.sourceId);
          const gp = ghostPoints.get(`ghost:${i}`);
          if (!src || !gp) return null;
          const gx = (gp.x - src.x) * k, gy = (gp.y - src.y) * k;
          const place = ghostLabels.get(`ghost:${i}`);
          return (
            <g
              key={`ghost-${bl.sourceId}-${i}`}
              className="pointer-events-none"
              transform={`translate(${src.x} ${src.y}) scale(${1 / k})`}
            >
              <line x1={0} y1={0} x2={gx} y2={gy} className="stroke-amber-500/60" strokeWidth={1} strokeDasharray="3 3" />
              <circle cx={gx} cy={gy} r={5} fill="none" className="stroke-amber-500/70" strokeWidth={1.5} strokeDasharray="2 2" />
              {place && (
                <text
                  x={gx + place.dx} y={gy + place.dy} textAnchor={place.anchor}
                  paintOrder="stroke" strokeWidth={3} strokeLinejoin="round"
                  className="pf-ghost-label stroke-background text-[9px] fill-amber-600"
                >
                  {place.text}
                </text>
              )}
            </g>
          );
        })}

        {graph.nodes.map((node) => {
          const p = positions.get(node.id);
          if (!p) return null;
          const isSelected = node.id === selectedId;
          const isActive = node.id === activeDocId;
          const isHover = node.id === hoveredId;
          const isOrphan = orphanSet.has(node.id);
          const isBrokenSrc = brokenHi && brokenSources.has(node.id);
          const dim = anyFilter && !isVisible(node.id);
          const radius = drawnRadius(node.id);
          const place = labelPlacements.get(node.id);
          return (
            <g
              key={node.id}
              data-doc-id={node.id}
              role="button"
              tabIndex={0}
              aria-label={`${node.title} — ${node.backlinks || 0} inbound, ${node.forwardLinks || 0} outbound links. Enter to open.`}
              onPointerDown={(e) => onNodeDown(e, node.id)}
              onMouseEnter={() => setHoveredId(node.id)}
              onMouseLeave={() => setHoveredId(null)}
              onFocus={() => setHoveredId(node.id)}
              onBlur={() => setHoveredId(null)}
              onDoubleClick={() => onNavigate(node.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); onNavigate(node.id); }
                else if (e.key === " ") { e.preventDefault(); userPickedRef.current = true; setSelectedId(node.id); revealRail(); }
              }}
              className="cursor-grab outline-none active:cursor-grabbing [&:focus-visible_.pf-node-dot]:stroke-primary [&:focus-visible_.pf-node-dot]:stroke-[3px]"
              opacity={dim ? 0.12 : 1}
              transform={`translate(${p.x} ${p.y}) scale(${1 / k})`}
            >
              <circle cx={0} cy={0} r={radius + 12} fill="transparent" />
              {(isSelected || isActive) && (
                <circle cx={0} cy={0} r={radius + 6} fill="none" className="stroke-primary/40" strokeWidth={1.5} />
              )}
              {isBrokenSrc && (
                <circle cx={0} cy={0} r={radius + 4} fill="none" className="stroke-amber-500" strokeWidth={1.5} strokeDasharray="2 2" />
              )}
              <circle
                cx={0} cy={0} r={radius}
                strokeDasharray={isOrphan && !isSelected && !isActive ? "2 2" : undefined}
                className={cn(
                  "pf-node-dot",
                  isActive ? "fill-primary stroke-background stroke-2"
                    : isSelected ? "fill-primary/80 stroke-primary stroke-2"
                    : isHover ? "fill-primary/60"
                    : isOrphan ? "fill-muted-foreground/15 stroke-muted-foreground/40"
                    : "fill-muted-foreground/30 hover:fill-muted-foreground/50"
                )}
              />
              {place && (
                <text
                  x={place.dx} y={place.dy}
                  textAnchor={place.anchor}
                  paintOrder="stroke"
                  strokeWidth={3.5}
                  strokeLinejoin="round"
                  className={`pf-node-label pointer-events-none stroke-background text-[11px] ${isSelected || isActive ? "fill-primary font-semibold" : "fill-muted-foreground"}`}
                >
                  {place.text}
                </text>
              )}
            </g>
          );
        })}

        {/* Folder chips LAST, so a cluster's NAME is never drawn under a node.
            Below about 40% zoom the dots converge into a band by design (that is
            density, not a defect) and no slot along a container's border is
            clear — measured on 12-, 25- and 40-note workspaces, the chip's own
            letters ended up behind a dot. Everything else on the map is placed
            so it cannot collide; the chip is the one glyph that sometimes has
            nowhere free to go, and it is also the landmark a zoomed-out map is
            read by, so it wins the pixel. `folderRects` still moves it to clear
            ground whenever clear ground exists. */}
        {rects.map((rect, fi) => {
          const hue = FOLDER_HUES[fi % FOLDER_HUES.length]!;
          // The rect resolved the drawn name (it may be trimmed to fit the box).
          const chipW = (rect.chip.x1 - rect.chip.x0) * k;
          const chipCy = (rect.chip.y0 + rect.chip.y1) / 2;
          return (
            <g key={`chip-${rect.id}`} className="pointer-events-none" data-folder-docs={rect.docIds.join(" ")}>
              {/* Straddles a border like a fieldset legend, and moves to a free
                  slot when two clusters would otherwise stack their names. */}
              <g transform={`translate(${rect.chip.x0} ${chipCy}) scale(${1 / k})`}>
                <rect
                  className="pf-folder-chip"
                  x={0} y={-FOLDER_CHIP_H / 2} width={chipW} height={FOLDER_CHIP_H} rx={FOLDER_CHIP_H / 2}
                  fill={`hsl(${hue} 65% 45%)`}
                />
                <text
                  x={chipW / 2} y={4}
                  textAnchor="middle" className="pf-chip-label text-[11px] font-semibold" fill="#ffffff"
                >
                  {rect.label}
                </text>
              </g>
            </g>
          );
        })}
      </g>
    </svg>
  );

  /** One slim docked strip under the canvas: legend on the left, camera on the
   *  right. This replaces three separate boxes that floated ON the map (a hint
   *  card, a zoom badge and a broken-targets button). */
  const mapFooter = (
    <div className="flex shrink-0 items-center gap-3 border-t border-border bg-card/60 px-3 py-1.5">
      <div className="hidden min-w-0 items-center gap-3 text-[10px] text-muted-foreground md:flex">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary" aria-hidden /> open note
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full border border-dashed border-muted-foreground/60" aria-hidden /> unlinked
        </span>
        {folders.length > 0 && (
          <span className="hidden items-center gap-1.5 lg:flex">
            <span className="h-2 w-3 rounded-sm border border-dashed border-muted-foreground/60" aria-hidden /> folder
          </span>
        )}
        <span className="hidden text-muted-foreground/70 xl:inline">
          Click to select · Double-click to open · Drag to rearrange
        </span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <Button variant="ghost" size="icon-sm" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1 / 1.3)}><ZoomOut /></Button>
        <span className="w-10 text-center font-mono text-[10px] tabular-nums text-muted-foreground" aria-live="off">{zoomPct}%</span>
        <Button variant="ghost" size="icon-sm" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1.3)}><ZoomIn /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Fit map to view" title="Fit to view" onClick={handleFit}><Maximize2 /></Button>
      </div>
    </div>
  );

  const hasMap = !!graph?.nodes?.length && graph.edges.length > 0;

  const mapPane = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={canvasRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
        {/* A faint dot grid pinned to the camera: without it, panning an
            unconnected corner of the map gives no motion cue at all. */}
        {hasMap && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 text-border opacity-70"
            style={{
              backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)",
              backgroundSize: `${28 * camRef.current.k}px ${28 * camRef.current.k}px`,
              backgroundPosition: `${camRef.current.tx}px ${camRef.current.ty}px`,
            }}
          />
        )}
        {emptyState ?? canvas}
      </div>
      {hasMap && mapFooter}
    </div>
  );

  // ── Details rail (DOCKED — see the component doc comment) ──────────────────
  const rail = (
    <aside
      className={cn(
        "flex shrink-0 flex-col overflow-hidden border-border bg-card",
        "max-h-[46%] border-t",
        "lg:max-h-none lg:w-[20rem] lg:border-l lg:border-t-0"
      )}
      aria-label="Map details"
    >
      {detail ? (
        <>
          <div className="shrink-0 border-b border-border/60 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold leading-tight text-foreground" title={detail.title}>
                  {detail.title}
                </h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {detailFolder && <RailTag>{detailFolder}</RailTag>}
                  {detail.id === activeDocId && <RailTag tone="primary">open in editor</RailTag>}
                  {orphanSet.has(detail.id) && <RailTag>unlinked</RailTag>}
                  {detailBroken.length > 0 && (
                    <RailTag tone="warn">{detailBroken.length} broken</RailTag>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setSelectedId(null); setIsolate(false); }}
                aria-label="Clear selection"
                title="Clear selection"
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>

            <div className="mt-2.5 grid grid-cols-3 gap-1.5">
              <StatCell value={inboundDocs.length} label="links in" />
              <StatCell value={outboundDocs.length} label="links out" />
              <StatCell value={allDetailHeadings.length} label="headings" />
            </div>

            <div className="mt-2.5 flex items-center gap-1.5">
              <Button size="sm" className="h-7 flex-1 text-[11px]" onClick={() => onNavigate(detail.id)}>Open note</Button>
              <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" title="Centre the map on this note" onClick={() => focusOnNode(detail.id)}>
                <Crosshair className="size-3.5" /> Focus
              </Button>
              <Button
                size="sm"
                variant={isolate ? "default" : "outline"}
                aria-pressed={isolate}
                className="h-7 px-2 text-[11px]"
                title="Show only this note and its direct links"
                onClick={() => { setSelectedId(detail.id); setIsolate((v) => !v); }}
              >
                Isolate
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2.5">
            <RailSection label="Contents" count={allDetailHeadings.length} empty="No headings in this note">
              {detailHeadings.map((h, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onOpenHeading?.(detail.id, h.index)}
                    disabled={!onOpenHeading}
                    title={onOpenHeading ? `Open "${h.text}"` : h.text}
                    style={{ paddingLeft: `${Math.max(0, h.level - 1) * 10 + 6}px` }}
                    className="block w-full truncate rounded py-1 pr-1 text-left text-xs text-foreground/80 enabled:hover:bg-accent enabled:hover:text-foreground disabled:cursor-default"
                  >
                    {h.text}
                  </button>
                </li>
              ))}
              {detailHeadingOverflow > 0 && (
                <li className="px-1.5 pt-0.5 text-[10px] text-muted-foreground">
                  +{detailHeadingOverflow} more — open the note to see all
                </li>
              )}
            </RailSection>

            <RailSection label="Links out" count={outboundDocs.length} empty="This note links to nothing yet">
              {outboundDocs.map((n) => (
                <li key={n.id}>
                  <NoteRow title={n.title} onSelect={() => pick(n.id)} onOpen={() => onNavigate(n.id)} />
                </li>
              ))}
            </RailSection>

            <RailSection label="Links in" count={inboundDocs.length} empty="Nothing links here yet">
              {inboundDocs.map((n) => (
                <li key={n.id}>
                  <NoteRow title={n.title} onSelect={() => pick(n.id)} onOpen={() => onNavigate(n.id)} />
                </li>
              ))}
            </RailSection>

            {detailBroken.length > 0 && (
              <RailSection label="Broken links" count={detailBroken.length} empty="">
                {detailBroken.map((b, i) => (
                  <li key={`${b.target}-${i}`} className="flex items-center gap-1.5 px-1.5 py-1 text-xs">
                    <AlertTriangle className="size-3 shrink-0 text-amber-500" />
                    <span className="truncate font-mono text-[11px] text-amber-600" title={b.target}>[[{b.target}]]</span>
                  </li>
                ))}
              </RailSection>
            )}
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          <div className="rounded-md border border-dashed border-border px-3 py-4 text-center">
            <Network className="mx-auto mb-1.5 size-5 text-muted-foreground/40" />
            <p className="text-xs font-medium text-foreground">Nothing selected</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              Click any note on the map to see its headings and both link directions.
            </p>
          </div>

          <div className="mt-3">
            <RailSection label="Most connected" count={mostConnected.length} empty="No links in the workspace yet">
              {mostConnected.map((n) => (
                <li key={n.id}>
                  <NoteRow
                    title={n.title}
                    meta={`${n.degree}`}
                    onSelect={() => pick(n.id)}
                    onOpen={() => onNavigate(n.id)}
                  />
                </li>
              ))}
            </RailSection>

            <RailSection label="Unlinked notes" count={orphanDocs.length} empty="Every note is connected">
              {orphanDocs.slice(0, LIST_CAP).map((n) => (
                <li key={n.id}>
                  <NoteRow title={n.title} onSelect={() => pick(n.id)} onOpen={() => onNavigate(n.id)} />
                </li>
              ))}
              {orphanDocs.length > LIST_CAP && (
                <li className="px-1.5 pt-0.5 text-[10px] text-muted-foreground">
                  +{orphanDocs.length - LIST_CAP} more
                </li>
              )}
            </RailSection>

            <RailSection label="Broken links" count={brokenCount} empty="No broken [[links]]">
              {brokenList.slice(0, LIST_CAP).map((b, i) => (
                <li key={`${b.sourceId}-${b.target}-${i}`}>
                  <button
                    type="button"
                    onClick={() => pick(b.sourceId)}
                    className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-accent"
                    title={`${titleById.get(b.sourceId) ?? b.sourceId} → [[${b.target}]] (missing)`}
                  >
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground/85">
                      {titleById.get(b.sourceId) ?? "Untitled"}
                    </span>
                    <ArrowRight className="size-3 shrink-0 text-muted-foreground/60" />
                    <span className="max-w-[7rem] shrink-0 truncate font-mono text-[10px] text-amber-600">{b.target}</span>
                  </button>
                </li>
              ))}
              {brokenCount > LIST_CAP && (
                <li className="px-1.5 pt-0.5 text-[10px] text-muted-foreground">
                  +{brokenCount - LIST_CAP} more
                </li>
              )}
            </RailSection>
          </div>
        </div>
      )}
    </aside>
  );

  return (
    <div ref={rootRef} className="flex h-full flex-col overflow-hidden bg-background">
      {header}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {mapPane}
        {railOpen && hasMap && rail}
      </div>

      {/* Keyboard/SR fallback for opening documents. */}
      <ul className="sr-only">
        {graph.nodes.map((node) => (
          <li key={node.id}>
            <button type="button" onClick={() => onNavigate(node.id)}>
              Open {node.title} ({node.backlinks || 0} inbound, {node.forwardLinks || 0} outbound links)
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HealthChip({
  icon, count, active, onClick, label, title, warn,
}: {
  icon: React.ReactNode;
  count: number;
  active: boolean;
  onClick: () => void;
  label: string;
  title: string;
  warn?: boolean;
}) {
  const disabled = count === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={`${count} ${label}`}
      title={disabled ? `No ${label}` : title}
      className={cn(
        "flex h-8 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors",
        disabled
          ? "cursor-default border-transparent text-muted-foreground/40"
          : active
            ? warn
              ? "border-amber-500/50 bg-amber-500/15 text-amber-600"
              : "border-primary/50 bg-primary/15 text-primary-strong"
            : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {icon}
      <span className="font-mono">{count}</span>
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

/** One titled block in the rail: a label, a count, an optional action, and
 *  either rows or a one-line explanation of why it is empty. Empty sections
 *  still render — "no headings" and "nothing links here" are answers, not
 *  absences. A section with no rows AND no explanation is dropped. */
function RailSection({ label, count, empty, action, children }: {
  label: string;
  count: number;
  empty: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (count === 0 && !empty) return null;
  return (
    <section className="mb-3.5 last:mb-0">
      <h4 className="mb-1 flex items-center gap-1.5 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
        <span className="rounded bg-foreground/10 px-1 font-mono text-[10px] text-foreground/70">{count}</span>
        {action && <span className="ml-auto">{action}</span>}
      </h4>
      {count === 0 ? (
        <p className="px-1.5 text-[11px] italic text-muted-foreground/80">{empty}</p>
      ) : (
        <ul className="space-y-px">{children}</ul>
      )}
    </section>
  );
}

function RailTag({ children, tone }: { children: React.ReactNode; tone?: "primary" | "warn" }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium",
        tone === "primary" ? "bg-primary/15 text-primary-strong"
          : tone === "warn" ? "bg-amber-500/15 text-amber-600"
          : "bg-foreground/10 text-foreground/70"
      )}
    >
      {children}
    </span>
  );
}

/** A number the eye can find. The rail used to bury these counts in a run-on
 *  "3 in · 2 out · 5 headings" line of 10px text. */
function StatCell({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-background/60 px-1.5 py-1 text-center">
      <div className="font-mono text-sm leading-none text-foreground">{value}</div>
      <div className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

/** A note row: the row selects it in the map (you keep your place), the arrow
 *  opens it in the editor. */
function NoteRow({ title, meta, onSelect, onOpen }: {
  title: string;
  meta?: string;
  onSelect: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="group/link flex items-center gap-1 rounded hover:bg-accent">
      <button
        type="button"
        onClick={onSelect}
        title={`Show "${title}" in the map`}
        className="min-w-0 flex-1 truncate px-1.5 py-1 text-left text-xs text-foreground/85 group-hover/link:text-foreground"
      >
        {title}
      </button>
      {meta && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70" aria-hidden>{meta}</span>
      )}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${title}`}
        title={`Open "${title}"`}
        className="mr-1 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground group-hover/link:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
      >
        <ArrowRight className="size-3" />
      </button>
    </div>
  );
}


export const GraphView = React.memo(RawGraphView);
