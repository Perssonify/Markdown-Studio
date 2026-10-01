/**
 * A083 — the editor's context menu reads the document's headings only when its
 * "Link to heading" submenu is open.
 *
 * The heading list was an inline expression in EditorContextMenu's render, so
 * every render of the menu — and the editor shell re-renders it on every
 * keystroke — ran `getHeadings()`: a full `getJSON()` of the document and a walk
 * of it. Measured at 1.6 MB and 4x CPU, about 300 ms of every keystroke went
 * there, with the menu closed.
 */
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorContextMenu } from "../ui/EditorContextMenu";
import { useUIStore } from "../store/uiStore";

function apiWith(getHeadings) {
  return {
    dispatch: vi.fn(),
    getHeadings,
    insertHeadingLink: vi.fn(),
    clipboard: vi.fn(),
    promptInsert: vi.fn(),
  };
}

describe("EditorContextMenu — headings are read lazily", () => {
  let enabled;
  beforeEach(() => {
    enabled = useUIStore.getState().contextMenuEnabled;
    useUIStore.setState({ contextMenuEnabled: true });
  });
  afterEach(() => {
    useUIStore.setState({ contextMenuEnabled: enabled });
  });

  it("does not read them while the menu is closed, however often it renders", () => {
    const getHeadings = vi.fn(() => [{ level: 1, text: "Title" }]);
    const api = apiWith(getHeadings);
    const { rerender } = render(<EditorContextMenu api={api}><p>doc</p></EditorContextMenu>);
    for (let i = 0; i < 5; i++) rerender(<EditorContextMenu api={{ ...api }}><p>doc {i}</p></EditorContextMenu>);
    expect(getHeadings).not.toHaveBeenCalled();
  });

  it("reads them once the submenu opens", async () => {
    const getHeadings = vi.fn(() => [{ level: 2, text: "Section two" }]);
    const view = render(<EditorContextMenu api={apiWith(getHeadings)}><p>doc</p></EditorContextMenu>);
    fireEvent.contextMenu(view.getByText("doc"));
    const trigger = await view.findByText("Link to heading");
    fireEvent.click(trigger);
    expect(await view.findByText("Section two")).toBeTruthy();
    expect(getHeadings).toHaveBeenCalled();
  });
});
