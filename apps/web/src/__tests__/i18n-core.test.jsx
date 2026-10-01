import React, { memo, useMemo } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  availableLocales,
  formatMessage,
  getLocale,
  LOCALE_PREF_KEY,
  localizedContent,
  PSEUDO_LOCALE,
  renderRich,
  setLocale,
  subscribeLocale,
  t,
  useT,
} from "../i18n";
import { _registerLocaleForTests, _resetLocaleForTests } from "../i18n/core";
import { pseudoLocalize } from "../i18n/pseudo";
import { _setDevBuildForTests } from "../utils/build-gates";

/**
 * A099: the interface translation layer (src/i18n). English is the source of
 * truth and costs one property read; other languages fall back to it key by
 * key; the language is the stored preference, then the browser's, then English.
 */

let undo = [];
function register(info) {
  undo.push(_registerLocaleForTests({ dir: "ltr", messages: {}, ...info }));
}
function browserLanguage(tag) {
  const spy = vi.spyOn(window.navigator, "language", "get").mockReturnValue(tag);
  undo.push(() => spy.mockRestore());
}

beforeEach(() => {
  localStorage.clear();
  _resetLocaleForTests();
});
afterEach(() => {
  for (const fn of undo.reverse()) fn();
  undo = [];
  _setDevBuildForTests(true);
  localStorage.clear();
  _resetLocaleForTests();
});

describe("messages", () => {
  it("returns English from the catalog", () => {
    expect(getLocale()).toBe("en");
    expect(t("common.cancel")).toBe("Cancel");
    expect(t("pages.helpTitle", { app: "Markdown Studio" })).toBe("Markdown Studio Help");
  });

  it("fills placeholders, stringifies numbers and leaves unknown ones visible", () => {
    expect(formatMessage("{a} and {b}", { a: "x", b: 2 })).toBe("x and 2");
    expect(formatMessage("{a} and {missing}", { a: "x" })).toBe("x and {missing}");
    expect(formatMessage("no vars {a}")).toBe("no vars {a}");
    // A value is inserted once, never re-scanned for placeholders.
    expect(formatMessage("{a}{b}", { a: "{b}", b: "!" })).toBe("{b}!");
  });

  it("picks English plural forms the way CLDR does (1 → one, everything else → other)", () => {
    const m = { one: "{count} note", other: "{count} notes" };
    expect(formatMessage(m, { count: 1 })).toBe("1 note");
    expect(formatMessage(m, { count: 0 })).toBe("0 notes");
    expect(formatMessage(m, { count: 2 })).toBe("2 notes");
    expect(formatMessage(m, { count: 1.5 })).toBe("1.5 notes");
    expect(formatMessage(m, {})).toBe("{count} notes");
  });

  it("lets an explicit zero form win for exactly 0", () => {
    const m = { zero: "No links", one: "{count} link", other: "{count} links" };
    expect(formatMessage(m, { count: 0 })).toBe("No links");
    expect(formatMessage(m, { count: 1 })).toBe("1 link");
  });

  it("uses the language's own plural rules (Polish: one / few / many / other)", () => {
    register({
      id: "pl",
      name: "Polski",
      messages: { "pages.noHelpMatches": { one: "{count} plik", few: "{count} pliki", many: "{count} plików", other: "{count} pliku" } },
    });
    setLocale("pl");
    expect(t("pages.noHelpMatches", { count: 1 })).toBe("1 plik");
    expect(t("pages.noHelpMatches", { count: 3 })).toBe("3 pliki");
    expect(t("pages.noHelpMatches", { count: 5 })).toBe("5 plików");
    expect(t("pages.noHelpMatches", { count: 1.5 })).toBe("1.5 pliku");
  });

  it("falls back to English, key by key, where a catalog has no translation", () => {
    register({ id: "fr", name: "Français", messages: { "common.cancel": "Annuler" } });
    setLocale("fr");
    expect(t("common.cancel")).toBe("Annuler");
    expect(t("common.close")).toBe("Close");
  });
});

