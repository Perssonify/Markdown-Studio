/**
 * A019 — read-only must keep protecting the markdown pane after a document
 * switch, and turning it off must actually unlock it.
 *
 * `resetHistory()` (run on every cross-document hydration) and
 * `restoreEditorState()` rebuild the CodeMirror state with `view.setState`, and
 * the extensions they rebuild from carry the editability compartment's value
 * captured at MOUNT. Reproduced by the audit in a real browser: enable
 * read-only, open another document, and the markdown pane was editable — edits
 * autosaved while the footer said "Read-only". The reverse also held: boot
 * read-only, turn it off, switch, and the pane stayed locked.
 *
 * Also pinned here: `view.setState` never runs update listeners, so the
 * `suppressNextUpdate` flag those two paths armed before it leaked into the
 * user's NEXT transaction — the first edit after a document switch (a whole
 * paste, say) reported no change, was never synced and never marked dirty.
 */
import React, { createRef } from "react";
import { act, render } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeMirrorPane } from "../ui/CodeMirrorPane";
import { useUIStore } from "../store/preferences/uiStore";

const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop()();
  useUIStore.setState({ readOnly: false, spellcheck: true });
});

function mount({ readOnly = false } = {}) {
  useUIStore.setState({ readOnly });
  const ref = createRef();
  const onChange = vi.fn();
  const r = render(React.createElement(CodeMirrorPane, { ref, defaultValue: "# Doc", isDark: false, onChange }));
  mounted.push(() => r.unmount());
  return { ref, onChange, view: () => ref.current.getView() };
}

const isLocked = (view) =>
  view.state.facet(EditorState.readOnly) === true && view.state.facet(EditorView.editable) === false;

/** A change the way typing produces one: a transaction on the view. */
const typeInto = (view, text) =>
  act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: text } }); });

describe("A019: the read-only lock survives a document switch", () => {
  it("stays locked after resetHistory when read-only was turned on after mount", () => {
    const p = mount({ readOnly: false });
    act(() => { useUIStore.setState({ readOnly: true }); });
    expect(isLocked(p.view())).toBe(true);

    act(() => { p.ref.current.resetHistory(); });   // what every doc switch runs
    expect(isLocked(p.view())).toBe(true);
  });

  it("unlocks after resetHistory when read-only was turned off after a read-only boot", () => {
    const p = mount({ readOnly: true });
    act(() => { useUIStore.setState({ readOnly: false }); });
    act(() => { p.ref.current.resetHistory(); });
    expect(isLocked(p.view())).toBe(false);
  });

  it("a restored history state takes the CURRENT read-only flag, not the captured one", () => {
    const p = mount({ readOnly: false });
    const captured = p.ref.current.getEditorState();       // captured while editable
    act(() => { useUIStore.setState({ readOnly: true }); });
    act(() => { p.ref.current.restoreEditorState(captured); });
    expect(isLocked(p.view())).toBe(true);
  });

  it("keeps the live spellcheck preference too", () => {
    const p = mount();
    act(() => { useUIStore.setState({ spellcheck: false }); });
    act(() => { p.ref.current.resetHistory(); });
    expect(p.view().contentDOM.getAttribute("spellcheck")).toBe("false");
  });

  it("a change that reaches the pane while read-only is never reported", () => {
    const p = mount({ readOnly: true });
    typeInto(p.view(), " leaked");               // programmatic — bypasses the DOM lock
    expect(p.onChange).not.toHaveBeenCalled();   // …so nothing syncs, dirties or saves
    act(() => { useUIStore.setState({ readOnly: false }); });
    typeInto(p.view(), " real");
    expect(p.onChange).toHaveBeenCalledTimes(1);
  });
});

describe("the first edit after a history rebuild is reported", () => {
  it("resetHistory does not swallow the next change", () => {
    const p = mount();
    act(() => { p.ref.current.resetHistory(); });
    typeInto(p.view(), "\n\npasted after switching");
    expect(p.onChange).toHaveBeenCalledTimes(1);
  });

  it("restoreEditorState does not swallow the next change", () => {
    const p = mount();
    const captured = p.ref.current.getEditorState();
    act(() => { p.ref.current.restoreEditorState(captured); });
    typeInto(p.view(), "x");
    expect(p.onChange).toHaveBeenCalledTimes(1);
  });
});
