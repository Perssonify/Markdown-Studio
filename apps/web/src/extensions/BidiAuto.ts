import { Extension } from "@tiptap/core";
import { TaskItem } from "@tiptap/extension-list";
import { DOMSerializer, type Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { NodeView } from "@tiptap/pm/view";

/**
 * Right-to-left text in the rich pane: every text block gets `dir="auto"`, so
 * a paragraph (list item, heading, cell, …) takes its direction from its own
 * first strong character — Arabic or Hebrew reads and aligns right-to-left,
 * Latin left-to-right, in the same document. Without it everything rendered
 * left-to-right.
 *
 * VIEW-ONLY, by design: it touches the rendered DOM, never the document.
 * TipTap's built-in `textDirection` option would instead add a `dir`
 * attribute to every node of the schema — into the canonical JSON of every
 * document, and every stored document rewritten on its next save — to say
 * something the text already says. getHTML()/getJSON() are unchanged.
 *
 * Through NODE VIEWS, never decorations (A083). A decoration on every block
 * made each transaction quadratic in the number of blocks: ProseMirror maps a
 * node decoration by searching its parent's children for it, and hands each
 * child its decorations by scanning every decoration at that level — one
 * keystroke in a 1.6 MB document took 714 ms (jsdom), four seconds at 4x CPU
 * in Chromium, before anything else ran. A node view here is the node's own
 * `toDOM` rendering with the attribute added; ProseMirror updates its content
 * as it would its default rendering, and redraws it only when the node's
 * attributes change. Code blocks and maths are left alone (code is
 * left-to-right).
 *
 * Task items have TipTap's own node view, which a plugin's cannot replace, so
 * they get the attribute from `TaskItemAutoDir` — TipTap's view with it added.
 * They were the one block left on a decoration, and building a decoration set
 * is quadratic too (ProseMirror scans every decoration for every top-level
 * block): with thousands of task items, opening a 4 MB document and the first
 * projection after it each spent 1.5 s at 4x CPU rebuilding that set.
 */
const VIEWED_BLOCKS = ["paragraph", "heading", "listItem", "blockquote", "callout", "tableCell", "tableHeader", "summary"];

/** `DOMSerializer.renderSpec` as ProseMirror's own rendering calls it: the
 *  node's attributes as the fourth argument, so an array among them is never
 *  read as markup. (The published typings stop at three arguments.) */
const renderSpec = DOMSerializer.renderSpec as unknown as (
  doc: Document, structure: unknown, xmlNS: string | null, blockArraysIn: unknown
) => { dom: Node; contentDOM?: HTMLElement };

function autoDirView(node: PMNode): NodeView {
  const { dom, contentDOM } = renderSpec(document, node.type.spec.toDOM!(node), null, node.attrs);
  (dom as HTMLElement).setAttribute("dir", "auto");
  return { dom: dom as HTMLElement, contentDOM: contentDOM ?? null };
}

const bidiKey = new PluginKey("bidiAuto");

export const BidiAuto = Extension.create({
  name: "bidiAuto",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: bidiKey,
        props: {
          nodeViews: Object.fromEntries(VIEWED_BLOCKS.map((type) => [type, autoDirView])),
        },
      }),
    ];
  },
});

/**
 * TipTap's TaskItem with `dir="auto"` on its rendered item — the rich pane's
 * task item (see BidiAuto). Its own node view keeps attributes it does not
 * manage across updates, so the attribute set once stays. The schema is
 * TaskItem's: the headless one (serialize-doc) uses TaskItem itself, and
 * neither getHTML() nor getJSON() carries the attribute — which is why it is
 * not set through `HTMLAttributes`, which would write it into both.
 */
export const TaskItemAutoDir = TaskItem.extend({
  addNodeView() {
    const make = this.parent?.();
    if (!make) return null;
    return (props) => {
      const view = make(props);
      (view.dom as HTMLElement).setAttribute("dir", "auto");
      return view;
    };
  },
});
