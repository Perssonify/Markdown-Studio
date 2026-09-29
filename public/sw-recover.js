/**
 * Service-worker-side recovery, imported into the generated Workbox SW
 * (see vite.app.config.ts → workbox.importScripts).
 *
 * Problem it solves: pages loaded under an OLD service worker can be served
 * stale HTML whose hashed entry script no longer exists on the current
 * deployment — a hard blank screen. Those pages predate every in-page
 * recovery hook, so the only code that can still reach them is the NEW
 * service worker that replaces the old one.
 *
 * On activation, when this worker replaced a predecessor, it re-navigates all
 * open window clients to their current URL — a one-shot refresh that pulls
 * fresh HTML through the NetworkFirst navigation route. First-ever installs
 * (no predecessor) never trigger it, so brand-new visitors see no reload.
 */
let pfHadPredecessor = false;

self.addEventListener("install", () => {
  pfHadPredecessor = !!(self.registration && self.registration.active);
});

self.addEventListener("activate", (event) => {
  if (!pfHadPredecessor) return;
  event.waitUntil(
    (async () => {
      try {
        if (self.clients && self.clients.claim) await self.clients.claim();
        const clients = await self.clients.matchAll({ type: "window" });
        await Promise.all(
          clients.map((c) =>
            c.navigate ? c.navigate(c.url).catch(() => {}) : Promise.resolve()
          )
        );
      } catch {
        /* best effort — the page-side watchdog remains the backstop */
      }
    })()
  );
});
