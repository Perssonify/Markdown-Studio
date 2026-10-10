import { act, fireEvent, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDocumentStore } from "../store/documents/documentStore";
import { useFolderStore } from "../store/documents/folders";
import { DialogProvider } from "../ui/dialogs/dialogProvider";
import { DND_MIME } from "../ui/workspace/folderTree/folder-dnd";
import { FolderTree } from "../ui/workspace/folderTree";
import { WorkspacePanel } from "../ui/workspace/workspacePanel";

/**
 * A094 (the tree claimed role="tree" but its arrow keys did nothing; the phone
 * drawer neither took focus nor closed on Escape) and A066 (a folder dropped on
 * a document row landed at the top level), driven through the real components.
 */

const doc = (id, i = 0) => ({
  id, title: `Doc ${id}`, updated: new Date(Date.UTC(2026, 8, 1) + i * 1000).toISOString(),
  created: "2026-09-01T00:00:00Z", wordCount: 5, tags: [], hasResiduals: false, originFormat: "md",
});

function setTree({ folders = [], docParents = {}, expanded = {} } = {}) {
  useFolderStore.setState({ folders, docParents, docOrder: {}, expanded, lastCreatedFolderId: null });
}

function mountTree(documents, props = {}) {
  const onSelect = vi.fn();
  const utils = render(
    <FolderTree documents={documents} activeDocId={null} onSelect={onSelect}
      onRename={() => {}} onDelete={() => {}} onDuplicate={() => {}} {...props} />
  );
  return { ...utils, onSelect };
}

const items = (c) => [...c.querySelectorAll('[role="treeitem"]')];
const key = (el) => el?.getAttribute("data-key");
const press = (k, opts = {}) => fireEvent.keyDown(document.activeElement, { key: k, ...opts });

afterEach(() => { setTree(); });

describe("the folder tree is keyboard-operable (A094)", () => {
  function setup() {
    setTree({
      folders: [{ id: "A", name: "Alpha", parentId: null }, { id: "C", name: "Charlie", parentId: null }],
      docParents: { a1: "A", a2: "A" },
    });
    const docs = [doc("a1", 1), doc("a2", 2), doc("r1", 3)];
    return mountTree(docs);
  }

  it("is ONE tab stop — the rows, not the buttons inside them", () => {
    const { container } = setup();
    const stops = [...container.querySelectorAll("button, [tabindex]")].filter((el) => el.tabIndex >= 0);
    expect(stops).toHaveLength(1);
    expect(stops[0].getAttribute("role")).toBe("treeitem");
  });

  it("walks rows with the arrows and opens/closes folders with Right/Left", () => {
    const { container } = setup();
    act(() => items(container)[0].focus()); // Alpha
    press("ArrowDown");
    expect(key(document.activeElement)).toBe("f:C");
    press("ArrowUp");
    expect(key(document.activeElement)).toBe("f:A");

    press("ArrowRight"); // closed → opens
    expect(useFolderStore.getState().expanded.A).toBe(true);
    expect(items(container).map(key)).toEqual(["f:A", "d:a2", "d:a1", "f:C", "d:r1"]);
    press("ArrowRight"); // open → first child
    expect(key(document.activeElement)).toBe("d:a2");
    press("ArrowLeft"); // child → parent
    expect(key(document.activeElement)).toBe("f:A");
    press("ArrowLeft"); // open → closes
    expect(useFolderStore.getState().expanded.A).toBe(false);

    press("End");
    expect(key(document.activeElement)).toBe("d:r1");
    press("Home");
    expect(key(document.activeElement)).toBe("f:A");
  });

  it("keeps exactly one tab stop as focus moves, and Enter opens a document", () => {
    const { container, onSelect } = setup();
    act(() => items(container)[0].focus());
    press("End");
    const stops = items(container).filter((el) => el.tabIndex === 0).map(key);
    expect(stops).toEqual(["d:r1"]);
    press("Enter");
    expect(onSelect).toHaveBeenCalledWith("r1");
  });

  it("reaches a row that was not mounted, and keeps the focused row mounted", () => {
    // 400 documents: the last one is far outside the rendered window.
    setTree();
    const docs = Array.from({ length: 400 }, (_, i) => doc(`n${i}`, i));
    const { container } = mountTree(docs);
    expect(items(container).length).toBeLessThan(60);
    act(() => items(container)[0].focus());
    press("End");
    // Sorted newest first, so the last row is the OLDEST document.
    expect(key(document.activeElement)).toBe("d:n0");
    expect(document.activeElement.isConnected).toBe(true);
  });
});

describe("the ONE shared row menu serves every row (A082)", () => {
  function setup() {
    setTree({ folders: [{ id: "A", name: "Alpha", parentId: null }] });
    return mountTree([doc("r1", 1), doc("r2", 2)]);
  }

  it("right-click opens the shared context menu with THAT row's items", async () => {
    const { container, findByText, queryByText } = setup();
    const row = container.querySelector('[data-key="d:r1"]');
    await act(async () => { fireEvent.contextMenu(row, { clientX: 10, clientY: 10 }); });
    const rename = await findByText("Rename");
    // A document row's body, not a folder's.
    expect(queryByText("New subfolder")).toBeNull();
    await act(async () => { fireEvent.click(rename); });
    expect(container.querySelector('[data-key="d:r1"] input')?.value).toBe("Doc r1");
  });

  it("Shift+F10 on a focused row opens its menu from the keyboard", async () => {
    const { container, findByText } = setup();
    const folder = container.querySelector('[data-key="f:A"]');
    act(() => folder.focus());
    await act(async () => { fireEvent.keyDown(folder, { key: "F10", shiftKey: true }); });
    expect(await findByText("New subfolder")).toBeTruthy();
  });

  it("F2 renames the focused row", () => {
    const { container } = setup();
    const row = container.querySelector('[data-key="d:r2"]');
    act(() => row.focus());
    fireEvent.keyDown(row, { key: "F2" });
    expect(container.querySelector('[data-key="d:r2"] input')?.value).toBe("Doc r2");
  });
});

