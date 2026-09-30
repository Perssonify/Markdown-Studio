import type { Message } from "../types";

/**
 * Words that mean the same thing on every button that uses them. Anything
 * whose translation could depend on where it appears belongs in its area's
 * namespace instead.
 */
export const common = {
  "common.apply": "Apply",
  "common.back": "Back",
  "common.cancel": "Cancel",
  "common.clear": "Clear",
  "common.close": "Close",
  "common.continue": "Continue",
  "common.copied": "Copied",
  "common.copy": "Copy",
  "common.delete": "Delete",
  "common.dismiss": "Dismiss",
  "common.done": "Done",
  "common.download": "Download",
  "common.edit": "Edit",
  "common.export": "Export",
  "common.help": "Help",
  "common.hide": "Hide",
  "common.import": "Import",
  "common.learnMore": "Learn more",
  "common.next": "Next",
  "common.ok": "OK",
  "common.open": "Open",
  "common.preview": "Preview",
  "common.redo": "Redo",
  "common.reload": "Reload",
  "common.remove": "Remove",
  "common.rename": "Rename",
  "common.replace": "Replace",
  "common.reset": "Reset",
  "common.retry": "Retry",
  "common.save": "Save",
  "common.search": "Search",
  "common.settings": "Settings",
  "common.show": "Show",
  "common.skip": "Skip",
  "common.undo": "Undo",
  "common.untitled": "Untitled",
} satisfies Record<`common.${string}`, Message>;
