/**
 * Unmount must not write an emptied editor over the document.
 *
 * Unmounting is a document-leaving path (A024): the editor's draft is cached,
 * stashed and written through, because no editor — and so no unload handler —
 * exists afterwards to save it. That write goes via patchDocById, which has no
 * blank guard of its own (a host clearing a document through the bridge is a
 * legitimate write), so select-all + delete followed by an unmount inside the
 * autosave window persisted a BLANK document over real content: the one write
 * the blank-over-content backstop exists to refuse.
 *
 * Its own file: the stores are module singletons that keep the storage adapter
 * of the first mount, so this cannot share a module registry with another
 * mount-and-unmount case.
 */
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PerssonifyEditor } from "../PerssonifyEditor";
import { MemoryStorageAdapter } from "../store/storage-adapter";
import { createDocument } from "../store/document";
import { useDocumentStore } from "../store/documentStore";

const body = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const tick = (ms = 50) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const rect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 });
  Range.prototype.getClientRects ??= function () { return Object.assign([], { item: () => null }); };
  Range.prototype.getBoundingClientRect ??= rect;
  document.elementFromPoint ??= () => null;
});

let warn;
beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { warn.mockRestore(); });

it("keeps the stored content when an emptied editor is unmounted", async () => {
  const adapter = new MemoryStorageAdapter();
  await adapter.save(createDocument({ id: "y", title: "Y", canonical: body("content that must survive") }));
  await act(async () => { render(<PerssonifyEditor storageAdapter={adapter} />); });
  for (let i = 0; i < 80 && useDocumentStore.getState().hydratedDocId !== "y"; i++) await tick();
  expect(useDocumentStore.getState().hydratedDocId).toBe("y");

  const editor = document.querySelector(".ProseMirror").editor;
  await act(async () => { editor.commands.clearContent(true); });
  cleanup(); // unmount, well inside the autosave window

  // A NEGATIVE assertion: outwait the bad write rather than race it. The
  // write-through clears the cached draft when it lands, so wait for that (or
  // a generous 1.5s) before reading the disk.
  for (let i = 0; i < 30 && useDocumentStore.getState().getUnsavedEdit("y"); i++) await tick(50);
  expect(JSON.stringify((await adapter.get("y")).canonical)).toContain("content that must survive");
}, 30000);
