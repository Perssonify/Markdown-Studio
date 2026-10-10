/**
 * DOCX import — converts a Word `.docx` file to HTML via `mammoth`, which the
 * existing ingest → turndown pipeline then turns into Markdown/canonical.
 *
 * `mammoth` is LAZY-imported (like `docx` in docx-export.ts and `@zip.js/zip.js`)
 * so it never enters the main bundle — it loads only when a user actually imports
 * a `.docx`. It is best-effort/lossy: headings, paragraphs, bold/italic, lists,
 * tables and embedded raster images (inlined as `data:` URIs, which survive
 * `sanitizeForIngest`) convert well; Word equations (OMML), text boxes, and
 * complex layout do not. Images are inlined as base64, so the resulting HTML can
 * be much larger than the source `.docx`.
 */

export interface DocxConversion {
  /** Converted HTML (feed to `ingest(html, "html", "file-import")`). */
  html: string;
  /** Non-fatal conversion warnings from mammoth (unrecognized styles, etc.). */
  messages: string[];
}

export async function convertDocxToHtml(file: File | Blob): Promise<DocxConversion> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  // Pass BOTH keys: mammoth's BROWSER build (Vite bundles this for the app) reads
  // `arrayBuffer`; its NODE build (loaded by tests) reads `buffer`, which its
  // openZip feeds to openArrayBuffer — so an ArrayBuffer works there too. Sending
  // both means the resolved build finds its key without a throw-and-retry.
  const result = (await mammoth.convertToHtml({ arrayBuffer, buffer: arrayBuffer } as never)) as {
    value?: string;
    messages?: unknown[];
  };
  return {
    html: result.value || "",
    messages: (result.messages || []).map((m: unknown) =>
      typeof m === "string" ? m : (m as { message?: string })?.message ?? String(m)
    ),
  };
}
