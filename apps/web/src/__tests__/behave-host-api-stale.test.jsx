/**
 * A108 — the host handle must act on the editor's CURRENT state.
 *
 * `useHostApi` builds the imperative handle with `useImperativeHandle`, and its
 * dependency list left out values the handle's methods close over:
 * `handleAction`, `addDocumentsImpl`, `emitGraphUpdate`,
 * `captureDocFromMarkdown`. A method then runs with whatever those were the
 * last time something that IS listed changed.
 *
 *  - `emitGraphUpdate` and `addDocumentsImpl` close over the host's
 *    `_onIntegrationGraphUpdate`. A host that re-renders the editor with a new
 *    callback (and nothing else) kept being called on the OLD one by
 *    `addDocuments`, `updateDocument` and `appendToDocument`.
 *  - `handleAction` closes over the sync mode, so `exportAs` could have kept
 *    Clean after a switch to Styled. That one never showed, only because
 *    `setCanonical` — which WAS listed, and is not used by the handle at all —
 *    happened to depend on the sync mode as well. The first case pins the
 *    behaviour now that the list names `handleAction` itself.
 *
 * Mutation-tested: with the dependency list frozen, both cases fail; with the
 * original list, the second one does (the OLD callback is called).
 */
import React, { createRef } from "react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react/pure";
import {
  act, captureDownloads, click, heading, installBrowserStubs, menuClick, mountEditor, onDisk, para, readBlobText,
  richEditor, seededAdapter, storedDoc, until, untilHydrated,
} from "./behave-harness";
import { PerssonifyEditor } from "../PerssonifyEditor";
import { useUIStore } from "../store/preferences/uiStore";

vi.setConfig({ testTimeout: 30000 });

const handle = createRef();
let downloads;
let warn;
let adapter;
let view;
const firstHost = vi.fn();

beforeAll(async () => {
  installBrowserStubs();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  downloads = captureDownloads();
  adapter = await seededAdapter(
    [storedDoc("plain", "Plain", [heading(1, "Plain"), para("some plain words")])],
    { prefs: { syncMode: "clean" } },
  );
  view = await mountEditor({ storageAdapter: adapter, _integrationRef: handle, _onIntegrationGraphUpdate: firstHost });
  await untilHydrated("plain");
}, 30000);

afterAll(() => { cleanup(); downloads.restore(); warn.mockRestore(); });

it("exportAs('md') follows a switch to Styled, exactly like File ▸ Export", async () => {
  expect(useUIStore.getState().syncMode).toBe("clean");
  // The user turns Styled on in the markdown pane's header…
  await click(document.querySelector('[aria-label="Styled Markdown"]'));
  await until(() => useUIStore.getState().syncMode === "styled", "Styled to switch on");
  // …and colours some text (lossless in Styled, so the fidelity report — which
  // IS a dependency of the handle — does not change).
  await act(async () => { richEditor().chain().selectAll().setColor("#ff0000").run(); });
  await until(() => document.querySelector(".cm-content")?.textContent.includes("color"), "the coloured span in the markdown pane");

  // The host exports through the handle.
  await act(async () => { await handle.current.exportAs("md"); });
  const viaHandle = await readBlobText(downloads.last().blob);

  // The user exports through the menu, at the same moment.
  await menuClick("File", "Export", "Markdown (.md)");
  const viaMenu = await readBlobText(downloads.last().blob);

  expect(viaMenu).toContain('<span style="color: rgb(255, 0, 0)">some plain words</span>'); // Styled keeps the colour…
  expect(viaHandle).toBe(viaMenu);                // …and so must the host's export
});

it("a host's NEW graph callback is the one the handle calls", async () => {
  const secondHost = vi.fn();
  // The host re-renders the editor with a different callback — nothing else.
  await act(async () => {
    view.rerender(<PerssonifyEditor storageAdapter={adapter} _integrationRef={handle} _onIntegrationGraphUpdate={secondHost} />);
  });
  firstHost.mockClear();

  await act(async () => { await handle.current.updateDocument("plain", { title: "Renamed by host" }); });
  expect((await onDisk(adapter, "plain")).title).toBe("Renamed by host");
  expect(firstHost).not.toHaveBeenCalled();
  expect(secondHost).toHaveBeenCalled();

  // addDocuments goes through its own copy of the callback.
  secondHost.mockClear();
  await act(async () => { await handle.current.addDocuments([{ id: "extra", markdown: "# Extra\n\nlinks to [[Plain]]" }]); });
  expect(await onDisk(adapter, "extra")).not.toBeNull();
  expect(secondHost).toHaveBeenCalled();
  expect(firstHost).not.toHaveBeenCalled();
  const graph = secondHost.mock.calls.at(-1)[0];
  expect(graph.nodes.map((n) => n.id).sort()).toEqual(["extra", "plain"]);
});
