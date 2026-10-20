/**
 * PL-51: the custom right-click menu took over the browser's own, and with it
 * the browser's spelling suggestions. Shift + right-click now always reaches
 * the browser's menu (the editor and the library), the custom menu says so,
 * and Settings ▸ Editor can turn the custom menu off for good.
 */
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorContextMenu } from "../ui/chrome/editorContextMenu";
import { useUIStore } from "../store/preferences/uiStore";

const api = () => ({ dispatch: vi.fn(), getHeadings: () => [], insertHeadingLink: vi.fn(), clipboard: vi.fn(), promptInsert: vi.fn() });

/** Right-click `el`, and say whether the page cancelled the browser's menu. */
function rightClick(el, init = {}) {
  const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 10, ...init });
  el.dispatchEvent(ev);
  return { browserMenu: !ev.defaultPrevented };
}

describe("the editor's right-click menu and the browser's own", () => {
  let enabled;
  beforeEach(() => { enabled = useUIStore.getState().contextMenuEnabled; });
  afterEach(() => useUIStore.setState({ contextMenuEnabled: enabled }));

  it("a plain right-click opens the custom menu — which says how to reach spelling suggestions", async () => {
    useUIStore.setState({ contextMenuEnabled: true });
    const view = render(<EditorContextMenu api={api()}><p>doc</p></EditorContextMenu>);
    expect(rightClick(view.getByText("doc")).browserMenu).toBe(false);
    expect(await view.findByText(/Shift \+ right-click opens the browser's menu/)).toBeTruthy();
  });

  it("Shift + right-click is left to the browser, and the custom menu stays shut", () => {
    useUIStore.setState({ contextMenuEnabled: true });
    const view = render(<EditorContextMenu api={api()}><p>doc</p></EditorContextMenu>);
    expect(rightClick(view.getByText("doc"), { shiftKey: true }).browserMenu).toBe(true);
    expect(view.queryByRole("menu")).toBeNull();
  });

  it("Shift+F10 (the keyboard's menu key) still opens the app's menu", () => {
    useUIStore.setState({ contextMenuEnabled: true });
    const view = render(<EditorContextMenu api={api()}><p>doc</p></EditorContextMenu>);
    // A keyboard-opened menu: no mouse button (Chromium also gives it an empty pointerType).
    expect(rightClick(view.getByText("doc"), { shiftKey: true, button: 0 }).browserMenu).toBe(false);
  });

  it("with the custom menu switched off, every right-click is the browser's", () => {
    useUIStore.setState({ contextMenuEnabled: false });
    const view = render(<EditorContextMenu api={api()}><p>doc</p></EditorContextMenu>);
    expect(rightClick(view.getByText("doc")).browserMenu).toBe(true);
    expect(view.queryByRole("menu")).toBeNull();
  });
});
