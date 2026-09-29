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
 * inline-code/links. Images, math, and diagrams are emitted as their source text
 * (same fidelity ceiling as the other text exports).
 */

import { Marked, type Token, type Tokens } from "marked";
import { emStrongMaskFix } from "../engine/marked-emphasis-mask";
import { downloadBlob, sanitizeFilename } from "./import-export";

// Our own instance rather than marked's shared default: in the library build
// marked is the HOST's copy, and anything the host registered on the default
// instance would otherwise change what this exporter reads. Plain GFM, as the
// default instance is, plus the same emphasis correction the editor applies.
let docxMarked: Marked | null = null;
const lexMarkdown = (markdown: string): Token[] =>
  (docxMarked ??= new Marked({ tokenizer: emStrongMaskFix })).lexer(markdown);

// docx types are only referenced via the dynamic import; keep this module light.
type DocxModule = typeof import("docx");

/** Build docx TextRuns from marked inline tokens, carrying formatting inward. */
function inlineRuns(
  D: DocxModule,
  tokens: Token[] | undefined,
  fmt: { bold?: boolean; italics?: boolean; strike?: boolean; code?: boolean } = {}
): (InstanceType<DocxModule["TextRun"]> | InstanceType<DocxModule["ExternalHyperlink"]>)[] {
  const { TextRun, ExternalHyperlink } = D;
  const runs: (InstanceType<DocxModule["TextRun"]> | InstanceType<DocxModule["ExternalHyperlink"]>)[] = [];
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
      case "image":
        runs.push(new TextRun({ text: (t as Tokens.Image).text || (t as Tokens.Image).href, italics: true }));
        break;
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
