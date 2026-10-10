import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentStore } from "../store/documents/documentStore.ts";
import { MemoryStorageAdapter } from "../store/persistence/storage-adapter.ts";
import { createDocument } from "../store/documents/document.ts";

/**
 * Regression guard for the save-status "saved → ready" auto-reset (documentStore).
 *
 * The bug: saveActiveDoc armed an uncancelled 2s timer that unconditionally set
 * saveStatus back to "ready". If the user edited within that window (→ "editing"),
 * the stale timer clobbered the dirty flag, so closing the tab skipped the
 * unsaved-changes prompt and lost the edit. The fix cancels the timer on setDirty
 * and only downgrades when the status is still exactly "saved".
 */
const mockEditor = (doc) => ({ getJSON: () => doc.canonical });

describe("save-status ready-reset timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const store = useDocumentStore.getState();
    store.initStorage(new MemoryStorageAdapter());
    const doc = createDocument({ title: "T" });
    // hydratedDocId must match activeDocId — saveActiveDoc refuses otherwise
    // (data-integrity chokepoint added after the cross-doc corruption findings).
    useDocumentStore.setState({ activeDoc: doc, activeDocId: doc.id, hydratedDocId: doc.id });
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("resets saved → ready after the delay when the user does nothing", async () => {
    const doc = useDocumentStore.getState().activeDoc;
    await useDocumentStore.getState().saveActiveDoc(mockEditor(doc));
    expect(useDocumentStore.getState().saveStatus).toBe("saved");
    await vi.advanceTimersByTimeAsync(2500);
    expect(useDocumentStore.getState().saveStatus).toBe("ready");
  });

  it("does NOT clobber a dirty edit made within the reset window", async () => {
    const doc = useDocumentStore.getState().activeDoc;
    await useDocumentStore.getState().saveActiveDoc(mockEditor(doc));
    expect(useDocumentStore.getState().saveStatus).toBe("saved");

    // User edits before the 2s reset fires.
    useDocumentStore.getState().setDirty();
    expect(useDocumentStore.getState().saveStatus).toBe("editing");

    // The stale timer must not flip it back to "ready".
    await vi.advanceTimersByTimeAsync(2500);
    expect(useDocumentStore.getState().saveStatus).toBe("editing");
  });
});
