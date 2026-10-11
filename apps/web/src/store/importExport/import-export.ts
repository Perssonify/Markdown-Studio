/**
 * Import/Export utilities for the document store.
 *
 * Import: .md, .txt, .html, .json files → ingest pipeline → document
 * Export: document → .md, .html, .json download
 * Drag-and-drop: files dropped on sidebar → import
 */

import { ingest, type IngestResult } from "./ingest";
import { computeFidelity, type FidelityReport } from "../documents/fidelity";
import type { DocumentRecord } from "../documents/document";
import { APP_NAME } from "@/constants";
import { CURRENT_SCHEMA_VERSION } from "../documents/schema-version";
import { withPortableBreaks } from "@/engine/portable-breaks";

// --- Types ---

export type ImportFormat = "markdown" | "html" | "pmjson" | "text";

export interface ImportFileOpts {
  mdToHtml?: (md: string) => string;
}

export interface ExportMarkdownOpts {
  htmlToMd?: (html: string) => string;
  htmlToCleanMd?: (html: string) => string;
  getHtml?: () => string;
  syncMode?: "clean" | "styled";
}

export interface ExportHtmlOpts {
  getHtml?: () => string;
}

export interface ImportedImage {
  src: string;
  alt: string;
  title: string;
}

/**
 * Shared element styling for generated documents (HTML export and PDF/print).
 * Keeps the two exporters visually consistent from a single source.
 */
export const EXPORT_CONTENT_CSS = `    h1, h2, h3 { margin-top: 1.5em; }
    /* A6. overflow-x:auto is meaningless on paper — there is nothing to scroll,
       so an over-wide line is simply clipped off the page; exported HTML has the
       same problem in a narrow window. Long unbroken strings (a URL, a hash, a
       base64 fragment) need somewhere to break. NOTE: no backticks in this
       comment — it lives inside a template literal. */
    body { overflow-wrap: anywhere; }
    pre { background: #f4f4f4; padding: 1em; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
    code { background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 3px solid #f59e0b; margin: 1em 0; padding: 0.5em 1em; color: #555; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; table-layout: fixed; }
    th, td { border: 1px solid #ddd; padding: 0.5em; text-align: left; overflow-wrap: anywhere; }
    th { background: #f9f9f9; }
    img { max-width: 100%; height: auto; }
    hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }`;

// --- Import ---

/**
 * Detect format from file extension and MIME type.
 */
function detectFormat(file: File): ImportFormat {
  const name = file.name.toLowerCase();
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "markdown";
  if (name.endsWith(".html") || name.endsWith(".htm")) return "html";
  if (name.endsWith(".json")) return "pmjson";
  if (name.endsWith(".txt")) return "text";
  if (file.type.startsWith("text/html")) return "html";
  if (file.type.startsWith("text/markdown")) return "markdown";
  if (file.type === "application/json") return "pmjson";
  return "text";
}

/**
 * Read a File object as text.
 */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsText(file);
  });
}

/**
 * Read a File object as a data URL (for images).
 */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/**
 * Read file content and detect format for use with createDoc.
 */
export async function getFileContentAndFormat(
  file: File
): Promise<{ raw: string; format: ImportFormat }> {
  const raw = await readFileAsText(file);
  const format = detectFormat(file);
  return { raw, format };
}

/**
 * Import a single file into the document store.
 */
export async function importFile(
  file: File,
  opts: ImportFileOpts = {}
): Promise<IngestResult> {
  const format = detectFormat(file);
  const text = await readFileAsText(file);

  const result = ingest(text, format, "file-import", {
    mdToHtml: opts.mdToHtml,
  });

  if (result.doc.title === "Untitled" || !result.doc.title) {
    // A heading the file already has names it — the title the app derives
    // once the content is converted — and the file name stands in otherwise.
    // It used to be the file name always, so `# Real title` in notes.md came
    // back titled "notes" until the host completed the import.
    result.doc.title = headingTitle(result.html) ?? file.name.replace(/\.[^.]+$/, "");
  }

  return result;
}

/** The text of converted HTML's first top-level heading, as
 *  `deriveTitleFromCanonical` would take it; null without one. Parsed inert. */
function headingTitle(html: string | null): string | null {
  if (!html || typeof DOMParser === "undefined") return null;
  const body = new DOMParser().parseFromString(html, "text/html").body;
  for (const el of Array.from(body.children)) {
    if (/^H[1-6]$/.test(el.tagName)) return el.textContent?.trim() || null;
  }
  return null;
}

/**
 * Import multiple files.
 */
export async function importFiles(
  files: FileList | File[],
  opts: ImportFileOpts = {}
): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  const fileArray = Array.from(files);
  for (const file of fileArray) {
    if (file.type.startsWith("image/")) continue;
    if (file.size > 5_000_000) {
      console.warn(
        `[Import] Skipping ${file.name}: too large (${file.size} bytes)`
      );
      continue;
    }
    try {
      const result = await importFile(file, opts);
      results.push(result);
    } catch (e) {
      console.warn(`[Import] Failed to import ${file.name}:`, e);
    }
  }
  return results;
}

/**
 * Import an image file as a data URL for embedding.
 */
export async function importImage(file: File): Promise<ImportedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Not an image file");
  }
  const dataUrl = await readFileAsDataURL(file);
  return {
    src: dataUrl,
    alt: file.name.replace(/\.[^.]+$/, ""),
    title: file.name,
  };
}

