/**
 * Details / Summary — collapsible `<details><summary>` disclosure blocks.
 *
 * `<details>` is not Markdown, so it round-trips as RAW HTML: marked passes a
 * block-level `<details>…</details>` through untouched, TipTap parses it back via
 * these nodes, and turndown re-emits the element's `outerHTML` (the `details`
 * turndown rule). Consequently the Markdown pane shows the raw `<details>` HTML
 * for this block (acceptable — same trade-off as sized images / `<picture>`),
 * and the body is HTML rather than re-parsed Markdown.
 *
 * Schema: `details` = `summary block+`; `summary` = `inline*`.
 */

import { Node, mergeAttributes } from "@tiptap/core";

export const Details = Node.create({
  name: "details",
  group: "block",
  content: "summary block+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el: HTMLElement) => el.hasAttribute("open"),
        renderHTML: (attrs: Record<string, unknown>) => (attrs["open"] ? { open: "" } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "details" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["details", mergeAttributes(HTMLAttributes), 0];
  },
});

export const Summary = Node.create({
  name: "summary",
  content: "inline*",
  defining: true,
  // A summary only ever exists as the first child of <details>.
  parseHTML() {
    return [{ tag: "summary" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["summary", mergeAttributes(HTMLAttributes), 0];
  },
});
