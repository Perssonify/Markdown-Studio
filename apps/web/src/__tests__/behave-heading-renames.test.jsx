/**
 * Renaming a heading keeps the links to it working (backlog #122), through the
 * REAL editor: rename a heading in "Guide" that other notes link to, move the
 * caret out, and the editor offers to retarget the links — Update rewrites
 * them (the open note as one undoable step, the others on disk with a
 * version kept), Dismiss writes nothing, read-only refuses, and typing inside
 * the heading never asks. Leaving the note asks too.
 *
 * One mount; the cases are one journey (see behave-harness.jsx).
 */
import { createRef } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react/pure";
import {
  act, click, heading, installBrowserStubs, key, mdText, menuClick, mountEditor, onDisk, para, pickFiles, richEditor,
  seededAdapter, store, storedDoc, tick, toastText, typeMd, until, untilHydrated, untilMdHas,
} from "./behave-harness";
import { HEADING_RENAME_CHECK_MS } from "../editor/useHeadingRenameLinks";
import { createWikiResolver } from "../store/links/link-index";
import { findHeadingByAnchor } from "../store/documents/doc-outline";
import { headingsFromDoc } from "../store/links/heading-renames";
import { snapshotStore } from "../store/history/snapshot-store";
import { useEditorStore } from "../store/editor/editorStore";
import { useUIStore } from "../store/preferences/uiStore";

vi.setConfig({ testTimeout: 40000 });

const wiki = (docLink, anchor) => ({ type: "link", attrs: { href: "#", class: "wiki-link", docLink, anchor } });
const t = (text, ...marks) => (marks.length ? { type: "text", text, marks } : { type: "text", text });
const p = (...content) => ({ type: "paragraph", content });

let adapter;
const handle = createRef();
let warn;
let err;

beforeAll(async () => {
  installBrowserStubs();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
  adapter = await seededAdapter([
    storedDoc("guide", "Guide", [
      heading(1, "Guide"),
      heading(2, "Setup"),
      p(t("Jump to "), t("#Setup", wiki("", "Setup"))),
      heading(2, "Usage"),
      p(t("#Usage", wiki("", "Usage"))),
      heading(2, "Limits"),
      para("limits body"),
      heading(2, "Extra"),
      p(t("See [[#Extra]] below.")),
      heading(2, "Appendix"),
      para("appendix body"),
      heading(2, "Glossary"),
      para("glossary body"),
      heading(2, "Index"),
      para("index body"),
      heading(2, "Credits"),
      para("credits body"),
      heading(2, "Sources"),
      para("the end"),
    ], { updated: "2026-09-10T10:00:00.000Z" }),
    storedDoc("notes", "Notes", [
      heading(1, "Notes"),
      p(t("Guide#Setup", wiki("Guide", "Setup"))),
      p(t("Guide#Usage", wiki("Guide", "Usage")), t(" and [[Guide#Usage|how to use it]]")),
      p(t("Mind [[Guide#Limits]].")),
      p(t("Guide#Extra", wiki("Guide", "Extra"))),
    ], { updated: "2026-09-02T10:00:00.000Z" }),
    storedDoc("other", "Other", [
      heading(1, "Other"),
      p(t("usage notes", wiki("Guide", "Usage"))),
      p(t("Back matter: [[Guide#Appendix]], [[Guide#Index]], [[Guide#Sources]].")),
      p(t("Guide#Glossary", wiki("Guide", "Glossary")), t(" and "), t("credits", wiki("Guide", "Credits"))),
    ], { updated: "2026-09-01T10:00:00.000Z" }),
    storedDoc("locked", "Locked", [
      heading(1, "Locked"),
      p(t("Guide#Usage", wiki("Guide", "Usage"))),
    ], { updated: "2026-09-01T09:00:00.000Z" }),
  ]);
  await mountEditor({ storageAdapter: adapter, _integrationRef: handle });
  const row = await until(() => document.querySelector('[role="tree"] [data-key="d:guide"]'), "the library");
  if (row.getAttribute("aria-current") !== "true") await click(row.querySelector("button"));
  await untilHydrated("guide");
  // The library the offer counts links in is the link index's.
  await until(() => (useEditorStore.getState().linkIndex.reverse.get("guide")?.size ?? 0) >= 3, "the link index");
}, 40000);

