import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Editor } from "@tiptap/core";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { SERIALIZE_EXTENSIONS } from "../engine/serialize-doc";
import { ReactSelectionShield, SHIELD_FROM_SIZE, shieldFromReact } from "../extensions/ReactSelectionShield";

/**
 * A083 — React walked a large rich pane on every commit. Before each commit it
 * saves the focused element's caret; for a contenteditable it finds the
 * caret's offsets by walking every DOM node before it, and an element with a
 * `selectionStart` property is read directly instead. The rich pane gets one
 * while its document is large.
 */

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let ed;
afterEach(() => { ed?.destroy(); ed = null; });

const big = (n) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(n) }] }] });

describe("the rich pane is shielded while its document is large", () => {
  it("adds the properties above the size, and takes them away below it and on destroy", () => {
    ed = new Editor({ element: document.createElement("div"), extensions: [...SERIALIZE_EXTENSIONS, ReactSelectionShield], content: "<p>small</p>" });
    const dom = ed.view.dom;
    expect("selectionStart" in dom).toBe(false);
    ed.commands.setContent(big(SHIELD_FROM_SIZE));
    expect("selectionStart" in dom).toBe(true);
    expect(dom.selectionStart).toBe(0);
    expect(dom.selectionEnd).toBe(0);
    // React writes them back (in strict mode code): ignored, never a throw.
    expect(() => { "use strict"; dom.selectionStart = 5; dom.selectionEnd = 9; }).not.toThrow();
    expect(dom.selectionStart).toBe(0);
    ed.commands.setContent("<p>small again</p>");
    expect("selectionStart" in dom).toBe(false);
    ed.commands.setContent(big(SHIELD_FROM_SIZE + 10));
    expect("selectionStart" in dom).toBe(true);
    ed.destroy();
    expect("selectionStart" in dom).toBe(false);
    ed = null;
  });
});

it("is registered in the live editor", () => {
  const pane = readFileSync(join(process.cwd(), "src/ui/panes/tiptapPane/index.tsx"), "utf8");
  expect(pane).toMatch(/\n\s+ReactSelectionShield,/);
});

describe("React reads a shielded element's caret instead of walking it", () => {
  /** How many times React's commit reads a DOM node's next sibling. */
  function siblingReadsDuringCommit(shielded) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    // An editable element with many nodes, focused, the caret at its end.
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.setAttribute("tabindex", "0");
    // (jsdom has no `contentEditable` property; a browser's reads "true".)
    if (editable.contentEditable !== "true") Object.defineProperty(editable, "contentEditable", { value: "true" });
    for (let i = 0; i < 2000; i++) {
      const p = document.createElement("p");
      p.textContent = `line ${i}`;
      editable.appendChild(p);
    }
    document.body.appendChild(editable);
    editable.focus();
    const last = editable.lastChild.firstChild;
    const range = document.createRange();
    range.setStart(last, last.length);
    range.collapse(true);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    expect(document.activeElement).toBe(editable);
    if (shielded) shieldFromReact(editable, true);

    let bump;
    function App() {
      const [n, setN] = useState(0);
      bump = () => setN((v) => v + 1);
      return <span>{n}</span>;
    }
    const root = createRoot(host);
    act(() => root.render(<App />));

    const desc = Object.getOwnPropertyDescriptor(Node.prototype, "nextSibling");
    let reads = 0;
    Object.defineProperty(Node.prototype, "nextSibling", { configurable: true, get() { reads++; return desc.get.call(this); } });
    try {
      act(() => bump());
    } finally {
      Object.defineProperty(Node.prototype, "nextSibling", desc);
      act(() => root.unmount());
      host.remove();
      editable.remove();
    }
    return reads;
  }

  it("walks every node before the caret without the shield, and none with it", () => {
    const walked = siblingReadsDuringCommit(false);
    const shielded = siblingReadsDuringCommit(true);
    expect(walked).toBeGreaterThan(2000); // the whole editor, on one small commit
    expect(shielded).toBeLessThan(50);
  });
});
