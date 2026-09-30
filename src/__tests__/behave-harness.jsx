/**
 * Shared rig for the behave-* suites (A108): the REAL editor, mounted in jsdom
 * over a MemoryStorageAdapter, driven the way a user drives it and judged by
 * what a user would see — documents on "disk" (the adapter), DOM text, the
 * files a download would have produced, and store state.
 *
 * ONE MOUNT PER TEST FILE. The stores are module singletons that keep the
 * storage adapter of the first mount (see persistence-remount-blank.test.jsx),
 * so a file mounts once in `beforeAll` and its cases run as one sequential
 * journey against that editor. The suites import from
 * `@testing-library/react/pure` for that reason: the default entry unmounts
 * after every case.
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react/pure";
import { EditorView } from "@codemirror/view";
import { PerssonifyEditor } from "../PerssonifyEditor";
import { MemoryStorageAdapter } from "../store/storage-adapter";
import { createDocument } from "../store/document";
import { useDocumentStore } from "../store/documentStore";

/** Layout and platform APIs a browser has and jsdom lacks. Installed only
 *  where missing, so a jsdom that grows a real one keeps it. */
export function installBrowserStubs() {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia ??= (q) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
  });
  const rect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 });
  Range.prototype.getClientRects ??= function () { return Object.assign([], { item: () => null }); };
  Range.prototype.getBoundingClientRect ??= rect;
  document.elementFromPoint ??= () => null;
  // Heading navigation scrolls the heading into view; record where it went.
  if (!Element.prototype.scrollIntoView || !Element.prototype.scrollIntoView.__behave) {
    const fn = function scrollIntoView() { scrolledTo.push(this); };
    fn.__behave = true;
    Element.prototype.scrollIntoView = fn;
  }
  // The copy actions write to the clipboard.
  if (!navigator.clipboard || !navigator.clipboard.__behave) {
    const clip = {
      __behave: true,
      text: "",
      writeText: async (t) => { clip.text = String(t); },
      readText: async () => clip.text,
    };
    Object.defineProperty(navigator, "clipboard", { value: clip, configurable: true });
  }
}
/** Elements scrollIntoView() was called on, oldest first. */
export const scrolledTo = [];

/**
 * Every download the page starts (`downloadBlob`: an object URL clicked through
 * an <a download>). Returns the list and a `read(i)` that yields the file text.
 */
export function captureDownloads() {
  const files = [];
  const blobs = new Map();
  let n = 0;
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  const origClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = (blob) => { const url = `blob:behave/${++n}`; blobs.set(url, blob); return url; };
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function click() {
    if (this.download) files.push({ name: this.download, blob: blobs.get(this.getAttribute("href")) });
    else return origClick.call(this);
  };
  return {
    files,
    last: () => files[files.length - 1],
    named: (re) => files.filter((f) => re.test(f.name)),
    restore() {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
      HTMLAnchorElement.prototype.click = origClick;
    },
  };
}

export function readBlobText(blob) {
  if (typeof blob.text === "function") return blob.text();
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsText(blob);
  });
}
export function readBlobBytes(blob) {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsArrayBuffer(blob);
  });
}

export const tick = (ms = 50) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

/** Poll (never sleep) until `fn()` is truthy; returns its value. Throws with
 *  `what` when it never becomes true, so a failure names what was awaited. */
