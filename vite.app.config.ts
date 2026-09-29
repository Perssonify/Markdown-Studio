import tailwindcss from "@tailwindcss/vite";
import react from '@vitejs/plugin-react';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { manualChunks } from './vite.chunks';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

const OUT_DIR = 'dist-app';
/** Where the app's sourcemaps go instead of the deploy (CI keeps them as an artifact). */
const SOURCEMAP_DIR = 'dist-app-sourcemaps';

/**
 * Sourcemaps are built ('hidden': no sourceMappingURL comment) but must not be
 * DEPLOYED: dist-app used to ship ~130 .map files (25 MB of 35 MB), i.e. the
 * whole readable source to anyone who guessed a URL. They move to
 * SOURCEMAP_DIR, outside the output directory Vercel publishes, where they can
 * still symbolicate a stack from "Copy diagnostics".
 */
function keepSourcemapsOutOfDeploy(): Plugin {
  const outDir = path.resolve(__dirname, OUT_DIR);
  const mapDir = path.resolve(__dirname, SOURCEMAP_DIR);
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = path.join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  return {
    name: 'pf-keep-sourcemaps-out-of-deploy',
    apply: 'build',
    enforce: 'post',
    closeBundle: {
      order: 'post',
      handler() {
        if (!existsSync(outDir)) return;
        rmSync(mapDir, { recursive: true, force: true });
        for (const file of walk(outDir)) {
          if (!file.endsWith('.map')) continue;
          const dest = path.join(mapDir, path.relative(outDir, file));
          mkdirSync(path.dirname(dest), { recursive: true });
          renameSync(file, dest);
        }
      },
    },
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    tailwindcss(),
    // Standalone app only (the embeddable library build in vite.config.ts gets no
    // service worker).
    //
    // PROMPT, not autoUpdate. autoUpdate + skipWaiting + clientsClaim, a page
    // reload on `controllerchange` and a worker-side navigation of every window
    // meant each deploy force-reloaded every open tab mid-edit. Now a new worker
    // waits until the user presses "Reload" in the update notice (or every tab
    // has closed) — see src/pwa/sw-updates.ts, which also decides when a tab may
    // reload by itself (never offline, never with unsaved work).
    VitePWA({
      registerType: 'prompt',
      // Registered from src/main.tsx through `virtual:pwa-register`, so the
      // plugin must not inject its own register script.
      injectRegister: false,
      includeAssets: [
        'favicon.ico',
        'favicon-96x96.png',
        'apple-touch-icon.png',
        'web-app-manifest-192x192.png',
        'web-app-manifest-512x512.png',
      ],
      manifest: {
        name: 'Markdown Studio',
        short_name: 'Markdown Studio',
        description: 'Dual-pane Markdown editor — write Markdown and rich text side by side. Client-only, works offline.',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/web-app-manifest-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/web-app-manifest-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Navigation handling (network first, then this worker's own precached
        // shell) and cache housekeeping. See public/sw-recover.js.
        importScripts: ['sw-recover.js'],
        // EVERYTHING the app can load is precached, lazy chunks included, so
        // "works offline" holds for features never used online: measured before
        // this, offline ⌘F reloaded the page and never opened Find, and Word
        // export produced nothing. Fonts: woff2 only — every browser that runs
        // this app takes woff2, and KaTeX's woff/ttf copies nearly tripled the
        // font bytes for nothing.
        //
        // index.html IS precached now, but only as the OFFLINE fallback for
        // navigations (sw-recover.js), never served first: `directoryIndex: null`
        // stops the precache route from answering "/" with it. Online users keep
        // getting the current HTML on every navigation — the reason it was left
        // out before — and offline gets the shell that matches THIS worker's
        // precached chunks, instead of whatever HTML a runtime cache last saw.
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,ico,webp,jpg,jpeg}'],
        globIgnores: ['**/node_modules/**/*', 'sw.js', 'workbox-*.js', 'sw-recover.js'],
        // The largest chunk is well under this; a chunk that outgrew the 2 MiB
        // default would be silently left out of the precache (an offline hole).
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        directoryIndex: null,
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        // A new worker waits for the user (see above). clientsClaim only affects
        // pages no worker controls yet — the first visit — so the precache
        // serves that session's lazy chunks too.
        skipWaiting: false,
        clientsClaim: true,
        // The worker's own sourcemap is not deployed either.
        sourcemap: false,
        runtimeCaching: [
          {
            // Navigations: sw-recover.js owns them (network first, 3 s budget,
            // then the precached shell — also on a 5xx, so a hosting outage
            // leaves installed users with a working editor). /api/ and anything
            // file-shaped (/.well-known/security.txt, /robots.txt) are real
            // server resources and never get the app shell.
            urlPattern: ({ request, url }) =>
              request.mode === 'navigate' &&
              !url.pathname.startsWith('/api/') &&
              !/\/[^/]+\.[a-z0-9]+$/i.test(url.pathname),
            handler: ({ request }) =>
              (self as unknown as { pfNavigate(r: Request): Promise<Response> }).pfNavigate(request),
          },
          {
            // Same-origin scripts the precache does not hold (a newer deploy's
            // chunks, loaded while this worker still controls the page).
            // CacheFirst is right for hashed files — but only for what really
            // IS a script: the SPA rewrite used to answer a purged chunk with
            // index.html (200 text/html), and caching that pinned the failure
            // for 30 days. The rewrite now 404s under /assets/, and this checks
            // the type anyway.
            urlPattern: ({ sameOrigin, request }) =>
              sameOrigin && request.destination === 'script',
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-scripts',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              plugins: [
                {
                  cacheWillUpdate: async ({ response }) =>
                    response &&
                    response.status === 200 &&
                    /javascript|ecmascript/i.test(response.headers.get('content-type') || '')
                      ? response
                      : null,
                },
              ],
            },
          },
        ],
      },
    }),
    keepSourcemapsOutOfDeploy(),
  ],
  build: {
    outDir: OUT_DIR,
    target: 'es2020',
    sourcemap: 'hidden',
    rollupOptions: {
      input: 'index.html',
      output: { manualChunks },
    },
    chunkSizeWarningLimit: 500,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
