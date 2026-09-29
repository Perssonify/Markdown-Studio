/**
 * Every self-reload goes through one policy (A008, A085).
 *
 * A new service worker, Vite's preload error and the lazy-chunk boundary each
 * used to call location.reload() on their own authority: mid-edit, mid-IME
 * composition, and offline (onto the browser's error page).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHUNK_RELOAD_KEY,
  decideUpdateReload,
  hasUnsavedWork,
  mayAutoReloadForChunk,
  pageActions,
  reloadForChunkErrorIfSafe,
  watchSaveProblems,
} from "../utils/app-health";
import { _resetDiagnosticsForTests, getDiagnostics } from "../utils/diagnostics";
import { useDocumentStore } from "../store/documentStore";

const realReload = pageActions.reload;
let onLine = true;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  _resetDiagnosticsForTests();
  onLine = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => onLine);
  pageActions.reload = vi.fn();
  useDocumentStore.setState({ saveStatus: "ready", saveError: null, _unsavedEdits: new Map() });
});
afterEach(() => {
  vi.restoreAllMocks();
  pageActions.reload = realReload;
  useDocumentStore.setState({ saveStatus: "ready", saveError: null, _unsavedEdits: new Map() });
});

describe("hasUnsavedWork — the beforeunload oracle, plus blocked", () => {
  it.each([
    ["ready", false],
    ["saved", false],
    ["editing", true],
    ["saving", true],
    ["error", true],
    ["conflict", true],
    ["blocked", true],
  ])("saveStatus %s → %s", (saveStatus, expected) => {
    expect(hasUnsavedWork({ saveStatus, _unsavedEdits: new Map() })).toBe(expected);
  });

  it("counts drafts parked by a document switch", () => {
    expect(hasUnsavedWork({ saveStatus: "saved", _unsavedEdits: new Map([["doc-1", {}]]) })).toBe(true);
  });
});

describe("decideUpdateReload — when a new version may reload the page", () => {
  const base = { online: true, unsaved: false, hidden: true, userRequested: false };
  it("never offline, even on request", () => {
    expect(decideUpdateReload({ ...base, online: false })).toBe("wait");
    expect(decideUpdateReload({ ...base, online: false, userRequested: true })).toBe("wait");
  });
  it("always on the user's request while online", () => {
    expect(decideUpdateReload({ ...base, unsaved: true, hidden: false, userRequested: true })).toBe("reload");
  });
  it("never on its own with unsaved work", () => {
    expect(decideUpdateReload({ ...base, unsaved: true })).toBe("wait");
  });
  it("on its own only for a clean tab nobody is looking at", () => {
    expect(decideUpdateReload(base)).toBe("reload");
    expect(decideUpdateReload({ ...base, hidden: false })).toBe("wait");
  });
});

describe("chunk-failure reloads", () => {
  it("the policy: online, clean, not within 10s of the last one", () => {
    const ok = { online: true, unsaved: false, lastReloadAt: 0, now: 100_000 };
    expect(mayAutoReloadForChunk(ok)).toBe(true);
    expect(mayAutoReloadForChunk({ ...ok, online: false })).toBe(false);
    expect(mayAutoReloadForChunk({ ...ok, unsaved: true })).toBe(false);
    expect(mayAutoReloadForChunk({ ...ok, lastReloadAt: 95_000 })).toBe(false);
  });

  it("reloads a clean, online tab once and stamps the throttle", () => {
    expect(reloadForChunkErrorIfSafe()).toBe(true);
    expect(pageActions.reload).toHaveBeenCalledTimes(1);
    expect(Number(sessionStorage.getItem(CHUNK_RELOAD_KEY))).toBeGreaterThan(0);
    // An immediate second failure must not loop.
    expect(reloadForChunkErrorIfSafe()).toBe(false);
    expect(pageActions.reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload offline", () => {
    onLine = false;
    expect(reloadForChunkErrorIfSafe()).toBe(false);
    expect(pageActions.reload).not.toHaveBeenCalled();
  });

  it("does not reload over unsaved typing", () => {
    useDocumentStore.setState({ saveStatus: "editing" });
    expect(reloadForChunkErrorIfSafe()).toBe(false);
    expect(pageActions.reload).not.toHaveBeenCalled();
  });
});

describe("watchSaveProblems", () => {
  it("records failed, refused and conflicted saves — and only those", () => {
    const stop = watchSaveProblems();
    useDocumentStore.setState({ saveStatus: "editing" });
    useDocumentStore.setState({ saveStatus: "saving" });
    useDocumentStore.setState({ saveStatus: "conflict", saveError: "Changed in another tab" });
    useDocumentStore.setState({ saveStatus: "blocked", saveError: "Refused to overwrite this document with an empty one" });
    stop();
    useDocumentStore.setState({ saveStatus: "error", saveError: "after unsubscribe" });
    const saves = getDiagnostics().filter((e) => e.kind === "save");
    expect(saves.map((e) => e.name)).toEqual(["save-conflict", "save-blocked"]);
  });
});
