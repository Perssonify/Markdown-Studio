/**
 * A106 — one editor per page.
 *
 * The stores are module singletons, so a second editor mounted while one was
 * running silently shared the active document, the hydration mark, parked
 * drafts and the storage adapter with it: typing in one could be saved into
 * the other's document. A second editor now refuses to start: it shows a
 * message, logs why, and touches no store; the first keeps working. When the
 * first unmounts, the waiting one takes over as an ordinary remount (A024).
 *
 * These mount the REAL editor in jsdom. The store is shared by every case in
 * this file, exactly as it is shared by every editor on a page.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PerssonifyEditor } from "../PerssonifyEditor";
import { OneEditorPerPage, SECOND_EDITOR_ERROR } from "../ui/OneEditorPerPage";
import { MemoryStorageAdapter } from "../store/persistence/storage-adapter";
import { createDocument } from "../store/documents/document";
import {
  claimEditorInstance, onEditorInstanceReleased, releaseEditorInstance, useDocumentStore,
} from "../store/documents/documentStore";
import { useUIStore } from "../store/preferences/uiStore";

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

let warn, error;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { warn.mockRestore(); error.mockRestore(); });

const refusals = () => error.mock.calls.filter((c) => c[0] === SECOND_EDITOR_ERROR).length;

/** A storage adapter that records every call — the refused editor must make none. */
function spyAdapter() {
  const calls = [];
  const inner = new MemoryStorageAdapter();
  const adapter = new Proxy(inner, {
    get(target, key) {
      const v = Reflect.get(target, key);
      if (typeof v !== "function") return v;
      return (...args) => { calls.push(String(key)); return v.apply(target, args); };
    },
  });
  return { adapter, calls };
}

async function untilHydrated(id) {
  for (let i = 0; i < 80 && useDocumentStore.getState().hydratedDocId !== id; i++) await tick();
}

/** The one adapter every case shares (the store keeps the first it is given). */
const shared = new MemoryStorageAdapter();
beforeAll(async () => {
  await shared.save(createDocument({ id: "a", title: "A", canonical: body("document A") }));
});

describe("A106: a second editor on the page", () => {
  it("refuses to start, says why, and touches no store — the first keeps working", async () => {
    const first = render(<div data-testid="first"><PerssonifyEditor storageAdapter={shared} /></div>);
    await untilHydrated("a");
    expect(useDocumentStore.getState().hydratedDocId).toBe("a");

    const before = {
      doc: useDocumentStore.getState(),
      ui: useUIStore.getState(),
      storage: useDocumentStore.getState().getStorage(),
    };
    const { adapter: other, calls } = spyAdapter();
    // Everything this editor would push into the stores if it ran: its own
    // storage, a session read-only flag and an initial view mode.
    await act(async () => {
      render(<div data-testid="second"><PerssonifyEditor storageAdapter={other} readOnly initialMode="md" /></div>);
    });
    await tick(300);

    const second = screen.getByTestId("second");
    expect(second.querySelector('[role="alert"]')?.textContent).toMatch(/Only one Markdown Studio editor can be open on a page/);
    expect(second.querySelector(".ProseMirror, .cm-editor")).toBeNull();
    expect(refusals()).toBe(1);

    // No store saw it.
    expect(calls).toEqual([]);
    expect(useDocumentStore.getState()).toBe(before.doc);
    expect(useUIStore.getState()).toBe(before.ui);
    expect(useDocumentStore.getState().getStorage()).toBe(before.storage);

    // The first editor still edits and saves its own document.
    const editor = first.container.querySelector(".ProseMirror").editor;
    await act(async () => { editor.view.dispatch(editor.state.tr.insertText(" + typed", editor.state.doc.content.size - 1)); });
    await act(async () => { fireEvent.keyDown(document.body, { key: "s", ctrlKey: true }); });
    await tick(300);
    expect(JSON.stringify((await shared.get("a")).canonical)).toContain("document A + typed");
  }, 30000);

  it("takes over when the first editor goes away (as a remount)", async () => {
    const first = render(<div data-testid="first"><PerssonifyEditor storageAdapter={shared} /></div>);
    await untilHydrated("a");
    render(<div data-testid="second"><PerssonifyEditor storageAdapter={shared} /></div>);
    await tick(100);
    expect(screen.getByTestId("second").querySelector('[role="alert"]')).not.toBeNull();

    first.unmount();
    for (let i = 0; i < 80 && !screen.getByTestId("second").querySelector(".ProseMirror")?.editor; i++) await tick();
    await untilHydrated("a");
    const second = screen.getByTestId("second");
    expect(second.querySelector('[role="alert"]')).toBeNull();
    expect(second.querySelector(".ProseMirror").editor.getText()).toContain("document A");
  }, 30000);

  it("replacing one editor with another in the same render never refuses the new one", async () => {
    // A route change or a keyed remount: the old editor's cleanups must free
    // the slot before the new one claims it, in the same commit.
    const Page = ({ which }) => <PerssonifyEditor key={which} storageAdapter={shared} />;
    const r = render(<Page which="old" />);
    await untilHydrated("a");
    await act(async () => { r.rerender(<Page which="new" />); });
    await untilHydrated("a");
    expect(refusals()).toBe(0);
    expect(r.container.querySelector('[role="alert"]')).toBeNull();
    expect(r.container.querySelector(".ProseMirror")).not.toBeNull();
  }, 30000);

  it("unmount, then mount again: the new editor is not refused", async () => {
    const r = render(<PerssonifyEditor storageAdapter={shared} />);
    await untilHydrated("a");
    r.unmount();
    render(<div data-testid="again"><PerssonifyEditor storageAdapter={shared} /></div>);
    await untilHydrated("a");
    expect(screen.getByTestId("again").querySelector('[role="alert"]')).toBeNull();
    expect(screen.getByTestId("again").querySelector(".ProseMirror")).not.toBeNull();
    expect(refusals()).toBe(0);
  }, 30000);
});

