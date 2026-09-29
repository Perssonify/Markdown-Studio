import postcss from "postcss";

/**
 * The roots a library consumer's page may contain that legitimately belong to
 * this editor. Preflight (and our own element-level base rules) are confined to
 * these, so importing `@perssonify/editor/styles.css` cannot restyle the host.
 *
 *  - `.pf-app`            the standalone app / iframe embed shells, which own
 *                         their whole page and put this class in the markup.
 *  - `.perssonify-editor` the editor container itself — present on every mount,
 *                         including a library one.
 *  - `[data-pf-root]`     the library integration's wrapper around the editor
 *                         (`display: contents`). It carries the host's
 *                         `accentColor` / `themeVars` as inline custom
 *                         properties and the `data-theme` / `data-palette` the
 *                         editor subtree is themed by — so the design tokens are
 *                         defined HERE for that subtree (see TOKEN_SCOPE).
 *  - `[data-base-ui-portal]` / `[data-sonner-toaster]`
 *                         menus, dialogs, sheets, tooltips and toasts portal to
 *                         `document.body`, OUTSIDE the editor container. Base UI
 *                         wraps every portalled surface in a div carrying
 *                         `data-base-ui-portal`; sonner's toaster root carries
 *                         `data-sonner-toaster`. Without these the reset
 *                         those surfaces are built on would not reach them —
 *                         `border` would resolve to `border-style: none` and
 *                         every menu, dialog and toast would lose its outline —
 *                         which is the same blind spot that once left them
 *                         rendering light under a dark editor.
 *  - `[data-pf-portal]`   surfaces WE attach to `document.body` by hand rather
 *                         than through a primitive (the emoji suggestion list,
 *                         the Find/Replace match ticks). Anything new that
 *                         mounts outside the editor container must carry it.
 */
export const SCOPE_ROOTS = [
  ".pf-app",
  ".perssonify-editor",
  "[data-pf-root]",
  "[data-base-ui-portal]",
  "[data-sonner-toaster]",
  "[data-pf-portal]",
];

/** Zero-specificity, so the scoped rules keep preflight's original weight and
 *  utilities still win over them exactly as they did unscoped. */
const SCOPE = `:where(${SCOPE_ROOTS.join(", ")})`;

/** Selectors that already name one of the roots are scoped by hand already. */
const isAlreadyScoped = (sel) => SCOPE_ROOTS.some((root) => sel.includes(root));

/** Page-level selectors have no meaning in a host page: our roots stand in. */
const PAGE_ROOT = /^(html|:host|body)\b/;

export function scopeSelector(selector) {
  const sel = selector.trim();
  if (!sel || isAlreadyScoped(sel)) return sel;
  // A bare universal selector must reach the roots THEMSELVES as well as their
  // descendants: the editor container and each portal wrapper are elements the
  // reset has to apply to, not just their contents.
  if (sel === "*") return [SCOPE, `${SCOPE} *`];
  if (/^(html|:host|body)$/.test(sel)) return SCOPE;
  if (PAGE_ROOT.test(sel)) return sel.replace(PAGE_ROOT, SCOPE);
  return `${SCOPE} ${sel}`;
}

/**
 * Confine everything in `@layer base` to the editor's own subtrees.
 *
 * Tailwind's preflight is a deliberate, global reset — right for the standalone
 * app and the iframe embed, which own their page, and wrong for the npm library,
 * whose stylesheet a consumer imports into an application that already has its
 * own styles. Unscoped it set `margin:0;padding:0;border:0` on every element on
 * the host's page, stripped their headings' size and weight and their links'
 * underlines. Only the `base` layer is touched here; the design tokens are
 * `scopeTokens`' job.
 */
export function scopeBaseLayer(css) {
  const root = postcss.parse(css);

  root.walkAtRules("layer", (layer) => {
    if (layer.params.trim() !== "base" || !layer.nodes) return;
    layer.walkRules((rule) => {
      // `html, :host` both collapse onto the same scope list, so de-duplicate —
      // an emitted selector repeated verbatim is noise in a shipped stylesheet.
      const scoped = rule.selectors.flatMap((sel) => scopeSelector(sel));
      rule.selectors = [...new Set(scoped)];
    });
  });

  return root.toString();
}

// ── design tokens ─────────────────────────────────────────────────────────────

/**
 * Where the design tokens are DEFINED in the library stylesheet: on each scope
 * root, never on the host's `:root` — except a root nested inside the
 * integration wrapper, which inherits the wrapper's values instead of
 * re-declaring the defaults over them (the wrapper's inline `accentColor` /
 * `themeVars` would otherwise stop reaching the editor). Zero specificity.
 */
export const TOKEN_SCOPE = `:where(${SCOPE_ROOTS.join(", ")}):not(:where([data-pf-root] *))`;

