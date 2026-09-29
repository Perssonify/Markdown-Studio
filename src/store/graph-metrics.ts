/**
 * graph-metrics.ts — pure, render-less helpers for the knowledge-graph overlay
 * (src/ui/GraphView.tsx). Kept free of React/DOM so the graph's logic layer is
 * unit-testable (the SVG/physics layer has no tests). All functions are O(n) or
 * O(edges) and allocate only their result Set/array.
 */

export interface MetricNode {
  id: string;
  title: string;
  backlinks?: number;
  forwardLinks?: number;
}

export interface MetricEdge {
  source: string;
  target: string;
}

export interface BrokenLink {
  sourceId: string;
  target: string;
  displayText: string;
}

/**
 * Orphans — documents with no inbound AND no outbound links (undefined counts
 * treated as 0). `exportGraph` already emits every document as a node, so these
 * are the isolated nodes already present in the graph; this just identifies them.
 */
export function findOrphans(nodes: MetricNode[]): Set<string> {
  const out = new Set<string>();
  for (const n of nodes) {
    if ((n.backlinks ?? 0) === 0 && (n.forwardLinks ?? 0) === 0) out.add(n.id);
  }
  return out;
}

/**
 * Case-insensitive substring match over title (id as fallback). A blank /
 * whitespace-only query returns an EMPTY set — callers treat "filter active" as
 * `query.trim().length > 0`, so a zero-match query still dims everything (a
 * useful "no results" signal) rather than reverting to "no filter".
 */
export function matchNodes(nodes: MetricNode[], query: string): Set<string> {
  const q = query.trim().toLowerCase();
  const out = new Set<string>();
  if (!q) return out;
  for (const n of nodes) {
    if (n.title.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) out.add(n.id);
  }
  return out;
}

/**
 * Ids adjacent to `id` in EITHER direction (excludes `id` itself, deduped).
 */
export function neighborIds(edges: MetricEdge[], id: string): Set<string> {
  const out = new Set<string>();
  for (const e of edges) {
    if (e.source === id && e.target !== id) out.add(e.target);
    else if (e.target === id && e.source !== id) out.add(e.source);
  }
  return out;
}

/**
 * Flatten `linkIndex.unresolved` (Map<docId, {target, displayText}[]>) into a
 * stable, deterministically-ordered list of broken links.
 */
export function brokenLinks(
  unresolved: Map<string, { target: string; displayText: string }[]> | undefined | null
): BrokenLink[] {
  if (!unresolved) return [];
  const out: BrokenLink[] = [];
  for (const sourceId of [...unresolved.keys()].sort()) {
    for (const u of unresolved.get(sourceId) ?? []) {
      out.push({ sourceId, target: u.target, displayText: u.displayText });
    }
  }
  return out;
}

/**
 * Source document ids that have at least one unresolved (broken) link — used to
 * highlight the notes that point at something missing.
 */
export function brokenSourceIds(
  unresolved: Map<string, { target: string; displayText: string }[]> | undefined | null
): Set<string> {
  const out = new Set<string>();
  if (!unresolved) return out;
  for (const [sourceId, list] of unresolved) {
    if (list && list.length > 0) out.add(sourceId);
  }
  return out;
}

export interface RankedNode {
  id: string;
  title: string;
  degree: number;
}

/**
 * Documents ranked by total link degree (inbound + outbound), highest first,
 * ties broken by title so the order is stable across renders. Zero-degree
 * documents are excluded — they are orphans, reported by `findOrphans`, and a
 * "most connected" list padded with unconnected notes says nothing.
 *
 * Feeds the relationship map's workspace overview (the rail's "Most connected"
 * list) and the map's label budget: when zoomed out, only the most connected
 * nodes keep a visible label so the canvas doesn't turn into overlapping text.
 */
export function rankByDegree(nodes: MetricNode[], limit = 5): RankedNode[] {
  const ranked: RankedNode[] = [];
  for (const n of nodes) {
    const degree = (n.backlinks ?? 0) + (n.forwardLinks ?? 0);
    if (degree > 0) ranked.push({ id: n.id, title: n.title, degree });
  }
  ranked.sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title));
  return limit >= 0 ? ranked.slice(0, limit) : ranked;
}

