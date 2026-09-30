// Measurement only — NOT part of the CI suite. Timing on a shared container
// varies by more than 50% run to run, so a wall-clock assertion there would
// flake; this exists to compare two builds under identical conditions.
//
// Dual-pane sync performance. Measures what a user feels:
//   timeToMirrorMs — a character typed in one pane -> visible in the other
//   inputP50/P95   — keydown -> next paint, while typing continuously
//   blockingMs     — main-thread blocking (long-task time over 50ms)
// Usage: DIR=<dist> REPS=3 THROTTLE=4 node e2e/cases/perf.mjs <label> <sizeKb...>
//
// PANE=rich measures the other direction on a LARGE mixed document (A083):
// typing in the rich pane, projected into the markdown pane. Default sizes
// 1600 and 4000 KB. Per size: the median and worst keystroke -> markdown pane
// updated over isolated samples, and the longest main-thread task while typing.
//   DIR=<dist> REPS=1 THROTTLE=4 PANE=rich node e2e/cases/perf.mjs <label> [sizeKb...]
import { serve, open, boot, seed, APP_DIR } from "../lib.mjs";
import { mixedDoc, proseDoc } from "../docs.mjs";
import fs from "node:fs"; import path from "node:path";
const DIR = process.env.DIR || APP_DIR;
const RICH = process.env.PANE === "rich";
const LABEL = process.argv[2] || "run";
const SIZES = (process.argv[3] ? process.argv.slice(3) : RICH ? ["1600", "4000"] : ["1", "10", "50"]).map(Number);
const REPS = Number(process.env.REPS || 1);
const srv = await serve(DIR);

async function once(kb) {
  const { browser, page: pg, errors } = await open(srv.port, { throttle: Number(process.env.THROTTLE || 4) });
  await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "networkidle" });
  await pg.waitForTimeout(2500);
  await seed(pg, [proseDoc("perf-doc", "Perf", kb)]);
  await boot(pg, srv.port, { mode: "Split", settle: 8000 });

  await pg.evaluate(() => {
    window.__p = { long: [], latency: [] };
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__p.long.push(e.duration); }).observe({ entryTypes: ["longtask"] }); } catch {}
    window.__mark = () => { const t0 = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => window.__p.latency.push(performance.now() - t0))); };
  });
  await pg.locator(".cm-content").first().click();
  await pg.keyboard.press("Control+End");
  for (const ch of "The quick brown fox jumps over the lazy dog. ".repeat(3)) {
    await pg.evaluate(() => window.__mark());
    await pg.keyboard.type(ch, { delay: 0 });
  }
  await pg.waitForTimeout(1500);

  // BOTH timestamps are taken inside the page. Stamping "typed at" with a
  // round-trip after typing queues behind the page's own long tasks, so a build
  // that blocked MORE got a later start stamp and a flatteringly smaller mirror
  // time — the metric moved with blocking, not with sync latency.
  const TOKEN = "ZQX" + kb + "MIRROR";
  await pg.evaluate((tok) => {
    window.__m = { last: 0, seen: null };
    document.querySelector(".cm-content").addEventListener("input", () => { window.__m.last = performance.now(); }, true);
    const pm = document.querySelector(".ProseMirror");
    new MutationObserver(() => {
      if (window.__m.seen == null && pm.textContent.includes(tok)) window.__m.seen = performance.now();
    }).observe(pm, { subtree: true, childList: true, characterData: true });
  }, TOKEN);
  await pg.keyboard.type(TOKEN, { delay: 12 });
  let mirrorMs = null;
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const m = await pg.evaluate(() => (window.__m.seen == null ? null : window.__m.seen - window.__m.last));
    if (m != null) { mirrorMs = m; break; }
  }
  const r = await pg.evaluate(() => {
    const lat = window.__p.latency.slice(2).sort((a, b) => a - b);
    const pct = (p) => Math.round(lat[Math.floor(lat.length * p)] || 0);
    const long = window.__p.long;
    return { inputP50: pct(0.5), inputP95: pct(0.95), inputMax: Math.round(lat[lat.length - 1] || 0),
      longTasks: long.length, blockingMs: Math.round(long.reduce((a, d) => a + Math.max(0, d - 50), 0)) };
  });
  await browser.close();
  return { timeToMirrorMs: mirrorMs == null ? 99999 : Math.round(mirrorMs), ...r, errors: errors.length };
}

