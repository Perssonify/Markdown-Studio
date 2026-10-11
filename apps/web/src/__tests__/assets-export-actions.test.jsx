import "fake-indexeddb/auto";
import { renderHook } from "@testing-library/react";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assetStore } from "../store/assets/asset-store";
import { assetRef, bytesToDataUrl } from "../store/assets/asset-refs";
import { createDocument } from "../store/documents/document";
import { useDocumentStore } from "../store/documents/documentStore";
import { useFolderStore } from "../store/documents/folders";
import { exportActiveDocAsFile, exportActiveDocAsPdf, useExportActions } from "../editor/useExportActions";

/**
 * The export CALL SITES (A086): what a user downloads from the library row
 * menus, File ▸ Export and the backup contains the images, not references
 * that mean nothing outside this browser.
 */

let n = 0;
function png(seed = 1, size = 3000) {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47]);
  for (let i = 4; i < size; i++) b[i] = (seed * 41 + i) & 0xff;
  return b;
}
const docWith = (hash) => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Photo" }] },
    { type: "paragraph", content: [{ type: "image", attrs: { src: assetRef(hash), alt: "p" } }] },
  ],
});

let downloads;
let hash;
let record;
beforeEach(async () => {
  assetStore._resetForTests({ useIndexedDB: true, dbName: `assets-export-${++n}` });
  hash = await assetStore.put(png(1), "image/png");
  record = createDocument({ id: "doc-1", title: "Photo", canonical: docWith(hash) });
  downloads = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => { downloads.push(blob); return "blob:dl"; });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const storage = {
    get: async (id) => (id === record.id ? structuredClone(record) : null),
    list: async () => [{ id: record.id, title: record.title }],
    getMany: async (ids) => ids.map((id) => (id === record.id ? structuredClone(record) : null)),
  };
  vi.spyOn(useDocumentStore.getState(), "getStorage").mockReturnValue(storage);
  useFolderStore.setState({ folders: [], docParents: {} });
});
afterEach(() => vi.restoreAllMocks());

const engine = {
  htmlToMd: (html) => html.replace(/<img src="([^"]+)" alt="([^"]*)">/g, "![$2]($1)").replace(/<[^>]+>/g, ""),
  htmlToCleanMd: (html) => html.replace(/<img src="([^"]+)" alt="([^"]*)">/g, "![$2]($1)").replace(/<[^>]+>/g, ""),
};

function hook() {
  const toast = { show: vi.fn() };
  const { result } = renderHook(() => useExportActions({
    engine, syncMode: "clean", getCanonical: () => null, toast,
    toastRef: { current: toast }, autosaveRef: { current: async () => {} }, exportDocsRef: { current: null },
  }));
  return { api: result.current, toast };
}
const text = async (blob) => new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));

describe("library exports are self-contained", () => {
  it("HTML from the row menu embeds the image", async () => {
    await hook().api.handleExportDoc("doc-1", "html");
    const html = await text(downloads.at(-1));
    expect(html).not.toContain("pf-asset:");
    expect(html).toContain(bytesToDataUrl(png(1), "image/png"));
  });

  it("markdown from the row menu embeds the image", async () => {
    await hook().api.handleExportDoc("doc-1", "md");
    const md = await text(downloads.at(-1));
    expect(md).not.toContain("pf-asset:");
    expect(md).toContain(`![p](${bytesToDataUrl(png(1), "image/png")})`);
  });

  it("JSON from the row menu carries the image in `assets`", async () => {
    await hook().api.handleExportDoc("doc-1", "json");
    const env = JSON.parse(await text(downloads.at(-1)));
    expect(env.canonical.content[1].content[0].attrs.src).toBe(assetRef(hash));
    expect(env.assets[hash].mime).toBe("image/png");
    expect(env.assets[hash].data.length).toBeGreaterThan(1000);
  });

  it("the full backup writes each image once beside the documents", async () => {
    const count = await hook().api.handleExportDocs(["doc-1"], "perssonify-backup", { canonical: true });
    expect(count).toBe(1);
    const files = unzipSync(new Uint8Array(await downloads.at(-1).arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual([`Photo.json`, `assets/${hash}.png`]);
    expect([...files[`assets/${hash}.png`]]).toEqual([...png(1)]);
    expect(strFromU8(files["Photo.json"])).toContain(assetRef(hash));
  });

  it("a markdown ZIP links the image by relative path and ships the file", async () => {
    await hook().api.handleExportDocs(["doc-1"], "all-documents");
    const files = unzipSync(new Uint8Array(await downloads.at(-1).arrayBuffer()));
    expect(strFromU8(files["Photo.md"])).toContain(`![p](assets/${hash}.png)`);
    expect(files[`assets/${hash}.png`]).toBeTruthy();
  });

  it("an image that is not stored is reported, not silently exported broken", async () => {
    record = createDocument({ id: "doc-1", title: "Photo", canonical: docWith("e".repeat(64)) });
    const { api, toast } = hook();
    await api.handleExportDoc("doc-1", "html");
    expect(toast.show).toHaveBeenCalledWith(expect.stringMatching(/1 image is not stored/), "warning");
  });
});

describe("File ▸ Export of the open document is self-contained", () => {
  it("PDF / Print: the print frame gets the image data, not the reference", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const html = `<h1>Photo</h1><p><img src="${assetRef(hash)}" alt="p"></p>`;
      await exportActiveDocAsPdf(record, {
        tiptapRef: { current: { getHTML: () => html } }, cmRef: { current: null },
        getCanonical: () => record.canonical, engine, syncMode: "clean", toast: { show: vi.fn() },
      });
      const frame = document.querySelector("iframe");
      const printed = frame.contentDocument.body.innerHTML;
      expect(printed).not.toContain("pf-asset:");
      expect(printed).toContain(bytesToDataUrl(png(1), "image/png"));
      frame.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it("HTML", async () => {
    const toast = { show: vi.fn() };
    const html = `<h1>Photo</h1><p><img src="${assetRef(hash)}" alt="p"></p>`;
    await exportActiveDocAsFile("export-html", record, {
      tiptapRef: { current: { getHTML: () => html } }, cmRef: { current: null },
      getCanonical: () => record.canonical, engine, syncMode: "clean", toast,
    });
    const out = await text(downloads.at(-1));
    expect(out).not.toContain("pf-asset:");
    expect(out).toContain(bytesToDataUrl(png(1), "image/png"));
  });
});
