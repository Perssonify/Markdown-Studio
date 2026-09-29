import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHORTCUT_GROUPS } from "../data/shortcuts";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useUIStore } from "../store/uiStore";

/**
 * `useKeyboardShortcuts` had no tests at all, and one documented binding was
 * dead because of branch ORDER: a bare `key === "f"` check ran before the
 * ⌥⌘F branch and returned, so ⌥⌘F opened plain Find. Combined with macOS
 * consuming ⌘H (Hide Application) before the page sees it, Replace had no
 * working keyboard route on a Mac at all — while the Help page and every
 * shortcut dialog advertised one.
 */
/**
 * A tiptapRef whose editor DOM contains the focused element, so
 * `tiptapHasFocus` is true and the rich-pane branch is actually entered.
 * Every test used `{ current: null }`, so the early return that decided the
 * fate of half the documented shortcuts was never executed once — which is
 * exactly why six of them shipped dead or wrong in that pane.
 */
function richPaneRef(container) {
  const dom = document.createElement("div");
  dom.tabIndex = -1;
  container.appendChild(dom);
  dom.focus();
  return { current: { getEditor: () => ({ view: { dom } }) } };
}

/** Containers are appended to <body>; a leaked one keeps FOCUS, and the
 *  listener is scoped to "focus is in this editor, or nowhere". Without this
 *  cleanup a markdown-pane test running after a rich-pane one saw
 *  document.activeElement still inside the PREVIOUS container and never fired. */
const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop().remove();
  document.body.focus?.();
});

/**
 * The container arrives LATE. PerssonifyEditor renders an "Initializing Engine…"
 * branch before the editor container exists, so the hook's effect always runs
 * once with a null ref. It used to return there and rely on a later run — which
 * happened only because every handler passed to it was an inline arrow with a
 * fresh identity each render. Stabilising those handlers (a correct, separate
 * performance fix) removed the accidental re-run and killed EVERY shortcut:
 * measured in a browser after a reload, ⌘F, ⌘⇧D, ⌘⇧K and ⌘⇧G all did nothing.
 */
describe("the container mounting after the first render", () => {
  it("still binds the shortcuts, with no change to the hook's inputs", () => {
    const ref = { current: null };
    const calls = { ...noopCalls(), toggleFind: vi.fn() };
    const { rerender } = renderHook(() =>
      useKeyboardShortcuts(ref, { ...calls, tiptapRef: { current: null } })
    );

    // The engine is still initialising: no container, nothing to scope to.
    press(document, "f");
    expect(calls.toggleFind).not.toHaveBeenCalled();

    // It mounts. Nothing else about the hook's inputs changes — that is the
    // whole point — so the effect must not need to re-run.
    const container = document.createElement("div");
    document.body.appendChild(container);
    mounted.push(container);
    ref.current = container;
    rerender();

    press(document, "f");
    expect(calls.toggleFind).toHaveBeenCalledTimes(1);
  });

  it("does nothing at all while there is no container", () => {
    const ref = { current: null };
    const calls = noopCalls();
    renderHook(() => useKeyboardShortcuts(ref, { ...calls, tiptapRef: { current: null } }));
    for (const k of ["f", "s", "n", "k"]) press(document, k);
    for (const fn of Object.values(calls)) {
      if (typeof fn === "function") expect(fn).not.toHaveBeenCalled();
    }
  });
});

function noopCalls() {
  return {
    toggleFind: vi.fn(),
    openReplace: vi.fn(),
    openSearch: vi.fn(),
    save: vi.fn(),
    newDoc: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleGraph: vi.fn(),
    toggleCards: vi.fn(),
    dispatch: vi.fn(),
    updateFormats: vi.fn(),
    cancelPendingSync: vi.fn(),
    promptLink: vi.fn(),
    toast: { show: vi.fn() },
  };
}

function setup({ richFocus = false } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mounted.push(container);
  const calls = {
    toggleFind: vi.fn(),
    openReplace: vi.fn(),
    openSearch: vi.fn(),
    save: vi.fn(),
    newDoc: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleGraph: vi.fn(),
    toggleCards: vi.fn(),
    dispatch: vi.fn(),
    updateFormats: vi.fn(),
    cancelPendingSync: vi.fn(),
    promptLink: vi.fn(),
    toast: { show: vi.fn() },
  };
  const tiptapRef = richFocus ? richPaneRef(container) : { current: null };
  renderHook(() =>
    useKeyboardShortcuts({ current: container }, { ...calls, tiptapRef })
  );
  return { container, calls };
}

