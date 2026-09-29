import { create } from "zustand";
import { safeStorage } from "../utils/safe-storage";
import { MODES } from "../constants";
import {
  DEFAULT_MARKDOWN_FEATURES,
  type MarkdownFeatureSettings,
} from "./settings";

interface UIState {
  // View
  mode: string;
  showFindReplace: boolean;
  showSidebar: boolean;
  showGraph: boolean;

  // Editor
  syncMode: string;
  pasteStyled: boolean;
  editorReady: boolean;

  // Theme (only used when no external isDarkProp is provided)

  // Markdown flavor / feature settings (persisted under __prefs.markdownFeatures)
  markdownFeatures: MarkdownFeatureSettings;

  // When true, case transforms (UPPER/lower/Title) skip code + link URLs so only
  // human-readable content is changed. Sticky via localStorage.
  caseContentOnly: boolean;

  // Optional display ads — off by default. Shown only in full chrome. Sticky via
  // localStorage; also settable per-load by the ?ads= URL param.
  showAds: boolean;

  // Read-only mode — disables editing in both panes and hides the formatting
  // toolbar. Sticky via localStorage; also settable per-load by ?readonly=.
  readOnly: boolean;

  // Admin: right-click (context) menu enabled. Default on; a debug/admin toggle.
  contextMenuEnabled: boolean;

  // Admin: diagnostics console tray tab enabled. Default OFF; an operator/debug
  // tool exposing a curated read-only command registry (no eval).
  consoleEnabled: boolean;

  // Keyboard shortcuts enabled. Default on; lets users turn off all app shortcuts.
  keyboardShortcutsEnabled: boolean;

  // Typography & reading comfort (all sticky via localStorage). Applied as CSS
  // custom properties on the editor container so both panes honor them.
  editorFontSize: number;   // px
  editorLineHeight: number; // unitless
  readingWidth: number;     // reading measure in CHARACTERS (ch); 0 = full width
  spellcheck: boolean;      // browser spellcheck in both panes
  focusMode: boolean;       // dim chrome + center content

  // Persisted width (px) of the left-docked Workspace panel (Files / Outline).
  docNavWidth: number;

  // Unified left-docked WORKSPACE panel (Files / Outline). `showSidebar` is its
  // open/closed flag (persisted); `workspaceTab` the active tab. See
  // src/ui/WorkspacePanel.tsx.
  workspaceTab: "files" | "outline";

  // Actions
  setMode: (mode: string) => void;
  setShowFindReplace: (value: boolean | ((prev: boolean) => boolean)) => void;
  toggleFindReplace: () => void;
  setShowSidebar: (value: boolean | ((prev: boolean) => boolean)) => void;
  toggleSidebar: () => void;
  setShowGraph: (value: boolean) => void;
  setSyncMode: (mode: string) => void;
  setPasteStyled: (value: boolean) => void;
  setEditorReady: (value: boolean) => void;
  setCaseContentOnly: (value: boolean) => void;
  setShowAds: (value: boolean) => void;
  setReadOnly: (value: boolean) => void;
  setContextMenuEnabled: (value: boolean) => void;
  setConsoleEnabled: (value: boolean) => void;
  setKeyboardShortcutsEnabled: (value: boolean) => void;
  setEditorFontSize: (value: number) => void;
  setEditorLineHeight: (value: number) => void;
  setReadingWidth: (value: number) => void;
  setSpellcheck: (value: boolean) => void;
  setFocusMode: (value: boolean) => void;
  setDocNavWidth: (value: number) => void;
  setWorkspaceTab: (value: "files" | "outline") => void;
  /**
   * Seed the initial syncMode value from outside (replaces the old
   * localStorage.getItem call). Called by the editor during mount when
   * preferences are loaded from the storage adapter.
   */
  setInitialSyncMode: (mode: string) => void;
  setMarkdownFeatures: (
    value:
      | MarkdownFeatureSettings
      | ((prev: MarkdownFeatureSettings) => MarkdownFeatureSettings)
  ) => void;
  /** Seed markdownFeatures from persisted prefs during mount. */
  setInitialMarkdownFeatures: (value: MarkdownFeatureSettings) => void;
}


