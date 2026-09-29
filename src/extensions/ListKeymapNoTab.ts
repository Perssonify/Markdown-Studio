import { ListKeymap } from "@tiptap/extension-list";

/**
 * Tiptap's list keymap WITHOUT the Tab binding it gained in 3.31.
 *
 * The upgrade to 3.31 (production-readiness audit, A113 — it carries security
 * fixes) added a `Tab` handler to `ListKeymap`: with the caret at the start of
 * a paragraph that directly follows a list, Tab moves that paragraph INTO the
 * list's last item. That changed two things users relied on, silently, as a
 * side effect of a dependency bump:
 *  - document structure: in this editor indent means list NESTING only, and it
 *    is a no-op on a paragraph (CLAUDE.md, "Indent/outdent mean LIST NESTING");
 *  - keyboard focus: outside a list item, Tab moved focus out of the rich pane;
 *    in that one position it now stayed and restructured the document instead.
 *
 * Everything else the keymap does (Backspace/Delete joining list items) is kept,
 * and Tab INSIDE a list item still nests it — that binding lives on the list
 * item node (`sinkListItem`), not here. Adopting the new behaviour is a product
 * decision: delete this extension and StarterKit's `listKeymap: false`.
 */
export const ListKeymapNoTab = ListKeymap.extend({
  addKeyboardShortcuts() {
    const shortcuts = { ...(this.parent?.() ?? {}) };
    delete shortcuts.Tab;
    return shortcuts;
  },
});