// The rich pane of a large document -> the markdown pane (PANE=rich).
//
// CodeMirror renders only its viewport, so the markdown pane is scrolled to its
// END and the typing happens at the END of the rich pane: the projection then
// changes the lines CodeMirror is showing, and a MutationObserver sees it.
// Samples are ISOLATED (a pause after each) so each one is a single projection
// rather than a debounce race, and both timestamps are taken in the page.
async function richOnce(kb) {
  // Throttled only for the typing: OPENING a large document is slow for a
  // reason of its own (each code block is a React node view whose mount forces
  // a layout of the whole editor), and at 4x it takes minutes. loadMs is
  // therefore unthrottled.
  const { browser, page: pg, errors, cdp } = await open(srv.port, { cdp: true });
  await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "networkidle" });
  await pg.waitForTimeout(2500);
  const doc = mixedDoc("perf-large", "Perf large", kb);
  // A small document opens at boot, and the large one is opened from the
  // library afterwards: boot() waits for the network to go quiet, which a
  // build that hydrates a large document slowly never gives it in time.
  const start = { id: "perf-start", title: "Perf start", canonical: { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "Start." }] },
  ] } };
  await seed(pg, [start, doc]);
  await pg.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("perssonify-docs");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction(["meta"], "readwrite");
      tx.objectStore("meta").put(JSON.stringify({ lastActiveDocId: "perf-start" }), "__prefs");
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    // The first-run tour starts only once the editor is up — which, for a
    // large document, can be long after boot() has looked for its Skip button.
    localStorage.setItem("pf:tour-seen-v1", "1");
  });
  await boot(pg, srv.port, { mode: "Split", settle: 3000 });
  const t0 = Date.now();
  await pg.locator(`text=${doc.title}`).first().click({ timeout: 60000 });
  // Loaded: every top-level block is in the rich pane and the markdown pane
  // has content.
  const blocks = doc.canonical.content.length;
  const deadline = Date.now() + 900000;
  while (Date.now() < deadline) {
    const ok = await pg.evaluate((n) => {
      const pm = document.querySelector(".ProseMirror");
      const cm = document.querySelector(".cm-content");
      return !!pm && pm.childElementCount >= n && !!cm && cm.textContent.length > 0;
    }, blocks).catch(() => false);
    if (ok) break;
    await pg.waitForTimeout(500);
  }
  const loadMs = Date.now() - t0;
  await pg.waitForTimeout(3000);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.THROTTLE || 4) });

  await pg.locator(".ProseMirror").first().click();
  await pg.keyboard.press("Control+End");
  await pg.waitForTimeout(3000);
  // Long tasks from here on only: the click and the jump to the end lay out
  // the whole document once, which is not what typing costs.
  await pg.evaluate(() => {
    window.__lt = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ entryTypes: ["longtask"] }); } catch {}
  });

  const samples = [];
  for (let i = 0; i < Number(process.env.SAMPLES || 5); i++) {
    const TOKEN = `Q${i}W`; // short: at 4x each keystroke of the old build took seconds
    await pg.evaluate((tok) => {
      const sc = document.querySelector(".cm-scroller");
      if (sc) sc.scrollTop = sc.scrollHeight;
      window.__m = { last: 0, seen: null, lt0: window.__lt.length };
      document.querySelector(".ProseMirror").addEventListener("input", () => { window.__m.last = performance.now(); }, true);
      const cm = document.querySelector(".cm-content");
      new MutationObserver((_, obs) => {
        if (window.__m.seen == null && cm.textContent.includes(tok)) { window.__m.seen = performance.now(); obs.disconnect(); }
      }).observe(cm, { subtree: true, childList: true, characterData: true });
    }, TOKEN);
    await pg.keyboard.type(TOKEN, { delay: 0 });
    let mirror = null;
    // Generous: a build without the per-block projection took tens of seconds
    // per keystroke at 4 MB and 4x.
    const until = Date.now() + Number(process.env.MIRROR_TIMEOUT || 300000);
    while (Date.now() < until) {
      mirror = await pg.evaluate(() => (window.__m.seen == null ? null : window.__m.seen - window.__m.last));
      if (mirror != null) break;
      await pg.waitForTimeout(100);
    }
    samples.push(mirror == null ? 99999 : Math.round(mirror));
    await pg.waitForTimeout(2500); // quiet: the next sample starts from rest
  }
  const lt = await pg.evaluate(() => window.__lt);
  await browser.close();
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    loadMs,
    mirrorMedianMs: sorted[Math.floor((sorted.length - 1) / 2)],
    mirrorMaxMs: sorted[sorted.length - 1],
    longestTaskMs: Math.round(Math.max(0, ...lt)),
    blockingMs: Math.round(lt.reduce((a, d) => a + Math.max(0, d - 50), 0)),
    errors: errors.length,
  };
}