/**
 * Keep the workspace panel from eating the editor or vanishing.
 *
 * Viewport-aware: a flat 720 cap was compared against nothing, so a width chosen
 * on a wide monitor persisted and later left an 800px window with an 80px editor
 * (40px of text). Always leave room for the editor.
 */
/**
 * Workspace-panel width bounds. Exported so the panel's separator can report
 * honest `aria-valuemin`/`aria-valuemax` and its Home/End keys can reach the
 * real clamps, instead of a second copy of these numbers drifting from this one.
 */
export const DOCNAV_WIDTH_MIN = 240;
export const DOCNAV_WIDTH_MAX = 720;

/** The largest width this viewport allows — the absolute cap, or whatever
 *  leaves 420px for the editor, whichever is smaller. */
export function docNavWidthMax(): number {
  const viewport = typeof window !== "undefined" ? window.innerWidth : 1280;
  return Math.max(DOCNAV_WIDTH_MIN, Math.min(DOCNAV_WIDTH_MAX, viewport - 420));
}

/**
 * Reading width is a measure in CHARACTERS now, not a pixel cap.
 *
 * As pixels it could not do its job: the value is set on the container wrapping
 * BOTH panes, so each half-width pane inherited the same absolute cap, and with
 * the workspace panel open by default "Narrow" (640px) only began to bind above
 * roughly a 1620px viewport. Below that, all four options were pixel-identical
 * while the control highlighted and persisted — it looked functional and was
 * not. A pixel cap is also simply the wrong unit for a reading measure: change
 * the font size and the same 640px holds a different number of characters.
 *
 * Migrates the stored px values (0 / 640 / 800 / 1000) to their `ch`
 * equivalents. Anything else large enough to be a legacy pixel value is scaled
 * rather than dropped, so a hand-edited preference does not silently become
 * "Full".
 */
export function migrateReadingWidth(stored: number): number {
  if (!Number.isFinite(stored) || stored <= 0) return 0;
  if (stored < 200) return stored;              // already a ch measure
  const map: Record<number, number> = { 640: 65, 800: 80, 1000: 100 };
  return map[stored] ?? Math.max(45, Math.min(120, Math.round(stored / 10)));
}

function clampDocNavWidth(value: number): number {
  return Math.min(docNavWidthMax(), Math.max(DOCNAV_WIDTH_MIN, Math.round(Number(value) || 340)));
}

