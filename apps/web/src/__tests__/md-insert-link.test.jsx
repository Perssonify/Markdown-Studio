/**
 * ⌘K in the markdown pane links to the URL the user typed.
 *
 * Every caller (⌘K, Insert ▸ Link…, the toolbar) prompts for a URL and passes
 * it to `dispatch("createLink", url)`, but the markdown side dropped it and
 * always wrote a literal `(url)` placeholder — the prompt was decoration.
 */
import { act, render, renderHook } from "@testing-library/react";
import { marked } from "marked";
import { createElement, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mdLinkDestination } from "../formatting/md-format-utils";
import { useFormatDispatcher } from "../formatting/useFormatDispatcher";
import { useUIStore } from "../store/preferences/uiStore";
import { CodeMirrorPane } from "../ui/panes/codeMirrorPane";

let unmount;
beforeEach(() => useUIStore.setState({ readOnly: false }));
afterEach(() => { unmount?.(); unmount = undefined; });

async function mdPane(doc, select) {
  const ref = createRef();
  await act(async () => { ({ unmount } = render(createElement(CodeMirrorPane, { ref, isDark: false, defaultValue: doc }))); });
  const view = ref.current.getView();
  view.dispatch({ selection: { anchor: select[0], head: select[1] } });
  const { result } = renderHook(() =>
    useFormatDispatcher({ cmRef: ref, tiptapRef: { current: null }, mode: "md", syncMdToHtml: vi.fn(), scheduleAutosave: vi.fn() })
  );
  return { view, dispatch: result.current.dispatch };
}

describe("markdown-pane Link", () => {
  it("wraps the selection in a link to the URL that was entered", async () => {
    const { view, dispatch } = await mdPane("see docs here", [4, 8]);
    dispatch("createLink", "https://example.com/guide");
    expect(view.state.doc.toString()).toBe("see [docs](https://example.com/guide) here");
  });

  it("inserts a complete link at a bare caret", async () => {
    const { view, dispatch } = await mdPane("x ", [2, 2]);
    dispatch("createLink", "https://example.com");
    expect(view.state.doc.toString()).toBe("x [link text](https://example.com)");
  });

  it("keeps a URL with spaces or parentheses in one piece", async () => {
    expect(mdLinkDestination("https://en.wikipedia.org/wiki/Foo_(bar)")).toBe("<https://en.wikipedia.org/wiki/Foo_(bar)>");
    const html = marked.parse(`[w](${mdLinkDestination("https://x.test/a b (c)")})`);
    expect(html).toContain('href="https://x.test/a%20b%20(c)"');
    expect(mdLinkDestination(" https://plain.test ")).toBe("https://plain.test");
  });
});
