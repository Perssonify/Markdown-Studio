import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";

/**
 * TipTap's table cells read a column width from the table's `<colgroup>` with
 * `table.querySelectorAll('colgroup > col')` — once per cell, whenever a cell
 * carries no `colwidth` attribute, which is every cell markdown produces. In
 * Chromium that query costs time in proportion to the whole DOCUMENT being
 * parsed, not the table (measured: 2 µs a cell in a document of tables, 43 µs
 * with 20 000 paragraphs beside them), so parsing a large document with tables
 * was quadratic: 43 of the 29 seconds a markdown keystroke took at 1.6 MB
 * (A083). The same answer, read from a live `getElementsByTagName` collection
 * kept per table: it stays correct as the DOM changes, and its length is
 * cached by the browser, so a table with no `<col>` costs nothing per cell.
 */
const liveCols = new WeakMap<Element, HTMLCollectionOf<Element>>();

/** `parseColwidth` from @tiptap/extension-table, without the per-cell query. */
export function parseColwidth(element: HTMLElement): number[] | null {
  const colwidth = element.getAttribute("colwidth");
  if (colwidth) return colwidth.split(",").map((width) => parseInt(width, 10));
  const row = element.parentElement;
  const table = element.closest("table");
  if (!row || !table) return null;
  let cols = liveCols.get(table);
  if (!cols) {
    cols = table.getElementsByTagName("col");
    liveCols.set(table, cols);
  }
  if (!cols.length) return null;
  // `colgroup > col` within the table, in document order.
  const index = Array.prototype.indexOf.call(row.children, element);
  let seen = 0;
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i]!;
    if (col.parentElement?.localName !== "colgroup") continue;
    if (seen++ === index) {
      const width = col.getAttribute("width");
      return width ? [parseInt(width, 10)] : null;
    }
  }
  return null;
}

type Attrs = Record<string, Record<string, unknown>>;

/** TableCell and TableHeader with that parser — used by BOTH schemas (TiptapPane, SERIALIZE_EXTENSIONS). */
export const TableCellFast = TableCell.extend({
  addAttributes() {
    const parent = (this.parent?.() ?? {}) as Attrs;
    return { ...parent, colwidth: { ...parent["colwidth"], parseHTML: parseColwidth } };
  },
});

export const TableHeaderFast = TableHeader.extend({
  addAttributes() {
    const parent = (this.parent?.() ?? {}) as Attrs;
    return { ...parent, colwidth: { ...parent["colwidth"], parseHTML: parseColwidth } };
  },
});