afterAll(() => {
  cleanup();
  warn.mockRestore();
  err.mockRestore();
  useUIStore.setState({ readOnly: false });
});

// ── Driving the rich pane the way a user does ──────────────────────────────

/** A browser reports every caret move as `selectionchange`. */
const selectionMoved = () => act(async () => {
  document.dispatchEvent(new Event("selectionchange"));
  await new Promise((r) => setTimeout(r, 20));
});

/** The heading whose text is `text`: the range of its content. */
function headingAt(text) {
  const ed = richEditor();
  let found = null;
  ed.state.doc.descendants((n, pos) => {
    if (found) return false;
    if (n.type.name === "heading" && n.textContent === text) { found = { from: pos + 1, to: pos + 1 + n.content.size }; return false; }
    return true;
  });
  if (!found) throw new Error(`no heading "${text}"`);
  return found;
}

async function caretTo(pos) {
  const ed = richEditor();
  await act(async () => { ed.commands.setTextSelection(pos); });
  await selectionMoved();
}

/** Put the caret in a heading and retype it — a keystroke at a time, with
 *  the caret reported after each, as a browser would. */
async function retypeHeading(from, to) {
  const { to: end } = headingAt(from);
  await caretTo(end);
  for (let i = 0; i < from.length; i++) {
    const ed = richEditor();
    const at = ed.state.selection.from;
    await act(async () => { ed.view.dispatch(ed.state.tr.delete(at - 1, at)); });
    await selectionMoved();
  }
  for (const ch of to) {
    const ed = richEditor();
    await act(async () => { ed.view.dispatch(ed.state.tr.insertText(ch)); });
    await selectionMoved();
  }
}

/** Move the caret into the paragraph after the heading `text`. */
const leaveHeading = async (text) => caretTo(headingAt(text).to + 2);

/** Wait out the check, for a NEGATIVE assertion (nothing to poll for). */
const waitOutCheck = () => tick(HEADING_RENAME_CHECK_MS + 500);

const offers = () => [...document.querySelectorAll("[data-sonner-toast]")].filter((el) => /renamed/.test(el.textContent));
function toastButton(containing, label) {
  const el = [...document.querySelectorAll("[data-sonner-toast]")].find((x) => x.textContent.includes(containing));
  return el ? [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === label) ?? null : null;
}
const clickToast = async (containing, label) =>
  click(await until(() => toastButton(containing, label), `the "${label}" button on "${containing}"`));

/** Link marks in a canonical, as `text|docLink#anchor`. */
function marksOf(canonical) {
  const out = [];
  const walk = (n) => {
    const m = n.marks?.find((x) => x.type === "link");
    if (m) out.push(`${n.text}|${m.attrs.docLink}#${m.attrs.anchor}`);
    (n.content ?? []).forEach(walk);
  };
  walk(canonical);
  return out;
}
const json = (c) => JSON.stringify(c ?? null);

describe("typing in a heading never asks", () => {
  it("renaming the heading the caret moved INTO is still being written — no offer", async () => {
    // Leaving the H1 schedules a check; by the time it runs the caret is in
    // "Setup", being renamed — which is exactly what must not be offered.
    // (A check is only SCHEDULED when the caret leaves a heading; while it
    // stays in one no check runs at all. That is a cost guard: were a check
    // to run mid-typing, the exclusion this case pins would still hold it
    // back, so no case here can observe it on its own.)
    await caretTo(headingAt("Guide").to);
    await retypeHeading("Setup", "Installation");
    await waitOutCheck();
    expect(offers()).toEqual([]);
    expect(headingsFromDoc(richEditor().state.doc).map((h) => h.text)).toContain("Installation");
  });
});

