import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { getLocale, PSEUDO_LOCALE, setLocale } from "../i18n";
import { _registerLocaleForTests, _resetLocaleForTests } from "../i18n/core";
import { useDocumentStore } from "../store/documentStore";
import { useUIStore } from "../store/uiStore";

/**
 * A099, end to end: the REAL app under the pseudo-locale. Every string the
 * interface shows comes out of the catalog accented and bracketed, so any
 * plain English word left on these surfaces is a string that escaped
 * extraction — the scanner looks at source code, this looks at the screen.
 *
 * What may legitimately stay English: DATA (document titles and folder names,
 * which are content), the product name, and key names in shortcut hints
 * ("Ctrl+Shift+K" on this platform).
 */

const ATTRS = ["aria-label", "aria-description", "title", "placeholder", "alt", "aria-valuetext"];
const KEY_NAMES = new Set(["Ctrl", "Shift", "Alt", "Esc", "Tab", "Enter", "Home", "End", "Cmd"]);
const tick = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  globalThis.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const rect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 });
  Range.prototype.getClientRects ??= function () { return Object.assign([], { item: () => null }); };
  Range.prototype.getBoundingClientRect ??= rect;
  document.elementFromPoint ??= () => null;
  // The first-run tour starts on its own after a beat; keep it out of the way.
  localStorage.setItem("pf:tour-seen-v1", "1");
});
afterAll(() => {
  cleanup();
  _resetLocaleForTests();
  document.documentElement.lang = "en";
  document.documentElement.removeAttribute("dir");
});

/** Words a surface shows that did not come from the catalog. */
function rawEnglish(root, allowedWords) {
  const found = new Set();
  const check = (text, where) => {
    // Pseudo-localised spans are bracketed; take them out and look at the rest.
    const rest = text.replace(/\[[^\]]*\]/g, " ");
    for (const word of rest.match(/[A-Za-z]{2,}/g) ?? []) {
      if (!allowedWords.has(word) && !KEY_NAMES.has(word)) found.add(`${where}: ${JSON.stringify(text)}`);
    }
  };
  const walk = (node) => {
    if (node.nodeType === 3) return check(node.data, node.parentElement?.tagName.toLowerCase() ?? "#text");
    if (node.nodeType !== 1) return;
    const el = node;
    // The document itself is content. A language's name is written in that
    // language (Settings ▸ Language), so an element in another `lang` is too.
    // The generated sheet primitive's screen-reader "Close" is a known gap
    // (src/components/ui/* is regenerated, not hand-edited — docs/i18n.md).
    if (el.matches(".ProseMirror, .cm-editor, style, script, svg text, option[lang], [data-slot='sheet-close']")) return;
    for (const a of ATTRS) if (el.hasAttribute(a)) check(el.getAttribute(a), `@${a}`);
    for (const c of el.childNodes) walk(c);
  };
  walk(root);
  return [...found];
}

describe("the app under the pseudo-locale (en-XA)", () => {
  // One test: testing-library unmounts after each `it`, and the app is the
  // expensive part. Every surface is checked; the failure names them all.
  it("shows the interface — and only the interface — pseudo-localised", async () => {
    setLocale(PSEUDO_LOCALE, { persist: false });
    await act(async () => { render(<App />); });
    for (let i = 0; i < 150 && !document.querySelector('[data-tour="menubar"]'); i++) await tick();
    for (let i = 0; i < 100 && !useDocumentStore.getState().hydratedDocId; i++) await tick();
    await tick(300);

    // lang/dir on the page and on the app shell.
    expect(getLocale()).toBe(PSEUDO_LOCALE);
    expect(document.documentElement.lang).toBe(PSEUDO_LOCALE);
    expect(document.documentElement.dir).toBe("ltr");
    const shell = document.querySelector(".pf-shell");
    expect(shell.getAttribute("lang")).toBe(PSEUDO_LOCALE);
    expect(shell.getAttribute("dir")).toBe("ltr");

    // Data a surface may show verbatim: document titles, folder names, the product name.
    const words = new Set(["Markdown", "Studio", "Perssonify"]);
    const state = useDocumentStore.getState();
    for (const d of state.documents) for (const w of (d.title ?? "").match(/[A-Za-z]{2,}/g) ?? []) words.add(w);
    for (const f of state.folders ?? []) for (const w of (f.name ?? "").match(/[A-Za-z]{2,}/g) ?? []) words.add(w);

    const leaks = {};
    const inspect = (name, el) => {
      expect(el, name).not.toBeNull();
      // It must actually be showing translated text, not just nothing at all.
      expect(el.textContent + [...el.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")).join(""), name).toMatch(/[áéîöûñçšž]/);
      const found = rawEnglish(el, words);
      if (found.length) leaks[name] = found;
    };
    inspect("menu bar", document.querySelector('[data-tour="menubar"]'));
    inspect("toolbar", document.querySelector('[data-tour="toolbar"]'));
    await act(async () => { useUIStore.setState({ showSidebar: true }); });
    await tick(100);
    inspect("workspace panel", document.querySelector('[data-tour="workspace"]'));
    inspect("status bar", document.querySelector("footer"));

    // An open menu (portalled to <body>).
    await act(async () => { fireEvent.click(document.querySelector('[data-tour="menus"] button')); });
    await tick();
    inspect("File menu", document.querySelector('[role="menu"]'));
    await act(async () => { fireEvent.keyDown(document.querySelector('[role="menu"]'), { key: "Escape" }); });
    await tick();

    // The Settings sheet.
    await act(async () => { fireEvent.click(document.querySelector('[data-tour="settings"]')); });
    await tick(150);
    inspect("Settings", document.querySelector('[role="dialog"]'));

    expect(leaks).toEqual({});

    // …and back to English live, without a reload.
    await act(async () => { setLocale("en", { persist: false }); });
    await tick();
    expect(document.documentElement.lang).toBe("en");
    const menubar = document.querySelector('[data-tour="menubar"]');
    expect(menubar.textContent).toContain("File");
    expect(menubar.textContent).not.toMatch(/[[\]]/);
  }, 60_000);
});

describe("a right-to-left interface language", () => {
  it("turns the page and the app shell right-to-left", async () => {
    cleanup();
    const undo = _registerLocaleForTests({ id: "ar", name: "العربية", dir: "rtl", messages: { "common.cancel": "إلغاء" } });
    try {
      setLocale("ar", { persist: false });
      await act(async () => { render(<App />); });
      await tick(100);
      expect(document.documentElement.lang).toBe("ar");
      expect(document.documentElement.dir).toBe("rtl");
      expect(document.querySelector(".pf-shell").getAttribute("dir")).toBe("rtl");
    } finally {
      cleanup();
      undo();
      _resetLocaleForTests();
      vi.restoreAllMocks();
    }
  }, 30_000);
});
