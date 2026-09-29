/**
 * editorStore — Zustand store for active editor state.
 *
 * Covers: active formatting state, link index, backlinks.
 * The formatting state (activeFormats) is set by useFormatDispatcher
 * and read by the Toolbar. The link data is set by useLinkIndex.
 */

import { create } from "zustand";
import type { LinkIndex, GraphNode, GraphEdge } from "./link-index";

export interface ActiveFormats {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  blockquote?: boolean;
  bulletList?: boolean;
  orderedList?: boolean;
  taskList?: boolean;
  heading?: number | false;
  fontFamily?: string;
  fontSize?: string;
  color?: string;
  highlight?: string;
  subscript?: boolean;
  superscript?: boolean;
  link?: boolean;
  alignLeft?: boolean;
  alignCenter?: boolean;
  alignRight?: boolean;
  alignJustify?: boolean;
  table?: boolean;
  [key: string]: boolean | number | string | undefined;
}

export interface BacklinkEntry {
  docId: string;
  title: string;
  context: string;
}

export interface ForwardLinkEntry {
  docId: string;
  title: string;
}

export interface UnresolvedEntry {
  target: string;
  displayText: string;
}

interface EditorState {
  activeFormats: ActiveFormats;
  linkIndex: LinkIndex;
  activeBacklinks: BacklinkEntry[];
  activeForwardLinks: ForwardLinkEntry[];
  activeUnresolved: UnresolvedEntry[];
  graphData: { nodes: GraphNode[]; edges: GraphEdge[] } | null;

  setActiveFormats: (formats: ActiveFormats) => void;
  setLinkIndex: (index: LinkIndex) => void;
  setActiveBacklinks: (links: BacklinkEntry[]) => void;
  setActiveForwardLinks: (links: ForwardLinkEntry[]) => void;
  setActiveUnresolved: (links: UnresolvedEntry[]) => void;
  setGraphData: (data: { nodes: GraphNode[]; edges: GraphEdge[] } | null) => void;
}

/**
 * Shallow value equality for two format snapshots.
 *
 * `queryState()` in useFormatDispatcher allocates a fresh object on every keyup
 * and every selectionchange, so an unconditional `set` handed every subscriber
 * (notably the 28-button Toolbar) a new reference per frame while typing even
 * though nothing about the formatting had changed. Compare by value and keep the
 * previous reference when it matches, so `useShallow`/memo consumers can bail.
 */
function sameFormats(a: ActiveFormats, b: ActiveFormats): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    // `in` first: an explicit `undefined` in one and a missing key in the other
    // compare equal by value, and the key counts alone cannot tell them apart.
    if (!(k in b) || a[k] !== b[k]) return false;
  }
  return true;
}

export const useEditorStore = create<EditorState>((set) => ({
  activeFormats: {},
  linkIndex: {
    forward: new Map(),
    reverse: new Map(),
    unresolved: new Map(),
    contexts: new Map(),
  },
  activeBacklinks: [],
  activeForwardLinks: [],
  activeUnresolved: [],
  graphData: null,

  setActiveFormats: (formats) =>
    set((state) =>
      sameFormats(state.activeFormats, formats) ? state : { activeFormats: formats },
    ),
  setLinkIndex: (index) => set({ linkIndex: index }),
  setActiveBacklinks: (links) => set({ activeBacklinks: links }),
  setActiveForwardLinks: (links) => set({ activeForwardLinks: links }),
  setActiveUnresolved: (links) => set({ activeUnresolved: links }),
  setGraphData: (data) => set({ graphData: data }),
}));
