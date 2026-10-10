import "fake-indexeddb/auto";
import { unzipSync, strFromU8 } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { assetStore, sha256Hex } from "../store/assets/asset-store";
import { assetRef, bytesToDataUrl, collectAssetRefs, collectImageSrcs } from "../store/assets/asset-refs";
import {
  collectAssetsFor,
  decodeEnvelopeAssets,
  encodeEnvelopeAssets,
  externalizeCanonical,
  inlineAssetRefsInText,
  prepareImportedDocAssets,
  relativeAssetPath,
  restoreAssets,
} from "../store/assets/assets";
import { archiveEntriesToItems, buildZip, extractArchive } from "../store/importExport/archive";
import { ingest } from "../store/importExport/ingest";
import { createDocument, serializeForStorage } from "../store/documents/document";
import { toExportEnvelope } from "../store/importExport/import-export";
import { canonicalToHtml } from "../engine/serialize-doc";
import { exportEmergencyBackup } from "../utils/emergency-backup";
import { exportAsDocx, imageDimensions } from "../store/importExport/docx-export";

/**
 * Stored images through every door (A086): imports turn big data: images into
 * assets; exports and backups carry the images back out, self-contained; a
 * backup restored into a fresh browser brings every picture back.
 */

let n = 0;
const fresh = (name) => assetStore._resetForTests({ useIndexedDB: true, dbName: name ?? `assets-io-${++n}` });
beforeEach(() => fresh());

/** A real 3×2 PNG header followed by filler, unique per seed and big enough
 *  to be stored rather than kept inline. */
function png(seed = 1, size = 4096) {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 3, 0, 0, 0, 2]);
  for (let i = 24; i < size; i++) b[i] = (seed * 131 + i * 7) & 0xff;
  return b;
}
const dataUrl = (seed) => bytesToDataUrl(png(seed), "image/png");
const docWith = (...srcs) => ({
  type: "doc",
  content: [{ type: "paragraph", content: srcs.map((src) => ({ type: "image", attrs: { src, alt: "pic" } })) }],
});

describe("imports store big data: images as assets", () => {
  it("externalizeCanonical replaces each big data: image with a reference — only once committed", async () => {
    const url = dataUrl(1);
    const { canonical, replaced } = await externalizeCanonical(docWith(url, url, "https://x.test/a.png"));
    const hash = await sha256Hex(png(1));
    expect(collectImageSrcs(canonical)).toEqual([assetRef(hash), assetRef(hash), "https://x.test/a.png"]);
    expect(replaced.get(url)).toBe(assetRef(hash));
    expect(await assetStore.get(hash)).not.toBeNull();
    expect((await assetStore.stats()).count).toBe(1); // twice in the document, stored once
  });

  it("leaves everything inline when the store is unavailable (today's behaviour)", async () => {
    assetStore._resetForTests(); // no database
    const doc = docWith(dataUrl(2));
    const { canonical, replaced } = await externalizeCanonical(doc);
    expect(canonical).toBe(doc);
    expect(replaced.size).toBe(0);
  });

  it("an imported HTML/DOCX document's record carries references, not base64 — origin.raw included", async () => {
    const url = dataUrl(3);
    const raw = `<h1>Report</h1><p><img src="${url}" alt="chart"></p>`;
    const { doc } = ingest(raw, "html", "file-import");
    doc.canonical = docWith(url);
    await prepareImportedDocAssets(doc);
    const stored = serializeForStorage(doc);
    expect(stored).not.toContain("base64,");
    expect(stored).toContain(assetRef(await sha256Hex(png(3))));
  });

  it("markdown imported through the real ingest path", async () => {
    // A markdown file with a data: image, converted headlessly like importItems does.
    const { captureIngestHeadless } = await import("../store/importExport/headless-ingest");
    const { headlessSchema } = await import("../engine/serialize-doc");
    const { doc, html } = ingest(`# A\n\n![shot](${dataUrl(4)})\n`, "markdown", "file-import", {
      mdToHtml: (md) => md.replace(/!\[([^\]]*)\]\(([^)]+)\)/, '<p><img alt="$1" src="$2"></p>').replace(/^# (.*)$/m, "<h1>$1</h1>"),
    });
    doc._ingestHtml = html; // what the store's createDoc does
    captureIngestHeadless(doc, headlessSchema());
    expect(collectImageSrcs(doc.canonical)).toEqual([dataUrl(4)]);
    await prepareImportedDocAssets(doc);
    expect(collectImageSrcs(doc.canonical)).toEqual([assetRef(await sha256Hex(png(4)))]);
  });
});

