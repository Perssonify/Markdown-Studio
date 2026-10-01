// Probe: the storage-durability and trust fixes in a real Chromium, against
// the PRODUCTION app build (dist-app). Audit findings A004 A017 A022 A023 A076
// A077 A078 A081. Not wired into run.mjs — run it by hand after build:app:
//
//   node e2e/probes/g4-durability-trust.mjs
//
// Covers what jsdom cannot: the real IndexedDB boot path (the wiped-library
// check runs before seeding), the CSP that blocks remote images, the Referer
// actually sent, Base UI stacking a confirm over the Version history sheet, a
// real download for the backup record, and the page at the old origin.
import { chromium } from "playwright-core";
import http from "node:http";
import { APP_DIR, boot, chromePath, open, runCase, serve, until } from "../lib.mjs";

const DAY = 86_400_000;

/** A second origin (another port) that counts requests and records Referer. */
async function imageHost() {
  const hits = [];
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
  const srv = http.createServer((q, r) => {
    hits.push({ url: q.url, referer: q.headers.referer ?? null });
    r.writeHead(200, { "content-type": q.url.endsWith(".png") ? "image/png" : "text/markdown" });
    r.end(q.url.endsWith(".png") ? png : "# Remote notes\n");
  });
  await new Promise((res) => srv.listen(0, "127.0.0.1", res));
  return { port: srv.address().port, hits, close: () => srv.close() };
}

const idbDocTitles = (page) =>
  page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("perssonify-docs");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    if (!db.objectStoreNames.contains("meta")) { db.close(); return []; }
    const raw = await new Promise((res) => {
      const q = db.transaction("meta", "readonly").objectStore("meta").get("__manifest");
      q.onsuccess = () => res(q.result);
      q.onerror = () => res(null);
    });
    db.close();
    return raw ? JSON.parse(raw).documents.map((d) => d.title) : [];
  });

const notice = (page, label) => page.locator(`[data-durability-notice="${label}"]`);
const skipTour = (page) => page.addInitScript(() => { try { localStorage.setItem("pf:tour-seen-v1", "1"); } catch { /* */ } });

