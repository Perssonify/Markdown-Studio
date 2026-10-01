/**
 * Live sync between tabs — the pure half (store/tab-sync.ts): what a message
 * may carry, how a batch coalesces, what a tab decides to do about its OPEN
 * document, what the save guard learns from other tabs, and the transports.
 *
 * Every branch of `decideOpenDocChange` is pinned here because the hook acts on
 * it directly: "reload" hydrates over the editor, so the conditions that forbid
 * it (unsaved work, a switch or save in flight, a composition, a projection on
 * its way) are exactly the ones a regression would drop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TAB_ID,
  UNSAVED_STATUSES,
  _resetTabSyncForTests,
  announce,
  configureTabSync,
  decideOpenDocChange,
  folderStructureSignature,
  hasUnsavedWork,
  isDeletedElsewhere,
  isForeignRevision,
  isStrictlyNewer,
  markDeletedElsewhere,
  noteForeignRevision,
  openBroadcastTransport,
  openStorageTransport,
  parseTabSyncMessage,
  startTabSync,
  summarizeEvents,
  tabSyncChannelName,
  withRemoteApply,
  isApplyingRemote,
} from "../store/tab-sync";

const T0 = "2026-09-01T10:00:00.000Z";
const T1 = "2026-09-01T10:00:00.400Z"; // 400ms later — inside the save guard's 2s tolerance
const T2 = "2026-09-01T10:05:00.000Z";

/** A fake transport: records what this tab posts, lets the test deliver. */
function fakeFactory() {
  const f = { posted: [], deliver: null, closed: 0, opened: [] };
  f.factory = (name, onMessage) => {
    f.opened.push(name);
    f.deliver = onMessage;
    return { post: (m) => f.posted.push(m), close: () => { f.closed++; } };
  };
  return f;
}
const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => _resetTabSyncForTests({ channel: null }));
afterEach(() => _resetTabSyncForTests({ channel: null }));

describe("messages carry ids and revisions only, validated on arrival", () => {
  it("keeps the fields a receiver acts on and nothing else", () => {
    const m = parseTabSyncMessage({
      v: 1, from: "other",
      events: [
        { type: "doc", id: "a", updated: T1, canonical: { type: "doc", content: [] }, title: "Secret" },
        { type: "doc", id: "b", updated: T1, meta: true },
        { type: "deleted", id: "c" },
        { type: "library", extra: 1 },
        { type: "cleared" },
      ],
    });
    expect(m).toEqual({
      v: 1, from: "other",
      events: [
        { type: "doc", id: "a", updated: T1 },
        { type: "doc", id: "b", updated: T1, meta: true },
        { type: "deleted", id: "c" },
        { type: "library" },
        { type: "cleared" },
      ],
    });
    // No content ever travels: a receiver reads what it needs from storage.
    expect(JSON.stringify(m)).not.toContain("Secret");
  });

  it("rejects a message of the wrong shape, and drops malformed events", () => {
    expect(parseTabSyncMessage(null)).toBeNull();
    expect(parseTabSyncMessage("hello")).toBeNull();
    expect(parseTabSyncMessage({ v: 2, from: "x", events: [] })).toBeNull();
    expect(parseTabSyncMessage({ v: 1, events: [] })).toBeNull();
    expect(parseTabSyncMessage({ v: 1, from: "x", events: "nope" })).toBeNull();
    const m = parseTabSyncMessage({
      v: 1, from: "x",
      events: [
        null, 7, { type: "doc", id: "a" }, { type: "doc", id: "a", updated: "not a date" },
        { type: "doc", id: "", updated: T1 }, { type: "doc", id: "x".repeat(300), updated: T1 },
        { type: "deleted" }, { type: "explode", id: "a" },
      ],
    });
    expect(m.events).toEqual([]);
  });
});

