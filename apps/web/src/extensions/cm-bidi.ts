import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

/**
 * Right-to-left text in the markdown pane: each line takes its direction from
 * its own text. `perLineTextDirection` makes CodeMirror read the direction of
 * every rendered line (for cursor motion and selection drawing) instead of
 * assuming one for the whole editor; `dir="auto"` on each visible line is what
 * gives a line a direction to read. Only visible lines are decorated — the
 * viewport is all CodeMirror renders.
 */
const DIR_AUTO = Decoration.line({ attributes: { dir: "auto" } });

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      builder.add(line.from, line.from, DIR_AUTO);
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const dirAutoLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations }
);

export const perLineTextDirection = [EditorView.perLineTextDirection.of(true), dirAutoLines];
