/**
 * A036 — restoring a version in place is an EDIT, so read-only must refuse it.
 *
 * `restoreSnapshotInPlace` hydrates the snapshot over the live document, marks
 * it dirty and saves it. Read-only's single choke-point is the format
 * dispatcher, which this path never goes through, so a read-only session let
 * a restore rewrite the document on disk.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentLifecycle } from "../hooks/useDocumentLifecycle";
import { useDocumentStore } from "../store/documents/documentStore";
import { useUIStore } from "../store/preferences/uiStore";
import { snapshotStore } from "../store/history/snapshot-store";

const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

function mount() {
  const editor = { getJSON: () => doc("current") };
  const params = {
    tiptapRef: { current: { getEditor: () => editor, getEditorState: () => null, endComposition: vi.fn(), resetHistory: vi.fn() } },
    cmRef: { current: { endComposition: vi.fn(), resetHistory: vi.fn(), getValue: () => "" } },
    engine: {}, syncMdToHtml: vi.fn(() => true), syncHtmlToMd: vi.fn(() => true),
    forceSyncMdToHtml: vi.fn(), forceSyncHtmlToMd: vi.fn(), resetHashes: vi.fn(),
    setCanonical: vi.fn(), setFromHtml: vi.fn(), switchToDoc: vi.fn(), closeTab: vi.fn(),
    createDoc: vi.fn(), deleteDoc: vi.fn(), finalizeDoc: vi.fn(), revertActiveDoc: vi.fn(),
    saveActiveDoc: vi.fn(async () => true), setDirty: vi.fn(), handleCanonicalChange: vi.fn(),
    pasteStyled: true, setPasteStyled: vi.fn(), syncMode: "styled", setSyncMode: vi.fn(),
    toast: { show: vi.fn() }, confirm: vi.fn(async () => true), confirmUnsaved: vi.fn(),
  };
  return { ...renderHook(() => useDocumentLifecycle(params)), params };
}

let snapId;
beforeEach(async () => {
  snapshotStore._resetForTests();
  await snapshotStore.record("a", "A", doc("an older version"), "manual");
  snapId = (await snapshotStore.listForDoc("a"))[0].id;
  useDocumentStore.setState({ activeDocId: "a", activeDoc: { id: "a", title: "A" }, hydratedDocId: "a" });
});
afterEach(() => {
  useUIStore.setState({ readOnly: false });
  useDocumentStore.setState({ activeDocId: null, activeDoc: null, hydratedDocId: null });
});

describe("A036: version restore respects read-only", () => {
  it("refuses to restore in place while read-only — nothing hydrated, dirtied or saved", async () => {
    useUIStore.setState({ readOnly: true });
    const { result, params } = mount();
    await act(async () => { await result.current.restoreSnapshotInPlace(snapId); });
    expect(params.setCanonical).not.toHaveBeenCalled();
    expect(params.setDirty).not.toHaveBeenCalled();
    expect(params.saveActiveDoc).not.toHaveBeenCalled();
    expect(params.toast.show).toHaveBeenCalledWith(expect.stringMatching(/read-only/i), "warning");
  });

  it("restores normally when read-only is off", async () => {
    const { result, params } = mount();
    await act(async () => { await result.current.restoreSnapshotInPlace(snapId); });
    expect(params.setCanonical).toHaveBeenCalledWith(doc("an older version"), { resetHistory: false });
    expect(params.saveActiveDoc).toHaveBeenCalled();
  });
});
