// Tier 4 — fault injection. Break the environment underneath a working app and
// assert the two things that must always hold: the document on screen is never
// destroyed, and a failure the user needs to know about is visible.
import { serve, open, boot, seed, mdText, richText, storedDoc, canonicalText, runCase, until, requireChromium, APP_DIR } from "../lib.mjs";
import { proseDoc } from "../docs.mjs";

const SENT = "FAULTMARK typed under duress. ";

runCase("faults", async (rep, onClose) => {
  // ── storage completely unavailable ──────────────────────────────────────
  // Safari private mode, blocked cookies, a corrupt profile. The editor must
  // still run; it must not white-screen on a rejected indexedDB.open.
  {
    const srv = await serve(APP_DIR);
    const { browser, page: pg, errors } = await open(srv.port, {
      label: "blocked storage",
      // The adapter is EXPECTED to complain here; only a crash is a failure.
      ignoreErrors: [/indexedDB|IndexedDB|storage|SecurityError/i],
    });
    onClose(async () => { await browser.close(); srv.close(); });
    // What a browser with storage disabled actually does: `indexedDB.open`
    // THROWS. (Faking it by firing onerror on a live request left the request
    // unfinished, so the app's own `req.error` read threw — the harness's bug,
    // not the app's.)
    await pg.addInitScript(() => {
      indexedDB.open = () => { throw new DOMException("The user denied permission", "SecurityError"); };
    });
    await boot(pg, srv.port, { mode: "Split", settle: 8000 });
    // Nothing can be READ or WRITTEN, so there are no starter documents — the
    // app opens on its empty state. What must hold is that it is usable and
    // does not white-screen.
    rep.check("blocked storage: the app still mounts its chrome",
      (await pg.locator('button:has-text("Files")').count()) > 0);
    const create = pg.locator('button:has-text("Create New Document")').first();
    if (await create.count()) {
      await create.click();
      await until(async () => (await pg.locator(".ProseMirror").count()) > 0);
    }
    rep.check("blocked storage: a document can still be opened", (await pg.locator(".ProseMirror").count()) > 0);
    await pg.locator(".ProseMirror").first().click().catch(() => {});
    await pg.keyboard.type("typed with no storage");
    rep.check("blocked storage: typing still works",
      await until(async () => (await richText(pg)).includes("typed with no storage")));
    rep.check("blocked storage: the panes still mirror",
      await until(async () => (await mdText(pg)).includes("typed with no storage")));
    // The adapter's open rejects with no consumer yet; without a handler that
    // surfaced as a top-level SecurityError on a page that was otherwise fine.
    rep.check("blocked storage: no uncaught page error", !errors.some((e) => e.startsWith("pageerror")), errors.join(" | "));
  }

  // ── quota exhaustion mid-session ────────────────────────────────────────
  // The document on screen is what the user has; a save that cannot complete
  // must not take it away, and must not be silent.
  {
    const srv = await serve(APP_DIR);
    const { browser, page: pg, errors } = await open(srv.port, {
      label: "quota exhaustion",
      ignoreErrors: [/Quota|quota|save/i],
    });
    onClose(async () => { await browser.close(); srv.close(); });
    await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
    await seed(pg, [proseDoc("aaa", "Alpha doc", 1)]);
    await boot(pg, srv.port, { mode: "Split", settle: 6000 });

    await pg.evaluate(() => {
      window.__quotaOn = true;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (window.__quotaOn && this.name === "documents") {
          throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        }
        return put.apply(this, args);
      };
    });

    await pg.locator(".ProseMirror").first().click();
    await pg.keyboard.press("Control+End");
    await pg.keyboard.type(SENT, { delay: 10 });
    // Wait for the FAILURE to surface rather than for a fixed multiple of the
    // autosave interval — on a slower runner that interval is not the same
    // number of milliseconds.
    const statusText = await until(async () => {
      const t = await pg.evaluate(() => document.querySelector("footer")?.innerText ?? "");
      return /not sav|fail|error|full|storage/i.test(t) ? t : null;
    }, { timeout: 30000 });

    rep.check("quota: the document on screen is intact", (await richText(pg)).includes(SENT.trim()));
    rep.check("quota: the failure is visible in the status bar",
      !!statusText, JSON.stringify(String(statusText).slice(0, 200)));

    // Free the space again — the next save must succeed, not stay parked.
    await pg.evaluate(() => { window.__quotaOn = false; });
    await pg.keyboard.type("recovered.");
    const disk = await until(async () => {
      const d = canonicalText(await storedDoc(pg, "aaa"));
      return d.includes("recovered.") ? d : null;
    }, { timeout: 30000 }) ?? canonicalText(await storedDoc(pg, "aaa"));
    rep.check("quota: saving resumes once there is room again",
      disk.includes("recovered."), disk.slice(-120));
    rep.check("quota: no uncaught page error", !errors.some((e) => e.startsWith("pageerror")), errors.join(" | "));
  }

  // ── beforeunload draft flush ────────────────────────────────────────────
  // The tab-close flush uses patchDocById, which has NO blank guard — a blank
  // canonical the save backstop had refused could reach disk by that route.
  {
    const srv = await serve(APP_DIR);
    const { browser, page: pg } = await open(srv.port, { label: "beforeunload" });
    onClose(async () => { await browser.close(); srv.close(); });
    await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
    await seed(pg, [proseDoc("aaa", "Alpha doc", 1)]);
    await boot(pg, srv.port, { mode: "Split", settle: 6000 });

    await pg.locator(".ProseMirror").first().click();
    await pg.keyboard.press("Control+End");
    await pg.keyboard.type("UNSAVEDONCLOSE", { delay: 10 });
    await pg.waitForTimeout(600);                   // inside the autosave window
    await pg.reload({ waitUntil: "networkidle" });
    await until(async () => canonicalText(await storedDoc(pg, "aaa")).includes("UNSAVEDONCLOSE"),
      { timeout: 30000 });

    const disk = canonicalText(await storedDoc(pg, "aaa"));
    rep.check("reload keeps the unsaved paragraph", disk.includes("UNSAVEDONCLOSE"), disk.slice(-140));
    rep.check("reload does not blank the document",
      disk.length > 200, `${disk.length} characters on disk`);
    rep.check("the reloaded editor shows it too",
      (await richText(pg)).includes("UNSAVEDONCLOSE"));
  }

  // ── multi-tab conflict ──────────────────────────────────────────────────
  // Two tabs editing the same document: the second must park a terminal
  // "conflict" status rather than spin an autosave loop, and must not silently
  // overwrite the other tab's version.
  {
    const srv = await serve(APP_DIR);
    const a = await open(srv.port, { label: "multi-tab" });
    onClose(async () => { await a.browser.close(); srv.close(); });
    await a.page.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
    await seed(a.page, [proseDoc("aaa", "Alpha doc", 1)]);
    await boot(a.page, srv.port, { mode: "Split", settle: 6000 });

    const b = await a.context.newPage();
    await b.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "networkidle" });
    await b.waitForTimeout(7000);

    await a.page.bringToFront();
    await a.page.locator(".ProseMirror").first().click();
    await a.page.keyboard.press("Control+End");
    await a.page.keyboard.type("TAB-A-EDIT", { delay: 10 });
    await until(async () => canonicalText(await storedDoc(a.page, "aaa")).includes("TAB-A-EDIT"),
      { timeout: 30000 });

    await b.bringToFront();
    await b.locator(".ProseMirror").first().click();
    await b.keyboard.press("Control+End");
    await b.keyboard.type("TAB-B-EDIT", { delay: 10 });
    await until(async () => {
      const t = await b.evaluate(() => document.querySelector("footer")?.innerText ?? "");
      return /another tab|conflict|not saving/i.test(t);
    }, { timeout: 30000 });

    const status = await b.evaluate(() => document.querySelector("footer")?.innerText ?? "");
    const disk = canonicalText(await storedDoc(b, "aaa"));
    rep.check("multi-tab: tab A's edit is still on disk", disk.includes("TAB-A-EDIT"), disk.slice(-160));
    rep.check("multi-tab: the second tab reports it is not saving",
      /another tab|conflict|not sav/i.test(status), JSON.stringify(status.slice(0, 200)));
    rep.check("multi-tab: the second tab still shows its own text",
      (await richText(b)).includes("TAB-B-EDIT"));
  }

  // ── a slow device ───────────────────────────────────────────────────────
  // The scheduler adapts to what a projection COSTS here. On a 6× throttled
  // CPU it must still converge — degrading to slower, never to never.
  // (The last block: on an engine without CPU throttling it ends the case.)
  if (!requireChromium(rep, "6× CPU throttle: the panes still converge", "CPU throttling")) return;
  {
    const srv = await serve(APP_DIR);
    const { browser, page: pg } = await open(srv.port, { label: "6x CPU throttle", throttle: 6 });
    onClose(async () => { await browser.close(); srv.close(); });
    await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
    await seed(pg, [proseDoc("aaa", "Alpha doc", 20)]);
    await boot(pg, srv.port, { mode: "Split", settle: 12000 });
    await pg.locator(".cm-content").first().click();
    await pg.keyboard.press("Control+End");
    await pg.keyboard.type("\n\nTHROTTLEDMARK", { delay: 25 });
    // Six times slower is exactly the case a fixed budget gets wrong.
    rep.check("6× CPU throttle: the panes still converge",
      await until(async () => (await richText(pg)).includes("THROTTLEDMARK"), { timeout: 45000 }),
      (await richText(pg)).slice(-100));
    rep.check("6× CPU throttle: the markdown pane kept every character",
      (await mdText(pg)).includes("THROTTLEDMARK"));
  }
});
