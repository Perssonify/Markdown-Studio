import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Keeps React from walking a large rich pane on every commit (A083).
 *
 * Before each commit React saves the focused element's caret, to restore it if
 * the commit moved focus (`getSelectionInformation`). For a contenteditable it
 * finds the caret's character offsets by walking EVERY DOM node before it — in
 * a 4 MB document, with the caret near the end, nearly the whole editor: about
 * 0.5 s at 4x CPU for each commit anywhere on the page, while the editor has
 * focus. A save commits several times (its status, the library listing, the
 * word count), and so does typing; measured, the walk was most of what was
 * left of an autosave's freeze once the save itself was cheap.
 *
 * React reads an element that has a `selectionStart` property directly — that
 * is how it treats inputs — so the rich pane gets one (read as 0, writes
 * ignored) while its document is large. React writes it back only when a
 * commit moved focus, and then focuses the editor again itself; ProseMirror
 * restores its own selection when it is focused. Below the size nothing is
 * added: a browser extension that takes an element with `selectionStart` for
 * a text field (and reads its `value`) sees the editor exactly as before.
 * `react-selection-shield.test.jsx` holds React to the shortcut, so an upgrade
 * that dropped it would be noticed.
 */
export const SHIELD_FROM_SIZE = 200_000; // document positions, ~200 KB of text

const SHIELDED_KEYS = ["selectionStart", "selectionEnd"] as const;
const shielded = new WeakSet<HTMLElement>();

/** Add or remove the properties on `el` (idempotent). Exported for tests. */
export function shieldFromReact(el: HTMLElement, on: boolean): void {
  if (on === shielded.has(el)) return;
  if (on) {
    for (const key of SHIELDED_KEYS) {
      Object.defineProperty(el, key, { configurable: true, enumerable: false, get: () => 0, set: () => {} });
    }
    shielded.add(el);
  } else {
    for (const key of SHIELDED_KEYS) delete (el as unknown as Record<string, unknown>)[key];
    shielded.delete(el);
  }
}

export const ReactSelectionShield = Extension.create({
  name: "reactSelectionShield",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("reactSelectionShield"),
        view: (view) => {
          const apply = () => shieldFromReact(view.dom as HTMLElement, view.state.doc.content.size >= SHIELD_FROM_SIZE);
          apply();
          return {
            update: apply,
            destroy: () => shieldFromReact(view.dom as HTMLElement, false),
          };
        },
      }),
    ];
  },
});
