import { defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { render, renderHook } from "@testing-library/react";
import { createElement, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { CodeMirrorPane } from "../ui/CodeMirrorPane";
import { useUIStore } from "../store/uiStore";
import { dropAltGraphChords, isAltGraphInput } from "../utils/alt-graph";

/**
 * A052 — AltGr is how most non-US keyboards TYPE `[`, `]`, `\`, `{`, `}`, `@`…
 * Windows delivers it as Ctrl+Alt, and the shortcut hook read "Ctrl or Meta" as
 * a chord: `[` / `]` (AltGr+8 / AltGr+9 on a German layout) were eaten as
 * outdent / indent in both panes, and Hungarian AltGr+F — its `[` — opened
 * Find & Replace. Markdown links, task lists and wiki links became untypable.
 */

const key = (init) =>
  new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });

describe("isAltGraphInput", () => {
  it("treats Windows AltGr (Ctrl+Alt) producing a symbol as typing", () => {
    // German AltGr+8 → "[" ; AltGr+9 → "]"
    expect(isAltGraphInput(key({ key: "[", code: "Digit8", ctrlKey: true, altKey: true }), false)).toBe(true);
    expect(isAltGraphInput(key({ key: "]", code: "Digit9", ctrlKey: true, altKey: true }), false)).toBe(true);
  });

  it("treats a symbol on a LETTER key as typing (Hungarian AltGr+F → '[')", () => {
    expect(isAltGraphInput(key({ key: "[", code: "KeyF", ctrlKey: true, altKey: true }), false)).toBe(true);
  });

  it("treats a non-ASCII letter as typing (Polish AltGr+L → 'ł')", () => {
    expect(isAltGraphInput(key({ key: "ł", code: "KeyL", ctrlKey: true, altKey: true }), false)).toBe(true);
  });

  it("treats a symbol on a punctuation key as typing (Swiss AltGr+ü → '[')", () => {
    // Reading `key` against a US interpretation of `code` would call this a
    // deliberate Ctrl+Alt+[ and hand it straight back to the outdent chord.
    expect(isAltGraphInput(key({ key: "[", code: "BracketLeft", ctrlKey: true, altKey: true }), false)).toBe(true);
  });

  it("believes the browser when it reports the AltGraph modifier (Linux: no ctrl/alt flags)", () => {
    expect(isAltGraphInput(key({ key: "[", code: "Digit8", modifierAltGraph: true }), false)).toBe(true);
  });

  it("keeps a deliberate Ctrl+Alt+<letter> as a chord (the documented Ctrl+Alt+F)", () => {
    expect(isAltGraphInput(key({ key: "f", code: "KeyF", ctrlKey: true, altKey: true }), false)).toBe(false);
  });

  it("never treats a ⌘ chord as AltGr — ⌥⌘F on a Mac is real", () => {
    expect(isAltGraphInput(key({ key: "ƒ", code: "KeyF", metaKey: true, altKey: true }), true)).toBe(false);
    expect(isAltGraphInput(key({ key: "ƒ", code: "KeyF", metaKey: true, altKey: true }), false)).toBe(false);
  });

  it("is not triggered by plain Ctrl chords", () => {
    expect(isAltGraphInput(key({ key: "[", code: "BracketLeft", ctrlKey: true }), false)).toBe(false);
    expect(isAltGraphInput(key({ key: "b", code: "KeyB", ctrlKey: true }), false)).toBe(false);
  });

  it("on a Mac, Ctrl+Option is never AltGr (Option composes on its own)", () => {
    expect(isAltGraphInput(key({ key: "[", code: "Digit5", ctrlKey: true, altKey: true }), true)).toBe(false);
  });
});

// ── The shortcut hook ────────────────────────────────────────────────────────

const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop().remove();
  document.body.focus?.();
});

/** A markdown pane whose content DOM holds focus — AltGr typing happens in an
 *  editor, so this is where the bug bit. */
function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mounted.push(container);
  const cmDom = document.createElement("div");
  cmDom.className = "cm-editor";
  const content = document.createElement("div");
  content.className = "cm-content";
  content.tabIndex = -1;
  cmDom.appendChild(content);
  container.appendChild(cmDom);
  content.focus();
  const calls = {
    toggleFind: vi.fn(), openReplace: vi.fn(), openSearch: vi.fn(), save: vi.fn(),
    newDoc: vi.fn(), toggleSidebar: vi.fn(), toggleGraph: vi.fn(), toggleCards: vi.fn(),
    dispatch: vi.fn(), updateFormats: vi.fn(), cancelPendingSync: vi.fn(),
    promptLink: vi.fn(), toast: { show: vi.fn() },
  };
  renderHook(() =>
    useKeyboardShortcuts({ current: container }, {
      ...calls,
      tiptapRef: { current: null },
      cmRef: { current: { getView: () => ({ dom: cmDom, contentDOM: content }) } },
      workspaceView: "editor",
    })
  );
  return { content, calls };
}

