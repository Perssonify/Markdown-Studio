/**
 * The storage-durability notices, rendered (A017 / A022).
 *
 * One slim strip above the status bar, at most one at a time: "Not saving"
 * whenever nothing persists (persistent, not dismissable, and the only one an
 * embed shows), the explanation for a library the browser emptied, the backup
 * reminder, and the Safari install tip. The moved-domain banner has its own
 * file (it needs a different page origin).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useDocumentStore } from "../store/documents/documentStore";
import { MemoryStorageAdapter } from "../store/persistence/storage-adapter";
import { snapshotStore } from "../store/history/snapshot-store";
import {
  CANARY_KEY,
  CONTENT_SINCE_KEY,
  DAY_MS,
  _resetDurabilityForTests,
  noteLibraryAtBoot,
  readCanary,
  recordFullBackup,
} from "../store/persistence/storage-durability";
import { DurabilityNotices } from "../ui/DurabilityNotices";
import { StorageBackupSection } from "../ui/SettingsStorage";

/** A working, persistent adapter (no isReady ⇒ nothing to fail). */
const workingAdapter = () => ({
  list: async () => [], get: async () => null, save: async () => {}, delete: async () => {},
  search: async () => [], getPrefs: async () => ({}), setPrefs: async () => {},
});

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const originalUA = navigator.userAgent;

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
  localStorage.clear();
  _resetDurabilityForTests();
  snapshotStore._resetForTests();
  useDocumentStore.getState().initStorage(workingAdapter());
  useDocumentStore.setState({ documents: [], saveStatus: "ready" });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => originalUA });
});

function renderNotices(props = {}) {
  const handlers = { onBackup: vi.fn(), onImportFiles: vi.fn(), onOpenVersionHistory: vi.fn() };
  render(<DurabilityNotices appNotices checkStorage {...handlers} {...props} />);
  return handlers;
}

const docs = (n) => Array.from({ length: n }, (_, i) => ({ id: `d${i}`, title: `Doc ${i}`, updated: "", created: "" }));