describe("choosing the language", () => {
  it("follows the browser when nothing is stored, by exact tag or base language", () => {
    register({ id: "fr", name: "Français" });
    browserLanguage("fr-CA");
    expect(getLocale()).toBe("fr");
  });

  it("uses English for a browser language without a catalog", () => {
    browserLanguage("de-DE");
    expect(getLocale()).toBe("en");
  });

  it("prefers the stored choice over the browser", () => {
    register({ id: "fr", name: "Français" });
    browserLanguage("fr-FR");
    localStorage.setItem(LOCALE_PREF_KEY, "en");
    expect(getLocale()).toBe("en");
  });

  it("ignores a stored language this build cannot show", () => {
    localStorage.setItem(LOCALE_PREF_KEY, "tlh");
    expect(getLocale()).toBe("en");
  });

  it("persists a choice, and only when asked to", () => {
    expect(setLocale(PSEUDO_LOCALE)).toBe(true);
    expect(localStorage.getItem(LOCALE_PREF_KEY)).toBe(PSEUDO_LOCALE);
    _resetLocaleForTests();
    expect(getLocale()).toBe(PSEUDO_LOCALE);

    localStorage.clear();
    _resetLocaleForTests();
    setLocale(PSEUDO_LOCALE, { persist: false });
    expect(getLocale()).toBe(PSEUDO_LOCALE);
    expect(localStorage.getItem(LOCALE_PREF_KEY)).toBeNull();
  });

  it("refuses a language without a catalog and changes nothing", () => {
    expect(setLocale("tlh")).toBe(false);
    expect(getLocale()).toBe("en");
    expect(localStorage.getItem(LOCALE_PREF_KEY)).toBeNull();
  });

  it("offers the pseudo-locale in development builds only", () => {
    expect(availableLocales().map((l) => l.id)).toEqual(["en", PSEUDO_LOCALE]);
    _setDevBuildForTests(false);
    expect(availableLocales().map((l) => l.id)).toEqual(["en"]);
    // "en-XA" is then just a regional English tag: it resolves to English.
    setLocale(PSEUDO_LOCALE, { persist: false });
    expect(getLocale()).toBe("en");
    localStorage.setItem(LOCALE_PREF_KEY, PSEUDO_LOCALE);
    _resetLocaleForTests();
    expect(getLocale()).toBe("en");
  });

  it("notifies subscribers once per actual change", () => {
    const fn = vi.fn();
    const off = subscribeLocale(fn);
    setLocale("en");
    expect(fn).not.toHaveBeenCalled();
    setLocale(PSEUDO_LOCALE);
    setLocale(PSEUDO_LOCALE);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    setLocale("en");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("the pseudo-locale", () => {
  it("accents, lengthens and brackets text", () => {
    const out = pseudoLocalize("Save changes");
    expect(out).toMatch(/^\[.*\]$/);
    expect(out).not.toMatch(/[A-Za-z]/);
    expect(out.length).toBeGreaterThanOrEqual(Math.round("Save changes".length * 1.3));
  });

  it("keeps placeholders and markup intact", () => {
    expect(pseudoLocalize("{count} <b>notes</b> in {folder}")).toMatch(/^\[\{count\} <b>ñöţéš<\/b> îñ \{folder\} ·+\]$/);
  });

  it("still interpolates and pluralises", () => {
    setLocale(PSEUDO_LOCALE);
    expect(t("pages.helpTitle", { app: "Markdown Studio" })).toMatch(/^\[Markdown Studio Ĥéļþ ·+\]$/);
  });
});

describe("React", () => {
  it("re-renders a subscribed component, even behind memo, when the language changes", () => {
    let renders = 0;
    const Label = memo(function Label() {
      const tr = useT();
      renders++;
      return <span>{tr("common.cancel")}</span>;
    });
    const { container } = render(<Label />);
    expect(container.textContent).toBe("Cancel");
    act(() => { setLocale(PSEUDO_LOCALE); });
    expect(container.textContent).toMatch(/^\[Çáñçéļ ·+\]$/);
    expect(renders).toBe(2);
  });

  it("hands out a translate function whose identity changes exactly with the language", () => {
    const seen = [];
    function Probe() {
      const tr = useT();
      seen.push(tr);
      const label = useMemo(() => tr("common.close"), [tr]);
      return <span>{label}</span>;
    }
    const { container, rerender } = render(<Probe />);
    rerender(<Probe />);
    expect(seen[0]).toBe(seen[1]);
    act(() => { setLocale(PSEUDO_LOCALE); });
    expect(seen.at(-1)).not.toBe(seen[0]);
    // A memo keyed on `t` recomputes on the switch.
    expect(container.textContent).toMatch(/^\[Çļöšé ·+\]$/);
  });

  it("renders markup in a message without splitting the sentence", () => {
    const { container } = render(
      <p>{renderRich("Stored in <b>this browser</b>, {n} times: {icon}.", { b: (s) => <strong>{s}</strong>, n: 3, icon: <i>*</i> })}</p>,
    );
    expect(container.innerHTML).toBe("<p>Stored in <strong>this browser</strong>, 3 times: <i>*</i>.</p>");
  });

  it("treats a value that looks like markup as text", () => {
    const { container } = render(<p>{renderRich("Open {title}", { title: "<b>x</b> {n}", b: (s) => <strong>{s}</strong> })}</p>);
    expect(container.textContent).toBe("Open <b>x</b> {n}");
    expect(container.querySelector("strong")).toBeNull();
  });

  it("keeps a tag's words when no element is supplied for it", () => {
    const { container } = render(<p>{renderRich("A <b>bold</b> claim")}</p>);
    expect(container.innerHTML).toBe("<p>A bold claim</p>");
  });

  it("supports t.rich on catalog messages", () => {
    function Probe() {
      const tr = useT();
      return <p>{tr.rich("pages.aboutVersion", { version: "1.2.3", brand: "B", b: (s) => <em>{s}</em> })}</p>;
    }
    const { container } = render(<Probe />);
    expect(container.innerHTML).toBe("<p>Version 1.2.3 · <em>B</em></p>");
  });
});

describe("localized content", () => {
  const content = { en: "hello", fr: "bonjour" };
  it("picks the exact language, then the base language, then English", () => {
    expect(localizedContent(content, "fr")).toBe("bonjour");
    expect(localizedContent(content, "fr-CA")).toBe("bonjour");
    expect(localizedContent(content, "de")).toBe("hello");
    expect(localizedContent(content, PSEUDO_LOCALE)).toBe("hello");
  });
});
