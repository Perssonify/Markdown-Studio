/**
 * A083 — the sync engine on the per-block path, end to end, and the two
 * whole-document costs that sat beside the conversion in every rich-pane
 * projection: the canonical JSON handed to onCanonicalChange, and the
 * markdown pane's own change detection.
 *
 * The pane handles here drive a REAL TipTap editor (the headless mirror of the
 * live schema), so the sync engine takes `engine.docToMd` / `docHtmlHash`
 * exactly as the app does; what reaches the markdown pane must be what the
 * whole-document conversion of `editor.getHTML()` gives.
 */
import React, { createRef } from "react";
import { act, render, renderHook } from "@testing-library/react";
import { undo } from "@codemirror/commands";
import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import { SERIALIZE_EXTENSIONS } from "../engine/serialize-doc";
import { createMarkdownEngine } from "../engine/useMarkdownEngine";
import { useSyncEngine } from "../engine/useSyncEngine";
import { DEFAULT_MARKDOWN_FEATURES } from "../store/settings";
import { CodeMirrorPane } from "../ui/CodeMirrorPane";

function rig(md) {
  const engine = createMarkdownEngine(() => DEFAULT_MARKDOWN_FEATURES);
  const ed = new Editor({ extensions: SERIALIZE_EXTENSIONS, content: engine.mdToHtml(md) });
  let mdText = "";
  const calls = { getHTML: 0 };
  const cmRef = {
    current: {
      getValue: () => mdText,
      setValue: vi.fn((v) => { mdText = v; return v; }),
      isComposing: () => false,
      resetHistory: () => {},
    },
  };
  const tiptapRef = {
    current: {
      getHTML: () => { calls.getHTML++; return ed.getHTML(); },
      setHTML: (html) => ed.commands.setContent(html, { emitUpdate: false }),
      getEditor: () => ed,
      isComposing: () => false,
      resetHistory: () => {},
    },
  };
  const onCanonicalChange = vi.fn();
  const hook = renderHook(() => useSyncEngine({ cmRef, tiptapRef, engine, syncMode: "clean", onCanonicalChange }));
  return { engine, ed, cmRef, calls, onCanonicalChange, sync: hook.result, md: () => mdText };
}

const LOREM = "Perssonify builds custom technology for teams that move fast.";

describe("A083 — the sync engine projects the rich pane per block", () => {
  it("writes exactly the whole-document conversion, without serializing the document", () => {
    const r = rig(Array.from({ length: 200 }, (_, i) => (i % 5 ? `Para ${i} ${LOREM}` : `## Heading ${i}`)).join("\n\n"));
    try {
      act(() => r.sync.current.setCanonical(r.ed.getJSON()));
      expect(r.md()).toBe(r.engine.htmlToCleanMd(r.ed.getHTML()));
      r.calls.getHTML = 0;
      for (let k = 0; k < 5; k++) {
        r.ed.view.dispatch(r.ed.state.tr.insertText(`x${k} `, 10 + k * 997 % (r.ed.state.doc.content.size - 20)));
        let projected;
        act(() => { projected = r.sync.current.syncHtmlToMd(); });
        expect(projected).toBe(true);
        expect(r.calls.getHTML).toBe(0); // the per-block path never asks for the whole document's HTML
        expect(r.md()).toBe(r.engine.htmlToCleanMd(r.ed.getHTML()));
      }
    } finally {
      r.ed.destroy();
    }
  });

  it("keeps the content gate: an edit that restores the projected document projects nothing", () => {
    // Same semantics as quickHash(getHTML()): the doc node changed twice, but
    // its HTML is what was last projected, so the markdown pane is left alone.
    const r = rig("One two three.\n\nFour five six.");
    try {
      act(() => r.sync.current.setCanonical(r.ed.getJSON()));
      const writes = r.cmRef.current.setValue.mock.calls.length;
      const bold = r.ed.schema.marks.bold;
      r.ed.view.dispatch(r.ed.state.tr.addMark(1, 4, bold.create()));
      r.ed.view.dispatch(r.ed.state.tr.removeMark(1, 4, bold));
      let projected;
      act(() => { projected = r.sync.current.syncHtmlToMd(); });
      expect(projected).toBe(false);
      expect(r.cmRef.current.setValue.mock.calls.length).toBe(writes);
    } finally {
      r.ed.destroy();
    }
  });

  it("records the hash of what the markdown pane settled on, not of what it was given", () => {
    // The per-block converter knows the hash of the markdown it produced; the
    // pane may still settle on different text (CodeMirror normalises line
    // endings). The recorded hash must be the pane's, or the next markdown-pane
    // check sees a change that is not there and re-parses the rich pane.
    const r = rig("One.\n\nTwo.");
    try {
      act(() => r.sync.current.setCanonical(r.ed.getJSON()));
      let pane = "";
      r.cmRef.current.setValue.mockImplementation((v) => (pane = v.replace(/Two/g, "Tw0")));
      r.cmRef.current.getValue = () => pane;
      r.ed.view.dispatch(r.ed.state.tr.insertText("!", 3));
      act(() => { r.sync.current.syncHtmlToMd(); });
      expect(pane).toContain("Tw0");
      const setHTML = vi.spyOn(r.ed.commands, "setContent");
      let projected;
      act(() => { projected = r.sync.current.syncMdToHtml(); });
      expect(projected).toBe(false); // the pane holds exactly what was recorded
      expect(setHTML).not.toHaveBeenCalled();
    } finally {
      r.ed.destroy();
    }
  });

  it("hands onCanonicalChange the document's JSON, reusing unchanged blocks'", () => {
    const r = rig(Array.from({ length: 20 }, (_, i) => `- item ${i}\n\nPara ${i} with **bold** and [a link](https://example.com/${i})`).join("\n\n"));
    try {
      act(() => r.sync.current.setCanonical(r.ed.getJSON()));
      r.ed.view.dispatch(r.ed.state.tr.insertText("first ", 3));
      act(() => { r.sync.current.syncHtmlToMd(); });
      const first = r.onCanonicalChange.mock.calls.at(-1)[0];
      expect(first).toEqual(r.ed.getJSON());
      expect(JSON.stringify(first)).toBe(JSON.stringify(r.ed.getJSON())); // same keys, same order
      r.ed.view.dispatch(r.ed.state.tr.insertText("second ", 3));
      act(() => { r.sync.current.syncHtmlToMd(); });
      const second = r.onCanonicalChange.mock.calls.at(-1)[0];
      expect(second).toEqual(r.ed.getJSON());
      // The edited block is rebuilt; the last block is the same object as before.
      expect(second.content[0]).not.toBe(first.content[0]);
      expect(second.content.at(-1)).toBe(first.content.at(-1));
    } finally {
      r.ed.destroy();
    }
  });
});

