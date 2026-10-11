import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { UIStore } from "./types";

interface WorkspaceViewsParams {
  /** Controlled graph visibility (the standalone app's /graph route). */
  graphOpen?: boolean;
  onGraphOpenChange?: (open: boolean) => void;
  /** The UI store's own graph toggle, used when nobody controls it. */
  showGraph: boolean;
  setShowGraph: UIStore["setShowGraph"];
  setMode: UIStore["setMode"];
}

/**
 * The workspace SURFACES — the editor, the relationship map and the Cards
 * board — and every handler that moves between them. The map and Cards render
 * as overlays over `<main>` with the editor still mounted beneath (see
 * `useOverlayInert` for what happens to the covered editor).
 */
export function useWorkspaceViews({
  graphOpen,
  onGraphOpenChange,
  showGraph,
  setShowGraph,
  setMode,
}: WorkspaceViewsParams) {
  // Graph visibility: URL-controlled by the standalone app (onGraphOpenChange
  // provided) or falls back to the UI store's internal toggle for embedders.
  const graphControlled = onGraphOpenChange != null;
  const graphVisible = graphControlled ? !!graphOpen : showGraph;
  const setGraphVisible = useCallback((v: boolean) => {
    if (onGraphOpenChange) onGraphOpenChange(v);
    else setShowGraph(v);
  }, [onGraphOpenChange, setShowGraph]);

  // Cards board visibility. Local (not URL-controlled) so embedders get it for
  // free; like the graph it is an OVERLAY — the editor stays mounted beneath.
  const [cardsVisible, setCardsVisible] = useState(false);

  /** The workspace surface currently covering the editor.
   *
   *  Map and Cards are PEERS — two full-canvas views of the same library — so
   *  they are ONE exclusive selection, not two independent booleans. They used
   *  to be exactly that, and both could mount at once: two `aria-modal` dialogs
   *  stacked at the same z-index, the second one invisible underneath the first
   *  (opening the map while Cards was up looked like a dead menu item), sharing
   *  a single `overlayRef` so focus landed on whichever mounted last.
   *
   *  Route the graph through `setGraphVisible` (not `setShowGraph`) so the
   *  standalone app's /graph URL control keeps working. */
  const workspaceView: "editor" | "map" | "cards" =
    cardsVisible ? "cards" : graphVisible ? "map" : "editor";
  const setWorkspaceView = useCallback((view: "editor" | "map" | "cards") => {
    setCardsVisible(view === "cards");
    setGraphVisible(view === "map");
  }, [setGraphVisible]);
  /** Keyboard shortcuts stay TOGGLES — ⌘⇧K pressed twice should put you back —
   *  even though the on-screen control is a three-way radio where Editor is its
   *  own option rather than "the other two are off". */
  const toggleWorkspaceView = useCallback((view: "map" | "cards") => {
    setWorkspaceView(workspaceView === view ? "editor" : view);
  }, [setWorkspaceView, workspaceView]);

  /** Picking a layout (Markdown / Rich / Split) implies you want the editor:
   *  those panes are invisible under an overlay, so a mode change there would
   *  otherwise be a control that silently does nothing. */
  const handleSetMode = useCallback((m: string) => {
    setMode(m);
    setWorkspaceView("editor");
  }, [setMode, setWorkspaceView]);

  // Shared overlay shell for the graph / cards boards. Takes focus on mount and
  // marks the editor behind it inert so its controls are neither tabbable nor
  // clickable while covered. Escape is each surface's own (bubble phase, and
  // only when pressed inside it — see ui/shared/utils/overlay-escape.ts).
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // The surface switcher SELECTS: its buttons say "go here", so they must not
  // un-toggle back to the editor. Stable identities — they are props of the
  // memoized MenuBar and WorkspacePanel.
  const showMapView = useCallback(() => setWorkspaceView("map"), [setWorkspaceView]);
  const showCardsView = useCallback(() => setWorkspaceView("cards"), [setWorkspaceView]);
  const showEditorView = useCallback(() => setWorkspaceView("editor"), [setWorkspaceView]);
  // …while ⌘⇧G / ⌘⇧K TOGGLE. Hoisted, not inline: they are dependencies of the
  // shortcut hook's effect, which registers a CAPTURE-phase keydown listener on
  // `document`; as inline arrows they re-subscribed it on every render.
  const toggleGraphCb = useCallback(() => toggleWorkspaceView("map"), [toggleWorkspaceView]);
  const toggleCardsCb = useCallback(() => toggleWorkspaceView("cards"), [toggleWorkspaceView]);

  return {
    graphVisible,
    cardsVisible,
    workspaceView,
    setWorkspaceView,
    handleSetMode,
    overlayRef,
    showMapView,
    showCardsView,
    showEditorView,
    toggleGraphCb,
    toggleCardsCb,
  };
}

/**
 * E4: focus + inert handling for the full-screen overlays. Takes focus into the
 * overlay when one opens, marks the editor it covers `inert`, and on close
 * restores both. Escape is NOT handled here (A057 — see below).
 */
export function useOverlayInert(overlayRef: RefObject<HTMLDivElement | null>, anyOverlayOpen: boolean) {
  useEffect(() => {
    if (!anyOverlayOpen) return;
    const node = overlayRef.current;
    const restoreTo = document.activeElement as HTMLElement | null;
    node?.focus();

    // Make the COVERED editor genuinely unreachable. It stays mounted (a hard
    // invariant — the live TipTap editor is the canonical source of truth), so
    // without this its panes, bubble menus and buttons were still tabbable and
    // clickable underneath an opaque overlay: Tab from Cards walked the cursor
    // into an editor nobody could see. Applied imperatively to <main>'s other
    // children because React 18 does not pass `inert` through as a prop.
    const covered: Element[] = [];
    const main = node?.parentElement;
    if (main) {
      for (const child of Array.from(main.children)) {
        if (child === node) continue;
        child.setAttribute("inert", "");
        covered.push(child);
      }
    }

    // No Escape listener here any more (A057). This used to force-close the
    // overlay from a CAPTURE-phase document listener whenever focus was
    // outside it — which is exactly where the delete-confirmation dialog, the
    // library's rename box and every menu live, so their Escape closed the
    // overlay instead (and the rename box's blur then committed the rename
    // being cancelled). Cards and the map each close themselves on an Escape
    // pressed inside them or with nothing focused (overlayShouldHandleEscape).
    return () => {
      for (const child of covered) child.removeAttribute("inert");
      if (restoreTo && document.body.contains(restoreTo)) restoreTo.focus?.();
    };
  }, [anyOverlayOpen]);
}