describe("a batch coalesces", () => {
  it("keeps the newest revision per document", () => {
    const s = summarizeEvents([
      { type: "doc", id: "a", updated: T2 },
      { type: "doc", id: "a", updated: T1 }, // arrived late, older
      { type: "doc", id: "b", updated: T0 },
    ]);
    expect(s.changed.get("a")).toEqual({ updated: T2, meta: false });
    expect(s.changed.get("b")).toEqual({ updated: T0, meta: false });
    expect(s.deleted.size).toBe(0);
  });

  it("a content write is never downgraded to metadata-only", () => {
    expect(summarizeEvents([{ type: "doc", id: "a", updated: T0, meta: true }]).changed.get("a").meta).toBe(true);
    expect(summarizeEvents([
      { type: "doc", id: "a", updated: T0, meta: true },
      { type: "doc", id: "a", updated: T1 },
      { type: "doc", id: "a", updated: T1, meta: true },
    ]).changed.get("a").meta).toBe(false);
  });

  it("a deletion wins over earlier writes; a later write is the document again", () => {
    const s = summarizeEvents([
      { type: "doc", id: "a", updated: T0 }, { type: "deleted", id: "a" },
      { type: "deleted", id: "b" }, { type: "doc", id: "b", updated: T1 },
    ]);
    expect([...s.deleted]).toEqual(["a"]);
    expect(s.changed.has("a")).toBe(false);
    expect(s.changed.get("b").updated).toBe(T1);
  });

  it("an erase means the library changed", () => {
    const s = summarizeEvents([{ type: "cleared" }]);
    expect(s.cleared).toBe(true);
    expect(s.library).toBe(true);
    expect(summarizeEvents([{ type: "library" }]).library).toBe(true);
  });
});

describe("revisions", () => {
  it("newer is strictly newer — no tolerance for another tab's write", () => {
    expect(isStrictlyNewer(T1, T0)).toBe(true);
    expect(isStrictlyNewer(T0, T0)).toBe(false);
    expect(isStrictlyNewer(T0, T1)).toBe(false);
    expect(isStrictlyNewer(T0, null)).toBe(true);
    expect(isStrictlyNewer(null, T0)).toBe(false);
    expect(isStrictlyNewer("garbage", T0)).toBe(false);
  });

  it("the save guard learns a revision only from another tab's message", () => {
    // 400ms newer: the drift check's 2s tolerance would let a save through.
    expect(isForeignRevision("a", T1, T0)).toBe(false);
    noteForeignRevision("a", T1);
    expect(isForeignRevision("a", T1, T0)).toBe(true);
    expect(isForeignRevision("b", T1, T0)).toBe(false);   // per document
    expect(isForeignRevision("a", T1, T1)).toBe(false);   // that IS the base
    expect(isForeignRevision("a", T1, T2)).toBe(false);   // older than the base
    expect(isForeignRevision("a", null, T0)).toBe(false);
  });

  it("remembers a bounded number of revisions per document", () => {
    for (let i = 0; i < 40; i++) noteForeignRevision("a", new Date(Date.parse(T0) + 1000 * (i + 1)).toISOString());
    const newest = new Date(Date.parse(T0) + 40_000).toISOString();
    const oldest = new Date(Date.parse(T0) + 1000).toISOString();
    expect(isForeignRevision("a", newest, T0)).toBe(true);
    expect(isForeignRevision("a", oldest, T0)).toBe(false);
  });

  it("marks a document deleted elsewhere", () => {
    expect(isDeletedElsewhere("a")).toBe(false);
    markDeletedElsewhere("a");
    expect(isDeletedElsewhere("a")).toBe(true);
    expect(isDeletedElsewhere(null)).toBe(false);
  });
});

