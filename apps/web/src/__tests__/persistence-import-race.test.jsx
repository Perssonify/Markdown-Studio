/**
 * A031 — opening a document while a multi-file import runs must not turn an
 * imported file into an empty "Untitled".
 *
 * The import loop BORROWED the live editor for every file: activate it, push
 * its HTML into the rich pane, yield a frame, read the canonical back. A switch
 * landing in that window hydrated the user's document instead, and the
 * fallback persisted the file's pre-editor canonical — blank, titled
 * "Untitled" — while counting it as imported; each later file then yanked the
 * store off the user's choice. Files are now converted headlessly and nothing
 * in the loop touches the editor.
 *
 * Real editor, real import path (a file drop), and a click on another
 * document fired from inside the import's own first write.
 */
import React, { createRef } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PerssonifyEditor } from "../PerssonifyEditor";
import { MemoryStorageAdapter } from "../store/persistence/storage-adapter";
import { createDocument } from "../store/documents/document";
import { useDocumentStore } from "../store/documents/documentStore";

const body = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
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

it("a click during a multi-file import keeps every file's content and the user's documents intact", async () => {
  const adapter = new MemoryStorageAdapter();
  await adapter.save(createDocument({ id: "x", title: "X", canonical: body("x body") }));
  await adapter.save(createDocument({ id: "y", title: "Y", canonical: body("y body") }));

  const handle = createRef();
  await act(async () => { render(<PerssonifyEditor _integrationRef={handle} storageAdapter={adapter} />); });
  for (let i = 0; i < 80 && !useDocumentStore.getState().hydratedDocId; i++) await tick();

  // While the import runs, the user clicks around the library: once when the
  // import writes its first file, and on every animation frame in which the
  // import has put one of ITS documents in the editor (the old loop did, and
  // yielded a frame, twice per file). "Runs" = until three new documents exist.
  const realSave = adapter.save.bind(adapter);
  const importedIds = new Set();
  let importing = false;
  let clicked = false;
  let clicks = 0;
  const click = () => {
    clicks++;
    void handle.current.openDocument(useDocumentStore.getState().activeDocId === "y" ? "x" : "y");
  };
  adapter.save = async (doc) => {
    const r = await realSave(doc);
    if (importing && doc.id !== "x" && doc.id !== "y") {
      importedIds.add(doc.id);
      if (importedIds.size >= 3) importing = false;
      if (!clicked) { clicked = true; click(); }
    }
    return r;
  };
  const realRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = window.requestAnimationFrame = (cb) => {
    const active = useDocumentStore.getState().activeDocId;
    if (importing && active && active !== "x" && active !== "y" && clicks < 20) click();
    return realRaf(cb);
  };

  const files = [
    new File(["# File One\n\nFile One body"], "one.md", { type: "text/markdown" }),
    new File(["# File Two\n\nFile Two body"], "two.md", { type: "text/markdown" }),
    new File(["# File Three\n\nFile Three body"], "three.md", { type: "text/markdown" }),
  ];
  const target = document.querySelector('[data-tour="editor"]');
  try {
    importing = true;
    await act(async () => { fireEvent.drop(target, { dataTransfer: { types: ["Files"], files } }); });
    for (let i = 0; i < 100 && (await adapter.list()).length < 5; i++) await tick();
    await tick(1000); // let the switches settle
  } finally {
    globalThis.requestAnimationFrame = window.requestAnimationFrame = realRaf;
  }

  const all = await adapter.list();
  expect(all).toHaveLength(5);
  for (const [title, words] of [["File One", "File One body"], ["File Two", "File Two body"], ["File Three", "File Three body"]]) {
    const summary = all.find((d) => d.title === title);
    expect(summary, `${title} was imported under its own title (not "Untitled")`).toBeTruthy();
    expect(text((await adapter.get(summary.id)).canonical)).toContain(words);
  }
  expect(text((await adapter.get("x")).canonical)).toContain("x body");
  expect(text((await adapter.get("y")).canonical)).toContain("y body");
  expect(clicked).toBe(true);
}, 40000);
