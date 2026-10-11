import "fake-indexeddb/auto";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assetStore, sha256Hex } from "../store/assets/asset-store";
import { assetRef, bytesToDataUrl, collectImageSrcs } from "../store/assets/asset-refs";
import { ingest } from "../store/importExport/ingest";
import { useImportPipeline } from "../editor/useImportPipeline";
import { exportAsDocx } from "../store/importExport/docx-export";
import { convertDocxToHtml } from "../store/importExport/docx-import";

/**
 * Every way an image arrives through IMPORT ends as a reference to a stored
 * asset (A086): a file or archive import (importItems), the host bridge's
 * create-and-open path (activateAndCapture), and a Word document, whose
 * pictures mammoth inlines as base64.
 */

let n = 0;
beforeEach(() => assetStore._resetForTests({ useIndexedDB: true, dbName: `assets-paths-${++n}` }));

function png(seed = 1, size = 5000) {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0, 0, 4]);
  for (let i = 24; i < size; i++) b[i] = (seed * 71 + i * 5) & 0xff;
  return b;
}

/** The store's createDoc, minus the engine: ingest + the ingest HTML. */
function createDoc(raw, format, source) {
  const r = ingest(raw, format, source, { mdToHtml: (md) => md });
  r.doc._ingestHtml = r.html ?? "";
  return r.doc;
}

function pipeline(overrides = {}) {
  const saved = [];
  const { result } = renderHook(() => useImportPipeline({
    tiptapRef: { current: null },
    engine: null,
    createDoc,
    finalizeDoc: vi.fn(async (doc) => { saved.push(doc); return doc; }),
    saveNewDoc: vi.fn(async (doc) => { saved.push(structuredClone(doc)); }),
    prepareToLeaveActiveDoc: vi.fn(async () => {}),
    hydrateEditorWithDoc: vi.fn(),
    handleSwitchDoc: vi.fn(async () => {}),
    toast: { show: vi.fn() },
    setShowUrlImport: vi.fn(),
    setImportUrlSeed: vi.fn(),
    ...overrides,
  }));
  return { api: result.current, saved };
}

describe("imports persist references, not base64", () => {
  it("importItems: an HTML file's data: image is stored before the record is written", async () => {
    const url = bytesToDataUrl(png(1), "image/png");
    const { api, saved } = pipeline();
    const r = await api.importItems([{ raw: `<p>hi <img src="${url}" alt="x"></p>`, format: "html", folderPath: [] }]);
    expect(r.importedCount).toBe(1);
    expect(collectImageSrcs(saved[0].canonical)).toEqual([assetRef(await sha256Hex(png(1)))]);
    expect(JSON.stringify(saved[0])).not.toContain("base64,");
  });

  it("importItems: a backup's carried assets are restored and its references resolve", async () => {
    const bytes = png(2);
    const hash = await sha256Hex(bytes);
    const envelope = JSON.stringify({
      _format: "perssonify-document", id: "d9", title: "Restored",
      canonical: { type: "doc", content: [{ type: "paragraph", content: [{ type: "image", attrs: { src: assetRef(hash) } }] }] },
    });
    const { api, saved } = pipeline();
    await api.importItems([{ raw: envelope, format: "pmjson", folderPath: [] }], {
      assets: [{ hash, mime: "image/png", bytes }],
    });
    expect(collectImageSrcs(saved[0].canonical)).toEqual([assetRef(hash)]);
    expect(await assetStore.get(hash)).not.toBeNull();
  });

  it("activateAndCapture (host addDocuments / importContent, Cards capture) stores before persisting", async () => {
    const url = bytesToDataUrl(png(3), "image/png");
    const { api, saved } = pipeline({ });
    await api.activateAndCapture(createDoc(`<p><img src="${url}"></p>`, "html", "api"));
    expect(collectImageSrcs(saved[0].canonical)).toEqual([assetRef(await sha256Hex(png(3)))]);
  });

  it("a Word document's pictures (inlined by mammoth) become stored assets", async () => {
    // Build a real .docx with a picture in it, then import it.
    let docxBlob = null;
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = (b) => { docxBlob = b; return "blob:docx"; };
    try {
      await exportAsDocx("With a picture", `Text\n\n![pic](${bytesToDataUrl(png(4), "image/png")})\n`);
    } finally {
      URL.createObjectURL = realCreate;
    }
    const { html } = await convertDocxToHtml(docxBlob);
    expect(html).toMatch(/<img [^>]*src="data:image\/png;base64,/);
    const { api, saved } = pipeline();
    await api.importItems([{ raw: html, format: "html", folderPath: [] }]);
    const srcs = collectImageSrcs(saved[0].canonical);
    expect(srcs).toHaveLength(1);
    expect(srcs[0]).toMatch(/^pf-asset:[0-9a-f]{64}$/);
    expect(JSON.stringify(saved[0])).not.toContain("base64,");
    // Builds a .docx and reads it back through mammoth, both loaded cold: on a
    // loaded full-suite run that exceeded the 5 s default.
  }, 30000);
});
