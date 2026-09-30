/**
 * Live sync between tabs, through the REAL editor (engine, both panes, stores,
 * library panel, notice) in jsdom.
 *
 * "The other tab" is exactly what another tab is from this one's point of
 * view: writes to the storage both share, and a message on the channel both
 * listen to (a real BroadcastChannel — the test runner has one). This tab's
 * own messages arrive on the same channel, so the suite also sees what the
 * editor announces.
 *
 * One mount; the cases are one journey (see behave-harness.jsx).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react/pure";
import {
  act, click, heading, installBrowserStubs, key, mdText, mountEditor, onDisk, para, richEditor, seededAdapter,
  store, storedDoc, textOf, tick, toastText, typeRich, until, untilHydrated, untilMdHas, untilRichHas,
} from "./behave-harness";
import { createDocument } from "../store/document";
import { snapshotStore } from "../store/snapshot-store";
import { tabSyncChannelName, useTabSyncStore } from "../store/tab-sync";
import { useFolderStore } from "../store/folders";

vi.setConfig({ testTimeout: 30000 });

const CHANNEL = tabSyncChannelName("host", "behave-tabs");
let adapter;
let other;
let heard;
let warn;
let err;

/** The other tab: write through the shared storage, then say so. */
const otherTab = {
  post(events) { other.postMessage({ v: 1, from: "the-other-tab", events }); },
  async write(id, blocks, patch = {}) {
    const rec = (await adapter.get(id)) ?? createDocument({ id, title: patch.title ?? id });
    Object.assign(rec, { canonical: { type: "doc", content: blocks } }, patch);
    await adapter.save(rec); // stamps `updated`
    this.post([{ type: "doc", id, updated: rec.updated }]);
    return rec;
  },
  async remove(id) {
    await adapter.delete(id);
    this.post([{ type: "deleted", id }]);
  },
};

