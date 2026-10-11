import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRef } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TiptapPane } from "../ui/panes/tiptapPane";

/**
 * The rich pane's cross-pane projection must be SILENT.
 *
 * `setHTML` is the write half of the bidirectional sync: `syncMdToHtml` calls it
 * to project the markdown pane's text into the rich pane. If that write fired
 * `onChange`, the rich pane would immediately report an "edit" the user never
 * made, `syncHtmlToMd` would project it straight back, and the two panes would
 * ping-pong. The silence is bought by ONE option — `emitUpdate: false` — and it
 * has to be silent WITHOUT leaving anything armed, or the next genuine keystroke
 * gets eaten instead.
 *
 * This file used to test none of that. All thirteen of its cases built their own
 * `new Editor` and re-implemented a `suppressNextUpdate` closure inline; the pane
 * was never imported and has no such flag. Deleting `emitUpdate: false` from the
 * real component left every one of them green. These cases drive the actual
 * imperative handle instead, so the option is load-bearing.
 */

const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop()();
});

/** Mount the real pane and hand back its imperative handle. */
async function mountPane({ defaultValue = "<p>hello</p>" } = {}) {
  const ref = createRef();
  const onChange = vi.fn();
  let view;
  await act(async () => {
    view = render(
      <TiptapPane ref={ref} isDark={false} defaultValue={defaultValue} onChange={onChange} />
    );
  });
  mounted.push(() => view.unmount());
  return { handle: ref.current, onChange };
}

/** Type into the pane the way a keystroke does — a transaction on the view,
 *  not a command, so nothing about the test depends on the command layer. */
async function type(handle, text) {
  const editor = handle.getEditor();
  await act(async () => {
    editor.view.dispatch(editor.state.tr.insertText(text));
  });
}

describe("rich-pane projection (setHTML)", () => {
  it("mounts with its initial content and reports no edit", async () => {
    const { handle, onChange } = await mountPane();
    expect(handle.getHTML()).toContain("hello");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not fire onChange", async () => {
    const { handle, onChange } = await mountPane();
    await act(async () => { handle.setHTML("<p>projected</p>"); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still applies the content it was silent about", async () => {
    // Silence achieved by not writing would pass the test above and break the
    // editor, so assert the projection actually landed.
    const { handle } = await mountPane();
    await act(async () => { handle.setHTML("<p>projected</p>"); });
    expect(handle.getHTML()).toContain("projected");
    expect(handle.getHTML()).not.toContain("hello");
  });

  it("leaves nothing armed: the next real keystroke DOES fire onChange", async () => {
    // The failure mode of the `suppressNextUpdate` flag this file used to
    // describe: a silent write that never consumed its own flag swallowed the
    // user's next edit instead.
    const { handle, onChange } = await mountPane();
    await act(async () => { handle.setHTML("<p>projected</p>"); });
    expect(onChange).not.toHaveBeenCalled();

    await type(handle, "x");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("stays silent across a burst of projections, then reports one edit", async () => {
    const { handle, onChange } = await mountPane();
    for (const n of [1, 2, 3, 4, 5]) {
      await act(async () => { handle.setHTML(`<p>projection ${n}</p>`); });
    }
    expect(onChange).not.toHaveBeenCalled();

    await type(handle, "y");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("is silent when the projection is a no-op", async () => {
    const { handle, onChange } = await mountPane();
    await act(async () => { handle.setHTML(handle.getHTML()); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not throw on content the schema cannot represent", async () => {
    // errorOnInvalidContent: false — a projection carrying an unknown element
    // must degrade, not take the pane down mid-sync.
    const { handle } = await mountPane();
    await act(async () => {
      handle.setHTML("<p>kept</p><madeup-element data-x='1'>dropped</madeup-element>");
    });
    expect(handle.getHTML()).toContain("kept");
  });

  it("a user edit BEFORE any projection fires onChange", async () => {
    // Guards the inverse mistake: a pane that never reports edits would pass
    // every silence assertion above.
    const { handle, onChange } = await mountPane();
    await type(handle, "z");
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("source pin", () => {
  const pane = readFileSync(join(process.cwd(), "src/ui/panes/tiptapPane/index.tsx"), "utf8");

  it("setHTML passes emitUpdate: false", () => {
    const body = pane.slice(pane.indexOf("setHTML: (html)"));
    const call = body.slice(0, body.indexOf("},\n      focus:"));
    expect(call).toContain("setContent(");
    expect(call).toMatch(/emitUpdate:\s*false/);
    expect(call).toMatch(/errorOnInvalidContent:\s*false/);
  });

  it("does not carry the setContent(html, false) form, which v3 ignores", () => {
    // Tiptap v3 destructures the second argument; a bare `false` becomes `{}`
    // and emitUpdate defaults back to true.
    expect(pane).not.toMatch(/setContent\([^,)]+,\s*false\s*\)/);
  });
});
