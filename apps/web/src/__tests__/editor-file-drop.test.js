/**
 * A file dropped on the editor must never navigate the tab away.
 *
 * There was NO drop handler anywhere in `src/` — no `dragover`, no `drop` — so
 * a file dropped on either pane got the browser default, which navigates the
 * tab to the file. That discards everything typed since the last autosave, and
 * it is the one input gesture that leaves nothing behind: no draft, no undo,
 * no snapshot.
 *
 * A text or HTML drag WITHIN the document is a different gesture and must still
 * reach CodeMirror and ProseMirror, so only drags carrying files are taken.
 */
import React, { createRef } from "react";
import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorLayout } from "../ui/panes/editorPanes";

function mount(onFileDrop) {
  const props = {
    mode: "split",
    cmRef: createRef(),
    tiptapRef: createRef(),
    syncMode: "styled",
    onSyncModeChange: () => {},
    pasteStyled: true,
    setPasteStyled: () => {},
    onFileDrop,
  };
  const { container } = render(React.createElement(EditorLayout, props));
  return container.querySelector('[data-tour="editor"]');
}

/** A DragEvent carrying files, as a real file drop does. */
function fileDrag(type, target) {
  const files = [new File(["# dropped"], "dropped.md", { type: "text/markdown" })];
  const dataTransfer = { types: ["Files"], files, dropEffect: "none" };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  const defaultPrevented = !fireEvent(target, event);
  return { defaultPrevented, dataTransfer };
}

/** The same gesture, dragging text — the panes' own business. */
function textDrag(type, target) {
  const dataTransfer = { types: ["text/plain"], files: [], dropEffect: "none" };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return { defaultPrevented: !fireEvent(target, event) };
}

describe("dropping a file on the editor", () => {
  it("prevents the browser's navigate-to-file default", () => {
    const el = mount(vi.fn());
    expect(fileDrag("dragover", el).defaultPrevented).toBe(true);
    expect(fileDrag("drop", el).defaultPrevented).toBe(true);
  });

  it("hands the files to the importer", () => {
    const onFileDrop = vi.fn();
    const el = mount(onFileDrop);
    fileDrag("drop", el);
    expect(onFileDrop).toHaveBeenCalledTimes(1);
    expect(onFileDrop.mock.calls[0][0][0].name).toBe("dropped.md");
  });

  it("still refuses the navigation when no importer is wired", () => {
    // A library host may not pass onFileDrop. Losing the document to a
    // navigation is not an acceptable fallback for "we can't import this".
    const el = mount(undefined);
    expect(fileDrag("drop", el).defaultPrevented).toBe(true);
  });

  it("leaves a text drag to CodeMirror and ProseMirror", () => {
    const onFileDrop = vi.fn();
    const el = mount(onFileDrop);
    expect(textDrag("dragover", el).defaultPrevented).toBe(false);
    expect(textDrag("drop", el).defaultPrevented).toBe(false);
    expect(onFileDrop).not.toHaveBeenCalled();
  });
});
