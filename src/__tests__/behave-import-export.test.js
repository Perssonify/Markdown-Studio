/**
 * A108 — the import/export pipeline below the editor: reading files
 * (`store/import-export.ts`), archives of every kind including an encrypted
 * ZIP and the limits that stop a bomb (`store/archive.ts`), the file-picker
 * expansion with its password prompt (`collectImportItems`), and a Word
 * document written by the app's own exporter read back by its importer.
 *
 * The editor-level journeys (behave-editor-files) drive these through the UI;
 * this file covers the branches a UI journey does not reach.
 */
import { gzipSync, strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ArchiveEncryptedError, ArchiveWrongPasswordError, buildZip, extractArchive, isZipEncrypted,
} from "../store/archive";
import { exportAsDocx } from "../store/docx-export";
import { convertDocxToHtml } from "../store/docx-import";
import {
  downloadBlob, exportAsHtml, exportAsJson, exportAsMarkdown, getFileContentAndFormat, importFile,
  importFiles, importImage,
} from "../store/import-export";
import { collectImportItems } from "../editor/useImportPipeline";

/** Every download, with its text. */
let downloads;
let restore;
beforeEach(() => {
  downloads = [];
  const blobs = new Map();
  let n = 0;
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  const click = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = vi.fn((b) => { const u = `blob:t/${++n}`; blobs.set(u, b); return u; });
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download, blob: blobs.get(this.getAttribute("href")) }); };
  restore = () => { URL.createObjectURL = create; URL.revokeObjectURL = revoke; HTMLAnchorElement.prototype.click = click; };
});
afterEach(() => { restore(); vi.useRealTimers(); });

const readText = (blob) => blob.text ? blob.text() : new Response(blob).text();
const para = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const docRecord = (extra = {}) => ({
  id: "d1", title: "Quarterly <Report> & \"Notes\"", canonical: { type: "doc", content: [para("hello")] },
  origin: { format: "markdown", raw: "# secret original", alternates: { html: "<b>old</b>" }, importedAt: "2026-01-01" },
  residuals: [], ingestReport: { preIngestHtml: "<p>the whole original</p>", counts: 1 },
  metadata: { a: 1 }, tags: ["t"], created: "2026-01-01T00:00:00.000Z", updated: "2026-01-02T00:00:00.000Z",
  markdownCache: null, ...extra,
});