describe("the single-document JSON export carries its images", () => {
  it("round-trips: export envelope → import in a FRESH browser → images restored", async () => {
    const hash = await assetStore.put(png(5), "image/png");
    const doc = createDocument({ title: "With picture", canonical: docWith(assetRef(hash)) });
    const { assets, missing } = await collectAssetsFor([doc.canonical]);
    expect(missing).toEqual([]);
    const json = JSON.stringify(toExportEnvelope(doc, doc.title, encodeEnvelopeAssets(assets)));

    fresh("fresh-profile-json"); // another browser: nothing stored
    expect(await assetStore.get(hash)).toBeNull();
    const { doc: imported } = ingest(json, "pmjson", "file-import");
    expect(imported._importAssets).toBeTruthy();
    // The envelope's embedded images are never persisted in the record itself.
    expect(serializeForStorage(imported)).not.toContain('"assets"');
    await prepareImportedDocAssets(imported);
    expect(imported._importAssets).toBeUndefined();
    expect(collectImageSrcs(imported.canonical)).toEqual([assetRef(hash)]);
    const back = await assetStore.get(hash);
    expect([...back.bytes]).toEqual([...png(5)]);
  });

  it("where the importing browser has no asset store, the images come in INLINE", async () => {
    const hash = await assetStore.put(png(6), "image/png");
    const { assets } = await collectAssetsFor([docWith(assetRef(hash))]);
    const json = JSON.stringify(toExportEnvelope(
      createDocument({ canonical: docWith(assetRef(hash)) }), "x", encodeEnvelopeAssets(assets)));
    assetStore._resetForTests(); // unavailable
    const { doc } = ingest(json, "pmjson", "file-import");
    await prepareImportedDocAssets(doc);
    expect(collectImageSrcs(doc.canonical)[0]).toBe(dataUrl(6));
  });

  it("an embedded asset that does not hash to its name is NOT restored under that name", async () => {
    const lie = "c".repeat(64);
    const decoded = decodeEnvelopeAssets({ [lie]: { mime: "image/png", data: btoa("not those bytes".padEnd(64, ".")) } });
    const doc = createDocument({ canonical: docWith(assetRef(lie)) });
    await prepareImportedDocAssets(doc, decoded);
    expect(await assetStore.get(lie)).toBeNull();
  });

  it("restoreAssets reports only what hashes to its name", async () => {
    const good = await sha256Hex(png(20));
    const stored = await restoreAssets(new Map([
      [good, { mime: "image/png", bytes: png(20) }],
      ["c".repeat(64), { mime: "image/png", bytes: png(21) }],
    ]));
    expect([...stored]).toEqual([good]);
  });

  it("a SMALL carried asset (a pasted icon) is restored as an asset, not inlined", async () => {
    const tiny = png(22, 300); // under the inline threshold as a data: URL
    const hash = await sha256Hex(tiny);
    const doc = createDocument({ canonical: docWith(assetRef(hash)) });
    await prepareImportedDocAssets(doc, new Map([[hash, { mime: "image/png", bytes: tiny }]]));
    expect(collectImageSrcs(doc.canonical)).toEqual([assetRef(hash)]);
    expect(await assetStore.get(hash)).not.toBeNull();
  });

  it("ignores malformed or non-raster embedded assets", () => {
    const out = decodeEnvelopeAssets({
      nothex: { mime: "image/png", data: "AAAA" },
      ["d".repeat(64)]: { mime: "image/svg+xml", data: "PHN2Zz4=" },
      ["e".repeat(64)]: { mime: "image/png", data: 42 },
    });
    expect(out.size).toBe(0);
  });
});

describe("text exports are self-contained", () => {
  it("HTML export: no reference survives; the image is embedded", async () => {
    const hash = await assetStore.put(png(7), "image/png");
    const html = canonicalToHtml(docWith(assetRef(hash)));
    expect(html).toContain(`src="pf-asset:${hash}"`);
    const { text, missing } = await inlineAssetRefsInText(html);
    expect(text).not.toContain("pf-asset:");
    expect(text).toContain(`src="${dataUrl(7)}"`);
    expect(missing).toEqual([]);
  });

  it("markdown export: the image is embedded", async () => {
    const hash = await assetStore.put(png(8), "image/png");
    const { text } = await inlineAssetRefsInText(`# T\n\n![pic](pf-asset:${hash})\n`);
    expect(text).toBe(`# T\n\n![pic](${dataUrl(8)})\n`);
  });

  it("a reference with no stored image is left and REPORTED", async () => {
    const ghost = "9".repeat(64);
    const { text, missing } = await inlineAssetRefsInText(`<img src="pf-asset:${ghost}">`);
    expect(text).toContain(`pf-asset:${ghost}`);
    expect(missing).toEqual([ghost]);
  });

  it("Word export embeds a data: image as a picture", async () => {
    const hash = await assetStore.put(png(9), "image/png");
    const { text: md } = await inlineAssetRefsInText(`Before\n\n![pic](pf-asset:${hash})\n\n<img src="pf-asset:${hash}" alt="sized" width="40">\n`);
    let blob = null;
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = (b) => { blob = b; return "blob:docx"; };
    try {
      await exportAsDocx("With pictures", md);
    } finally {
      URL.createObjectURL = realCreate;
    }
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const media = Object.keys(files).filter((p) => p.startsWith("word/media/"));
    expect(media.length).toBeGreaterThanOrEqual(1);
    const body = strFromU8(files["word/document.xml"]);
    expect(body).toContain("<pic:pic");
    expect(body).not.toContain("data:image");
    expect(body).not.toContain("&lt;img");
  });

  it("reads picture sizes from PNG, GIF and JPEG headers", () => {
    expect(imageDimensions(png(1), "png")).toEqual({ width: 3, height: 2 });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 5, 0, 7, 0]);
    expect(imageDimensions(gif, "gif")).toEqual({ width: 5, height: 7 });
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 9, 0, 12, 3, 0, 0]);
    expect(imageDimensions(jpg, "jpg")).toEqual({ width: 12, height: 9 });
  });
});

