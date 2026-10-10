/**
 * Formatting commands must act on the selection the user can SEE.
 *
 * Browsers fire `selectionchange` asynchronously, and ProseMirror only reads the
 * DOM selection when it does. A command issued within a few milliseconds of a
 * Shift+Arrow selection therefore ran against a stale, still-collapsed
 * selection: ⌘B set a stored mark at the caret instead of bolding the selected
 * text, and that mark was dropped the moment the real selection landed.
 *
 * Measured in a real browser before the fix: with no gap between the selection
 * and the keypress, 0 of 5 attempts bolded; with a 10ms gap, all of them did.
 * After the fix, 5 of 5 at zero gap.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createRef } from "react";
import { useFormatDispatcher } from "../formatting/useFormatDispatcher";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts.js";
import { useUIStore } from "../store/preferences/uiStore";

/** A tiptap handle that records the ORDER of what the dispatcher does to it. */
function fakeTiptap(order) {
  const chain = {
    toggleBold: () => { order.push("toggleBold"); return chain; },
    toggleItalic: () => { order.push("toggleItalic"); return chain; },
    run: () => { order.push("run"); return true; },
  };
  return {
    syncSelectionFromDom: vi.fn(() => order.push("syncSelectionFromDom")),
    getEditor: () => ({ chain: () => ({ focus: () => chain }), state: {}, isDestroyed: false }),
    isActive: () => false,
    getAttributes: () => ({}),
    getHTML: () => "",
    setHTML: () => {},
  };
}

describe("the dispatcher reads the live selection before commanding", () => {
  it("syncs the DOM selection BEFORE running a rich-pane command", () => {
    const order = [];
    const tiptapRef = { current: fakeTiptap(order) };
    const cmRef = { current: null };
    const { result } = renderHook(() =>
      useFormatDispatcher({ cmRef, tiptapRef, mode: "html" })
    );
    act(() => result.current.dispatch("bold"));
    expect(order).toEqual(["syncSelectionFromDom", "toggleBold", "run"]);
  });

  it("still works against a handle that predates the method", () => {
    // The call is optional-chained so a partial ref (older embed, a test double)
    // cannot throw.
    const order = [];
    const tiptapRef = { current: fakeTiptap(order) };
    delete tiptapRef.current.syncSelectionFromDom;
    const { result } = renderHook(() =>
      useFormatDispatcher({ cmRef: { current: null }, tiptapRef, mode: "html" })
    );
    act(() => result.current.dispatch("bold"));
    expect(order).toEqual(["toggleBold", "run"]);
  });
});

describe("the shortcut listener syncs before ProseMirror's own keymap sees the key", () => {
  const mount = (tiptapRef) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const containerRef = createRef();
    containerRef.current = container;
    const opts = {
      dispatch: vi.fn(), updateFormats: vi.fn(), save: vi.fn(), newDoc: vi.fn(),
      toast: { show: vi.fn() }, toggleFind: vi.fn(), toggleSidebar: vi.fn(),
      cancelPendingSync: vi.fn(), tiptapRef,
    };
    const hook = renderHook(() => useKeyboardShortcuts(containerRef, opts));
    return { container, hook, opts };
  };
  const key = (container, init) =>
    act(() => {
      container.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
    });

  it("flushes on a modifier chord", () => {
    const tiptapRef = { current: fakeTiptap([]) };
    const { container } = mount(tiptapRef);
    key(container, { key: "b", ctrlKey: true });
    expect(tiptapRef.current.syncSelectionFromDom).toHaveBeenCalled();
  });

  it("does NOT flush on ordinary typing", () => {
    // It must stay off the per-keystroke path.
    const tiptapRef = { current: fakeTiptap([]) };
    const { container } = mount(tiptapRef);
    for (const k of ["a", "b", "Shift", "ArrowLeft"]) key(container, { key: k });
    expect(tiptapRef.current.syncSelectionFromDom).not.toHaveBeenCalled();
  });

  it("does nothing when shortcuts are disabled", () => {
    const prev = useUIStore.getState().keyboardShortcutsEnabled;
    useUIStore.setState({ keyboardShortcutsEnabled: false });
    try {
      const tiptapRef = { current: fakeTiptap([]) };
      const { container } = mount(tiptapRef);
      key(container, { key: "b", ctrlKey: true });
      expect(tiptapRef.current.syncSelectionFromDom).not.toHaveBeenCalled();
    } finally {
      useUIStore.setState({ keyboardShortcutsEnabled: prev });
    }
  });
});
