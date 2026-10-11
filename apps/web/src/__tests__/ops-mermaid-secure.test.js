/**
 * A document must not be able to restyle the page through a Mermaid diagram.
 *
 * Mermaid pastes `themeCSS`, the font families and the theme variables into the
 * diagram's <style>, and its directive sanitiser only checks brace balance — so
 * a balanced nested rule like `body:has(&) { … }` escapes the SVG's scope. Those
 * keys are now in the `secure` list, which only `mermaid.initialize` may set.
 *
 * Driven against the REAL Mermaid parser (directives and front-matter config
 * are processed by `parse`, no layout needed), with a positive control: a
 * harmless directive (`theme`) must still apply, or a negative assertion here
 * would pass just as well if directives were never processed at all.
 */
import { beforeEach, describe, expect, it } from "vitest";
import mermaid from "mermaid";
import { mermaidConfig, MERMAID_SECURE_KEYS } from "../ui/panes/diagramPreview";

const HOSTILE_CSS = "body:has(&) { display: none }";

async function configAfter(source) {
  await mermaid.parse(source);
  return mermaid.mermaidAPI.getConfig();
}

beforeEach(() => {
  mermaid.initialize(mermaidConfig(false));
});

describe("Mermaid config hardening", () => {
  it("keeps Mermaid's own secure keys and adds the CSS carriers", () => {
    for (const key of ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges"]) {
      expect(MERMAID_SECURE_KEYS).toContain(key);
    }
    for (const key of ["themeCSS", "themeVariables", "fontFamily", "altFontFamily"]) {
      expect(MERMAID_SECURE_KEYS).toContain(key);
    }
    expect(mermaidConfig(true)).toMatchObject({ securityLevel: "strict", startOnLoad: false, theme: "dark" });
  });

  it("control: a harmless %%{init}%% directive still applies", async () => {
    const cfg = await configAfter('%%{init: {"theme": "forest"}}%%\nflowchart TD\n  A-->B');
    expect(cfg.theme).toBe("forest");
  });

  it("drops themeCSS / fontFamily / themeVariables set by an %%{init}%% directive", async () => {
    const directive = JSON.stringify({
      theme: "forest",
      themeCSS: HOSTILE_CSS,
      fontFamily: "evil-font",
      themeVariables: { primaryColor: "#ff0000" },
    });
    const cfg = await configAfter(`%%{init: ${directive}}%%\nflowchart TD\n  A-->B`);
    expect(cfg.theme).toBe("forest"); // the same directive WAS processed…
    expect(cfg.themeCSS).not.toBe(HOSTILE_CSS); // …but its CSS carriers were not
    expect(String(cfg.fontFamily)).not.toContain("evil-font");
    expect(cfg.themeVariables?.primaryColor).not.toBe("#ff0000");
  });

  it("drops the same keys from front-matter config", async () => {
    const source = [
      "---",
      "config:",
      "  theme: forest",
      `  themeCSS: "${HOSTILE_CSS}"`,
      "  fontFamily: evil-font",
      "---",
      "flowchart TD",
      "  A-->B",
    ].join("\n");
    const cfg = await configAfter(source);
    expect(cfg.theme).toBe("forest");
    expect(cfg.themeCSS).not.toBe(HOSTILE_CSS);
    expect(String(cfg.fontFamily)).not.toContain("evil-font");
  });

  it("lays out with dagre unless a diagram asks for ELK (Mermaid 12's default)", async () => {
    // Mermaid 12 switched its default layout to ELK: every existing diagram
    // would re-layout, and every flowchart would fetch the 1.6 MB ELK chunk.
    expect((await configAfter("flowchart TD\n  A-->B")).layout).toBe("dagre");
    // `layout` is deliberately not a secure key: a diagram may still opt in.
    expect((await configAfter('%%{init: {"layout": "elk"}}%%\nflowchart TD\n  A-->B')).layout).toBe("elk");
  });

  it("a directive cannot lower the security level", async () => {
    const cfg = await configAfter('%%{init: {"securityLevel": "loose"}}%%\nflowchart TD\n  A-->B');
    expect(cfg.securityLevel).toBe("strict");
  });
});
