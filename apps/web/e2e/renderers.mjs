// Shared by cases/csp.mjs and cases/pwa.mjs: a document that exercises every
// renderer that loads code or styles its own way, and the actions that pull in
// the remaining lazy chunks. A helper module, not a case — importing a case
// file would run it.

export const PROBE_MD = [
  "# Renderer probe",
  "",
  "Inline math $e^{i\\pi}+1=0$ here.",
  "",
  "$$",
  "\\int_0^1 x^2\\,dx",
  "$$",
  "",
  "```mermaid",
  "flowchart TD",
  "  A[Start] --> B{Choice}",
  "  B -->|yes| C[Done]",
  "```",
  "",
  // The editor lays diagrams out with dagre; a diagram may opt into ELK, a
  // separate 1.6 MB chunk loaded on first use (Mermaid 12's own default).
  "```mermaid",
  "---",
  "config:",
  "  layout: elk",
  "---",
  "flowchart LR",
  "  E1[ELK] --> E2[Layout]",
  "```",
  "",
  "```abc",
  "X:1",
  "T:Scale",
  "M:4/4",
  "L:1/4",
  "K:C",
  "CDEF|GABc|",
  "```",
  "",
  "```js",
  "const probe = 1;",
  "```",
  "",
  "![dot](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)",
].join("\n");

/** Paste markdown into the markdown pane (a real paste event, like surfaces.mjs). */
export async function pasteMarkdown(pg, text) {
  await pg.locator(".cm-content").first().click();
  await pg.keyboard.press("Control+End");
  await pg.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "\n\n" + t + "\n");
    document.querySelector(".cm-content").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

/** What the probe document drew in the rich pane. */
export const renderers = (pg) =>
  pg.evaluate(() => ({
    katex: document.querySelectorAll(".ProseMirror .katex").length,
    // The probe's OWN diagrams, by their labels: the starter document carries
    // a diagram of its own, so "some diagram drew" proves nothing about these.
    mermaid: [...document.querySelectorAll('.diagram-preview[data-diagram="mermaid"] svg')].some((s) => s.textContent.includes("Choice")),
    mermaidElk: [...document.querySelectorAll('.diagram-preview[data-diagram="mermaid"] svg')].some((s) => s.textContent.includes("Layout")),
    abc: !!document.querySelector('.diagram-preview[data-diagram="abc"] svg'),
    image: [...document.querySelectorAll(".ProseMirror img")].some((i) => i.src.startsWith("data:") && i.naturalWidth > 0),
    diagramErrors: [...document.querySelectorAll('.diagram-preview [role="alert"]')].map((e) => e.textContent),
  }));

export const allRendered = (r) => r.katex >= 2 && r.mermaid && r.mermaidElk && r.abc && r.image;

/** File ▸ Export ▸ Word (.docx); resolves with the download's suggested name, or null. */
export async function exportWord(pg) {
  const download = pg.waitForEvent("download", { timeout: 20000 }).catch(() => null);
  await pg.locator('button:has-text("File")').first().click();
  await pg.locator('[role="menuitem"]:has-text("Export")').first().click();
  await pg.locator('[role="menuitem"]:has-text("Word (.docx)")').first().click();
  const d = await download;
  return d ? d.suggestedFilename() : null;
}

/** Open Find, the map and Cards in turn; returns which of them rendered. */
export async function openLazySurfaces(pg, until) {
  const out = {};
  await pg.locator(".ProseMirror").first().click();
  await pg.keyboard.press("Control+f");
  out.find = await until(async () => (await pg.locator('[role="dialog"][aria-label="Find and replace"]').count()) > 0);
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(400);
  await pg.locator(".ProseMirror").first().click();
  await pg.keyboard.press("Control+Shift+G");
  out.map = await until(async () => (await pg.locator(".pf-node-dot").count()) > 0);
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(600);
  await pg.keyboard.press("Control+Shift+K");
  out.cards = await until(async () => (await pg.locator("[data-md-preview]").count()) > 0);
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(600);
  return out;
}
