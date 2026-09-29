/**
 * Search highlight color constants — shared between CM6 and Tiptap panes.
 *
 * All search-related colors are defined here to ensure visual consistency
 * between the two editor panes. Both panes use inline styles (not CSS classes)
 * to guarantee visibility regardless of Tailwind or other stylesheet conflicts.
 */

// --- Base match highlight ---
export const HIGHLIGHT_STYLE =
  "background-color: rgba(245, 158, 11, 0.45); border-radius: 2px;";

// --- Replace preview ---
export const REPLACE_OLD_STYLE =
  "text-decoration: line-through; opacity: 0.5; background-color: rgba(245, 158, 11, 0.2); border-radius: 2px;";
export const REPLACE_NEW_STYLE =
  "color: #22c55e; background: rgba(34,197,94,0.12); padding: 0 2px; border-radius: 2px; font-style: italic;";

// --- Capture group overlay colors (must match between CM6 and Tiptap) ---
export const GROUP_STYLES: readonly string[] = [
  "background-color: rgba(59, 130, 246, 0.30); border-radius: 2px;", // blue  — $1
  "background-color: rgba(168, 85, 247, 0.30); border-radius: 2px;", // purple — $2
  "background-color: rgba(34, 197, 94, 0.30); border-radius: 2px;", // green  — $3
  "background-color: rgba(236, 72, 153, 0.30); border-radius: 2px;", // pink   — $4
  "background-color: rgba(6, 182, 212, 0.30); border-radius: 2px;", // cyan   — $5
];

// Max widgets to render in replace preview mode (performance cap)
export const MAX_PREVIEW_WIDGETS = 200;
