import tailwindcss from "@tailwindcss/vite";
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import path from "path";
import { defineConfig, esmExternalRequirePlugin } from 'vite';
import { libraryExternals } from './build/externals.mjs';
import { scopeLibraryStylesheet } from './build/scope-css.mjs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // `public/` is the STANDALONE APP's (favicons, web manifest, the service-worker
  // rescue script, brand images). Vite copies it into every build's outDir by
  // default, so the npm tarball was shipping the app's favicons and
  // sw-recover.js to every library consumer.
  publicDir: false,
  // `scopeLibraryStylesheet` is deliberately absent from the app and embed configs:
  // there the page is ours, and a global reset plus `:root` design tokens are the
  // correct behaviour. Only the published library stylesheet gets confined to the
  // editor's own subtrees (build/scope-css.mjs).
  plugins: [
    // Dependencies and peers are external; devDependencies the library imports
    // are bundled. The list is DERIVED from package.json, and this plugin owns it
    // (not `rollupOptions.external`) so a bundled CommonJS module's
    // `require("react")` becomes an import instead of a shim that throws in a
    // browser. build/externals.mjs has the reasoning for both halves.
    esmExternalRequirePlugin({ external: libraryExternals(pkg) }),
    react(),
    tailwindcss(),
    scopeLibraryStylesheet(),
  ],
  build: {
    lib: {
      // Multiple entry points: consumers can import from the root, or
      // directly from engine/store/integration without pulling in the full UI.
      entry: {
        index: 'src/index.tsx',
        engine: 'src/engine/useMarkdownEngine.ts',
        store: 'src/store/index.ts',
        integration: 'src/integration/index.ts',
      },
      formats: ['es', 'cjs'],
      // Emit the stylesheet at a STABLE path so package.json's
      // "./styles.css" export resolves (it previously pointed at a file the
      // build never produced, so consumers rendered completely unstyled).
      cssFileName: 'styles',
    },
    // Vite 8 minifies with oxc (bundled). `'esbuild'` needs esbuild installed
    // separately, which only resolved while an unrelated package happened to
    // pull it into node_modules; the dependency cleanup removed that, and a
    // clean `bun install --frozen-lockfile` could no longer build the library.
    minify: 'oxc',
    target: 'es2020',
    // Maps are written for local debugging but not referenced from the output
    // and not published (package.json `files` excludes them): they were 416 of
    // the tarball's 871 files and 44.7 MB of its 60 MB unpacked, and a
    // `sourceMappingURL` pointing at a file that is not in the package makes
    // consumers' dev servers warn about a missing source map.
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        exports: 'named',
        // No `chunkFileNames` override: Vite's library default names shared
        // chunks `.js` for ES and `.cjs` for CJS. A hardcoded '[name]-[hash].js'
        // gave the CJS build's chunks a `.js` extension inside a
        // `"type": "module"` package, where Node and bundlers read every `.js`
        // as ESM — so `require("./chunk.js")` from dist/index.cjs could not work.
      },
      treeshake: {
        // CSS imports have side effects (stylesheet injection).
        moduleSideEffects: (id) => id.includes('.css'),
      },
    },
    chunkSizeWarningLimit: 500,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
