import { generateHTML, getSchema } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { Color } from "@tiptap/extension-color";
import { FontFamily } from "@tiptap/extension-font-family";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { WikiLink as Link } from "../extensions/WikiLink";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Underline } from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { BackgroundColor } from "../extensions/BackgroundColor";
import { EmojiNode } from "../extensions/EmojiNode";
import { FrontmatterBlock } from "../extensions/FrontmatterBlock";
import { Callout } from "../extensions/Callout";
import { Details, Summary } from "../extensions/Details";
import { MathBlock, MathInline } from "../extensions/MathNodes";
import { SizedImage } from "../extensions/SizedImage";
import { TableCellAlign } from "../extensions/TableCellAlign";
import { ThemeImage } from "../extensions/ThemeImage";

/**
 * Headless serialization of canonical ProseMirror JSON → HTML, mirroring the
 * schema used by TiptapPane (base codeBlock instead of the React node view;
 * no SearchHighlight plugin). Used for bulk export (e.g. folder → zip) where no
 * live editor instance is available. Exported so the converter round-trip
 * suite parses through exactly this schema.
 */
export const SERIALIZE_EXTENSIONS = [
  StarterKit.configure({ link: false, underline: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Callout,
  Details,
  Summary,
  MathInline,
  MathBlock,
  EmojiNode,
  FrontmatterBlock,
  Underline,
  TextStyle,
  Color,
  BackgroundColor,
  FontFamily,
  Subscript,
  Superscript,
  // MUST mirror the live TiptapPane schema, or headless export corrupts/throws:
  // WikiLink (not stock Link) preserves data-doc-link/data-anchor so [[wiki]]
  // round-trips; ThemeImage is a distinct node (<picture>) whose absence made
  // generateHTML THROW on any doc with a theme image; SizedImage keeps width/
  // height. See serialize-doc.test.js round-trip cases.
  Link.configure({ openOnClick: false, HTMLAttributes: { class: "perssonify-link" } }),
  ThemeImage,
  SizedImage,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Table,
  TableRow,
  TableCell,
  TableHeader,
  TableCellAlign,
];

export function canonicalToHtml(canonical: unknown): string {
  return generateHTML(canonical as any, SERIALIZE_EXTENSIONS as any);
}

let _headlessSchema: Schema | null = null;
/**
 * The editor schema WITHOUT an editor — for converting imported HTML to
 * canonical when no editor is mounted (an empty library). Mirrors the live
 * schema by the same invariant as SERIALIZE_EXTENSIONS; prefer the live
 * editor's `schema` whenever one exists.
 */
export function headlessSchema(): Schema {
  return (_headlessSchema ??= getSchema(SERIALIZE_EXTENSIONS as any));
}

/**
 * Convert canonical PM JSON to Markdown using the provided HTML→MD converter
 * (from the markdown engine). Returns null if serialization fails so callers
 * can fall back (e.g. to the raw JSON).
 */
export function canonicalToMarkdown(
  canonical: unknown,
  htmlToMd: (html: string) => string
): string | null {
  try {
    return htmlToMd(canonicalToHtml(canonical));
  } catch {
    return null;
  }
}