export interface LabelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// ── Text metrics ─────────────────────────────────────────────────────────────
// The map draws every label at ONE screen size (glyphs are counter-scaled), so
// a label's footprint is a constant number of pixels. Everything that has to
// reserve room for text — the label placer, the folder containers, and the
// layout forces — measures through these, so no two consumers can disagree
// about how much space a name needs.
// Measured in a browser against the map's own 11px labels: the widest real
// character average was 5.67px INCLUDING the paint-order halo, and selected
// labels render semibold. 6.0 keeps a margin so the estimate never claims a fit
// that the rendered text does not actually have.
export const LABEL_CHAR_W = 6;
export const LABEL_PAD_X = 6;
/** Drawn label height, and the gap between a node's edge and its label. */
export const LABEL_H = 15;
export const LABEL_GAP = 4;
/** Titles are capped so one long name cannot dominate the canvas. */
export const LABEL_MAX_CHARS = 24;

export function truncateLabel(title: string): string {
  return title.length > LABEL_MAX_CHARS ? title.slice(0, LABEL_MAX_CHARS - 2) + "…" : title;
}

/** Width in SCREEN pixels of a label as drawn. */
export function labelWidth(text: string): number {
  return text.length * LABEL_CHAR_W + LABEL_PAD_X;
}

const overlaps = (a: LabelBox, b: LabelBox) =>
  a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

const inside = (outer: LabelBox, inner: LabelBox) =>
  inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1;

// ── Spatial index ────────────────────────────────────────────────────────────

/** Cells a single box may occupy before it is kept on a plain list instead. */
const GRID_MAX_CELLS = 1024;
/** Cell coordinates are packed into one number; beyond this a box is "oversize". */
const GRID_RANGE = 1 << 20;

/**
 * A uniform grid over boxes, for "does anything overlap this box?" in time
 * proportional to what is NEAR it. The label placer and the chip scorer used to
 * answer that by scanning every box on the map for every candidate position —
 * every dot, chip and placed label, several candidates per note — which at
 * 2,000 notes was millions of comparisons per rendered frame.
 *
 * It answers EXACTLY what the scan answered: two boxes that overlap share at
 * least one cell (a point inside both lies in a cell each of them covers), so
 * nothing that overlaps can be missed, and everything found is re-tested with
 * the same strict `overlaps`. Boxes are returned in insertion order, so a sum
 * over them adds the same terms in the same order the scan did.
 */
export class BoxGrid {
  readonly boxes: LabelBox[] = [];
  private readonly cells = new Map<number, number[]>();
  private readonly oversize: number[] = [];
  private stamp: Int32Array = new Int32Array(64);
  private query = 0;

  constructor(private readonly cell: number) {}

  /** Cell range a box covers — or null for one that cannot be indexed (too
   *  large, not finite, inverted), which is then checked on every query, so the
   *  answer stays the scan's answer for ANY input. */
  private span(b: LabelBox) {
    const gx0 = Math.floor(b.x0 / this.cell), gx1 = Math.floor(b.x1 / this.cell);
    const gy0 = Math.floor(b.y0 / this.cell), gy1 = Math.floor(b.y1 / this.cell);
    if (!(gx1 >= gx0 && gy1 >= gy0)) return null;
    if ((gx1 - gx0 + 1) * (gy1 - gy0 + 1) > GRID_MAX_CELLS
      || gx0 <= -GRID_RANGE || gy0 <= -GRID_RANGE || gx1 >= GRID_RANGE || gy1 >= GRID_RANGE) return null;
    return { gx0, gx1, gy0, gy1 };
  }

  add(b: LabelBox) {
    const index = this.boxes.length;
    this.boxes.push(b);
    const s = this.span(b);
    if (s === null) { this.oversize.push(index); return; }
    for (let gx = s.gx0; gx <= s.gx1; gx++) {
      for (let gy = s.gy0; gy <= s.gy1; gy++) {
        const key = gx * 2 * GRID_RANGE + gy;
        const list = this.cells.get(key);
        if (list) list.push(index); else this.cells.set(key, [index]);
      }
    }
  }

