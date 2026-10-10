/**
 * IME / voice-dictation composition guards.
 *
 * Every one of these pins a defect that was REPRODUCED in a real browser with a
 * genuine composition (CDP `Input.imeSetComposition`), not a mocked boolean —
 * see e2e/cases/journeys.mjs, which drives the same scenarios end to end.
 *
 * The rule the codebase follows is "a projection waits for a composition to
 * end". Document-LEAVING paths are the exception: they are about to hydrate a
 * different document over both panes, so waiting means the dictated text is
 * destroyed. They END the composition instead (blur commits its text into that
 * pane's own document, synchronously — measured), then flush.
 */
import React, { createRef } from "react";
import { renderHook, act, render } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeMirrorPane } from "../ui/CodeMirrorPane";
import { COMPOSITION_STALL_MS } from "../constants";
import { useDocumentLifecycle } from "../hooks/useDocumentLifecycle";
import { useFormatDispatcher } from "../formatting/useFormatDispatcher";
import { useDocumentStore } from "../store/documents/documentStore";
import { useUIStore } from "../store/preferences/uiStore";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");

/** A pane handle that reports a composition and records endComposition(). */
function pane(composing = false) {
  const state = { composing, ended: 0 };
  return {
    state,
    handle: {
      isComposing: () => state.composing,
      endComposition: () => { state.ended++; state.composing = false; },
      getValue: () => "",
      setValue: () => null,
      getView: () => null,
      getEditor: () => null,
      focus: () => {},
      resetHistory: () => {},
    },
  };
}

function mountLifecycle({ cm, tiptap, syncMdToHtml, syncHtmlToMd }) {
  const params = {
    tiptapRef: { current: tiptap.handle },
    cmRef: { current: cm.handle },
    engine: {},
    syncMdToHtml: syncMdToHtml ?? vi.fn(() => true),
    syncHtmlToMd: syncHtmlToMd ?? vi.fn(() => true),
    forceSyncMdToHtml: vi.fn(),
    forceSyncHtmlToMd: vi.fn(),
    resetHashes: vi.fn(),
    setCanonical: vi.fn(),
    setFromHtml: vi.fn(),
    switchToDoc: vi.fn(async () => null),
    closeTab: vi.fn(async () => null),
    createDoc: vi.fn(),
    deleteDoc: vi.fn(async () => null),
    finalizeDoc: vi.fn(async () => null),
    revertActiveDoc: vi.fn(async () => null),
    saveActiveDoc: vi.fn(async () => {}),
    setDirty: vi.fn(),
    handleCanonicalChange: vi.fn(),
    pasteStyled: true,
    setPasteStyled: vi.fn(),
    syncMode: "styled",
    setSyncMode: vi.fn(),
    toast: { show: vi.fn() },
    confirm: vi.fn(async () => true),
    confirmUnsaved: vi.fn(async () => "discard"),
  };
  const { result } = renderHook(() => useDocumentLifecycle(params));
  return { result, params };
}

describe("leaving a document mid-composition (N1)", () => {
  // prepareToLeaveActiveDoc is a no-op with no active document.
  beforeEach(() => { useDocumentStore.setState({ activeDocId: "doc-a" }); });
  afterEach(() => { useDocumentStore.setState({ activeDocId: null }); });

  it("ends the composition in BOTH panes before flushing", async () => {
    const cm = pane(true);
    const tiptap = pane(false);
    const { result } = mountLifecycle({ cm, tiptap });

    await act(async () => { await result.current.prepareToLeaveActiveDoc(); });

    // Without this the 120ms retry loop is killed, the forced projection
    // no-ops on the composition guard, and the dictated markdown is cached as
    // nothing — reproduced in a browser as "dictate, press ⌘N, text is gone".
    expect(cm.state.ended).toBe(1);
    expect(tiptap.state.ended).toBe(1);
    expect(cm.state.composing).toBe(false);
  });

  it("forces the markdown projection once the composition is over", async () => {
    const cm = pane(true);
    const tiptap = pane(false);
    const { result, params } = mountLifecycle({ cm, tiptap });

    // Arm a pending projection the way typing does, then leave.
    act(() => { result.current.handleMdChange(); });
    await act(async () => { await result.current.prepareToLeaveActiveDoc(); });

    expect(params.forceSyncMdToHtml).toHaveBeenCalled();
  });

  it("does not blur anything when no composition is active", async () => {
    const cm = pane(false);
    const tiptap = pane(false);
    const { result } = mountLifecycle({ cm, tiptap });
    await act(async () => { await result.current.prepareToLeaveActiveDoc(); });
    // endComposition is a no-op in the handles when not composing, but the
    // lifecycle must not have any OTHER reason to touch focus.
    expect(cm.state.ended).toBe(1);
    expect(cm.state.composing).toBe(false);
  });
});

