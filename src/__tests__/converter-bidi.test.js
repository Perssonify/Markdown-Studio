/**
 * A099 — right-to-left text renders right-to-left, without touching the
 * document model.
 */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Editor } from "@tiptap/core";
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

  it("does not accumulate decorations as you type (one per block, always)", () => {
    // An ancestor that straddles the edited range must be re-derived, not
    // re-added: duplicates render identically, so only the plugin's own state
    // shows them — growing by one per keystroke in a list item.
    const ed = mount("<ul><li><p>item</p></li></ul><blockquote><p>q</p></blockquote>");
    const plugin = ed.state.plugins.find((p) => p.key.startsWith("bidiAuto"));
    const blocks = () => {
      let n = 0;
      ed.state.doc.descendants((node) => { if (["listItem", "paragraph", "blockquote"].includes(node.type.name)) n++; });
      return n;
    };
    for (const ch of "typing more text") {
      ed.commands.setTextSelection(7); // inside "item"
      ed.commands.insertContent(ch);
    }
    expect(plugin.getState(ed.state).find().length).toBe(blocks());
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
