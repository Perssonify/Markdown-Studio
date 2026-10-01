import { describe, expect, it } from "vitest";
import { roundTrip } from "./converter-harness";

/**
 * A stored image's reference round-trips through BOTH panes (A086), through
 * the real engine and schema: plain, sized (the `<img width>` tag), with a
 * theme fragment, and inside a theme `<picture>`, in Styled and Clean mode.
 */

const H = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const REF = `pf-asset:${H}`;
const imgs = (json) => {
  const out = [];
  const walk = (n) => { if (!n) return; if (n.type === "image" || n.type === "themeImage") out.push(n.attrs); (n.content || []).forEach(walk); };
  walk(json);
  return out;
};

describe("pf-asset references round-trip through the panes", () => {
  for (const mode of ["styled", "clean"]) {
    it(`a plain image (${mode})`, () => {
      const r = roundTrip(`Text\n\n![A chart](${REF})\n`, { mode });
      expect(imgs(r.json1)[0]).toMatchObject({ src: REF, alt: "A chart" });
      expect(r.md1).toContain(`![A chart](${REF})`);
      expect(r.md2).toBe(r.md1);
    });

    it(`a sized image keeps its size (${mode})`, () => {
      const r = roundTrip(`<img src="${REF}" alt="Logo" width="84" />\n`, { mode });
      expect(imgs(r.json1)[0]).toMatchObject({ src: REF, alt: "Logo", width: "84" });
      expect(imgs(r.json2)[0]).toMatchObject({ src: REF, width: "84" });
      expect(r.md2).toBe(r.md1);
    });

    it(`a theme fragment survives (${mode})`, () => {
      const r = roundTrip(`![dark](${REF}#gh-dark-mode-only)\n`, { mode });
      expect(imgs(r.json2)[0].src).toBe(`${REF}#gh-dark-mode-only`);
    });
  }

  it("a theme <picture> made of references", () => {
    const light = REF;
    const dark = `pf-asset:${"1".repeat(64)}`;
    const md = `<picture><source media="(prefers-color-scheme: dark)" srcset="${dark}"><source media="(prefers-color-scheme: light)" srcset="${light}"><img src="${light}" alt="Mark"></picture>\n`;
    const r = roundTrip(md);
    expect(imgs(r.json1)[0]).toMatchObject({ lightSrc: light, darkSrc: dark, alt: "Mark" });
    expect(imgs(r.json2)[0]).toMatchObject({ lightSrc: light, darkSrc: dark });
  });
});
