/**
 * A110. PerssonifyEditor was split into hooks under src/editor/. Before that,
 * the logic in them could be reached only by mounting the whole editor (slow,
 * and only along the paths a mount happens to take) or pinned by reading the
 * component's source as text. These drive the extracted pieces directly, for
 * the rules the source pins can only describe:
 *
 *  - the workspace surfaces are ONE selection; the switcher selects, the
 *    shortcuts toggle, a layout choice returns to the editor, and a controlled
 *    graph goes through the host's setter, never the store's;
 *  - the tray refuses to OPEN into a region too short for it, never to close;
 *  - the host's onContentChange is debounced and cannot fire after unmount;
 *  - files handed to import are read, skipped with a reason, or ignored.
 */
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBottomTray } from "../editor/useBottomTray";
import { useContentChangeEmitter } from "../editor/useChangeNotifications";
import { collectImportItems } from "../editor/useImportPipeline";
import { useWorkspaceViews } from "../editor/useWorkspaceViews";
import { EDITOR_FLOOR_PX, TRAY_MIN_PX } from "../ui/tray-fit";

describe("useWorkspaceViews", () => {
  /** The hook with a real store stand-in, so setShowGraph feeds back as showGraph. */
  function harness(extra = {}) {
    const spies = { setShowGraph: vi.fn(), setMode: vi.fn() };
    const hook = renderHook(() => {
      const [showGraph, setShowGraphState] = useState(false);
      const [mode, setModeState] = useState("split");
      const views = useWorkspaceViews({
        showGraph,
        setShowGraph: (v) => { spies.setShowGraph(v); setShowGraphState(v); },
        setMode: (m) => { spies.setMode(m); setModeState(m); },
        ...extra,
      });
      return { ...views, mode };
    });
    return { hook, spies };
  }

  it("keeps ONE surface at a time", () => {
    const { hook } = harness();
    act(() => hook.result.current.showCardsView());
    expect(hook.result.current.workspaceView).toBe("cards");
    act(() => hook.result.current.showMapView());
    expect(hook.result.current.workspaceView).toBe("map");
    // Choosing the map lowered Cards — never both at once.
    expect(hook.result.current.cardsVisible).toBe(false);
    expect(hook.result.current.graphVisible).toBe(true);
    act(() => hook.result.current.showEditorView());
    expect(hook.result.current.workspaceView).toBe("editor");
    expect(hook.result.current.graphVisible).toBe(false);
  });

  it("the switcher selects, the shortcuts toggle", () => {
    const { hook } = harness();
    act(() => hook.result.current.showMapView());
    act(() => hook.result.current.showMapView());
    expect(hook.result.current.workspaceView).toBe("map"); // "go here" twice stays here
    act(() => hook.result.current.toggleCardsCb());
    expect(hook.result.current.workspaceView).toBe("cards"); // a toggle can also switch
    act(() => hook.result.current.toggleCardsCb());
    expect(hook.result.current.workspaceView).toBe("editor"); // ⌘⇧K twice puts you back
  });

  it("choosing a layout returns to the editor", () => {
    const { hook, spies } = harness();
    act(() => hook.result.current.showCardsView());
    act(() => hook.result.current.handleSetMode("md"));
    expect(spies.setMode).toHaveBeenCalledWith("md");
    expect(hook.result.current.mode).toBe("md");
    expect(hook.result.current.workspaceView).toBe("editor");
  });

  it("routes a controlled graph through the host's setter, never the store's", () => {
    const onGraphOpenChange = vi.fn();
    const { hook, spies } = harness({ graphOpen: false, onGraphOpenChange });
    act(() => hook.result.current.showMapView());
    expect(onGraphOpenChange).toHaveBeenLastCalledWith(true);
    expect(spies.setShowGraph).not.toHaveBeenCalled();
    // …and visibility follows the controlled prop, not a local copy.
    expect(hook.result.current.graphVisible).toBe(false);
  });
});

