import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import { pseudoMessage } from "../i18n/pseudo";

/**
 * A099: the English catalog is the source of truth, so it must be exactly the
 * set of strings the code asks for — every key used exists (tsc checks typed
 * calls; this also catches a key smuggled past it as a plain string) and no
 * key is left behind when its last use goes (a dead key is a string someone
 * will translate for nothing).
 */

const ROOT = process.cwd();
const CATALOG_DIR = join(ROOT, "src/i18n/en");

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f !== "__tests__") walk(p, out);
    } else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

// Code that can use a key: all of src, minus the catalog itself and tests.
const code = walk(join(ROOT, "src"))
  .filter((p) => !p.startsWith(CATALOG_DIR + sep) && !p.endsWith(join("i18n", "en.ts")))
  .map((p) => ({ file: relative(ROOT, p).split(sep).join("/"), src: readFileSync(p, "utf8") }));
const allCode = code.map((c) => c.src).join("\n");

const keys = Object.keys(en);
const forms = (m) => (typeof m === "string" ? [m] : Object.values(m));

describe("the English catalog", () => {
  it("has entries", () => {
    expect(keys.length).toBeGreaterThan(900);
  });

  it("keeps every key in the module of its namespace", () => {
    for (const file of readdirSync(CATALOG_DIR)) {
      const ns = file.replace(/\.ts$/, "");
      const src = readFileSync(join(CATALOG_DIR, file), "utf8");
      const declared = [...src.matchAll(/^\s+"([^"]+)":/gm)].map((m) => m[1]);
      expect(declared.length, file).toBeGreaterThan(0);
      for (const k of declared) expect(k.startsWith(`${ns}.`), `${file}: ${k}`).toBe(true);
      // …and en.ts merges every module (a module it forgot would be dead).
      expect(readFileSync(join(ROOT, "src/i18n/en.ts"), "utf8")).toContain(`from "./en/${ns}"`);
    }
  });

  it("has no key that nothing uses", () => {
    const unused = keys.filter((k) => !allCode.includes(`"${k}"`));
    expect(unused).toEqual([]);
  });

  it("defines every key the code asks for", () => {
    const missing = [];
    for (const { file, src } of code) {
      for (const m of src.matchAll(/\bt(?:\.rich)?\(\s*"([a-z][A-Za-z]*\.[A-Za-z0-9.]+)"/g)) {
        if (!(m[1] in en)) missing.push(`${file}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("has no empty message and gives every plural an `other` form", () => {
    for (const [k, m] of Object.entries(en)) {
      if (typeof m === "string") expect(m.trim(), k).not.toBe("");
      else {
        expect(typeof m.other, k).toBe("string");
        for (const form of Object.keys(m)) expect(["zero", "one", "two", "few", "many", "other"], k).toContain(form);
      }
    }
  });

  it("writes placeholders and markup well-formed", () => {
    // Markup only means something in a message rendered with t.rich; anywhere
    // else "<palette>" is just text (a URL-parameter hint says exactly that).
    const rich = new Set([...allCode.matchAll(/\.rich\(\s*"([\w.]+)"/g)].map((m) => m[1]));
    expect(rich.size).toBeGreaterThan(5);
    for (const [k, m] of Object.entries(en)) {
      for (const text of forms(m)) {
        // Braces only as {name}.
        expect(text.replace(/\{\w+\}/g, ""), `${k}: stray brace`).not.toMatch(/[{}]/);
        if (!rich.has(k)) continue;
        // Tags only as matched <tag>…</tag> pairs.
        const open = [...text.matchAll(/<(\w+)>/g)].map((x) => x[1]);
        const close = [...text.matchAll(/<\/(\w+)>/g)].map((x) => x[1]);
        expect(close, `${k}: unbalanced markup`).toEqual(open);
      }
    }
  });

  it("uses the same placeholders in every plural form", () => {
    for (const [k, m] of Object.entries(en)) {
      if (typeof m === "string") continue;
      const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).filter((n) => n !== "count").sort();
      for (const text of forms(m)) expect(names(text), k).toEqual(names(m.other));
    }
  });

  it("survives the pseudo-locale with its placeholders intact", () => {
    const ph = (s) => [...s.matchAll(/\{\w+\}|<\/?\w+>/g)].map((x) => x[0]);
    for (const [k, m] of Object.entries(en)) {
      const p = pseudoMessage(m);
      if (typeof m === "string") expect(ph(p), k).toEqual(ph(m));
      else for (const form of Object.keys(m)) expect(ph(p[form]), `${k}.${form}`).toEqual(ph(m[form]));
    }
  });
});
