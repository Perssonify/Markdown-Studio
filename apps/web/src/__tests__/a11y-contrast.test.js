import { readFileSync } from "fs";
import { join } from "path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

/**
 * A090 / A092 / A095 — the colour tokens, MEASURED.
 *
 * Every claim below was once false in this stylesheet:
 *  - the focus ring was a 30% ring in the bright accent (1.75:1 in amber);
 *  - `text-primary` in amber is 1.9:1 on white, so links and chips failed;
 *  - white on the blue / emerald fills was 3.0 / 2.6:1;
 *  - muted metadata sat at 4.0:1 on the muted surface before any alpha;
 *  - dark MONO left --primary-strong at the light theme's 12% grey (1.1:1),
 *    and dark violet / rose used their bright fills as text (3.1 / 3.8:1);
 *  - inside the panes, which carry their own `data-theme`, the palette-tuned
 *    values were lost entirely.
 *
 * Rather than restating numbers that go stale, this resolves the real
 * stylesheet: the top-level token rules are cascaded (specificity, then source
 * order) for each palette × theme, custom properties inherit from <html> into a
 * pane subtree, var() / color-mix() / hsl() are evaluated, and WCAG contrast is
 * computed. Change a token and this recomputes; break a pair and it fails.
 */

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
const root = postcss.parse(css);
/** Top-level rules only: tokens are never declared inside @layer/@media. */
const RULES = [];
root.each((n) => { if (n.type === "rule") RULES.push(n); });

