import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync, renameSync } from "fs";
import path from "path";
import { defineConfig, type Plugin } from "vite";
import { manualChunks } from "./vite.chunks";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

/**
 * Emit the embed shell as `index.html` (Vite names the HTML output after the
 * source basename, which must stay `embed.html` to avoid colliding with the app's
 * root index.html). Renaming after the bundle is written lets a host serve the
 * `dist-embed/` directory directly — an iframe pointed at the folder resolves to
 * index.html, no `/embed.html` suffix or server rewrite needed.
 */
function embedHtmlAsIndex(): Plugin {
  const outDir = path.resolve(__dirname, "dist-embed");
  return {
    name: "embed-html-as-index",
    closeBundle() {
      const from = path.join(outDir, "embed.html");
      const to = path.join(outDir, "index.html");
      if (existsSync(from)) renameSync(from, to);
    },
  };
}

/**
 * Iframe embed build → `dist-embed/`.
 *
 * Entry: embed.html → src/embed.tsx (the host-bridge shell that reads URL params).
 * Uses a RELATIVE base ("./") so the built assets resolve no matter what path a
 * host serves the embed from (e.g. /editor/, /meridien/editor/, a CDN subfolder).
 * Deliberately has NO service worker — an embedded iframe must not register one;
 * the standalone app (vite.app.config.ts) owns the PWA.
 */
export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), tailwindcss(), embedHtmlAsIndex()],
  build: {
    outDir: "dist-embed",
    target: "es2020",
    sourcemap: "hidden",
    rollupOptions: {
      // Source stays embed.html (root index.html is the standalone app); the
      // embedHtmlAsIndex plugin renames the output to dist-embed/index.html.
      input: "embed.html",
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
