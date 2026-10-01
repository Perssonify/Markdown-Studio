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
function rig({ incremental = true, engineOptions = {} } = {}) {
  const base = createMarkdownEngine(() => DEFAULT_MARKDOWN_FEATURES, undefined, { richRunLength: 0, ...engineOptions });
  // The whole-document path: the same engine without the planner.
  const engine = incremental ? base : { ...base, planRich: undefined, forgetRich: undefined, prepareRich: undefined };
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
    setFromHtml(html) { act(() => { sync.current.setFromHtml(html); }); },
    unmount() { hook.unmount(); },
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

/**
 * requestIdleCallback, run by hand: each queued callback gets a deadline that
 * never runs out, so one flush finishes what is scheduled.
 */
function idleQueue() {
  const queue = new Map();
  const cancelled = [];
  let next = 1;
  window.requestIdleCallback = (cb) => { const id = next++; queue.set(id, cb); return id; };
  window.cancelIdleCallback = (id) => { cancelled.push(id); queue.delete(id); };
  return {
    queue,
    cancelled,
    flush() {
      let n = 0;
      while (queue.size) {
        const [id, cb] = queue.entries().next().value;
        queue.delete(id);
        cb({ timeRemaining: () => 50, didTimeout: false });
        n++;
      }
      return n;
    },
    restore() {
      delete window.requestIdleCallback;
      delete window.cancelIdleCallback;
    },
  };
}

describe("the model is prepared in idle time after a load", () => {
  // Every document is prepared here (the app waits for 64 KB), in slices.
  const prepared = { engineOptions: { richPrebuildMin: 0, richPrebuildChunk: 256 } };

  it("prepares after setCanonical, and the first markdown keystroke uses it", () => {
    const q = idleQueue();
    const r = rig(prepared);
    try {
      r.load(paras(100));
      r.setCanonical(r.ed.getJSON());
      expect(q.queue.size).toBe(1);
      expect(q.flush()).toBe(1);
      r.type(r.md.replace("P50 ", "P50 edited "));
      expect(r.toRich()).toBe(true);
      expect(r.engine.lastRichPath().path).toBe("prebuilt");
      expect(r.engine.lastRichPath().reason).toMatch(/^ready; 1 of \d+ runs$/);
      expect(r.ed.state.doc.child(50).textContent).toContain("P50 edited");
    } finally { r.destroy(); q.restore(); }
  });

  it("prepares after setFromHtml too", () => {
    const q = idleQueue();
    const r = rig(prepared);
    try {
      r.setFromHtml(r.engine.mdToHtml(paras(100)));
      expect(q.flush()).toBe(1);
      r.type(r.md.replace("P50 ", "P50 edited "));
      r.toRich();
      expect(r.engine.lastRichPath().reason).toMatch(/^ready; /);
    } finally { r.destroy(); q.restore(); }
  });

  it("a keystroke before idle time finishes the preparation itself", () => {
    const q = idleQueue();
    const r = rig(prepared);
    try {
      r.load(paras(100));
      r.setCanonical(r.ed.getJSON());
      r.type(r.md.replace("P99 ", "P99 edited "));
      r.toRich();
      expect(r.engine.lastRichPath().reason).toMatch(/^finished on demand; /);
      // The slice still queued finds nothing to do, and queues no other.
      expect(q.flush()).toBe(1);
      expect(q.queue.size).toBe(0);
    } finally { r.destroy(); q.restore(); }
  });

  it("the next load cancels the slices, and so does unmounting", () => {
    const q = idleQueue();
    const r = rig(prepared);
    try {
      r.load(paras(100));
      r.setCanonical(r.ed.getJSON());
      const [first] = q.queue.keys();
      r.setCanonical(r.ed.getJSON());
      expect(q.cancelled).toEqual([first]);
      const [second] = q.queue.keys();
      r.unmount();
      expect(q.cancelled).toEqual([first, second]);
      expect(q.queue.size).toBe(0);
    } finally { r.destroy(); q.restore(); }
  });

  it("schedules nothing for a small document, or without a planner", () => {
    const q = idleQueue();
    try {
      const small = rig(); // the app's 64 KB threshold
      try {
        small.load(paras(100));
        small.setCanonical(small.ed.getJSON());
        expect(q.queue.size).toBe(0);
      } finally { small.destroy(); }
      const whole = rig({ ...prepared, incremental: false });
      try {
        whole.load(paras(100));
        whole.setCanonical(whole.ed.getJSON());
        expect(q.queue.size).toBe(0);
      } finally { whole.destroy(); }
    } finally { q.restore(); }
  });
});