  /** True when any stored box overlaps `b` — the scan's `boxes.some(overlaps)`.
   *  A yes/no does not care about order, so this walks the cells and stops at
   *  the first hit. */
  hits(b: LabelBox): boolean {
    const s = this.span(b);
    // A query box too big (or too strange) to walk cell by cell: the scan.
    if (s === null) return this.boxes.some((o) => overlaps(b, o));
    for (const i of this.oversize) if (overlaps(b, this.boxes[i]!)) return true;
    for (let gx = s.gx0; gx <= s.gx1; gx++) {
      for (let gy = s.gy0; gy <= s.gy1; gy++) {
        const list = this.cells.get(gx * 2 * GRID_RANGE + gy);
        if (!list) continue;
        for (const i of list) if (overlaps(b, this.boxes[i]!)) return true;
      }
    }
    return false;
  }

  /**
   * Σ f(box) over every stored box, in insertion order — for an `f` that is
   * exactly 0 on a box that does not overlap `b` (the chip scorer's overlap
   * AREA). Such boxes are skipped; adding +0 never changes a sum, so the
   * result is bit-for-bit the scan's. Boxes kept off the grid are always
   * included, so even a NaN box poisons the sum exactly as the scan would.
   */
  sum(b: LabelBox, f: (o: LabelBox) => number): number {
    const s = this.span(b);
    if (s === null) {
      let total = 0;
      for (const o of this.boxes) total += f(o);
      return total;
    }
    if (this.stamp.length < this.boxes.length) this.stamp = new Int32Array(this.boxes.length * 2);
    const q = ++this.query;
    const found: number[] = [...this.oversize];
    for (let gx = s.gx0; gx <= s.gx1; gx++) {
      for (let gy = s.gy0; gy <= s.gy1; gy++) {
        const list = this.cells.get(gx * 2 * GRID_RANGE + gy);
        if (!list) continue;
        for (const i of list) {
          if (this.stamp[i] === q) continue;
          this.stamp[i] = q;
          if (overlaps(b, this.boxes[i]!)) found.push(i);
        }
      }
    }
    found.sort((x, y) => x - y);
    let total = 0;
    for (const i of found) total += f(this.boxes[i]!);
    return total;
  }
}

// ── Label placement ──────────────────────────────────────────────────────────

/** Where a label ended up, as an offset from its anchor point in SCREEN pixels
 *  (the map draws labels inside a counter-scaled group, so these are the local
 *  coordinates it needs). `y` is the text baseline. */
export interface LabelPlacement {
  dx: number;
  dy: number;
  anchor: "middle" | "start" | "end";
  /** The string to draw — the compact form when the full name did not fit. */
  text: string;
}

/** Screen-pixel cell of the placer's index — about a label's height, a third
 *  of a typical label's width. Any size gives the same answer; this one keeps
 *  both the cells a box spans and the boxes per cell small. */
const LABEL_GRID_CELL = 40;

/** Last-resort compact form of a label, for views too dense for the full name.
 *  A shortened name still orients the reader; a dropped one leaves an anonymous
 *  dot. The full title is always available on hover and in the details rail. */
export const LABEL_SHORT_CHARS = 10;
export function shortLabel(text: string): string {
  return text.length > LABEL_SHORT_CHARS + 2 ? text.slice(0, LABEL_SHORT_CHARS) + "…" : text;
}

export interface PlaceLabelsOptions {
  /** Ids in priority order — the first id that claims a spot keeps it. */
  order: string[];
  /** Ids tried before all others (selection / active / hover). They are NOT
   *  allowed to overlap: they simply get first pick of the free space. */
  forced?: Set<string>;
  positions: Map<string, { x: number; y: number }>;
  /** Node radius in SCREEN pixels (the map draws glyphs at a constant size). */
  radius: (id: string) => number;
  /** The exact string that will be drawn — the measurement must match it. */
  label: (id: string) => string;
  cam: { k: number; tx: number; ty: number };
  /** Already-occupied screen boxes: node dots, folder chips, ghost stubs. */
  obstacles?: LabelBox[];
  /** Labels must fit entirely inside this screen box (the canvas). */
  bounds?: LabelBox;
  /** Per-id veto on a candidate box. The map uses it to keep a note's name from
   *  lying across a folder container it has nothing to do with — a rule that
   *  cannot be expressed as a shared obstacle, since a note's own container must
   *  not block its own label. */
  reject?: (id: string, box: LabelBox) => boolean;
  /** Stop after considering this many ids (a huge map needs no more). */
  limit?: number;
}

