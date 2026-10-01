/**
 * FrontmatterBlock — custom Tiptap node for a document's leading YAML front
 * matter (`---` … `---`).
 *
 * Canonical PM JSON form:
 *   { type: "frontmatter", attrs: { raw: "title: Hello\ntags: [a, b]" } }
 *
 * Round-trip:
 *   markdown  ──preprocessor──▶  <div data-type="frontmatter" data-frontmatter="<json>">
 *   HTML      ──turndown rule──▶ ---\n<raw>\n---
 *
 * The raw text is stored verbatim (JSON-encoded in the data attribute so newlines
 * survive) and rendered as a read-only card; edit it in the Markdown pane.
 */

import { Node, mergeAttributes } from "@tiptap/core";

function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Parse the raw YAML-ish body into key/value pairs for display (best-effort). */
export function parseFrontmatter(raw: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const line of (raw ?? "").split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) out.push({ key, value });
  }
  return out;
}

export const FrontmatterBlock = Node.create({
  name: "frontmatter",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  // Only meaningful at the very top; keep it as a normal block but discourage
  // multiple by treating it as an atom the user edits via the markdown pane.

  addAttributes() {
    return {
      raw: {
        default: "",
        parseHTML: (el: HTMLElement) => {
          try {
            const data = el.getAttribute("data-frontmatter");
            return data ? JSON.parse(data) : "";
          } catch {
            return "";
          }
        },
        renderHTML: (attrs: Record<string, unknown>) => ({
          "data-frontmatter": JSON.stringify(attrs["raw"] ?? ""),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="frontmatter"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const rawAttr = HTMLAttributes["data-frontmatter"];
    let raw: string;
    try {
      raw = typeof rawAttr === "string" ? JSON.parse(rawAttr) : String(rawAttr ?? "");
    } catch {
      raw = "";
    }
    const rows = parseFrontmatter(raw);

    const container =
      "frontmatter-block my-3 rounded-lg border border-dashed border-border bg-muted/40 p-3 text-sm";
    const header =
      "mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";

    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "frontmatter", class: container }),
      ["div", { class: header }, "Front matter"],
      rows.length
        ? [
            "div",
            { class: "flex flex-col gap-0.5" },
            ...rows.map((r) => [
              "div",
              { class: "flex gap-2 text-xs" },
              ["span", { class: "min-w-[90px] shrink-0 font-medium text-primary" }, esc(r.key) + ":"],
              ["span", { class: "text-foreground break-all" }, esc(r.value)],
            ]),
          ]
        : ["pre", { class: "whitespace-pre-wrap text-xs text-muted-foreground" }, esc(raw)],
    ];
  },
});
