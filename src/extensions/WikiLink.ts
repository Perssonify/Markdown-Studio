import { Link } from "@tiptap/extension-link";

/**
 * Link mark extended to preserve the two data-attributes that power internal
 * links, which the stock TipTap Link mark would otherwise drop when parsing
 * HTML into ProseMirror:
 *
 *   data-doc-link  — target document (title or id; "" means the current doc)
 *   data-anchor    — a heading within that document (heading anchor links)
 *
 * Without these attributes surviving the HTML→PM parse, a wiki link or heading
 * anchor produced by the markdown engine (mdToHtml) would render as a bare
 * `<a href="#">` in the rich pane — the click handler (useLinkIndex) reads
 * data-doc-link / data-anchor off the DOM, and the turndown wikiLink rule keys
 * on data-doc-link, so both navigation and round-trip depend on this.
 *
 * Styling targets `a[data-doc-link]` in styles.css, so no class handling is
 * needed here.
 */
export const WikiLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      docLink: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-doc-link"),
        // "" (current-doc anchor) is a meaningful value — render whenever the
        // attribute was present at all (i.e. not null).
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs["docLink"] != null ? { "data-doc-link": attrs["docLink"] } : {},
      },
      anchor: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-anchor"),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs["anchor"] ? { "data-anchor": attrs["anchor"] } : {},
      },
    };
  },
});
