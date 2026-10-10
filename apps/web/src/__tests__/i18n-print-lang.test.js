import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n";
import { _resetLocaleForTests } from "../i18n/core";
import { printHtmlDocument } from "../store/importExport/print-export";

/**
 * A099: Print / Save as PDF wrote `<html lang="en">` around every document.
 * What is printed is the DOCUMENT, whose language the app does not know — so,
 * like the HTML export, the page declares none, and in particular it does not
 * borrow the interface language (an English UI prints French notes too).
 */
afterEach(() => {
  vi.useRealTimers();
  for (const f of document.querySelectorAll("iframe")) f.remove();
  _resetLocaleForTests();
});

describe("the printed page's language", () => {
  it("is not declared, whatever the interface language", () => {
    vi.useFakeTimers();
    for (const locale of ["en", "en-XA"]) {
      setLocale(locale, { persist: false });
      printHtmlDocument("Doc", '<p dir="auto">Bonjour</p>');
      const doc = [...document.querySelectorAll("iframe")].at(-1).contentDocument;
      expect(doc.documentElement.hasAttribute("lang"), locale).toBe(false);
      // Blocks keep their own direction.
      expect(doc.body.innerHTML).toContain('dir="auto"');
    }
  });
});
