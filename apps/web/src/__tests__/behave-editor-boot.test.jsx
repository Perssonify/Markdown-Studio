/**
 * A108 — the editor's first run, and importing from a URL, through the real
 * editor: an empty library is seeded with the initial document and its
 * companions (the initial one left open, the companions filed and linked),
 * `initialMode` applies, preferences are written back as they change, a deep
 * link PRE-FILLS the URL importer without fetching anything, and the importer
 * takes both a fetched archive and pasted text.
 *
 * One mount; the cases are one journey (see behave-harness.jsx).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react/pure";
import {
  act, click, fireEvent, installBrowserStubs, mdText, menuClick, mountEditor, onDisk, seededAdapter, store,
  textOf, toastText, until, untilHydrated, untilMdHas,
} from "./behave-harness";
import { buildZip } from "../store/importExport/archive";
import { useFolderStore } from "../store/documents/folders";
import { useUIStore } from "../store/preferences/uiStore";

vi.setConfig({ testTimeout: 30000 });

const DEEP_LINK = "https://example.com/shared/notes.zip";
let adapter;
let warn;
let err;
let fetchSpy;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  installBrowserStubs();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
  fetchSpy = vi.fn(async () => { throw new Error("no network in this test"); });
  globalThis.fetch = fetchSpy;
  adapter = await seededAdapter([]);
  await mountEditor({
    storageAdapter: adapter,
    initialMode: "md",
    initialDocument: { title: "Welcome", content: "# Markdown Studio\n\nwelcome body — see [[Changelog]] and [[About us]]." },
    starterDocuments: [
      { markdown: "# Changelog\n\nwhat changed; back to [[Markdown Studio]]" },
      { markdown: "# About us\n\nwho we are", folderPath: ["Perssonify"] },
    ],
    initialImportUrl: DEEP_LINK,
  });
}, 30000);

afterAll(() => { cleanup(); globalThis.fetch = realFetch; warn.mockRestore(); err.mockRestore(); });

const importer = () => [...document.querySelectorAll('[role="alertdialog"]')].find((d) => /Import from URL/.test(d.textContent));
const button = (root, text) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(text));

describe("the first run", () => {
  it("seeds the initial document and its companions, and leaves the initial one open", async () => {
    await until(async () => (await adapter.list()).length === 3, "three seeded documents");
    const docs = await adapter.list();
    const byTitle = Object.fromEntries(docs.map((d) => [d.title, d.id]));
    expect(Object.keys(byTitle).sort()).toEqual(["About us", "Changelog", "Markdown Studio"]);
    // The title follows the H1 — "Welcome" is only the fallback.
    await untilHydrated(byTitle["Markdown Studio"]);
    await untilMdHas("welcome body");
    // The companion filed under its folder.
    const { folders, docParents } = useFolderStore.getState();
    expect(folders.find((f) => f.id === docParents[byTitle["About us"]])?.name).toBe("Perssonify");
    expect(textOf((await onDisk(adapter, byTitle.Changelog)).canonical)).toContain("what changed");
  });
});

describe("importing from a URL", () => {
  it("a deep link opens the importer PRE-FILLED, and nothing is fetched until the user says so", async () => {
    const dialog = await until(() => importer(), "the URL importer");
    expect(dialog.querySelector("input").value).toBe(DEEP_LINK);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Continue fetches the archive, lists it, and imports the chosen documents", async () => {
    const zip = buildZip({ "notes/one.md": "# One from the web\n\nfirst", "notes/two.md": "# Two from the web\n\nsecond" });
    fetchSpy.mockImplementation(async () => new Response(zip, { status: 200, headers: { "content-type": "application/zip" } }));
    await click(button(importer(), "Continue"));
    const importBtn = await until(() => button(importer(), "Import 2 documents"), "the archive preview");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toBe(DEEP_LINK);
    const before = new Set((await adapter.list()).map((d) => d.id));
    await click(importBtn);
    await until(async () => (await adapter.list()).length === before.size + 2, "two imported documents");
    await until(() => !importer(), "the importer to close");
    await until(() => /Imported 2 documents/.test(toastText()), "the imported toast");
    const added = (await adapter.list()).filter((d) => !before.has(d.id));
    const one = added.find((d) => d.title === "One from the web");
    const { folders, docParents } = useFolderStore.getState();
    expect(folders.find((f) => f.id === docParents[one.id])?.name).toBe("notes");
    // The first import is the one opened.
    await untilHydrated(one.id);
  });

  it("pasted text imports without any network at all", async () => {
    fetchSpy.mockClear();
    await menuClick("File", "Import", "From URL");
    const dialog = await until(() => importer(), "the importer");
    await act(async () => { fireEvent.change(dialog.querySelector("textarea"), { target: { value: "# Pasted in\n\npasted body" } }); });
    await click(button(dialog, "Continue"));
    const id = await until(() => store().documents.find((d) => d.title === "Pasted in")?.id, "the pasted document");
    expect(textOf((await onDisk(adapter, id)).canonical)).toContain("pasted body");
    expect(fetchSpy).not.toHaveBeenCalled();
    await untilHydrated(id);
    expect(mdText()).toContain("pasted body");
  });
});

describe("preferences", () => {
  it("applied initialMode on first run, and writes a changed mode and a new folder back to preferences", async () => {
    expect(useUIStore.getState().mode).toBe("md");
    await click(screen.getByRole("button", { name: "Split view" }));
    await until(() => adapter.prefs.editorMode === "split", "the mode written back");
    await click(screen.getByLabelText("New folder"));
    await until(() => adapter.prefs.folderTree?.folders?.some((f) => f.name === "New Folder"), "the folder tree written back");
  });
});
