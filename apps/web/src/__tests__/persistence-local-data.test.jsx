import "fake-indexeddb/auto";
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A079 — deleted content must not live on forever, and "erase my data" must
 *         exist: purge-history on delete, pre-delete snapshots that expire,
 *         exports without the raw imported text / clipboard copies, and
 *         clearLocalData().
 * A103 — a host's storage must not leave plaintext copies in the ORIGIN's
 *         shared stores: version history and the crash stash follow the
 *         host's namespace, or are off.
 *
 * Each case gets a fresh module graph (the store, the snapshot ring and the
 * stash configuration are singletons) over one fake IndexedDB.
 */

const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

async function fresh() {
  vi.resetModules();
  return {
    ds: await import("../store/documents/documentStore"),
    snaps: (await import("../store/history/snapshot-store")).snapshotStore,
    rec: await import("../store/persistence/crash-recovery"),
    idb: await import("../store/persistence/idb-storage-adapter"),
    document: await import("../store/documents/document"),
    folders: await import("../store/documents/folders"),
  };
}

/** Count the records in a snapshot database (without the store). */
async function snapshotCount(name) {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains("snapshots")) {
        d.createObjectStore("snapshots", { keyPath: "id", autoIncrement: true }).createIndex("byDoc", "docId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const n = await new Promise((resolve) => {
    const r = db.transaction("snapshots", "readonly").objectStore("snapshots").count();
    r.onsuccess = () => resolve(r.result);
  });
  db.close();
  return n;
}

let warn;
beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); localStorage.clear(); });
afterEach(() => { warn.mockRestore(); });

describe("clearLocalData", () => {
  async function seeded() {
    const m = await fresh();
    const name = `a079-${Math.random()}`;
    m.ds.useDocumentStore.getState().initStorage({ dbName: name });
    const adapter = m.ds.useDocumentStore.getState().getStorage();
    await adapter.save(m.document.createDocument({ id: "a", title: "Secret A", canonical: doc("secret words") }));
    await adapter.setPrefs({ folderTree: { folders: [{ id: "f", name: "Private folder", parentId: null }] } });
    await m.snaps.record("a", "Secret A", doc("an older secret"), "manual");
    m.rec.stashUnsaved([{ docId: "a", canonical: doc("unsaved secret"), at: Date.now() }]);
    localStorage.setItem("pf:library-canary", JSON.stringify({ count: 1 }));
    localStorage.setItem("pf:card-draft", JSON.stringify({ title: "", body: "unsent secret note" }));
    localStorage.setItem("pf:font-size", "17");
    localStorage.setItem("someone-else:key", "keep");
    m.ds.useDocumentStore.setState({ activeDocId: "a", hydratedDocId: "a", activeDoc: await adapter.get("a") });
    m.ds.useDocumentStore.getState().cacheUnsavedEdit("a", doc("parked secret"));
    return { m, adapter, name };
  }

  it("erases documents, their prefs, version history, the stash and drafts", async () => {
    const { m, adapter, name } = await seeded();
    await m.ds.clearLocalData({ preferences: true });

    expect(await adapter.list()).toEqual([]);
    expect(await adapter.getPrefs()).toEqual({});                   // folder names went too
    expect(await snapshotCount(`perssonify-snapshots:${name}`)).toBe(0);
    expect(m.rec.takeStashed()).toEqual([]);
    const s = m.ds.useDocumentStore.getState();
    expect(s.activeDocId).toBeNull();
    expect(s.hydratedDocId).toBeNull();
    expect(s._unsavedEdits.size).toBe(0);
    expect(m.folders.useFolderStore.getState().folders).toEqual([]);
    expect(localStorage.getItem("pf:font-size")).toBeNull();        // preferences: true
    expect(localStorage.getItem("someone-else:key")).toBe("keep");  // not ours
  });

  it("always removes the library canary, even when keeping preferences", async () => {
    const { m } = await seeded();
    await m.ds.clearLocalData();
    // A canary left behind would announce "your browser cleared your library"
    // on the next boot and suppress the starter documents.
    expect(localStorage.getItem("pf:library-canary")).toBeNull();
    expect(localStorage.getItem("pf:font-size")).toBe("17");
  });

  it("always removes the Cards composer draft: it is the user's words, not a setting", async () => {
    const { m } = await seeded();
    await m.ds.clearLocalData();
    expect(localStorage.getItem("pf:card-draft")).toBeNull();
    expect(localStorage.getItem("pf:font-size")).toBe("17");
  });
});

