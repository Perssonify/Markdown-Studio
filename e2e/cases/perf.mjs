// Measurement only — NOT part of the CI suite. Timing on a shared container
// varies by more than 50% run to run, so a wall-clock assertion there would
// flake; this exists to compare two builds under identical conditions.
//
// Dual-pane sync performance. Measures what a user feels:
//   timeToMirrorMs — a character typed in one pane -> visible in the other
//   inputP50/P95   — keydown -> next paint, while typing continuously
//   blockingMs     — main-thread blocking (long-task time over 50ms)
// Usage: DIR=<dist> REPS=3 THROTTLE=4 bun run e2e:perf -- <label> <sizeKb...>
import { serve, open, boot, seed, APP_DIR } from "../lib.mjs";
import { proseDoc } from "../docs.mjs";
import fs from "node:fs"; import path from "node:path";
const DIR = process.env.DIR || APP_DIR;
const LABEL = process.argv[2] || "run";
const SIZES = (process.argv[3] ? process.argv.slice(3) : ["1", "10", "50"]).map(Number);
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

// Repetitions matter: the same build varied by more than 50% between single
// runs on this container, wider than most differences being judged.
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.floor((s.length - 1) / 2)]); };
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
