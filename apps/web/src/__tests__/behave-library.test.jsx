/**
 * A108 — the library (`ui/WorkspacePanel.tsx` + `ui/FolderTree.tsx`) as a user
 * drives it: tabs, the Outline, resizing, the phone drawer, search and its
 * keyboard-operable results list, rename, the row menus (dropdown and
 * right-click), select mode with bulk export and delete, new documents and
 * folders, dropping files to import, drag-and-drop moves and reorders in the
 * tree, and a large library staying windowed.
 *
 * library-tree-keyboard / library-panel-perf / library-windowing pin the audit
 * defects (A066, A082, A094); this file covers the rest of what the panel does.
 */
import { act, cleanup, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDocumentStore } from "../store/documentStore";
import { useFolderStore } from "../store/folders";
import { DOCNAV_WIDTH_MIN, docNavWidthMax, useUIStore } from "../store/uiStore";
import { DialogProvider } from "../ui/DialogProvider";
import { DND_MIME } from "../ui/folder-dnd";
import { WorkspacePanel } from "../ui/WorkspacePanel";

const BASE = Date.parse("2026-09-01T00:00:00Z");
const summary = (id, title, i = 0, extra = {}) => ({
  id, title, updated: new Date(BASE + i * 1000).toISOString(), created: new Date(BASE).toISOString(),
  wordCount: 10 + i, tags: [], hasResiduals: false, originFormat: "md", ...extra,
});

let confirm;
function mount(props = {}, { documents, activeDocId = null, folders = [], docParents = {}, expanded = {} } = {}) {
  useDocumentStore.setState({ documents, activeDocId });
  useFolderStore.setState({ folders, docParents, docOrder: {}, expanded, lastCreatedFolderId: null });
  confirm = vi.fn(async () => true);
  const handlers = {
    tab: "files", onTabChange: vi.fn(), onClose: vi.fn(), onOpenCards: vi.fn(), width: 280, onResize: vi.fn(),
    onSelect: vi.fn(), onNew: vi.fn(), onDelete: vi.fn(async () => {}), onRename: vi.fn(), onDuplicate: vi.fn(),
    onFileDrop: vi.fn(), onExportFolder: vi.fn(), onExportDocs: vi.fn(), onExportDoc: vi.fn(),
    onSearchBody: vi.fn(() => false), headings: [], activeIndex: null, onNavigateHeading: vi.fn(),
    ...props,
  };
  const dialogApi = { confirm, prompt: async () => null, equation: async () => null, confirmUnsaved: async () => "cancel" };
  const utils = render(
    <DialogProvider value={dialogApi}>
      <TooltipProvider>
        <WorkspacePanel {...handlers} />
      </TooltipProvider>
    </DialogProvider>
  );
  return { ...utils, h: handlers };
}