describe("A083 — the markdown pane knows what it was last set to", () => {
  it("diffs against its real content once the user has typed in it", () => {
    // setValue remembers the text it left, for as long as the pane's document
    // is the one it produced. An edit in the pane makes a new document, and
    // the next setValue must diff against THAT — against the remembered text
    // it would apply the change at the wrong place.
    const ref = createRef();
    render(React.createElement(CodeMirrorPane, { ref, defaultValue: "", isDark: false, onChange: () => {} }));
    expect(ref.current.setValue("abc")).toBe("abc");
    const view = ref.current.getView();
    view.dispatch({ changes: { from: 3, insert: "d" } }); // the user types
    expect(ref.current.getValue()).toBe("abcd");
    expect(ref.current.setValue("abcde")).toBe("abcde");
    expect(ref.current.getValue()).toBe("abcde");
  });

  it("resetHistory keeps the document and still drops the history", () => {
    // It rebuilds the state around the same (immutable) document rather than
    // a copy of its text; undo must still find nothing to undo.
    const ref = createRef();
    render(React.createElement(CodeMirrorPane, { ref, defaultValue: "start", isDark: false, onChange: () => {} }));
    const view = ref.current.getView();
    view.dispatch({ changes: { from: 5, insert: " typed" } });
    const doc = view.state.doc;
    act(() => ref.current.resetHistory());
    expect(view.state.doc).toBe(doc);
    expect(undo(view)).toBe(false);
    expect(ref.current.getValue()).toBe("start typed");
  });
});

describe("A083 — the markdown pane finds a change in a large document by blocks", () => {
  it("dispatches exactly the minimal change wherever it is", () => {
    const ref = createRef();
    const base = Array.from({ length: 3000 }, (_, i) => `line ${i} ${LOREM}`).join("\n"); // ~200 KB
    render(React.createElement(CodeMirrorPane, { ref, defaultValue: base, isDark: false, onChange: () => {} }));
    const view = ref.current.getView();
    const specs = [];
    const dispatch = view.dispatch.bind(view);
    view.dispatch = (spec) => { specs.push(spec); dispatch(spec); };
    let current = base;
    // Near the start, on and around 4096-character block edges, in the middle,
    // near the end; insertions, deletions and replacements.
    for (const at of [0, 5, 4095, 4096, 4097, 8192, 100003, current.length - 4097, current.length - 1, current.length]) {
      for (const [del, ins] of [[0, "INS"], [3, ""], [2, "R"]]) {
        const from = Math.min(at, current.length - del);
        const next = current.slice(0, from) + ins + current.slice(from + del);
        specs.length = 0;
        expect(ref.current.setValue(next)).toBe(next);
        expect(ref.current.getValue()).toBe(next);
        // The change CodeMirror was given is the smallest one: the common
        // prefix and suffix, as a character-by-character scan finds them.
        let p = 0;
        while (p < Math.min(current.length, next.length) && current[p] === next[p]) p++;
        let s = 0;
        while (s < Math.min(current.length, next.length) - p && current[current.length - 1 - s] === next[next.length - 1 - s]) s++;
        const changes = specs[0].changes;
        expect(changes.from).toBe(p);
        expect(changes.to).toBe(current.length - s);
        expect(changes.insert).toBe(next.slice(p, next.length - s));
        current = next;
      }
    }
  });
});
