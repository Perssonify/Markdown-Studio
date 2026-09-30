/**
 * A099 — right-to-left text renders right-to-left, without touching the
 * document model.
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Editor } from "@tiptap/core";
import { Placeholder } from "@tiptap/extension-placeholder";
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { sanitizePastedHtml } from "../engine/html-cleaner";
import { SERIALIZE_EXTENSIONS } from "../engine/serialize-doc";
import { BidiAuto } from "../extensions/BidiAuto";
import { perLineTextDirection } from "../extensions/cm-bidi";

let editor;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

const mount = (content) => {
  editor = new Editor({ element: document.createElement("div"), extensions: [...SERIALIZE_EXTENSIONS, BidiAuto], content });
  return editor;
};
const autoDirTags = (ed) => Array.from(ed.view.dom.querySelectorAll('[dir="auto"]')).map((n) => n.tagName);

describe("rich pane: dir=auto on text blocks", () => {
  it("marks paragraphs, headings, list items and cells — not code", () => {
    const ed = mount(
      "<h2>عنوان</h2><p>مرحبا بالعالم</p><ul><li><p>عنصر</p></li></ul>" +
        "<table><tbody><tr><th><p>h</p></th></tr></tbody></table><pre><code>let a = 1</code></pre>"
    );
    const tags = autoDirTags(ed);
    expect(tags).toEqual(expect.arrayContaining(["H2", "P", "LI", "TH"]));
    expect(tags).not.toContain("PRE");
    expect(tags).not.toContain("CODE");
  });

  it("is view-only: the document and its HTML carry no dir", () => {
    const ed = mount("<p>مرحبا</p>");
    expect(ed.getHTML()).not.toContain("dir=");
    expect(JSON.stringify(ed.getJSON())).not.toContain("dir");
  });

  it("keeps up with edits — new, split and replaced blocks", () => {
    const ed = mount("<p>one</p><p>two</p><p>three</p>");
    expect(autoDirTags(ed)).toHaveLength(3);
    ed.commands.setTextSelection(4); // end of "one"
    ed.commands.splitBlock();
    ed.commands.insertContent("שלום");
    expect(autoDirTags(ed)).toHaveLength(4);
    ed.commands.setContent("<p>a</p><blockquote><p>b</p></blockquote>");
    // Every rendered block is covered (StarterKit also appends an empty
    // trailing paragraph after a final blockquote)…
    const blocks = ed.view.dom.querySelectorAll("p, blockquote");
    for (const b of blocks) expect(b.getAttribute("dir")).toBe("auto");
    // …and nothing else is.
    expect(autoDirTags(ed)).toHaveLength(blocks.length);
  });

  it("does not accumulate decorations as you type (one per task item, always)", () => {
    // Task items are the one block still marked by a decoration (TipTap draws
    // them with its own node view). An ancestor that straddles the edited
    // range must be re-derived, not re-added: duplicates render identically,
    // so only the plugin's own state shows them — growing by one per keystroke.
    const ed = mount(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>item</p>' +
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>sub</p></li></ul></li></ul>'
    );
    const plugin = ed.state.plugins.find((p) => p.key.startsWith("bidiAuto"));
    const taskItems = () => {
      let n = 0;
      ed.state.doc.descendants((node) => { if (node.type.name === "taskItem") n++; });
      return n;
    };
    expect(taskItems()).toBe(2);
    for (const ch of "typing more text") {
      ed.commands.setTextSelection(4); // inside "item"
      ed.commands.insertContent(ch);
    }
    expect(plugin.getState(ed.state).find().length).toBe(taskItems());
    expect(autoDirTags(ed).filter((t) => t === "LI")).toHaveLength(2);
  });

  it("marks ordinary blocks through their node views — no decoration per block", () => {
    // A decoration on every block made each transaction quadratic in the
    // number of blocks (A083): 714 ms per keystroke in a 1.6 MB document.
    const ed = mount("<h2>h</h2><p>a</p><p>b</p><ul><li><p>c</p></li></ul><blockquote><p>d</p></blockquote>");
    const plugin = ed.state.plugins.find((p) => p.key.startsWith("bidiAuto"));
    expect(plugin.getState(ed.state).find()).toHaveLength(0);
    ed.commands.setTextSelection(2);
    ed.commands.insertContent("typed");
    expect(plugin.getState(ed.state).find()).toHaveLength(0);
    // Every block is marked (StarterKit may append an empty paragraph after
    // the final blockquote; it is marked too), and nothing else.
    const blocks = ed.view.dom.querySelectorAll("h2, p, li, blockquote");
    for (const b of blocks) expect(b.getAttribute("dir")).toBe("auto");
    expect(autoDirTags(ed)).toHaveLength(blocks.length);
  });

  it("still carries other plugins' node decorations (the empty-editor placeholder)", () => {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [...SERIALIZE_EXTENSIONS, BidiAuto, Placeholder.configure({ placeholder: "Start typing" })],
      content: "",
    });
    const p = editor.view.dom.querySelector("p");
    expect(p.getAttribute("dir")).toBe("auto");
    expect(p.getAttribute("data-placeholder")).toBe("Start typing");
    expect(p.classList.contains("is-empty")).toBe(true);
  });

  it("renders each block as its own toDOM would, attributes and all", () => {
    // The node view is the node's own rendering plus the attribute: a
    // paragraph's alignment, a cell's alignment, a callout's type survive, and
    // a change to them redraws the block.
    const ed = mount(
      '<p style="text-align: center">mid</p><div data-type="callout" data-callout="tip"><p>t</p></div>' +
        '<table><tbody><tr><td style="text-align: right"><p>r</p></td></tr></tbody></table>'
    );
    const p = ed.view.dom.querySelector("p");
    expect(p.getAttribute("style")).toContain("text-align: center");
    expect(p.getAttribute("dir")).toBe("auto");
    const callout = ed.view.dom.querySelector('div[data-type="callout"]');
    expect(callout.getAttribute("data-callout")).toBe("tip");
    expect(callout.getAttribute("dir")).toBe("auto");
    expect(ed.view.dom.querySelector("td").getAttribute("dir")).toBe("auto");
    ed.commands.setTextSelection(2);
    ed.commands.setTextAlign("right");
    const redrawn = ed.view.dom.querySelector("p");
    expect(redrawn.getAttribute("style")).toContain("text-align: right");
    expect(redrawn.getAttribute("dir")).toBe("auto");
  });

  it("is registered in the live editor", () => {
    const pane = readFileSync(join(process.cwd(), "src/ui/TiptapPane.tsx"), "utf8");
    expect(pane).toMatch(/\bBidiAuto\b.*dir="auto"/);
  });
});

describe("markdown pane: per-line direction", () => {
  it("reads each line's direction, and gives each line one to read", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({ doc: "hello\nمرحبا\nworld", extensions: [perLineTextDirection] }),
      parent,
    });
    try {
      expect(view.state.facet(EditorView.perLineTextDirection)).toBe(true);
      const lines = Array.from(parent.querySelectorAll(".cm-line"));
      expect(lines.length).toBe(3);
      for (const line of lines) expect(line.getAttribute("dir")).toBe("auto");
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  it("is registered in the live editor", () => {
    const pane = readFileSync(join(process.cwd(), "src/ui/CodeMirrorPane.tsx"), "utf8");
    expect(pane).toMatch(/\n\s+perLineTextDirection,/);
  });
});

describe("paste and export", () => {
  it("keeps dir and lang on pasted HTML", () => {
    const out = sanitizePastedHtml('<p dir="rtl" lang="ar">مرحبا</p><p lang="he">שלום</p>');
    expect(out).toContain('dir="rtl"');
    expect(out).toContain('lang="ar"');
    expect(out).toContain('lang="he"');
  });

  it("does not declare every exported document English", () => {
    const src = readFileSync(join(process.cwd(), "src/store/import-export.ts"), "utf8");
    expect(src).not.toMatch(/<html lang="en">/);
  });
});
