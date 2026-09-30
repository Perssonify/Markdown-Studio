/**
 * A108 — formatting through the real editor's toolbar and menus, in BOTH
 * panes: a command applies to the pane the caret is in, and the other pane
 * follows. Marks, block types, lists, tables, links, rules, undo and redo,
 * case changes, alignment (and the fidelity warning it earns), and a
 * decorative colour in Clean mode.
 *
 * One mount; the cases are one journey (see behave-harness.jsx).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react/pure";
import {
  act, click, fireEvent, installBrowserStubs, mdText, mdView, menuClick, mountEditor, para, richEditor,
  seededAdapter, storedDoc, tick, toastText, until, untilHydrated,
} from "./behave-harness";
import { findMenuItem } from "./behave-harness";

vi.setConfig({ testTimeout: 30000 });

let warn;
let err;

beforeAll(async () => {
  installBrowserStubs();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
  const adapter = await seededAdapter(
    [storedDoc("fmt", "Fmt", [
      para("alpha beta gamma"), para("second line"), para("third line"), para("quote me"),
      para("table here"), para("code me"), para("callout me"), para("details me"), para("centre me"),
    ])],
    { prefs: { syncMode: "clean" } },
  );
  await mountEditor({ storageAdapter: adapter });
  await untilHydrated("fmt");
  // The toolbar measures its own width; jsdom reports 0, so it starts compact.
  await click(screen.getByTitle("Expand Toolbar"));
}, 30000);

afterAll(() => { cleanup(); warn.mockRestore(); err.mockRestore(); });

const pm = () => document.querySelector(".ProseMirror");
const html = () => richEditor().getHTML();
const untilMd = (re, what) => until(() => re.test(mdText()), what ?? `the markdown pane to match ${re}`)
  .catch((e) => { throw new Error(`${e.message}
--- markdown pane ---
${mdText()}`); });
const untilHtml = (re, what) => until(() => re.test(html()), what ?? `the rich pane to match ${re}`);
const tb = (title) => screen.getByTitle((t) => t === title || t.startsWith(`${title} (`) || t.startsWith(`${title} —`));
const tool = (title) => click(tb(title));

/** Select `word` in the rich pane, with the caret (and so the command) there. */
async function selectRich(word) {
  await act(async () => {
    const ed = richEditor();
    let from = -1;
    ed.state.doc.descendants((n, p) => { if (from < 0 && n.isText && n.text.includes(word)) from = p + n.text.indexOf(word); });
    pm().focus();
    ed.commands.setTextSelection({ from, to: from + word.length });
  });
  await tick(20);
}
/** Put the caret at the END of the text holding `word` (rich pane). */
const caretRich = (word) => selectRich(word).then(() => act(async () => {
  const ed = richEditor();
  const { $from } = ed.state.selection;
  ed.commands.setTextSelection($from.end());
}));
/** Select `text` in the markdown pane, with the caret there. */
async function selectMd(text) {
  const v = mdView();
  await act(async () => {
    const at = v.state.doc.toString().indexOf(text);
    v.focus();
    v.dispatch({ selection: { anchor: at, head: at + text.length } });
  });
  await tick(20);
}

describe("marks, from the toolbar, in the rich pane", () => {
  it("Bold, Italic, Underline and Strike each reach the markdown pane", async () => {
    await selectRich("alpha");
    await tool("Bold");
    await untilMd(/\*\*alpha\*\*/);
    await selectRich("beta");
    await tool("Italic");
    await untilMd(/\*beta\*/);
    await selectRich("gamma");
    await tool("Underline");
    await untilMd(/<u>gamma<\/u>/);
    await selectRich("second");
    await tool("Strike");
    await untilMd(/~~second~~/);
  });

  it("Undo and Redo walk the rich pane's history", async () => {
    await tool("Undo");
    await untilMd(/^(?!.*~~second~~)/s, "the strike undone");
    await tool("Redo");
    await untilMd(/~~second~~/);
  });

  it("Clear Format removes the marks from the selection", async () => {
    await selectRich("second");
    await tool("Clear Format");
    await untilMd(/^(?!.*~~second~~)/s, "the strike cleared");
  });
});