// Repetitions matter: the same build varied by more than 50% between single
// runs on this container, wider than most differences being judged.
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.floor((s.length - 1) / 2)]); };
if (RICH) {
  const rows = [];
  for (const kb of SIZES) {
    const runs = [];
    for (let i = 0; i < REPS; i++) runs.push(await richOnce(kb));
    const pick = (k) => median(runs.map((r) => r[k]));
    rows.push({ kb, loadMs: pick("loadMs"), mirrorMedianMs: pick("mirrorMedianMs"), mirrorMaxMs: pick("mirrorMaxMs"),
      longestTaskMs: pick("longestTaskMs"), blockingMs: pick("blockingMs"), errors: runs.reduce((n, r) => n + r.errors, 0) });
  }
  srv.close();
  const H = ["docKB", "loadMs", "mirrorMedianMs", "mirrorMaxMs", "longestTaskMs", "blockingMs", "errors"];
  console.log(`\n=== ${LABEL} (rich pane -> markdown pane) ===`);
  console.log(H.map((h) => h.padStart(15)).join(""));
  for (const r of rows) console.log(H.map((h) => String(r[h === "docKB" ? "kb" : h]).padStart(15)).join(""));
  fs.writeFileSync(path.join(process.env.OUT || ".", `${LABEL}.json`), JSON.stringify(rows, null, 1));
  process.exit(0);
}
const rows = [];
for (const kb of SIZES) {
  const runs = [];
  for (let i = 0; i < REPS; i++) runs.push(await once(kb));
  const pick = (k) => median(runs.map((r) => r[k]));
  const b = runs.map((r) => r.blockingMs);
  rows.push({ kb, timeToMirrorMs: pick("timeToMirrorMs"), inputP50: pick("inputP50"), inputP95: pick("inputP95"),
    inputMax: pick("inputMax"), longTasks: pick("longTasks"), blockingMs: pick("blockingMs"),
    spread: `${median(b)}±${Math.round((Math.max(...b) - Math.min(...b)) / 2)}`,
    errors: runs.reduce((n, r) => n + r.errors, 0) });
}
srv.close();
const H = ["docKB","timeToMirrorMs","inputP50","inputP95","inputMax","longTasks","blockingMs","spread","errors"];
console.log(`\n=== ${LABEL} ===`);
console.log(H.map((h) => h.padStart(15)).join(""));
for (const r of rows) console.log(H.map((h) => String(r[h === "docKB" ? "kb" : h]).padStart(15)).join(""));
fs.writeFileSync(path.join(process.env.OUT || ".", `${LABEL}.json`), JSON.stringify(rows, null, 1));
