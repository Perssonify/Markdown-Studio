import type { Editor } from "@tiptap/core";

/**
 * Run a bubble-menu command with the guards these menus were bypassing.
 *
 * Every mutating command is supposed to funnel through
 * `useFormatDispatcher.dispatch`, which is where the read-only guard lives —
 * CLAUDE.md states this, because native editability only blocks typing, paste
 * and drop. The table and link bubble menus called `editor.chain()…run()`
 * directly, and TipTap does not save them: its bubble-menu plugin carries an
 * `isEditable` test in its DEFAULT `shouldShow`, but a caller-supplied
 * `shouldShow` REPLACES that wholesale, and `CommandManager` has no editability
 * check at all. So on a `?readonly=1` share link you could delete a row, delete
 * a column, delete the whole table, toggle the header, unlink, or re-target a
 * link.
 *
 * The composition guard is the same story: the buttons `preventDefault` their
 * mousedown to keep focus, so a live IME composition survives the click and the
 * command dispatched straight into it.
 */
export function runBubbleCommand(editor: Editor | null, fn: (ed: Editor) => void): void {
  if (!editor || editor.isDestroyed) return;
  if (!editor.isEditable) return;
  // Blur ends the composition and commits its text into the document
  // synchronously (measured — see CodeMirrorPane.endComposition); the command
  // below re-focuses through `chain().focus()`.
  if (editor.view?.composing) editor.view.dom.blur();
  fn(editor);
}