describe("what a tab does about its OPEN document when another tab wrote it", () => {
  const clean = {
    activeDocId: "a", hydratedDocId: "a", base: T0, saveStatus: "ready",
    hasDraft: false, composing: false, pendingProjection: false, schemaLocked: false,
  };
  const decide = (over = {}, theirs = T1, id = "a") => decideOpenDocChange(id, theirs, { ...clean, ...over });

  it("clean and newer: reload", () => {
    expect(decide()).toBe("reload");
    expect(decide({ saveStatus: "saved" })).toBe("reload");
  });

  it("not the open document, or nothing newer: ignore", () => {
    expect(decide({}, T1, "b")).toBe("ignore");
    expect(decide({ activeDocId: null })).toBe("ignore");
    expect(decide({}, T0)).toBe("ignore");        // the same revision
    expect(decide({ base: T2 })).toBe("ignore");  // older than what this tab holds
    expect(decide({}, null)).toBe("ignore");      // no foreign revision at all
  });

  it("a display copy of a newer build's document is never reloaded over", () => {
    expect(decide({ schemaLocked: true })).toBe("ignore");
  });

  it("every status that holds unsaved work parks a conflict — never a reload", () => {
    for (const status of ["editing", "error", "blocked", "full", "conflict"]) {
      expect(decide({ saveStatus: status }), status).toBe("conflict");
      expect(UNSAVED_STATUSES.has(status)).toBe(true);
    }
    // A parked draft is unsaved work too, whatever the status says.
    expect(decide({ hasDraft: true })).toBe("conflict");
    expect(hasUnsavedWork("ready", true)).toBe(true);
    expect(hasUnsavedWork("ready", false)).toBe(false);
  });

  it("unsaved work wins over anything merely in flight", () => {
    expect(decide({ saveStatus: "editing", composing: true })).toBe("conflict");
    expect(decide({ saveStatus: "editing", pendingProjection: true })).toBe("conflict");
  });

  it("defers while a switch, a save, a composition or a projection is in flight", () => {
    expect(decide({ hydratedDocId: null })).toBe("defer");   // a switch or boot is hydrating it
    expect(decide({ hydratedDocId: "b" })).toBe("defer");
    expect(decide({ saveStatus: "saving" })).toBe("defer");
    expect(decide({ composing: true })).toBe("defer");
    expect(decide({ pendingProjection: true })).toBe("defer");
  });
});

describe("the transport", () => {
  it("names channels after what the tabs share", () => {
    expect(tabSyncChannelName("idb", "perssonify-docs")).toBe("pf-tab-sync:idb:perssonify-docs");
    expect(tabSyncChannelName("idb", "perssonify-embed-docs")).not.toBe(tabSyncChannelName("idb", "perssonify-docs"));
    expect(tabSyncChannelName("host", "acme")).toBe("pf-tab-sync:host:acme");
    expect(tabSyncChannelName("host")).toBe("pf-tab-sync:host");
  });

  it("opens nothing without a channel, and announces nothing without a transport", async () => {
    const f = fakeFactory();
    _resetTabSyncForTests({ factory: f.factory, channel: null });
    const stop = startTabSync(() => {});
    announce({ type: "library" });
    await flushMicrotasks();
    expect(f.opened).toEqual([]);
    expect(f.posted).toEqual([]);
    stop();
  });

  it("batches one task's announcements into one message from this tab", async () => {
    const f = fakeFactory();
    _resetTabSyncForTests({ factory: f.factory, channel: "pf-tab-sync:test" });
    const stop = startTabSync(() => {});
    expect(f.opened).toEqual(["pf-tab-sync:test"]);
    announce({ type: "doc", id: "a", updated: T1 });
    announce({ type: "deleted", id: "b" });
    await flushMicrotasks();
    expect(f.posted).toEqual([{ v: 1, from: TAB_ID, events: [{ type: "doc", id: "a", updated: T1 }, { type: "deleted", id: "b" }] }]);
    stop();
    expect(f.closed).toBe(1);
    announce({ type: "library" });
    await flushMicrotasks();
    expect(f.posted).toHaveLength(1); // stopped: nothing more goes out
  });

  it("delivers other tabs' events, ignores its own, and notes their revisions on ARRIVAL", () => {
    const f = fakeFactory();
    _resetTabSyncForTests({ factory: f.factory, channel: "pf-tab-sync:test" });
    const got = [];
    startTabSync((events) => got.push(events));
    f.deliver({ v: 1, from: TAB_ID, events: [{ type: "doc", id: "a", updated: T1 }] });
    expect(got).toEqual([]);
    expect(isForeignRevision("a", T1, T0)).toBe(false); // our own write is never "foreign"
    f.deliver({ v: 1, from: "other", events: [{ type: "doc", id: "a", updated: T1 }, { type: "doc", id: "m", updated: T2, meta: true }] });
    expect(got).toHaveLength(1);
    // Known to the save guard before any asynchronous handling happens.
    expect(isForeignRevision("a", T1, T0)).toBe(true);
    // A metadata-only patch keeps its old `updated`: not a content revision.
    expect(isForeignRevision("m", T2, T0)).toBe(false);
    f.deliver("garbage");
    expect(got).toHaveLength(1);
  });

  it("a stale stop does not close a newer start", () => {
    const f = fakeFactory();
    _resetTabSyncForTests({ factory: f.factory, channel: "pf-tab-sync:test" });
    const stopOld = startTabSync(() => {});
    const got = [];
    const stopNew = startTabSync((e) => got.push(e)); // (StrictMode: mount, unmount, mount)
    stopOld();
    f.deliver({ v: 1, from: "other", events: [{ type: "library" }] });
    expect(got).toHaveLength(1);
    stopNew();
  });

  it("falls back to a storage event where there is no BroadcastChannel", () => {
    const got = [];
    const tr = openStorageTransport("pf-tab-sync:test", (raw) => got.push(raw));
    expect(tr).not.toBeNull();
    tr.post({ v: 1, from: "me", events: [{ type: "library" }] });
    const key = "pf:tab-sync:pf-tab-sync:test";
    const written = JSON.parse(localStorage.getItem(key));
    expect(written.events).toEqual([{ type: "library" }]);
    // The event fires in OTHER tabs; simulate one arriving.
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: JSON.stringify({ v: 1, from: "other", events: [{ type: "cleared" }] }) }));
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", newValue: "{}" }));
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: "not json" }));
    expect(got).toEqual([{ v: 1, from: "other", events: [{ type: "cleared" }] }]);
    // Two identical posts in a row still change the value (or no event fires).
    tr.post({ v: 1, from: "me", events: [{ type: "library" }] });
    expect(localStorage.getItem(key)).not.toBe(JSON.stringify(written));
    tr.close();
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: JSON.stringify({ v: 1, from: "other", events: [] }) }));
    expect(got).toHaveLength(1);
    localStorage.removeItem(key);
  });

  it.skipIf(typeof BroadcastChannel === "undefined")("carries a message between two BroadcastChannels of the same name", async () => {
    const got = [];
    const a = openBroadcastTransport("pf-tab-sync:core-test", () => {});
    const b = openBroadcastTransport("pf-tab-sync:core-test", (raw) => got.push(raw));
    const other = openBroadcastTransport("pf-tab-sync:somewhere-else", (raw) => got.push(["wrong channel", raw]));
    a.post({ v: 1, from: "a", events: [{ type: "library" }] });
    for (let i = 0; i < 50 && !got.length; i++) await new Promise((r) => setTimeout(r, 10));
    expect(got).toEqual([{ v: 1, from: "a", events: [{ type: "library" }] }]);
    a.close(); b.close(); other.close();
  });
});