// --- Export ---

/**
 * Trigger a browser download.
 */
/** Local timestamp `YYYYMMDD-HHMMSSmmm` for version-stamping export filenames. */
export function exportTimestamp(d: Date = new Date()): string {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // 1000ms gives browsers enough time to begin the download before the
  // object URL is revoked (100ms is too short on slow/mobile devices).
  setTimeout(() => {
    URL.revokeObjectURL(url);
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 1000);
}

/**
 * The markdown of a `.md` file that leaves the app: the converter's output with
 * hard breaks written `\` + newline, which renderers without the app's
 * `breaks: true` dialect still draw (A051, engine/portable-breaks.ts).
 */
export function exportMarkdown(html: string, convert: (html: string) => string): string {
  return withPortableBreaks(() => convert(html));
}

/**
 * Export document as Markdown.
 */
export function exportAsMarkdown(
  doc: DocumentRecord,
  opts: ExportMarkdownOpts = {}
): { filename: string; fidelityReport: FidelityReport } {
  const { htmlToMd, htmlToCleanMd, getHtml, syncMode = "clean" } = opts;

  let md: string;
  // The converter first: `markdownCache` would be the editor's own dialect,
  // without portable hard breaks (and storage never keeps one).
  if (getHtml && (htmlToMd || htmlToCleanMd)) {
    const convert =
      syncMode === "styled"
        ? htmlToMd ?? htmlToCleanMd
        : htmlToCleanMd ?? htmlToMd;
    md = exportMarkdown(getHtml(), convert!);
  } else if (doc.markdownCache) {
    md = doc.markdownCache;
  } else {
    throw new Error("Markdown converter not available — please try again.");
  }

  const fidelityReport = computeFidelity(doc.canonical, syncMode);
  const filename = sanitizeFilename(doc.title) + ".md";
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  downloadBlob(blob, filename);

  return { filename, fidelityReport };
}

/**
 * Export document as HTML.
 */
export function exportAsHtml(
  doc: DocumentRecord,
  opts: ExportHtmlOpts = {}
): { filename: string } {
  const { getHtml } = opts;

  if (!getHtml) {
    throw new Error("HTML content not available — please try again.");
  }
  const body = getHtml();
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(doc.title)}</title>
  <meta name="generator" content="${APP_NAME}">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #1a1a2e; }
${EXPORT_CONTENT_CSS}
  </style>
</head>
<body>
${body}
</body>
</html>`;

  const filename = sanitizeFilename(doc.title) + ".html";
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  downloadBlob(blob, filename);

  return { filename };
}

/**
 * The `perssonify-document` envelope a document is exported (and backed up)
 * as — ONE definition for the single-file JSON export and the backup ZIP.
 *
 * The origin record is exported WITHOUT its payloads. `origin.raw` is the
 * whole input exactly as it was first imported, and `alternates` the
 * clipboard copies of a paste (HTML, plain text, RTF): text the user may have
 * DELETED since, travelling inside a file they share. Nothing reads either on
 * import; the provenance (format, source, time) stays.
 */
/** The ingest report without `preIngestHtml` — up to 50 KB of the HTML exactly
 *  as first imported, the same kind of payload as `origin.raw`. */
function withoutIngestPayload(report: unknown): unknown {
  if (!report || typeof report !== "object" || !("preIngestHtml" in report)) return report;
  return { ...(report as Record<string, unknown>), preIngestHtml: null };
}

export function toExportEnvelope(
  doc: DocumentRecord,
  title: string = doc.title,
  /** The images the document refers to, for a file that must stand on its own
   *  (the single-document JSON export, A086). A backup ZIP carries them as
   *  files instead and leaves this out. */
  assets?: Record<string, { mime: string; data: string }>
) {
  return {
    _format: "perssonify-document",
    _version: "1.1.0",
    // Read on import: an OLDER build opens content from a newer one read-only
    // instead of blank (see schema-version.ts).
    schemaVersion: Math.max(doc.schemaVersion ?? 0, CURRENT_SCHEMA_VERSION),
    id: doc.id,
    title,
    canonical: doc.canonical,
    origin: doc.origin ? { ...doc.origin, raw: null, alternates: null } : doc.origin,
    residuals: doc.residuals,
    ingestReport: withoutIngestPayload(doc.ingestReport),
    metadata: doc.metadata,
    tags: doc.tags,
    created: doc.created,
    updated: doc.updated,
    ...(assets && Object.keys(assets).length ? { assets } : {}),
  };
}

/**
 * Export document as canonical JSON (ProseMirror JSON + origin + residuals).
 * `opts.assets` embeds the images its `pf-asset:` references point at, so
 * importing the file anywhere restores them (A086).
 */
export function exportAsJson(
  doc: DocumentRecord,
  opts: { assets?: Record<string, { mime: string; data: string }> } = {}
): { filename: string } {
  const exported = toExportEnvelope(doc, doc.title, opts.assets);

  const filename = sanitizeFilename(doc.title) + ".json";
  const json = JSON.stringify(exported, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, filename);

  return { filename };
}

// --- Helpers ---

/** Turn an arbitrary title into a safe, lowercase download filename (no
 *  extension). Shared by all single-file exporters (md/html/json/docx). */
export function sanitizeFilename(str: string): string {
  return (str || "untitled")
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 100);
}

function escapeHtml(str: string): string {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
