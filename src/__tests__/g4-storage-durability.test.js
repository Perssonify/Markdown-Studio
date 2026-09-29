/**
 * A017 / A022 / A004 — protection against the BROWSER losing the library.
 *
 * All documents live in this origin's IndexedDB only. `persist()`/`estimate()`
 * were never called, there were no backup reminders, and a wiped library was
 * re-seeded with the starter documents as if this were a first visit. These
 * cases pin the logic in store/storage-durability.ts; the UI is covered by
 * g4-durability-notices.test.jsx.
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CANARY_KEY,
  CONTENT_SINCE_KEY,
  DAY_MS,
  PERSIST_ATTEMPT_KEY,
  _resetDurabilityForTests,
  acknowledgeWipe,
  backupNudgeDue,
  detectWipe,
  getDurabilitySnapshot,
  installTipDue,
  isLegacyOrigin,
  isSevenDayCapBrowser,
  noteLibraryAtBoot,
  pickDurabilityNotice,
  readCanary,
  readPersistenceStatus,
  recordFullBackup,
  recordLibrarySize,
  readLastBackup,
  requestPersistence,
  startDurabilityWatch,
  storagePersists,
} from "../store/storage-durability";
import { IndexedDBStorageAdapter, MemoryStorageAdapter } from "../store/storage-adapter";
import { LEGACY_APP_HOST } from "../constants";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");
const NOW = Date.UTC(2026, 8, 29, 12);

beforeEach(() => {
  localStorage.clear();
  _resetDurabilityForTests();
});

// ── The canary ──────────────────────────────────────────────────────────────

describe("wipe detection (the canary)", () => {
  it("an empty library the canary remembers documents in is a wipe", () => {
    expect(detectWipe(0, { count: 5, at: 1 })).toEqual({ expectedCount: 5, lastSeenAt: 1 });
    expect(detectWipe(2, { count: 5, at: 1 })).toBe(null); // not empty
    expect(detectWipe(0, null)).toBe(null); // a genuinely new visitor
    expect(detectWipe(0, { count: 0, at: 1 })).toBe(null); // the user emptied it themselves
  });

  it("a first visit is not a wipe — and starts the canary", () => {
    expect(noteLibraryAtBoot(0, NOW)).toBe(false);
    expect(readCanary()).toEqual({ count: 0, at: NOW });
  });

  it("an emptied library is reported, and the evidence is not overwritten", () => {
    localStorage.setItem(CANARY_KEY, JSON.stringify({ count: 5, at: NOW - DAY_MS }));
    expect(noteLibraryAtBoot(0, NOW)).toBe(true);
    expect(getDurabilitySnapshot().wipe).toEqual({ expectedCount: 5, lastSeenAt: NOW - DAY_MS });
    expect(readCanary().count).toBe(5);

    // The library stays empty (seeding skipped): a reload must still see it.
    recordLibrarySize(0, NOW + 1);
    expect(readCanary().count).toBe(5);
  });

  it("a restored backup (or any new document) retires the notice", () => {
    localStorage.setItem(CANARY_KEY, JSON.stringify({ count: 5, at: 1 }));
    noteLibraryAtBoot(0, NOW);
    recordLibrarySize(4, NOW + 1);
    expect(getDurabilitySnapshot().wipe).toBe(null);
    expect(readCanary()).toEqual({ count: 4, at: NOW + 1 });
  });

  it("'Start fresh' clears it for good", () => {
    localStorage.setItem(CANARY_KEY, JSON.stringify({ count: 5, at: 1 }));
    noteLibraryAtBoot(0, NOW);
    acknowledgeWipe(NOW);
    expect(getDurabilitySnapshot().wipe).toBe(null);
    _resetDurabilityForTests();
    expect(noteLibraryAtBoot(0, NOW + 1)).toBe(false); // next boot: a fresh start, seeded as usual
  });

  it("is not written before the boot check has read the library", () => {
    // documents is [] while storage is still loading; recording that would
    // erase the evidence before the check could see it.
    localStorage.setItem(CANARY_KEY, JSON.stringify({ count: 5, at: 1 }));
    recordLibrarySize(0, NOW);
    expect(readCanary().count).toBe(5);
  });

  it("a corrupt canary reads as absent", () => {
    localStorage.setItem(CANARY_KEY, "{not json");
    expect(readCanary()).toBe(null);
    localStorage.setItem(CANARY_KEY, JSON.stringify({ count: -3 }));
    expect(readCanary()).toBe(null);
  });
});

// ── Backups ─────────────────────────────────────────────────────────────────

describe("the backup reminder", () => {
  const base = { now: NOW, docCount: 3, contentSince: NOW - 3 * DAY_MS, lastBackupAt: null, snoozedUntil: null };

  it("waits for content the user wrote", () => {
    expect(backupNudgeDue({ ...base, docCount: 0 })).toBe(false);
    expect(backupNudgeDue({ ...base, contentSince: null })).toBe(false);
  });

  it("never backed up: not on the first day, then yes", () => {
    expect(backupNudgeDue({ ...base, contentSince: NOW - 2 * 60 * 60 * 1000 })).toBe(false);
    expect(backupNudgeDue({ ...base, contentSince: NOW - DAY_MS })).toBe(true);
  });

  it("backed up: quiet for a week, then yes", () => {
    expect(backupNudgeDue({ ...base, lastBackupAt: NOW - 3 * DAY_MS })).toBe(false);
    expect(backupNudgeDue({ ...base, lastBackupAt: NOW - 7 * DAY_MS })).toBe(false);
    expect(backupNudgeDue({ ...base, lastBackupAt: NOW - 8 * DAY_MS })).toBe(true);
  });

  it("'Not now' holds until the snooze runs out", () => {
    expect(backupNudgeDue({ ...base, snoozedUntil: NOW + 1 })).toBe(false);
    expect(backupNudgeDue({ ...base, snoozedUntil: NOW - 1 })).toBe(true);
  });

  it("a full backup is recorded where the reminder reads it", () => {
    expect(readLastBackup()).toBe(null);
    recordFullBackup(NOW);
    expect(readLastBackup()).toBe(NOW);
  });

  it("the full-backup export records it — only when something was written", () => {
    const pe = read("src/PerssonifyEditor.tsx").replace(/\r\n/g, "\n");
    const branch = pe.slice(pe.indexOf('if (type === "export-backup-zip")'));
    const body = branch.slice(0, branch.indexOf("return;"));
    expect(body).toMatch(/"perssonify-backup", \{ canonical: true \}/);
    expect(body).toMatch(/count > 0\) recordFullBackup\(\)/);
  });
});

// ── Persistence ─────────────────────────────────────────────────────────────

function fakeStorageManager({ persisted = false, grant = true, throws = false } = {}) {
  return {
    persisted: vi.fn(async () => { if (throws) throw new Error("nope"); return persisted; }),
    persist: vi.fn(async () => { if (throws) throw new Error("nope"); return grant; }),
    estimate: vi.fn(async () => ({ usage: 2048, quota: 10 * 1024 * 1024 })),
  };
}

describe("navigator.storage.persist()", () => {
  it("is feature-detected and never throws", async () => {
    await expect(requestPersistence({ sm: undefined, now: NOW })).resolves.toBe(null);
    await expect(requestPersistence({ sm: {}, now: NOW })).resolves.toBe(null);
    await expect(requestPersistence({ sm: fakeStorageManager({ throws: true }), now: NOW })).resolves.toBe(null);
  });

  it("does not ask again once the data is already persistent", async () => {
    const sm = fakeStorageManager({ persisted: true });
    await expect(requestPersistence({ sm, now: NOW })).resolves.toBe(true);
    expect(sm.persist).not.toHaveBeenCalled();
  });

  it("asks, reports the answer, and records the attempt", async () => {
    const sm = fakeStorageManager({ grant: false });
    await expect(requestPersistence({ sm, now: NOW })).resolves.toBe(false);
    expect(sm.persist).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(PERSIST_ATTEMPT_KEY)).toBe(String(NOW));
  });

  it("automatic requests are throttled; a button press is not", async () => {
    localStorage.setItem(PERSIST_ATTEMPT_KEY, String(NOW - DAY_MS));
    const sm = fakeStorageManager();
    await expect(requestPersistence({ sm, now: NOW })).resolves.toBe(null);
    expect(sm.persist).not.toHaveBeenCalled();
    await expect(requestPersistence({ sm, now: NOW, force: true })).resolves.toBe(true);
    expect(sm.persist).toHaveBeenCalledTimes(1);
  });

  it("reports state and usage for Settings", async () => {
    await expect(readPersistenceStatus(fakeStorageManager({ persisted: true }))).resolves.toEqual({
      supported: true, persisted: true, usage: 2048, quota: 10 * 1024 * 1024,
    });
    await expect(readPersistenceStatus(undefined)).resolves.toEqual({
      supported: false, persisted: null, usage: null, quota: null,
    });
  });
});

describe("the session watcher", () => {
  function fakeStore(initial) {
    let state = initial;
    const listeners = new Set();
    return {
      getState: () => state,
      subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
      set(patch) { state = { ...state, ...patch }; for (const l of listeners) l(state); },
    };
  }

  it("asks for persistence after the FIRST successful save only, and notes the content", async () => {
    noteLibraryAtBoot(3, NOW);
    const sm = fakeStorageManager();
    const store = fakeStore({ documents: [1, 2, 3], saveStatus: "ready" });
    const stop = startDurabilityWatch(store, { sm, now: () => NOW });
    await Promise.resolve();
    expect(sm.persist).not.toHaveBeenCalled(); // opening the app is not a save
    expect(localStorage.getItem(CONTENT_SINCE_KEY)).toBe(null);

    store.set({ saveStatus: "saving" });
    store.set({ saveStatus: "saved" });
    await vi.waitFor(() => expect(sm.persist).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(CONTENT_SINCE_KEY)).toBe(String(NOW));

    store.set({ saveStatus: "editing" });
    store.set({ saveStatus: "saved" });
    await Promise.resolve();
    expect(sm.persist).toHaveBeenCalledTimes(1);
    // Autosave lands every few seconds while typing; the storage manager is
    // consulted once per session, not on each of them.
    expect(sm.persisted).toHaveBeenCalledTimes(1);
    stop();
  });

  it("keeps the canary in step with the library", () => {
    noteLibraryAtBoot(3, NOW);
    const store = fakeStore({ documents: [1, 2, 3], saveStatus: "ready" });
    const stop = startDurabilityWatch(store, { sm: fakeStorageManager({ persisted: true }), now: () => NOW });
    store.set({ documents: [1, 2, 3, 4] });
    expect(readCanary().count).toBe(4);
    store.set({ documents: [] }); // the user deleted everything: not a wipe next time
    expect(readCanary().count).toBe(0);
    stop();
  });
});

// ── Safari ──────────────────────────────────────────────────────────────────

describe("the seven-day-cap browsers (install tip)", () => {
  const UA = {
    iPhoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    iPhoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1",
    macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    macFirefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0",
    winEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  };

  it("recognises Safari and every iOS browser, and nothing else", () => {
    expect(isSevenDayCapBrowser(UA.iPhoneSafari)).toBe(true);
    expect(isSevenDayCapBrowser(UA.iPhoneChrome)).toBe(true); // all iOS browsers are WebKit
    expect(isSevenDayCapBrowser(UA.macSafari)).toBe(true);
    expect(isSevenDayCapBrowser(UA.macSafari, 5)).toBe(true); // iPadOS desktop UA
    expect(isSevenDayCapBrowser(UA.macChrome)).toBe(false);
    expect(isSevenDayCapBrowser(UA.macFirefox)).toBe(false);
    expect(isSevenDayCapBrowser(UA.winEdge)).toBe(false);
  });

  it("is quiet once installed, persisted, empty, or snoozed", () => {
    const base = { sevenDayCap: true, installed: false, persisted: false, docCount: 2, snoozedUntil: null, now: NOW };
    expect(installTipDue(base)).toBe(true);
    expect(installTipDue({ ...base, sevenDayCap: false })).toBe(false);
    expect(installTipDue({ ...base, installed: true })).toBe(false);
    expect(installTipDue({ ...base, persisted: true })).toBe(false);
    expect(installTipDue({ ...base, docCount: 0 })).toBe(false);
    expect(installTipDue({ ...base, snoozedUntil: NOW + 1 })).toBe(false);
  });
});

// ── The move, availability, and which notice wins ──────────────────────────

describe("the old origin (A004)", () => {
  it("is recognised by host name only", () => {
    expect(LEGACY_APP_HOST).toBe("markdowneditor.perssonify.com");
    expect(isLegacyOrigin("markdowneditor.perssonify.com")).toBe(true);
    expect(isLegacyOrigin("MarkdownEditor.Perssonify.com")).toBe(true);
    expect(isLegacyOrigin("markdownstudio.com")).toBe(false);
    expect(isLegacyOrigin("localhost")).toBe(false);
  });
});

describe("does saving work here? (A022)", () => {
  it("not with the in-memory adapter", async () => {
    await expect(storagePersists(new MemoryStorageAdapter())).resolves.toBe(false);
  });

  it("not when IndexedDB refuses to open (private mode, blocked site data)", async () => {
    const open = indexedDB.open;
    indexedDB.open = () => { throw new DOMException("The user denied permission", "SecurityError"); };
    try {
      await expect(storagePersists(new IndexedDBStorageAdapter({ dbName: "g4-blocked" }))).resolves.toBe(false);
    } finally {
      indexedDB.open = open;
    }
  });

  it("yes with a working IndexedDB", async () => {
    await expect(storagePersists(new IndexedDBStorageAdapter({ dbName: "g4-working" }))).resolves.toBe(true);
  });
});

describe("one notice at a time, most urgent first", () => {
  const none = { storageOk: true, appNotices: true, wiped: false, legacyOrigin: false, movedDismissed: false, backupDue: false, installDue: false };

  it("'Not saving' outranks everything and shows even in an embed", () => {
    expect(pickDurabilityNotice({ ...none, storageOk: false, wiped: true, backupDue: true })).toBe("unavailable");
    expect(pickDurabilityNotice({ ...none, storageOk: false, appNotices: false })).toBe("unavailable");
  });

  it("embeds get nothing else", () => {
    expect(pickDurabilityNotice({ ...none, appNotices: false, wiped: true, legacyOrigin: true, backupDue: true })).toBe(null);
  });

  it("then wipe → moved → backup → install", () => {
    const all = { ...none, wiped: true, legacyOrigin: true, backupDue: true, installDue: true };
    expect(pickDurabilityNotice(all)).toBe("wiped");
    expect(pickDurabilityNotice({ ...all, wiped: false })).toBe("moved");
    expect(pickDurabilityNotice({ ...all, wiped: false, movedDismissed: true })).toBe("backup");
    expect(pickDurabilityNotice({ ...all, wiped: false, legacyOrigin: false, backupDue: false })).toBe("install");
    expect(pickDurabilityNotice(none)).toBe(null);
  });
});

describe("the boot path in PerssonifyEditor", () => {
  it("checks the library before seeding and skips the seed when it was wiped", () => {
    const pe = read("src/PerssonifyEditor.tsx").replace(/\r\n/g, "\n");
    const init = pe.indexOf("const existingDoc = await initialize();");
    const check = pe.indexOf("noteLibraryAtBoot(useDocumentStore.getState().documents.length)");
    const seed = pe.indexOf("} else if (initialDocument && !libraryWiped) {");
    expect(init).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(init);
    expect(seed).toBeGreaterThan(check);
  });
});
