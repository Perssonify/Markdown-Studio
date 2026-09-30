import type { Message } from "../types";

/**
 * Words that mean the same thing on every button that uses them. Anything
 * whose translation could depend on where it appears belongs in its area's
 * namespace instead.
 */
export const common = {
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
  "common.edit": "Edit",
  "common.export": "Export",
  "common.import": "Import",
  "common.next": "Next",
  "common.redo": "Redo",
  "common.reload": "Reload",
  "common.rename": "Rename",
  "common.replace": "Replace",
  "common.save": "Save",
  "common.settings": "Settings",
  "common.skip": "Skip",
  "common.undo": "Undo",
  "common.untitled": "Untitled",
} satisfies Record<`common.${string}`, Message>;