/**
 * Where each node label can be drawn without touching anything else, resolved
 * greedily in SCREEN space (highest priority first).
 *
 * The map used to gate labels on a zoom threshold — every label above 0.7×,
 * landmarks only below — which either buried a dense graph in overlapping text
 * or anonymised it into unnamed dots. Placing them by actual collision means
 * zooming out thins labels out on its own and zooming in brings them all back,
 * at whatever density the pixels can actually carry.
 *
 * Each label gets FOUR candidate positions (below, above, right, left) before
 * it is given up on: a single fixed position under the dot meant one crowded
 * neighbour silently cost a note its name, when there was room an inch away.
 * Nothing is ever drawn over a dot, a chip or another label — a dropped label
 * is the only sanctioned outcome, and the note is still named in the rail.
 *
 * Pure and camera-relative, so it is unit-testable and must be recomputed on
 * every frame the positions or camera change (do NOT memoize it on the camera
 * alone — node positions live in a mutable ref and would go stale).
 */
export function placeLabels(opts: PlaceLabelsOptions): Map<string, LabelPlacement> {
  const { order, forced, positions, radius, label, cam, obstacles = [], bounds, reject, limit } = opts;
  // Everything already on the canvas, indexed: a candidate is tested against
  // what is near it, not against every dot on the map (see BoxGrid).
  const boxes = new BoxGrid(LABEL_GRID_CELL);
  for (const o of obstacles) boxes.add(o);
  const out = new Map<string, LabelPlacement>();
  const forcedSet = forced ?? new Set<string>();
  const max = limit == null ? order.length : Math.min(order.length, limit + forcedSet.size);

  for (let i = 0; i < max; i++) {
    const id = order[i]!;
    const p = positions.get(id);
    if (!p) continue;
    const text = label(id);
    if (!text) continue;
    const r = radius(id);
    const sx = p.x * cam.k + cam.tx;
    const sy = p.y * cam.k + cam.ty;
    const half = LABEL_H / 2;
    // Four positions for the full name, then the same four for a compact form:
    // a single fixed position under the dot meant one crowded neighbour silently
    // cost a note its name when there was room an inch away, and a dense view
    // (a phone) went almost entirely anonymous.
    const forms = [text, shortLabel(text)];
    let done = false;
    for (const form of forms) {
      const w = labelWidth(form);
      const candidates: { box: LabelBox; place: LabelPlacement }[] = [
        {
          box: { x0: sx - w / 2, y0: sy + r + LABEL_GAP, x1: sx + w / 2, y1: sy + r + LABEL_GAP + LABEL_H },
          place: { dx: 0, dy: r + LABEL_GAP + LABEL_H - 4, anchor: "middle", text: form },
        },
        {
          box: { x0: sx - w / 2, y0: sy - r - LABEL_GAP - LABEL_H, x1: sx + w / 2, y1: sy - r - LABEL_GAP },
          place: { dx: 0, dy: -r - LABEL_GAP - 4, anchor: "middle", text: form },
        },
        {
          box: { x0: sx + r + LABEL_GAP, y0: sy - half, x1: sx + r + LABEL_GAP + w, y1: sy + half },
          place: { dx: r + LABEL_GAP, dy: 4, anchor: "start", text: form },
        },
        {
          box: { x0: sx - r - LABEL_GAP - w, y0: sy - half, x1: sx - r - LABEL_GAP, y1: sy + half },
          place: { dx: -r - LABEL_GAP, dy: 4, anchor: "end", text: form },
        },
      ];
      for (const c of candidates) {
        if (bounds && !inside(bounds, c.box)) continue;
        if (boxes.hits(c.box)) continue;
        if (reject?.(id, c.box)) continue;
        boxes.add(c.box);
        out.set(id, c.place);
        done = true;
        break;
      }
      if (done || form === forms[1]) break;
    }
  }
  return out;
}

/** The screen box a placed label occupies — used to reserve the space a label
 *  has already claimed when a later pass (node labels after ghost labels) has to
 *  avoid it. Mirrors the candidate geometry in `placeLabels`. */