describe("Dismiss writes nothing", () => {
  it("offers once the caret leaves the heading — after any live composition", async () => {
    // An IME / dictation session is still streaming text when the caret
    // leaves: its projection has not reached the rich pane yet, so the check
    // waits for it rather than judging a half-finished document.
    const view = richEditor().view;
    view.input.composing = true;
    try {
      await leaveHeading("Installation");
      await waitOutCheck();
      expect(offers()).toEqual([]);
    } finally {
      view.input.composing = false;
    }
    await until(
      () => /Heading renamed — update 2 links in 2 notes to “Installation”\?/.test(toastText()),
      "the offer for Setup → Installation",
    );
  });

  it("Dismiss leaves every link as it was, on disk and on screen", async () => {
    const before = json((await onDisk(adapter, "notes")).canonical);
    await clickToast("Installation", "Dismiss");
    await until(() => !offers().length, "the offer to close");
    await tick(300);
    expect(json((await onDisk(adapter, "notes")).canonical)).toBe(before);
    expect(marksOf(richEditor().getJSON())).toContain("#Setup|#Setup");
  });

  it("does not ask about the same rename again", async () => {
    await caretTo(headingAt("Installation").to);
    await leaveHeading("Installation");
    await waitOutCheck();
    expect(offers()).toEqual([]);
  });
});