export async function until(fn, what = "condition", { timeout = 8000, step = 25 } = {}) {
  const start = Date.now();
  let last;
  for (;;) {
    try { last = await fn(); } catch (e) { last = undefined; }
    if (last) return last;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${what}`);
    await tick(step);
  }
}

export const para = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
export const heading = (level, text) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
export const docOf = (...blocks) => ({ type: "doc", content: blocks });
export const textOf = (c) => JSON.stringify(c ?? null);

/** A stored document, created the way the app creates one. */
export function storedDoc(id, title, blocks, extra = {}) {
  return createDocument({ id, title, canonical: docOf(...blocks), ...extra });
}

/** The in-memory adapter, plus the preferences it drops on the floor — so the
 *  suites can seed a preference and see the editor write them back. */
export class PrefsMemoryAdapter extends MemoryStorageAdapter {
  prefs = {};
  async getPrefs() { return { ...this.prefs }; }
  async setPrefs(p) { this.prefs = { ...this.prefs, ...p }; }
}

export async function seededAdapter(docs = [], { prefs } = {}) {
  const adapter = new PrefsMemoryAdapter();
  if (prefs) adapter.prefs = { ...prefs };
  for (const d of docs) await adapter.save(d);
  return adapter;
}

/** Mount the real editor once. */
export async function mountEditor(props) {
  let r;
  await act(async () => { r = render(<PerssonifyEditor {...props} />); });
  await until(() => document.querySelector(".perssonify-editor"), "the editor shell");
  return r;
}

export const store = () => useDocumentStore.getState();
export const richEditor = () => document.querySelector(".ProseMirror")?.editor ?? null;
export function mdView() {
  const el = document.querySelector(".cm-editor");
  return el ? EditorView.findFromDOM(el) : null;
}
export const mdText = () => mdView()?.state.doc.toString() ?? "";

export async function untilHydrated(id) {
  await until(() => store().hydratedDocId === id && store().activeDocId === id && richEditor(), `document ${id} to be open`);
  await tick(50);
}

/** Type into the rich pane at the end of the document, as keystrokes would. */
export async function typeRich(text) {
  const ed = richEditor();
  await act(async () => {
    ed.view.dispatch(ed.state.tr.insertText(text, ed.state.doc.content.size - 1));
  });
}

/** Type into the markdown pane at the end of the document. */
export async function typeMd(text) {
  const v = mdView();
  await act(async () => {
    v.dispatch({ changes: { from: v.state.doc.length, insert: text }, userEvent: "input.type" });
  });
}

/** Wait until both panes agree the markdown pane shows `needle`. */
export const untilMdHas = (needle) => until(() => mdText().includes(needle), `the markdown pane to show "${needle}"`);
export const untilRichHas = (needle) => until(() => (richEditor()?.getText() ?? "").includes(needle), `the rich pane to show "${needle}"`);

/** A document on disk, or null. */
export const onDisk = (adapter, id) => adapter.get(id).catch(() => null);

export const key = (el, k, opts = {}) => act(async () => { fireEvent.keyDown(el, { key: k, ...opts }); });
export const click = (el) => act(async () => { fireEvent.click(el); });

/** Visible toast text (sonner renders into the page). */
export const toastText = () => [...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.textContent).join(" | ");

/** The open menu item labelled `label`: an exact match first, then a prefix,
 *  then anywhere in the text (a checkbox item carries its indicator). */
export function findMenuItem(label) {
  const items = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')];
  const t = (m) => m.textContent.trim();
  return items.find((m) => t(m) === label) ?? items.find((m) => t(m).startsWith(label)) ?? items.find((m) => t(m).includes(label)) ?? null;
}

/** Open a Base UI menu from its trigger and click an item by its text. */
export async function menuClick(triggerText, ...path) {
  const trigger = [...document.querySelectorAll("button, [role=menuitem]")].find((b) => b.textContent.trim() === triggerText);
  if (!trigger) throw new Error(`No menu trigger "${triggerText}"`);
  await act(async () => { fireEvent.click(trigger); });
  // A click while another popup is still up (a sheet that just closed, the
  // previous menu) only dismisses that one — open it again if nothing showed.
  const opened = await until(() => document.querySelector('[role="menu"]'), "a menu", { timeout: 800 }).catch(() => null);
  if (!opened) await act(async () => { fireEvent.click(trigger); });
  for (let i = 0; i < path.length; i++) {
    const label = path[i];
    const item = await until(() => findMenuItem(label), `menu item "${label}"`).catch((e) => {
      const seen = [...document.querySelectorAll('[role^="menuitem"]')].map((m) => `${m.getAttribute("role")}:${m.textContent.trim()}`);
      throw new Error(`${e.message}; open items: ${seen.join(" / ") || "(none)"}`);
    });
    const isLast = i === path.length - 1;
    await act(async () => {
      if (isLast) fireEvent.click(item);
      else {
        // A submenu opens on hover or click (Base UI); do both.
        fireEvent.mouseEnter(item);
        fireEvent.pointerEnter?.(item);
        fireEvent.click(item);
      }
    });
    await tick(20);
  }
}

export { act, fireEvent };
