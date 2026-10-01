/**
 * The pseudo-locale (`en-XA`): English run through a transform that keeps it
 * readable but unmistakable — every letter accented, the text lengthened by
 * about a third, the whole string bracketed. Under it, any plain English left
 * on screen is a string that escaped extraction; a clipped `]` or a missing
 * `[` is a label that cannot grow; `][` inside one phrase is a sentence
 * assembled from fragments, which a translator cannot reorder.
 *
 * `{placeholders}` and `<tag>…</tag>` markers pass through untouched, so
 * interpolation and rich formatting still work under it.
 */
import type { Message } from "./types";

const ACCENTS: Record<string, string> = {
  a: "á", b: "ƀ", c: "ç", d: "ð", e: "é", f: "ƒ", g: "ĝ", h: "ĥ", i: "î", j: "ĵ", k: "ķ", l: "ļ", m: "ɱ",
  n: "ñ", o: "ö", p: "þ", q: "ǫ", r: "ŕ", s: "š", t: "ţ", u: "û", v: "ṽ", w: "ŵ", x: "ẋ", y: "ý", z: "ž",
  A: "Á", B: "Ɓ", C: "Ç", D: "Ð", E: "É", F: "Ƒ", G: "Ĝ", H: "Ĥ", I: "Î", J: "Ĵ", K: "Ķ", L: "Ļ", M: "Ṁ",
  N: "Ñ", O: "Ö", P: "Þ", Q: "Ǫ", R: "Ŕ", S: "Š", T: "Ţ", U: "Û", V: "Ṽ", W: "Ŵ", X: "Ẋ", Y: "Ý", Z: "Ž",
};

/** Placeholders and rich-text markers, which must survive untouched. */
const PROTECTED = /(\{\w+\}|<\/?\w+>)/;

export function pseudoLocalize(text: string): string {
  if (!text) return text;
  let out = "";
  let letters = 0;
  text.split(PROTECTED).forEach((part, i) => {
    if (i % 2 === 1) {
      out += part;
      return;
    }
    for (const ch of part) {
      const accented = ACCENTS[ch];
      if (accented) letters++;
      out += accented ?? ch;
    }
  });
  // Translations run 30–40% longer than English; pad so layouts are tested
  // against that, not against the shortest language they will ever show.
  const pad = letters ? " " + "·".repeat(Math.max(1, Math.round(letters * 0.35))) : "";
  return `[${out}${pad}]`;
}

export function pseudoMessage(message: Message): Message {
  if (typeof message === "string") return pseudoLocalize(message);
  const out = { other: pseudoLocalize(message.other) } as Exclude<Message, string>;
  for (const form of ["zero", "one", "two", "few", "many"] as const) {
    const text = message[form];
    if (text !== undefined) out[form] = pseudoLocalize(text);
  }
  return out;
}