describe("Update retargets every link", () => {
  let indexAtUpdate;

  it("offers with the count of links and notes", async () => {
    await retypeHeading("Usage", "Usage guide");
    await leaveHeading("Usage guide");
    await until(
      () => /Heading renamed — update 5 links in 4 notes to “Usage guide”\?/.test(toastText()),
      "the offer for Usage → Usage guide",
    );
  });

  it("rewrites the other notes on disk, keeps aliases, and skips a note it cannot write safely", async () => {
    // "Locked" has an unsaved draft parked: writing under it would be
    // overwritten (or refused as a conflict) the next time it is saved.
    const lockedDraft = (await onDisk(adapter, "locked")).canonical;
    store().cacheUnsavedEdit("locked", lockedDraft);
    const lockedBefore = json(lockedDraft);

    // Typing right beside the open note's own [[#Usage]] a moment before
    // pressing Update: ProseMirror's history would fold the rewrite into that
    // typing (adjacent, within its grouping delay) — ⌘Z must not take both.
    const ed = richEditor();
    let linkEnd = -1;
    ed.state.doc.descendants((n, pos) => {
      if (n.isText && n.marks.some((m) => m.attrs.anchor === "Usage" && m.attrs.docLink === "")) linkEnd = pos + n.nodeSize;
    });
    await act(async () => { ed.view.dispatch(ed.state.tr.insert(linkEnd, ed.schema.text(" typed"))); });

    // …and with a composition live: it is ENDED (its text committed), as the
    // format dispatcher does, before the rewrite is dispatched.
    const blur = vi.spyOn(ed.view.dom, "blur");
    ed.view.input.composing = true;
    try {
      await clickToast("Usage guide", "Update");
    } finally {
      ed.view.input.composing = false;
    }
    expect(blur).toHaveBeenCalled();
    blur.mockRestore();
    await until(() => /Updated 4 links — could not change “Locked”/.test(toastText()), "the result");
    indexAtUpdate = useEditorStore.getState().linkIndex;

    const notes = (await onDisk(adapter, "notes")).canonical;
    expect(marksOf(notes)).toContain("Guide#Usage guide|Guide#Usage guide");
    expect(json(notes)).toContain("[[Guide#Usage guide|how to use it]]");
    // Links to the other headings are untouched.
    expect(marksOf(notes)).toContain("Guide#Setup|Guide#Setup");
    expect(json(notes)).toContain("[[Guide#Limits]]");
    // An alias keeps its words.
    expect(marksOf((await onDisk(adapter, "other")).canonical)).toContain("usage notes|Guide#Usage guide");
    expect(json((await onDisk(adapter, "locked")).canonical)).toBe(lockedBefore);
    store().clearUnsavedEdit("locked");

    // …and the rewritten link RESOLVES: to Guide, at a heading that exists.
    const docs = await Promise.all(["guide", "notes", "other", "locked"].map((id) => onDisk(adapter, id)));
    const m = notes.content[2].content[0].marks[0];
    const r = createWikiResolver(docs)(m.attrs.docLink, m.attrs.anchor);
    expect(r).toEqual({ id: "guide", anchor: "Usage guide" });
    expect(findHeadingByAnchor(headingsFromDoc(richEditor().state.doc).map((h) => h.text), r.anchor)).toBeGreaterThan(0);
  });

  it("keeps the version each rewrite replaced in Version history", async () => {
    for (const id of ["notes", "other", "guide"]) {
      await until(async () => (await snapshotStore.listForDoc(id)).some((s) => s.reason === "pre-link-update"), `a snapshot of ${id}`);
    }
    const [snap] = (await snapshotStore.listForDoc("notes")).filter((s) => s.reason === "pre-link-update");
    expect(json(await snapshotStore.getCanonical(snap.id))).toContain('"anchor":"Usage"');
  });

  it("rewrote the open note's own [[#Usage]] live, and ⌘Z takes that back in one step", async () => {
    expect(marksOf(richEditor().getJSON())).toContain("#Usage guide|#Usage guide");
    await untilMdHas("[[#Usage guide]] typed");
    await key(richEditor().view.dom, "z", { ctrlKey: true });
    await until(() => marksOf(richEditor().getJSON()).includes("#Usage|#Usage"), "the undo");
    // Only the link came back: the typing beside it and the rename itself are
    // steps of their own.
    expect(richEditor().getText()).toContain("#Usage typed");
    expect(headingsFromDoc(richEditor().state.doc).map((h) => h.text)).toContain("Usage guide");
    await until(() => /\[\[#Usage\]\] typed/.test(mdText()), "the markdown pane to follow the undo");
  });

  it("the link index sees the rewritten notes", async () => {
    // Its copy of the library is what the next offer counts in: renaming the
    // heading again finds the links the update wrote (and not the one ⌘Z
    // took back, nor the skipped note).
    await until(() => useEditorStore.getState().linkIndex !== indexAtUpdate, "the link index to refresh");
    await tick(200);
    await retypeHeading("Usage guide", "Use");
    await leaveHeading("Use");
    await until(() => /Heading renamed — update 3 links in 2 notes to “Use”\?/.test(toastText()), "the offer for Usage guide → Use");
    await clickToast("“Use”", "Dismiss");
    await until(() => !offers().length, "the offer to close");
  });
});

describe("read-only", () => {
  it("Update refuses while read-only is on", async () => {
    await retypeHeading("Limits", "Constraints");
    await leaveHeading("Constraints");
    await until(() => /update 1 link in 1 note to “Constraints”/.test(toastText()), "the offer for Limits → Constraints");
    const before = json((await onDisk(adapter, "notes")).canonical);
    useUIStore.setState({ readOnly: true });
    await clickToast("Constraints", "Update");
    await until(() => /Read-only is on — no links were updated/.test(toastText()), "the refusal");
    await tick(300);
    expect(json((await onDisk(adapter, "notes")).canonical)).toBe(before);
    useUIStore.setState({ readOnly: false });
  });

  it("nothing is offered while read-only is on", async () => {
    await retypeHeading("Extra", "More");
    useUIStore.setState({ readOnly: true });
    await leaveHeading("More");
    await waitOutCheck();
    expect(offers()).toEqual([]);
    useUIStore.setState({ readOnly: false });
  });
});

describe("leaving the note asks too", () => {
  it("names the note just left, and Update rewrites the now-open note live and the left one on disk", async () => {
    // "Extra" → "More" was never offered (read-only). Opening "Notes" leaves
    // "Guide", which checks it.
    await click(document.querySelector('[role="tree"] [data-key="d:notes"] button'));
    await untilHydrated("notes");
    await until(
      () => /Heading renamed in “Guide” — update 2 links in 2 notes to “More”\?/.test(toastText()),
      "the offer for the note just left",
    );
    // Typed into the MARKDOWN pane a moment before Update, so its projection
    // into the rich pane is still pending: the rewrite must not lose it (and
    // it must not bring the old link back when it lands).
    await typeMd("\n\nwritten in the source pane");
    await clickToast("“More”", "Update");
    await until(() => /Updated 2 links/.test(toastText()), "the result");
    await tick(1000); // past any projection still scheduled (negative assertion)
    // "Notes" is open: its link was rewritten in the editor, not on disk.
    expect(marksOf(richEditor().getJSON())).toContain("Guide#More|Guide#More");
    expect(richEditor().getText()).toContain("written in the source pane");
    expect(mdText()).toContain("written in the source pane");
    expect(mdText()).toContain("[[Guide#More]]");
    // "Guide" is not: its own [[#Extra]] was rewritten on disk.
    expect(json((await onDisk(adapter, "guide")).canonical)).toContain("See [[#More]] below.");
  });
});

describe("every other way of leaving the note asks too", () => {
  const openGuide = async () => {
    await click(document.querySelector('[role="tree"] [data-key="d:guide"] button'));
    await untilHydrated("guide");
  };
  const unsavedPrompt = () =>
    until(() => [...document.querySelectorAll('[role="alertdialog"]')].find((d) => /unsaved changes/.test(d.textContent)), "the unsaved-changes prompt");
  const promptButton = (dialog, label) => [...dialog.querySelectorAll("button")].find((b) => b.textContent.trim() === label);

  it("New document", async () => {
    await openGuide();
    await retypeHeading("Appendix", "Annex"); // the caret never leaves the heading
    await click(screen.getByLabelText("New document"));
    await until(() => /Heading renamed in “Guide” — update 1 link in 1 note to “Annex”\?/.test(toastText()), "the offer on New document");
    await clickToast("“Annex”", "Update");
    await until(() => /Updated 1 link(?!s)/.test(toastText()), "the result");
    expect(json((await onDisk(adapter, "other")).canonical)).toContain("[[Guide#Annex]]");
  });

  it("closing it, having saved", async () => {
    await openGuide();
    await retypeHeading("Glossary", "Terms");
    await until(() => store().saveStatus === "editing", "the rename to be unsaved");
    await menuClick("File", "Close document");
    await click(promptButton(await unsavedPrompt(), "Save"));
    await until(() => /Heading renamed in “Guide” — update 1 link in 1 note to “Terms”\?/.test(toastText()), "the offer on close");
    await clickToast("“Terms”", "Dismiss");
    await until(() => !offers().length, "the offer to close");
  });

  it("closing it with the rename DISCARDED asks nothing — the links never broke", async () => {
    await openGuide();
    await retypeHeading("Index", "Contents");
    await until(() => store().saveStatus === "editing", "the rename to be unsaved");
    await menuClick("File", "Close document");
    await click(promptButton(await unsavedPrompt(), "Discard"));
    await until(() => store().activeDocId !== "guide", "the note to close");
    await waitOutCheck();
    expect(offers()).toEqual([]);
    expect(json((await onDisk(adapter, "guide")).canonical)).toContain('"text":"Index"');
  });

  it("importing a file", async () => {
    await openGuide();
    await retypeHeading("Credits", "Thanks");
    await pickFiles([new File(["# Imported\n\nimported body"], "imported.md", { type: "text/markdown" })]);
    await until(() => /Heading renamed in “Guide” — update 1 link in 1 note to “Thanks”\?/.test(toastText()), "the offer on import");
    await clickToast("“Thanks”", "Dismiss");
    await until(() => !offers().length, "the offer to close");
  });

  it("a host adding a document", async () => {
    // The host bridge's addDocuments leaves the open note through
    // prepareToLeaveActiveDoc alone — no document switch follows it.
    await openGuide();
    await retypeHeading("Sources", "References");
    await act(async () => { await handle.current.addDocuments([{ id: "hosted", markdown: "# Hosted\n\nhosted body" }]); });
    await until(() => /Heading renamed in “Guide” — update 1 link in 1 note to “References”\?/.test(toastText()), "the offer on addDocuments");
    await clickToast("“References”", "Dismiss");
    await until(() => !offers().length, "the offer to close");
  });
});
