/**
 * Service-worker-side navigation handling and housekeeping, imported into the
 * generated Workbox SW (see vite.app.config.ts → workbox.importScripts).
 *
 * WHAT IT NO LONGER DOES: on activation it used to re-navigate every open
 * window to its own URL. That unstuck pages an old worker had stranded on stale
 * HTML, but it also force-reloaded every healthy tab on every deploy — undo
 * history, an IME composition and open dialogs gone, mid-sentence. A new worker
 * now waits for the user (registerType "prompt", src/pwa/sw-updates.ts), and a
 * page that genuinely cannot boot is recovered by the inline watchdog in
 * index.html, which knows whether its own scripts failed.
 *
 * WHAT IT DOES:
 *  1. Navigations — `self.pfNavigate`, called by the runtime route in
 *     vite.app.config.ts. The network is asked first, so an online visitor always
 *     gets the current HTML. If it fails, takes over 3 s, or answers with a 5xx,
 *     the page is served from THIS worker's precached index.html — whose hashed
 *     chunks sit in the same precache. The old fallback was a runtime cache of
 *     whatever HTML was fetched last, which after a deploy could name chunks this
 *     worker had never cached: a blank page, offline.
 *  2. On activation, delete that old `app-shell` runtime cache. Nothing reads it
 *     now, and what it holds is exactly the mismatched HTML described above.
 */

var PF_NAV_TIMEOUT_MS = 3000;

/** This worker's precached app shell, or undefined. */
function pfPrecachedShell() {
  // Workbox's default precache name: "<prefix>-precache-v2-<scope>". A waiting
  // worker's install can add a second index.html revision to the same cache;
  // `match` returns the one inserted first, which is the ACTIVE worker's until
  // that worker is replaced — and activation deletes the old revision.
  var name = "workbox-precache-v2-" + self.registration.scope;
  return caches
    .has(name)
    .then(function (exists) {
      if (!exists) return undefined;
      return caches.open(name).then(function (cache) {
        return cache.match(new URL("index.html", self.registration.scope).href, { ignoreSearch: true });
      });
    })
    .catch(function () {
      return undefined;
    });
}

self.pfNavigate = function pfNavigate(request) {
  var network = fetch(request);
  var timer;
  var timeout = new Promise(function (resolve) {
    timer = setTimeout(resolve, PF_NAV_TIMEOUT_MS, null);
  });
  var fallBack = function () {
    return pfPrecachedShell().then(function (shell) {
      if (shell) {
        network.catch(function () {}); // it may still settle; nobody is waiting
        return shell;
      }
      return network; // nothing precached (first visit): the network is all there is
    });
  };
  return Promise.race([network, timeout]).then(
    function (response) {
      clearTimeout(timer);
      if (!response) return fallBack(); // too slow
      if (response.status >= 500) {
        // A hosting outage: an installed app should still open.
        return pfPrecachedShell().then(function (shell) {
          return shell || response;
        });
      }
      return response;
    },
    function () {
      clearTimeout(timer);
      return fallBack(); // offline, DNS failure, connection refused
    }
  );
};

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.delete("app-shell").catch(function () {
      return false;
    })
  );
});