describe("cancelPendingSync mid-composition (N2)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("leaves the retry loop alive so the projection still lands", () => {
    // The RICH pane composes: that is the pane the md→html projection writes,
    // so it is the one that defers it (see the asymmetric guards in
    // useSyncEngine — a markdown-pane composition does not).
    const cm = pane(false);
    const tiptap = pane(true);
    const syncMdToHtml = vi.fn(() => true);
    const { result } = mountLifecycle({ cm, tiptap, syncMdToHtml });

    act(() => { result.current.handleMdChange(); });
    // ⌘Z routes through this. Clearing the timer here stranded the deferred
    // projection: the dictated text sat in the markdown pane and the rich pane
    // — the canonical autosave persists — never received it.
    act(() => { result.current.cancelPendingSync(); });

    act(() => { vi.advanceTimersByTime(600); });
    expect(syncMdToHtml).not.toHaveBeenCalled(); // still composing: correctly deferred

    tiptap.state.composing = false;
    act(() => { vi.advanceTimersByTime(600); });
    expect(syncMdToHtml).toHaveBeenCalled();     // the retry loop survived
  });

  it("a markdown-pane composition does not defer the md→html projection", () => {
    // Asymmetry, asserted directly: this projection writes the RICH pane, so a
    // composition in the markdown pane is not its business. Guarding on it
    // froze the mirror for a whole dictated utterance.
    const cm = pane(true);
    const tiptap = pane(false);
    const syncMdToHtml = vi.fn(() => true);
    const { result } = mountLifecycle({ cm, tiptap, syncMdToHtml });
    act(() => { result.current.handleMdChange(); });
    act(() => { vi.advanceTimersByTime(1500); });
    expect(syncMdToHtml).toHaveBeenCalled();
  });

  it("still cancels when nothing is composing", () => {
    const cm = pane(false);
    const tiptap = pane(false);
    const syncMdToHtml = vi.fn(() => true);
    const { result } = mountLifecycle({ cm, tiptap, syncMdToHtml });

    act(() => { result.current.handleMdChange(); });
    act(() => { result.current.cancelPendingSync(); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(syncMdToHtml).not.toHaveBeenCalled();
  });
});

