/**
 * Inserted images carry alt text (A096), and the markdown pane inserts the
 * image that was asked for.
 *
 * Every insert path asked for a URL only, so each image reached screen-reader
 * users as "image" with nothing about what it showed. And like the Link
 * command, the markdown side ignored even that URL and wrote a placeholder.
 */
import { act, render, renderHook } from "@testing-library/react";
import { marked } from "marked";
import { createElement, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mdImage, promptImage, toImageInsert } from "../formatting/image-insert";
import { useFormatDispatcher } from "../formatting/useFormatDispatcher";
import { useUIStore } from "../store/preferences/uiStore";
import { CodeMirrorPane } from "../ui/CodeMirrorPane";
import { TiptapPane } from "../ui/TiptapPane";

const answers = (...values) => {
  const queue = [...values];
  return vi.fn(async () => queue.shift() ?? null);
};

describe("promptImage", () => {
  it("asks for the URL, then for a description", async () => {
    const prompt = answers(" https://x.test/chart.png ", "Sign-ups by month");
    expect(await promptImage(prompt)).toEqual({ src: "https://x.test/chart.png", alt: "Sign-ups by month" });
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompt.mock.calls[1][0]).toMatch(/describe the image/i);
  });

  it("an empty description is a decorative image; cancelling either step inserts nothing", async () => {
    expect(await promptImage(answers("https://x.test/a.png", ""))).toEqual({ src: "https://x.test/a.png", alt: "" });
    expect(await promptImage(answers("https://x.test/a.png", null))).toBeNull();
    expect(await promptImage(answers(null))).toBeNull();
  });
});

describe("the insert value", () => {
  it("accepts { src, alt } and a bare URL (the host API)", () => {
    expect(toImageInsert({ src: "u", alt: "a" })).toEqual({ src: "u", alt: "a" });
    expect(toImageInsert("https://x.test/p.png")).toEqual({ src: "https://x.test/p.png", alt: "" });
    expect(toImageInsert("  ")).toBeNull();
    expect(toImageInsert(null)).toBeNull();
  });

  it("writes markdown that renders to the same image", () => {
    const md = mdImage({ src: "https://x.test/a (1).png", alt: "the [draft] chart" });
    const html = marked.parse(md);
    expect(html).toContain('alt="the [draft] chart"');
    expect(html).toContain('src="https://x.test/a%20(1).png"');
  });
});

describe("both panes insert the image with its alt text", () => {
  let unmount;
  beforeEach(() => useUIStore.setState({ readOnly: false }));
  afterEach(() => { unmount?.(); unmount = undefined; });

  const dispatcherFor = (cmRef, tiptapRef, mode) =>
    renderHook(() =>
      useFormatDispatcher({ cmRef, tiptapRef, mode, syncMdToHtml: vi.fn(), scheduleAutosave: vi.fn() })
    ).result.current.dispatch;

  it("markdown pane", async () => {
    const ref = createRef();
    await act(async () => { ({ unmount } = render(createElement(CodeMirrorPane, { ref, isDark: false, defaultValue: "" }))); });
    dispatcherFor(ref, { current: null }, "md")("insertImage", { src: "https://x.test/p.png", alt: "A plot" });
    expect(ref.current.getView().state.doc.toString()).toBe("![A plot](https://x.test/p.png)");
  });

  it("rich pane", async () => {
    const ref = createRef();
    await act(async () => { ({ unmount } = render(createElement(TiptapPane, { ref, isDark: false, defaultValue: "<p>x</p>" }))); });
    ref.current.getEditor().commands.focus("end");
    dispatcherFor({ current: null }, ref, "html")("insertImage", { src: "https://x.test/p.png", alt: "A plot" });
    const img = ref.current.getEditor().view.dom.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("A plot");
  });
});
