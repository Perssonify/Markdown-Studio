import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { isAltGraphInput } from "../utils/alt-graph";

/**
 * AltGr typing never reaches the rich pane's KEYMAPS (A052).
 *
 * Windows delivers AltGr as Ctrl+Alt, and TipTap's own extensions bind
 * Ctrl+Alt chords: `Mod-Alt-0`…`Mod-Alt-6` (paragraph / headings) and
 * `Mod-Alt-c` (code block). On a layout that types a digit on its AltGr level,
 * AltGr+1 turned the paragraph into a heading instead of typing "1" (measured:
 * `<p>x</p>` → `<h1>x</h1>`, the keystroke cancelled). The app's shortcut hook
 * already leaves AltGr alone; this does the same for the editor's keymaps.
 *
 * A `handleDOMEvents.keydown` that returns true makes ProseMirror skip its own
 * keydown processing — every keymap — WITHOUT calling preventDefault, so the
 * browser still types the character and ProseMirror reads it from the DOM like
 * any other input (input rules included). Highest priority, so no other
 * extension's keydown handler sees the event first. A plugin only: no schema
 * change, so SERIALIZE_EXTENSIONS does not need it.
 */
export const AltGraphPassthrough = Extension.create({
  name: "altGraphPassthrough",
  priority: 10000,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            keydown: (_view, event) => isAltGraphInput(event),
          },
        },
      }),
    ];
  },
});