describe("reading files", () => {
  it("detects the format from the extension, then the MIME type", async () => {
    const cases = [
      [new File(["# a"], "a.markdown"), "markdown"],
      [new File(["<p>"], "b.HTM"), "html"],
      [new File(["{}"], "c.json"), "pmjson"],
      [new File(["x"], "d.txt"), "text"],
      [new File(["<p>"], "noext", { type: "text/html" }), "html"],
      [new File(["# a"], "noext", { type: "text/markdown" }), "markdown"],
      [new File(["{}"], "noext", { type: "application/json" }), "pmjson"],
      [new File(["x"], "noext", { type: "application/octet-stream" }), "text"],
    ];
    for (const [file, format] of cases) {
      expect((await getFileContentAndFormat(file)).format).toBe(format);
    }
    expect((await getFileContentAndFormat(new File(["body text"], "x.txt"))).raw).toBe("body text");
  });

  it("importFile names an untitled document after its file", async () => {
    // Plain text has no heading to take a title from: the file name is used.
    const untitled = await importFile(new File(["just words, no heading"], "meeting-2026.txt"));
    expect(untitled.doc.title).toBe("meeting-2026");
    const blank = await importFile(new File([""], "empty-note.md"));
    expect(blank.doc.title).toBe("empty-note");
    // Markdown too: a document is named from its heading only once its content
    // is captured (the editor's import path does that); until then — and so for
    // this store-level helper — the file name stands in.
    const md = await importFile(new File(["# Real title\n\nbody"], "file.md"), { mdToHtml: (m) => `<h1>${m.split("\n")[0].slice(2)}</h1>` });
    expect(md.doc.title).toBe("file");
    expect(md.html).toContain("<h1>Real title</h1>");
    expect(md.needsTiptap).toBe(true); // the caller captures it next
  });

  it("importFiles skips pictures and oversized files and survives an unreadable one", async () => {
    const huge = new File(["x"], "huge.md");
    Object.defineProperty(huge, "size", { value: 6_000_000 });
    const broken = new File(["x"], "broken.md");
    // A read that fails, as a file removed mid-import would.
    const RealReader = globalThis.FileReader;
    globalThis.FileReader = class extends RealReader {
      readAsText(f) { if (f === broken) { setTimeout(() => this.onerror?.(new Event("error")), 0); return; } super.readAsText(f); }
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const results = await importFiles([
        new File(["# One"], "one.md"),
        new File([new Uint8Array([1, 2])], "pic.png", { type: "image/png" }),
        huge,
        broken,
        new File(["two"], "two.txt"),
      ]);
      // (No markdown engine handed in, so titles come from the file names.)
      expect(results.map((r) => r.doc.title)).toEqual(["one", "two"]);
      expect(warn.mock.calls.map((c) => String(c[0])).join(" ")).toMatch(/huge\.md: too large.*broken\.md|Failed to import broken\.md/s);
    } finally {
      globalThis.FileReader = RealReader;
      warn.mockRestore();
    }
  });

  it("importImage reads a picture as a data URL, and refuses anything else", async () => {
    const img = await importImage(new File([new Uint8Array([137, 80, 78, 71])], "logo.final.png", { type: "image/png" }));
    expect(img.src).toMatch(/^data:image\/png;base64,/);
    expect(img.alt).toBe("logo.final");
    expect(img.title).toBe("logo.final.png");
    await expect(importImage(new File(["x"], "a.txt", { type: "text/plain" }))).rejects.toThrow("Not an image file");
  });
});