const notice = () => document.querySelector("[data-tab-sync-notice]");
const noticeButton = (label) => [...(notice()?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === label);
const row = (id) => document.querySelector(`[role="tree"] [data-key="d:${id}"]`);
const richText = () => richEditor()?.getText() ?? "";
async function historyFor(id, reason) {
  const metas = (await snapshotStore.listForDoc(id)).filter((m) => !reason || m.reason === reason);
  return Promise.all(metas.map(async (m) => textOf(await snapshotStore.getCanonical(m.id))));
}
async function untilClean() {
  await until(() => ["ready", "saved"].includes(store().saveStatus), "the document to be clean");
}

beforeAll(async () => {
  installBrowserStubs();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
  adapter = await seededAdapter([
    storedDoc("alpha", "Alpha", [heading(1, "Alpha"), para("alpha body")], { updated: "2026-09-02T10:00:00.000Z" }),
    storedDoc("beta", "Beta", [heading(1, "Beta"), para("beta body")], { updated: "2026-09-01T10:00:00.000Z" }),
    storedDoc("delta", "Delta", [heading(1, "Delta"), heading(2, "Old heading"), para("delta body")], { updated: "2026-08-30T10:00:00.000Z" }),
    storedDoc("linker", "Linker", [heading(1, "Linker"), para("see [[Delta#Old heading]] for more")], { updated: "2026-08-29T10:00:00.000Z" }),
  ], { prefs: { lastActiveDocId: "alpha" } });
  other = new BroadcastChannel(CHANNEL);
  heard = [];
  other.onmessage = (e) => heard.push(e.data);
  await mountEditor({ storageAdapter: adapter, storageConfig: { namespace: "behave-tabs" } });
  await untilHydrated("alpha");
  await untilClean();
}, 30000);

afterAll(() => {
  other.close();
  cleanup();
  warn.mockRestore();
  err.mockRestore();
});

describe("the library follows the other tab", () => {
  it("a document created there appears in the Files list here", async () => {
    const prefWrites = vi.spyOn(adapter, "setPrefs");
    await otherTab.write("gamma", [heading(1, "Gamma"), para("made elsewhere")], { title: "Gamma" });
    await until(() => row("gamma"), "the new document in the library");
    expect(row("gamma").textContent).toContain("Gamma");
    // It was only listed: the open document is untouched.
    expect(store().activeDocId).toBe("alpha");
    // A new listing re-runs the folder janitor, which hands back fresh objects
    // with nothing pruned. Writing that tree back could only land on top of a
    // change another tab made to it meanwhile, so nothing is written.
    await tick(200);
    expect(prefWrites.mock.calls.filter(([p]) => "folderTree" in p)).toEqual([]);
    prefWrites.mockRestore();
  });

  it("a rename there renames the row here, and a folder made there shows here", async () => {
    await otherTab.write("beta", [heading(1, "Beta"), para("beta body")], { title: "Beta renamed", userTitle: "Beta renamed", titlePinnedByUser: true });
    await until(() => row("beta")?.textContent.includes("Beta renamed"), "the renamed row");
    const prefs = await adapter.getPrefs();
    await adapter.setPrefs({
      ...prefs,
      folderTree: { folders: [{ id: "f-shared", name: "Shared folder", parentId: null }], docParents: { gamma: "f-shared" }, docOrder: {}, expanded: {} },
    });
    const prefWrites = vi.spyOn(adapter, "setPrefs");
    otherTab.post([{ type: "library" }]);
    await until(() => useFolderStore.getState().folders.some((f) => f.name === "Shared folder"), "the folder");
    expect(useFolderStore.getState().docParents.gamma).toBe("f-shared");
    // The tree another tab wrote is already on disk: not written back.
    await tick(200);
    expect(prefWrites.mock.calls.filter(([p]) => "folderTree" in p)).toEqual([]);
    prefWrites.mockRestore();
  });

  it("a folder made HERE is announced once it is on disk", async () => {
    heard.length = 0;
    await act(async () => { useFolderStore.getState().createFolder("Made here"); });
    await until(() => heard.some((m) => m.events.some((e) => e.type === "library")), "the library announcement");
    expect(JSON.stringify((await adapter.getPrefs()).folderTree)).toContain("Made here");
  });
});

describe("the open document, clean: reloaded live", () => {
  it("shows the other tab's text in both panes, keeps the caret, writes nothing", async () => {
    await untilClean();
    const ed = richEditor();
    await act(async () => { ed.commands.setTextSelection(4); });
    const writes = vi.spyOn(adapter, "save");
    await otherTab.write("alpha", [heading(1, "Alpha"), para("alpha body"), para("line from the other tab")]);
    writes.mockClear(); // the other tab's own write
    await untilRichHas("line from the other tab");
    await untilMdHas("line from the other tab");
    await until(() => /Updated from another tab/.test(toastText()), "the quiet toast");
    expect(richEditor().state.selection.from).toBe(4);
    expect(store().saveStatus).toBe("ready");
    expect(store().activeDoc.updated).toBe((await onDisk(adapter, "alpha")).updated);
    // Reloading is not an edit: nothing is marked dirty, nothing written back.
    await tick(300);
    expect(store().saveStatus).toBe("ready");
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
    expect(notice()).toBeNull();
  });

  it("waits for a composition to finish before reloading", async () => {
    const ed = richEditor();
    // What the browser leaves while an IME / dictation composition is live.
    ed.view.input.composing = true;
    await otherTab.write("alpha", [heading(1, "Alpha"), para("alpha body"), para("second line from elsewhere")]);
    await tick(700);
    expect(richText()).not.toContain("second line from elsewhere");
    ed.view.input.composing = false;
    await untilRichHas("second line from elsewhere");
    expect(store().saveStatus).toBe("ready");
  });

  it("a revision nobody announced is not taken for another tab's", async () => {
    // What this tab's OWN write looks like while it settles: newer on disk
    // than the base, with no message for it. A message hinting at some other
    // revision must not make this tab reload — or, dirty, conflict with — it.
    await untilClean();
    const rec = await adapter.get("alpha");
    rec.canonical = { type: "doc", content: [heading(1, "Alpha"), para("SILENT WRITE")] };
    await adapter.save(rec);
    otherTab.post([{ type: "doc", id: "alpha", updated: new Date(Date.parse(rec.updated) - 1).toISOString() }]);
    await tick(500);
    expect(richText()).not.toContain("SILENT WRITE");
    expect(store().saveStatus).not.toBe("conflict");
    // …and once it IS announced, it is another tab's write and is taken.
    otherTab.post([{ type: "doc", id: "alpha", updated: rec.updated }]);
    await untilRichHas("SILENT WRITE");
  });

  it("a card pin set there survives this tab's next save", async () => {
    await untilClean();
    const rec = await adapter.get("alpha");
    rec.metadata = { ...rec.metadata, cardPinned: true };
    rec._preserveUpdated = true; // a presentation-only patch keeps `updated`
    await adapter.save(rec);
    otherTab.post([{ type: "doc", id: "alpha", updated: rec.updated, meta: true }]);
    await until(() => store().activeDoc?.metadata?.cardPinned === true, "the pin to be taken");
    await typeRich(" typed after the pin");
    await key(document.querySelector(".ProseMirror"), "s", { ctrlKey: true });
    await until(async () => textOf((await onDisk(adapter, "alpha")).canonical).includes("typed after the pin"), "the save");
    expect((await onDisk(adapter, "alpha")).metadata.cardPinned).toBe(true);
    await untilClean();
  });

  it("this tab's saves reach the other tab", async () => {
    heard.length = 0;
    await typeRich(" and a word typed here");
    await key(document.querySelector(".ProseMirror"), "s", { ctrlKey: true });
    const msg = await until(() => heard.find((m) => m.events.some((e) => e.type === "doc" && e.id === "alpha")), "this tab's announcement");
    const disk = await onDisk(adapter, "alpha");
    expect(msg.events.find((e) => e.id === "alpha").updated).toBe(disk.updated);
    // Ids and revisions only.
    expect(JSON.stringify(msg)).not.toContain("typed here");
    await untilClean();
  });
});

describe("a heading the OTHER tab renamed", () => {
  it("is not offered for a link update here — that tab made the rename, and asks there", async () => {
    await click(row("delta").querySelector("button"));
    await untilHydrated("delta");
    await untilClean();
    await otherTab.write("delta", [heading(1, "Delta"), heading(2, "New heading"), para("delta body")]);
    await untilRichHas("New heading");
    // Leaving the document is when a rename made HERE is offered.
    await click(row("linker").querySelector("button"));
    await untilHydrated("linker");
    await tick(800);
    expect(toastText()).not.toMatch(/Heading renamed/);
    await click(row("alpha").querySelector("button"));
    await untilHydrated("alpha");
  });
});

describe("the open document, WITH unsaved work: a notice and three choices", () => {
  /** Type here, then have the other tab write before this tab saves. */
  async function conflictWith(mine, theirs) {
    await untilClean();
    await typeRich(mine);
    await until(() => store().saveStatus === "editing", "unsaved typing");
    await otherTab.write("alpha", [heading(1, "Alpha"), para(theirs)]);
    await until(() => notice()?.getAttribute("data-tab-sync-notice") === "Changed in another tab", "the conflict notice");
    expect(store().saveStatus).toBe("conflict");
    // Nothing was hydrated over the typing, and nothing written over theirs.
    expect(richText()).toContain(mine.trim());
    expect(textOf((await onDisk(adapter, "alpha")).canonical)).toContain(theirs);
    expect(textOf((await onDisk(adapter, "alpha")).canonical)).not.toContain(mine.trim());
  }

  it("parks the conflict at once — it does not wait for the next save", async () => {
    await conflictWith(" MINE-ONE", "THEIRS-ONE");
    expect(document.querySelector("footer").textContent).toMatch(/Changed in another tab/);
    // Typing on does not save over theirs either.
    await typeRich(" more mine");
    await key(document.querySelector(".ProseMirror"), "s", { ctrlKey: true });
    await until(() => store().saveStatus === "conflict", "the refused save");
    expect(textOf((await onDisk(adapter, "alpha")).canonical)).not.toContain("MINE-ONE");
  });

  it("Keep mine: theirs goes to Version history, then mine is written", async () => {
    await click(noticeButton("Keep mine"));
    await until(async () => textOf((await onDisk(adapter, "alpha")).canonical).includes("MINE-ONE"), "my version on disk");
    expect(textOf((await onDisk(adapter, "alpha")).canonical)).toContain("more mine");
    expect((await historyFor("alpha", "tab-conflict")).some((t) => t.includes("THEIRS-ONE"))).toBe(true);
    await until(() => notice() === null, "the notice to go");
    expect(["saved", "ready"]).toContain(store().saveStatus);
  });

  it("Use theirs: mine goes to Version history, theirs is shown, nothing is written", async () => {
    await conflictWith(" MINE-TWO", "THEIRS-TWO");
    const writes = vi.spyOn(adapter, "save");
    await click(noticeButton("Use theirs"));
    await untilRichHas("THEIRS-TWO");
    expect(richText()).not.toContain("MINE-TWO");
    await untilMdHas("THEIRS-TWO");
    expect((await historyFor("alpha", "tab-conflict")).some((t) => t.includes("MINE-TWO"))).toBe(true);
    expect(textOf((await onDisk(adapter, "alpha")).canonical)).toContain("THEIRS-TWO");
    expect(notice()).toBeNull();
    expect(store().saveStatus).toBe("ready");
    await tick(300);
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
  });

  it("Save mine as a copy: mine becomes a new document, theirs is shown", async () => {
    await conflictWith(" MINE-THREE", "THEIRS-THREE");
    const before = new Set((await adapter.list()).map((d) => d.id));
    await click(noticeButton("Save mine as a copy"));
    await untilRichHas("THEIRS-THREE");
    const copy = await until(async () => (await adapter.list()).find((d) => !before.has(d.id)), "the copy on disk");
    expect(copy.title).toBe("Alpha (my copy)");
    expect(textOf((await onDisk(adapter, copy.id)).canonical)).toContain("MINE-THREE");
    expect(textOf((await onDisk(adapter, "alpha")).canonical)).toContain("THEIRS-THREE");
    expect(textOf((await onDisk(adapter, "alpha")).canonical)).not.toContain("MINE-THREE");
    expect(store().activeDocId).toBe("alpha");
    expect(notice()).toBeNull();
    await until(() => row(copy.id), "the copy in the library");
  });

  it("a conflict found at SAVE time — the message never came — gets the same notice", async () => {
    await untilClean();
    const rec = await adapter.get("alpha");
    rec.canonical = { type: "doc", content: [heading(1, "Alpha"), para("THEIRS-UNANNOUNCED")] };
    await adapter.save(rec);
    rec.updated = new Date(Date.parse(rec.updated) + 60_000).toISOString(); // well past the tolerance
    rec._preserveUpdated = true;
    await adapter.save(rec);
    await typeRich(" MINE-FOUR");
    await key(document.querySelector(".ProseMirror"), "s", { ctrlKey: true });
    await until(() => notice()?.getAttribute("data-tab-sync-notice") === "Changed in another tab", "the notice");
    await click(noticeButton("Use theirs"));
    await untilRichHas("THEIRS-UNANNOUNCED");
    expect((await historyFor("alpha", "tab-conflict")).some((t) => t.includes("MINE-FOUR"))).toBe(true);
  });
});

describe("a draft parked for a document another tab deletes", () => {
  it("is kept in Version history — it existed nowhere else", async () => {
    // gamma is filed in the folder the other tab made; open it to reach the row.
    if (!useFolderStore.getState().expanded["f-shared"]) {
      await act(async () => { useFolderStore.getState().toggleExpanded("f-shared"); });
    }
    await until(() => row("gamma"), "gamma's row");
    await click(row("gamma").querySelector("button"));
    await untilHydrated("gamma");
    await untilClean();
    await typeRich(" GAMMA-PARKED-DRAFT");
    await otherTab.write("gamma", [heading(1, "Gamma"), para("gamma changed elsewhere")]);
    await until(() => notice(), "the conflict notice");
    // Leaving parks the draft: its save is refused, it stays in memory.
    await click(row("beta").querySelector("button"));
    await untilHydrated("beta");
    expect(store().getUnsavedEdit("gamma")).toBeTruthy();
    await otherTab.remove("gamma");
    await until(async () => (await historyFor("gamma", "pre-delete")).some((t) => t.includes("GAMMA-PARKED-DRAFT")), "the parked draft in Version history");
    await until(() => !row("gamma"), "the row to go");
  });
});

describe("the open document deleted in another tab", () => {
  it("stays on screen, stops saving, and keeps unsaved text in Version history", async () => {
    await click(row("alpha").querySelector("button"));
    await untilHydrated("alpha");
    await untilClean();
    await typeRich(" UNSAVED-BEFORE-DELETE");
    await otherTab.remove("alpha");
    await until(() => notice()?.getAttribute("data-tab-sync-notice") === "Deleted in another tab", "the deleted notice");
    expect(richText()).toContain("UNSAVED-BEFORE-DELETE");
    expect(store().saveStatus).toBe("conflict");
    expect(document.querySelector("footer").textContent).toMatch(/Deleted in another tab/);
    // Kept the moment the deletion arrived — before any save was attempted
    // (parking the status cancelled the pending autosave).
    await until(async () => (await historyFor("alpha", "pre-delete")).some((t) => t.includes("UNSAVED-BEFORE-DELETE")), "the unsaved text in Version history");
    // A save — explicit or not — must not bring it back.
    await key(document.querySelector(".ProseMirror"), "s", { ctrlKey: true });
    await tick(300);
    expect(await onDisk(adapter, "alpha")).toBeNull();
    expect((await historyFor("alpha", "pre-delete")).some((t) => t.includes("UNSAVED-BEFORE-DELETE"))).toBe(true);
    await until(() => !row("alpha"), "the row to leave the library");
  });

  it("Keep as a new document: a new id with the text, the old one stays deleted", async () => {
    await typeRich(" AND-AFTER");
    // Typing moves the status on; its save is refused and parks it again.
    await key(document.querySelector(".ProseMirror"), "s", { ctrlKey: true });
    await until(() => store().saveStatus === "conflict", "the refused save");
    const before = new Set((await adapter.list()).map((d) => d.id));
    await click(noticeButton("Keep as a new document"));
    const fresh = await until(async () => (await adapter.list()).find((d) => !before.has(d.id)), "the new document on disk");
    const disk = textOf((await onDisk(adapter, fresh.id)).canonical);
    expect(disk).toContain("UNSAVED-BEFORE-DELETE");
    expect(disk).toContain("AND-AFTER");
    expect(fresh.id).not.toBe("alpha");
    expect(await onDisk(adapter, "alpha")).toBeNull();
    await until(() => store().activeDocId === fresh.id && store().hydratedDocId === fresh.id, "the new document open");
    expect(notice()).toBeNull();
    expect(store().saveStatus).not.toBe("conflict"); // the old id's refusal does not follow it
    // It saves normally from here on.
    await typeRich(" SAVED-UNDER-NEW-ID");
    await key(document.querySelector(".ProseMirror"), "s", { ctrlKey: true });
    await until(async () => textOf((await onDisk(adapter, fresh.id)).canonical).includes("SAVED-UNDER-NEW-ID"), "the save");
  });

  it("Close: the deleted document goes, is not recreated, and what was typed is kept", async () => {
    await click(row("beta").querySelector("button"));
    await untilHydrated("beta");
    await untilClean();
    await otherTab.remove("beta");
    await until(() => notice()?.getAttribute("data-tab-sync-notice") === "Deleted in another tab", "the deleted notice");
    // Typed AFTER the notice, and closed before any save could run.
    await typeRich(" TYPED-THEN-CLOSED");
    await click(noticeButton("Close"));
    await until(() => store().activeDocId !== "beta", "beta to close");
    await tick(300);
    expect(await onDisk(adapter, "beta")).toBeNull();
    expect(useTabSyncStore.getState().notice).toBeNull();
    expect((await historyFor("beta", "pre-delete")).some((t) => t.includes("TYPED-THEN-CLOSED"))).toBe(true);
  });
});

describe("messages it must ignore", () => {
  it("its own storage decides: a message about a document it cannot find changes nothing", async () => {
    const open = store().activeDocId;
    const before = textOf(richEditor().getJSON());
    otherTab.post([{ type: "doc", id: open, updated: new Date(Date.now() + 60_000).toISOString() }]);
    otherTab.post([{ type: "deleted", id: open }]); // …it is still stored here
    await tick(500);
    expect(textOf(richEditor().getJSON())).toBe(before);
    expect(notice()).toBeNull();
    expect(store().saveStatus).not.toBe("conflict");
    expect(mdText().length).toBeGreaterThan(0);
  });
});
