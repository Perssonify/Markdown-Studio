/**
 * A024 — remounting the editor inside a host app must not overwrite the last
 * document.
 *
 * The stores are module singletons and survive an unmount. `initialize()`
 * returned early after the first mount, so a remounted editor either seeded
 * `initialDocument` AGAIN (one more copy per remount) or — with no seed — left
 * the store saying document X was active and hydrated over an EMPTY editor:
 * the first keystroke passed every guard and saved over X.
 *
 * These mount the REAL editor (engine, both panes, stores) in jsdom, unmount
 * it the way a host does, mount it again, type, and press ⌘S.
 */
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PerssonifyEditor } from "../PerssonifyEditor";
import { MemoryStorageAdapter } from "../store/persistence/storage-adapter";
import { createDocument } from "../store/documents/document";
import { useDocumentStore } from "../store/documents/documentStore";

const body = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const text = (c) => JSON.stringify(c);
const tick = (ms = 50) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeAll(() => {
  // Layout APIs a browser has and jsdom lacks. ProseMirror measures ranges
  // (bubble menus, scroll-into-view); without these its measuring throws.
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

async function mount(props) {
  let r;
  await act(async () => { r = render(<PerssonifyEditor {...props} />); });
  return r;
}
/** Until the editor holds the active document (or give up). */
async function untilHydrated(id) {
  for (let i = 0; i < 80 && useDocumentStore.getState().hydratedDocId !== id; i++) await tick();
}
/** Until the rich pane exists (the remounted editor, hydrated or not). */
async function untilEditor() {
  for (let i = 0; i < 80 && !document.querySelector(".ProseMirror")?.editor; i++) await tick();
  await tick(200); // let the init path finish whatever it does after mounting
  return document.querySelector(".ProseMirror").editor;
}

describe("A024: unmount + remount inside a host", () => {
  it("does not let the first keystroke after a remount save over the open document", async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.save(createDocument({ id: "x", title: "X", canonical: body("the stored body") }));

    const first = await mount({ storageAdapter: adapter });
    await untilHydrated("x");
    first.unmount();
    // Unmount released the editor: nothing may claim to hold X now.
    expect(useDocumentStore.getState().hydratedDocId).toBeNull();

    await mount({ storageAdapter: adapter });
    const editor = await untilEditor();
    await untilHydrated("x");
    // The remounted editor was HYDRATED with X (it used to start empty while
    // the store still called it hydrated).
    expect(text(editor.getJSON())).toContain("the stored body");

    // Type, then ⌘S.
    await act(async () => { editor.view.dispatch(editor.state.tr.insertText(" + typed", editor.state.doc.content.size - 1)); });
    await act(async () => { fireEvent.keyDown(document.body, { key: "s", ctrlKey: true }); });
    await tick(300);

    const disk = await adapter.get("x");
    expect(text(disk.canonical)).toContain("the stored body");   // not replaced by the keystroke
    expect(text(disk.canonical)).toContain("+ typed");

    // Unmount is a document-LEAVING path: typing inside the autosave window
    // and then unmounting must not lose it (no editor, and so no unload
    // handler, exists afterwards to save it).
    await act(async () => { editor.view.dispatch(editor.state.tr.insertText(" + before unmount", editor.state.doc.content.size - 1)); });
    cleanup();                                                     // unmount, well inside the 5s autosave
    await tick(200);
    expect(text((await adapter.get("x")).canonical)).toContain("+ before unmount");
  }, 30000);

});
