import { Extension } from "@tiptap/core";
import { DOMSerializer, type Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type NodeView } from "@tiptap/pm/view";

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
 * Through NODE VIEWS, not decorations (A083). A decoration on every block made
 * each transaction quadratic in the number of blocks: ProseMirror maps a
 * node decoration by searching its parent's children for it, and hands each
 * child its decorations by scanning every decoration at that level — one
 * keystroke in a 1.6 MB document took 714 ms (jsdom), four seconds at 4x CPU
 * in Chromium, before anything else ran. A node view here is the node's own
 * `toDOM` rendering with the attribute added; ProseMirror updates its content
 * as it would its default rendering, and redraws it only when the node's
 * attributes change. A task item already has a node view (TipTap's), so it
 * keeps a decoration; task items sit inside their lists, where that costs
 * little. Code blocks and maths are left alone (code is left-to-right).
 */
const VIEWED_BLOCKS = ["paragraph", "heading", "listItem", "blockquote", "callout", "tableCell", "tableHeader", "summary"];
const DECORATED_BLOCKS = new Set(["taskItem"]);
const DIR_AUTO = { dir: "auto" };

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

function decorationsIn(doc: PMNode, from: number, to: number): Decoration[] {
  const out: Decoration[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (DECORATED_BLOCKS.has(node.type.name)) out.push(Decoration.node(pos, pos + node.nodeSize, DIR_AUTO));
    return !node.isTextblock;
  });
  return out;
}

const bidiKey = new PluginKey<DecorationSet>("bidiAuto");

export const BidiAuto = Extension.create({
  name: "bidiAuto",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: bidiKey,
        state: {
          init: (_config, state) =>
            DecorationSet.create(state.doc, decorationsIn(state.doc, 0, state.doc.content.size)),
          apply: (tr, set) => {
            if (!tr.docChanged) return set;
            // The changed region, in the NEW document's coordinates.
            let from = Infinity;
            let to = -Infinity;
            tr.mapping.maps.forEach((map, i) => {
              const rest = tr.mapping.slice(i + 1);
              map.forEach((_os, _oe, ns, ne) => {
                from = Math.min(from, rest.map(ns, -1));
                to = Math.max(to, rest.map(ne, 1));
              });
            });
            const doc = tr.doc;
            const mapped = set.map(tr.mapping, doc);
            if (from > to) return mapped;
            const size = doc.content.size;
            const $from = doc.resolve(Math.max(0, Math.min(from, size)));
            const $to = doc.resolve(Math.max(0, Math.min(to, size)));
            // Widen to whole top-level blocks, and replace exactly the
            // decorations inside them — nothing at a neighbour's edge.
            const start = $from.depth > 0 ? $from.before(1) : $from.pos;
            const end = $to.depth > 0 ? $to.after(1) : $to.pos;
            const stale = mapped.find(start, end).filter((d) => d.from >= start && d.to <= end);
            return mapped.remove(stale).add(doc, decorationsIn(doc, start, end));
          },
        },
        props: {
          decorations: (state) => bidiKey.getState(state) ?? null,
          nodeViews: Object.fromEntries(VIEWED_BLOCKS.map((type) => [type, autoDirView])),
        },
      }),
    ];
  },
});
