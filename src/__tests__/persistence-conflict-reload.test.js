import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A018 — reloading after a two-tab conflict must not overwrite the other tab.
 *
 * The sequence, reproduced in a real browser by the audit: tab B writes a
 * document, tab A (still on the older revision) refuses to save its own edit
 * and parks "conflict", and the conflict toast tells the user to reload. The
 * unload handler stashed A's text; the next boot adopted it against the record
 * on disk — whose `updated` is B's — so the drift the guard measures was zero
 * and the first autosave silently replaced B's work.
 *
 * Two tabs are two INDEPENDENT store instances (`vi.resetModules` + dynamic
 * import) over one real IndexedDB (fake-indexeddb) and one localStorage, which
 * is exactly what two browser tabs share. Only `Date` is faked — the database's
 * own scheduling stays real.
 */

const DB = "a018-docs";
const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const text = (c) => JSON.stringify(c);
const T0 = new Date("2026-03-01T10:00:00.000Z").getTime();

/** A fresh "tab": its own module graph, its own store, same database. */
async function openTab() {
  vi.resetModules();
  const store = await import("../store/documentStore");
  const recovery = await import("../store/crash-recovery");
  const { IndexedDBStorageAdapter } = await import("../store/idb-storage-adapter");
  const adapter = new IndexedDBStorageAdapter({ dbName: DB });
  await adapter.isReady();
  store.useDocumentStore.getState().initStorage(adapter);
  return { store, recovery, adapter, s: () => store.useDocumentStore.getState() };
}

/** Boot a tab the way the editor does: initialize, then the editor hydrates. */
async function boot(tab) {
  const rec = await tab.s().initialize();
  if (rec) tab.s().markHydrated(rec.id);
  return rec;
}

let warn;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  localStorage.clear();
  // Seed the library through a throwaway adapter (the database is shared).
  const { IndexedDBStorageAdapter } = await import("../store/idb-storage-adapter");
  const { createDocument } = await import("../store/document");
  const seed = new IndexedDBStorageAdapter({ dbName: DB });
  await seed.isReady();
  await seed.save(createDocument({ id: "x", title: "Shared", canonical: doc("original") }));
  await seed.setPrefs({ lastActiveDocId: "x" });
});
afterEach(() => {
  warn.mockRestore();
  vi.useRealTimers();
});

describe("A018: a reload after a two-tab conflict", () => {
  it("does not let the stashed draft overwrite the other tab's newer write", async () => {
    const A = await openTab();
    expect((await boot(A)).id).toBe("x");
    const B = await openTab();
    await boot(B);

    // Tab B saves first.
    vi.setSystemTime(T0 + 10_000);
    await B.s().saveActiveDoc({ getJSON: () => doc("tab B's work") });
    expect(text((await B.adapter.get("x")).canonical)).toContain("tab B's work");

    // Tab A, still on the original revision, refuses its own save.
    vi.setSystemTime(T0 + 15_000);
    const liveA = doc("tab A's unsaved edit");
    await expect(A.s().saveActiveDoc({ getJSON: () => liveA })).rejects.toThrow(/another tab/i);
    expect(A.s().saveStatus).toBe("conflict");

    // The user reloads, as the conflict message tells them to. The unload
    // handler stashes exactly what collectUnloadStash returns.
    vi.setSystemTime(T0 + 20_000);
    const stash = A.store.collectUnloadStash(A.s(), liveA, Date.now());
    expect(stash).toHaveLength(1);
    expect(stash[0].base).toBeTruthy();           // the revision A actually edited
    expect(stash[0].conflict).toBe(true);
    expect(A.recovery.stashUnsaved(stash)).toBe(1);

    // The reloaded tab: a brand-new store instance boots and adopts the stash.
    vi.setSystemTime(T0 + 25_000);
    const A2 = await openTab();
    const reopened = await boot(A2);
    // Nothing typed is lost: the draft is what the editor shows…
    expect(text(reopened.canonical)).toContain("tab A's unsaved edit");
    // …but the conflict is visible immediately, not resolved silently.
    expect(A2.s().saveStatus).toBe("conflict");

    // Autosave (or a ⌘S) must still refuse.
    vi.setSystemTime(T0 + 31_000);
    await expect(A2.s().saveActiveDoc({ getJSON: () => reopened.canonical })).rejects.toThrow(/another tab/i);

    // THE assertion: the other tab's record survived.
    const disk = await A2.adapter.get("x");
    expect(text(disk.canonical)).toContain("tab B's work");
    expect(text(disk.canonical)).not.toContain("tab A's unsaved edit");
  });

  it("an ordinary unsaved draft (no other writer) is still adopted and saved", async () => {
    const A = await openTab();
    await boot(A);
    vi.setSystemTime(T0 + 3_000);
    const live = doc("typed inside the autosave window");
    A.recovery.stashUnsaved(A.store.collectUnloadStash(A.s(), live, Date.now()));

    vi.setSystemTime(T0 + 6_000);
    const A2 = await openTab();
    const reopened = await boot(A2);
    expect(text(reopened.canonical)).toContain("typed inside the autosave window");
    expect(A2.s().saveStatus).toBe("editing");

    await A2.s().saveActiveDoc({ getJSON: () => reopened.canonical });
    expect(text((await A2.adapter.get("x")).canonical)).toContain("typed inside the autosave window");
  });

  it("a conflicted stash that is older than disk is kept in version history, not dropped", async () => {
    const A = await openTab();
    await boot(A);
    const stash = [{ docId: "x", canonical: doc("conflicted words"), at: T0 - 60_000, base: new Date(T0 - 90_000).toISOString(), conflict: true }];
    A.recovery.stashUnsaved(stash);

    const A2 = await openTab();
    const { snapshotStore } = await import("../store/snapshot-store");
    const record = vi.spyOn(snapshotStore, "record").mockResolvedValue(undefined);
    const reopened = await boot(A2);
    expect(text(reopened.canonical)).toContain("original");  // disk wins…
    expect(record).toHaveBeenCalledWith("x", expect.any(String), stash[0].canonical, "autosave");  // …and nothing vanished
  });
});

describe("collectUnloadStash", () => {
  it("never stashes the editor's content under a document it does not hold", async () => {
    const A = await openTab();
    await boot(A);
    A.store.useDocumentStore.setState({ hydratedDocId: "someone-else" });
    expect(A.store.collectUnloadStash(A.s(), doc("wrong document"), Date.now())).toEqual([]);
  });

  it("carries a parked draft's own base, and skips a blank one over real content", async () => {
    const A = await openTab();
    await boot(A);
    const base = "2026-02-01T00:00:00.000Z";
    const st = A.s();
    st._unsavedEdits.set("bg", doc("parked"));
    st._draftBases.set("bg", base);
    st._unsavedEdits.set("blank", { type: "doc", content: [{ type: "paragraph" }] });
    A.store.useDocumentStore.setState({ documents: [...st.documents, { id: "blank", wordCount: 12 }] });
    const out = A.store.collectUnloadStash(A.s(), null, 1);
    expect(out).toEqual([{ docId: "bg", canonical: doc("parked"), at: 1, base }]);
  });
});
