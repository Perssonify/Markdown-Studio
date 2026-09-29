import tailwindcss from "@tailwindcss/vite";
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { manualChunks } from './vite.chunks';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    tailwindcss(),
    // Standalone app only (the embeddable library build in vite.config.ts gets no
    // service worker). Precaches the app shell + all chunks so the client-only
    // editor loads and works fully offline across reloads. `autoUpdate` +
    // cleanupOutdatedCaches means a new deploy silently replaces the old cache.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
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
        // SW-side rescue for pages stranded by an older worker (stale HTML →
        // blank screen). See public/sw-recover.js.
        importScripts: ['sw-recover.js'],
        // Precache only immutable assets (CSS/fonts/icons). index.html is
        // deliberately NOT precached: precaching it froze users onto an old
        // build until the SW updated AND the tab reloaded — the "my changes
        // never shipped" failure. Instead navigations are NetworkFirst (below):
        // online users always get the current HTML (and therefore the current
        // hashed chunks); offline falls back to the last cached shell.
        // webp/jpg included: the first-run document's brand marks are self-hosted
        // (they used to be fetched from S3, which broke the offline promise and
        // made the very first screen phone out to a third party).
        globPatterns: ['**/*.{css,woff,woff2,ttf,svg,png,ico,webp,jpg,jpeg}'],
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        // Take over immediately on a new deploy; paired with the
        // controllerchange reload in main.tsx.
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // Navigations: fresh HTML when online (3s budget), cached shell
            // offline. This is what makes deploys reach users deterministically.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-shell',
              networkTimeoutSeconds: 3,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Hashed, immutable JS chunks → CacheFirst. Core chunks are cached on
            // the first successful load (so reloads work offline); lazy renderer
            // chunks are cached the first time that feature is used.
            urlPattern: ({ sameOrigin, request }) =>
              sameOrigin && request.destination === 'script',
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-scripts',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist-app',
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