// ── selector matching over the handful of compound selectors tokens use ──
const PART = /(:root|\.[\w-]+|\[[\w-]+(?:="[^"]*")?\])/g;
function matches(sel, el) {
  const s = sel.trim();
  const parts = s.match(PART);
  if (!parts || parts.join("") !== s) return false; // combinators / pseudo — not a token block
  return parts.every((p) => {
    if (p === ":root") return !!el.isRoot;
    if (p.startsWith(".")) return el.classes.includes(p.slice(1));
    const m = p.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
    return m[2] === undefined ? m[1] in el.attrs : el.attrs[m[1]] === m[2];
  });
}
const specificity = (sel) => (sel.trim().match(PART) || []).length; // all class-level

/** Cascade + inherit + substitute: the computed custom properties of `el`. */
function computeTokens(el, inherited = new Map()) {
  const declared = new Map();
  RULES.forEach((rule, order) => {
    for (const sel of rule.selectors) {
      if (!matches(sel, el)) continue;
      const spec = specificity(sel);
      rule.each((d) => {
        if (d.type !== "decl" || !d.prop.startsWith("--")) return;
        const prev = declared.get(d.prop);
        if (!prev || spec > prev.spec || (spec === prev.spec && order >= prev.order)) {
          declared.set(d.prop, { value: d.value, spec, order });
        }
      });
    }
  });
  const out = new Map(inherited);
  const done = new Set();
  const get = (name, stack = []) => {
    if (!declared.has(name) || done.has(name)) return out.get(name);
    if (stack.includes(name)) return undefined; // cycle → guaranteed-invalid
    const v = substitute(declared.get(name).value, (n) => get(n, [...stack, name]));
    out.set(name, v);
    done.add(name);
    return v;
  };
  for (const name of declared.keys()) get(name);
  return out;
}

/** Replace every var(--x, fallback) using `lookup`, recursively. */
function substitute(value, lookup) {
  let s = value;
  for (;;) {
    const i = s.indexOf("var(");
    if (i < 0) return s;
    let depth = 0, j = i + 3;
    for (; j < s.length; j++) {
      if (s[j] === "(") depth++;
      else if (s[j] === ")" && --depth === 0) break;
    }
    const inner = s.slice(i + 4, j);
    const comma = inner.indexOf(",");
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma < 0 ? undefined : inner.slice(comma + 1).trim();
    let v = lookup(name);
    if (v === undefined) v = fallback === undefined ? "" : substitute(fallback, lookup);
    s = s.slice(0, i) + v + s.slice(j + 1);
  }
}

// ── colour evaluation ────────────────────────────────────────────────────
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const f = (n) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
function parseColor(input) {
  const v = input.trim();
  let m;
  if ((m = v.match(/^#([0-9a-f]{6})$/i))) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  if ((m = v.match(/^#([0-9a-f]{3})$/i))) return [...m[1]].map((c) => parseInt(c + c, 16)).concat(1);
  if ((m = v.match(/^hsla?\((.*)\)$/i))) {
    const [main, alpha] = m[1].split("/");
    const nums = main.split(/[\s,]+/).filter(Boolean).map((x) => parseFloat(x));
    const a = alpha !== undefined ? parseFloat(alpha) : nums[3] ?? 1;
    return [...hslToRgb(nums[0], nums[1], nums[2]), a];
  }
  if ((m = v.match(/^color-mix\(in srgb,\s*(.+)\)$/i))) {
    // color-mix(in srgb, A p%, B) — the only form the tokens use.
    const args = splitTopLevel(m[1]);
    const [aPart, bPart] = args;
    const pm = aPart.match(/^(.*\S)\s+([\d.]+)%$/);
    const A = parseColor(pm ? pm[1] : aPart);
    const p = pm ? parseFloat(pm[2]) / 100 : 0.5;
    const B = parseColor(bPart);
    return [0, 1, 2].map((i) => A[i] * p + B[i] * (1 - p)).concat(1);
  }
  if (v === "white") return [255, 255, 255, 1];
  if (v === "black") return [0, 0, 0, 1];
  throw new Error(`unparsed colour: ${v}`);
}
function splitTopLevel(s) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "," && depth === 0) { out.push(s.slice(start, i).trim()); start = i + 1; }
  }
  out.push(s.slice(start).trim());
  return out;
}
const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ── the matrix ───────────────────────────────────────────────────────────
const PALETTES = [null, "amber", "blue", "violet", "emerald", "rose", "mono"];
const THEMES = ["light", "dark"];
const SURFACES = ["--background", "--card", "--muted", "--popover", "--accent", "--secondary"];

function contexts(palette, theme) {
  const html = {
    isRoot: true,
    classes: theme === "dark" ? ["pf-app", "dark"] : ["pf-app"],
    attrs: palette ? { "data-palette": palette } : {},
  };
  const htmlTokens = computeTokens(html);
  // A pane subtree: the markdown pane wrapper and the ProseMirror element carry
  // their own data-theme, which re-runs the theme block below <html>.
  const pane = { classes: [], attrs: { "data-theme": theme } };
  return { html: htmlTokens, pane: computeTokens(pane, htmlTokens) };
}

const color = (tokens, name) => {
  const v = tokens.get(name);
  if (!v) throw new Error(`${name} is not defined`);
  return parseColor(v);
};
const label = (palette, theme, ctx) => `${palette ?? "no palette (library)"} / ${theme} / ${ctx}`;

describe("resolver sanity", () => {
  it("reads the tokens it is supposed to be measuring", () => {
    const { html } = contexts("amber", "light");
    expect(html.get("--primary")).toMatch(/hsl\(44/);
    expect(contrast([255, 255, 255, 1], [0, 0, 0, 1])).toBeCloseTo(21, 5);
    // The known v1.77.0 failure, reproduced by the same arithmetic.
    expect(contrast(parseColor("hsl(44, 98%, 48%)"), [255, 255, 255, 1])).toBeLessThan(2);
  });
});

describe("accent text (--primary-strong) clears 4.5:1 on every surface — A092", () => {
  for (const palette of PALETTES) for (const theme of THEMES) {
    it(label(palette, theme, "root + pane"), () => {
      const ctx = contexts(palette, theme);
      for (const [where, tokens] of Object.entries(ctx)) {
        const fg = color(tokens, "--primary-strong");
        for (const s of SURFACES) {
          const r = contrast(fg, color(ctx.html, s));
          expect(r, `${label(palette, theme, where)}: --primary-strong on ${s} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
});

describe("the keyboard focus ring clears 3:1 on every surface — A090", () => {
  for (const palette of PALETTES) for (const theme of THEMES) {
    it(label(palette, theme, "root + pane"), () => {
      const ctx = contexts(palette, theme);
      for (const [where, tokens] of Object.entries(ctx)) {
        const ring = color(tokens, "--focus-ring");
        for (const s of SURFACES) {
          const r = contrast(ring, color(ctx.html, s));
          expect(r, `${label(palette, theme, where)}: focus ring on ${s} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(3);
        }
      }
    });
  }
});

describe("text on the accent fill clears 4.5:1 — A095", () => {
  for (const palette of PALETTES) for (const theme of THEMES) {
    it(label(palette, theme, "root"), () => {
      const { html } = contexts(palette, theme);
      const r = contrast(color(html, "--primary-foreground"), color(html, "--primary"));
      expect(r, `${label(palette, theme, "root")}: fg on fill = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("muted metadata and destructive text clear 4.5:1 — A095", () => {
  for (const theme of THEMES) {
    it(`${theme}: --muted-foreground on every surface, including the status bar`, () => {
      const { html } = contexts("amber", theme);
      const fg = color(html, "--muted-foreground");
      // The status bar is bg-muted/50 over the page background.
      const statusBar = over([...color(html, "--muted").slice(0, 3), 0.5], color(html, "--background"));
      for (const [name, bg] of [...SURFACES.map((s) => [s, color(html, s)]), ["status bar", statusBar]]) {
        const r = contrast(fg, bg);
        expect(r, `${theme}: muted-foreground on ${name} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${theme}: --destructive as text, and its foreground on the fill`, () => {
      const { html } = contexts("amber", theme);
      const red = color(html, "--destructive");
      for (const s of SURFACES) {
        const r = contrast(red, color(html, s));
        expect(r, `${theme}: destructive on ${s} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(color(html, "--destructive-foreground"), red)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("the focus indicator itself (A090)", () => {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("is a real 2px outline in --focus-ring, UNLAYERED so `outline-none` cannot beat it", () => {
    let found = null;
    root.each((n) => {
      if (n.type === "rule" && n.selector.includes(":focus-visible") && n.selector.includes(":not(.cm-content")) found = n;
    });
    expect(found, "no top-level :focus-visible rule").not.toBeNull();
    expect(found.parent.type).toBe("root"); // not inside @layer
    const decls = Object.fromEntries(found.nodes.filter((d) => d.type === "decl").map((d) => [d.prop, d.value]));
    expect(decls.outline).toMatch(/^2px solid var\(--focus-ring/);
    expect(decls["outline-offset"]).toBe("2px");
    // Scoped by hand to the editor's roots — a host page's focus styles are
    // not ours (the library build only scopes @layer base).
    expect(found.selector).toMatch(/^:where\(\.pf-app, \.perssonify-editor/);
  });

  it("survives forced-colors mode in system colours", () => {
    const block = code.slice(code.indexOf("@media (forced-colors: active)"));
    expect(block.length).toBeGreaterThan(0);
    const body = block.slice(0, block.indexOf("\n}\n"));
    expect(body).toMatch(/:focus-visible\s*\{\s*outline-color:\s*Highlight/);
    // States drawn with a background alone are restated in system colours.
    expect(body).toContain('[aria-pressed="true"]');
    expect(body).toContain('[aria-selected="true"]');
    expect(body).toContain("[data-highlighted]");
    expect(body).toContain('[data-slot="switch"][data-checked]');
    expect(body).toContain("forced-color-adjust: none");
  });
});