describe("A106 under React StrictMode (mount → unmount → mount in development)", () => {
  it("never refuses the first editor", async () => {
    render(<React.StrictMode><div data-testid="strict"><PerssonifyEditor storageAdapter={shared} /></div></React.StrictMode>);
    await untilHydrated("a");
    expect(screen.getByTestId("strict").querySelector('[role="alert"]')).toBeNull();
    expect(screen.getByTestId("strict").querySelector(".ProseMirror")).not.toBeNull();
    expect(refusals()).toBe(0);
  }, 30000);

  it("still refuses a second one", async () => {
    render(
      <React.StrictMode>
        <div data-testid="one"><PerssonifyEditor storageAdapter={shared} /></div>
        <div data-testid="two"><PerssonifyEditor storageAdapter={shared} /></div>
      </React.StrictMode>
    );
    await untilHydrated("a");
    await tick(200);
    expect(screen.getByTestId("one").querySelector('[role="alert"]')).toBeNull();
    expect(screen.getByTestId("one").querySelector(".ProseMirror")).not.toBeNull();
    expect(screen.getByTestId("two").querySelector('[role="alert"]')).not.toBeNull();
    expect(screen.getByTestId("two").querySelector(".ProseMirror")).toBeNull();
  }, 30000);
});

describe("the page's editor slot", () => {
  it("one owner at a time; the owner may claim again (StrictMode), others may not release it", () => {
    const a = {}, b = {};
    expect(claimEditorInstance(a)).toBe(true);
    expect(claimEditorInstance(a)).toBe(true);
    expect(claimEditorInstance(b)).toBe(false);
    releaseEditorInstance(b); // not the owner: nothing happens
    expect(claimEditorInstance(b)).toBe(false);
    releaseEditorInstance(a);
    expect(claimEditorInstance(b)).toBe(true);
    releaseEditorInstance(b);
  });

  it("tells waiters when it frees up, and only then", () => {
    const a = {};
    const heard = vi.fn();
    const stop = onEditorInstanceReleased(heard);
    claimEditorInstance(a);
    releaseEditorInstance({}); // someone else's release frees nothing
    expect(heard).not.toHaveBeenCalled();
    releaseEditorInstance(a);
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    claimEditorInstance(a);
    releaseEditorInstance(a);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("the gate renders nothing of its children until it holds the slot", async () => {
    const holder = {};
    claimEditorInstance(holder);
    const Child = vi.fn(() => <p>child</p>);
    const r = render(<OneEditorPerPage><Child /></OneEditorPerPage>);
    expect(Child).not.toHaveBeenCalled();
    expect(r.container.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => { releaseEditorInstance(holder); });
    expect(Child).toHaveBeenCalled();
    expect(r.container.textContent).toBe("child");
    r.unmount();
  });
});
