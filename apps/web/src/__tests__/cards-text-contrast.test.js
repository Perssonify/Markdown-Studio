/**
 * Dimmed text on a coloured card still reads (A095).
 *
 * The board dims secondary text — the note's metadata row, "+N more",
 * "Empty note", completed checklist items — with `opacity-*` over the card's
 * own colour. At 50–60% that measured 2.6–4.6:1; the dimmest pairing is light
 * text on the dark "Fog" card. This recomputes every text opacity CardsView
 * uses against every card colour, in both themes, from the real token values
 * (board-level text sits on plainer backgrounds, so the card colours are the
 * worst case for it too). Decorative glyphs (aria-hidden) are not text.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { CARD_COLORS } from "../store/cards/cards";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");

const hex = (h) => [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const over = (fg, bg, alpha) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));

/** `--card-foreground: hsl(0deg 0% L%)` for the light (first) and dark (second) theme. */
function cardForegrounds() {
  const values = [...read("src/styles.css").matchAll(/--card-foreground:\s*hsl\(0deg 0% ([\d.]+)%\)/g)].map((m) => Number(m[1]) / 100);
  expect(values.length).toBeGreaterThanOrEqual(2);
  return { light: [values[0], values[0], values[0]], dark: [values[1], values[1], values[1]] };
}

/** Opacity of every TEXT element CardsView dims (a text-size class beside an opacity class). */
function textOpacities() {
  const found = new Set();
  for (const line of read("src/ui/cards/cardsView/index.tsx").split("\n")) {
    if (!/text-(?:xs|sm|\[\d+px\])|line-through/.test(line) || /aria-hidden/.test(line)) continue;
    for (const m of line.matchAll(/(?<![:\w-])opacity-(\d+)\b/g)) found.add(Number(m[1]) / 100);
  }
  return [...found];
}

describe("dimmed card text", () => {
  it("keeps 4.5:1 on every card colour in both themes", () => {
    const fg = cardForegrounds();
    const opacities = textOpacities();
    expect(opacities.length).toBeGreaterThan(0);
    const failures = [];
    for (const alpha of opacities) {
      for (const c of CARD_COLORS.filter((c) => c.light)) {
        for (const theme of ["light", "dark"]) {
          const bg = hex(c[theme]);
          const ratio = contrast(over(fg[theme], bg, alpha), bg);
          if (ratio < 4.5) failures.push(`${c.label}/${theme} at ${alpha}: ${ratio.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
