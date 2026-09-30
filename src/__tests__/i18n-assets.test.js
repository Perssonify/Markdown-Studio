import { afterEach, describe, expect, it } from "vitest";
import { setLocale, _registerLocaleForTests, _resetLocaleForTests } from "../i18n/core";
import { PSEUDO_LOCALE } from "../i18n";
import { missingImagesNote } from "../store/assets";
import { missingImageAlt, missingImageTitle, missingSvg } from "../extensions/AssetImages";

/**
 * The stored-image strings (A086) sit in plain functions and an SVG data URL,
 * where the i18n scanner cannot see them, so this pins that they go through
 * the catalog (A099) — and that they are read when USED: the placeholder SVG
 * and title were module-load constants, which would have stayed English.
 */
describe("stored-image strings follow the interface language", () => {
  afterEach(() => _resetLocaleForTests());

  it("English is unchanged", () => {
    expect(missingImagesNote(0)).toBeNull();
    expect(missingImagesNote(1)).toBe("1 image is not stored in this browser and could not be included");
    expect(missingImagesNote(3, { inArchive: true })).toBe(
      "3 images are not stored in this browser and could not be included in this export",
    );
    expect(missingImageAlt("chart")).toBe("Image unavailable: chart");
    expect(missingImageAlt("")).toBe("Image unavailable");
    expect(missingImageTitle()).toBe(
      "Image unavailable — it is not stored in this browser (restore the backup it came from to bring it back)",
    );
    expect(decodeURIComponent(missingSvg())).toContain(">Image unavailable</text>");
  });

  it("is read at call time, so it switches with the locale", () => {
    const english = [missingImagesNote(2), missingImageAlt("chart"), missingImageTitle(), missingSvg()];
    expect(setLocale(PSEUDO_LOCALE, { persist: false })).toBe(true);
    const pseudo = [missingImagesNote(2), missingImageAlt("chart"), missingImageTitle(), missingSvg()];
    pseudo.forEach((text, i) => expect(text).not.toBe(english[i]));
    // The alt keeps the document's own text verbatim: only the frame is translated.
    expect(missingImageAlt("chart")).toContain("chart");
  });

  it("escapes a translation inside the placeholder SVG", () => {
    // The SVG is markup: a translation holding < or & must not break it.
    const undo = _registerLocaleForTests({
      id: "x-test", name: "Test", dir: "ltr",
      messages: { "panes.imageUnavailable": "Bild <fehlt> & weg" },
    });
    try {
      expect(setLocale("x-test", { persist: false })).toBe(true);
      const svg = decodeURIComponent(missingSvg());
      expect(svg).toContain(">Bild &lt;fehlt&gt; &amp; weg</text>");
      const doc = new DOMParser().parseFromString(svg.slice(svg.indexOf("<svg")), "image/svg+xml");
      expect(doc.querySelector("parsererror")).toBeNull();
      expect(doc.querySelector("text")?.textContent).toBe("Bild <fehlt> & weg");
    } finally {
      undo();
    }
  });
});
