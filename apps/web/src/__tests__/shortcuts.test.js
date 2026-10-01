import { describe, expect, it } from "vitest";
import { SHORTCUT_GROUPS, displayKeys, displayKeysFor } from "../data/shortcuts";

/**
 * `shortcuts.ts` is the SINGLE source for shortcut documentation (Help page,
 * shortcut dialogs, menu hints). The Help page keys its rows by `action`, so a
 * duplicated row is not just noise — React drops one of the two, and the
 * documentation silently loses a line.
 *
 * A copy-pasted "Toggle cards board" row shipped exactly that way: two
 * identical entries in the Documents group, a React duplicate-key warning on
 * every visit to /help, and one row omitted from the rendered list.
 */
describe("SHORTCUT_GROUPS", () => {
  it("has no duplicate action within a group (the Help page keys rows by action)", () => {
    for (const group of SHORTCUT_GROUPS) {
      const actions = group.rows.map((r) => r.action);
      expect(new Set(actions).size, `duplicate action in "${group.group}"`).toBe(actions.length);
    }
  });

  it("has no duplicate group name", () => {
    const names = SHORTCUT_GROUPS.map((g) => g.group);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every row a non-empty action and keys", () => {
    for (const group of SHORTCUT_GROUPS) {
      for (const row of group.rows) {
        expect(row.action.trim()).not.toBe("");
        expect(row.keys.trim()).not.toBe("");
      }
    }
  });

  it("never binds one key combination to two different actions in the same group", () => {
    for (const group of SHORTCUT_GROUPS) {
      const keys = group.rows.map((r) => r.keys);
      expect(new Set(keys).size, `duplicate key combo in "${group.group}"`).toBe(keys.length);
    }
  });
});

describe("displayKeys", () => {
  it("translates mac glyphs for other platforms and leaves mac alone", () => {
    expect(displayKeysFor("⌘⇧K", "mac")).toBe("⌘⇧K");
    expect(displayKeysFor("⌘⇧K", "other")).toBe("Ctrl+Shift+K");
    expect(typeof displayKeys("⌘K")).toBe("string");
  });
});