/** Dispatch a keydown the way a real browser would, including `code`. */
function press(container, key, { alt = false, shift = false, code } = {}) {
  const e = new KeyboardEvent("keydown", {
    key,
    code: code ?? `Key${key.toUpperCase()}`,
    metaKey: true,
    altKey: alt,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  container.dispatchEvent(e);
  return e;
}

describe("useKeyboardShortcuts", () => {
  beforeEach(() => {
    useUIStore.setState({ keyboardShortcutsEnabled: true });
  });

  it("⌘F opens find", () => {
    const { container, calls } = setup();
    press(container, "f");
    expect(calls.toggleFind).toHaveBeenCalledTimes(1);
    expect(calls.openReplace).not.toHaveBeenCalled();
  });

  it("⌥⌘F opens find & REPLACE, not plain find", () => {
    const { container, calls } = setup();
    press(container, "f", { alt: true });
    expect(calls.openReplace).toHaveBeenCalledTimes(1);
    expect(calls.toggleFind).not.toHaveBeenCalled();
  });

  it("⌥⌘F still works when macOS composes Option+F into 'ƒ'", () => {
    const { container, calls } = setup();
    press(container, "ƒ", { alt: true, code: "KeyF" });
    expect(calls.openReplace).toHaveBeenCalledTimes(1);
    expect(calls.toggleFind).not.toHaveBeenCalled();
  });

  it("⌘⇧F opens the all-notes search", () => {
    const { container, calls } = setup();
    press(container, "f", { shift: true });
    expect(calls.openSearch).toHaveBeenCalledTimes(1);
    expect(calls.toggleFind).not.toHaveBeenCalled();
  });

  it("⌘H opens replace (reachable on Windows/Linux)", () => {
    const { container, calls } = setup();
    press(container, "h");
    expect(calls.openReplace).toHaveBeenCalledTimes(1);
  });

  it("honours the Settings toggle that disables shortcuts", () => {
    useUIStore.setState({ keyboardShortcutsEnabled: false });
    const { container, calls } = setup();
    press(container, "f");
    press(container, "s");
    expect(calls.toggleFind).not.toHaveBeenCalled();
    expect(calls.save).not.toHaveBeenCalled();
  });

  it("ignores a plain keypress with no modifier", () => {
    const { container, calls } = setup();
    const e = new KeyboardEvent("keydown", { key: "f", code: "KeyF", bubbles: true, cancelable: true });
    container.dispatchEvent(e);
    expect(calls.toggleFind).not.toHaveBeenCalled();
  });
});


/**
 * The rich pane used to be handed everything below an early return, on the
 * assumption TipTap's keymap covered it. Read against the installed extensions
 * it does not: ⌘⇧X is Mod-Shift-s, ⌘⇧1–6 are Mod-Alt-N, ⌘⇧0 is Mod-Alt-0,
 * ⌘]/⌘[ are bound by nothing — and ⌘⇧9 is toggleTaskList, so the documented
 * "Blockquote" produced a task list in one pane and a blockquote in the other.
 */
describe("formatting chords reach BOTH panes", () => {
  beforeEach(() => { useUIStore.setState({ keyboardShortcutsEnabled: true }); });

  const CASES = [
    ["⌘⇧X strikethrough", { key: "x", shift: true, code: "KeyX" }, ["strikethrough"]],
    ["⌘⇧H highlight", { key: "h", shift: true, code: "KeyH" }, ["hiliteColor", "#f59e0b"]],
    ["⌘⇧1 heading 1", { key: "!", shift: true, code: "Digit1" }, ["heading", 1]],
    ["⌘⇧6 heading 6", { key: "^", shift: true, code: "Digit6" }, ["heading", 6]],
    ["⌘⇧0 paragraph", { key: ")", shift: true, code: "Digit0" }, ["heading", 0]],
    ["⌘⇧9 blockquote", { key: "(", shift: true, code: "Digit9" }, ["blockquote"]],
    ["⌘] indent", { key: "]", code: "BracketRight" }, ["indent"]],
    ["⌘[ outdent", { key: "[", code: "BracketLeft" }, ["outdent"]],
    ["⌘B bold", { key: "b", code: "KeyB" }, ["bold"]],
  ];

  for (const [name, keyOpts, expected] of CASES) {
    for (const richFocus of [false, true]) {
      it(`${name} — ${richFocus ? "rich" : "markdown"} pane`, () => {
        const { container, calls } = setup({ richFocus });
        const e = press(container, keyOpts.key, { shift: keyOpts.shift, code: keyOpts.code });
        expect(calls.dispatch).toHaveBeenCalledWith(...expected);
        // preventDefault matters in the rich pane: without it TipTap's own
        // keymap ALSO fires, and for ⌘⇧9 it does something different.
        expect(e.defaultPrevented).toBe(true);
      });
    }
  }
});

describe("every documented shortcut has a binding", () => {
  it("no SHORTCUT_GROUPS row advertises a key nothing handles", () => {
    const src = readFileSync(join(process.cwd(), "src/hooks/useKeyboardShortcuts.ts"), "utf8");
    // Formatting rows are dispatched by command name; check each one appears.
    const commands = {
      "Strikethrough": "strikethrough", "Highlight": "hiliteColor",
      "Blockquote": "blockquote", "Indent / Outdent": "indent",
      "Bulleted list": "bulletList", "Numbered list": "orderedList",
      "Bold": "bold", "Italic": "italic", "Underline": "underline",
    };
    const rows = SHORTCUT_GROUPS.flatMap((g) => g.rows);
    const missing = [];
    for (const row of rows) {
      const cmd = commands[row.action];
      if (cmd && !src.includes(`"${cmd}"`)) missing.push(row.action);
    }
    expect(missing).toEqual([]);
  });
});
