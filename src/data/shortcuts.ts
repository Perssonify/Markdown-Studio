/**
 * THE single source of truth for keyboard-shortcut documentation.
 *
 * Consumed by: the Help page (src/ui/pages/help-content.ts), the status-bar
 * shortcuts dialog (KeyboardShortcutsDialog), and the menu bar's embedder
 * fallback dialog. It previously lived as three hand-maintained lists, which
 * drifted (one still advertised a removed "Focus mode" binding).
 *
 * When a binding changes in src/hooks/useKeyboardShortcuts.ts, update it HERE.
 * ⌘ is displayed for brevity; Ctrl is handled equivalently on Windows/Linux.
 */

export interface ShortcutRow {
  action: string;
  keys: string;
}

// Mac gets the ⌘/⇧ glyphs it expects; everyone else gets Ctrl+/Shift+ text.
// Shortcut data is authored in glyph form and converted at display time.
export const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");

export type ShortcutPlatform = "mac" | "other";

/** Format a glyph-form shortcut ("⌘⇧Z") for a specific platform. The Help page
 *  uses this to show BOTH Mac and Windows/Linux bindings via a toggle. */
export function displayKeysFor(keys: string, platform: ShortcutPlatform): string {
  if (platform === "mac") return keys;
  return keys
    .replace(/⌘/g, "Ctrl+")
    .replace(/⇧/g, "Shift+")
    .replace(/⌥/g, "Alt+");
}

/** Format a glyph-form shortcut ("⌘⇧Z") for the current platform. */
export function displayKeys(keys: string): string {
  return displayKeysFor(keys, IS_MAC ? "mac" : "other");
}

export interface ShortcutGroup {
  group: string;
  rows: ShortcutRow[];
  /**
   * A short caveat rendered under the group heading. Two groups need one: what
   * "indent" can mean in a Markdown document is narrower than the word suggests,
   * and alignment is the one formatting feature plain Markdown cannot record at
   * all. Documenting a binding without its scope is how "the button does
   * nothing" bug reports are written.
   */
  note?: string;
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    group: "Documents",
    rows: [
      { action: "New document", keys: "⌘N" },
      { action: "Save", keys: "⌘S" },
      { action: "Find", keys: "⌘F" },
      { action: "Find & Replace", keys: "⌥⌘F" },
      { action: "Search all notes", keys: "⌘⇧F" },
      { action: "Toggle workspace panel", keys: "⌘⇧D" },
      { action: "Toggle relationship graph", keys: "⌘⇧G" },
      { action: "Toggle cards board", keys: "⌘⇧K" },
      { action: "Undo / Redo", keys: "⌘Z / ⌘⇧Z" },
    ],
  },
  {
    group: "Inline formatting",
    rows: [
      { action: "Bold", keys: "⌘B" },
      { action: "Italic", keys: "⌘I" },
      { action: "Underline", keys: "⌘U" },
      { action: "Inline code", keys: "⌘E" },
      { action: "Strikethrough", keys: "⌘⇧X" },
      { action: "Highlight", keys: "⌘⇧H" },
      { action: "Insert link", keys: "⌘K" },
    ],
  },
  {
    group: "Blocks & structure",
    rows: [
      { action: "Heading 1–6", keys: "⌘⇧1 … ⌘⇧6" },
      { action: "Normal text", keys: "⌘⇧0" },
      { action: "Numbered list", keys: "⌘⇧7" },
      { action: "Bulleted list", keys: "⌘⇧8" },
      { action: "Blockquote", keys: "⌘⇧9" },
      { action: "Indent / Outdent list item", keys: "⌘] / ⌘[" },
    ],
    note: "Indent nests a list item — including a checklist item. Markdown has no paragraph indent, so on an ordinary paragraph it does nothing.",
  },
  {
    group: "Alignment",
    note: "Alignment applies in the rich pane. Plain Markdown cannot record it, so it is flagged by the fidelity indicator and does not survive an export.",
    rows: [
      { action: "Align left", keys: "⌘⇧L" },
      { action: "Align center", keys: "⌘⇧E" },
      { action: "Align right", keys: "⌘⇧R" },
      { action: "Justify", keys: "⌘⇧J" },
    ],
  },
  {
    group: "Keyboard navigation",
    note: "The Markdown editor keeps Tab for indenting, so press Esc first to move focus out of it. Lists and the toolbar are one Tab stop each; arrow keys move within them.",
    rows: [
      { action: "Skip to the editor", keys: "Tab (first stop on the page)" },
      { action: "Leave the Markdown editor", keys: "Esc, then Tab" },
      { action: "Move between toolbar buttons", keys: "← / →" },
      { action: "Move through the document library", keys: "↑ / ↓, Home / End" },
      { action: "Open or close a folder", keys: "→ / ←" },
      { action: "Open the selected document", keys: "Enter" },
      { action: "Rename the selected item", keys: "F2" },
      { action: "Actions for the selected item", keys: "⇧F10" },
    ],
  },
];

/** Curated everyday subset for compact surfaces (embedder fallback dialog). */
export const COMMON_SHORTCUTS: ShortcutRow[] = [
  { action: "New document", keys: "⌘N" },
  { action: "Save", keys: "⌘S" },
  { action: "Find", keys: "⌘F" },
  // NOT ⌘F, which opens plain Find, and NOT ⌘H on a Mac: AppKit consumes that
  // as Hide Application before the page sees it, which is the whole reason
  // ⌥⌘F exists. This row said "Find & Replace ⌘F" and had no Replace binding
  // at all — and it is the list an embedder's fallback dialog shows.
  { action: "Find & Replace", keys: "⌥⌘F" },
  { action: "Search all notes", keys: "⌘⇧F" },
  { action: "Toggle workspace panel", keys: "⌘⇧D" },
  { action: "Toggle relationship graph", keys: "⌘⇧G" },
  { action: "Bold / Italic / Underline", keys: "⌘B / ⌘I / ⌘U" },
  { action: "Undo / Redo", keys: "⌘Z / ⌘⇧Z" },
  { action: "Insert link", keys: "⌘K" },
];
