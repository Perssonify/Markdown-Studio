/**
 * A108 — acting on "the pane you are in", and saving, through the real editor:
 * the right-click menu (a link to a heading, Add link…, a formula, paste and
 * select-all), Clear document, the host callbacks (onSave, onContentChange),
 * the idle autosave, what the user is told when a save fails or storage is
 * full, the blank-over-content backstop, and the unload stash.
 *
 * One mount; the cases are one journey (see behave-harness.jsx).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react/pure";
import {
  PrefsMemoryAdapter, act, click, fireEvent, heading, installBrowserStubs, key, mdText, menuClick, mdView,
  mountEditor, onDisk, para, richEditor, store, storedDoc, textOf, tick, toastText, typeRich, until,
  untilHydrated, untilMdHas, untilRichHas,
} from "./behave-harness";
import { findMenuItem } from "./behave-harness";
import { StorageQuotaError } from "../store/idb-storage-adapter";
import { RECOVERY_KEY } from "../store/crash-recovery";

vi.setConfig({ testTimeout: 30000 });

/** An adapter whose next saves can be made to fail. */
class FlakyAdapter extends PrefsMemoryAdapter {
  failWith = null;
  async save(doc) {
    if (this.failWith) throw this.failWith;
    return super.save(doc);
  }
}

let adapter;
let warn;
let err;
const onSave = vi.fn();
const onContentChange = vi.fn();

beforeAll(async () => {
  installBrowserStubs();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
  adapter = new FlakyAdapter();
  await adapter.save(storedDoc("doc", "Doc", [heading(1, "Doc"), heading(2, "Setup"), para("setup body")]));
  await mountEditor({ storageAdapter: adapter, onSave, onContentChange });
  await untilHydrated("doc");
}, 30000);

afterAll(() => { cleanup(); warn.mockRestore(); err.mockRestore(); });

const pm = () => document.querySelector(".ProseMirror");
const statusBar = () => document.querySelector("footer")?.textContent ?? "";
async function contextMenu(target, ...path) {
  await act(async () => { fireEvent.contextMenu(target, { clientX: 20, clientY: 20 }); });
  for (let i = 0; i < path.length; i++) {
    const item = await until(() => findMenuItem(path[i]), `menu item "${path[i]}"`);
    await act(async () => {
      if (i < path.length - 1) { fireEvent.mouseEnter(item); fireEvent.pointerEnter?.(item); }
      fireEvent.click(item);
    });
    await tick(20);
  }
}
const alertDialog = (re) => [...document.querySelectorAll('[role="alertdialog"]')].find((d) => re.test(d.textContent));
const placeCaretAtEnd = () => act(async () => {
  const ed = richEditor();
  pm().focus();
  ed.commands.setTextSelection(ed.state.doc.content.size - 1);
});