describe("writing files", () => {
  it("Markdown prefers the stored markdown, else converts with the mode's converter", async () => {
    exportAsMarkdown(docRecord({ markdownCache: "# cached" }), {});
    expect(await readText(downloads.at(-1).blob)).toBe("# cached");
    const clean = vi.fn(() => "clean"), styled = vi.fn(() => "styled");
    exportAsMarkdown(docRecord(), { getHtml: () => "<p>x</p>", htmlToMd: styled, htmlToCleanMd: clean, syncMode: "styled" });
    expect(await readText(downloads.at(-1).blob)).toBe("styled");
    const { filename, fidelityReport } = exportAsMarkdown(docRecord(), { getHtml: () => "<p>x</p>", htmlToMd: styled, htmlToCleanMd: clean });
    expect(await readText(downloads.at(-1).blob)).toBe("clean"); // Clean is the default
    expect(filename).toBe("quarterly-report-&-notes.md");
    expect(fidelityReport.lossless).toBe(true);
    // Only one converter supplied: it is used whatever the mode.
    exportAsMarkdown(docRecord(), { getHtml: () => "", htmlToCleanMd: clean, syncMode: "styled" });
    expect(await readText(downloads.at(-1).blob)).toBe("clean");
    expect(() => exportAsMarkdown(docRecord(), {})).toThrow(/converter not available/);
  });

  it("HTML is a standalone page with the title ESCAPED, and needs the HTML", async () => {
    const { filename } = exportAsHtml(docRecord(), { getHtml: () => "<p>body</p>" });
    const html = await readText(downloads.at(-1).blob);
    expect(filename).toBe("quarterly-report-&-notes.html");
    expect(html).toContain("<title>Quarterly &lt;Report&gt; &amp; &quot;Notes&quot;</title>");
    expect(html).toContain("<body>\n<p>body</p>\n</body>");
    expect(() => exportAsHtml(docRecord(), {})).toThrow(/HTML content not available/);
  });

  it("JSON is the restorable envelope WITHOUT the originally imported text", async () => {
    exportAsJson(docRecord());
    const env = JSON.parse(await readText(downloads.at(-1).blob));
    expect(env).toMatchObject({ _format: "perssonify-document", id: "d1", tags: ["t"], metadata: { a: 1 } });
    expect(env.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(env.origin).toMatchObject({ format: "markdown", raw: null, alternates: null });
    expect(env.ingestReport).toEqual({ preIngestHtml: null, counts: 1 });
    expect(JSON.stringify(env)).not.toContain("secret original");
  });

  it("a download's object URL is released after a second, not before", () => {
    vi.useFakeTimers();
    downloadBlob(new Blob(["x"]), "x.txt");
    expect(downloads.at(-1).name).toBe("x.txt");
    expect(document.querySelector('a[download="x.txt"]')).not.toBeNull();
    vi.advanceTimersByTime(999);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(document.querySelector('a[download="x.txt"]')).toBeNull();
  });
});

// ── Archives ────────────────────────────────────────────────────────────────

function tar(files) {
  const enc = new TextEncoder();
  const blocks = [];
  for (const [name, text] of Object.entries(files)) {
    const body = enc.encode(text);
    const h = new Uint8Array(512);
    h.set(enc.encode(name).subarray(0, 100), 0);
    h.set(enc.encode(body.length.toString(8).padStart(11, "0") + "\0"), 124);
    h[156] = "0".charCodeAt(0);
    h.set(enc.encode("ustar\0"), 257);
    blocks.push(h);
    const padded = new Uint8Array(Math.ceil(body.length / 512) * 512);
    padded.set(body);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of blocks) { out.set(b, o); o += b.length; }
  return out;
}
async function encryptedZip(files, password) {
  const { ZipWriter, Uint8ArrayWriter, TextReader, configure } = await import("@zip.js/zip.js");
  configure({ useWebWorkers: false });
  const writer = new ZipWriter(new Uint8ArrayWriter(), { password, zipCrypto: true });
  for (const [name, text] of Object.entries(files)) await writer.add(name, new TextReader(text));
  return writer.close();
}
const paths = (entries) => entries.map((e) => e.path).sort();

describe("archives", () => {
  it("reads .tar, .tgz / .tar.gz and a single gzipped file", async () => {
    const t = tar({ "notes/a.md": "# A", "notes/b.txt": "b", "image.png": "not text" });
    expect(paths(await extractArchive(new File([t], "x.tar")))).toEqual(["notes/a.md", "notes/b.txt"]);
    expect(paths(await extractArchive(new File([gzipSync(t)], "x.tgz")))).toEqual(["notes/a.md", "notes/b.txt"]);
    expect(paths(await extractArchive(new File([gzipSync(t)], "x.tar.gz")))).toEqual(["notes/a.md", "notes/b.txt"]);
    const one = await extractArchive(new File([gzipSync(strToU8("# Solo"))], "solo.md.gz"));
    expect(one).toEqual([{ path: "solo.md", text: "# Solo", format: "markdown" }]);
  });

  it("skips archiver junk and directory markers", async () => {
    const zip = buildZip({ "__MACOSX/._a.md": "junk", "keep/a.md": "# A", "keep/.DS_Store": "x", "keep/": "" });
    expect(paths(await extractArchive(new File([zip], "j.zip")))).toEqual(["keep/a.md"]);
  });

  it("stops a bomb: too many entries, an entry too big, too much in total, too big to start with", async () => {
    const many = buildZip(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`n${i}.md`, "x"])));
    await expect(extractArchive(new File([many], "m.zip"), { maxEntries: 5 })).rejects.toThrow("too many entries");
    const big = buildZip({ "big.md": "x".repeat(2000) });
    await expect(extractArchive(new File([big], "b.zip"), { maxEntryBytes: 1000 })).rejects.toThrow("entry too large");
    const two = buildZip({ "a.md": "x".repeat(800), "b.md": "y".repeat(800) });
    await expect(extractArchive(new File([two], "t.zip"), { maxTotalBytes: 1000 })).rejects.toThrow("too large after decompression");
    await expect(extractArchive(new File([two], "t.zip"), { maxCompressedBytes: 10 })).rejects.toThrow("compressed file too large");
    const t = tar({ "a.md": "x".repeat(800), "b.md": "y".repeat(800) });
    await expect(extractArchive(new File([gzipSync(t)], "t.tgz"), { maxTotalBytes: 1000 })).rejects.toThrow("too large after decompression");
    await expect(extractArchive(new File([t], "t.tar"), { maxEntryBytes: 500 })).rejects.toThrow("entry too large");
  });

  it("an encrypted ZIP needs its password, says when it is wrong, and opens with the right one", async () => {
    const zip = await encryptedZip({ "secret/plan.md": "# Plan\n\nhidden" }, "hunter2");
    expect(isZipEncrypted(zip)).toBe(true);
    const file = () => new File([zip], "locked.zip");
    await expect(extractArchive(file())).rejects.toBeInstanceOf(ArchiveEncryptedError);
    await expect(extractArchive(file(), { password: "wrong" })).rejects.toBeInstanceOf(ArchiveWrongPasswordError);
    const entries = await extractArchive(file(), { password: "hunter2" });
    expect(entries).toEqual([{ path: "secret/plan.md", text: "# Plan\n\nhidden", format: "markdown" }]);
    await expect(extractArchive(file(), { password: "hunter2", maxEntryBytes: 3 })).rejects.toThrow("entry too large");
  });
});