/** A selector made only of page roots and the theme / palette switches — the
 *  shape of every rule that defines tokens (`:root`, `:root,[data-theme=light]`,
 *  `.dark,[data-pf-theme=dark]`, `.dark[data-palette=amber]`, Tailwind's
 *  `:root,:host` theme layer). */
const THEME_COMPOUND = /^(?:(?::root|:host|html)|\.dark|\[data-(?:pf-)?theme(?:=[^\]]*)?\]|\[data-palette(?:=[^\]]*)?\])+$/;
const PAGE_PSEUDO = /^html|:root|:host/g;

/**
 * Rewrite one token-defining selector so it can only match the editor's roots.
 *
 *  - `:root` / `:host` / `html` → TOKEN_SCOPE.
 *  - a theme / palette switch `S` → two forms:
 *      TOKEN_SCOPE + S            a root that carries the switch itself — the
 *                                 integration wrapper's `data-theme` /
 *                                 `data-palette`. Keeps S's weight.
 *      :where(S) TOKEN_SCOPE      a root under an ancestor that carries it —
 *                                 `<html data-pf-theme>` for the portals, a
 *                                 host's `.dark` for a bare editor mount. Weighs
 *                                 NOTHING, so the switch closest to the editor
 *                                 wins, and the original rules' source order
 *                                 (which already agreed with their specificity)
 *                                 still decides between ancestors.
 *    Neither form matches the element carrying the switch unless it is one of
 *    our roots — which is the fix: `.dark { --background: … }` used to recolour a
 *    shadcn host's own `<html class="dark">`.
 */
export function scopeTokenSelector(selector) {
  const qualifier = selector.trim().replace(PAGE_PSEUDO, "");
  if (!qualifier) return TOKEN_SCOPE;
  return [`${TOKEN_SCOPE}${qualifier}`, `:where(${qualifier}) ${TOKEN_SCOPE}`];
}

/** A page-level rule outside the base layer (`html::-webkit-scrollbar`, …) only
 *  means something on a page that is ours, i.e. one whose `<html>` / `<body>`
 *  carries `.pf-app`; on a host page it must match nothing. */
export function scopePageSelector(selector) {
  const sel = selector.trim();
  if (isAlreadyScoped(sel)) return sel;
  return sel.replace(/^(html|:root|body)\b/, "$1.pf-app");
}

const insideAtRule = (node, test) => {
  for (let p = node.parent; p && p.type !== "root"; p = p.parent) {
    if (p.type === "atrule" && test(p)) return true;
  }
  return false;
};

/**
 * Stop the library stylesheet defining anything on the HOST's document.
 *
 * The tokens (`--background`, `--primary`, `--border`, `--radius`, …) were
 * written on `:root` and `.dark` — the exact names a shadcn / Tailwind host uses
 * for its own design system, in unlayered rules that beat a host's layered ones
 * whatever the import order. Importing the stylesheet recoloured the host page,
 * and Tailwind's `theme` layer (`--font-sans`, `--default-font-family`, …) merged
 * into the host's same-named layer. `html::-webkit-scrollbar { display: none }`
 * hid the host page's scrollbar.
 *
 * The names are unchanged, deliberately: they are read from JavaScript too
 * (CodeMirror's runtime theme, the Markdown preview CSS, the emoji list, sonner,
 * the toolbar's colour probe) and a host themes the editor through them
 * (`themeVars`), so renaming them would have broken every one of those. What
 * changes is WHERE they are defined — on the editor's own roots — and the
 * portalled menus, dialogs and toasts are roots, so they still get them.
 */
export function scopeTokens(css) {
  const root = postcss.parse(css);

  root.walkRules((rule) => {
    // (Keyframe steps — from / to / 50% — are rules too, but can never match
    // either branch below, so they need no special case.)
    if (insideAtRule(rule, (a) => a.name === "layer" && a.params.trim() === "base")) return;
    const selectors = rule.selectors.map((s) => s.trim());
    if (selectors.every((s) => THEME_COMPOUND.test(s))) {
      rule.selectors = [...new Set(selectors.flatMap(scopeTokenSelector))];
    } else if (selectors.some((s) => /^(html|:root|body)\b/.test(s))) {
      rule.selectors = selectors.map(scopePageSelector);
    }
  });

  return root.toString();
}

/** Everything the library stylesheet needs before it can sit on a host page. */
export const scopeLibraryCss = (css) => scopeTokens(scopeBaseLayer(css));

/**
 * Vite plugin: applied by the LIBRARY build only. The app and embed builds keep
 * the global reset and `:root` tokens, because there the page is ours.
 */
export function scopeLibraryStylesheet() {
  return {
    name: "pf-scope-library-stylesheet",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".css")) continue;
        file.source = scopeLibraryCss(String(file.source));
      }
    },
  };
}
