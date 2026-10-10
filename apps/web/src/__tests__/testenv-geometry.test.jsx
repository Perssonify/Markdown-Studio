import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { TiptapPane } from "../ui/panes/tiptapPane";

/**
 * jsdom does not lay anything out, and it does not implement the geometry of a
 * text RANGE at all: `Range#getClientRects` / `Range#getBoundingClientRect` are
 * missing, where the Element versions exist and return zeros. ProseMirror and
 * CodeMirror both measure text through a Range.
 *
 * That turned into a suite that failed at random. Tiptap's `focus()` command
 * runs `view.focus()` and `scrollIntoView()` inside a requestAnimationFrame, so
 * a test that formats through `chain().focus()` (every dispatcher path does)
 * leaves a frame queued. When that frame fired before the environment was torn
 * down, ProseMirror's `coordsAtPos` called `range.getClientRects()`, threw
 * "getClientRects is not a function", and vitest exited 1 with every test
 * green. Whether the frame won the race depended on machine load, which is why
 * it showed up in roughly a third of runs and never on demand.
 *
 * `setup.js` gives Range the same empty geometry an Element already has.
 */
describe("test environment: text-range geometry", () => {
  it("a Range reports empty geometry instead of lacking the methods", () => {
    const range = document.createRange();
    range.selectNodeContents(document.body);
    expect(range.getClientRects()).toHaveLength(0);
    expect(range.getBoundingClientRect()).toMatchObject({ width: 0, height: 0, top: 0, left: 0 });
  });

  it("the frame Tiptap's focus() schedules can scroll the selection into view", async () => {
    // Collected rather than left to vitest's global handler, so the failure is
    // attributed to THIS case instead of surfacing as an unowned error after
    // the file has finished.
    const errors = [];
    const onError = (event) => {
      errors.push(String(event.error?.message ?? event.message));
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    try {
      const ref = createRef();
      await act(async () => {
        render(<TiptapPane ref={ref} isDark={false} defaultValue="<p>alpha bravo</p>" />);
      });
      const editor = ref.current.getEditor();
      editor.chain().focus("end").run();
      // Two frames: the one focus() queued, then one more so its work has run.
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      expect(errors).toEqual([]);
      expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
    } finally {
      window.removeEventListener("error", onError);
    }
  });
});