describe("backups and archives carry the images as files", () => {
  const file = (bytes, name) => {
    const f = new Blob([bytes]);
    f.name = name;
    f.arrayBuffer = () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    Object.defineProperty(f, "size", { value: bytes.byteLength });
    return f;
  };

  it("full backup → restore on a FRESH profile reproduces the document and its images", async () => {
    const h1 = await assetStore.put(png(10), "image/png");
    const h2 = await assetStore.put(png(11), "image/png");
    const docs = [
      createDocument({ id: "d1", title: "One", canonical: docWith(assetRef(h1)) }),
      createDocument({ id: "d2", title: "Two", canonical: docWith(assetRef(h1), assetRef(h2)) }),
    ];
    // The emergency backup builds the SAME archive as File ▸ Full backup.
    let zipBlob = null;
    const count = await exportEmergencyBackup(
      {
        storage: { list: async () => docs.map((d) => ({ id: d.id })), get: async (id) => docs.find((d) => d.id === id) },
        drafts: new Map(),
        folders: [{ id: "f1", name: "Work", parentId: null }],
        docParents: { d2: "f1" },
      },
      (b) => { zipBlob = b; }
    );
    expect(count).toBe(2); // documents, not documents + images
    const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
    const names = Object.keys(unzipSync(zipBytes)).sort();
    expect(names).toEqual([`assets/${h1}.png`, `assets/${h2}.png`, "One.json", "Work/Two.json"].sort());

    // Restore in a browser that has never seen these images.
    fresh("fresh-profile-backup");
    const extracted = await extractArchive(file(zipBytes, "perssonify-backup.zip"));
    expect(extracted.map((e) => e.path).sort()).toEqual(["One.json", "Work/Two.json"]);
    expect(extracted.assets.map((a) => a.hash).sort()).toEqual([h1, h2].sort());
    // The backup is still recognised as one: paths kept verbatim, not wrapped.
    const items = archiveEntriesToItems(extracted, "perssonify-backup.zip");
    expect(items.map((i) => i.folderPath)).toEqual(expect.arrayContaining([[], ["Work"]]));
    const carried = new Map(extracted.assets.map((a) => [a.hash, a]));
    for (const it of items) {
      const { doc } = ingest(it.text, "pmjson", "file-import");
      await prepareImportedDocAssets(doc, carried);
      for (const h of collectAssetRefs(doc.canonical)) expect(await assetStore.get(h), h).not.toBeNull();
    }
    expect([...(await assetStore.get(h2)).bytes]).toEqual([...png(11)]);
  });

  it("a markdown ZIP's relative asset links come back as references when the files travel with it", async () => {
    const hash = await sha256Hex(png(12));
    const md = `# Nested\n\n![pic](${relativeAssetPath(hash, "png", 2)})\n`;
    expect(md).toContain(`../../assets/${hash}.png`);
    const zip = buildZip({ [`a/b/Nested.md`]: md, [`assets/${hash}.png`]: png(12) });
    const extracted = await extractArchive(file(zip, "notes.zip"));
    expect(extracted.assets.map((a) => a.hash)).toEqual([hash]);
    const doc = createDocument({ canonical: docWith(`../../assets/${hash}.png`) });
    await prepareImportedDocAssets(doc, new Map(extracted.assets.map((a) => [a.hash, a])));
    expect(collectImageSrcs(doc.canonical)).toEqual([assetRef(hash)]);
    expect(await assetStore.get(hash)).not.toBeNull();
  });

  it("a document in a user folder called 'assets' is still a document", async () => {
    const zip = buildZip({ "assets/notes.md": "# Notes", [`assets/${"a".repeat(64)}.md`]: "# Hex title" });
    const extracted = await extractArchive(file(zip, "x.zip"));
    expect(extracted.map((e) => e.path).sort()).toEqual(["assets/notes.md", `assets/${"a".repeat(64)}.md`].sort());
    expect(extracted.assets).toEqual([]);
  });

  it("asset files are stored uncompressed and budgeted apart from text", async () => {
    const big = png(13, 6 * 1024 * 1024); // bigger than the 5 MB per-TEXT-entry cap
    const hash = await sha256Hex(big);
    const zip = buildZip({ "doc.md": "# D", [`assets/${hash}.png`]: big });
    const extracted = await extractArchive(file(zip, "big.zip"));
    expect(extracted.assets[0].bytes.byteLength).toBe(big.byteLength);
  });
});
