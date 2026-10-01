import { readFileSync } from "fs";
import { join } from "path";
import { act, fireEvent, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkipToEditor, findEditorFocusTarget } from "../ui/SkipToEditor";
import { Walkthrough } from "../ui/Walkthrough";

/**
 * A094. Keyboard navigation was long and out of order: the library came last
 * (after ~40 toolbar buttons and both editors) because it rendered after <main>
 * and was only MOVED left with CSS; there was no skip link; and the tour
 * swallowed Enter on its own Skip / Back / Close buttons.
 */

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("DOM order matches visual order", () => {
  it("renders the workspace panel BEFORE <main>", () => {
    const pe = codeOnly(read("src/PerssonifyEditor.tsx"));
    const panel = pe.indexOf("<WorkspacePanel\n");
    const main = pe.indexOf("<main ");
    expect(panel).toBeGreaterThan(-1);
    expect(main).toBeGreaterThan(-1);
    expect(panel).toBeLessThan(main);
    // …and nothing re-orders it visually any more, so the two cannot disagree.
    expect(pe).not.toContain("md:order-first");
    expect(codeOnly(read("src/ui/WorkspacePanel.tsx"))).not.toContain("order-first");
  });

  it("puts the skip link first in the app shell", () => {
    const app = codeOnly(read("src/App.tsx"));
    expect(app.indexOf("<SkipToEditor />")).toBeGreaterThan(-1);
    expect(app.indexOf("<SkipToEditor />")).toBeLessThan(app.indexOf("<EditorHeader />"));
  });
});

describe("Skip to editor", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  function fixture({ mdHidden = false, richHidden = false, noDoc = false } = {}) {
    document.body.innerHTML = noDoc
      ? `<main><button id="create">Create New Document</button></main>`
      : `<main><div data-tour="editor">
          <div class="${mdHidden ? "hidden" : ""}"><div class="cm-content" contenteditable="true" tabindex="0"></div></div>
          <div class="${richHidden ? "hidden" : ""}"><div class="ProseMirror" contenteditable="true" tabindex="0"></div></div>
        </div></main>`;
  }

  it("targets the first VISIBLE pane", () => {
    fixture();
    expect(findEditorFocusTarget().className).toBe("cm-content"); // split: markdown first
    fixture({ mdHidden: true });
    expect(findEditorFocusTarget().className).toBe("ProseMirror"); // rich-only view
    fixture({ richHidden: true });
    expect(findEditorFocusTarget().className).toBe("cm-content");
  });

  it("falls back to the first control in <main> when no document is open", () => {
    fixture({ noDoc: true });
    expect(findEditorFocusTarget().id).toBe("create");
  });

  it("moves focus into the editor, without leaving a #hash behind", () => {
    fixture({ mdHidden: true });
    const host = document.createElement("div");
    document.body.prepend(host);
    const { getByText } = render(<SkipToEditor />, { container: host });
    const link = getByText("Skip to editor");
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => { link.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement.className).toBe("ProseMirror");
  });
});

describe("the tour leaves Enter to the button that has focus", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  function mountTour() {
    // Two real targets, so "next" is observable as a change of step.
    const a = document.createElement("div");
    a.setAttribute("data-tour", "menus");
    const b = document.createElement("div");
    b.setAttribute("data-tour", "mode-switcher");
    document.body.append(a, b);
    const onFinish = vi.fn();
    const utils = render(<Walkthrough run onFinish={onFinish} />);
    return { ...utils, onFinish };
  }
  const title = () => document.getElementById("pf-tour-title")?.textContent;
  const enterOn = (el) => {
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    act(() => { el.dispatchEvent(ev); });
    return ev;
  };

  it("does not advance when Enter is pressed on Skip", () => {
    const { getByText } = mountTour();
    const before = title();
    const skip = getByText("Skip");
    act(() => skip.focus());
    const ev = enterOn(skip);
    // Left alone, so the browser activates Skip (a click) as the user asked…
    expect(ev.defaultPrevented).toBe(false);
    // …instead of the tour silently moving on.
    expect(title()).toBe(before);
  });

  it("does not hijack Enter on the close button either", () => {
    const { getByLabelText } = mountTour();
    const before = title();
    const close = getByLabelText("Close tour");
    act(() => close.focus());
    expect(enterOn(close).defaultPrevented).toBe(false);
    expect(title()).toBe(before);
  });

  it("still advances on Enter when the card itself has focus", () => {
    mountTour();
    const before = title();
    const card = document.getElementById("pf-tour-title").closest("[tabindex='-1']");
    act(() => card.focus());
    expect(enterOn(card).defaultPrevented).toBe(true);
    expect(title()).not.toBe(before);
  });

  it("still advances on ArrowRight from anywhere", () => {
    const { getByText } = mountTour();
    const before = title();
    const skip = getByText("Skip");
    act(() => skip.focus());
    fireEvent.keyDown(skip, { key: "ArrowRight" });
    expect(title()).not.toBe(before);
  });
});
