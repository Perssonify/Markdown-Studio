import { Extension } from "@tiptap/core";
import { nanoid } from "nanoid";
import { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState, Transaction } from "prosemirror-state";

/**
 * Generate a short, unique block ID.
 * @returns {string} A randomly generated block ID.
 */
export function generateBlockId(): string {
  return nanoid(32);
}

/**
 * BlockId extension — adds blockId attribute to specific block-level nodes.
 */
export const BlockId = Extension.create({
  name: "blockId",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading", "listItem", "blockquote", "codeBlock", "fieldBlock", "transclusionBlock"],
        attributes: {
          blockId: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-block-id") || null,
            renderHTML: (attrs: Record<string, any>) => attrs["blockId"] ? { "data-block-id": attrs["blockId"] } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      /**
       * Set a block ID on the currently selected block node.
       * @param {string} [blockId] - Optional ID to set. Generates one if not provided.
       */
      setBlockId: (blockId?: string) => ({ tr, state }: { tr: Transaction; state: EditorState }) => {
        const { from } = state.selection;
        const resolved = state.doc.resolve(from);
        
        // Walk up to find the nearest block node
        for (let depth = resolved.depth; depth > 0; depth--) {
          const node = resolved.node(depth);
          const pos = resolved.before(depth);
          
          if (
            node.type.spec.group?.includes("block") || 
            ["paragraph", "heading", "listItem", "blockquote", "codeBlock"].includes(node.type.name)
          ) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: blockId || generateBlockId() });
            return true;
          }
        }
        return false;
      },

      /**
       * Remove the block ID from the currently selected block node.
       */
      removeBlockId: () => ({ tr, state }: { tr: Transaction; state: EditorState }) => {
        const { from } = state.selection;
        const resolved = state.doc.resolve(from);
        
        for (let depth = resolved.depth; depth > 0; depth--) {
          const node = resolved.node(depth);
          const pos = resolved.before(depth);
          
          if (node.attrs?.["blockId"]) {
            const newAttrs = { ...node.attrs };
            delete newAttrs["blockId"];
            // setNodeMarkup doesn't automatically clear deleted attrs in some PM versions,
            // explicitly setting to null helps ensure removal
            newAttrs["blockId"] = null;
            tr.setNodeMarkup(pos, undefined, newAttrs);
            return true;
          }
        }
        return false;
      },
    };
  },
});

/**
 * Scan markdown for ^block-id patterns and strip them.
 * * @param {string} md - The markdown content to process
 * @returns {{ cleaned: string, ids: Map<number, string> }} Object containing the cleaned markdown and a map of line indices to IDs
 */
export function extractBlockIds(md: string): { cleaned: string; ids: Map<number, string> } {
  const ids = new Map<number, string>(); // lineIndex → blockId
  const lines = md.split("\n");
  
  const cleaned = lines.map((line, i) => {
    const match = line.match(/\s+\^([a-z0-9]{4,12})\s*$/);
    if (match) {
      ids.set(i, match[1]!);
      return line.slice(0, match.index);
    }
    return line;
  });
  
  return { cleaned: cleaned.join("\n"), ids };
}

interface ProseMirrorJSONNode {
  type: string;
  attrs?: Record<string, any>;
  content?: ProseMirrorJSONNode[];
  text?: string;
  [key: string]: any;
}

interface CanonicalDocument {
  content?: ProseMirrorJSONNode[];
  [key: string]: any;
}

/**
 * Inject ^block-id patterns into markdown for blocks that have IDs.
 * Used during canonical → markdown serialization.
 * * @param {string} md - The target markdown string
 * @param {CanonicalDocument} canonical - The canonical document containing block IDs
 * @returns {string} The markdown string with injected block IDs
 */
export function injectBlockIds(md: string, canonical: CanonicalDocument): string {
  if (!canonical?.content) return md;

  // Collect all block IDs from canonical
  const blockIds: Array<{ text: string; id: string }> = [];
  
  for (const node of canonical.content) {
    if (node.attrs?.["blockId"]) {
      // Find the text representation of this block
      const text = extractNodeText(node as unknown as ProseMirrorNode).trim();
      if (text) {
        blockIds.push({ text: text.slice(0, 60), id: node.attrs["blockId"]! });
      }
    }
  }

  if (blockIds.length === 0) return md;

  // Try to match block texts to markdown lines and append ^id
  let result = md;
  for (const { text, id } of blockIds) {
    // Escape regex special characters
    const searchText = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(${searchText}[^\\n]*)$`, "m");
    const match = re.exec(result);
    
    if (match && !match[1]?.includes("^" + id)) {
      result = result.replace(re, `$1 ^${id}`);
    }
  }

  return result;
}

/**
 * Assign block IDs to all blocks in a canonical document that don't have one.
 * Does NOT mutate the original object.
 * * @param {CanonicalDocument} canonical - The document to process
 * @returns {CanonicalDocument} A new document with block IDs assigned
 */
export function assignBlockIds(canonical: CanonicalDocument): CanonicalDocument {
  if (!canonical?.content) return canonical;
  
  return {
    ...canonical,
    content: canonical.content.map(node => {
      if (!node.attrs?.["blockId"] && isBlockNode(node as ProseMirrorJSONNode)) {
        return { 
          ...node, 
          attrs: { 
            ...(node.attrs || {}), 
            blockId: generateBlockId() 
          } 
        };
      }
      return node;
    }),
  };
}

/**
 * Helper to determine if a node should receive a block ID.
 */
function isBlockNode(node: ProseMirrorJSONNode | ProseMirrorNode): boolean {
  return ["paragraph", "heading", "listItem", "blockquote", "codeBlock"].includes(node.type as string);
}

/**
 * Helper to extract text content recursively from a node.
 */
function extractNodeText(node: ProseMirrorJSONNode | ProseMirrorNode | null | undefined): string {
  if (!node) return "";
  if (node.type === "text") return (node as any).text || "";
  if (!node.content) return "";
  
  // Handle both array of JSON nodes and ProseMirror Fragment
  if (Array.isArray(node.content)) {
    return node.content.map(child => extractNodeText(child as any)).join("");
  }
  
  // For actual ProseMirror nodes with a Fragment
  let text = "";
  (node as ProseMirrorNode).content.forEach(child => {
    text += extractNodeText(child as unknown as ProseMirrorJSONNode);
  });
  
  return text;
}

// Add TypeScript declarations for Tiptap core commands to prevent type errors
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockId: {
      setBlockId: (blockId?: string) => ReturnType;
      removeBlockId: () => ReturnType;
    }
  }
}