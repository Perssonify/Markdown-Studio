import { readFileSync } from "fs";
import { join } from "path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

/**
 * A091. At 400% zoom on a 1366×768 screen the viewport is 192 CSS px tall and
 * the chrome alone is ~206px. The viewport-locked shell (h-dvh + overflow
 * hidden) gave the editor ZERO height and clipped the status bar and Settings
 * out of reach (WCAG 1.4.10). Below ~450px of height the standalone shell now
 * lets the PAGE scroll, with the editor row one full viewport tall.
 *
 * jsdom cannot evaluate a media query or lay anything out, so this pins the
 * rules and their hooks; e2e/cases/surfaces.mjs measures the real geometry in
 * Chromium (a 342×192 viewport — 1366×768 at 400%).
 */

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");
const root = postcss.parse(read("src/styles.css"));

function shortRules() {
  const out = {};
  root.walkAtRules("media", (at) => {
    if (at.params.replace(/\s+/g, " ") !== "(max-height: 449px)") return;
    at.walkRules((r) => {
      for (const sel of r.selectors) {
        out[sel] = Object.fromEntries(r.nodes.filter((d) => d.type === "decl").map((d) => [d.prop, d.value]));
      }
    });
  });
  return out;
}

describe("short viewports scroll the page instead of crushing the editor", () => {
  const rules = shortRules();

  it("releases the viewport lock on the standalone shell only", () => {
    expect(rules[".pf-shell"]).toMatchObject({ height: "auto", overflow: "visible" });
    expect(rules[".pf-shell"]["min-height"]).toBe("100dvh");
    expect(rules[".pf-shell .perssonify-editor"]).toMatchObject({ height: "auto", overflow: "visible" });
    // Scoped to .pf-shell: an embed or library mount keeps its host's height.
    for (const sel of Object.keys(rules)) {
      expect(sel.startsWith(".pf-shell") || sel.startsWith("html.pf-app"), sel).toBe(true);
    }
  });

  it("gives the editor row one full viewport, so a long library scrolls in its own list", () => {
    expect(rules[".pf-shell .pf-editor-row"]).toMatchObject({ flex: "none", height: "100dvh" });
    expect(rules[".pf-shell .pf-tray-region"]).toMatchObject({ flex: "none", overflow: "visible" });
  });

  it("is unlayered, so it beats the h-dvh / flex-1 / overflow-hidden utilities", () => {
    let parentOfMedia = null;
    root.walkAtRules("media", (at) => {
      if (at.params.replace(/\s+/g, " ") === "(max-height: 449px)") parentOfMedia = at.parent;
    });
    expect(parentOfMedia?.type).toBe("root");
  });

  it("hooks the rules onto the elements they are written for", () => {
    const app = read("src/App.tsx");
    expect(app).toMatch(/className="pf-shell [^"]*h-dvh[^"]*overflow-hidden/);
    expect(app).toContain('className="pf-shell-editor ');
    const pe = read("src/PerssonifyEditor.tsx");
    expect(pe).toContain('className="pf-tray-region ');
    expect(pe).toContain('className="pf-editor-row ');
  });
});
