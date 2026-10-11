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
import { BidiAuto, TaskItemAutoDir } from "../extensions/BidiAuto";
import { perLineTextDirection } from "../extensions/cm-bidi";

let editor;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** The live editor's arrangement: BidiAuto, and the task item that carries the attribute itself. */
const LIVE = [...SERIALIZE_EXTENSIONS.map((e) => (e.name === "taskItem" ? TaskItemAutoDir.configure({ nested: true }) : e)), BidiAuto];
const mount = (content) => {
  editor = new Editor({ element: document.createElement("div"), extensions: LIVE, content });
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

  it("marks task items through TipTap's own node view, and keeps them marked as you type", () => {
    // TipTap draws a task item with its own node view, which a plugin's cannot
    // replace; TaskItemAutoDir adds the attribute to it. (Task items were the
    // one block left on a decoration, and building a decoration set is
    // quadratic in top-level blocks — A083.)
    const ed = mount(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>item</p>' +
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>sub</p></li></ul></li></ul>'
    );
    const items = () => Array.from(ed.view.dom.querySelectorAll("li[data-checked]"));
    expect(items()).toHaveLength(2);
    for (const ch of "typing more text") {
      ed.commands.setTextSelection(4); // inside "item"
      ed.commands.insertContent(ch);
    }
    // Checking an item updates its view in place; the attribute stays.
    ed.view.dispatch(ed.state.tr.setNodeMarkup(0 + 1, undefined, { checked: true }));
    expect(items()[0].getAttribute("data-checked")).toBe("true");
    for (const li of items()) expect(li.getAttribute("dir")).toBe("auto");
    // View-only: neither the document nor its HTML carries it.
    expect(ed.getHTML()).not.toContain("dir=");
    expect(JSON.stringify(ed.getJSON())).not.toContain("dir");
  });

  it("keeps every task item marked through a transaction of many steps (A083)", () => {
    // The first markdown projection after a load can replace hundreds of
    // blocks in one transaction, from the end of the document backwards.
    const ed = mount(
      Array.from({ length: 40 }, (_, i) =>
        `<p>p${i}</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>t${i}</p></li></ul>`).join("")
    );
    const { schema } = ed.state;
    const item = (t) => schema.nodes.taskItem.create({ checked: false }, schema.nodes.paragraph.create(null, schema.text(t)));
    const lists = [];
    ed.state.doc.forEach((node, offset) => { if (node.type.name === "taskList") lists.push([offset, offset + node.nodeSize]); });
    const tr = ed.state.tr;
    for (const [from, to] of lists.reverse()) tr.replaceWith(from, to, schema.nodes.taskList.create(null, [item("a"), item("b")]));
    expect(tr.steps).toHaveLength(40);
    ed.view.dispatch(tr);
    const items = ed.view.dom.querySelectorAll("li[data-checked]");
    expect(items).toHaveLength(80);
    for (const li of items) expect(li.getAttribute("dir")).toBe("auto");
  });

  it("marks ordinary blocks through their node views — no decorations at all", () => {
    // A decoration on every block made each transaction quadratic in the
    // number of blocks (A083): 714 ms per keystroke in a 1.6 MB document.
    const ed = mount("<h2>h</h2><p>a</p><p>b</p><ul><li><p>c</p></li></ul><blockquote><p>d</p></blockquote>");
    const plugin = ed.state.plugins.find((p) => p.key.startsWith("bidiAuto"));
    // No state and no decorations: nothing to map, rebuild or hand down.
    expect(plugin.spec.state).toBeUndefined();
    expect(plugin.props.decorations).toBeUndefined();
    ed.commands.setTextSelection(2);
    ed.commands.insertContent("typed");
    // Every block is marked (StarterKit may append an empty paragraph after
    // the final blockquote; it is marked too), and nothing else.
    const blocks = ed.view.dom.querySelectorAll("h2, p, li, blockquote");
    for (const b of blocks) expect(b.getAttribute("dir")).toBe("auto");
    expect(autoDirTags(ed)).toHaveLength(blocks.length);
  });

  it("still carries other plugins' node decorations (the empty-editor placeholder)", () => {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [...LIVE, Placeholder.configure({ placeholder: "Start typing" })],
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
    const pane = readFileSync(join(process.cwd(), "src/ui/panes/tiptapPane/index.tsx"), "utf8");
    expect(pane).toMatch(/\bBidiAuto\b.*dir="auto"/);
    expect(pane).toMatch(/TaskItemAutoDir\.configure\(\{ nested: true \}\)/);
    expect(pane).not.toMatch(/\bTaskItem\.configure/);
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
    const pane = readFileSync(join(process.cwd(), "src/ui/panes/codeMirrorPane/index.tsx"), "utf8");
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
    const src = readFileSync(join(process.cwd(), "src/store/importExport/import-export.ts"), "utf8");
    expect(src).not.toMatch(/<html lang="en">/);
  });
});