describe("useKeyboardShortcuts leaves AltGr typing alone", () => {
  beforeEach(() => useUIStore.setState({ keyboardShortcutsEnabled: true }));

  it("AltGr+8 / AltGr+9 type '[' / ']' instead of outdent / indent", () => {
    const { content, calls } = setup();
    const open = key({ key: "[", code: "Digit8", ctrlKey: true, altKey: true });
    const close = key({ key: "]", code: "Digit9", ctrlKey: true, altKey: true });
    content.dispatchEvent(open);
    content.dispatchEvent(close);
    expect(calls.dispatch).not.toHaveBeenCalled();
    // Not cancelled: the browser's default action is what types the character.
    expect(open.defaultPrevented).toBe(false);
    expect(close.defaultPrevented).toBe(false);
  });

  it("Hungarian AltGr+F types '[' instead of opening Find & Replace", () => {
    const { content, calls } = setup();
    const e = key({ key: "[", code: "KeyF", ctrlKey: true, altKey: true });
    content.dispatchEvent(e);
    expect(calls.openReplace).not.toHaveBeenCalled();
    expect(calls.toggleFind).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("the deliberate Ctrl+Alt+F (Windows spelling of ⌥⌘F) still opens Replace", () => {
    const { content, calls } = setup();
    content.dispatchEvent(key({ key: "f", code: "KeyF", ctrlKey: true, altKey: true }));
    expect(calls.openReplace).toHaveBeenCalledTimes(1);
  });

  it("an ordinary Ctrl+[ still outdents", () => {
    const { content, calls } = setup();
    content.dispatchEvent(key({ key: "[", code: "BracketLeft", ctrlKey: true }));
    expect(calls.dispatch).toHaveBeenCalledWith("outdent");
  });
});

// ── CodeMirror's own keymap ──────────────────────────────────────────────────

describe("the markdown pane's keymap has no Ctrl+Alt+<character> bindings", () => {
  const PANE_KEYMAP = [...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab];

  it("drops Mod-Alt-\\ off the Mac and keeps it on the Mac", () => {
    const has = (list) => list.some((b) => b.key === "Mod-Alt-\\");
    expect(has(PANE_KEYMAP)).toBe(true); // the binding really is in the default keymap
    expect(has(dropAltGraphChords(PANE_KEYMAP, false))).toBe(false);
    expect(has(dropAltGraphChords(PANE_KEYMAP, true))).toBe(true);
  });

  it("keeps letter chords, named keys and plain Mod chords", () => {
    const kept = dropAltGraphChords(PANE_KEYMAP, false).map((b) => b.key);
    expect(kept).toContain("Mod-Alt-g");        // a letter: AltGr never yields the key's own letter
    expect(kept).toContain("Mod-Alt-ArrowUp");  // a named key is not text
    expect(kept).toContain("Mod-[");
    expect(kept).toContain("Mod-]");
    expect(dropAltGraphChords(PANE_KEYMAP, false).length).toBe(PANE_KEYMAP.length - 1);
  });

  /** Drive a real EditorView: the keymap is only wrong if it CONSUMES the key. */
  function backslashKeydown(bindings) {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    mounted.push(parent);
    const view = new EditorView({
      state: EditorState.create({ doc: "text", extensions: [keymap.of(bindings)] }),
      parent,
    });
    // German AltGr+ß → "\"
    const e = key({ key: "\\", code: "Minus", ctrlKey: true, altKey: true });
    view.contentDOM.dispatchEvent(e);
    view.destroy();
    return e;
  }

  it("lets AltGr type a backslash (the unfiltered keymap consumed it)", () => {
    expect(backslashKeydown(PANE_KEYMAP).defaultPrevented).toBe(true);
    expect(backslashKeydown(dropAltGraphChords(PANE_KEYMAP, false)).defaultPrevented).toBe(false);
  });

  it("the MOUNTED markdown pane lets AltGr type a backslash", () => {
    // The wiring, not just the helper: this is the pane users type into.
    const ref = createRef();
    const { unmount } = render(createElement(CodeMirrorPane, { ref, isDark: false, defaultValue: "x" }));
    const view = ref.current.getView();
    const e = key({ key: "\\", code: "Minus", ctrlKey: true, altKey: true });
    view.contentDOM.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    unmount();
  });
});
