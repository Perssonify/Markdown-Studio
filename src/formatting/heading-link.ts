import { escapeAttr } from "../engine/css-safety";

/**
 * The rich-pane HTML for a same-document heading link, `[[#Heading]]`: an
 * anchor the WikiLink mark keeps (`data-doc-link` / `data-anchor`), so it
 * renders and round-trips immediately.
 *
 * The heading text is TEXT. It used to be interpolated raw into both the
 * attribute and the link body, so a heading such as "Use <b> tags" inserted
 * formatting — or an <img> — instead of its own words.
 */
export function headingLinkHtml(anchor: string): string {
  const a = escapeAttr(anchor);
  return `<a data-doc-link="" data-anchor="${a}" class="wiki-link" href="#">${a}</a>`;
}