describe("useBottomTray", () => {
  const toast = { show: vi.fn() };
  beforeEach(() => toast.show.mockClear());

  function tray(height) {
    const hook = renderHook(() => useBottomTray({ toast }));
    hook.result.current.trayRegionRef.current = { clientHeight: height };
    return hook;
  }

  it("refuses to OPEN into a region that cannot hold the editor and the tray — by either toggle", () => {
    const hook = tray(EDITOR_FLOOR_PX + TRAY_MIN_PX - 1);
    act(() => hook.result.current.toggleTray());
    expect(hook.result.current.trayOpen).toBe(false);
    act(() => hook.result.current.toggleLinksTray());
    expect(hook.result.current.trayOpen).toBe(false);
    expect(toast.show).toHaveBeenCalledWith(expect.stringMatching(/Not enough height/), "warning");
  });

  it("opens when there is room, and never refuses to close", () => {
    const hook = tray(800);
    act(() => hook.result.current.toggleTray());
    expect(hook.result.current.trayOpen).toBe(true);
    hook.result.current.trayRegionRef.current = { clientHeight: 1 }; // the window shrank
    act(() => hook.result.current.toggleTray());
    expect(hook.result.current.trayOpen).toBe(false);
    expect(toast.show).not.toHaveBeenCalled();
  });

  it("the links chip switches an open tray to Links, and closes only its own tab", () => {
    const hook = tray(800);
    act(() => hook.result.current.setTrayTab("console"));
    act(() => hook.result.current.toggleTray());
    act(() => hook.result.current.toggleLinksTray());
    expect(hook.result.current.trayOpen).toBe(true);
    expect(hook.result.current.trayTab).toBe("links");
    act(() => hook.result.current.toggleLinksTray());
    expect(hook.result.current.trayOpen).toBe(false);
  });
});

describe("useContentChangeEmitter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const panes = (md) => ({
    cmRef: { current: { getValue: () => md.value } },
    tiptapRef: { current: { getHTML: () => `<p>${md.value}</p>` } },
    getCanonical: () => ({ type: "doc", text: md.value }),
  });

  it("sends the host one notification per pause, with the latest content", () => {
    const md = { value: "a" };
    const onContentChange = vi.fn();
    const { result } = renderHook(() =>
      useContentChangeEmitter({ ...panes(md), activeDoc: { id: "doc-1" }, onContentChange })
    );
    act(() => { result.current(); vi.advanceTimersByTime(100); });
    md.value = "ab";
    act(() => { result.current(); vi.advanceTimersByTime(299); });
    expect(onContentChange).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onContentChange).toHaveBeenCalledTimes(1);
    expect(onContentChange).toHaveBeenCalledWith({
      docId: "doc-1", markdown: "ab", html: "<p>ab</p>", canonical: { type: "doc", text: "ab" },
    });
  });

  it("stays silent with no active document", () => {
    const onContentChange = vi.fn();
    const { result } = renderHook(() =>
      useContentChangeEmitter({ ...panes({ value: "a" }), activeDoc: null, onContentChange })
    );
    act(() => { result.current(); vi.advanceTimersByTime(1000); });
    expect(onContentChange).not.toHaveBeenCalled();
  });

  it("cannot fire into a host after the editor unmounts", () => {
    const onContentChange = vi.fn();
    const { result, unmount } = renderHook(() =>
      useContentChangeEmitter({ ...panes({ value: "a" }), activeDoc: { id: "doc-1" }, onContentChange })
    );
    act(() => { result.current(); });
    unmount();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onContentChange).not.toHaveBeenCalled();
  });
});

describe("collectImportItems", () => {
  const noPrompt = vi.fn(async () => null);

  it("reads text files, ignores images, and skips (and names) what it cannot take", async () => {
    const files = [
      new File(["# Notes\n\nbody"], "notes.md", { type: "text/markdown" }),
      new File([new Uint8Array(4)], "photo.png", { type: "image/png" }),
      new File([new Uint8Array(5_000_001)], "huge.md", { type: "text/markdown" }),
      new File(["not a zip"], "broken.docx"),
    ];
    const { items, skipped } = await collectImportItems(files, noPrompt);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ raw: "# Notes\n\nbody", folderPath: [] });
    // An image is not a document: dropped silently, never reported as a failure.
    expect(skipped).toEqual(["huge.md", "broken.docx"]);
    expect(noPrompt).not.toHaveBeenCalled();
  });
});
