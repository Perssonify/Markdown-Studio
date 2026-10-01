/**
 * Callout — GitHub-style admonition block (`> [!NOTE]` … `> [!CAUTION]`).
 *
 * Canonical PM JSON form:
 *   { type: "callout", attrs: { type: "note" }, content: [ …block+ ] }
 *
 * Round-trip:
 *   markdown  ──build-marked blockquote renderer──▶ <div data-type="callout" data-callout="note">…</div>
 *   HTML      ──turndown `callout` rule──▶ > [!NOTE]\n> …
 *
 * The body is editable rich content (`block+`). The type label/icon is drawn by
 * CSS (`::before`, keyed on `data-callout`) so it never enters the serialized
 * content and can't pollute the turndown round-trip.
 */

import { Node, mergeAttributes } from "@tiptap/core";

export const CALLOUT_TYPES = ["note", "tip", "important", "warning", "caution"] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      type: {
        default: "note",
        parseHTML: (el: HTMLElement) => {
          const t = (el.getAttribute("data-callout") || "note").toLowerCase();
          return (CALLOUT_TYPES as readonly string[]).includes(t) ? t : "note";
        },
        renderHTML: (attrs: Record<string, unknown>) => ({
          "data-callout": String(attrs["type"] ?? "note"),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "callout" }), 0];
  },
});