export const useUIStore = create<UIState>((set) => ({
  mode: MODES.SPLIT,
  showFindReplace: false,
  // Workspace panel open/closed. A saved preference wins; with none, default
  // OPEN on desktop (matching the old always-present sidebar) but CLOSED on
  // phones so the full-width drawer doesn't cover the editor on first load.
  showSidebar: (() => {
    const saved = safeStorage.get("pf:workspace");
    if (saved === "open") return true;
    if (saved === "closed") return false;
    return !(typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches);
  })(),
  showGraph: false,

  // Default to "styled" — the editor will hydrate from storage prefs after init.
  syncMode: "styled",
  // Styled paste is the DEFAULT: pasting from a web page or a document and
  // silently losing its bold, links and headings is the surprising outcome, not
  // the safe one — the user asked for the formatting they copied. Persisted, and
  // no longer a one-shot arm-then-reset toggle (that only made sense while the
  // default was "strip").
  pasteStyled:
    safeStorage.get("pf:paste-styled") !== "false",
  editorReady: false,
  markdownFeatures: DEFAULT_MARKDOWN_FEATURES,
  caseContentOnly:
    safeStorage.get("pf:case-content-only") !== "false",
  showAds:
    safeStorage.get("pf:show-ads") === "true",
  readOnly:
    safeStorage.get("pf:read-only") === "true",
  contextMenuEnabled:
    safeStorage.get("pf:context-menu") !== "false",
  consoleEnabled:
    safeStorage.get("pf:console") === "true",
  keyboardShortcutsEnabled:
    safeStorage.get("pf:keyboard-shortcuts") !== "false",
  editorFontSize:
    Number(safeStorage.get("pf:font-size")) || 15,
  editorLineHeight:
    Number(safeStorage.get("pf:line-height")) || 1.6,
  readingWidth: migrateReadingWidth(Number(safeStorage.get("pf:reading-width")) || 0),
  spellcheck:
    safeStorage.get("pf:spellcheck") !== "false",
  focusMode:
    safeStorage.get("pf:focus-mode") === "true",
  // Clamped on LOAD too, not only when the divider is dragged: the stored value
  // came straight through, so a width chosen on a wide monitor rendered verbatim
  // on a small one — the 80px-editor case the setter's clamp was added to fix,
  // reached by reopening the app instead of by dragging.
  docNavWidth: clampDocNavWidth(
    Number(safeStorage.get("pf:docnav-width")) || 340
  ),
  workspaceTab:
    // Migrate the removed "map" tab to "outline"; anything else falls to "files".
    (((v) => (v === "outline" ? "outline" : v === "files" ? "files" : v === "map" ? "outline" : null))(
      safeStorage.get("pf:workspace-tab")
    )) || "files",

  setInitialSyncMode: (mode) => set({ syncMode: mode }),
  setMarkdownFeatures: (value) =>
    set((s) => ({
      markdownFeatures:
        typeof value === "function" ? value(s.markdownFeatures) : value,
    })),
  setInitialMarkdownFeatures: (value) => set({ markdownFeatures: value }),
  setMode: (mode) => set({ mode }),
  setShowFindReplace: (value) =>
    set((s) => ({ showFindReplace: typeof value === "function" ? value(s.showFindReplace) : value })),
  toggleFindReplace: () => set((s) => ({ showFindReplace: !s.showFindReplace })),
  setShowSidebar: (value) =>
    set((s) => {
      const next = typeof value === "function" ? value(s.showSidebar) : value;
      safeStorage.set("pf:workspace", next ? "open" : "closed");
      return { showSidebar: next };
    }),
  toggleSidebar: () =>
    set((s) => {
      const next = !s.showSidebar;
      safeStorage.set("pf:workspace", next ? "open" : "closed");
      return { showSidebar: next };
    }),
  setShowGraph: (value) => set({ showGraph: value }),
  setSyncMode: (mode) => set({ syncMode: mode }),
  setPasteStyled: (value) => {
    set({ pasteStyled: value });
    safeStorage.set("pf:paste-styled", String(value));
  },
  setEditorReady: (value) => set({ editorReady: value }),
  setCaseContentOnly: (value) => {
    safeStorage.set("pf:case-content-only", String(value));
    set({ caseContentOnly: value });
  },
  setShowAds: (value) => {
    safeStorage.set("pf:show-ads", String(value));
    set({ showAds: value });
  },
  setReadOnly: (value) => {
    safeStorage.set("pf:read-only", String(value));
    set({ readOnly: value });
  },
  setContextMenuEnabled: (value) => {
    safeStorage.set("pf:context-menu", String(value));
    set({ contextMenuEnabled: value });
  },
  setConsoleEnabled: (value) => {
    safeStorage.set("pf:console", String(value));
    set({ consoleEnabled: value });
  },
  setKeyboardShortcutsEnabled: (value) => {
    safeStorage.set("pf:keyboard-shortcuts", String(value));
    set({ keyboardShortcutsEnabled: value });
  },
  setEditorFontSize: (value) => {
    safeStorage.set("pf:font-size", String(value));
    set({ editorFontSize: value });
  },
  setEditorLineHeight: (value) => {
    safeStorage.set("pf:line-height", String(value));
    set({ editorLineHeight: value });
  },
  setReadingWidth: (value) => {
    safeStorage.set("pf:reading-width", String(value));
    set({ readingWidth: value });
  },
  setSpellcheck: (value) => {
    safeStorage.set("pf:spellcheck", String(value));
    set({ spellcheck: value });
  },
  setFocusMode: (value) => {
    safeStorage.set("pf:focus-mode", String(value));
    set({ focusMode: value });
  },
  setDocNavWidth: (value) => {
    const w = clampDocNavWidth(value);
    safeStorage.set("pf:docnav-width", String(w));
    set({ docNavWidth: w });
  },
  setWorkspaceTab: (value) => {
    safeStorage.set("pf:workspace-tab", value);
    set({ workspaceTab: value });
  },
}));
