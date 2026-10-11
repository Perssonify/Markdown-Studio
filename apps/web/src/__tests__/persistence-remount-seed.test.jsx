/**
 * A024 (seed half) — a remount must not persist another copy of
 * `initialDocument`.
 *
 * `initialize()` returned null on every call after the first, and a null means
 * "no stored documents" to the editor — which then seeded `initialDocument`
 * again. Each remount inside a host app added one more "Welcome".
 *
 * A file of its own: the stores are module singletons, so a second mount in
 * another test of the same file would inherit that test's library.
 */
import React from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PerssonifyEditor } from "../PerssonifyEditor";
import { MemoryStorageAdapter } from "../store/persistence/storage-adapter";
import { useDocumentStore } from "../store/documents/documentStore";

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

async function mountUntilHydrated(props) {
  let r;
  await act(async () => { r = render(<PerssonifyEditor {...props} />); });
  for (let i = 0; i < 100; i++) {
    const s = useDocumentStore.getState();
    if (s.activeDocId && s.hydratedDocId === s.activeDocId) break;
    await tick();
  }
  return r;
}

it("does not seed another copy of initialDocument on every remount", async () => {
  const adapter = new MemoryStorageAdapter();
  const props = { storageAdapter: adapter, initialDocument: { title: "Welcome", content: "# Welcome\n\nHello." } };

  const first = await mountUntilHydrated(props);
  expect(await adapter.list()).toHaveLength(1);
  first.unmount();

  const second = await mountUntilHydrated(props);
  expect(await adapter.list()).toHaveLength(1);                   // still ONE welcome document
  second.unmount();
  await mountUntilHydrated(props);
  expect(await adapter.list()).toHaveLength(1);
}, 30000);