export function labelBoxAt(sx: number, sy: number, place: LabelPlacement): LabelBox {
  const w = labelWidth(place.text);
  const x0 = place.anchor === "middle" ? sx + place.dx - w / 2
    : place.anchor === "start" ? sx + place.dx
    : sx + place.dx - w;
  const y0 = sy + place.dy - (LABEL_H - 4);
  return { x0, y0, x1: x0 + w, y1: y0 + LABEL_H };
}

// ── Folder containers ────────────────────────────────────────────────────────

export interface FolderInput {
  id: string;
  name: string;
  docIds: string[];
}

/** A folder's drawn container and its legend chip, in WORLD coordinates. */
export interface FolderRect extends LabelBox {
  id: string;
  name: string;
  label: string;
  docIds: string[];
  /** Chip box, straddling the border it is anchored to (fieldset-legend style). */
  chip: LabelBox;
}

export interface FolderRectsOptions {
  folders: FolderInput[];
  positions: Map<string, { x: number; y: number }>;
  /** Node radius in SCREEN pixels. */
  radius: (id: string) => number;
  /** Node label text, so a container can enclose its members' names. */
  label: (id: string) => string;
  /** Camera scale; screen-sized padding is divided by it. */
  k: number;
  /** WORLD boxes a chip must not land on — the node dots. A chip straddles its
   *  container's border, which is legal ground for a node just outside it, so
   *  without this a cluster's name gets stamped over someone else's note. */
  avoid?: LabelBox[];
}

export const FOLDER_CHIP_H = 20;
export const FOLDER_CHIP_INSET = 12;
export const FOLDER_NAME_MAX = 22;
/** Screen-pixel breathing room between the members' own footprints and the box. */
export const FOLDER_PAD = 14;

/** Folder name as drawn on its chip, trimmed to `maxChars` (default: the global
 *  cap). A pixel budget lets a small container keep a proportionate tab instead
 *  of a name-plate several times its own width. */
export function folderChipLabel(name: string, maxChars = FOLDER_NAME_MAX): string {
  const cap = Math.max(4, Math.min(FOLDER_NAME_MAX, Math.floor(maxChars)));
  return name.length > cap ? name.slice(0, cap - 1) + "…" : name;
}

export function folderChipWidth(name: string, maxChars = FOLDER_NAME_MAX): number {
  return Math.max(34, folderChipLabel(name, maxChars).length * 7 + 20);
}

/**
 * The container box and legend chip for each folder that has positioned members.
 *
 * ONE definition, shared by the renderer, the label placer and the layout
 * forces. They used to compute their own approximations of the same rectangle,
 * so the box the user saw, the box labels avoided and the box clusters pushed
 * each other out of were three subtly different rectangles.
 *
 * The box encloses each member's DOT AND ITS LABEL (worst case: the label
 * placer may put a name on any side of its dot), so a container never clips the
 * names of the notes it contains. Chips are placed corner by corner and fall
 * back along the border when two clusters would otherwise stack their names.
 */