/** A DataTransfer good enough for the tree's drag handlers. */
function dataTransfer(payload) {
  const data = { [DND_MIME]: JSON.stringify(payload) };
  return {
    types: [DND_MIME],
    getData: (t) => data[t] ?? "",
    setData: (t, v) => { data[t] = v; },
    effectAllowed: "move",
    dropEffect: "move",
  };
}

describe("a folder dropped on a document row (A066)", () => {
  it("goes into that document's folder — not to the top level", () => {
    setTree({
      folders: [
        { id: "A", name: "Alpha", parentId: null },
        { id: "G", name: "Golf", parentId: null },
      ],
      docParents: { a1: "A" },
      expanded: { A: true },
    });
    const { container } = mountTree([doc("a1", 1)]);
    const row = container.querySelector('[data-key="d:a1"]');
    const dt = dataTransfer({ kind: "folder", id: "G" });
    fireEvent.dragOver(row, { dataTransfer: dt, clientY: 0 });
    const drop = fireEvent.drop(row, { dataTransfer: dt, clientY: 0 });
    expect(drop).toBe(false); // handled (preventDefault), not left to bubble
    // Before the fix the tree ROOT's handler caught it: moveFolder(G, null).
    expect(useFolderStore.getState().folders.find((f) => f.id === "G").parentId).toBe("A");
  });
});

const dialogApi = { confirm: async () => true, prompt: async () => null, equation: async () => null, confirmUnsaved: async () => "cancel" };

function mountPanel(props = {}) {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const utils = render(
    <div>
      <button id="opener">open</button>
      <DialogProvider value={dialogApi}>
        <TooltipProvider>
          <WorkspacePanel
            tab="files" onTabChange={() => {}} onClose={onClose} width={320} onResize={() => {}}
            onSelect={onSelect} onNew={() => {}} onDelete={() => {}} onRename={() => {}} onDuplicate={() => {}}
            headings={[]} activeIndex={null} onNavigateHeading={() => {}}
            {...props}
          />
        </TooltipProvider>
      </DialogProvider>
    </div>
  );
  return { ...utils, onClose, onSelect };
}

describe("the flat search list is a keyboard listbox", () => {
  afterEach(() => { useDocumentStore.setState({ documents: [], activeDocId: null }); });

  it("moves with the arrows and opens with Enter", () => {
    setTree();
    useDocumentStore.setState({ documents: [doc("x1", 1), doc("x2", 2), doc("x3", 3)], activeDocId: null });
    const { container, getByLabelText, onSelect } = mountPanel();
    act(() => { fireEvent.change(getByLabelText("Search documents"), { target: { value: "doc" } }); });
    const list = container.querySelector('[role="listbox"]');
    expect(list).not.toBeNull();
    const options = () => [...list.querySelectorAll('[role="option"]')];
    expect(options().filter((o) => o.tabIndex === 0)).toHaveLength(1);
    act(() => options()[0].focus());
    press("ArrowDown");
    expect(document.activeElement).toBe(options()[1]);
    press("Enter");
    expect(onSelect).toHaveBeenCalledWith(options()[1].getAttribute("data-key"));
  });
});

describe("the phone drawer manages focus (A094)", () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
    useDocumentStore.setState({ documents: [], activeDocId: null });
  });
  const asPhone = (phone) => {
    window.matchMedia = vi.fn((q) => ({
      matches: phone && q.includes("max-width: 767px"),
      media: q, addEventListener() {}, removeEventListener() {},
    }));
  };

  it("takes focus when it opens, closes on Escape, and gives focus back", () => {
    asPhone(true);
    setTree();
    const opener = document.createElement("button");
    document.body.append(opener);
    act(() => opener.focus());
    const { container, onClose, unmount } = mountPanel();
    const aside = container.querySelector('aside[aria-label="Workspace"]');
    expect(document.activeElement).toBe(aside);
    fireEvent.keyDown(aside, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount(); // the parent closes it
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("falls back to the reopen control when the opener no longer exists", () => {
    // The editor's "Open workspace panel" button unmounts while the panel is
    // open, so the element that opened the drawer is gone by the time it closes.
    asPhone(true);
    setTree();
    const opener = document.createElement("button");
    document.body.append(opener);
    act(() => opener.focus());
    const { unmount } = mountPanel();
    opener.remove(); // what the editor does to its reopen button
    const reopen = document.createElement("button");
    reopen.setAttribute("aria-label", "Open workspace panel");
    document.body.append(reopen); // …and what it mounts when the panel closes
    unmount();
    expect(document.activeElement).toBe(reopen);
    reopen.remove();
  });

  it("does neither when docked beside the editor on a wide screen", () => {
    asPhone(false);
    setTree();
    const { container, onClose } = mountPanel();
    const aside = container.querySelector('aside[aria-label="Workspace"]');
    expect(document.activeElement).not.toBe(aside); // docked: no focus theft
    fireEvent.keyDown(aside, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
