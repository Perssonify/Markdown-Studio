// Where does a relationship-map frame go? (A088)
//
// Opens the map on a generated library (map-library.mjs) under CPU throttling,
// records a Chrome trace of the open, and totals main-thread time by event
// (script, style recalc and how many elements each recalc touched, layout,
// paint). perf-map.mjs says HOW slow; this says what the time is made of.
//
// Usage: DIR=<dist> N=150 THROTTLE=4 SECONDS=6 node e2e/probes/map-trace.mjs
import { serve, open, boot, APP_DIR } from "../lib.mjs";
import { mapLibrary, seedFresh } from "../map-library.mjs";

const DIR = process.env.DIR || APP_DIR;
const N = Number(process.env.N || 150);
const THROTTLE = Number(process.env.THROTTLE || 4);
const SECONDS = Number(process.env.SECONDS || 6);
const srv = await serve(DIR);
const { browser, page: pg, cdp } = await open(srv.port, { cdp: true });
const { docs, folderTree } = mapLibrary(N);
await seedFresh(pg, srv.port, docs, folderTree);
await boot(pg, srv.port, { mode: "Split", settle: 6000 + N * 4 });
// Warm the chunk and the graph data.
await pg.keyboard.press("Control+Shift+G");
await pg.waitForFunction(() => document.querySelector(".pf-node-dot, .pf-node-dots"), null, { timeout: 240000 });
await pg.waitForTimeout(3000 + N * 10);
await pg.locator('button[aria-label="Back to the editor"]').first().click();
await pg.waitForTimeout(1500);

const categories = ["devtools.timeline", "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.invalidationTracking", "blink", "v8.execute"];
if (process.env.ZOOM) {
  // Trace ZOOMING a settled map instead of opening it: open unthrottled, let it
  // rest, then wheel over the canvas.
  await pg.keyboard.press("Control+Shift+G");
  await pg.waitForFunction(() => document.querySelector(".pf-node-dot, .pf-node-dots"), null, { timeout: 240000 });
  await pg.waitForTimeout(4000 + N * 5);
  const box = await pg.evaluate(() => {
    const b = document.querySelector('svg[aria-label^="Relationship map"]').getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  await pg.mouse.move(box.x, box.y);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  await browser.startTracing(pg, { categories });
  for (let i = 0; i < 6; i++) { await pg.mouse.wheel(0, i % 2 ? 120 : -120); await pg.waitForTimeout(700); }
} else {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  await browser.startTracing(pg, { categories });
  await pg.keyboard.press("Control+Shift+G");
  await pg.waitForTimeout(SECONDS * 1000);
}
const buf = await browser.stopTracing();
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
const trace = JSON.parse(buf.toString());
const events = trace.traceEvents || trace;

// The renderer main thread (CrRendererMain) that did the most work — the page's.
const mains = new Set(events.filter((e) => e.ph === "M" && e.name === "thread_name" && e.args?.name === "CrRendererMain")
  .map((e) => `${e.pid}:${e.tid}`));
const byTid = new Map();
for (const e of events) {
  const key = `${e.pid}:${e.tid}`;
  if (mains.has(key) && e.ph === "X") byTid.set(key, (byTid.get(key) || 0) + (e.dur || 0));
}
const main = [...byTid.entries()].sort((a, b) => b[1] - a[1])[0][0];
const onMain = events.filter((e) => `${e.pid}:${e.tid}` === main && e.ph === "X");
const total = new Map();
for (const e of onMain) total.set(e.name, (total.get(e.name) || 0) + e.dur);
const rows = [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
console.log(`N=${N} ×${THROTTLE} over ${SECONDS}s — main-thread time by event (ms, nested events overlap):`);
for (const [name, us] of rows) console.log(`${String(Math.round(us / 1000)).padStart(8)}  ${name}`);
const recalcs = onMain.filter((e) => e.name === "UpdateLayoutTree");
const counts = recalcs.map((e) => e.args?.elementCount ?? e.args?.data?.elementCount ?? 0);
console.log(`style recalcs: ${recalcs.length}, elements per recalc: max ${Math.max(0, ...counts)}, median ${counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)] ?? 0}`);
const per = recalcs.map((e) => ({ ms: e.dur / 1000, n: e.args?.elementCount ?? 0 })).filter((r) => r.n > 0);
if (per.length) console.log(`µs per element restyled: ${Math.round(per.reduce((a, r) => a + r.ms * 1000, 0) / per.reduce((a, r) => a + r.n, 0))}`);
console.log("largest recalcs (ms / elements):", per.sort((a, b) => b.ms - a.ms).slice(0, 12).map((r) => `${Math.round(r.ms)}/${r.n}`).join("  "));
// Why styles were invalidated (needs the invalidationTracking category).
const why = new Map();
for (const e of events) {
  if (!/InvalidationTracking/.test(e.name)) continue;
  const d = e.args?.data ?? {};
  const k = `${e.name.replace("InvalidationTracking", "")}: ${d.reason ?? d.changedAttribute ?? d.changedClass ?? d.changedPseudo ?? d.changedId ?? d.invalidationList?.[0]?.classes ?? ""} <${(d.nodeName ?? "").slice(0, 40)}>`;
  why.set(k, (why.get(k) || 0) + 1);
}
console.log("invalidations (count  kind: reason <node>):");
for (const [k, c] of [...why.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${String(c).padStart(8)}  ${k}`);
await browser.close();
srv.close();
