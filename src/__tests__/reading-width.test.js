import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { migrateReadingWidth } from "../store/uiStore";

/**
 * C5. "Reading width" offered Narrow / Medium / Wide as fixed pixel caps
 * (640 / 800 / 1000) written onto the container that wraps BOTH panes, so each
 * half-width pane inherited the same absolute number. With the workspace panel
 * open by default, "Narrow" only began to bind above roughly a 1620px viewport
 * — below that all four options were pixel-identical, while the segment
 * highlighted and persisted. The control looked functional and was not.
 *
 * Pixels are also the wrong unit for the thing being set: a reading measure is
 * a number of CHARACTERS per line, so it has to move with the font size.
 */

describe("migrateReadingWidth", () => {
  it("maps the three shipped pixel values to their character equivalents", () => {
    expect(migrateReadingWidth(640)).toBe(65);
    expect(migrateReadingWidth(800)).toBe(80);
    expect(migrateReadingWidth(1000)).toBe(100);
  });

  it("leaves 'Full' alone", () => {
    expect(migrateReadingWidth(0)).toBe(0);
  });

  it("passes through a value that is already a character measure", () => {
    expect(migrateReadingWidth(65)).toBe(65);
    expect(migrateReadingWidth(100)).toBe(100);
  });

  it("scales an unrecognised legacy pixel value rather than dropping it", () => {
    // A hand-edited preference should not silently become "Full".
    expect(migrateReadingWidth(700)).toBe(70);
    expect(migrateReadingWidth(5000)).toBe(120); // clamped, not absurd
    expect(migrateReadingWidth(210)).toBe(45);   // clamped up to a real measure
  });

  it("survives junk", () => {
    expect(migrateReadingWidth(NaN)).toBe(0);
    expect(migrateReadingWidth(-40)).toBe(0);
  });
});

describe("the measure reaches the panes as characters", () => {
  const panes = readFileSync(join(process.cwd(), "src/ui/EditorPanes.tsx"), "utf8");
  const settings = readFileSync(join(process.cwd(), "src/ui/SettingsSheet.tsx"), "utf8");
  const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
  const cm = readFileSync(join(process.cwd(), "src/ui/CodeMirrorPane.tsx"), "utf8");

  it("emits ch, not px", () => {
    expect(panes).toContain("`${readingWidth}ch`");
    expect(panes).not.toContain("`${readingWidth}px`");
  });

  it("offers character counts in the settings control", () => {
    const block = settings.slice(settings.indexOf("Reading width"));
    expect(block).toContain("{ v: 65, label: \"Narrow\" }");
    expect(block).not.toContain("{ v: 640, label: \"Narrow\" }");
  });

  it("still caps the CONTENT column in both panes, not the flex pane", () => {
    // Capping the pane would break the split-divider maths — the reason the
    // variable is consumed on .ProseMirror / .cm-content rather than on the
    // pane wrapper.
    expect(css).toContain("max-width: var(--reading-width, none)");
    expect(cm).toContain('maxWidth: "var(--reading-width, none)"');
  });

  it("admits when it cannot bind", () => {
    // The control used to claim it "caps the text column" unconditionally.
    expect(settings).toContain("no visible effect");
  });
});
