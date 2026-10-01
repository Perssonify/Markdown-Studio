/**
 * Which imports the LIBRARY build leaves to the consumer's package manager.
 *
 * Everything a consumer installs because of us — `dependencies` and
 * `peerDependencies` — is external. Their bundler resolves it, dedupes it
 * against their own copy, and picks up patch releases (security fixes
 * included) without waiting for us to republish. Bundling those as well is
 * how the tarball reached 13 MB packed: mermaid, katex, docx, mammoth and the
 * rest shipped inside `dist/` AND were installed into node_modules, and a
 * mermaid advisory could only be fixed by a new release of this package.
 *
 * Whatever else the library imports is a devDependency, and gets BUNDLED. That
 * is a deliberate, per-package decision pinned by `pkg-manifest.test.js`
 * (`BUNDLED`):
 *  - `sonner` keeps a module-level toast queue that every `<Toaster>` without
 *    an `id` renders. Sharing a host's copy would show each toast twice — once
 *    in the host's toaster and once in ours.
 *  - `@base-ui/react` and `sonner` are also where the published stylesheet's
 *    portal scope roots come from (`data-base-ui-portal` is an internal Base UI
 *    helper's output, `data-sonner-toaster` sonner's). Bundling ships the
 *    versions that scoping was verified against.
 *
 * The derivation is the point: declaring a package is what makes it external,
 * so the manifest and the bundle cannot drift apart again.
 *
 * The patterns feed Rolldown's `esmExternalRequirePlugin`, NOT the top-level
 * `external` option. Base UI bundles `use-sync-external-store`, which is
 * CommonJS and calls `require("react")`; with react merely external, Rolldown
 * kept that call behind a runtime shim that THROWS outside Node ("Calling
 * `require` for "react" in an environment that doesn't expose the `require`
 * function"), so the ES build could not mount in any browser bundle. The plugin
 * turns those calls into real imports. It must own the list outright — a module
 * named in both places keeps its raw `require()`.
 *
 * Stylesheets are never external. A bare CSS import left in `dist/*.js` would
 * make every consumer's bundler — and any server-side import — handle CSS from
 * node_modules; they are compiled into `dist/styles.css` instead.
 */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

export function libraryExternals(pkg) {
  const names = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ];
  // `name` itself or any subpath of it — except a stylesheet subpath.
  return names.map((name) => new RegExp(`^${escape(name)}(?:/(?!.*\\.css(?:$|\\?)).*)?$`));
}
