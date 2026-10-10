/**
 * THE single source of truth for keyboard-shortcut documentation.
 *
 * Consumed by: the Help page (src/ui/pages/helpPage/help-content.ts), the status-bar
 * shortcuts dialog (KeyboardShortcutsDialog), and the menu bar's embedder
 * fallback dialog. It previously lived as three hand-maintained lists, which
 * drifted (one still advertised a removed "Focus mode" binding).
 *
 * When a binding changes in src/hooks/useKeyboardShortcuts.ts, update it HERE.
 * ⌘ is displayed for brevity; Ctrl is handled equivalently on Windows/Linux.
 *
 * Names and notes are read from the translation catalog (`shortcuts.*`) when
 * they are READ, not when this module loads, so they follow the interface
 * language; the key glyphs are data and stay here.
 */
import { t, type MessageKey } from "../i18n/core";

export interface ShortcutRow {
  action: string;
  keys: string;
}

/** A row whose name is looked up in the current language each time it is read. */
const row = (action: MessageKey, keys: string): ShortcutRow => ({
  get action() {
    return t(action);
  },
  keys,
});

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
    get group() { return t("shortcuts.groupDocuments"); },
    rows: [
      row("shortcuts.newDocument", "⌘N"),
      row("shortcuts.save", "⌘S"),
      row("shortcuts.find", "⌘F"),
      row("shortcuts.findAndReplace", "⌥⌘F"),
      row("shortcuts.searchAllNotes", "⌘⇧F"),
      row("shortcuts.toggleWorkspacePanel", "⌘⇧D"),
      row("shortcuts.toggleRelationshipGraph", "⌘⇧G"),
      row("shortcuts.toggleCardsBoard", "⌘⇧K"),
      row("shortcuts.undoRedo", "⌘Z / ⌘⇧Z"),
    ],
  },
  {
    get group() { return t("shortcuts.groupInlineFormatting"); },
    rows: [
      row("shortcuts.bold", "⌘B"),
      row("shortcuts.italic", "⌘I"),
      row("shortcuts.underline", "⌘U"),
      row("shortcuts.inlineCode", "⌘E"),
      row("shortcuts.strikethrough", "⌘⇧X"),
      row("shortcuts.highlight", "⌘⇧H"),
      row("shortcuts.insertLink", "⌘K"),
    ],
  },
  {
    get group() { return t("shortcuts.groupBlocksAndStructure"); },
    rows: [
      row("shortcuts.heading1to6", "⌘⇧1 … ⌘⇧6"),
      row("shortcuts.normalText", "⌘⇧0"),
      row("shortcuts.numberedList", "⌘⇧7"),
      row("shortcuts.bulletedList", "⌘⇧8"),
      row("shortcuts.blockquote", "⌘⇧9"),
      row("shortcuts.indentOutdentListItem", "⌘] / ⌘["),
    ],
    get note() { return t("shortcuts.noteIndentNestsAListItem"); },
  },
  {
    get group() { return t("shortcuts.groupAlignment"); },
    get note() { return t("shortcuts.noteAlignmentAppliesInTheRich"); },
    rows: [
      row("shortcuts.alignLeft", "⌘⇧L"),
      row("shortcuts.alignCenter", "⌘⇧E"),
      row("shortcuts.alignRight", "⌘⇧R"),
      row("shortcuts.justify", "⌘⇧J"),
    ],
  },
  {
    get group() { return t("shortcuts.groupKeyboardNavigation"); },
    get note() { return t("shortcuts.noteTheMarkdownEditorKeepsTab"); },
    rows: [
      { get action() { return t("shortcuts.skipToTheEditor"); }, get keys() { return t("shortcuts.keysTabFirstStopOnThe"); } },
      { get action() { return t("shortcuts.leaveTheMarkdownEditor"); }, get keys() { return t("shortcuts.keysEscThenTab"); } },
      row("shortcuts.moveBetweenToolbarButtons", "← / →"),
      row("shortcuts.moveThroughTheDocumentLibrary", "↑ / ↓, Home / End"),
      row("shortcuts.openOrCloseAFolder", "→ / ←"),
      row("shortcuts.openTheSelectedDocument", "Enter"),
      row("shortcuts.renameTheSelectedItem", "F2"),
      row("shortcuts.actionsForTheSelectedItem", "⇧F10"),
    ],
  },
];

/** Curated everyday subset for compact surfaces (embedder fallback dialog). */
export const COMMON_SHORTCUTS: ShortcutRow[] = [
  row("shortcuts.newDocument", "⌘N"),
  row("shortcuts.save", "⌘S"),
  row("shortcuts.find", "⌘F"),
  // NOT ⌘F, which opens plain Find, and NOT ⌘H on a Mac: AppKit consumes that
  // as Hide Application before the page sees it, which is the whole reason
  // ⌥⌘F exists. This row said "Find & Replace ⌘F" and had no Replace binding
  // at all — and it is the list an embedder's fallback dialog shows.
  row("shortcuts.findAndReplace", "⌥⌘F"),
  row("shortcuts.searchAllNotes", "⌘⇧F"),
  row("shortcuts.toggleWorkspacePanel", "⌘⇧D"),
  row("shortcuts.toggleRelationshipGraph", "⌘⇧G"),
  row("shortcuts.boldItalicUnderline", "⌘B / ⌘I / ⌘U"),
  row("shortcuts.undoRedo", "⌘Z / ⌘⇧Z"),
  row("shortcuts.insertLink", "⌘K"),
];