describe("picking files to import (collectImportItems)", () => {
  it("asks for an encrypted archive's password, again when it is wrong, and imports it", async () => {
    const zip = await encryptedZip({ "a.md": "# A", "b.md": "# B" }, "pw");
    const answers = ["nope", "pw"];
    const prompt = vi.fn(async () => answers.shift());
    const { items, skipped } = await collectImportItems([new File([zip], "vault.zip")], prompt);
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompt.mock.calls[0][0]).toBe("Enter password");
    expect(prompt.mock.calls[1][0]).toBe("Incorrect password — try again");
    expect(prompt.mock.calls[0][1]).toMatchObject({ type: "password", description: '"vault.zip" is password-protected.' });
    expect(skipped).toEqual([]);
    // Two loose files: wrapped in a folder named after the archive.
    expect(items).toEqual([
      { raw: "# A", format: "markdown", folderPath: ["vault"] },
      { raw: "# B", format: "markdown", folderPath: ["vault"] },
    ]);
  });

  it("a cancelled password prompt, or an unreadable archive, is SKIPPED by name", async () => {
    const zip = await encryptedZip({ "a.md": "# A" }, "pw");
    const { items, skipped } = await collectImportItems(
      [new File([zip], "locked.zip"), new File([new Uint8Array([1, 2, 3, 4])], "garbage.zip")],
      async () => null,
    );
    expect(items).toEqual([]);
    expect(skipped).toEqual(["locked.zip", "garbage.zip"]);
  });

  it("a Word file is converted; an empty or broken one is skipped", async () => {
    await exportAsDocx("Minutes", "# Minutes\n\nWe **agreed** on:\n\n- one\n- two");
    const docx = downloads.find((d) => d.name.endsWith(".docx")).blob;
    const bytes = new Uint8Array(await (docx.arrayBuffer ? docx.arrayBuffer() : new Response(docx).arrayBuffer()));
    const { items, skipped } = await collectImportItems(
      [new File([bytes], "minutes.docx"), new File(["not a docx"], "broken.docx")],
      async () => null,
    );
    expect(skipped).toEqual(["broken.docx"]);
    expect(items).toHaveLength(1);
    expect(items[0].format).toBe("html");
    expect(items[0].raw).toContain("<strong>agreed</strong>");
    expect(items[0].raw).toMatch(/<li>(<p>)?one/);
  }, 20000);
});

describe("Word", () => {
  it("the app's own .docx reads back with its headings, emphasis and list", async () => {
    const name = await exportAsDocx("Round trip", "# Title\n\nSome *italic* and **bold**.\n\n1. first\n2. second");
    expect(name).toMatch(/\.docx$/);
    const blob = downloads.at(-1).blob;
    const { html, messages } = await convertDocxToHtml(blob);
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toMatch(/<ol>.*first.*second.*<\/ol>/s);
    expect(Array.isArray(messages)).toBe(true);
  }, 20000);
});
