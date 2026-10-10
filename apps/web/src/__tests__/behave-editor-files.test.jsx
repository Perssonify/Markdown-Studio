/**
 * A108 — getting documents OUT of the editor and back IN, through the real
 * editor: Copy as, File ▸ Export in every format, a row's own export, a
 * folder's ZIP, "All documents", and a full backup restored through the real
 * importer after the library was emptied; then files of every kind picked with
 * File ▸ Open file… or dropped on the editor.
 *
 * One mount; the cases are one journey (see behave-harness.jsx).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react/pure";
import {
  act, captureDownloads, click, dropFiles, heading, installBrowserStubs, menuClick, mountEditor, onDisk,
  para, pickFiles, readBlobBytes, readBlobText, richEditor, rowMenuClick, seededAdapter, store, storedDoc,
  textOf, toastText, until, untilHydrated, untilMdHas,
} from "./behave-harness";
import { buildZip, extractArchive } from "../store/importExport/archive";
import { useFolderStore } from "../store/documents/folders";

vi.setConfig({ testTimeout: 30000 });

let adapter;
let downloads;
let warn;
let err;

const bold = (text) => ({ type: "text", text, marks: [{ type: "bold" }] });

beforeAll(async () => {
  installBrowserStubs();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
  downloads = captureDownloads();
  adapter = await seededAdapter(
    [
      storedDoc("report", "Report", [heading(1, "Report"), { type: "paragraph", content: [{ type: "text", text: "quarterly " }, bold("numbers")] }],
        { updated: "2026-09-05T10:00:00.000Z", created: "2026-08-01T09:00:00.000Z", tags: ["q3"] }),
      storedDoc("notes", "Meeting notes", [heading(1, "Meeting notes"), para("notes body")],
        { updated: "2026-09-01T10:00:00.000Z" }),
    ],
    {
      prefs: {
        folderTree: {
          folders: [{ id: "f-work", name: "Work", parentId: null }],
          docParents: { notes: "f-work" },
          docOrder: {},
          expanded: { "f-work": true },
        },
      },
    },
  );
  await mountEditor({ storageAdapter: adapter });
  await until(() => store().hydratedDocId, "a document to open");
  if (store().activeDocId !== "report") {
    await click(await until(() => document.querySelector('[role="tree"] [data-key="d:report"] button'), "Report in the library"));
  }
  await untilHydrated("report");
}, 30000);

afterAll(() => { cleanup(); downloads.restore(); warn.mockRestore(); err.mockRestore(); });

const row = (key) => document.querySelector(`[role="tree"] [data-key="${key}"]`);
const zipEntries = async (download) => {
  const bytes = await readBlobBytes(download.blob);
  return extractArchive(new File([bytes], download.name));
};

describe("copying the open document", () => {
  it("Edit ▸ Copy as puts Markdown, HTML and ProseMirror JSON on the clipboard", async () => {
    await untilMdHas("**numbers**");
    await menuClick("Edit", "Copy as", "Markdown");
    await until(() => navigator.clipboard.text.includes("quarterly **numbers**"), "Markdown on the clipboard");
    await menuClick("Edit", "Copy as", "HTML");
    await until(() => /<strong>numbers<\/strong>/.test(navigator.clipboard.text), "HTML on the clipboard");
    await menuClick("Edit", "Copy as", "ProseMirror JSON");
    await until(() => navigator.clipboard.text.startsWith("{"), "JSON on the clipboard");
    expect(JSON.parse(navigator.clipboard.text).type).toBe("doc");
    await until(() => /JSON copied/.test(toastText()), "the copied toast");
  });
});

describe("exporting", () => {
  it("File ▸ Export writes Markdown, HTML and JSON of the LIVE document under its title", async () => {
    // Unsaved typing is part of what is exported — the export reads the editor.
    await act(async () => { const ed = richEditor(); ed.view.dispatch(ed.state.tr.insertText(" (draft)", ed.state.doc.content.size - 1)); });
    await menuClick("File", "Export", "Markdown (.md)");
    let f = downloads.last();
    expect(f.name).toBe("report.md");
    const md = await readBlobText(f.blob);
    expect(md).toContain("# Report");
    // (Typed at the end of a bold run, so it continues the bold.)
    expect(md).toContain("quarterly **numbers (draft)**");

    await menuClick("File", "Export", "HTML (.html)");
    f = downloads.last();
    expect(f.name).toBe("report.html");
    expect(await readBlobText(f.blob)).toContain("<strong>numbers (draft)</strong>");

    await menuClick("File", "Export", "ProseMirror JSON");
    f = downloads.last();
    const env = JSON.parse(await readBlobText(f.blob));
    expect(env).toMatchObject({ _format: "perssonify-document", id: "report", title: "Report", tags: ["q3"] });
    expect(textOf(env.canonical)).toContain("(draft)");
  });

  it("File ▸ Export ▸ Word writes a real .docx", async () => {
    await menuClick("File", "Export", "Word (.docx)");
    const f = await until(() => downloads.named(/\.docx$/)[0], "the Word download");
    expect(f.name).toBe("report.docx");
    const bytes = new Uint8Array(await readBlobBytes(f.blob));
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });

  it("a library row exports ITS document, open or not", async () => {
    await rowMenuClick(row("d:notes"), "Export", "Markdown (.md)");
    const f = await until(() => downloads.named(/^meeting-notes\.md$/)[0], "the row's download");
    const md = await readBlobText(f.blob);
    expect(md).toContain("# Meeting notes");
    expect(md).toContain("notes body");
    await until(() => /Document exported/.test(toastText()), "the exported toast");
  });

  it("a folder exports as a ZIP of its documents", async () => {
    await rowMenuClick(row("f:f-work"), "Export as ZIP");
    const f = await until(() => downloads.named(/^Work-\d{8}-\d{9}\.zip$/)[0], "the folder ZIP");
    const entries = await zipEntries(f);
    expect(entries.map((e) => e.path)).toEqual(["Work/Meeting notes.md"]);
    expect(entries[0].text).toContain("notes body");
  });

  it("File ▸ Export ▸ All documents writes every document, folders kept", async () => {
    await menuClick("File", "Export", "All documents (.zip)");
    const f = await until(() => downloads.named(/^all-documents-/)[0], "the all-documents ZIP");
    const paths = (await zipEntries(f)).map((e) => e.path).sort();
    expect(paths).toEqual(["Report.md", "Work/Meeting notes.md"]);
  });
});

describe("a full backup restores the library", () => {
  let backup;

  it("File ▸ Export ▸ Full backup writes every document as a restorable envelope", async () => {
    await menuClick("File", "Export", "Full backup");
    backup = await until(() => downloads.named(/^perssonify-backup-/)[0], "the backup ZIP");
    const entries = await zipEntries(backup);
    expect(entries.map((e) => e.path).sort()).toEqual(["Report.json", "Work/Meeting notes.json"]);
    const report = JSON.parse(entries.find((e) => e.path === "Report.json").text);
    expect(report).toMatchObject({ _format: "perssonify-document", id: "report", created: "2026-08-01T09:00:00.000Z" });
    // The backup flushed the open document first: the unsaved "(draft)" is in it.
    expect(textOf(report.canonical)).toContain("(draft)");
  });

  it("select mode deletes the whole library in one go", async () => {
    await click(screen.getByLabelText("Select documents"));
    await click(screen.getByLabelText("Select all"));
    await click(await until(() => screen.queryByLabelText("Delete 2 selected"), "the bulk delete"));
    const ok = await until(() => [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.trim() === "Delete"), "the confirmation");
    await click(ok);
    await until(async () => (await adapter.list()).length === 0, "the library to empty");
  });

  it("importing the backup brings every document back — ids, titles, dates, folders", async () => {
    const bytes = await readBlobBytes(backup.blob);
    await pickFiles([new File([bytes], backup.name, { type: "application/zip" })]);
    await until(async () => (await adapter.list()).length === 2, "both documents back");
    const report = await onDisk(adapter, "report");
    expect(report.title).toBe("Report");
    expect(report.created).toBe("2026-08-01T09:00:00.000Z");
    expect(report.tags).toEqual(["q3"]);
    expect(textOf(report.canonical)).toContain("(draft)");
    const notes = await onDisk(adapter, "notes");
    expect(textOf(notes.canonical)).toContain("notes body");
    // Back in a folder called Work — not nested under a folder named after the ZIP.
    const { folders, docParents } = useFolderStore.getState();
    expect(folders.find((f) => f.id === docParents.notes)?.name).toBe("Work");
    expect(docParents.report).toBeUndefined();
    await until(() => /Imported 2 file/.test(toastText()), "the imported toast");
  });
});

describe("importing files", () => {
  it("File ▸ Open file… takes Markdown, HTML, text and archives, and says what it skipped", async () => {
    const before = new Set((await adapter.list()).map((d) => d.id));
    const zip = buildZip({
      "Project/plan.md": "# Plan\n\nplan body",
      "Project/sub/detail.md": "# Detail\n\ndetail body",
    });
    const huge = new File(["x"], "huge.md", { type: "text/markdown" });
    Object.defineProperty(huge, "size", { value: 6_000_000 });
    await pickFiles([
      new File(["# From markdown\n\nmd body"], "a.md", { type: "text/markdown" }),
      new File(["<h1>From html</h1><p>html <em>body</em></p>"], "b.html", { type: "text/html" }),
      new File(["plain text body"], "c.txt", { type: "text/plain" }),
      new File([zip], "bundle.zip", { type: "application/zip" }),
      new File([new Uint8Array([137, 80, 78, 71])], "pic.png", { type: "image/png" }),
      huge,
    ]);
    await until(async () => (await adapter.list()).length === before.size + 5, "five new documents");
    const added = (await adapter.list()).filter((d) => !before.has(d.id));
    const byTitle = Object.fromEntries(added.map((d) => [d.title, d.id]));
    expect(Object.keys(byTitle).sort()).toEqual(["Detail", "From html", "From markdown", "Plan", "plain text body"].sort());
    expect(textOf((await onDisk(adapter, byTitle["From html"])).canonical)).toContain("html ");
    // The archive's own folders are kept: Project/ and Project/sub/.
    const { folders, docParents } = useFolderStore.getState();
    const folderOf = (id) => folders.find((f) => f.id === docParents[id]);
    expect(folderOf(byTitle.Plan).name).toBe("Project");
    expect(folderOf(byTitle.Detail).name).toBe("sub");
    expect(folders.find((f) => f.id === folderOf(byTitle.Detail).parentId).name).toBe("Project");
    // The picture is ignored, the oversized file named.
    await until(() => /Skipped 1 file\(s\): huge\.md/.test(toastText()), "the skipped toast");
    // The first import is opened.
    await untilHydrated(byTitle["From markdown"]);
  });

  it("a Word file exported by the app imports back as a document", async () => {
    const docx = downloads.named(/\.docx$/)[0];
    const bytes = await readBlobBytes(docx.blob);
    const before = new Set((await adapter.list()).map((d) => d.id));
    await pickFiles([new File([bytes], "round-trip.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })]);
    const id = await until(async () => (await adapter.list()).find((d) => !before.has(d.id))?.id, "the Word document");
    const text = textOf((await onDisk(adapter, id)).canonical);
    expect(text).toContain("Report");
    expect(text).toContain("numbers");
  });

  it("a file dropped on the editor is imported, not opened in place of the app", async () => {
    const before = new Set((await adapter.list()).map((d) => d.id));
    await dropFiles(document.querySelector('[data-tour="editor"]'), [new File(["# Dropped\n\ndropped body"], "dropped.md", { type: "text/markdown" })]);
    const id = await until(async () => (await adapter.list()).find((d) => !before.has(d.id))?.id, "the dropped document");
    expect((await onDisk(adapter, id)).title).toBe("Dropped");
    await untilHydrated(id);
  });

  it("an archive with nothing importable says so", async () => {
    const empty = buildZip({ "image.png": "not text" });
    await pickFiles([new File([empty], "nothing.zip", { type: "application/zip" })]);
    await until(() => /No supported files found/.test(toastText()), "the nothing-found toast");
  });
});