export function folderRects(opts: FolderRectsOptions): FolderRect[] {
  const { avoid = [] } = opts;
  const out: FolderRect[] = [];
  const chips: LabelBox[] = [];
  // The dots a chip steers around, indexed once: every candidate slot of every
  // folder used to be scored against every dot on the map (see BoxGrid — the
  // sum is the same terms in the same order, so the chosen slot is identical).
  let avoidIndex: BoxGrid | null = null;
  if (avoid.length > 32) {
    avoidIndex = new BoxGrid(32 / opts.k);
    for (const o of avoid) avoidIndex.add(o);
  }
  const area = (c: LabelBox, o: LabelBox) =>
    Math.max(0, Math.min(c.x1, o.x1) - Math.max(c.x0, o.x0))
    * Math.max(0, Math.min(c.y1, o.y1) - Math.max(c.y0, o.y0));

  for (const box of containerGeometry(opts)) {
    const { chipW, chipH, inset, x0, x1, y0, y1 } = box;
    // The chip slides along the top border, then the bottom, looking for clear
    // ground. Four corners were not enough: zoomed out, a screen-constant chip
    // covers a lot of world, and when every corner was taken it fell back to the
    // first one and stamped the folder's name over someone's note.
    const slot = (sx: number, sy: number): LabelBox =>
      ({ x0: sx, y0: sy - chipH / 2, x1: sx + chipW, y1: sy + chipH / 2 });
    const left = x0 + inset, right = x1 - inset - chipW;
    const candidates: LabelBox[] = [];
    // Rows in preference order: straddling the top border, straddling the
    // bottom, then just OUTSIDE each. Measured zoomed out on a 25- and 40-note
    // workspace, the two straddling rows alone ran out of clear ground and the
    // least-overlap fallback dropped a chip on a note's dot. The gap between two
    // containers is normally empty, so stepping the chip clear of its own box is
    // a better answer than covering someone's note with it.
    const rows = [y0, y1, y0 - chipH, y1 + chipH];
    // Denser sampling for the same reason: five stops along a border is not many
    // once a screen-constant chip covers a lot of world.
    const stops = [0, 1, 0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875];
    for (const y of rows) {
      for (const t of stops) {
        candidates.push(slot(left + (right - left) * t, y));
      }
    }
    let chip = candidates[0]!;
    let best = Infinity;
    for (const c of candidates) {
      // A chip must never sit on another chip; a dot it can only be nudged off.
      if (chips.some((o) => overlaps(c, o))) continue;
      let score = 0;
      if (avoidIndex) score = avoidIndex.sum(c, (o) => area(c, o));
      else for (const o of avoid) score += area(c, o);
      if (score < best) { best = score; chip = c; }
      if (score === 0) break;
    }
    chips.push(chip);

    out.push({ id: box.id, name: box.name, label: box.label, docIds: box.docIds, x0, y0, x1, y1, chip });
  }
  return out;
}

/** A folder's container without its chip: what the LAYOUT keeps apart. The
 *  same rectangle `folderRects` draws (it is computed by the same function);
 *  the physics simply has no use for where the name tab lands, and searching
 *  for a clear slot for it three times a step was pure waste. */
export type FolderBounds = Omit<FolderRect, "chip">;

export function folderBounds(opts: Omit<FolderRectsOptions, "avoid">): FolderBounds[] {
  return containerGeometry(opts).map(({ id, name, label, docIds, x0, y0, x1, y1 }) =>
    ({ id, name, label, docIds, x0, y0, x1, y1 }));
}

/** THE container geometry — see `folderRects`. */
function containerGeometry(opts: Omit<FolderRectsOptions, "avoid">) {
  const { folders, positions, radius, label, k } = opts;
  const out: (FolderBounds & { chipW: number; chipH: number; inset: number })[] = [];
  // Container geometry is world-STABLE below 1×. Sizing it purely in screen
  // pixels (`/k`) meant zooming out inflated every box in world terms — at 0.3×
  // a container claimed three times the ground it was solved for, so boxes that
  // the layout had cleanly separated grew over each other and over their
  // neighbours' notes. Above 1× the boxes keep shrinking to a constant screen
  // padding, which is where that behaviour is actually wanted.
  const gs = 1 / Math.max(k, 1);

  for (const folder of folders) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let any = false;
    for (const id of folder.docIds) {
      const p = positions.get(id);
      if (!p) continue;
      any = true;
      const r = radius(id);
      // Horizontal: the dot, or half a label — whichever reaches further.
      const hw = Math.max(r, labelWidth(label(id)) / 2) * gs;
      // Vertical: room for a label above OR below the dot.
      const vh = (r + LABEL_GAP + LABEL_H) * gs;
      if (p.x - hw < x0) x0 = p.x - hw;
      if (p.x + hw > x1) x1 = p.x + hw;
      if (p.y - vh < y0) y0 = p.y - vh;
      if (p.y + vh > y1) y1 = p.y + vh;
    }
    if (!any) continue;

    const pad = FOLDER_PAD * gs;
    x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;

    const name = folder.name;
    // Keep the tab within a sane multiple of the container it belongs to: zoomed
    // out, a screen-constant chip on a one-note folder came out several times
    // wider than its own box, which reads as a broken layout rather than a label.
    const budget = Math.max(46, (x1 - x0) * k * 1.9);
    const maxChars = Math.floor((budget - 20) / 7);
    const labelText = folderChipLabel(name, maxChars);
    // The chip itself stays screen-constant at every zoom — folder names are the
    // landmarks that a zoomed-out map is read by, and shrinking them with the
    // geometry would make them illegible exactly on a phone. Its box is measured
    // at the drawn size so chips still never collide; the container is widened
    // only by the world-stable amount, so a tiny folder's name tab may overhang
    // its own box when zoomed out (a legend tab, not a containment claim).
    const chipW = folderChipWidth(name, maxChars) / k;
    const chipH = FOLDER_CHIP_H / k;
    const inset = FOLDER_CHIP_INSET * gs;
    const shortfall = folderChipWidth(name, maxChars) * gs + 2 * inset - (x1 - x0);
    if (shortfall > 0) { x0 -= shortfall / 2; x1 += shortfall / 2; }

    out.push({ id: folder.id, name, label: labelText, docIds: folder.docIds, x0, y0, x1, y1, chipW, chipH, inset });
  }
  return out;
}