describe("the folder tree", () => {
  it("compares the library's structure, not which folders are expanded", () => {
    const tree = { folders: [{ id: "f", name: "F", parentId: null }], docParents: { a: "f" }, docOrder: {} };
    expect(folderStructureSignature({ ...tree, expanded: { f: true } })).toBe(folderStructureSignature({ ...tree, expanded: {} }));
    expect(folderStructureSignature(tree)).not.toBe(folderStructureSignature({ ...tree, docParents: {} }));
    expect(folderStructureSignature(null)).toBe(folderStructureSignature({}));
  });

  it("marks another tab's tree while it is applied, and only then", () => {
    expect(isApplyingRemote()).toBe(false);
    let inside = false;
    withRemoteApply(() => { inside = isApplyingRemote(); });
    expect(inside).toBe(true);
    expect(isApplyingRemote()).toBe(false);
    expect(() => withRemoteApply(() => { throw new Error("x"); })).toThrow();
    expect(isApplyingRemote()).toBe(false);
  });
});

describe("configuration", () => {
  it("a channel set by the store takes effect at the next start", () => {
    const f = fakeFactory();
    _resetTabSyncForTests({ factory: f.factory, channel: null });
    configureTabSync("pf-tab-sync:idb:perssonify-docs");
    const stop = startTabSync(() => {});
    expect(f.opened).toEqual(["pf-tab-sync:idb:perssonify-docs"]);
    stop();
  });

  it("the transport's Node handle does not keep a test process alive", () => {
    // Guarded by a feature check: browsers have no `unref`.
    if (typeof BroadcastChannel === "undefined") return;
    const spy = vi.spyOn(BroadcastChannel.prototype, "unref");
    const tr = openBroadcastTransport("pf-tab-sync:unref", () => {});
    expect(spy).toHaveBeenCalled();
    tr.close();
    spy.mockRestore();
  });
});
