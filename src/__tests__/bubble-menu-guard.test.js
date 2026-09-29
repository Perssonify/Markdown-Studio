/**
 * The table and link bubble menus mutate the document, so they must honour
 * read-only and must not dispatch into a live IME composition.
 *
 * They called `editor.chain()…run()` directly, and TipTap does not save you:
 * its bubble-menu plugin carries an `isEditable` test in its DEFAULT
 * `shouldShow`, but a caller-supplied `shouldShow` REPLACES that wholesale, and
 * `CommandManager` has no editability check at all. On a `?readonly=1` share
 * link you could delete a row, delete a column, delete the whole table, toggle
 * the header, unlink, or re-target a link.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runBubbleCommand } from "../ui/bubble-menu-command";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");

/** A stand-in editor: the guard reads isDestroyed, isEditable and view.composing. */
function fakeEditor({ editable = true, composing = false, destroyed = false } = {}) {
  const blurred = [];
  return {
    blurred,
    editor: {
      isDestroyed: destroyed,
      isEditable: editable,
      view: { composing, dom: { blur: () => blurred.push("blur") } },
    },
  };
}

describe("runBubbleCommand", () => {
  it("refuses to run while the editor is read-only", () => {
    const { editor } = fakeEditor({ editable: false });
    const fn = vi.fn();
    runBubbleCommand(editor, fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it("runs when the editor is editable", () => {
    const { editor } = fakeEditor();
    const fn = vi.fn();
    runBubbleCommand(editor, fn);
    expect(fn).toHaveBeenCalledWith(editor);
  });

  it("ends a live composition before acting", () => {
    const { editor, blurred } = fakeEditor({ composing: true });
    const fn = vi.fn();
    runBubbleCommand(editor, fn);
    expect(blurred).toEqual(["blur"]);
    expect(fn).toHaveBeenCalled();
  });

  it("does nothing for a destroyed or absent editor", () => {
    const fn = vi.fn();
    runBubbleCommand(null, fn);
    runBubbleCommand(fakeEditor({ destroyed: true }).editor, fn);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("both bubble menus route through the guard", () => {
  for (const file of ["src/ui/TableBubbleMenu.tsx", "src/ui/LinkBubbleMenu.tsx"]) {
    it(`${file} restores the isEditable test its own shouldShow replaced`, () => {
      const src = read(file);
      expect(src).toMatch(/shouldShow=\{\(\{ editor: ed \}\) => ed\.isEditable/);
    });

    it(`${file} has no unguarded editor.chain() mutation`, () => {
      const src = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      // Every chain() call must be inside a runBubbleCommand callback, i.e.
      // reached through `ed`, never through the captured `editor`.
      expect(src).not.toMatch(/[^d]\beditor\.chain\(\)/);
      expect(src).toMatch(/runBubbleCommand\(/);
    });
  }

  it("the link menu no longer reaches for window.prompt as its primary path", () => {
    // Chrome blocks JS dialogs invoked from a cross-origin iframe — which is
    // exactly the shipped /embed.html, where Edit did nothing at all.
    const src = read("src/ui/LinkBubbleMenu.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).toMatch(/onEditLink/);
    const editFn = src.slice(src.indexOf("const handleEdit"), src.indexOf("const handleUnlink"));
    expect(editFn.indexOf("onEditLink")).toBeLessThan(editFn.indexOf("window.prompt"));
  });
});