describe("A103: a host's namespace reaches version history and the stash", () => {
  it("namespaces both by the host's dbName, and leaves the defaults untouched", async () => {
    const m = await fresh();
    m.ds.useDocumentStore.getState().initStorage({ dbName: "tenant-a" });
    await m.snaps.record("d", "Doc", doc("tenant A's text"), "manual");
    m.rec.stashUnsaved([{ docId: "d", canonical: doc("tenant A draft"), at: Date.now() }]);

    expect(await snapshotCount("perssonify-snapshots:tenant-a")).toBe(1);
    expect(await snapshotCount("perssonify-snapshots")).toBe(0);
    expect(localStorage.getItem("pf:recovery:tenant-a")).toContain("tenant A draft");
    expect(localStorage.getItem("pf:recovery")).toBeNull();
  });

  it("a host can turn both off", async () => {
    const m = await fresh();
    m.ds.useDocumentStore.getState().initStorage({ dbName: "tenant-b", snapshots: false, crashRecovery: false });
    await m.snaps.record("d", "Doc", doc("not kept"), "manual");
    expect(await m.snaps.listForDoc("d")).toEqual([]);
    expect(m.rec.stashUnsaved([{ docId: "d", canonical: doc("x"), at: Date.now() }])).toBe(0);
    expect(Object.keys(localStorage).filter((k) => k.startsWith("pf:recovery"))).toEqual([]);
  });

  it("with no config the standalone app's names are unchanged", async () => {
    const m = await fresh();
    m.ds.configureLocalStores(undefined);
    m.rec.stashUnsaved([{ docId: "d", canonical: doc("x"), at: Date.now() }]);
    expect(localStorage.getItem("pf:recovery")).toBeTruthy();
  });
});

describe("A079: deleted documents", () => {
  it("delete keeps a recoverable copy by default, and none with purgeHistory", async () => {
    const m = await fresh();
    m.snaps._resetForTests();
    const records = new Map([["a", m.document.createDocument({ id: "a", canonical: doc("a words") })], ["b", m.document.createDocument({ id: "b", canonical: doc("b words") })]]);
    m.ds.useDocumentStore.getState().initStorage({
      list: async () => [...records.values()], get: async (id) => records.get(id) ?? null,
      save: async (d) => { records.set(d.id, d); }, delete: async (id) => { records.delete(id); },
      search: async () => [], getPrefs: async () => ({}), setPrefs: async () => {},
    });
    await m.snaps.record("b", "B", doc("an older b"), "manual");

    await m.ds.useDocumentStore.getState().deleteDoc("a", null);
    expect((await m.snaps.listForDoc("a")).map((s) => s.reason)).toEqual(["pre-delete"]);

    await m.ds.useDocumentStore.getState().deleteDoc("b", null, { purgeHistory: true });
    expect(await m.snaps.listForDoc("b")).toEqual([]);            // its whole history went with it

    await m.ds.useDocumentStore.getState().purgeDocHistory("a");  // the toast's "Erase history"
    expect(await m.snaps.listForDoc("a")).toEqual([]);
  });

  it("a deleted document's pre-delete copy expires with the age cap (a live one's newest does not)", async () => {
    const m = await fresh();
    m.snaps._resetForTests();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      await m.snaps.record("gone", "Gone", doc("deleted long ago"), "pre-delete");
      await m.snaps.record("live", "Live", doc("old but newest"), "manual");
      vi.setSystemTime(new Date("2026-03-15T00:00:00Z"));          // > 30 days later
      await m.snaps.record("other", "Other", doc("today"), "manual");   // any record runs the prune
      expect(await m.snaps.listForDoc("gone")).toEqual([]);
      expect(await m.snaps.listForDoc("live")).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });
});

describe("A079: exports leave out the raw import and clipboard copies", () => {
  it("toExportEnvelope strips origin.raw and alternates, keeping the provenance", async () => {
    const { toExportEnvelope } = await import("../store/importExport/import-export");
    const { createDocument } = await import("../store/documents/document");
    const d = createDocument({
      id: "p", title: "Pasted", canonical: doc("what remains"),
      origin: { format: "paste-html", raw: "<p>text the user later DELETED</p>", source: "clipboard-paste", timestamp: "t", alternates: { "text/plain": "deleted text", "text/rtf": "{\\rtf deleted}" } },
    });
    const env = toExportEnvelope(d);
    const json = JSON.stringify(env);
    expect(json).not.toContain("DELETED");
    expect(json).not.toContain("deleted text");
    expect(env.origin).toMatchObject({ format: "paste-html", source: "clipboard-paste", timestamp: "t", raw: null, alternates: null });
    expect(json).toContain("what remains");
  });
});

describe("Settings ▸ Erase all local data", () => {
  it("asks first, then erases", async () => {
    const m = await fresh();
    const { EraseLocalDataSection } = await import("../ui/EraseLocalData");
    const { DialogProvider } = await import("../ui/DialogProvider");
    m.ds.useDocumentStore.getState().initStorage({ dbName: `a079-ui-${Math.random()}` });
    const adapter = m.ds.useDocumentStore.getState().getStorage();
    await adapter.save(m.document.createDocument({ id: "z", canonical: doc("z") }));
    let answer = false;
    const confirm = vi.fn(async () => answer);
    render(
      <DialogProvider value={{ confirm, prompt: vi.fn(), equation: vi.fn(), confirmUnsaved: vi.fn() }}>
        <EraseLocalDataSection />
      </DialogProvider>
    );
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /erase/i })); });
    expect(confirm).toHaveBeenCalledOnce();
    expect(await adapter.list()).toHaveLength(1);                  // cancelled: nothing erased
    answer = true;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /erase/i })); });
    for (let i = 0; i < 20 && (await adapter.list()).length; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(await adapter.list()).toEqual([]);
  });
});
