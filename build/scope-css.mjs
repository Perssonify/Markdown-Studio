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
 * underlines. Only the `base` layer is touched: `theme` keeps writing the design
 * tokens at `:root`, which is exactly where the portalled surfaces read them.
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

/**
 * Vite plugin: applied by the LIBRARY build only. The app and embed builds keep
 * the global reset, because there the page is ours to reset.
 */
export function scopeLibraryBaseLayer() {
  return {
    name: "pf-scope-library-base-layer",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".css")) continue;
        file.source = scopeBaseLayer(String(file.source));
      }
    },
  };
}
