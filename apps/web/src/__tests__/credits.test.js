import { describe, expect, it } from "vitest";
import { CREDITS, LICENSE_SUMMARY } from "../data/credits";
import { HELP_SECTIONS, SHORTCUT_GROUPS } from "../ui/pages/help-content";

describe("About credits data", () => {
  it("every credit has a name, version and license", () => {
    for (const group of CREDITS) {
      expect(group.group).toBeTruthy();
      expect(group.items.length).toBeGreaterThan(0);
      for (const item of group.items) {
        expect(item.name).toBeTruthy();
        expect(item.version).toMatch(/\d/);
        expect(item.license).toBeTruthy();
      }
    }
  });

  it("credits the key runtime libraries", () => {
    const names = CREDITS.flatMap((g) => g.items.map((i) => i.name));
    for (const expected of ["react", "@tiptap/core", "marked", "turndown", "katex", "mermaid"]) {
      expect(names).toContain(expected);
    }
  });

  it("license summary is de-duplicated and sorted", () => {
    expect(LICENSE_SUMMARY).toEqual([...LICENSE_SUMMARY].sort());
    expect(new Set(LICENSE_SUMMARY).size).toBe(LICENSE_SUMMARY.length);
    expect(LICENSE_SUMMARY).toContain("MIT");
  });
});

describe("Help content", () => {
  it("every section has a unique id and at least one block", () => {
    const ids = HELP_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of HELP_SECTIONS) {
      expect(s.title).toBeTruthy();
      expect(s.blocks.length).toBeGreaterThan(0);
    }
  });

  it("shortcut rows are well-formed", () => {
    for (const g of SHORTCUT_GROUPS) {
      expect(g.rows.length).toBeGreaterThan(0);
      for (const r of g.rows) {
        expect(r.action).toBeTruthy();
        expect(r.keys).toBeTruthy();
      }
    }
  });
});