const settle = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
const treeRow = (key) => document.querySelector(`[role="tree"] [data-key="${key}"]`);
const options = () => [...document.querySelectorAll('[role="listbox"] [role="option"]')];
const press = (el, key, opts = {}) => act(async () => { fireEvent.keyDown(el, { key, ...opts }); });
const menuItem = (label) => [...document.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent.trim() === label);
async function pick(...labels) {
  for (let i = 0; i < labels.length; i++) {
    let item;
    for (let t = 0; t < 40 && !(item = menuItem(labels[i])); t++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    if (!item) throw new Error(`no menu item ${labels[i]}`);
    await act(async () => {
      if (i < labels.length - 1) { fireEvent.mouseEnter(item); fireEvent.pointerEnter?.(item); }
      fireEvent.click(item);
    });
  }
}
function dragData(payload) {
  const data = payload ? { [DND_MIME]: JSON.stringify(payload) } : {};
  return {
    types: payload ? [DND_MIME] : ["Files"],
    getData: (t) => data[t] ?? "",
    setData: (t, v) => { data[t] = v; },
    dropEffect: "none", effectAllowed: "all", files: [],
  };
}
/** Give a row a real box, so the drop-zone maths (top quarter / middle / bottom) means something. */
function boxed(el, top = 100, height = 40) {
  el.getBoundingClientRect = () => ({ top, bottom: top + height, height, left: 0, right: 200, width: 200, x: 0, y: top });
  return { top: top + 2, middle: top + height / 2, bottom: top + height - 2 };
}
/** A drag event at a pointer height. jsdom has no DragEvent, so the generic
 *  event testing-library builds drops `clientY`; set it on the event itself. */
async function dragAt(type, el, dataTransfer, clientY) {
  const ev = createEvent[type](el, { dataTransfer });
  Object.defineProperty(ev, "clientY", { value: clientY });
  await act(async () => { fireEvent(el, ev); });
  return ev;
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  useUIStore.setState({ contextMenuEnabled: true });
  window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => {
  cleanup();
  useDocumentStore.setState({ documents: [], activeDocId: null });
  useFolderStore.setState({ folders: [], docParents: {}, docOrder: {}, expanded: {}, lastCreatedFolderId: null });
});

describe("the panel's frame", () => {
  it("switches tabs, opens Cards, closes, and shows the Outline", async () => {
    const { h, rerender } = mount({}, { documents: [summary("a", "A")] });
    fireEvent.click(screen.getByTitle("Outline"));
    expect(h.onTabChange).toHaveBeenCalledWith("outline");
    fireEvent.click(screen.getByLabelText("Open the Cards board"));
    expect(h.onOpenCards).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Close workspace panel"));
    expect(h.onClose).toHaveBeenCalled();

    const headings = [{ level: 1, text: "Intro" }, { level: 2, text: "Details" }];
    rerender(
      <DialogProvider value={{ confirm, prompt: async () => null, equation: async () => null, confirmUnsaved: async () => "cancel" }}>
        <TooltipProvider><WorkspacePanel {...h} tab="outline" headings={headings} activeIndex={1} /></TooltipProvider>
      </DialogProvider>
    );
    fireEvent.click(screen.getByText("Details"));
    expect(h.onNavigateHeading).toHaveBeenCalledWith(1);
    expect(screen.queryByLabelText("Search documents")).toBeNull(); // the Files tab is not rendered
  });

  it("the resize separator is keyboard-operable, and a window resize re-applies the width", async () => {
    const { h } = mount({}, { documents: [] });
    const sep = screen.getByRole("separator", { name: "Resize workspace panel" });
    expect(sep.getAttribute("aria-valuenow")).toBe("280");
    await press(sep, "ArrowRight");
    expect(h.onResize).toHaveBeenLastCalledWith(296);
    await press(sep, "ArrowLeft");
    expect(h.onResize).toHaveBeenLastCalledWith(264);
    await press(sep, "Home");
    expect(h.onResize).toHaveBeenLastCalledWith(DOCNAV_WIDTH_MIN);
    await press(sep, "End");
    expect(h.onResize).toHaveBeenLastCalledWith(docNavWidthMax());
    await act(async () => { window.dispatchEvent(new Event("resize")); });
    expect(h.onResize).toHaveBeenLastCalledWith(280);
  });

  it("as a phone drawer it takes focus, closes on Escape, and hands focus back", async () => {
    window.matchMedia = (q) => ({ matches: q.includes("max-width: 767px"), media: q, addEventListener() {}, removeEventListener() {} });
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { h, unmount } = mount({}, { documents: [summary("a", "A")] });
    await settle();
    const aside = screen.getByLabelText("Workspace");
    expect(document.activeElement).toBe(aside);
    await press(aside, "Escape");
    expect(h.onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe("search and the results list", () => {
  const docs = [
    summary("a", "Alpha plan", 3, { tags: ["work"] }),
    summary("b", "Beta notes", 2),
    summary("c", "Gamma", 1),
  ];

  it("matches titles, tags and — through the host — body text", async () => {
    const { h } = mount({ onSearchBody: vi.fn((id, q) => id === "c" && q === "secret") }, { documents: docs });
    const box = screen.getByLabelText("Search documents");
    await act(async () => { fireEvent.change(box, { target: { value: "notes" } }); });
    expect(options().map((o) => o.getAttribute("data-key"))).toEqual(["b"]);
    await act(async () => { fireEvent.change(box, { target: { value: "WORK" } }); });
    expect(options().map((o) => o.getAttribute("data-key"))).toEqual(["a"]);
    await act(async () => { fireEvent.change(box, { target: { value: "secret" } }); });
    expect(options().map((o) => o.getAttribute("data-key"))).toEqual(["c"]);
    expect(h.onSearchBody).toHaveBeenCalledWith("c", "secret");
    await act(async () => { fireEvent.change(box, { target: { value: "nothing like it" } }); });
    expect(screen.getByText("No results")).toBeTruthy();
  });

  it("the results are ONE tab stop, walked with the arrows, opened with Enter", async () => {
    const { h } = mount({}, { documents: docs, activeDocId: "b" });
    await act(async () => { fireEvent.change(screen.getByLabelText("Search documents"), { target: { value: "a" } }); });
    const list = screen.getByRole("listbox", { name: "Search results" });
    const stops = options().filter((o) => o.tabIndex === 0);
    expect(stops.map((o) => o.getAttribute("data-key"))).toEqual(["b"]); // the open document
    expect(stops[0].getAttribute("aria-current")).toBe("true");
    act(() => stops[0].focus());
    await press(document.activeElement, "Home");
    expect(document.activeElement.getAttribute("data-key")).toBe(options()[0].getAttribute("data-key"));
    await press(document.activeElement, "End");
    const last = options().at(-1).getAttribute("data-key");
    expect(document.activeElement.getAttribute("data-key")).toBe(last);
    await press(document.activeElement, "ArrowUp");
    await press(document.activeElement, "ArrowDown");
    expect(document.activeElement.getAttribute("data-key")).toBe(last);
    await press(document.activeElement, "Enter");
    expect(h.onSelect).toHaveBeenCalledWith(last);
    expect(within(list).getAllByRole("option").length).toBeGreaterThan(0);
  });

  it("F2 renames from the results; Escape cancels; the ⋮ menu duplicates, exports and deletes", async () => {
    const { h } = mount({}, { documents: docs });
    await act(async () => { fireEvent.change(screen.getByLabelText("Search documents"), { target: { value: "beta" } }); });
    const row = options()[0];
    act(() => row.focus());
    await press(row, "F2");
    let input = screen.getByLabelText("Document title");
    await act(async () => { fireEvent.change(input, { target: { value: "  Beta renamed  " } }); });
    await press(input, "Enter");
    expect(h.onRename).toHaveBeenCalledWith("b", "Beta renamed");
    act(() => options()[0].focus());
    await press(options()[0], "F2");
    input = screen.getByLabelText("Document title");
    await act(async () => { fireEvent.change(input, { target: { value: "not this" } }); });
    await press(input, "Escape");
    expect(h.onRename).toHaveBeenCalledTimes(1);

    await press(options()[0], "F10", { shiftKey: true });
    await pick("Duplicate");
    expect(h.onDuplicate).toHaveBeenCalledWith("b");
    await press(options()[0], "ContextMenu");
    await pick("Export", "Word (.docx)");
    expect(h.onExportDoc).toHaveBeenCalledWith("b", "docx");
    await press(options()[0], "ContextMenu");
    await pick("Delete");
    expect(h.onDelete).toHaveBeenCalledWith("b");
  });
});

describe("select mode", () => {
  it("selects documents, exports and deletes them in bulk, one delete at a time", async () => {
    const order = [];
    const onDelete = vi.fn(async (id, skip) => {
      order.push(`start ${id} ${skip}`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`end ${id}`);
    });
    const { h } = mount({ onDelete }, { documents: [summary("a", "A", 3), summary("b", "B", 2), summary("c", "C", 1)] });
    fireEvent.click(screen.getByLabelText("Select documents"));
    expect(screen.getByRole("listbox", { name: "Select documents" }).getAttribute("aria-multiselectable")).toBe("true");
    fireEvent.click(options().find((o) => o.getAttribute("data-key") === "a"));
    fireEvent.click(options().find((o) => o.getAttribute("data-key") === "c"));
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(options().filter((o) => o.getAttribute("aria-selected") === "true").map((o) => o.getAttribute("data-key"))).toEqual(["a", "c"]);
    fireEvent.click(screen.getByLabelText("Export 2 selected as ZIP"));
    expect(h.onExportDocs).toHaveBeenCalledWith(["a", "c"], "documents");
    await act(async () => { fireEvent.click(screen.getByLabelText("Delete 2 selected")); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Delete 2 documents?", destructive: true }));
    // Sequential: each delete finishes before the next starts, and skips its own prompt.
    expect(order).toEqual(["start a true", "end a", "start c true", "end c"]);
    expect(screen.getByLabelText("Select documents")).toBeTruthy(); // back out of select mode
  });

  it("Select all / Deselect all, a declined confirmation deletes nothing, Cancel leaves", async () => {
    const { h } = mount({}, { documents: [summary("a", "A", 2), summary("b", "B", 1)] });
    fireEvent.click(screen.getByLabelText("Select documents"));
    fireEvent.click(screen.getByLabelText("Select all"));
    expect(screen.getByLabelText("Deselect all (2 selected)")).toBeTruthy();
    confirm.mockResolvedValueOnce(false);
    await act(async () => { fireEvent.click(screen.getByLabelText("Delete 2 selected")); });
    expect(h.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Deselect all (2 selected)"));
    expect(screen.getByText("2 documents")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Cancel selection"));
    expect(screen.getByRole("tree")).toBeTruthy(); // the tree again
  });
});

describe("creating", () => {
  it("New document asks the host; New folder opens its name box, and Enter names it", async () => {
    const { h } = mount({}, { documents: [summary("a", "A")] });
    fireEvent.click(screen.getByLabelText("New document"));
    expect(h.onNew).toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByLabelText("New folder")); });
    await settle();
    const box = screen.getByLabelText("Folder name");
    expect(document.activeElement).toBe(box);
    await act(async () => { fireEvent.change(box, { target: { value: "Receipts" } }); });
    await press(box, "Enter");
    expect(useFolderStore.getState().folders.map((f) => f.name)).toEqual(["Receipts"]);
    expect(treeRow(`f:${useFolderStore.getState().folders[0].id}`).textContent).toContain("Receipts");
  });

  it("files dragged over the panel show the drop zone, and dropping imports them", async () => {
    const { h, container } = mount({}, { documents: [] });
    expect(screen.getByText("No documents")).toBeTruthy();
    const zone = container.querySelector(".relative.flex.min-h-0.flex-1.flex-col");
    const files = [new File(["# x"], "x.md")];
    const dt = { types: ["Files"], files, dropEffect: "none" };
    await act(async () => { fireEvent.dragEnter(zone, { dataTransfer: dt }); });
    expect(screen.getByText("Drop to Import")).toBeTruthy();
    await act(async () => { fireEvent.dragOver(zone, { dataTransfer: dt }); });
    await act(async () => { fireEvent.drop(zone, { dataTransfer: dt }); });
    expect(screen.queryByText("Drop to Import")).toBeNull();
    expect(h.onFileDrop).toHaveBeenCalledWith(files);
    await act(async () => { fireEvent.dragEnter(zone, { dataTransfer: dt }); });
    await act(async () => { fireEvent.dragLeave(zone, { dataTransfer: dt }); });
    expect(screen.queryByText("Drop to Import")).toBeNull();
  });
});

describe("the folder tree", () => {
  const setup = (props = {}) => mount(props, {
    documents: [summary("d1", "One", 3), summary("d2", "Two", 2), summary("d3", "Three", 1)],
    folders: [{ id: "A", name: "Alpha", parentId: null }, { id: "B", name: "Bravo", parentId: null }],
    docParents: { d1: "A", d2: "A" },
    expanded: { A: true },
  });

  it("clicking a folder opens and closes it; clicking a document opens it", async () => {
    const { h } = setup();
    expect(treeRow("d:d1")).not.toBeNull();
    await act(async () => { fireEvent.click(treeRow("f:A").querySelector("button")); });
    expect(useFolderStore.getState().expanded.A).toBe(false);
    expect(treeRow("d:d1")).toBeNull();
    await act(async () => { fireEvent.click(treeRow("d:d3").querySelector("button")); });
    expect(h.onSelect).toHaveBeenCalledWith("d3");
  });

  it("a document dragged onto a folder moves into it; onto the top-level strip, out again", async () => {
    setup();
    const dt = dragData({ kind: "doc", id: "d3" });
    await act(async () => { fireEvent.dragStart(treeRow("d:d3"), { dataTransfer: dt }); });
    const y = boxed(treeRow("f:B"));
    await dragAt("dragOver", treeRow("f:B"), dt, y.middle);
    expect(treeRow("f:B").className).toContain("bg-primary/10"); // the "into" highlight
    await dragAt("drop", treeRow("f:B"), dt, y.middle);
    expect(useFolderStore.getState().docParents.d3).toBe("B");

    const strip = [...document.querySelectorAll("div[aria-hidden]")].find((d) => d.className.includes("border-dashed"));
    await act(async () => { fireEvent.dragOver(strip, { dataTransfer: dt }); });
    expect(strip.textContent).toBe("Drop here to move to top level");
    await act(async () => { fireEvent.drop(strip, { dataTransfer: dt }); });
    expect(useFolderStore.getState().docParents.d3).toBeUndefined();
  });

  it("dropping a document before or after another reorders the folder", async () => {
    setup();
    const dt = dragData({ kind: "doc", id: "d1" });
    const y = boxed(treeRow("d:d2"));
    await dragAt("dragOver", treeRow("d:d2"), dt, y.bottom);
    await dragAt("drop", treeRow("d:d2"), dt, y.bottom);
    expect(useFolderStore.getState().docOrder).toMatchObject({ A: ["d2", "d1"] });
    const inA = [...document.querySelectorAll('[role="tree"] [data-key^="d:"]')].map((r) => r.getAttribute("data-key")).filter((k) => k !== "d:d3");
    expect(inA).toEqual(["d:d2", "d:d1"]);
  });

  it("a folder dropped into another nests; dropped at an edge, it reorders among its siblings", async () => {
    setup();
    const dtB = dragData({ kind: "folder", id: "B" });
    let y = boxed(treeRow("f:A"));
    await dragAt("dragOver", treeRow("f:A"), dtB, y.top);
    await dragAt("drop", treeRow("f:A"), dtB, y.top);
    expect(useFolderStore.getState().folders.find((f) => f.id === "B").parentId).toBeNull();
    const roots = () => [...document.querySelectorAll('[role="tree"] [aria-level="1"][data-key^="f:"]')].map((r) => r.getAttribute("data-key"));
    expect(roots()).toEqual(["f:B", "f:A"]);
    y = boxed(treeRow("f:A"));
    await dragAt("dragOver", treeRow("f:A"), dtB, y.middle);
    await dragAt("drop", treeRow("f:A"), dtB, y.middle);
    expect(useFolderStore.getState().folders.find((f) => f.id === "B").parentId).toBe("A");
  });

  it("the folder's menu renames, exports, backs up and deletes (asking first)", async () => {
    const { h } = setup({ confirmDeleteFolder: undefined });
    await act(async () => { fireEvent.contextMenu(treeRow("f:A"), { clientX: 5, clientY: 5 }); });
    await pick("Export as ZIP");
    expect(h.onExportFolder).toHaveBeenLastCalledWith("A");
    await act(async () => { fireEvent.contextMenu(treeRow("f:A"), { clientX: 5, clientY: 5 }); });
    await pick("Full backup (.zip)");
    expect(h.onExportFolder).toHaveBeenLastCalledWith("A", { canonical: true });

    await act(async () => { fireEvent.contextMenu(treeRow("f:A"), { clientX: 5, clientY: 5 }); });
    await pick("Rename");
    const box = screen.getByLabelText("Folder name");
    await act(async () => { fireEvent.change(box, { target: { value: "Archive" } }); });
    await press(box, "Enter");
    expect(useFolderStore.getState().folders.find((f) => f.id === "A").name).toBe("Archive");

    await act(async () => { fireEvent.contextMenu(treeRow("f:A"), { clientX: 5, clientY: 5 }); });
    await pick("Delete folder");
    await settle();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete folder "Archive"?' }));
    expect(useFolderStore.getState().folders.map((f) => f.id)).toEqual(["B"]);
    // Its documents moved up rather than disappearing.
    expect(treeRow("d:d1")).not.toBeNull();
  });

  it("a document's menu moves it to another folder or into a new one", async () => {
    setup();
    await act(async () => { fireEvent.contextMenu(treeRow("d:d3"), { clientX: 5, clientY: 5 }); });
    await pick("Move to", "Bravo");
    expect(useFolderStore.getState().docParents.d3).toBe("B");
    await act(async () => { fireEvent.contextMenu(treeRow("d:d1"), { clientX: 5, clientY: 5 }); });
    await pick("Move to", "Root");
    expect(useFolderStore.getState().docParents.d1).toBeUndefined();
    await act(async () => { fireEvent.contextMenu(treeRow("d:d1"), { clientX: 5, clientY: 5 }); });
    await pick("Move to", "New folder here…");
    await settle();
    const created = useFolderStore.getState().folders.find((f) => f.name === "New Folder");
    expect(useFolderStore.getState().docParents.d1).toBe(created.id);
    expect(document.activeElement).toBe(screen.getByLabelText("Folder name")); // named by the user next
  });

  it("Shift+F10 on a row opens the SAME items in the ⋮ dropdown", async () => {
    const { h } = setup();
    const row = treeRow("d:d3");
    act(() => row.focus());
    await press(row, "F10", { shiftKey: true });
    await pick("Export", "Backup (.json)");
    expect(h.onExportDoc).toHaveBeenCalledWith("d3", "json");
    act(() => treeRow("d:d3").focus());
    await press(treeRow("d:d3"), "ContextMenu");
    await pick("Duplicate");
    expect(h.onDuplicate).toHaveBeenCalledWith("d3");
    // (The dropdown's Rename is not driven here: in jsdom the menu hands focus
    // back to its trigger synchronously, which blurs — and so commits — the new
    // rename box at once. In Chromium the box opens focused and stays; checked
    // with a probe against the built app.)
    act(() => treeRow("f:B").focus());
    await press(treeRow("f:B"), "F10", { shiftKey: true });
    await pick("New subfolder");
    await settle();
    expect(useFolderStore.getState().folders.some((f) => f.parentId === "B")).toBe(true);
  });

  it("with the custom menu switched off, a right-click is left to the browser", async () => {
    useUIStore.setState({ contextMenuEnabled: false });
    setup();
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    treeRow("d:d1").dispatchEvent(e);
    await settle();
    expect(e.defaultPrevented).toBe(false);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});

describe("a large library", () => {
  it("renders a window of rows, and the search results are windowed too", async () => {
    const docs = Array.from({ length: 1500 }, (_, i) => summary(`n${i}`, `Note ${i}`, i));
    const { h } = mount({}, { documents: docs });
    expect(document.querySelectorAll('[role="treeitem"]').length).toBeLessThan(80);
    expect(screen.getByText("1500 documents")).toBeTruthy();
    await act(async () => { fireEvent.change(screen.getByLabelText("Search documents"), { target: { value: "note 1" } }); });
    expect(options().length).toBeLessThan(80);
    act(() => options()[0].focus());
    await press(document.activeElement, "End");
    // The last result exists (mounted on demand) and is focused.
    expect(document.activeElement.getAttribute("role")).toBe("option");
    await press(document.activeElement, "Enter");
    expect(h.onSelect).toHaveBeenCalledTimes(1);
    expect(h.onSelect.mock.calls[0][0]).toMatch(/^n1/);
  });
});
