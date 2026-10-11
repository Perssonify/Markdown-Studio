/**
 * A023 — deleting a version-history snapshot, and what the delete dialogs say.
 *
 * Deleting a snapshot was one un-confirmed click whose promise nobody awaited:
 * no confirmation, no error handling — and for a document no longer in the
 * library, its "pre-delete" snapshot can be the only copy left anywhere.
 * Meanwhile the document-delete dialog said "This action cannot be undone",
 * which is wrong the other way: `deleteDoc` records a pre-delete snapshot that
 * Version history restores as a new document.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { snapshotStore } from "../store/history/snapshot-store";
import { useDocumentStore } from "../store/documents/documentStore";
import { MemoryStorageAdapter } from "../store/persistence/storage-adapter";
import { createDocument } from "../store/documents/document";
import { useUIStore } from "../store/preferences/uiStore";
import { DialogProvider } from "../ui/dialogs/dialogProvider";
import { VersionHistorySheet, snapshotDeleteConfirm } from "../ui/history/versionHistorySheet";
import { en } from "../i18n/en";

const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const read = (p) => readFileSync(join(process.cwd(), p), "utf8");

beforeAll(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query) => ({
      matches: false, media: query, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    });
  }
});

beforeEach(() => {
  snapshotStore._resetForTests();
  useUIStore.setState({ readOnly: false });
  useDocumentStore.setState({ documents: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSheet({ confirm, activeDocId = "live" } = {}) {
  const api = {
    confirm: confirm ?? vi.fn(async () => true),
    prompt: async () => null,
    equation: async () => null,
    confirmUnsaved: async () => "cancel",
  };
  render(
    <DialogProvider value={api}>
      <VersionHistorySheet
        open
        onOpenChange={() => {}}
        activeDocId={activeDocId}
        onRestoreInPlace={vi.fn()}
        onRestoreAsNew={vi.fn()}
      />
    </DialogProvider>
  );
  return api;
}

const snapshotCount = async () => [...(await snapshotStore.listAll()).values()].flat().length;

describe("the confirmation copy", () => {
  it("is plain about a version of a document that still exists", () => {
    const c = snapshotDeleteConfirm({ title: "Notes" }, { docInLibrary: true, remainingForDoc: 3 });
    expect(c.destructive).toBe(true);
    expect(c.description).toMatch(/document itself is not changed/);
  });

  it("warns that a deleted document's versions are the only copies", () => {
    const c = snapshotDeleteConfirm({ title: "Notes" }, { docInLibrary: false, remainingForDoc: 2 });
    expect(c.description).toMatch(/only copies left/);
  });

  it("says so outright when it is the LAST copy", () => {
    const c = snapshotDeleteConfirm({ title: "Notes" }, { docInLibrary: false, remainingForDoc: 1 });
    expect(c.description).toMatch(/last remaining copy of “Notes”/);
    expect(c.description).toMatch(/cannot be recovered/);
  });
});

describe("deleting a snapshot from the sheet", () => {
  it("asks first, and a cancelled confirmation deletes nothing", async () => {
    await snapshotStore.record("gone", "Old notes", doc("the only copy"), "pre-delete");
    const confirm = vi.fn(async () => false);
    renderSheet({ confirm });
    const del = await screen.findByRole("button", { name: "Delete this version" });
    fireEvent.click(del);
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    // The document is not in the library, and this is its only snapshot.
    expect(confirm.mock.calls[0][0].description).toMatch(/last remaining copy/);
    await act(async () => {});
    expect(await snapshotCount()).toBe(1);
  });

  it("deletes once confirmed", async () => {
    await snapshotStore.record("gone", "Old notes", doc("bye"), "pre-delete");
    renderSheet();
    fireEvent.click(await screen.findByRole("button", { name: "Delete this version" }));
    await waitFor(async () => expect(await snapshotCount()).toBe(0));
  });

  it("reports a failed delete instead of swallowing it", async () => {
    await snapshotStore.record("gone", "Old notes", doc("sticky"), "pre-delete");
    vi.spyOn(snapshotStore, "deleteOne").mockRejectedValue(new Error("disk said no"));
    renderSheet();
    fireEvent.click(await screen.findByRole("button", { name: "Delete this version" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be deleted/);
    expect(await snapshotCount()).toBe(1);
  });

  it("is disabled in read-only mode, along with both restores", async () => {
    await snapshotStore.record("live", "Live doc", doc("current"), "manual");
    useUIStore.setState({ readOnly: true });
    const confirm = vi.fn(async () => true);
    renderSheet({ confirm, activeDocId: "live" });
    const del = await screen.findByRole("button", { name: "Delete this version" });
    expect(del).toBeDisabled();
    expect(screen.getByRole("button", { name: /Restore/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /As new/ })).toBeDisabled();
    fireEvent.click(del);
    await act(async () => {});
    expect(confirm).not.toHaveBeenCalled();
    expect(await snapshotCount()).toBe(1);
    expect(screen.getByText(/Read-only mode is on/)).toBeInTheDocument();
  });
});

describe("the document-delete dialogs tell the truth", () => {
  it("deleteDoc really does keep a restorable copy", async () => {
    // The promise the new wording makes, checked against the store itself.
    const store = useDocumentStore.getState();
    const adapter = new MemoryStorageAdapter();
    store.initStorage(adapter);
    const d = createDocument({ id: "doomed", title: "Doomed", canonical: doc("keep me somewhere") });
    await adapter.save(d);
    useDocumentStore.setState({ documents: await adapter.list(), openTabs: [], activeDocId: null, activeDoc: null });
    await useDocumentStore.getState().deleteDoc("doomed", null);
    expect(await adapter.get("doomed")).toBeNull();
    const [snap] = await snapshotStore.listForDoc("doomed");
    expect(snap?.reason).toBe("pre-delete");
    expect(JSON.stringify(await snapshotStore.getCanonical(snap.id))).toContain("keep me somewhere");
  });

  it("neither delete confirmation claims it cannot be undone", () => {
    // Since A099 the copy is in the catalog: resolve every key a confirmation
    // uses to its English text, every plural form included, and check that.
    const said = (source) =>
      [...source.matchAll(/\bt\("([\w.]+)"/g)]
        .flatMap(([, key]) => {
          const m = en[key];
          expect(m, key).toBeDefined();
          return typeof m === "string" ? [m] : Object.values(m);
        })
        .join("\n");

    const lifecycle = read("src/hooks/useDocumentLifecycle.ts");
    const single = lifecycle.slice(lifecycle.indexOf('title: t("editor.deleteDocumentTitle")')).slice(0, 400);
    expect(said(single)).toMatch(/Delete document\?/);
    expect(said(single)).toMatch(/Version history/);
    expect(said(single)).not.toMatch(/cannot be undone/);

    const panel = read("src/ui/workspace/workspacePanel/index.tsx");
    const bulk = panel.slice(panel.indexOf("const handleBulkDelete"));
    const bulkConfirm = bulk.slice(0, bulk.indexOf("if (!ok) return;"));
    expect(said(bulkConfirm)).toMatch(/Version history/);
    expect(said(bulkConfirm)).not.toMatch(/cannot be undone/);
  });
});
