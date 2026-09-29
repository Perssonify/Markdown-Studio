# Runbook — Stuck Service Worker / "My Update Never Arrives"

## How updates are delivered (so you know what "stuck" means)
The standalone app registers a service worker (`vite-plugin-pwa`,
`registerType: "prompt"`). After a deploy:

1. The browser finds the new `sw.js` (it is served `no-cache`) on a navigation,
   or through the open tab's own check, which runs every hour while the tab is
   online and visible — the app's route changes are `pushState`, not
   navigations, so without it a long-lived tab never looked. The new worker
   installs in the background, precaching every chunk.
2. The new worker **waits**. The tab shows a notice, **"A new version of
   Markdown Studio is ready"**, with a **Reload** button. Nothing reloads by
   itself; pressed offline, Reload waits for a connection.
3. It takes over when the user presses **Reload**, or when every tab of the app
   has been closed. Other open tabs are then told "Markdown Studio was updated
   in another tab"; one reloads by itself only when it is online, has nothing
   unsaved and is in the background
   ([src/pwa/sw-updates.ts](../../src/pwa/sw-updates.ts)).

So "I don't see the new version" in an open tab is usually step 2 working as
designed. Navigations are network-first, so a *fresh* page load online gets the
current HTML; when the network fails, takes more than 3 s or answers 5xx, the
worker serves its own precached shell
([public/sw-recover.js](../../public/sw-recover.js)).

## Symptoms that are NOT working as designed
- A blank page that stays blank after reloads.
- The update prompt never appears although a deploy happened hours ago and the
  tab has been reloaded.
- The app works offline but shows an old version long after every tab was closed.

## Diagnosis
Ask for **Copy diagnostics** (entries of kind `sw` = registration/update errors;
`boot` = the watchdog recovered a load). Then, in DevTools on the app's origin:

- **Application ▸ Service workers**: which worker is *active*, is one *waiting*
  ("waiting to activate"), and are there errors in its console (click the
  worker's "inspect")?
- **Application ▸ Cache storage**: `workbox-precache-v2-…` should hold
  `index.html` plus the `assets/*.js` of the ACTIVE version.
- **Network**: reload with the network panel open — `sw.js` must come back
  `200` (not from cache), and `/assets/*.js` must be `200` with a JavaScript
  content type. A `404` for an asset is expected only for a *removed* old
  chunk; a `200 text/html` for an asset means the SPA rewrite is wrong again
  (`vercel.json` must exclude `assets/`).

## Remediation
- **One user, waiting worker**: press Reload in the prompt, or close every tab
  of the app and reopen it.
- **One user, genuinely stuck**: DevTools ▸ Application ▸ Service workers ▸
  **Unregister**, then Storage ▸ **Clear site data but keep IndexedDB and local
  storage** — i.e. clear only *Cache storage*. Never tell a user to "clear site
  data" wholesale: that deletes their documents.
- **Blank page after a deploy, many users**: the inline boot watchdog recovers
  automatically when it has EVIDENCE — a script or stylesheet that failed to
  load, or an uncaught error from the app's own bundle (a file under
  `/assets/`) before boot — and, after a 4 s grace period, only while the
  browser is online: it unregisters the worker, clears Cache Storage (never
  documents), leaves a `pf:boot-recovered` note and reloads once (at most every
  30 s). A slow load with no such evidence is left alone. If blank pages
  persist, it is a broken deploy: [deploy-broken.md](deploy-broken.md) — roll
  back first.
- **A broken worker shipped**: deploy a fixed build. Navigations are network
  first, so pages load the new HTML online even while the old worker controls
  them; the new worker installs and prompts. In an emergency a *self-destroying*
  worker (vite-plugin-pwa `selfDestroying: true`) can be deployed to remove it
  everywhere on next visit — the app then runs without offline support until a
  normal build is deployed again.

## Escalation
File an issue with the diagnostics text, the Service-workers panel state and the
browser/version. Code: [public/sw-recover.js](../../public/sw-recover.js),
[vite.app.config.ts](../../vite.app.config.ts), [src/pwa/sw-updates.ts](../../src/pwa/sw-updates.ts),
and the watchdog in [index.html](../../index.html).