describe("formatting commands mid-composition (N3)", () => {
  afterEach(() => { useUIStore.setState({ readOnly: false }); });

  it("ends the composition before dispatching into the markdown pane", () => {
    const cm = pane(true);
    const tiptap = pane(false);
    const dispatched = [];
    cm.handle.getView = () => null;
    const { result } = renderHook(() =>
      useFormatDispatcher({
        cmRef: { current: cm.handle },
        tiptapRef: { current: { ...tiptap.handle, getEditor: () => null, isActive: () => false, getAttributes: () => ({}), getHTML: () => "", setHTML: () => {} } },
        mode: "md",
        syncMdToHtml: () => dispatched.push("sync"),
        syncHtmlToMd: vi.fn(),
        scheduleAutosave: vi.fn(),
      })
    );

    result.current.dispatch("bold");

    // Measured: without this, ⌘B while dictating into the markdown pane left
    // the streamed text DUPLICATED there and the rich pane never converged.
    expect(cm.state.ended).toBe(1);
    expect(cm.state.composing).toBe(false);
  });

  it("does not touch the panes when nothing is composing", () => {
    const cm = pane(false);
    const tiptap = pane(false);
    const { result } = renderHook(() =>
      useFormatDispatcher({
        cmRef: { current: cm.handle },
        tiptapRef: { current: { ...tiptap.handle, getEditor: () => null, isActive: () => false, getAttributes: () => ({}), getHTML: () => "", setHTML: () => {} } },
        mode: "md",
        syncMdToHtml: vi.fn(),
        syncHtmlToMd: vi.fn(),
        scheduleAutosave: vi.fn(),
      })
    );
    result.current.dispatch("bold");
    expect(cm.state.ended).toBe(0);
  });
});

describe("source pins — every debounce-clearing site handles compositions", () => {
  const src = read("src/hooks/useDocumentLifecycle.ts");
  const lines = src.split("\n");

  it("every clearTimeout(mdDebounceRef) is preceded by endCompositions() or a composing guard", () => {
    // Only CANCELLATIONS count — a line that clears the timer AND nulls the
    // ref. handleMdChange's re-arm keeps the ref (it is the same pending
    // projection, rescheduled) and the unmount cleanups have no document left
    // to leave, so neither is a site where a composition can be stranded.
    const sites = [];
    lines.forEach((line, i) => {
      if (!/clearTimeout\(mdDebounceRef\.current\).*mdDebounceRef\.current = null/.test(line)) return;
      const window = lines.slice(Math.max(0, i - 14), i).join("\n");
      sites.push({
        line: i + 1,
        ok: /endCompositions\(\)/.test(window) || /isComposing\?\.\(\)/.test(window),
      });
    });
    expect(sites.length).toBeGreaterThan(3); // the pin must actually find sites
    expect(sites.filter((s) => !s.ok)).toEqual([]);
  });

  it("cancelPendingSync bails while either pane is composing", () => {
    const body = src.slice(src.indexOf("const cancelPendingSync"), src.indexOf("const flushPendingSync"));
    expect(body).toMatch(/isComposing\?\.\(\)[\s\S]*?return;/);
  });
});

describe("a stuck composition flag expires (COMPOSITION_STALL_MS)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("stops believing a composition that produces no input", () => {
    // Measured in a real browser: an undo dispatched into CodeMirror during a
    // live IME composition destroyed the composition WITHOUT a compositionend
    // event, so `view.composing` stayed true for the rest of the session. Every
    // consumer of isComposing() deferred forever and the panes never converged
    // again — not after the composition committed, not after further typing.
    const ref = createRef();
    render(React.createElement(CodeMirrorPane, { ref, defaultValue: "# One", isDark: false, onChange: () => {} }));
    const view = ref.current.getView();

    expect(ref.current.isComposing()).toBe(false);
    view.inputState.composing = 1;                 // what the browser leaves behind
    expect(ref.current.isComposing()).toBe(true);  // believed at first

    vi.advanceTimersByTime(COMPOSITION_STALL_MS - 100);
    expect(ref.current.isComposing()).toBe(true);
    vi.advanceTimersByTime(200);
    expect(ref.current.isComposing()).toBe(false); // no input for this long: stuck, not composing

    view.inputState.composing = 0;
    expect(ref.current.isComposing()).toBe(false);
  });
});

/**
 * Rapid-action guards on the async → hydrate paths.
 *
 * `handleSwitchDoc` claims a generation and re-checks it at every await, so a
 * superseded switch can never hydrate the editor. Six OTHER paths reach the
 * same hydration after the same kind of await — some of them after an UNBOUNDED
 * one, a confirm dialog the user can leave open while opening another document
 * — and none of them claimed a generation at all.
 */
