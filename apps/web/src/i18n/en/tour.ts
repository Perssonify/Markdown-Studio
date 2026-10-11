import type { Message } from "../types";

/** Guided tour: walkthrough/index.tsx. */
export const tour = {
  "tour.menuBarTitle": "The menu bar",
  "tour.menuBarBodyPhone": "Every command lives behind this menu button — File, Edit, Insert, View, Format, Tools and Help.",
  "tour.menuBarBody": "Every command lives here — File, Edit, Insert, View, Format, Tools and Help. When in doubt, start in a menu.",
  "tour.layoutTitle": "Choose your layout",
  "tour.layoutBody": "Switch between Markdown, Rich text, or a Split view of both. On a phone these collapse to icons.",
  "tour.workspaceViewsTitle": "Two more ways to see your notes",
  "tour.workspaceViewsBody": "Cards is a board of every note for quick capture and sorting. The map shows how your notes link to each other — pick any note in it to see its headings and every link in and out, and click through without leaving the map. Editor brings you back (Esc works too).",
  "tour.settingsTitle": "Make it yours",
  "tour.settingsBody": "Open settings for Markdown options; theme and accent colors also live under View → Appearance.",
  "tour.toolbarTitle": "Quick formatting",
  "tour.toolbarBody": "Bold, lists, links and more for the pane you’re in — plus Save and Undo/Redo, always one click away.",
  "tour.editorTitle": "Two panes, always in sync",
  "tour.editorBody": "Type Markdown on the left or rich text on the right — each updates the other instantly. Drag the divider to resize.",
  "tour.workspaceTitle": "Your workspace",
  "tour.workspaceBody": "Your files and the document Outline live in this panel on the left. The document you are editing is marked with a coloured bar; pick another and the Outline follows it.",
  "tour.closeTour": "Close tour",
} satisfies Record<`tour.${string}`, Message>;