describe("the right-click menu", () => {
  it("Link to heading inserts a [[#Heading]] link into the rich pane", async () => {
    await placeCaretAtEnd();
    await contextMenu(pm(), "Link to heading", "Setup");
    const link = await until(() => pm().querySelector('a[data-anchor="Setup"]'), "the heading link");
    expect(link.getAttribute("data-doc-link")).toBe("");
    expect(link.textContent).toBe("Setup");
    // Written with its display text as an alias, since the rich pane shows the
    // bare heading name where `[[#Setup]]` typed as markdown shows "#Setup".
    await until(() => /\[\[#Setup\|Setup\]\]/.test(mdText()), "the heading link in the markdown pane");
  });

  it("Add link… asks for the URL and links the selection", async () => {
    await act(async () => {
      const ed = richEditor();
      pm().focus();
      let from = 0;
      ed.state.doc.descendants((n, p) => { if (n.isText && n.text.includes("setup body")) from = p + n.text.indexOf("setup body"); });
      ed.commands.setTextSelection({ from, to: from + "setup".length });
    });
    await contextMenu(pm(), "Add link");
    const dialog = await until(() => alertDialog(/Insert Link/), "the link prompt");
    const input = dialog.querySelector("input");
    await act(async () => { fireEvent.change(input, { target: { value: "https://example.com/setup" } }); });
    await click([...dialog.querySelectorAll("button")].find((b) => b.textContent.trim() === "Confirm"));
    await until(() => pm().querySelector('a[href="https://example.com/setup"]'), "the link in the rich pane");
    await untilMdHas("[setup](https://example.com/setup)");
  });

  it("Insert ▸ Formula block… asks for LaTeX and inserts a formula", async () => {
    await placeCaretAtEnd();
    await contextMenu(pm(), "Insert", "Formula block");
    const dialog = await until(() => alertDialog(/Formula/), "the equation dialog");
    await act(async () => { fireEvent.change(dialog.querySelector("textarea"), { target: { value: "E = mc^2" } }); });
    await click([...dialog.querySelectorAll("button")].find((b) => b.textContent.trim() === "Insert"));
    await untilMdHas("$$");
    expect(mdText()).toContain("E = mc^2");
  });

  it("Paste puts the clipboard into the markdown pane when that is where the caret was", async () => {
    const view = mdView();
    await act(async () => { view.focus(); view.contentDOM.dispatchEvent(new FocusEvent("focus")); });
    await act(async () => { view.dispatch({ selection: { anchor: view.state.doc.length } }); });
    await navigator.clipboard.writeText("\n\npasted from the clipboard");
    await contextMenu(view.contentDOM, "Paste");
    await untilMdHas("pasted from the clipboard");
    await untilRichHas("pasted from the clipboard");
  });

  it("Select all selects the whole markdown pane", async () => {
    const view = mdView();
    await contextMenu(view.contentDOM, "Select all");
    await until(() => view.state.selection.main.from === 0 && view.state.selection.main.to === view.state.doc.length, "the whole document selected");
  });
});

describe("saving, and telling the host", () => {
  it("⌘S saves, says so, and hands the host the saved content", async () => {
    await typeRich(" saved by hand");
    await act(async () => { pm().focus(); });
    await key(pm(), "s", { ctrlKey: true });
    await until(() => onSave.mock.calls.length > 0, "onSave");
    const payload = onSave.mock.calls.at(-1)[0];
    expect(payload.docId).toBe("doc");
    expect(payload.markdown).toContain("saved by hand");
    expect(payload.html).toContain("saved by hand");
    expect(textOf(payload.canonical)).toContain("saved by hand");
    expect(textOf((await onDisk(adapter, "doc")).canonical)).toContain("saved by hand");
  });

  it("onContentChange reports edits, debounced, with the markdown", async () => {
    onContentChange.mockClear();
    await typeRich(" a");
    await typeRich("b");
    await until(() => onContentChange.mock.calls.length > 0, "onContentChange");
    await tick(400);
    expect(onContentChange).toHaveBeenCalledTimes(1);
    expect(onContentChange.mock.calls[0][0].markdown).toContain("saved by hand ab");
  });

  it("autosave writes a pause's worth of typing without ⌘S — and not the host", async () => {
    onSave.mockClear();
    await typeRich(" autosaved");
    await until(async () => textOf((await onDisk(adapter, "doc")).canonical).includes("autosaved"), "the autosave", { timeout: 9000 });
    expect(onSave).not.toHaveBeenCalled(); // automatic persistence stays local
  });
});

describe("when saving fails", () => {
  it("a failed ⌘S says why, and the status bar keeps saying it", async () => {
    adapter.failWith = new Error("the disk is on fire");
    await typeRich(" will not save");
    await act(async () => { pm().focus(); });
    await key(pm(), "s", { ctrlKey: true });
    await until(() => /Save failed/.test(toastText()), "the failure toast");
    await until(() => /Save failed — retrying/.test(statusBar()), "the failure in the status bar");
    expect(textOf((await onDisk(adapter, "doc")).canonical)).not.toContain("will not save");
    adapter.failWith = null;
    await key(pm(), "s", { ctrlKey: true });
    await until(async () => textOf((await onDisk(adapter, "doc")).canonical).includes("will not save"), "the retry to land");
    await until(() => !/Save failed — retrying/.test(statusBar()), "the status bar to recover");
  });

  it("a full store is reported as full, and typing after space is freed saves again", async () => {
    adapter.failWith = new StorageQuotaError(100, 100, 10);
    await typeRich(" no room");
    await act(async () => { pm().focus(); });
    await key(pm(), "s", { ctrlKey: true });
    await until(() => store().saveStatus === "full", "the full status");
    await until(() => /Storage full — not saving/.test(statusBar()), "full in the status bar");
    adapter.failWith = null;
    await typeRich(" room again");
    await key(pm(), "s", { ctrlKey: true });
    await until(async () => textOf((await onDisk(adapter, "doc")).canonical).includes("room again"), "the save after freeing space");
  });

  it("an emptied editor is not saved over the stored document", async () => {
    // Select everything and delete it, as the keyboard would.
    await act(async () => {
      const ed = richEditor();
      ed.commands.selectAll();
      ed.view.dispatch(ed.state.tr.deleteSelection());
    });
    await act(async () => { pm().focus(); });
    await key(pm(), "s", { ctrlKey: true });
    await until(() => /editor is empty but the stored document is not/.test(toastText()), "the refusal");
    await until(() => /Empty editor — not saving/.test(statusBar()), "the refusal in the status bar");
    expect(textOf((await onDisk(adapter, "doc")).canonical)).toContain("room again");
    // Edit ▸ Undo brings the content back — nothing was lost. (Asserted on
    // older text: history may group the deletion with the typing just before.)
    await menuClick("Edit", "Undo");
    await untilRichHas("setup body");
  });

  it("Edit ▸ Clear document is the ONE way to save an empty document, and it asks first", async () => {
    await menuClick("Edit", "Clear document");
    const dialog = await until(() => alertDialog(/Clear document\?/), "the clear confirmation");
    await click([...dialog.querySelectorAll("button")].find((b) => b.textContent.trim() === "Clear"));
    await until(() => richEditor().getText().trim() === "" && mdText().trim() === "", "both panes empty");
    await act(async () => { pm().focus(); });
    await key(pm(), "s", { ctrlKey: true });
    await until(async () => !textOf((await onDisk(adapter, "doc")).canonical).includes("room again"), "the cleared document on disk");
  });
});

describe("leaving the page", () => {
  it("unsaved typing is stashed synchronously when the page unloads", async () => {
    try { localStorage.removeItem(RECOVERY_KEY); } catch { /* ignore */ }
    await typeRich("typed right before the tab closed");
    await until(() => store().saveStatus === "editing", "unsaved typing");
    const e = new Event("beforeunload", { cancelable: true });
    await act(async () => { window.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(true); // the browser asks before leaving
    const stash = localStorage.getItem(RECOVERY_KEY);
    expect(stash).toContain("typed right before the tab closed");
    expect(stash).toContain('"doc"');
  });
});
