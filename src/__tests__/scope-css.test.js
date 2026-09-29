import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  SCOPE_ROOTS,
  TOKEN_SCOPE,
  scopeBaseLayer,
  scopeLibraryCss,
  scopeSelector,
  scopeTokens,
} from "../../build/scope-css.mjs";

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

  it("leaves the theme layer to the token pass", () => {
    // The base-layer pass only resets elements; where the design tokens are
    // defined is `scopeTokens`' job (below), which keeps them reachable from
    // the portalled surfaces.
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

/**
 * The design tokens. They used to be written on `:root` and `.dark` —
 * `--background`, `--primary`, `--border`, `--radius`: the names a shadcn or
 * Tailwind host uses for its own design system, in unlayered rules that beat a
 * host's layered ones whatever the import order — so importing the stylesheet
 * recoloured the host page; `html::-webkit-scrollbar{display:none}` hid its
 * scrollbar. Measured in a real browser by e2e/cases/library.mjs; pinned here
 * at the transform.
 */
describe("library stylesheet — design tokens and page-level rules", () => {
  const selectorsOf = (css) => {
    const m = /^(?:@[^{]+\{)*([^{]+)\{/.exec(css);
    return m[1].split(/,(?![^(]*\))/).map((s) => s.trim());
  };

  it("defines :root tokens on the editor's roots, never on the host's :root", () => {
    const out = scopeTokens(":root{--primary:red}");
    expect(selectorsOf(out)).toEqual([TOKEN_SCOPE]);
    expect(out).not.toMatch(/(^|[\s,}]):root/);
  });

  it("does the same for Tailwind's theme layer, which merges with a host's same-named layer", () => {
    const out = scopeTokens("@layer theme{:root,:host{--font-sans:Geist}}");
    expect(out).toBe(`@layer theme{${TOKEN_SCOPE}{--font-sans:Geist}}`);
  });

  it("never matches a host element that carries the dark / theme / palette switch", () => {
    const out = scopeTokens(".dark,[data-pf-theme=dark],[data-theme=dark]{--background:#000}");
    for (const sel of selectorsOf(out)) {
      // Every form ends at one of OUR roots.
      expect(sel.endsWith(TOKEN_SCOPE) || sel.startsWith(TOKEN_SCOPE), sel).toBe(true);
    }
    expect(selectorsOf(out)).toContain(`${TOKEN_SCOPE}.dark`);
    expect(selectorsOf(out)).toContain(`:where(.dark) ${TOKEN_SCOPE}`);
  });

  it("lets the switch closest to the editor win: an ancestor's switch weighs nothing", () => {
    // Own form keeps the switch's weight; the inherited form is all :where().
    const [own, inherited] = selectorsOf(scopeTokens(".dark[data-palette=mono]{--primary:#fff}"));
    expect(own).toBe(`${TOKEN_SCOPE}.dark[data-palette=mono]`);
    expect(inherited).toBe(`:where(.dark[data-palette=mono]) ${TOKEN_SCOPE}`);
  });

  it("has zero specificity and skips roots nested in the integration wrapper", () => {
    // Nested roots inherit the wrapper's inline accentColor / themeVars; if they
    // re-declared the defaults, those would never reach the editor.
    expect(TOKEN_SCOPE).toMatch(/^:where\([^)]*\):not\(:where\(\[data-pf-root\] \*\)\)$/);
    expect(SCOPE_ROOTS).toContain("[data-pf-root]");
  });

  it("confines page-level rules to a page that is ours", () => {
    expect(scopeTokens("html::-webkit-scrollbar,.no-scrollbar::-webkit-scrollbar{display:none}"))
      .toBe("html.pf-app::-webkit-scrollbar,.no-scrollbar::-webkit-scrollbar{display:none}");
    expect(scopeTokens("html,.no-scrollbar{scrollbar-width:none}"))
      .toBe("html.pf-app,.no-scrollbar{scrollbar-width:none}");
  });

  it("leaves keyframes, utilities, the base layer and hand-scoped rules alone", () => {
    for (const css of [
      "@keyframes spin{from{opacity:0}to{opacity:1}}",
      String.raw`.dark\:bg-card:where(.dark *){color:red}`, // Tailwind's escaped `dark:` class
      "@layer base{html{line-height:1.5}}",
      ".pf-app body,body.pf-app{margin:0}",
    ]) {
      expect(scopeTokens(css)).toBe(css);
    }
  });

  it("the library build runs both passes", () => {
    const out = scopeLibraryCss("@layer base{a{color:red}}:root{--primary:red}");
    expect(out).toContain(`:where(${SCOPE_ROOTS.join(", ")}) a`);
    expect(out).toContain(`${TOKEN_SCOPE}{--primary:red}`);
  });

  it("the integration wrapper is the token root for its subtree, error card included", () => {
    const src = readFileSync(join(process.cwd(), "src/integration/PerssonifyEditorIntegration.tsx"), "utf8");
    const wrapper = src.indexOf('data-pf-root=""');
    expect(wrapper).toBeGreaterThan(-1);
    // Outside the boundary, so the crash card (styled with the same tokens) gets them.
    expect(src.indexOf("<ErrorBoundary", wrapper)).toBeGreaterThan(wrapper);
    expect(src.lastIndexOf("<ErrorBoundary", wrapper)).toBe(-1);
  });
});