runCase("g4-durability-trust", async (rep, onClose) => {
  const srv = await serve(APP_DIR);
  const img = await imageHost();
  onClose(async () => { srv.close(); img.close(); });
  const base = `http://127.0.0.1:${srv.port}`;

  // ── 1. A normal first visit ──────────────────────────────────────────────
  {
    const { page: pg } = await open(srv.port, { label: "first visit" });
    await skipTour(pg);
    await boot(pg, srv.port, { mode: "Split", settle: 6000 });
    rep.check("first visit: starter documents seeded as usual",
      await until(async () => (await idbDocTitles(pg)).length >= 3), JSON.stringify(await idbDocTitles(pg)));
    rep.check("first visit: canary records the library",
      await until(async () => (await pg.evaluate(() => JSON.parse(localStorage.getItem("pf:library-canary") || "{}").count)) >= 3));
    rep.check("first visit: no durability notice on day one", (await pg.locator("[data-durability-notice]").count()) === 0);
    rep.check("first visit: no referrer policy leak", (await pg.evaluate(() => document.querySelector('meta[name="referrer"]')?.content)) === "no-referrer");

    // Type → autosave → the first successful save asks for persistence.
    await pg.locator(".ProseMirror").first().click();
    await pg.keyboard.press("Control+End");
    await pg.keyboard.type(" durability probe");
    rep.check("first save: content time recorded and persist() requested",
      await until(async () => pg.evaluate(() => !!localStorage.getItem("pf:content-since") &&
        (!!localStorage.getItem("pf:persist-requested-at") || navigator.storage.persisted())), { timeout: 20000 }));

    // Settings: storage/privacy sections, no Admin in a production build.
    await pg.locator('button[aria-label="Settings"]').first().click();
    await until(async () => (await pg.getByText("Storage & backup").count()) > 0);
    rep.check("settings: persistence status shown",
      await until(async () => /^(On|Off|Not supported)/.test((await pg.getByTestId("persistence-status").textContent()) || "")),
      await pg.getByTestId("persistence-status").textContent());
    rep.check("settings: usage from estimate() shown", (await pg.getByText(/^Using .* this browser allows/).count()) > 0);
    rep.check("settings: Privacy has the relay and remote-image switches",
      (await pg.getByRole("switch", { name: "Import relay" }).count()) === 1 &&
      (await pg.getByRole("switch", { name: "Block remote images" }).count()) === 1);
    rep.check("settings: no Admin section in production", (await pg.getByText("Diagnostics console").count()) === 0);
    await pg.keyboard.press("Escape");
    await pg.waitForTimeout(400);

    // View menu: no ads in production.
    await pg.getByRole("button", { name: "View", exact: true }).click();
    await until(async () => (await pg.getByText("Focus mode").count()) > 0);
    rep.check("view menu: no Show ads item in production", (await pg.getByText("Show ads").count()) === 0);
    await pg.keyboard.press("Escape");

    // Full backup → a real download → recorded for the reminder.
    const [download] = await Promise.all([
      pg.waitForEvent("download", { timeout: 20000 }),
      (async () => {
        // Role locators: the Welcome document itself contains a bold "Export".
        await pg.getByRole("button", { name: "File", exact: true }).click();
        await pg.getByRole("menuitem", { name: "Export", exact: true }).hover();
        await pg.getByRole("menuitem", { name: /Full backup \(\.zip\)/ }).click();
      })(),
    ]);
    rep.check("backup: a perssonify-backup ZIP downloads", /^perssonify-backup-\d{8}-\d{9}\.zip$/.test(download.suggestedFilename()), download.suggestedFilename());
    rep.check("backup: its time is recorded",
      await until(async () => !!(await pg.evaluate(() => localStorage.getItem("pf:last-full-backup")))));

    // The licence notice ships with the build.
    const notices = await pg.evaluate(async () => { const r = await fetch("/third-party-licenses.txt"); return { ok: r.ok, text: await r.text() }; });
    rep.check("licences: /third-party-licenses.txt is served", notices.ok && notices.text.startsWith("THIRD-PARTY SOFTWARE NOTICES"));
    rep.check("licences: fonts carry the OFL text", notices.text.includes("SIL OPEN FONT LICENSE Version 1.1"));

    // Delete a document (bulk path) → truthful wording → its snapshot is kept →
    // deleting THAT is confirmed, over the open Version history sheet.
    await pg.getByRole("button", { name: "Select documents" }).click();
    await pg.locator('button[title="Changelog"]').first().click();
    await pg.getByRole("button", { name: "Delete 1 selected" }).click();
    const dlg = pg.getByRole("alertdialog");
    await until(async () => (await dlg.count()) > 0);
    const wording = (await dlg.textContent()) || "";
    rep.check("delete: dialog says where the copy is, not 'cannot be undone'",
      /Version history/.test(wording) && !/cannot be undone/.test(wording), wording);
    await dlg.getByRole("button", { name: "Delete" }).click();
    await until(async () => !(await idbDocTitles(pg)).includes("Changelog"));

    await pg.getByRole("button", { name: "Tools", exact: true }).click();
    await pg.getByRole("menuitem", { name: "Version history…" }).click();
    await until(async () => (await pg.getByText("Other & deleted documents").count()) > 0);
    rep.check("history: the deleted document is listed and marked", (await pg.getByText("deleted", { exact: true }).count()) > 0);
    const rows = () => pg.getByRole("button", { name: "Delete this version" });
    const before = await rows().count();
    await rows().last().click();
    await until(async () => (await pg.getByRole("alertdialog").count()) > 0);
    const confirmText = (await pg.getByRole("alertdialog").textContent()) || "";
    rep.check("history: deleting the last copy of a deleted document is confirmed, and says so",
      /last remaining copy/.test(confirmText), confirmText);
    await pg.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
    await pg.waitForTimeout(500);
    rep.check("history: cancelling keeps it (and the sheet stays open)", (await rows().count()) === before && (await pg.getByText("Other & deleted documents").count()) > 0);
    await rows().last().click();
    await until(async () => (await pg.getByRole("alertdialog").count()) > 0);
    await pg.getByRole("alertdialog").getByRole("button", { name: "Delete version" }).click();
    rep.check("history: confirming deletes it", await until(async () => (await rows().count()) === before - 1));
  }

  // ── 2. A library the browser emptied ─────────────────────────────────────
  {
    const { page: pg } = await open(srv.port, { label: "wiped library" });
    await skipTour(pg);
    await pg.addInitScript((day) => {
      if (sessionStorage.getItem("g4-canary")) return;
      sessionStorage.setItem("g4-canary", "1");
      localStorage.setItem("pf:library-canary", JSON.stringify({ count: 5, at: Date.now() - 3 * day }));
    }, DAY);
    await boot(pg, srv.port, { mode: null, settle: 6000 });
    rep.check("wipe: explained instead of greeted as new",
      await until(async () => /held 5 documents/.test((await notice(pg, "Library cleared").textContent().catch(() => "")) || "")));
    rep.check("wipe: starter documents NOT seeded into it", (await idbDocTitles(pg)).length === 0, JSON.stringify(await idbDocTitles(pg)));
    await pg.reload({ waitUntil: "networkidle" });
    await pg.waitForTimeout(5000);
    rep.check("wipe: a reload keeps the explanation", (await notice(pg, "Library cleared").count()) === 1);
    await pg.getByRole("button", { name: "Start fresh" }).click();
    rep.check("wipe: 'Start fresh' dismisses it", await until(async () => (await notice(pg, "Library cleared").count()) === 0));
    await pg.reload({ waitUntil: "networkidle" });
    rep.check("wipe: after 'Start fresh' the next visit is a normal first run",
      await until(async () => (await idbDocTitles(pg)).length >= 3, { timeout: 20000 }));
  }

  // ── 3. Storage blocked altogether ────────────────────────────────────────
  {
    const { page: pg } = await open(srv.port, { label: "blocked storage", ignoreErrors: [/indexedDB|IndexedDB|storage|SecurityError/i] });
    await pg.addInitScript(() => {
      indexedDB.open = () => { throw new DOMException("The user denied permission", "SecurityError"); };
    });
    await boot(pg, srv.port, { mode: null, settle: 8000 });
    const alert = pg.locator('[data-durability-notice="Not saving"]');
    rep.check("blocked: 'Not saving' banner shown", await until(async () => (await alert.count()) === 1));
    rep.check("blocked: it cannot be dismissed", (await alert.locator("button").count()) === 0);
  }

  // ── 4. Remote images: Referer, then blocking ─────────────────────────────
  {
    const imgUrl = `http://127.0.0.1:${img.port}/pixel.png`;
    for (const block of [false, true]) {
      const { page: pg } = await open(srv.port, { label: block ? "remote images blocked" : "remote images allowed", ignoreErrors: [/Content Security Policy|img-src/i] });
      await skipTour(pg);
      await pg.addInitScript((b) => { localStorage.setItem("pf:block-remote-images", String(b)); }, block);
      await boot(pg, srv.port, { mode: "Split", settle: 6000 });
      const hitsBefore = img.hits.length;
      await pg.locator(".cm-content").first().click();
      await pg.keyboard.press("Control+End");
      await pg.keyboard.type(`\n\n![pixel](${imgUrl}?b=${block})\n`);
      await pg.waitForTimeout(3000);
      const hits = img.hits.slice(hitsBefore).filter((h) => h.url.includes(`b=${block}`));
      if (block) {
        rep.check("images: blocked — the remote host is never contacted", hits.length === 0, JSON.stringify(hits));
        rep.check("images: blocked — CSP installed", (await pg.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content)) === "img-src 'self' data: blob:");
      } else {
        rep.check("images: allowed — the image loads", hits.length > 0);
        rep.check("images: allowed — sent with no Referer", hits.length > 0 && hits.every((h) => h.referer === null), JSON.stringify(hits));
      }
    }
  }

  // ── 5. Relay consent on a CORS-blocked import ─────────────────────────────
  // The importer refuses localhost outright, so a public-looking name is mapped
  // to the image host (which sends no CORS headers → the browser blocks it).
  {
    const browser = await chromium.launch({
      executablePath: chromePath(),
      args: [`--host-resolver-rules=MAP notes.example.org 127.0.0.1`],
    });
    onClose(() => browser.close());
    const pg = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await skipTour(pg);
    await boot(pg, srv.port, { mode: "Split", settle: 6000 });
    await pg.getByRole("button", { name: "File", exact: true }).click();
    await pg.getByRole("menuitem", { name: "Import", exact: true }).hover();
    await pg.getByRole("menuitem", { name: "From URL…" }).click();
    await pg.getByPlaceholder(/example\.com/).fill(`http://notes.example.org:${img.port}/notes.md`);
    await pg.getByRole("button", { name: "Continue" }).click();
    rep.check("relay: asks before using our server",
      await until(async () => (await pg.getByText("Fetch this link through our server?").count()) > 0));
    await pg.getByRole("button", { name: "Don't use the server" }).click();
    rep.check("relay: a 'no' stays local and says where to change it",
      await until(async () => (await pg.getByText(/Settings ▸ Privacy/).count()) > 0));
    rep.check("relay: the answer is remembered", (await pg.evaluate(() => localStorage.getItem("pf:import-relay"))) === "deny");
  }

  // ── 6. The old origin ─────────────────────────────────────────────────────
  {
    const browser = await chromium.launch({
      executablePath: chromePath(),
      args: [`--host-resolver-rules=MAP markdowneditor.perssonify.com 127.0.0.1`],
    });
    onClose(() => browser.close());
    const pg = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await skipTour(pg);
    await pg.goto(`http://markdowneditor.perssonify.com:${srv.port}/`, { waitUntil: "networkidle" });
    rep.check("old origin: the move is announced",
      await until(async () => /moved to markdownstudio\.com/.test((await notice(pg, "Markdown Studio has moved").textContent().catch(() => "")) || ""), { timeout: 20000 }));
    const [dl] = await Promise.all([
      pg.waitForEvent("download", { timeout: 20000 }),
      notice(pg, "Markdown Studio has moved").getByRole("button", { name: /Download backup/ }).click(),
    ]);
    rep.check("old origin: one click downloads the full backup", /^perssonify-backup-/.test(dl.suggestedFilename()), dl.suggestedFilename());
    rep.check("old origin: then points at the next step",
      await until(async () => /You downloaded a full backup today/.test((await notice(pg, "Markdown Studio has moved").textContent()) || "")));
  }
  void base;
});
