import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { SCOPE_ROOTS, scopeBaseLayer, scopeSelector } from "../../build/scope-css.mjs";

/**
 * The published library stylesheet must not restyle the page it is imported
 * into. Tailwind's preflight is a global reset — correct for the standalone app
 * and the iframe embed, which own their document, and wrong for a consumer who
 * mounts the editor inside an application that already has its own styles.
 *
 * Unscoped it measured, in a real browser, as: the host's `<h1>` dropping from
 * 32px/700 to 16px/400, its links losing their underline, its `<ul>` losing 16px
 * of margin and 40px of padding, and every element on the page switching to
 * `box-sizing: border-box` with a solid border-style.
 */
describe("library stylesheet scoping", () => {
  const root = (sel) => `:where(${SCOPE_ROOTS.join(", ")})${sel ? " " + sel : ""}`;

  it("confines the universal reset to the roots AND their descendants", () => {
    // The editor container and each portal wrapper are themselves elements the
    // reset has to reach — scoping to descendants alone would skip them.
    const out = scopeBaseLayer("@layer base{*{margin:0}}");
    expect(out).toContain(root(""));
    expect(out).toContain(root("*"));
  });

  it("replaces page-level roots rather than nesting under them", () => {
    // `:where(...) html` matches nothing. The editor's own roots stand in for
    // the document element, which is where those inherited defaults must start.
    expect(scopeSelector("html")).toBe(root(""));
    expect(scopeSelector(":host")).toBe(root(""));
    expect(scopeSelector("body")).toBe(root(""));
  });

  it("collapses html and :host onto one selector instead of emitting it twice", () => {
    const out = scopeBaseLayer("@layer base{html,:host{line-height:1.5}}");
    const occurrences = out.split(root("")).length - 1;
    expect(occurrences).toBe(1);
  });

  it("scopes bare element selectors, which are the ones that repaint a host page", () => {
    expect(scopeSelector("a")).toBe(root("a"));
    expect(scopeSelector("h1,h2")).toBe(root("h1,h2"));
    expect(scopeSelector("button:not(:disabled)")).toBe(root("button:not(:disabled)"));
  });

  it("leaves selectors that already name a root alone", () => {
    // Double-scoping `html.pf-app::-webkit-scrollbar` would produce a selector
    // that can never match.
    expect(scopeSelector(".pf-app *")).toBe(".pf-app *");
    expect(scopeSelector("html.pf-app::-webkit-scrollbar")).toBe("html.pf-app::-webkit-scrollbar");
    expect(scopeSelector(".perssonify-editor h1")).toBe(".perssonify-editor h1");
  });

  it("keeps zero specificity so utilities still win over the reset", () => {
    // `:where()` contributes nothing, so a scoped `a` weighs exactly as much as
    // the plain `a` it replaced and the cascade is unchanged.
    expect(scopeSelector("a").startsWith(":where(")).toBe(true);
  });

  it("does NOT touch the theme layer — portalled surfaces read those tokens", () => {
    // Menus, dialogs and toasts live on document.body, outside the editor
    // container. Scoping the design tokens to the container would leave every
    // one of them without a --background, --border or --primary to resolve.
    const out = scopeBaseLayer("@layer theme{:root,:host{--primary:red}}");
    expect(out).toBe("@layer theme{:root,:host{--primary:red}}");
  });

  it("does not touch layers other than base", () => {
    const css = "@layer utilities{.p-2{padding:.5rem}}";
    expect(scopeBaseLayer(css)).toBe(css);
  });

  it("scopes rules nested inside @supports within the base layer", () => {
    const out = scopeBaseLayer("@layer base{@supports (color:red){a{color:red}}}");
    expect(out).toContain(root("a"));
  });

  it("covers every kind of surface the editor puts outside its own container", () => {
    // Base UI wraps each portalled menu/dialog/sheet/tooltip in a div carrying
    // data-base-ui-portal; sonner's toaster root carries data-sonner-toaster;
    // data-pf-portal marks the ones we append to <body> by hand.
    expect(SCOPE_ROOTS).toEqual(
      expect.arrayContaining([
        ".pf-app",
        ".perssonify-editor",
        "[data-base-ui-portal]",
        "[data-sonner-toaster]",
        "[data-pf-portal]",
      ]),
    );
  });

  it("marks the surfaces we attach to <body> by hand", () => {
    // These two mount outside the editor container without going through a
    // primitive, so nothing else would place them inside the scope.
    const read = (p) => readFileSync(join(process.cwd(), p), "utf8");
    expect(read("src/extensions/emoji-suggestion.ts")).toContain('setAttribute("data-pf-portal"');
    expect(read("src/ui/FindReplace.tsx")).toContain("data-pf-portal");
  });
});
