/**
 * Client-side Markdown → Word (.docx) export.
 *
 * Tokenizes the document's Markdown with marked's lexer and maps the tokens to
 * docx.js elements, then packs to a Blob and downloads it — no backend, no
 * upload. The `docx` library is imported dynamically so it only loads when the
 * user actually exports (keeps it out of the main bundle).
 *
 * Coverage: headings, paragraphs, ordered/unordered (nested) lists, blockquotes,
 * fenced code, tables, horizontal rules, and inline bold/italic/strikethrough/
 * inline-code/links. Images given as `data:` URLs (PNG, JPEG, GIF, BMP — the
 * caller inlines stored assets first) are embedded as pictures; remote images
 * and other types, math and diagrams are emitted as their text.
 */

import { Marked, type Token, type Tokens } from "marked";
import { emStrongMaskFix } from "../engine/marked-emphasis-mask";
import { downloadBlob, sanitizeFilename } from "./import-export";
import { parseDataUrl } from "./asset-refs";

// Our own instance rather than marked's shared default: in the library build
// marked is the HOST's copy, and anything the host registered on the default
// instance would otherwise change what this exporter reads. Plain GFM, as the
// default instance is, plus the same emphasis correction the editor applies.
let docxMarked: Marked | null = null;
const lexMarkdown = (markdown: string): Token[] =>
  (docxMarked ??= new Marked({ tokenizer: emStrongMaskFix })).lexer(markdown);

// docx types are only referenced via the dynamic import; keep this module light.
type DocxModule = typeof import("docx");

// ─── Images (A086) ───────────────────────────────────────────────────────────
// A document's images reach this exporter as `data:` URLs (the caller inlines
// asset references first) and are embedded as real pictures. A remote image is
// NOT fetched — an export must not reach out to a third party — and stays its
// alt text, as every image used to.

const DOCX_TYPE: Record<string, "png" | "jpg" | "gif" | "bmp"> = {
  "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/bmp": "bmp",
};

/** Largest width an embedded picture is given (points of a Letter/A4 text column). */
const MAX_IMAGE_WIDTH = 600;

/** Natural pixel size from the file header, or null when it cannot be read. */
export function imageDimensions(bytes: Uint8Array, type: string): { width: number; height: number } | null {
  const u16be = (i: number) => (bytes[i]! << 8) | bytes[i + 1]!;
  const u32be = (i: number) => ((bytes[i]! << 24) >>> 0) + (bytes[i + 1]! << 16) + (bytes[i + 2]! << 8) + bytes[i + 3]!;
  const u16le = (i: number) => bytes[i]! | (bytes[i + 1]! << 8);
  const i32le = (i: number) => bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24);
  try {
    if (type === "png" && bytes.length >= 24) return { width: u32be(16), height: u32be(20) };
    if (type === "gif" && bytes.length >= 10) return { width: u16le(6), height: u16le(8) };
    if (type === "bmp" && bytes.length >= 26) return { width: Math.abs(i32le(18)), height: Math.abs(i32le(22)) };
    if (type === "jpg") {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const marker = bytes[i + 1]!;
        // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC), carry the size.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: u16be(i + 7), height: u16be(i + 5) };
        }
        i += 2 + u16be(i + 2);
      }
    }
  } catch { /* truncated header */ }
  return null;
}

