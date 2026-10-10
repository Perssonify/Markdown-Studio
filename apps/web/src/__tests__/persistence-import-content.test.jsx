/**
 * A034 — the host API's importContent must leave the open document the way
 * every other document-leaving path does.
 *
 * It pushed the imported HTML straight into the live editor: no flush of the
 * pending projection, no draft, no save — whatever was typed in the current
 * autosave window was simply replaced — and a `pmjson` payload was neither
 * saved nor opened at all. It now goes through prepareToLeaveActiveDoc() and
 * activateAndCapture(), like import and addDocuments.
 */
import React, { createRef } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PerssonifyEditor } from "../PerssonifyEditor";
import { MemoryStorageAdapter } from "../store/persistence/storage-adapter";
import { createDocument } from "../store/documents/document";
import { useDocumentStore } from "../store/documents/documentStore";

const para = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
const text = (c) => JSON.stringify(c);
const tick = (ms = 50) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  Range.prototype.getClientRects ??= function () { return Object.assign([], { item: () => null }); };
  Range.prototype.getBoundingClientRect ??= () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 });
});
let warn, err;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { warn.mockRestore(); err.mockRestore(); });

it("keeps what was just typed in the open document, and opens (and saves) the import", async () => {
  const adapter = new MemoryStorageAdapter();
  await adapter.save(createDocument({ id: "x", title: "X", canonical: { type: "doc", content: [para("x body")] } }));
  const handle = createRef();
  await act(async () => { render(<PerssonifyEditor _integrationRef={handle} storageAdapter={adapter} />); });
  for (let i = 0; i < 80 && useDocumentStore.getState().hydratedDocId !== "x"; i++) await tick();

  // Typing inside the autosave window…
  const editor = document.querySelector(".ProseMirror").editor;
  await act(async () => { editor.view.dispatch(editor.state.tr.insertText(" + typed", editor.state.doc.content.size - 1)); });

  // …then the host imports.
  let doc;
  await act(async () => { doc = await handle.current.importContent("# Imported\n\nimported body", "markdown"); });
  await tick(200);

  expect(text((await adapter.get("x")).canonical)).toContain("+ typed");      // the goodbye
  expect(text((await adapter.get(doc.id)).canonical)).toContain("imported body");
  const s = useDocumentStore.getState();
  expect(s.activeDocId).toBe(doc.id);
  expect(s.hydratedDocId).toBe(doc.id);                                         // really open

  // A pmjson payload is saved and opened too (it used to do neither).
  let json;
  await act(async () => {
    json = await handle.current.importContent(JSON.stringify({ type: "doc", content: [para("json body")] }), "pmjson");
  });
  await tick(200);
  expect(text((await adapter.get(json.id)).canonical)).toContain("json body");
  expect(useDocumentStore.getState().activeDocId).toBe(json.id);
  expect(useDocumentStore.getState().hydratedDocId).toBe(json.id);
  expect(text(document.querySelector(".ProseMirror").editor.getJSON())).toContain("json body");
}, 40000);
