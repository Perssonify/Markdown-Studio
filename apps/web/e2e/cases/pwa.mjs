// The service worker, in a real browser: offline after one online visit (A085),
// and updates that never force-reload a tab (A008).
//
// OFFLINE. Before, JavaScript was not precached: offline, ⌘F reloaded the page
// and Find never opened, Word export produced nothing, and a diagram whose
// renderer had not been used online never rendered. Here the app is visited
// ONCE online (nothing lazy is opened), the network is taken away — the page
// is set offline AND the server is killed, so the worker's own fetches fail
// too — and every lazy feature is then used for the first time. They must all
// work, and the page must never reload itself.
//
// UPDATES. Before, a deploy's new worker skipped waiting and every open tab
// was reloaded (controllerchange → location.reload(), plus the worker
// navigating every client). Here a byte-changed sw.js is served and an update
// check triggered: the tab must show the prompt and NOT reload, with a second
// tab holding unsaved typing; pressing Reload in the first tab reloads THAT
// tab, and the dirty second tab is told, not reloaded.
import { serve, open, boot, runCase, until, APP_DIR } from "../lib.mjs";
import { PROBE_MD, allRendered, exportWord, openLazySurfaces, pasteMarkdown, renderers } from "../renderers.mjs";

const controlled = (pg) =>
  pg.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    return !!navigator.serviceWorker.controller;
  });

// The worker's update check cannot reach the network while offline; the
// browser reports that on its own, and it is expected here.
const OFFLINE_NOISE = [/Failed to update a ServiceWorker/i, /ERR_INTERNET_DISCONNECTED/i, /Failed to fetch/i, /net::ERR_/i];

runCase("pwa", async (rep, onClose) => {
  // ── offline ──────────────────────────────────────────────────────────────
  {
    const srv = await serve(APP_DIR);
    const rig = await open(srv.port, { label: "pwa offline", ignoreErrors: OFFLINE_NOISE });
    const { browser, context, page: pg } = rig;
    onClose(async () => { await browser.close(); srv.close(); });

    await boot(pg, srv.port, { mode: "Split", settle: 6000 });
    rep.check("the service worker installs, precaches and controls the first visit",
      await until(() => controlled(pg).catch(() => false), { timeout: 60000 }));

    await context.setOffline(true);
    await srv.kill();
    await pg.reload({ waitUntil: "domcontentloaded" });
    rep.check("offline: the app boots from the worker's precached shell",
      await until(async () => (await pg.locator(".ProseMirror").count()) > 0, { timeout: 30000 }));
    // Not asserted: Playwright's offline emulation does not reliably flip
    // navigator.onLine in a reloaded, worker-controlled page (measured: it stays
    // true). The network is really gone — the server is dead — and the
    // navigator.onLine gates themselves are unit-tested (ops-app-health).
    rep.note(`navigator.onLine after the offline reload: ${await pg.evaluate(() => navigator.onLine)}`);
    await pg.evaluate(() => { window.__noReload = true; });

    // First use of every lazy renderer — while offline.
    await pg.waitForTimeout(1500);
    await pasteMarkdown(pg, PROBE_MD);
    rep.check("offline: KaTeX, Mermaid (dagre and ELK) and abcjs render on first use (chunks from the precache)",
      await until(async () => allRendered(await renderers(pg)), { timeout: 30000 }),
      JSON.stringify(await renderers(pg)));

    const lazy = await openLazySurfaces(pg, until);
    rep.check("offline: ⌘F opens Find, and the map and Cards open", lazy.find && lazy.map && lazy.cards, JSON.stringify(lazy));

    const docx = await exportWord(pg).catch(() => null);
    rep.check("offline: Word export produces a file", !!docx && docx.endsWith(".docx"), String(docx));

    rep.check("offline: nothing reloaded the page", await pg.evaluate(() => window.__noReload === true));
  }

  // ── updates ──────────────────────────────────────────────────────────────
  {
    let version = 0;
    const srv = await serve(APP_DIR, {}, {
      // A byte-different sw.js is, to the browser, a new version of the app.
      transform: (urlPath, buf) => (urlPath === "/sw.js" && version > 0 ? Buffer.concat([buf, Buffer.from(`\n// release ${version}\n`)]) : buf),
    });
    const rig = await open(srv.port, { label: "pwa update" });
    const { browser, context, page: a } = rig;
    onClose(async () => { await browser.close(); srv.close(); });
    // Tab B shares the worker registration (same browser context).
    const b = await context.newPage();
    b.on("pageerror", (e) => rig.errors.push("pageerror (tab B): " + String(e).slice(0, 300)));
    b.on("console", (m) => { if (m.type() === "error") rig.errors.push("console (tab B): " + m.text().slice(0, 300)); });

    await boot(a, srv.port, { mode: "Split", settle: 6000 });
    rep.check("update: the first worker controls tab A", await until(() => controlled(a).catch(() => false), { timeout: 60000 }));
    await b.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "networkidle" });
    rep.check("update: tab B is controlled by the same worker", await until(() => controlled(b).catch(() => false), { timeout: 30000 }));
    await b.waitForTimeout(4000);
    await a.evaluate(() => { window.__tabA = "old"; });
    await b.evaluate(() => { window.__tabB = "old"; });

    // Tab B has unsaved typing the whole time.
    await b.locator(".ProseMirror").first().click();
    await b.keyboard.press("Control+End");
    await b.keyboard.type(" UNSAVED-IN-TAB-B");

    // Deploy: a new worker version, found by an update check.
    version = 1;
    await a.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r && r.update()));
    const prompt = a.locator('[data-sonner-toast]:has-text("A new version of Markdown Studio is ready")');
    rep.check("update: tab A is told a new version is ready", await until(async () => (await prompt.count()) > 0, { timeout: 30000 }));
    await a.waitForTimeout(3000);
    rep.check("update: …and is NOT reloaded by it", await a.evaluate(() => window.__tabA === "old"));
    rep.check("update: tab B (unsaved typing) is not reloaded either", await b.evaluate(() => window.__tabB === "old"));

    // The user presses Reload in tab A.
    await prompt.locator('button:has-text("Reload")').first().click();
    rep.check("update: pressing Reload reloads tab A onto the new worker",
      await until(async () => (await a.evaluate(() => window.__tabA).catch(() => "reloading")) !== "old", { timeout: 30000 }));
    await a.waitForTimeout(2000);
    rep.check("update: tab B, with unsaved typing, is told — not reloaded",
      await until(async () => (await b.locator('[data-sonner-toast]:has-text("updated in another tab")').count()) > 0, { timeout: 20000 }) &&
        (await b.evaluate(() => window.__tabB === "old")));
    rep.check("update: tab B's typing is still on screen",
      (await b.evaluate(() => document.querySelector(".ProseMirror")?.textContent || "")).includes("UNSAVED-IN-TAB-B"));
  }
});
