import tailwindcss from "@tailwindcss/vite";
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import path from "path";
import { defineConfig } from 'vite';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- plain ESM build helper, no types needed at config time
import { scopeLibraryBaseLayer } from './build/scope-css.mjs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

// All packages listed as peerDependencies — never bundled into the library.
const peerDeps = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react-dom/client',
  // tiptap
  /^@tiptap\//,
  // codemirror / lezer
  /^@codemirror\//,
  /^@lezer\//,
  /^prosemirror/,
  // lucide
  'lucide-react',
  // fonts — consumers control font loading; don't inline into the library bundle
  /^@fontsource/,
  // theme provider — used only at app shell level, not required by library consumers
  'next-themes',
  // zustand — lightweight but consumers may already have it
  'zustand',
];

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // `scopeLibraryBaseLayer` is deliberately absent from the app and embed configs:
  // there the page is ours and a global reset is the correct behaviour. Only the
  // published library stylesheet gets confined to the editor's own subtrees.
  plugins: [react(), tailwindcss(), scopeLibraryBaseLayer()],
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
    minify: 'esbuild',
    target: 'es2020',
    sourcemap: true,
    rollupOptions: {
      external: (id) => peerDeps.some((p) =>
        typeof p === 'string' ? id === p || id.startsWith(p + '/') : p.test(id),
      ),
      output: {
        exports: 'named',
        // Keep each entry point in its own chunk; shared code goes to a shared chunk.
        chunkFileNames: '[name]-[hash].js',
      },
      treeshake: {
        moduleSideEffects: (id) => {
          // CSS imports have side effects (stylesheet injection).
          // @fontsource is now external so it won't reach here, but guard anyway.
          if (id.includes('.css')) return true;
          if (id.includes('@fontsource')) return true;
          return false;
        },
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
