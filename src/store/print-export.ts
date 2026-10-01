import { EXPORT_CONTENT_CSS } from "./import-export";

/**
 * Render a document's rich HTML into a hidden iframe and open the browser's print
 * dialog (which offers "Save as PDF"). An iframe is used rather than a popup so
 * it isn't blocked by popup blockers. Fully client-side — no network. Fidelity
 * matches the HTML export (same content stylesheet; rendered math/diagrams follow
 * the same serialization path as the editor's getHTML()).
 *
 * The page declares no `lang` (A099), exactly like the HTML export: what is
 * printed is the DOCUMENT, whose language the app does not know. `lang="en"`
 * told screen readers, hyphenation and the PDF's metadata that every document
 * was English, and the interface language would be just as wrong for a French
 * note written in an English UI. Right-to-left blocks carry their own `dir`.
 */
export function printHtmlDocument(title: string, bodyHtml: string): void {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${esc(title)}</title>
<style>
  @page { margin: 2cm; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a2e; max-width: 100%; }
${EXPORT_CONTENT_CSS}
  h1, h2, h3, h4 { page-break-after: avoid; }
  pre { white-space: pre-wrap; page-break-inside: avoid; }
  table, figure, img { page-break-inside: avoid; }
</style></head>
<body>${bodyHtml}</body></html>`);
  doc.close();

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    // Delay removal so the print job can spool before the DOM vanishes.
    setTimeout(() => iframe.remove(), 1000);
  };

  const win = iframe.contentWindow;
  win?.addEventListener("afterprint", cleanup);
  // Layout pass before printing; fall back to cleanup if afterprint never fires.
  setTimeout(() => {
    try {
      win?.focus();
      win?.print();
    } catch {
      /* ignore */
    }
    setTimeout(cleanup, 60000);
  }, 300);
}
