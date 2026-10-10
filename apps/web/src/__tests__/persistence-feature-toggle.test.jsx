/**
 * A033 — changing a Markdown feature setting must not strip what the markdown
 * projection cannot carry.
 *
 * On every feature change (tables, emoji, callouts…) the editor re-parsed the
 * markdown pane over the rich document, so a document's alignment — and, in
 * Clean mode, its colours — silently vanished, becoming permanent at the next
 * edit or switch. A lossy document now keeps its rich content; only the
 * markdown pane is re-projected.
 */
import React from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PerssonifyEditor } from "../PerssonifyEditor";
import { MemoryStorageAdapter } from "../store/persistence/storage-adapter";
import { createDocument } from "../store/documents/document";
import { useDocumentStore } from "../store/documents/documentStore";
import { useUIStore } from "../store/preferences/uiStore";

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

it("keeps alignment and colour when a markdown feature is toggled", async () => {
  const adapter = new MemoryStorageAdapter();
  await adapter.save(createDocument({
    id: "s", title: "Styled",
    canonical: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1, textAlign: "center" }, content: [{ type: "text", text: "Centred title" }] },
        { type: "paragraph", content: [{ type: "text", text: "red words", marks: [{ type: "textStyle", attrs: { color: "#ff0000" } }] }] },
      ],
    },
  }));
  await act(async () => { render(<PerssonifyEditor storageAdapter={adapter} />); });
  for (let i = 0; i < 80 && useDocumentStore.getState().hydratedDocId !== "s"; i++) await tick();
  await tick(300); // init finishes, initDone flips
  const editor = document.querySelector(".ProseMirror").editor;
  expect(JSON.stringify(editor.getJSON())).toContain('"textAlign":"center"');

  // Toggle any markdown feature (emoji, here).
  const features = useUIStore.getState().markdownFeatures;
  await act(async () => { useUIStore.getState().setInitialMarkdownFeatures({ ...features, emoji: !features.emoji }); });
  await tick(300);

  const after = JSON.stringify(editor.getJSON());
  expect(after).toContain('"textAlign":"center"');
  expect(after).toContain("#ff0000");
  expect(after).toContain("Centred title");
}, 30000);