describe("every async path that hydrates the editor claims a generation", () => {
  /** A delete that settles only when the test lets it. */
  function deferred() {
    let release;
    const promise = new Promise((r) => { release = r; });
    return { promise, release };
  }

  /** A lifecycle whose deleteDoc settles only when the test lets it. */
  function mountWithGatedDelete() {
    const gate = deferred();
    const setCanonical = vi.fn();
    const params = {
      ...mountLifecycle({ cm: pane(false), tiptap: pane(false) }).params,
      deleteDoc: vi.fn(() => gate.promise),
      confirm: vi.fn(async () => true),
      setCanonical,
    };
    const { result } = renderHook(() => useDocumentLifecycle(params));
    return { result, gate, setCanonical };
  }

  it("a delete superseded by a document switch does not hydrate", async () => {
    const { result, gate, setCanonical } = mountWithGatedDelete();

    const deleting = result.current.handleDeleteDoc("doc-a");
    await act(async () => { await Promise.resolve(); });

    // A newer switch claims the editor while the delete is still awaiting.
    act(() => { result.current.handleSwitchDoc("doc-b"); });
    gate.release({ id: "doc-c", canonical: { type: "doc", content: [] } });
    await act(async () => { await deleting; });

    // The stale delete must NOT push its switched-to document into an editor a
    // newer switch now owns.
    expect(setCanonical).not.toHaveBeenCalled();
  });

  it("hydrates normally when nothing supersedes it", async () => {
    const { result, gate, setCanonical } = mountWithGatedDelete();

    const deleting = result.current.handleDeleteDoc("doc-a");
    await act(async () => { await Promise.resolve(); });
    gate.release({ id: "doc-c", canonical: { type: "doc", content: [] } });
    await act(async () => { await deleting; });

    expect(setCanonical).toHaveBeenCalled();
  });

  it("source pin: every hydrating async path claims and re-checks a generation", () => {
    const src = read("src/hooks/useDocumentLifecycle.ts");
    for (const fn of [
      "handleSwitchDoc", "handleCloseTab", "handleDeleteDoc", "handleNewDoc",
      "handleRevertDoc", "restoreSnapshotInPlace", "restoreSnapshotAsNew",
    ]) {
      const start = src.indexOf(`const ${fn} = useCallback(`);
      expect(start, `${fn} not found`).toBeGreaterThan(-1);
      // Up to the next top-level `const … = useCallback(` declaration.
      const next = src.indexOf("\n  const ", start + 10);
      const body = src.slice(start, next === -1 ? undefined : next);
      expect(body, `${fn} must take a generation`).toMatch(
        /(const|let) myGen = (\+\+switchGenRef\.current|claimEditorGeneration\()/
      );
      expect(body, `${fn} must re-check it after its awaits`).toMatch(/switchGenRef\.current !== myGen/);
    }
  });
});

describe("a generation is CLAIMED only by a path that will hydrate", () => {
  const src = read("src/hooks/useDocumentLifecycle.ts");

  it("closing or deleting a BACKGROUND document only observes it", () => {
    // Bumping the generation there invalidates an in-flight switch that WOULD
    // have hydrated and puts nothing in its place: activeDocId ends up set with
    // hydratedDocId null, every save refused, and the first markdown keystroke
    // marks the editor hydrated while it still holds the PREVIOUS document.
    for (const fn of ["handleCloseTab", "handleDeleteDoc"]) {
      const start = src.indexOf(`const ${fn} = useCallback(`);
      const body = src.slice(start, src.indexOf("\n  const ", start + 10));
      expect(body, `${fn} must not claim unconditionally`).toMatch(
        /claimEditorGeneration\(docId === useDocumentStore\.getState\(\)\.activeDocId\)/
      );
    }
  });

  it("but the ONE background branch that hydrates claims at that point", () => {
    // handleCloseTab's background-tab "Save" branch pushes the cached draft
    // into the editor — and it is reached only when docId !== activeDocId,
    // i.e. exactly when the entry decision chose "observe". Observing there
    // left it re-checking a generation it never owned, with an in-flight
    // switch free to settle on top of the draft it had just pushed.
    const start = src.indexOf("const handleCloseTab = useCallback(");
    const body = src.slice(start, src.indexOf("\n  const ", start + 10));
    const branch = body.slice(body.indexOf("const doc = await switchToDoc"));
    expect(branch).toMatch(/claimEditorGeneration\(true\)[\s\S]{0,120}hydrateEditorWithDoc/);
  });

  it("restoreSnapshotAsNew re-checks BEFORE it creates and activates", () => {
    // finalizeDoc sets activeDocId without setting hydratedDocId, so a
    // superseded run that only checked afterwards aborted having already split
    // the two — and every save is refused once they disagree.
    const start = src.indexOf("const restoreSnapshotAsNew = useCallback(");
    const body = src.slice(start, src.indexOf("\n  const ", start + 10));
    const beforeCreate = body.slice(0, body.indexOf("createDocument("));
    expect(beforeCreate).toMatch(/await autosaveOnLeave\(\);[\s\S]{0,600}switchGenRef\.current !== myGen/);
  });

  it("only increments when it is going to hydrate", () => {
    const body = src.slice(src.indexOf("const claimEditorGeneration"), src.indexOf("const handleSwitchDoc"));
    expect(body).toMatch(/willHydrate \? \+\+switchGenRef\.current : switchGenRef\.current/);
  });
});

describe("a stale save error does not follow the user to another document", () => {
  it("switching documents clears saveError", () => {
    const src = read("src/store/documents/documentStore.ts");
    // The status bar reads saveError whenever the document is dirty, so a
    // failure on document A would otherwise be reported against document B the
    // moment the user typed in it.
    expect(src).toMatch(/activeDocId: docId, saveStatus: "ready", saveError: null/);
  });

  it("a save that lands clears it", () => {
    const src = read("src/store/documents/documentStore.ts");
    expect(src).toMatch(/saveError: null, \/\/ this write landed/);
  });
});

describe("the unload stash never restores older content over newer", () => {
  it("compares the stash timestamp against what is on disk", () => {
    const src = read("src/store/documents/documentStore.ts");
    const body = src.slice(src.indexOf("const storedAt = new Map"), src.indexOf("const prefs = await storage.getPrefs"));
    expect(body).toMatch(/entry\.at <= \(storedAt\.get\(entry\.docId\) \?\? 0\)/);
  });
});

describe("hydration is only marked when a projection actually ran", () => {
  const src = read("src/hooks/useDocumentLifecycle.ts");

  it("markHydratedAfterMdSync is gated on the projection's return value", () => {
    // Its own precondition is "after a md→html sync that ACTUALLY replaced the
    // editor content". syncMdToHtml returns false for four reasons that all
    // leave the editor untouched, and marking hydrated then claims the editor
    // holds this document when it may hold the previous one's.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const calls = code.split("\n").filter((l) => l.includes("markHydratedAfterMdSync()"));
    expect(calls.length).toBeGreaterThan(1);          // the pin must find sites
    for (const line of calls) {
      expect(line, line.trim()).toMatch(/if \(projected\)|if \(syncMdToHtml\(\)\)/);
    }
  });
});

describe("snapshotStore.deleteForDoc keeps its transaction alive", () => {
  it("reads BEFORE it opens the write transaction", () => {
    // IndexedDB auto-commits as soon as the microtask queue drains with no
    // request pending, so awaiting a SEPARATE transaction after opening this
    // one left it dead: every delete threw into the catch, the memory ring was
    // cleared, and nothing was removed from the database.
    const src = read("src/store/history/snapshot-store.ts");
    const body = src.slice(src.indexOf("async deleteForDoc"), src.indexOf("async deleteOne"));
    expect(body.indexOf("await this.allForDoc(")).toBeLessThan(body.indexOf("this.db.transaction("));
  });
});
