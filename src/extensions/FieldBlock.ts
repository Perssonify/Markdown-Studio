/**
 * FieldBlock — custom Tiptap node for structured key-value data.
 *
 * Canonical PM JSON form:
 * {
 * type: "fieldBlock",
 * attrs: {
 * fields: [{ key: "status", value: "in-progress", type: "text" }, ...],
 * schemaId: null  // optional reference to an external field schema
 * }
 * }
 *
 * Markdown serialization (:::fields fenced block):
 * :::fields
 * status: in-progress
 * priority: high
 * :::
 *
 * HTML rendering: a styled card with editable key-value pairs.
 */

import { Node, mergeAttributes } from "@tiptap/core";

export interface Field {
  key: string;
  value: string;
  type: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fieldBlock: {
      /**
       * Insert a field block with optional initial fields.
       * @param fields Array of initial fields to populate the block.
       */
      insertFieldBlock: (fields?: Field[]) => ReturnType;
      /**
       * Update the currently selected field block's fields.
       * @param fields Array of updated fields.
       */
      updateFieldBlock: (fields: Field[]) => ReturnType;
    };
  }
}

/**
 * Escape HTML entities to prevent XSS.
 * @param s String to escape
 */
function esc(s: string | null | undefined): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Guess the data type of a field value.
 * @param value The field value string
 */
function guessFieldType(value: string): string {
  if (!value) return "text";
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return "date";
  if (/^-?\d+(\.\d+)?$/.test(value)) return "number";
  if (/^(true|false|yes|no)$/i.test(value)) return "boolean";
  return "text";
}

/**
 * Parse a :::fields block from markdown into field data.
 * @param text The inner text of the fields block
 */
export function parseFieldBlock(text: string): Field[] {
  const lines = text.trim().split("\n");
  const fields: Field[] = [];
  
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    
    if (key) {
      fields.push({ key, value, type: guessFieldType(value) });
    }
  }
  return fields;
}

/**
 * Serialize field data to :::fields markdown format.
 * @param fields The array of fields to serialize
 */
export function serializeFieldBlock(fields?: Field[]): string {
  if (!fields?.length) return ":::fields\n:::";
  const lines = fields.map(f => `${f.key}: ${f.value || ""}`);
  return ":::fields\n" + lines.join("\n") + "\n:::";
}

export const FieldBlock = Node.create({
  name: "fieldBlock",
  group: "block",
  atom: true, // Treated as a single unit, not editable inline
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      fields: {
        default: [],
        parseHTML: (el: HTMLElement) => {
          try {
            const data = el.getAttribute("data-fields");
            return data ? JSON.parse(data) : [];
          } catch {
            return [];
          }
        },
        renderHTML: (attrs: Record<string, unknown>) => ({
          "data-fields": JSON.stringify(attrs["fields"] || []),
        }),
      },
      schemaId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-schema-id") || null,
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs["schemaId"] ? { "data-schema-id": attrs["schemaId"] } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="field-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const fieldsAttr = HTMLAttributes["data-fields"];
    let parsed: Field[] = [];
    
    try { 
      parsed = typeof fieldsAttr === "string" 
        ? JSON.parse(fieldsAttr) 
        : (fieldsAttr || []); 
    } catch {}

    // Utilize Shadcn-compatible CSS variables and utility classes
    const containerClasses = "field-block my-4 rounded-lg border border-border bg-muted/50 p-4 text-sm";
    const headerClasses = "mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";
    const rowClasses = "flex gap-2 py-0.5 text-sm";
    const keyClasses = "min-w-[80px] shrink-0 font-medium text-primary";
    const valueClasses = "text-foreground";

    return [
      "div", 
      mergeAttributes(HTMLAttributes, {
        "data-type": "field-block",
        "class": containerClasses,
      }), 
      ["div", { class: headerClasses }, "Fields"],
      ...parsed.map(f => [
        "div", { class: rowClasses },
        ["span", { class: keyClasses }, esc(f.key) + ":"],
        ["span", { class: valueClasses }, esc(f.value || "")],
      ]),
    ];
  },

  addCommands() {
    return {
      insertFieldBlock: (fields: Field[] = []) => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs: { fields },
        });
      },
      updateFieldBlock: (fields: Field[]) => ({ tr, state }) => {
        const { selection } = state;
        const node = state.doc.nodeAt(selection.from);
        
        if (node?.type.name === this.name) {
          tr.setNodeMarkup(selection.from, undefined, { ...node.attrs, fields });
          return true;
        }
        return false;
      },
    };
  },
});