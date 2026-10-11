/**
 * A020 — editing a card must not strip the note's colour, highlight, font or
 * (on untouched paragraphs) alignment.
 *
 * A card edits the note as markdown and saves by REPLACING the whole
 * document with what that markdown parses back to. The source came from the
 * Clean converter, which has no carrier for inline styling, so one card edit
 * removed every colour and highlight from the note (reproduced by the audit
 * in Chrome). The source is now the Styled converter, and alignment — which
 * no markdown carries — is restored on blocks the edit did not change.
 *
 * Driven through the real Cards board: open it with ⌘⇧K, open the card, type
 * in its markdown source, commit with ⌘↵, and read what reached storage.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PerssonifyEditor } from "../PerssonifyEditor";
import { MemoryStorageAdapter } from "../store/persistence/storage-adapter";
import { createDocument } from "../store/documents/document";
import { useDocumentStore } from "../store/documents/documentStore";
import { carryBlockAttrs } from "../store/cards/card-save";

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
  localStorage.setItem("pf:card-view", "write");   // open cards on their markdown source
});
afterEach(() => { warn.mockRestore(); err.mockRestore(); });

const styled = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1, textAlign: "center" }, content: [{ type: "text", text: "Styled note" }] },
    { type: "paragraph", content: [
      { type: "text", text: "red words", marks: [{ type: "textStyle", attrs: { color: "#ff0000" } }] },
      { type: "text", text: " and " },
      { type: "text", text: "highlighted", marks: [{ type: "textStyle", attrs: { backgroundColor: "#ffff00" } }] },
    ] },
    { type: "paragraph", attrs: { textAlign: "right" }, content: [{ type: "text", text: "right-aligned line" }] },
  ],
};

describe("A020: a card edit keeps the note's styling", () => {
  it("saves colour, highlight and untouched alignment through a real card edit", async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.save(createDocument({ id: "other", title: "Other", canonical: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "unrelated" }] }] } }));
    await adapter.save(createDocument({ id: "s", title: "Styled note", canonical: styled }));
    await act(async () => { render(<PerssonifyEditor storageAdapter={adapter} />); });
    for (let i = 0; i < 80 && !useDocumentStore.getState().hydratedDocId; i++) await tick();
    await tick(300);

    await act(async () => { fireEvent.keyDown(document.body, { key: "k", ctrlKey: true, shiftKey: true }); });
    let card = null;
    for (let i = 0; i < 80 && !card; i++) { await tick(); card = screen.queryByLabelText("Edit note: Styled note"); }
    expect(card, "the Cards board opened on the note").toBeTruthy();
    await act(async () => { fireEvent.click(card); });

    let area = null;
    for (let i = 0; i < 40 && !area; i++) { await tick(); area = screen.queryByLabelText("Note content (markdown)"); }
    expect(area).toBeTruthy();
    await act(async () => { fireEvent.change(area, { target: { value: area.value + "\n\nA new paragraph." } }); });
    await act(async () => { fireEvent.keyDown(area, { key: "Enter", ctrlKey: true }); });
    for (let i = 0; i < 40 && !JSON.stringify((await adapter.get("s")).canonical).includes("A new paragraph"); i++) await tick();

    const saved = JSON.stringify((await adapter.get("s")).canonical);
    expect(saved).toContain("A new paragraph");                // the edit landed…
    expect(saved).toMatch(/#ff0000|rgb\(255, 0, 0\)/);       // …colour kept (a browser normalises it to rgb)
    expect(saved).toMatch(/#ffff00|rgb\(255, 255, 0\)/);     // …highlight kept
    expect(saved).toMatch(/"textAlign":"center"/);             // …alignment on the untouched heading
    expect(saved).toMatch(/"textAlign":"right"/);              // …and on the untouched paragraph
  }, 40000);
});

describe("carryBlockAttrs", () => {
  const p = (text, align) => ({ type: "paragraph", ...(align ? { attrs: { textAlign: align } } : {}), content: [{ type: "text", text }] });

  it("restores alignment on blocks the edit left unchanged, and counts the ones it changed", () => {
    const prev = { type: "doc", content: [p("same", "center"), p("edited", "right"), p("plain")] };
    const next = { type: "doc", content: [p("same"), p("edited, now different"), p("plain"), p("added")] };
    const { doc, lost } = carryBlockAttrs(prev, next);
    expect(doc.content[0].attrs.textAlign).toBe("center");
    expect(doc.content[1].attrs?.textAlign).toBeUndefined();
    expect(lost).toBe(1);
  });

  it("pairs repeated identical paragraphs one-to-one, in order", () => {
    const prev = { type: "doc", content: [p("dup", "center"), p("dup", "right")] };
    const { doc } = carryBlockAttrs(prev, { type: "doc", content: [p("dup"), p("dup")] });
    expect(doc.content.map((b) => b.attrs.textAlign)).toEqual(["center", "right"]);
  });
});
