// @vitest-environment node
// (The real vite.config.ts is imported below; it resolves package.json through
// import.meta.url, which only a node environment gives a file: URL.)
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { libraryExternals } from "../../build/externals.mjs";
import libraryConfig from "../../vite.config.ts";

/**
 * What the npm tarball contains, and how the built library resolves its
 * imports. Measured before these pins: 13.2 MB packed / 60.8 MB unpacked, 871
 * files — 416 of them sourcemaps (44.7 MB), plus the standalone app's favicons,
 * web manifest and service-worker script — with mermaid, katex, docx, mammoth
 * and the rest bundled into dist/ AND installed as dependencies.
 *
 * Two defects the audit did not list surfaced while fixing that, both invisible
 * to every existing test because nothing mounted the built JS in a consumer:
 *  - the ES build could not mount in a browser bundle at all. Base UI (bundled)
 *    carries `use-sync-external-store`, which is CommonJS and calls
 *    `require("react")`; with react merely external, Rolldown left that call
 *    behind a shim that throws outside Node;
 *  - the CJS build named its shared chunks `.js` inside a `"type": "module"`
 *    package, so `dist/index.cjs` required files Node reads as ESM.
 */
const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
const matches = (patterns, id) => patterns.some((re) => re.test(id));

describe("library externals — derived from the manifest", () => {
  const patterns = libraryExternals({
    dependencies: { marked: "^1.0.0", "@zip.js/zip.js": "^2.0.0" },
    peerDependencies: { react: "^18.0.0", "@tiptap/pm": "^3.0.0" },
  });

  it("leaves every dependency and peer — and their subpaths — to the consumer", () => {
    for (const id of ["marked", "react", "react/jsx-runtime", "@tiptap/pm", "@tiptap/pm/state", "@zip.js/zip.js"]) {
      expect(matches(patterns, id), id).toBe(true);
    }
  });

  it("bundles what is not declared for consumers, including look-alike names", () => {
    for (const id of ["sonner", "@base-ui/react", "react-dom", "reactive", "marked-emoji", "@tiptap/core"]) {
      expect(matches(patterns, id), id).toBe(false);
    }
  });

  it("never externalises a stylesheet — a bare CSS import in dist/*.js breaks SSR and CSS-less bundlers", () => {
    expect(matches(patterns, "marked/dist/theme.css")).toBe(false);
    expect(matches(patterns, "react/styles.css?inline")).toBe(false);
  });
});

describe("the library build config", () => {
  const build = libraryConfig.build ?? {};
  const pluginNames = (libraryConfig.plugins ?? []).flat().map((p) => p?.name);

  it("does not copy the standalone app's public/ directory into dist/", () => {
    expect(libraryConfig.publicDir).toBe(false);
  });

  it("hands the externals to esmExternalRequirePlugin and nowhere else", () => {
    // A module listed in BOTH places keeps its raw require() — the plugin must
    // own the list outright for the require-to-import conversion to happen.
    expect(pluginNames).toContain("builtin:esm-external-require");
    expect(build.rollupOptions?.external).toBeUndefined();
    expect(build.rolldownOptions?.external).toBeUndefined();
  });

  it("lets Vite name chunks per format (.js for ES, .cjs for CJS)", () => {
    expect(build.rollupOptions?.output?.chunkFileNames).toBeUndefined();
  });

  it("writes sourcemaps without referencing them from the published output", () => {
    // `hidden`: the maps stay local; a sourceMappingURL to a file that is not
    // in the tarball makes consumers' dev servers warn about it.
    expect(build.sourcemap).toBe("hidden");
  });

  it("keeps sourcemaps out of the published files", () => {
    expect(pkg.files).toContain("dist");
    expect(pkg.files).toContain("!dist/**/*.map");
  });
});
