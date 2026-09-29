import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CodeMirrorPane } from "../ui/CodeMirrorPane";
import { TiptapPane } from "../ui/TiptapPane";

/**
 * A089. Both editors were unnamed. CodeMirror gives its content element
 * role="textbox" but no name (axe `aria-input-field-name`, serious, on every
 * surface), and the rich pane's contenteditable had no role, name or
 * aria-multiline — so a screen-reader user landing in either pane heard
 * "edit text" with nothing to say which of the two they were in.
 */

const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop()();
});

describe("the markdown pane is named", () => {
  it("labels CodeMirror's content element and documents the Tab capture", () => {
    const ref = createRef();
    const view = render(<CodeMirrorPane ref={ref} defaultValue="# One" isDark={false} onChange={() => {}} />);
    mounted.push(() => view.unmount());
    const content = view.container.querySelector(".cm-content");
    expect(content).not.toBeNull();
    expect(content.getAttribute("role")).toBe("textbox");
    expect(content.getAttribute("aria-label")).toBe("Markdown source");
    // indentWithTab keeps Tab inside the editor; the way out has to be
    // discoverable from the element that traps it.
    expect(content.getAttribute("aria-description")).toMatch(/Escape, then Tab/);
    // The spellcheck compartment shares the same facet and must still apply.
    expect(content.getAttribute("spellcheck")).not.toBeNull();
  });
});

describe("the rich pane is a named, multi-line textbox", () => {
  async function mountRich(isDark) {
    const ref = createRef();
    let view;
    await act(async () => {
      view = render(<TiptapPane ref={ref} isDark={isDark} defaultValue="<p>hello</p>" />);
    });
    mounted.push(() => view.unmount());
    return view;
  }

  it("exposes role, name and aria-multiline on the editable", async () => {
    const view = await mountRich(false);
    const pm = view.container.querySelector(".ProseMirror");
    expect(pm.getAttribute("role")).toBe("textbox");
    expect(pm.getAttribute("aria-multiline")).toBe("true");
    expect(pm.getAttribute("aria-label")).toBe("Rich text");
  });

  it("keeps them when the theme effect replaces the attribute object", async () => {
    // The theme/spellcheck effect calls setOptions with a NEW attributes
    // object, which replaces the one passed to useEditor wholesale. A label
    // added only at init would vanish on the first theme toggle.
    const ref = createRef();
    let view;
    await act(async () => {
      view = render(<TiptapPane ref={ref} isDark={false} defaultValue="<p>hello</p>" />);
    });
    mounted.push(() => view.unmount());
    await act(async () => {
      view.rerender(<TiptapPane ref={ref} isDark defaultValue="<p>hello</p>" />);
    });
    const pm = view.container.querySelector(".ProseMirror");
    expect(pm.getAttribute("data-theme")).toBe("dark"); // the effect really ran
    expect(pm.getAttribute("role")).toBe("textbox");
    expect(pm.getAttribute("aria-label")).toBe("Rich text");
    expect(pm.getAttribute("aria-multiline")).toBe("true");
  });

  it("gives the two panes different names", async () => {
    const cmRef = createRef();
    const cm = render(<CodeMirrorPane ref={cmRef} defaultValue="x" isDark={false} onChange={() => {}} />);
    mounted.push(() => cm.unmount());
    const rich = await mountRich(false);
    const a = cm.container.querySelector(".cm-content").getAttribute("aria-label");
    const b = rich.container.querySelector(".ProseMirror").getAttribute("aria-label");
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });
});
