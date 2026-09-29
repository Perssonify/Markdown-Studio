import { Extension } from "@tiptap/core";
import { sanitizeTextAlign } from "../engine/css-safety";

/**
 * Column alignment for table cells — the `:--` / `:-:` / `--:` of a GFM
 * delimiter row. marked writes it as `align="…"` on every cell of the column,
 * but the stock TableCell/TableHeader nodes have no attribute to hold it, so
 * every projection through the rich pane reset each column to `---`.
 *
 * Rendered as an inline `text-align` (styles.css pins `.ProseMirror td` to
 * `text-align: left`, which an `align` attribute cannot beat); parsed from
 * either spelling. The turndown `gfmTable` rule reads it back off the header
 * row. MUST be registered in BOTH TiptapPane and serialize-doc's
 * SERIALIZE_EXTENSIONS, like every other schema change.
 */
export const TableCellAlign = Extension.create({
  name: "tableCellAlign",

  addGlobalAttributes() {
    return [
      {
        types: ["tableCell", "tableHeader"],
        attributes: {
          align: {
            default: null,
            parseHTML: (el: HTMLElement) =>
              sanitizeTextAlign(el.getAttribute("align") || el.style?.textAlign) ?? null,
            renderHTML: (attrs: Record<string, unknown>) => {
              const align = sanitizeTextAlign(attrs["align"]);
              return align ? { style: `text-align: ${align}` } : {};
            },
          },
        },
      },
    ];
  },
});
