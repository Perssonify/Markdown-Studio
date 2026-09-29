import "@fontsource-variable/geist";
import "@fontsource-variable/inter";
import "katex/dist/katex.min.css";
import { ThemeProvider } from "next-themes";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { initPalette } from "./theme/palette";
import { diag } from "./utils/diag";

// Apply the persisted accent palette before first paint (no FOUC).
initPalette();

// Stale-deploy recovery: a lazy import() of a hashed chunk that a previous
// deploy has purged (the cached index.html still points at the old hash) fails
// with a `vite:preloadError`. Reload once to pull the fresh index + current
// chunk hashes. A 10s throttle in sessionStorage prevents any reload loop.
const PRELOAD_RELOAD_AT = "pf:preload-reload-at";
window.addEventListener("vite:preloadError", (event) => {
  const last = Number(sessionStorage.getItem(PRELOAD_RELOAD_AT) || "0");
  if (Date.now() - last < 10_000) return; // already reloaded very recently — don't loop
  sessionStorage.setItem(PRELOAD_RELOAD_AT, String(Date.now()));
  event.preventDefault();
  location.reload();
});

// PWA update delivery. The service worker (vite.app.config.ts) uses autoUpdate +
// skipWaiting + clientsClaim, so a new deploy installs and activates a fresh SW
// in the background — but WITHOUT this, an already-open tab keeps rendering the
// previously-cached build until a manual hard-reload, which reads as "my changes
// never shipped". When the new SW takes control (`controllerchange`), reload once
// so the tab picks up the new app. Guards: skip the first-install claim (no prior
// controller) and never loop.
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded || !hadController) return;
    reloaded = true;
    location.reload();
  });
}

// Tell the index.html boot watchdog the bundle is alive (see the inline
// script there — it self-heals stale-service-worker blank loads otherwise).
(window as unknown as { __PF_BOOTED?: boolean }).__PF_BOOTED = true;

diag("BOOT", "main.jsx executing, creating root");
const root = document.getElementById("root");
diag("BOOT", "root element", root ? "found" : "MISSING");

createRoot(root!).render(
/* `disableTransitionOnChange`: next-themes suppresses transitions for the one
   frame the class swaps. Without it the switch read as several stuttered steps,
   because only SOME of the page could animate — `body.pf-app` declared
   `transition: background-color`, while the page background is painted by a
   `background-image` gradient (`--noise-bg`) that a background-color transition
   cannot touch, and descendant cards, borders and pane headers had no
   transition at all. A partial fade looks worse than a coherent instant swap,
   and making every descendant fade would cost a transition on everything. */
<ThemeProvider
    attribute="class"
    defaultTheme="system"
    storageKey="perssonify-theme"
    enableSystem
    disableTransitionOnChange
>
    <App />
</ThemeProvider>
);

diag("BOOT", "render() called");