describe("blocks and lists", () => {
  it("the block-type control turns a paragraph into a heading and back", async () => {
    await caretRich("third");
    await click(screen.getByLabelText("Block type: Paragraph"));
    await click(await until(() => findMenuItem("Heading 2"), "Heading 2"));
    await untilMd(/^## third line$/m);
    await untilHtml(/<h2>third line<\/h2>/);
    await until(() => screen.queryByLabelText("Block type: Heading 2"), "the control to show the block");
    await menuClick("Format", "Heading", "Normal text");
    await untilMd(/^third line$/m);
  });

  it("bullet, numbered and task lists, and indent nests a list item", async () => {
    await caretRich("third");
    await tool("Bullet List");
    await untilMd(/^- third line$/m);
    await tool("Numbered List");
    await untilMd(/^1\. third line$/m);
    await tool("Task List");
    await untilMd(/^- \[ \] third line$/m);
    // Two items, then indent the second under the first.
    await act(async () => {
      richEditor().chain().focus().splitListItem("taskItem").insertContent("nested item").run();
    });
    await untilMd(/^- \[ \] nested item$/m);
    await tool("Indent");
    await untilMd(/^\s+- \[ \] nested item$/m);
    await tool("Outdent");
    await untilMd(/^- \[ \] nested item$/m);
  });

  it("Format ▸ Blockquote, and a horizontal rule from the toolbar", async () => {
    await caretRich("quote me");
    await menuClick("Format", "Blockquote");
    await untilMd(/^> quote me$/m);
    await caretRich("table here");
    await tool("Horizontal Rule");
    await untilMd(/^---$/m);
  });
});

describe("inserting", () => {
  it("a table from the toolbar's grid, then a row added and the table removed", async () => {
    await caretRich("table here");
    await tool("Insert Table");
    const grid = await until(() => document.querySelector('[role="grid"] .grid'), "the table grid");
    const perRow = Number(/repeat\((\d+)/.exec(grid.style.gridTemplateColumns)[1]);
    await click(grid.children[perRow + 1]); // 2 rows × 2 columns
    await untilHtml(/<table/);
    await untilMd(/\|.*\|/);
    const rows = () => (html().match(/<tr/g) ?? []).length;
    const before = rows();
    await tool("Add Row");
    await until(() => rows() === before + 1, "a new row");
    await tool("Delete Table");
    await until(() => !/<table/.test(html()), "the table gone");
  });

  it("a link from the toolbar asks for the URL", async () => {
    await selectRich("gamma");
    await tool("Link");
    const dialog = await until(() => [...document.querySelectorAll('[role="alertdialog"]')].find((d) => /Insert Link/.test(d.textContent)), "the link prompt");
    await act(async () => { fireEvent.change(dialog.querySelector("input"), { target: { value: "https://example.org" } }); });
    await click([...dialog.querySelectorAll("button")].find((b) => b.textContent.trim() === "Confirm"));
    await untilMd(/\[<u>gamma<\/u>\]\(https:\/\/example\.org\)|<u>\[gamma\]\(https:\/\/example\.org\)<\/u>/, "the link in the markdown pane");
  });

  it("Insert ▸ Code block, Callout and Collapsible details", async () => {
    await caretRich("callout me");
    await menuClick("Insert", "Callout", "Tip");
    await untilMd(/> \[!TIP\]/);
    await caretRich("code me");
    await menuClick("Insert", "Code block");
    await untilMd(/```/);
    await caretRich("details me");
    await menuClick("Insert", "Collapsible details");
    await untilMd(/<details/);
  });
});

describe("the markdown pane", () => {
  it("a command acts on the MARKDOWN when the caret is there, and the rich pane follows", async () => {
    await typeInMd("\n\nplain words here");
    await selectMd("plain");
    await tool("Bold");
    await until(() => mdText().includes("**plain** words here"), "bold written as markdown");
    await untilHtml(/<strong>plain<\/strong> words here/);
    await selectMd("words");
    await menuClick("Format", "Change case", "UPPERCASE");
    await until(() => mdText().includes("**plain** WORDS here"), "the case change in the markdown pane");
    await untilHtml(/WORDS here/);
  });
});

async function typeInMd(text) {
  const v = mdView();
  await act(async () => { v.dispatch({ changes: { from: v.state.doc.length, insert: text }, userEvent: "input.type" }); });
}

describe("what Markdown cannot carry", () => {
  it("centring earns the fidelity warning; a colour in Clean mode says it stays local", async () => {
    await caretRich("centre me");
    await tool("Center");
    await untilHtml(/text-align:\s*center/);
    await until(() => /not in MD|cannot be written as Markdown/i.test(document.querySelector("footer").innerHTML), "the fidelity warning");
    await selectRich("second");
    await click(screen.getByTitle("Text Color"));
    await click(await until(() => document.querySelector('[aria-label^="Text color #"]'), "a colour swatch"));
    await until(() => /switch to 'Styled' to save in Markdown/.test(toastText()), "the Clean-mode warning");
    await untilHtml(/color/);
  });
});