/** An embedded picture for a `data:` source, or null (remote, unsupported type). */
function imageRun(
  D: DocxModule,
  src: string,
  alt: string,
  size: { width?: unknown; height?: unknown } = {}
): InstanceType<DocxModule["ImageRun"]> | null {
  if (!src.startsWith("data:")) return null;
  const parsed = parseDataUrl(src.replace(/#.*$/, ""));
  const type = parsed ? DOCX_TYPE[parsed.mime] : undefined;
  if (!parsed || !type) return null;
  const natural = imageDimensions(parsed.bytes, type) ?? { width: 400, height: 300 };
  const w = Number(size.width) > 0 ? Number(size.width) : natural.width;
  const h = Number(size.height) > 0 ? Number(size.height) : Math.round((w * natural.height) / Math.max(1, natural.width));
  const scale = w > MAX_IMAGE_WIDTH ? MAX_IMAGE_WIDTH / w : 1;
  return new D.ImageRun({
    type,
    data: parsed.bytes,
    transformation: { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) },
    altText: { name: alt || "Image", description: alt || undefined, title: alt || undefined },
  });
}

/** `src`/`alt`/`width`/`height` of an `<img …>` tag (a sized image serialises
 *  to one), or null when the HTML is not a lone image. */
function imgTagAttrs(html: string): Record<string, string> | null {
  const m = /^\s*(?:<picture\b[^>]*>[\s\S]*?)?<img\b([^>]*)\/?>(?:[\s\S]*?<\/picture>)?\s*$/i.exec(html);
  if (!m) return null;
  const attrs: Record<string, string> = {};
  for (const a of m[1]!.matchAll(/([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[a[1]!.toLowerCase()] = (a[2] ?? a[3] ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  }
  return attrs;
}

type InlineRun =
  | InstanceType<DocxModule["TextRun"]>
  | InstanceType<DocxModule["ExternalHyperlink"]>
  | InstanceType<DocxModule["ImageRun"]>;

/** Build docx TextRuns from marked inline tokens, carrying formatting inward. */
function inlineRuns(
  D: DocxModule,
  tokens: Token[] | undefined,
  fmt: { bold?: boolean; italics?: boolean; strike?: boolean; code?: boolean } = {}
): InlineRun[] {
  const { TextRun, ExternalHyperlink } = D;
  const runs: InlineRun[] = [];
  if (!tokens) return runs;
  for (const t of tokens) {
    switch (t.type) {
      case "text": {
        const tok = t as Tokens.Text;
        if (tok.tokens && tok.tokens.length) {
          runs.push(...inlineRuns(D, tok.tokens, fmt));
        } else {
          runs.push(new TextRun({ text: tok.text, ...fmt, font: fmt.code ? "Consolas" : undefined }));
        }
        break;
      }
      case "strong":
        runs.push(...inlineRuns(D, (t as Tokens.Strong).tokens, { ...fmt, bold: true }));
        break;
      case "em":
        runs.push(...inlineRuns(D, (t as Tokens.Em).tokens, { ...fmt, italics: true }));
        break;
      case "del":
        runs.push(...inlineRuns(D, (t as Tokens.Del).tokens, { ...fmt, strike: true }));
        break;
      case "codespan":
        runs.push(new TextRun({ text: (t as Tokens.Codespan).text, font: "Consolas", ...fmt }));
        break;
      case "br":
        runs.push(new TextRun({ break: 1 }));
        break;
      case "link": {
        const link = t as Tokens.Link;
        runs.push(
          new ExternalHyperlink({
            link: link.href,
            children: inlineRuns(D, link.tokens, { ...fmt }).filter(
              (r): r is InstanceType<DocxModule["TextRun"]> => r instanceof TextRun
            ),
          })
        );
        break;
      }
      case "image": {
        const img = t as Tokens.Image;
        const pic = imageRun(D, img.href, img.text);
        runs.push(pic ?? new TextRun({ text: img.text || img.href, italics: true }));
        break;
      }
      case "html": {
        // A sized image is written as an `<img …>` tag (the sizedImage rule).
        const attrs = imgTagAttrs((t as Tokens.HTML).raw ?? (t as Tokens.HTML).text ?? "");
        if (attrs) {
          const pic = attrs["src"] ? imageRun(D, attrs["src"], attrs["alt"] ?? "", attrs) : null;
          runs.push(pic ?? new TextRun({ text: attrs["alt"] || attrs["src"] || "", italics: true }));
          break;
        }
        const raw = (t as Tokens.HTML).text ?? (t as Tokens.HTML).raw;
        if (raw) runs.push(new TextRun({ text: raw, ...fmt }));
        break;
      }
      case "checkbox":
        // A task item's box has been a token since marked 17 — inside the
        // item's first paragraph when the list is loose. It carries no text.
        break;
      default: {
        const raw = (t as { raw?: string; text?: string }).text ?? (t as { raw?: string }).raw;
        if (raw) runs.push(new TextRun({ text: raw, ...fmt }));
      }
    }
  }
  return runs;
}

const HEADING_LEVELS = [
  "HEADING_1",
  "HEADING_2",
  "HEADING_3",
  "HEADING_4",
  "HEADING_5",
  "HEADING_6",
] as const;

/** Convert a list token (recursively, for nesting) into docx paragraphs. */
function listParagraphs(
  D: DocxModule,
  list: Tokens.List,
  level: number,
  out: InstanceType<DocxModule["Paragraph"]>[]
): void {
  const { Paragraph } = D;
  for (const item of list.items) {
    const inline = item.tokens.find((tk) => tk.type === "text" || tk.type === "paragraph") as
      | Tokens.Text
      | Tokens.Paragraph
      | undefined;
    out.push(
      new Paragraph({
        children: inlineRuns(D, inline?.tokens),
        ...(list.ordered
          ? { numbering: { reference: "md-ol", level } }
          : { bullet: { level } }),
      })
    );
    // Nested lists inside the item
    for (const child of item.tokens) {
      if (child.type === "list") listParagraphs(D, child as Tokens.List, level + 1, out);
    }
  }
}

/** Map top-level marked tokens to docx block elements. */
function blocksFromTokens(
  D: DocxModule,
  tokens: Token[]
): (InstanceType<DocxModule["Paragraph"]> | InstanceType<DocxModule["Table"]>)[] {
  const { Paragraph, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } = D;
  const blocks: (InstanceType<DocxModule["Paragraph"]> | InstanceType<DocxModule["Table"]>)[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case "heading": {
        const h = token as Tokens.Heading;
        const levelKey = HEADING_LEVELS[Math.min(Math.max(h.depth, 1), 6) - 1] ?? "HEADING_1";
        blocks.push(
          new Paragraph({
            children: inlineRuns(D, h.tokens),
            heading: HeadingLevel[levelKey],
          })
        );
        break;
      }
      case "paragraph":
        blocks.push(new Paragraph({ children: inlineRuns(D, (token as Tokens.Paragraph).tokens) }));
        break;
      case "list":
        listParagraphs(D, token as Tokens.List, 0, blocks as InstanceType<DocxModule["Paragraph"]>[]);
        break;
      case "blockquote": {
        const bq = token as Tokens.Blockquote;
        for (const inner of bq.tokens) {
          const innerTokens = (inner as Tokens.Paragraph).tokens;
          blocks.push(
            new Paragraph({
              children: inlineRuns(D, innerTokens ?? undefined) ,
              indent: { left: 480 },
              border: { left: { style: BorderStyle.SINGLE, size: 12, space: 12, color: "CCCCCC" } },
            })
          );
        }
        break;
      }
      case "code": {
        const code = token as Tokens.Code;
        for (const line of code.text.split("\n")) {
          blocks.push(
            new Paragraph({
              children: [new D.TextRun({ text: line || " ", font: "Consolas", size: 20 })],
              shading: { fill: "F4F4F4" },
            })
          );
        }
        break;
      }
      case "table": {
        const tbl = token as Tokens.Table;
        const rows: InstanceType<DocxModule["TableRow"]>[] = [];
        rows.push(
          new TableRow({
            tableHeader: true,
            children: tbl.header.map(
              (cell) =>
                new TableCell({
                  children: [new Paragraph({ children: inlineRuns(D, cell.tokens, { bold: true }) })],
                })
            ),
          })
        );
        for (const row of tbl.rows) {
          rows.push(
            new TableRow({
              children: row.map(
                (cell) =>
                  new TableCell({
                    children: [new Paragraph({ children: inlineRuns(D, cell.tokens) })],
                  })
              ),
            })
          );
        }
        blocks.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
        break;
      }
      case "hr":
        blocks.push(
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: "CCCCCC" } },
            children: [],
          })
        );
        break;
      case "space":
        break;
      case "html": {
        // An image on a line of its own (a sized image or a theme <picture>)
        // lexes as a BLOCK of HTML.
        const attrs = imgTagAttrs((token as Tokens.HTML).raw ?? "");
        const pic = attrs?.["src"] ? imageRun(D, attrs["src"], attrs["alt"] ?? "", attrs) : null;
        if (pic) { blocks.push(new Paragraph({ children: [pic] })); break; }
        if (attrs) {
          const alt = attrs["alt"] || attrs["src"] || "";
          if (alt) blocks.push(new Paragraph({ children: [new D.TextRun({ text: alt, italics: true })] }));
          break;
        }
        const raw = (token as { text?: string; raw?: string }).text ?? (token as { raw?: string }).raw;
        if (raw && raw.trim()) blocks.push(new Paragraph({ children: [new D.TextRun(raw)] }));
        break;
      }
      default: {
        const raw = (token as { text?: string; raw?: string }).text ?? (token as { raw?: string }).raw;
        if (raw && raw.trim()) blocks.push(new Paragraph({ children: [new D.TextRun(raw)] }));
      }
    }
  }
  return blocks;
}

/**
 * Export Markdown as a .docx file and trigger a download.
 * Returns the filename used.
 */
export async function exportAsDocx(title: string, markdown: string): Promise<string> {
  const D = await import("docx");
  const { Document, Packer, LevelFormat, AlignmentType } = D;

  const tokens = lexMarkdown(markdown ?? "");
  const children = blocksFromTokens(D, tokens);

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "md-ol",
          levels: [0, 1, 2, 3].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children: children.length ? children : [new D.Paragraph({ children: [] })] }],
  });

  const blob = await Packer.toBlob(doc);
  const filename = sanitizeFilename(title) + ".docx";
  downloadBlob(blob, filename);
  return filename;
}
