// Probe (not a suite): what an AUTOSAVE of a large document costs the page
// (A083). Opens the mixed document (e2e/docs.mjs), slows the CPU, and in each
// round types one word in the rich pane, then watches the window in which the
// autosave runs (it fires AUTOSAVE_MS = 5 s after the last edit): the long
// tasks that start in it are what a person typing would feel as a freeze. The
// first round also records a version-history snapshot (at most one per 90 s).
//   KB=4000 ROUNDS=4 THROTTLE=4 DIR=<dist-app> node e2e/probes/autosave-cost.mjs
import { serve, open, boot, seed, APP_DIR } from "../lib.mjs";
import { mixedDoc } from "../docs.mjs";

const DIR = process.env.DIR || APP_DIR;
const KB = Number(process.env.KB || 4000);
const ROUNDS = Number(process.env.ROUNDS || 4);
const THROTTLE = Number(process.env.THROTTLE || 4);
const srv = await serve(DIR);
const { browser, page: pg, cdp } = await open(srv.port, { cdp: true });
await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "networkidle" });
await pg.waitForTimeout(2000);
const doc = mixedDoc("save-large", "Save large", KB);
const start = { id: "save-start", title: "Save start", canonical: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Start." }] }] } };
await seed(pg, [start, doc]);
await pg.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open("perssonify-docs");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  await new Promise((res, rej) => {
    const tx = db.transaction(["meta"], "readwrite");
    tx.objectStore("meta").put(JSON.stringify({ lastActiveDocId: "save-start" }), "__prefs");
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
  db.close();
  localStorage.setItem("pf:tour-seen-v1", "1");
});
await boot(pg, srv.port, { mode: "Split", settle: 3000 });
await pg.locator(`text=${doc.title}`).first().click({ timeout: 60000 });
const blocks = doc.canonical.content.length;
for (let i = 0; i < 1800; i++) {
  const ok = await pg.evaluate((n) => (document.querySelector(".ProseMirror")?.childElementCount ?? 0) >= n, blocks).catch(() => false);
  if (ok) break;
  await pg.waitForTimeout(500);
}
await pg.waitForTimeout(8000); // the load's own work, and the model's preparation
// SHIM=1 (an experiment): give the rich pane a `selectionStart`, which makes
// React read that instead of walking the editor's DOM to save the caret before
// each commit.
if (process.env.SHIM === "1") {
  await pg.evaluate(() => {
    const el = document.querySelector(".ProseMirror");
    for (const k of ["selectionStart", "selectionEnd"]) Object.defineProperty(el, k, { configurable: true, get: () => 0, set: () => {} });
  });
}
await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
await pg.evaluate(() => {
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ start: e.startTime, ms: e.duration }); }).observe({ entryTypes: ["longtask"] }); } catch {}
});
await pg.locator(".ProseMirror").first().click();
await pg.keyboard.press("Control+End");
await pg.waitForTimeout(8000); // let that click's own layout and its save settle

// PROFILE=<file>: a CPU profile of every round after the first (which also
// records a snapshot), for DevTools or a sourcemapped summary.
if (process.env.PROFILE) {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
}
const rounds = [];
for (let r = 0; r < ROUNDS; r++) {
  if (process.env.PROFILE && r === 1) await cdp.send("Profiler.start");
  await pg.keyboard.type(`word${r} `, { delay: 30 });
  const typedAt = await pg.evaluate(() => performance.now());
  // The autosave fires 5 s after the last edit; give it time to finish.
  await pg.waitForTimeout(Number(process.env.WINDOW_MS || 20000));
  const tasks = await pg.evaluate((t) => window.__lt.filter((e) => e.start >= t + 4000), typedAt);
  rounds.push({
    round: r + 1,
    longestMs: Math.round(Math.max(0, ...tasks.map((e) => e.ms))),
    blockingMs: Math.round(tasks.reduce((a, e) => a + Math.max(0, e.ms - 50), 0)),
    tasks: tasks.length,
  });
  await pg.evaluate(() => { window.__lt = []; });
}
if (process.env.PROFILE) {
  const { profile } = await cdp.send("Profiler.stop");
  (await import("node:fs")).writeFileSync(process.env.PROFILE, JSON.stringify(profile));
}
await browser.close();
srv.close();
console.log(`\n=== autosave of a ${KB} KB document at ${THROTTLE}x CPU (${DIR}) ===`);
for (const r of rounds) console.log(`round ${r.round}: longest task ${r.longestMs} ms, blocking ${r.blockingMs} ms, ${r.tasks} long tasks`);
