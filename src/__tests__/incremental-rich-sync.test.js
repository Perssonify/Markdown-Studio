/**
 * A083 — the incremental markdown→rich projection inside the sync engine, with
 * a real editor: what it must keep from the whole-document path it replaced
 * (the echo gate, the composition guard, read-only, the history the rich pane
 * records, the gate committed only after a conversion that did not throw) and
 * what it improves (the rich pane's selection survives an edit elsewhere).
 */
import { renderHook, act } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { closeHistory, undo, undoDepth } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import { describe, expect, it, vi } from "vitest";
import { SERIALIZE_EXTENSIONS } from "../engine/serialize-doc";
import { createMarkdownEngine } from "../engine/useMarkdownEngine";
import { useSyncEngine } from "../engine/useSyncEngine";
import { DEFAULT_MARKDOWN_FEATURES } from "../store/settings";

const LOREM = "Perssonify builds custom technology for teams that move fast.";
const paras = (n) => Array.from({ length: n }, (_, i) => `P${i} ${LOREM}`).join("\n\n");

/** useSyncEngine over a real TipTap editor and a plain-text markdown pane. */
function rig({ incremental = true } = {}) {
  const base = createMarkdownEngine(() => DEFAULT_MARKDOWN_FEATURES, undefined, { richRunLength: 0 });
  // The whole-document path: the same engine without the planner.
  const engine = incremental ? base : { ...base, planRich: undefined, forgetRich: undefined };
  const ed = new Editor({ extensions: SERIALIZE_EXTENSIONS, content: "" });
  let md = "";
  let composing = false;
  const cmRef = { current: { getValue: () => md, setValue: (v) => { md = v; return v; }, isComposing: () => false, resetHistory: () => {} } };
  const tiptapRef = {
    current: {
      getEditor: () => ed,
      getHTML: () => ed.getHTML(),
      setHTML: (html) => ed.commands.setContent(html, { emitUpdate: false }),
      isComposing: () => composing,
      resetHistory: () => {},
    },
  };
  const onCanonicalChange = vi.fn();
  const hook = renderHook(() => useSyncEngine({ cmRef, tiptapRef, engine, syncMode: "styled", onCanonicalChange }));
  const sync = hook.result;
  return {
    base, engine, ed, onCanonicalChange,
    get md() { return md; },
    type(next) { md = next; },
    compose(on) { composing = on; },
    toRich() { let r; act(() => { r = sync.current.syncMdToHtml(); }); return r; },
    toMd() { let r; act(() => { r = sync.current.syncHtmlToMd(); }); return r; },
    setCanonical(json) { act(() => { sync.current.setCanonical(json); }); },
    load(text) {
      md = text;
      act(() => { sync.current.forceSyncMdToHtml(); });
    },
    destroy() { ed.destroy(); },
  };
}

describe("the incremental projection in the sync engine", () => {
  it("projects, and the rich pane does not echo it back", () => {
    const r = rig();
    try {
      r.load(paras(20));
      r.type(r.md.replace("P10 ", "P10 edited "));
      expect(r.toRich()).toBe(true);
      expect(r.engine.lastRichPath().path).toBe("incremental");
      expect(r.ed.state.doc.child(10).textContent).toContain("P10 edited");
      expect(r.toMd()).toBe(false); // the echo gate: nothing to project back
      expect(r.toRich()).toBe(false); // …nor forward again
      expect(r.onCanonicalChange).toHaveBeenCalledTimes(2); // load + edit
    } finally { r.destroy(); }
  });

  it("keeps the rich pane's selection when the edit is elsewhere (the whole path moved it)", () => {
    for (const incremental of [true, false]) {
      const r = rig({ incremental });
      try {
        r.load(paras(20));
        const at = 5; // inside the first paragraph
        r.ed.view.dispatch(r.ed.state.tr.setSelection(TextSelection.create(r.ed.state.doc, at, at + 3)));
        r.type(r.md.replace("P15 ", "P15 edited "));
        r.toRich();
        const { from, to } = r.ed.state.selection;
        if (incremental) expect([from, to]).toEqual([at, at + 3]);
        else expect([from, to]).not.toEqual([at, at + 3]); // setContent replaced everything
      } finally { r.destroy(); }
    }
  });

  it("records the projection in the rich pane's history as the whole path did, and undo restores it", () => {
    const depths = {};
    for (const incremental of [true, false]) {
      const r = rig({ incremental });
      try {
        r.load(paras(10));
        // A pause after the load, as a person would leave (history groups by time).
        r.ed.view.dispatch(closeHistory(r.ed.state.tr));
        const before = r.ed.state.doc;
        const d0 = undoDepth(r.ed.state);
        r.type(r.md.replace("P5 ", "P5 edited "));
        r.toRich();
        depths[incremental] = undoDepth(r.ed.state) - d0;
        undo(r.ed.state, r.ed.view.dispatch);
        expect(r.ed.state.doc.eq(before)).toBe(true);
      } finally { r.destroy(); }
    }
    expect(depths[true]).toBe(depths[false]);
    expect(depths[true]).toBe(1);
  });

  it("waits out a composition in the rich pane, and then projects", () => {
    const r = rig();
    try {
      r.load(paras(10));
      const doc = r.ed.state.doc;
      r.type(r.md.replace("P3 ", "P3 dictated "));
      r.compose(true);
      expect(r.toRich()).toBe(false);
      expect(r.ed.state.doc).toBe(doc); // nothing dispatched into the composing editor
      r.compose(false);
      expect(r.toRich()).toBe(true);
      expect(r.ed.state.doc.child(3).textContent).toContain("P3 dictated");
    } finally { r.destroy(); }
  });

  it("projects into a read-only rich pane as the whole path did, and leaves it read-only", () => {
    const r = rig();
    try {
      r.load(paras(10));
      r.ed.setEditable(false);
      r.type(r.md.replace("P2 ", "P2 edited "));
      expect(r.toRich()).toBe(true);
      expect(r.ed.state.doc.child(2).textContent).toContain("P2 edited");
      expect(r.ed.isEditable).toBe(false);
    } finally { r.destroy(); }
  });

  it("commits the gate only after the plan: a throw leaves the change to project next time", () => {
    const r = rig();
    try {
      r.load(paras(10));
      r.type(r.md.replace("P4 ", "P4 edited "));
      const spy = vi.spyOn(r.engine, "planRich").mockImplementationOnce(() => { throw new Error("boom"); });
      expect(() => r.toRich()).toThrow("boom");
      spy.mockRestore();
      expect(r.toRich()).toBe(true);
      expect(r.ed.state.doc.child(4).textContent).toContain("P4 edited");
    } finally { r.destroy(); }
  });

  it("forgets the model when another document is loaded", () => {
    const r = rig();
    try {
      r.load(paras(10));
      r.type(r.md.replace("P1 ", "P1 x "));
      r.toRich();
      expect(r.engine.lastRichPath().path).toBe("incremental");
      // A document load (setCanonical) replaces every node: what the model
      // knew describes nothing, and holding it only holds memory.
      r.setCanonical(r.ed.getJSON());
      r.type(r.md.replace("P2 ", "P2 x "));
      r.toRich();
      expect(r.engine.lastRichPath()).toEqual({ path: "build", reason: "no model" });
    } finally { r.destroy(); }
  });
});
