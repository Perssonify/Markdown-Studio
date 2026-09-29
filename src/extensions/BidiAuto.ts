import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Right-to-left text in the rich pane: every text block gets `dir="auto"`, so
 * a paragraph (list item, heading, cell, …) takes its direction from its own
 * first strong character — Arabic or Hebrew reads and aligns right-to-left,
 * Latin left-to-right, in the same document. Without it everything rendered
 * left-to-right.
 *
 * VIEW-ONLY, by design: node decorations touch the rendered DOM, never the
 * document. TipTap's built-in `textDirection` option would instead add a `dir`
 * attribute to every node of the schema — into the canonical JSON of every
 * document, and every stored document rewritten on its next save — to say
 * something the text already says. getHTML()/getJSON() are unchanged.
 *
 * Maintained incrementally: an edit re-derives only the top-level blocks it
 * touched, so typing in a long document costs the size of the block, not the
 * document. Code blocks and maths are left alone (code is left-to-right).
 */
const BIDI_BLOCKS = new Set([
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "blockquote",
  "callout",
  "tableCell",
  "tableHeader",
  "summary",
]);
const DIR_AUTO = { dir: "auto" };

function decorationsIn(doc: PMNode, from: number, to: number): Decoration[] {
  const out: Decoration[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (BIDI_BLOCKS.has(node.type.name)) out.push(Decoration.node(pos, pos + node.nodeSize, DIR_AUTO));
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
        },
      }),
    ];
  },
});
