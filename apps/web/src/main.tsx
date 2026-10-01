/// <reference types="vite-plugin-pwa/client" />
import "@fontsource-variable/geist";
import "@fontsource-variable/inter";
import "katex/dist/katex.min.css";
import { ThemeProvider } from "next-themes";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { setupServiceWorkerUpdates } from "./pwa/sw-updates";
import "./styles.css";
import { initPalette } from "./theme/palette";
import { reloadForChunkErrorIfSafe, trackPageLeaving, watchSaveProblems } from "./utils/app-health";
import { diag } from "./utils/diag";
import { installGlobalErrorCapture, recordDiagnostic } from "./utils/diagnostics";

// Local, privacy-safe error capture (utils/diagnostics.ts): uncaught errors,
// unhandled rejections and failed/refused/conflicted saves go into a small ring
// a user can copy from the crash screen or Help ▸ About. Nothing is sent.
installGlobalErrorCapture();
watchSaveProblems();

// Apply the persisted accent palette before first paint (no FOUC).
initPalette();

// A lazy chunk Vite's preload helper could not fetch (offline, or a stale
// deploy). It used to reload unconditionally — offline too, onto the browser's
// error page — and over whatever the user was typing. Now the reload happens
// only when it can help and cannot hurt (online, nothing unsaved, not a loop);
// otherwise the error reaches the code that asked for the chunk, which says
// what happened (LazyChunkBoundary, the export handlers).
trackPageLeaving();
window.addEventListener("vite:preloadError", (event) => {
  recordDiagnostic({ kind: "chunk", error: (event as Event & { payload?: unknown }).payload });
  if (reloadForChunkErrorIfSafe()) event.preventDefault();
});

// PWA updates: a new version WAITS and the user is told; nothing force-reloads
// an open tab (src/pwa/sw-updates.ts). No-op where service workers are missing
// and under `vite dev`.
if ("serviceWorker" in navigator) setupServiceWorkerUpdates(registerSW);

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
