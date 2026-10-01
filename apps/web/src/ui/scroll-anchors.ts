import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/**
 * Where the headings are in the markdown source, in document order.
 *
 * The split-pane scroll sync pairs headings on the two sides by normalised
 * text. The markdown side used to find them with `/^#{1,6}\s+(.*)$/` per line,
 * plus a hand-rolled fenced-code tracker so a `# comment` inside a shell block
 * was not mistaken for one. That regex is anchored at the start of the line
 * with no tolerance for anything before the hashes, so it saw **ATX headings
 * only, unindented and unquoted** — while the rich side collects every rendered
 * `h1`-`h6` with a descendant selector, which includes:
 *
 *   - setext headings (`Title` underlined with `===` or `---`);
 *   - headings inside a blockquote (`> # Heading`);
 *   - headings nested in a list item.
 *
 * Every one of those existed on the rendered side and not the source side. The
 * pairing pass skips anchors it cannot match, so the immediate effect was a
 * lost alignment point — but its lookahead window is only four, so a document
 * with more than four consecutive unmatched headings loses pairing for the
 * whole remainder.
 *
 * Asking CodeMirror's own parse tree removes the guesswork and the fence
 * tracker with it: indented code blocks, `#hashtag` at the start of a line, a
 * `#` inside a link — all already decided correctly by the markdown parser.
 */
export interface MarkdownHeading {
  /** Document position of the heading's first character. */
  from: number;
  /** Heading text with its markers removed, ready to normalise and match. */
  text: string;
}

const ATX = /^ATXHeading[1-6]$/;
const SETEXT = /^SetextHeading[12]$/;

/** Strip `###` / trailing `###` from ATX, and the `===` / `---` rule from setext. */
function headingText(raw: string, isSetext: boolean): string {
  if (isSetext) return (raw.split("\n")[0] ?? "").trim();
  return raw.replace(/^\s*#{1,6}\s*/, "").replace(/\s*#*\s*$/, "").trim();
}

export function markdownHeadings(state: EditorState): MarkdownHeading[] {
  const out: MarkdownHeading[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      const isSetext = SETEXT.test(node.name);
      if (!isSetext && !ATX.test(node.name)) return;
      const text = headingText(state.doc.sliceString(node.from, node.to), isSetext);
      if (text) out.push({ from: node.from, text });
    },
  });
  // `iterate` is a pre-order walk, so a heading nested in a blockquote or a
  // list item is reached after its container — which is still document order
  // for the container's own start, but sort to be certain the two sides are
  // compared in the same sequence.
  return out.sort((a, b) => a.from - b.from);
}
