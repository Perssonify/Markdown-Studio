import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";

/**
 * A092. `text-primary` is the bright accent FILL. As text it measures 1.7-1.9:1
 * on the light surfaces in the default amber palette — links, chips, the link
 * bubble's URL, Help labels, the Cards filters and the status bar all used it.
 * Text uses `text-primary-strong`, the text-tuned token (≥4.5:1 everywhere,
 * a11y-contrast.test.js).
 *
 * The one sanctioned use left is a DECORATIVE icon beside a text label (WCAG
 * 1.4.11 exempts it; the brand colour stays where it is ornament). So a bare
 * `text-primary` may only sit on a line that opens an icon element. A state-
 * bearing glyph — the open document's icon, a selection check — must use the
 * strong token too; those have been swapped.
 */

const UI = join(process.cwd(), "src/ui");
function files(dir = UI, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** A bare accent-fill text colour: `text-primary` or `text-primary/NN`, not
 *  `-foreground` / `-strong`. */
const BARE = /(?<![\w-])text-primary(?![\w-])/;

function iconNames(src) {
  const names = new Set(["Icon", "IconComponent"]);
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/g)) {
    for (const part of m[1].split(",")) {
      const local = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (local) names.add(local);
    }
  }
  return names;
}

describe("accent-coloured TEXT uses the text-tuned token", () => {
  it("leaves bare text-primary only on decorative icon elements", () => {
    const all = files();
    expect(all.length).toBeGreaterThan(30);
    const offenders = [];
    for (const p of all) {
      const src = readFileSync(p, "utf8");
      const icons = iconNames(src);
      // Blank block comments (keeping their newlines, so line numbers hold):
      // the prose explaining an old `text-primary` bug is not a use of it.
      const blanked = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
      blanked.split("\n").forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "");
        if (!BARE.test(code)) return;
        const tag = code.match(/<([A-Z][\w.]*)\b/)?.[1];
        const isIcon = tag && (icons.has(tag) || /Icon$/.test(tag) || tag.startsWith("Icons."));
        if (!isIcon) offenders.push(`${relative(process.cwd(), p)}:${i + 1}: ${line.trim().slice(0, 110)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the active-pane label reads the text token", () => {
    const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
    const rule = css.slice(css.indexOf("[data-pane-header][data-pane-focused] [data-pane-label] {"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("color: var(--primary-strong)");
  });
});
