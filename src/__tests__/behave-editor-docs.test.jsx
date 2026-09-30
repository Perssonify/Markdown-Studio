/**
 * A108 — the editor's document life cycle, driven end to end through the REAL
 * editor (engine, both panes, stores, library panel, menus) in jsdom:
 * restore on boot, type in either pane and see the other follow, save, switch
 * documents from the library, create, rename, duplicate, delete and bring the
 * deleted document back from Version history, read-only, close.
 *
 * One mount for the whole file (the stores are module singletons — see
 * behave-harness.jsx); the cases are one journey and run in order.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react/pure";
import {
  act, click, fireEvent, heading, installBrowserStubs, key, mdText, menuClick, mountEditor, onDisk,
  para, richEditor, seededAdapter, store, storedDoc, textOf, tick, toastText, typeMd, typeRich, until,
  untilHydrated, untilMdHas, untilRichHas,
} from "./behave-harness";
import { useUIStore } from "../store/uiStore";

vi.setConfig({ testTimeout: 30000 });

let adapter;
let warn;
let err;

beforeAll(async () => {
  installBrowserStubs();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
  adapter = await seededAdapter([
    storedDoc("alpha", "Alpha", [heading(1, "Alpha"), para("alpha body")], { updated: "2026-09-01T10:00:00.000Z" }),
    storedDoc("beta", "Beta", [heading(1, "Beta"), para("beta body")], { updated: "2026-09-02T10:00:00.000Z" }),
  ]);
  await mountEditor({ storageAdapter: adapter });
}, 30000);

afterAll(() => {
  cleanup();
  warn.mockRestore();
  err.mockRestore();
});

const row = (id) => document.querySelector(`[role="tree"] [data-key="d:${id}"]`);
const libraryTitles = () => [...document.querySelectorAll('[role="tree"] [role="treeitem"]')].map((r) => r.textContent);

describe("a stored library is restored and shown", () => {
  it("opens a stored document in BOTH panes and lists the library", async () => {
    const id = await until(() => store().hydratedDocId, "a document to be restored");
    const open = id === "alpha" ? "Alpha" : "Beta";
    await untilRichHas(`${open.toLowerCase()} body`);
    await untilMdHas(`# ${open}`);
    await until(() => row("alpha") && row("beta"), "both documents in the library");
    expect(libraryTitles().join(" ")).toMatch(/Alpha/);
    expect(libraryTitles().join(" ")).toMatch(/Beta/);
    // The open document is the one marked in the library.
    expect(row(id).getAttribute("aria-current")).toBe("true");
  });
});

describe("typing, mirroring and saving", () => {
  it("text typed in the rich pane reaches the markdown pane, and ⌘S writes it to disk", async () => {
    const id = store().activeDocId;
    await typeRich(" plus rich typing");
    await untilMdHas("plus rich typing");
    await key(document.querySelector(".ProseMirror"), "s", { ctrlKey: true });
    await until(async () => textOf((await onDisk(adapter, id))?.canonical).includes("plus rich typing"), "the save to land");
    await until(() => /Changes saved/.test(toastText()), "the saved toast");
  });

  it("text typed in the markdown pane reaches the rich pane", async () => {
    await typeMd("\n\nfrom the source pane");
    await untilRichHas("from the source pane");
  });

  it("switching documents from the library saves what was typed and opens the other", async () => {
    const from = store().activeDocId;
    const to = from === "alpha" ? "beta" : "alpha";
    await typeRich(" typed before leaving");
    await click(row(to).querySelector("button")); // the title is the click target
    await untilHydrated(to);
    await untilRichHas(`${to} body`);
    expect(mdText()).toContain(`# ${to === "alpha" ? "Alpha" : "Beta"}`);
    // Leaving is a save: the text typed a moment ago is on disk, not lost.
    await until(async () => textOf((await onDisk(adapter, from))?.canonical).includes("typed before leaving"), "the leaving save");
    expect(textOf((await onDisk(adapter, from)).canonical)).toContain("from the source pane");
  });
});

describe("creating, renaming, duplicating", () => {
  let created;

  it("New document opens an empty document, and its first heading names it", async () => {
    const before = new Set(store().documents.map((d) => d.id));
    await click(screen.getByLabelText("New document"));
    created = await until(() => store().documents.find((d) => !before.has(d.id))?.id, "a new document");
    await untilHydrated(created);
    expect((richEditor().getText() ?? "").trim()).toBe("");
    await typeMd("# Gamma notes\n\ngamma body");
    await untilRichHas("gamma body");
    await key(document.querySelector(".ProseMirror"), "s", { ctrlKey: true });
    await until(async () => (await onDisk(adapter, created))?.title === "Gamma notes", "the new document's title on disk");
    await until(() => row(created)?.textContent.includes("Gamma notes"), "the new title in the library");
  });

  it("F2 on a library row renames the document, on disk and in the library", async () => {
    const r = row(created);
    act(() => r.focus());
    await key(r, "F2");
    const box = await until(() => document.querySelector('[role="tree"] input[aria-label="Document title"]'), "the rename box");
    await act(async () => { fireEvent.change(box, { target: { value: "Renamed gamma" } }); });
    await key(box, "Enter");
    await until(async () => (await onDisk(adapter, created))?.title === "Renamed gamma", "the rename on disk");
    const disk = await onDisk(adapter, created);
    expect(disk.titlePinnedByUser).toBe(true);
    // A rename is a title, not content: the body is untouched.
    expect(textOf(disk.canonical)).toContain("gamma body");
    await until(() => row(created)?.textContent.includes("Renamed gamma"), "the renamed row");
  });

  it("the row menu's Duplicate copies the document into a new one", async () => {
    const before = new Set(store().documents.map((d) => d.id));
    await act(async () => { fireEvent.contextMenu(row(created), { clientX: 5, clientY: 5 }); });
    const dup = await until(() => [...document.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent.trim() === "Duplicate"), "Duplicate");
    await click(dup);
    const copy = await until(() => store().documents.find((d) => !before.has(d.id)), "the copy");
    const disk = await onDisk(adapter, copy.id);
    expect(textOf(disk.canonical)).toContain("gamma body");
    expect(copy.id).not.toBe(created);
  });
});

describe("deleting and bringing it back", () => {
  it("Delete asks first, removes the document from disk, and says a copy is kept", async () => {
    const victim = "beta";
    const before = await onDisk(adapter, victim);
    expect(before).not.toBeNull();
    await act(async () => { fireEvent.contextMenu(row(victim), { clientX: 5, clientY: 5 }); });
    const del = await until(() => [...document.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent.trim() === "Delete"), "Delete");
    await click(del);
    const confirmBtn = await until(() => [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.trim() === "Delete"), "the delete confirmation");
    await click(confirmBtn);
    await until(async () => (await onDisk(adapter, victim)) === null, "the delete on disk");
    await until(() => !row(victim), "the row to leave the library");
    await until(() => /recoverable copy is kept/.test(toastText()), "the recoverable-copy toast");
  });

  it("Version history lists the deleted document and restores it as a new one", async () => {
    await menuClick("Tools", "Version history");
    const sheet = await until(() => [...document.querySelectorAll('[role="dialog"]')].find((d) => /Version history/.test(d.textContent)), "the Version history sheet");
    await until(() => /deleted/i.test(sheet.textContent) && /Beta/.test(sheet.textContent), "the deleted document listed");
    const before = new Set(store().documents.map((d) => d.id));
    const asNew = [...sheet.querySelectorAll("button")].find((b) => b.textContent.includes("As new"));
    await click(asNew);
    const restored = await until(() => store().documents.find((d) => !before.has(d.id)), "the restored document");
    await untilHydrated(restored.id);
    await untilRichHas("beta body");
    expect(textOf((await onDisk(adapter, restored.id)).canonical)).toContain("beta body");
  });
});

describe("read-only", () => {
  const pm = () => document.querySelector(".ProseMirror");
  const selectAllAndBold = async () => {
    await act(async () => { pm().focus(); richEditor().commands.selectAll(); });
    await key(pm(), "b", { ctrlKey: true });
    await tick(100);
  };

  it("⌘B bolds a selection while the document is editable", async () => {
    // The control for the read-only case below: the chord really reaches the
    // dispatcher from the rich pane, so "nothing changed" there means refused.
    await selectAllAndBold();
    expect(textOf(richEditor().getJSON())).toContain('"bold"');
    await selectAllAndBold(); // toggle it back off
    expect(textOf(richEditor().getJSON())).not.toContain('"bold"');
  });

  it("View ▸ Read-only mode locks both panes and hides the formatting toolbar", async () => {
    expect(document.querySelector('[role="toolbar"]')).not.toBeNull();
    await menuClick("View", "Read-only mode");
    await until(() => useUIStore.getState().readOnly === true, "read-only to switch on");
    await until(() => document.querySelector('[role="toolbar"]') === null, "the toolbar to go");
    expect(richEditor().isEditable).toBe(false);
    expect(pm().getAttribute("contenteditable")).toBe("false");
    expect(document.querySelector(".cm-content").getAttribute("contenteditable")).toBe("false");
    // Formatting through the dispatcher is refused as well — ⌘B does nothing.
    const before = textOf(richEditor().getJSON());
    await selectAllAndBold();
    expect(textOf(richEditor().getJSON())).toBe(before);
    await menuClick("View", "Read-only mode");
    await until(() => useUIStore.getState().readOnly === false, "read-only to switch off");
    await until(() => document.querySelector('[role="toolbar"]'), "the toolbar to return");
  });
});

describe("closing", () => {
  it("File ▸ Close document with unsaved typing asks first, and Save keeps it on disk", async () => {
    const open = store().activeDocId;
    const count = (await adapter.list()).length;
    await typeRich(" typed just before closing");
    await until(() => store().saveStatus === "editing", "the document to be dirty");
    await menuClick("File", "Close document");
    const dialog = await until(() => [...document.querySelectorAll('[role="alertdialog"]')].find((d) => /unsaved changes/.test(d.textContent)), "the unsaved-changes prompt");
    await click([...dialog.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save"));
    await until(() => store().activeDocId !== open, "the document to close");
    // Closing is not deleting, and the prompt's Save committed the typing.
    expect((await adapter.list()).length).toBe(count);
    expect(textOf((await onDisk(adapter, open)).canonical)).toContain("typed just before closing");
  });
});