describe("Not saving (A022)", () => {
  it("shows whenever the in-memory adapter is active — and cannot be dismissed", async () => {
    useDocumentStore.getState().initStorage(new MemoryStorageAdapter());
    renderNotices({ appNotices: false }); // even in an embed
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Not saving — browser storage is unavailable in this window/);
    expect(alert.querySelectorAll("button").length).toBe(0);
  });

  it("stays quiet for a host that injected its own adapter", async () => {
    useDocumentStore.getState().initStorage(new MemoryStorageAdapter());
    renderNotices({ checkStorage: false });
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stays quiet when storage works", async () => {
    renderNotices();
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a library the browser emptied (A017)", () => {
  beforeEach(() => {
    localStorage.setItem(CANARY_KEY, JSON.stringify({ count: 4, at: Date.now() - 3 * DAY_MS }));
    noteLibraryAtBoot(0);
  });

  it("is explained, not greeted as new", async () => {
    renderNotices();
    const notice = await screen.findByRole("status", { name: "Library cleared" });
    expect(notice).toHaveTextContent(/Your library here is empty/);
    expect(notice).toHaveTextContent(/held 4 documents/);
    expect(notice).toHaveTextContent(/3 days ago/);
    // No snapshots exist, so Version history is not offered.
    expect(screen.queryByRole("button", { name: /Version history/ })).toBeNull();
  });

  it("offers Version history when it holds something", async () => {
    await snapshotStore.record("old", "Old", { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }, "manual");
    const h = renderNotices();
    fireEvent.click(await screen.findByRole("button", { name: /Version history/ }));
    expect(h.onOpenVersionHistory).toHaveBeenCalled();
  });

  it("imports a backup through the ordinary import path", async () => {
    const h = renderNotices();
    await screen.findByRole("button", { name: /Import a backup/ });
    const input = document.querySelector('input[type="file"]');
    const file = new File(["{}"], "perssonify-backup-20260101.zip");
    fireEvent.change(input, { target: { files: [file] } });
    expect(h.onImportFiles).toHaveBeenCalledTimes(1);
  });

  it("'Start fresh' retires it", async () => {
    renderNotices();
    fireEvent.click(await screen.findByRole("button", { name: "Start fresh" }));
    await waitFor(() => expect(screen.queryByRole("status", { name: "Library cleared" })).toBeNull());
    expect(readCanary().count).toBe(0);
  });

  it("is the app's business only", async () => {
    renderNotices({ appNotices: false });
    await act(async () => {});
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("the backup reminder (A017)", () => {
  beforeEach(() => {
    noteLibraryAtBoot(3);
    useDocumentStore.setState({ documents: docs(3) });
    localStorage.setItem(CONTENT_SINCE_KEY, String(Date.now() - 2 * DAY_MS));
  });

  it("appears once there is content and no backup, and runs the full backup", async () => {
    const h = renderNotices();
    const notice = await screen.findByRole("status", { name: "Backup reminder" });
    expect(notice).toHaveTextContent(/No full backup yet/);
    fireEvent.click(screen.getByRole("button", { name: /Download backup/ }));
    expect(h.onBackup).toHaveBeenCalledTimes(1);
  });

  it("says how old the last backup is, once it is stale", async () => {
    recordFullBackup(Date.now() - 12 * DAY_MS);
    renderNotices();
    expect(await screen.findByRole("status", { name: "Backup reminder" })).toHaveTextContent(/Last full backup: 12 days ago/);
  });

  it("goes away after a backup, and for a week after 'Not now'", async () => {
    renderNotices();
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("status", { name: "Backup reminder" })).toBeNull());
    cleanup();

    localStorage.clear();
    localStorage.setItem(CONTENT_SINCE_KEY, String(Date.now() - 2 * DAY_MS));
    recordFullBackup();
    renderNotices();
    await act(async () => {});
    expect(screen.queryByRole("status", { name: "Backup reminder" })).toBeNull();
  });
});

describe("the Safari install tip (A017)", () => {
  it("suggests the Home Screen on an iPhone, and 'Got it' puts it away", async () => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => IPHONE });
    noteLibraryAtBoot(2);
    useDocumentStore.setState({ documents: docs(2) });
    recordFullBackup(); // keep the (higher-priority) backup reminder out of the way
    renderNotices();
    const tip = await screen.findByRole("status", { name: "Keep your library" });
    expect(tip).toHaveTextContent(/7 days/);
    expect(tip).toHaveTextContent(/Add to Home Screen/);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(screen.queryByRole("status", { name: "Keep your library" })).toBeNull());
  });

  it("is never shown to Chrome on a desktop", async () => {
    noteLibraryAtBoot(2);
    useDocumentStore.setState({ documents: docs(2) });
    recordFullBackup();
    renderNotices();
    await act(async () => {});
    expect(screen.queryByRole("status", { name: "Keep your library" })).toBeNull();
  });
});

describe("Settings ▸ Storage & backup", () => {
  function stubStorage(persisted) {
    const sm = {
      persisted: vi.fn(async () => persisted),
      persist: vi.fn(async () => { persisted = true; return true; }),
      estimate: vi.fn(async () => ({ usage: 3 * 1024 * 1024, quota: 2 * 1024 * 1024 * 1024 })),
    };
    Object.defineProperty(navigator, "storage", { configurable: true, value: sm });
    return sm;
  }
  afterEach(() => { delete navigator.storage; });

  it("shows persistence and usage, and asks the browser on request", async () => {
    const sm = stubStorage(false);
    render(<StorageBackupSection open onBackup={() => {}} />);
    expect(await screen.findByText(/^Off — this browser may clear your library/)).toBeInTheDocument();
    expect(screen.getByText(/Using 3\.0 MB of about 2\.0 GB/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ask the browser to keep it/ }));
    await waitFor(() => expect(sm.persist).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/^On — this browser has agreed/)).toBeInTheDocument();
  });

  it("reports the last full backup and runs a new one", async () => {
    stubStorage(true);
    const onBackup = vi.fn();
    render(<StorageBackupSection open onBackup={onBackup} />);
    // Let the section settle first, so the update below can only come from
    // the durability subscription — not from the initial refresh landing late.
    await screen.findByText(/^On — this browser has agreed/);
    expect(screen.getByTestId("last-backup")).toHaveTextContent(/^Never/);
    act(() => recordFullBackup());
    await waitFor(() => expect(screen.getByTestId("last-backup")).toHaveTextContent(/^today/));
    fireEvent.click(screen.getByRole("button", { name: /Download full backup/ }));
    expect(onBackup).toHaveBeenCalledTimes(1);
  });

  it("says plainly when nothing is being saved", async () => {
    stubStorage(false);
    useDocumentStore.getState().initStorage(new MemoryStorageAdapter());
    render(<StorageBackupSection open />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/nothing is being saved/);
  });
});
