import { renderHook } from "@testing-library/react";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFormatDispatcher } from "../formatting/useFormatDispatcher";
import { useUIStore } from "../store/uiStore";

/**
 * Read-only mode regression tests.
 *
 * Native pane editability (Tiptap `setEditable(false)` / CodeMirror's
 * `EditorState.readOnly`) only blocks TYPING, paste and drop. Every PROGRAMMATIC
 * mutation — toolbar, menu bar, keyboard shortcut, right-click menu — funnels
 * through `useFormatDispatcher.dispatch`, whose early return is the single
 * choke-point. Selection commands are non-mutating and are deliberately routed
 * BEFORE that guard, so they must keep working while read-only.
 */

/** Fake TiptapRef whose chain records the commands it was asked to run. */
function createTiptapRef() {
  const calls = [];
  const chain = new Proxy(
    {},
    {
      get: (_t, prop) => (...args) => {
        calls.push(args.length ? `${String(prop)}(${JSON.stringify(args[0])})` : String(prop));
        return String(prop) === "run" ? true : chain;
      },
    }
  );
  const editor = {
    chain: () => chain,
    commands: { clearContent: () => { calls.push("clearContent"); } },
  };
  return {
    calls,
    ref: {
      current: {
        getEditor: () => editor,
        isActive: () => false,
        getAttributes: () => ({}),
        getHTML: () => "",
        setHTML: () => {},
      },
    },
  };
}

/**
 * Real CM6 view (works headless in jsdom) behind the dispatcher's cmRef shape.
 * Views are destroyed in afterEach: `selectScope` asks CodeMirror to scroll the
 * selection into view, and a live view's queued measure pass explodes in jsdom
 * (Range#getClientRects is unimplemented) after the test has finished.
 */
const liveViews = [];
afterEach(() => {
  while (liveViews.length) liveViews.pop().destroy();
});

function createCmRef(doc, anchor = 0, head = anchor) {
  const parent = document.createElement("div");
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
  const view = new EditorView({ state, parent });
  liveViews.push(view);
  return {
    view,
    ref: { current: { getView: () => view, getValue: () => view.state.doc.toString() } },
  };
}

function mount({ cmRef, tiptapRef, mode }) {
  const syncMdToHtml = vi.fn();
  const syncHtmlToMd = vi.fn();
  const scheduleAutosave = vi.fn();
  const { result } = renderHook(() =>
    useFormatDispatcher({ cmRef, tiptapRef, mode, syncMdToHtml, syncHtmlToMd, scheduleAutosave })
  );
  return { result, syncMdToHtml, syncHtmlToMd, scheduleAutosave };
}

describe("read-only gates programmatic mutations (useFormatDispatcher)", () => {
  beforeEach(() => {
    // Session-only (not the persisting setter) so the test can't write pf:read-only.
    useUIStore.setState({ readOnly: false });
  });
  afterEach(() => {
    useUIStore.setState({ readOnly: false });
  });

  it("refuses a mutating command in the RICH pane while read-only", () => {
    const tiptap = createTiptapRef();
    const { result, syncHtmlToMd, scheduleAutosave } = mount({
      cmRef: { current: null }, tiptapRef: tiptap.ref, mode: "html",
    });

    useUIStore.setState({ readOnly: true });
    result.current.dispatch("bold");

    expect(tiptap.calls).toEqual([]);      // the editor was never touched
    expect(syncHtmlToMd).not.toHaveBeenCalled();
    expect(scheduleAutosave).not.toHaveBeenCalled();
  });

  it("performs the same command once read-only is off", () => {
    const tiptap = createTiptapRef();
    const { result, syncHtmlToMd, scheduleAutosave } = mount({
      cmRef: { current: null }, tiptapRef: tiptap.ref, mode: "html",
    });

    result.current.dispatch("bold");

    expect(tiptap.calls).toContain("toggleBold");
    expect(syncHtmlToMd).toHaveBeenCalled();
    expect(scheduleAutosave).toHaveBeenCalled();
  });

  it("refuses a mutating command in the MARKDOWN pane while read-only", () => {
    const cm = createCmRef("hello world", 0, 5); // "hello" selected
    const { result, syncMdToHtml } = mount({
      cmRef: cm.ref, tiptapRef: { current: null }, mode: "md",
    });

    useUIStore.setState({ readOnly: true });
    result.current.dispatch("bold");
    expect(cm.view.state.doc.toString()).toBe("hello world"); // document untouched
    expect(syncMdToHtml).not.toHaveBeenCalled();

    useUIStore.setState({ readOnly: false });
    result.current.dispatch("bold");
    expect(cm.view.state.doc.toString()).toBe("**hello** world"); // and it works when off
    expect(syncMdToHtml).toHaveBeenCalled();
  });

  it("blocks the destructive commands too (clear / undo)", () => {
    const tiptap = createTiptapRef();
    const { result } = mount({ cmRef: { current: null }, tiptapRef: tiptap.ref, mode: "html" });

    useUIStore.setState({ readOnly: true });
    result.current.dispatch("clearAll");
    result.current.dispatch("undo");
    result.current.dispatch("removeFormat");
    expect(tiptap.calls).toEqual([]);
  });
});

describe("read-only still allows NON-mutating selection commands", () => {
  beforeEach(() => { useUIStore.setState({ readOnly: true }); });
  afterEach(() => { useUIStore.setState({ readOnly: false }); });

  it("selectScope places a multi-range selection in the MD pane", () => {
    const cm = createCmRef("# One\n\ntext\n\n## Two\n");
    const { result } = mount({ cmRef: cm.ref, tiptapRef: { current: null }, mode: "md" });

    result.current.dispatch("selectScope", { scope: "headings" });

    const { ranges } = cm.view.state.selection;
    expect(ranges).toHaveLength(2);
    expect(cm.view.state.sliceDoc(ranges[0].from, ranges[0].to)).toBe("# One");
    expect(cm.view.state.sliceDoc(ranges[1].from, ranges[1].to)).toBe("## Two");
    expect(cm.view.state.doc.toString()).toBe("# One\n\ntext\n\n## Two\n"); // non-mutating
  });

  it("selectAll works in the MD pane", () => {
    const cm = createCmRef("alpha beta");
    const { result } = mount({ cmRef: cm.ref, tiptapRef: { current: null }, mode: "md" });

    result.current.dispatch("selectAll");

    const { from, to } = cm.view.state.selection.main;
    expect(from).toBe(0);
    expect(to).toBe("alpha beta".length);
  });

  it("selectAll works in the RICH pane", () => {
    const tiptap = createTiptapRef();
    const { result } = mount({ cmRef: { current: null }, tiptapRef: tiptap.ref, mode: "html" });

    result.current.dispatch("selectAll");

    expect(tiptap.calls).toContain("selectAll");
  });
});