// ── Simulation pacing ────────────────────────────────────────────────────────

/** How many simulation steps to advance per RENDERED frame.
 *
 *  The two halves of a frame cost wildly different amounts. A CPU profile of a
 *  153-note workspace settling never surfaced the physics at all — not
 *  `stepOnce`, not `placeLabels` (benchmarked at ~1ms) — while the frame itself
 *  measured a 44ms median, almost all of it style and layout for the SVG the
 *  render rewrites. Stepping once per frame therefore paid the expensive half
 *  ~110 times to do work the cheap half could have finished in a fraction of the
 *  wall-clock.
 *
 *  Above a threshold the layout advances several steps per rendered frame: the
 *  same number of steps, the same resting layout, a third of the frames. Small
 *  workspaces stay at 1 — there the frame is cheap and a step-per-frame is the
 *  smoothest way to watch the map unfold. */
export function stepsPerFrame(n: number) {
  return n <= 60 ? 1 : Math.min(6, Math.ceil(n / 60));
}

/** Above this many notes the map is drawn and paced for SCALE (GraphView):
 *  ordinary dots, links and arrowheads become a few batched paths, the layout
 *  is stepped against a clock, and the moving layout is painted a few times a
 *  second rather than every step. Measured at 2,000 notes under 4× CPU
 *  throttling, one SVG element per note and per link was ~10,000 elements
 *  restyled on every frame and on every step of a zoom — over four seconds a
 *  frame, and a wheel zoom that took more than a second to answer. At or below
 *  it nothing changes: every note is its own element and every step is painted,
 *  so a small workspace looks and behaves exactly as it always has. */
export const LARGE_MAP_MIN = 250;

export function isLargeMap(n: number) {
  return n > LARGE_MAP_MIN;
}

/** A large map's physics budget per animation frame (at least one step runs). */
export const SLICE_MS = 12;
/** A large map paints its moving layout at most this often. */
export const PAINT_EVERY_MS = 250;
/** A large map holds its layout still this long after the user moves the camera
 *  (wheel, pan, zoom buttons) or the pointer over the map, so the interaction
 *  gets the main thread rather than queueing behind layout steps — and a pan or
 *  a hover over an unchanged layout rebuilds nothing. The held steps are
 *  deferred, not skipped: the layout resumes where it was and rests where it
 *  would have. */
export const CAMERA_HOLD_MS = 300;

/**
 * What one animation frame of the layout loop does. A small map always steps
 * (and paints every frame, as it always has). A large map does exactly ONE of:
 * wait while the user is moving the camera or pointing; paint the moving
 * layout, if one is due; or step it. Never a step and a paint in the same
 * frame: measured at 2,000 notes under 4× CPU throttling, a frame carrying both
 * ran 300-440ms where either alone stayed under 200ms.
 */
export function planFrame(o: { large: boolean; running: boolean; now: number; holdUntil: number; lastPaint: number }): "hold" | "paint" | "step" {
  if (!o.large || !o.running) return "step";
  if (o.now < o.holdUntil) return "hold";
  if (o.now - o.lastPaint >= PAINT_EVERY_MS) return "paint";
  return "step";
}
