// Measurement only — NOT part of the CI suite, for the reason perf.mjs gives:
// wall-clock on a shared container varies by more than 50% run to run.
//
// The relationship map at library scale (audit A088). Opens the map on a
// generated library (folders, hubs, broken links, unlinked notes — see
// map-library.mjs) under CPU throttling, and reports what a user feels.
//
// The measured open:
//   firstFrame   ⌘⇧G → the first animation frame with the map's dots in it
//   settled      ⌘⇧G → the last frame in which a node or the camera moved
//   longest      the longest main-thread task after ⌘⇧G
//   longestAfter … of the tasks that START after the first frame (the target
//                is "nothing over ~200ms once the map is on screen")
//   blocking     total blocking time: Σ(long task − 50ms) until settled
//   frames       rendered frames while the layout unfolded, and their p50/max
//   script/style/layout/task  main-thread time by kind (CDP Performance metrics)
// Then, still throttled, zooming the SETTLED map (8 wheel steps):
//   commitP50/Max  wheel event → the zoom label committing its new value
//   paintP50/Max   wheel event → the end of the frame that shows it
//   zoomLongest    the longest task while zooming
// Then a SECOND open, probed with an isolated wheel event every 700ms
// (PROBE_MS) from ⌘⇧G until the layout rests — each lands while the layout is
// running, after the map's 300ms camera hold has lapsed:
//   zoomP50/Max    every probe's latency (event → commit)
//   shownP50/Max   …of the probes sent once the map was on screen
//   interactive    ⌘⇧G → from when on EVERY probe committed within 200ms
//
// The boot is UNTHROTTLED (the library's own load is not what is measured) and
// one warm-up open loads the map's chunk and the link index; throttling is
// switched on for the measured opens only. The library is seeded before the
// app first boots (`seedFresh`), so two builds see the identical library.
//
// Usage: DIR=<dist> REPS=1 THROTTLE=4 node e2e/cases/perf-map.mjs <label> <notes...>
//   PROFILE=1       a sourcemapped CPU profile of the measured open
//   PROFILE_ZOOM=1  …of the settled-map zooms
//   DUMP=1          the probe timeline, long tasks, and long animation frames
//                   attributed to the layout loop (rAF) vs React (MessagePort)
import { serve, open, boot, APP_DIR } from "../lib.mjs";
import { mapLibrary, seedFresh } from "../map-library.mjs";
import fs from "node:fs"; import path from "node:path";
import { SourceMapConsumer } from "source-map-js";

const DIR = process.env.DIR || APP_DIR;
const LABEL = process.argv[2] || "run";
const SIZES = (process.argv[3] ? process.argv.slice(3) : ["150", "2000"]).map(Number);
const REPS = Number(process.env.REPS || 1);
const THROTTLE = Number(process.env.THROTTLE || 4);
const PROFILE = !!process.env.PROFILE;
const srv = await serve(DIR);

/** In-page instrumentation, installed BEFORE ⌘⇧G. Everything is timestamped
 *  inside the page: a round-trip stamp would queue behind the page's own long
 *  tasks and flatter whichever build blocked more (see perf.mjs). */
const instrument = () => {
  // Re-arming resets the state; the listeners and the frame loop are installed
  // ONCE per page (three opens in one page would otherwise stack three samplers,
  // and the later measurements would pay for the earlier ones).
  window.__mp = {
    tOpen: null, tFirst: null, tLast: null, done: false, frames: [], long: [],
    wheels: [], commits: [], paints: [], sample: null, cam: null, sig: "", label: null,
  };
  if (window.__mpInstalled) return;
  window.__mpInstalled = true;
  addEventListener("keydown", (e) => {
    const m = window.__mp;
    if (m.tOpen == null && e.shiftKey && (e.key === "G" || e.key === "g")) m.tOpen = e.timeStamp;
  }, true);
  addEventListener("wheel", (e) => { window.__mp.wheels.push({ ts: e.timeStamp, at: performance.now() }); }, true);
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__mp.long.push([e.startTime, e.duration]);
  }).observe({ entryTypes: ["longtask"] });
  // Long animation frames, with what their time went on: script by invoker
  // (rAF = the layout loop; MessagePort = React rendering), then style/layout.
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        const script = {};
        for (const s of e.scripts || []) {
          const kind = /FrameRequest|requestAnimationFrame/i.test(s.invoker || s.invokerType) ? "raf"
            : /MessagePort|message/i.test(s.invoker || s.invokerType) ? "react" : (s.invokerType || "other");
          script[kind] = (script[kind] || 0) + s.duration;
        }
        const layout = e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0;
        (window.__mp.loaf ||= []).push({ t: e.startTime, d: e.duration, script, layout, block: e.blockingDuration });
      }
    }).observe({ type: "long-animation-frame", buffered: false });
  } catch { /* not supported */ }
  const tick = (t) => {
    const m = window.__mp;
    if (m.tOpen != null && !m.done) {
      // A small map draws one element per note; a large one batches its dots
      // into paths and stamps the layout version on that layer.
      if (!m.sample && document.querySelector('.pf-node-dot, .pf-node-dots[data-doc-ids]:not([data-doc-ids=""])')) {
        m.tFirst = t;
        const all = [...document.querySelectorAll("[data-doc-id]")];
        const step = Math.max(1, Math.floor(all.length / 64));
        m.sample = all.filter((_, i) => i % step === 0);
        m.cam = document.querySelector('svg[aria-label^="Relationship map"] > g');
      }
      if (m.sample) {
        m.frames.push(t);
        const layer = document.querySelector('[data-map-layer="notes"]');
        const now = (m.cam?.getAttribute("style") ?? "") + (layer?.getAttribute("data-layout-version") ?? "")
          + m.sample.map((g) => g.getAttribute("transform")).join("|");
        if (now !== m.sig) { m.sig = now; m.tLast = t; }
        if (!m.label) {
          m.label = document.querySelector('span.tabular-nums[aria-live="off"]');
          // A commit is when the zoom label changed; the paint is the end of
          // the frame after it (rAF, then a task queued behind that frame).
          if (m.label) new MutationObserver(() => {
            const mp = window.__mp;
            mp.commits.push(performance.now());
            requestAnimationFrame(() => setTimeout(() => mp.paints.push(performance.now()), 0));
          }).observe(m.label, { characterData: true, childList: true, subtree: true });
        }
        if (t - m.tLast > 2500) m.done = true;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const summarise = () => {
  const m = window.__mp;
  const since = (x) => (x == null || m.tOpen == null ? null : Math.round(x - m.tOpen));
  const after = m.long.filter(([s]) => s >= m.tOpen);
  const afterFirst = after.filter(([s]) => m.tFirst != null && s >= m.tFirst);
  const settleEnd = (m.tLast ?? performance.now()) + 1000;
  const blocking = after.filter(([s]) => s <= settleEnd).reduce((a, [, d]) => a + Math.max(0, d - 50), 0);
  const frames = m.frames.filter((t) => t <= (m.tLast ?? Infinity));
  const gaps = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
  // Wheel probes: each is answered by the first commit of the zoom label after
  // its handler ran (only the wheel moves the camera once the user has touched it).
  const lat = [];
  const answered = []; // [sent, latency] for probes sent once the map was on screen
  let unanswered = 0;
  m.wheels.forEach((w, i) => {
    const next = m.wheels[i + 1]?.at ?? Infinity;
    const c = m.commits.find((x) => x >= w.at && x < next);
    if (c == null) { unanswered++; return; }
    const l = c - w.ts;
    lat.push(l);
    if (m.tFirst != null && w.ts >= m.tFirst) answered.push([w.ts, l]);
  });
  lat.sort((a, b) => a - b);
  // Interactive: from when on did EVERY probe get its zoom committed within
  // 200ms? (A probe sent before the map exists waits for it to mount; that is
  // time-to-first-frame, reported separately.)
  let interactive = null;
  for (let i = answered.length - 1; i >= 0 && answered[i][1] <= 200; i--) interactive = Math.round(answered[i][0] - m.tOpen);
  const shown = answered.map(([, l]) => l).sort((a, b) => a - b);
  const svg = document.querySelector('svg[aria-label^="Relationship map"]');
  return {
    firstFrame: since(m.tFirst), settled: since(m.tLast),
    longest: Math.round(Math.max(0, ...after.map(([, d]) => d))),
    longestAfter: Math.round(Math.max(0, ...afterFirst.map(([, d]) => d))),
    blocking: Math.round(blocking), longTasks: after.length,
    frames: frames.length, frameP50: Math.round(gaps[Math.floor(gaps.length / 2)] || 0),
    frameMax: Math.round(gaps[gaps.length - 1] || 0),
    dom: svg ? svg.querySelectorAll("*").length : 0,
    dots: new Set([...[...document.querySelectorAll(".pf-node-dot")].map((c) => c.closest("[data-doc-id]")?.getAttribute("data-doc-id")), ...[...document.querySelectorAll(".pf-node-dots")].flatMap((p) => (p.getAttribute("data-doc-ids") || "").split(" ").filter(Boolean))]).size,
    labels: document.querySelectorAll(".pf-node-label").length,
    zoomP50: lat.length ? Math.round(lat[Math.floor(lat.length / 2)]) : null,
    zoomMax: lat.length ? Math.round(lat[lat.length - 1]) : null,
    timeline: answered.map(([s, l]) => `${Math.round(s - m.tOpen)}:${Math.round(l)}`).join(" "),
    frames200: (m.loaf || []).filter((f) => f.t >= (m.tFirst ?? Infinity) && f.d > 150)
      .map((f) => `${Math.round(f.t - m.tOpen)}:${Math.round(f.d)}[${Object.entries(f.script).map(([k, v]) => `${k}=${Math.round(v)}`).join(",")},style+layout=${Math.round(f.layout)}]`)
      .join(" "),
    tasks: after.filter(([, d]) => d > 150).map(([s, d]) => `${Math.round(s - m.tOpen)}:${Math.round(d)}`).join(" "),
    shownP50: shown.length ? Math.round(shown[Math.floor(shown.length / 2)]) : null,
    shownMax: shown.length ? Math.round(shown[shown.length - 1]) : null,
    probes: m.wheels.length, unanswered, interactive,
  };
};

async function metrics(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((x) => [x.name, x.value]));
}

/** Self time per ORIGINAL function, via the build's hidden sourcemaps. */
async function attribute(profile) {
  const self = new Map();
  const dt = new Map();
  profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) || 0) + (profile.timeDeltas[i] || 0)));
  const consumers = new Map();
  const consumerFor = (url) => {
    if (consumers.has(url)) return consumers.get(url);
    let c = null;
    try {
      const file = path.join(DIR, new URL(url).pathname) + ".map";
      if (fs.existsSync(file)) c = new SourceMapConsumer(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch { /* not ours */ }
    consumers.set(url, c);
    return c;
  };
  for (const node of profile.nodes) {
    const us = dt.get(node.id) || 0;
    if (!us) continue;
    const f = node.callFrame;
    let key = f.functionName || "(anonymous)";
    if (f.url) {
      const c = consumerFor(f.url);
      const pos = c?.originalPositionFor({ line: f.lineNumber + 1, column: f.columnNumber });
      key = pos?.source
        ? `${pos.name || f.functionName || "?"} @ ${pos.source.replace(/^.*?(src|node_modules)\//, "$1/")}:${pos.line}`
        : `${key} @ ${path.basename(new URL(f.url).pathname)}`;
    }
    self.set(key, (self.get(key) || 0) + us);
  }
  return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
    .map(([k, us]) => `${String(Math.round(us / 1000)).padStart(7)}ms  ${k}`);
}

async function openMap(pg) {
  await pg.keyboard.press("Control+Shift+G");
}
async function closeMap(pg) {
  await pg.locator('button[aria-label="Back to the editor"]').first().click({ timeout: 120000 }).catch(() => {});
  await pg.waitForFunction(() => !document.querySelector(".pf-node-dot, .pf-node-dots"), null, { timeout: 120000 }).catch(() => {});
  await pg.waitForTimeout(1500);
}
const waitSettled = (pg, timeout = 240000) =>
  pg.waitForFunction(() => window.__mp?.done === true, null, { timeout, polling: 500 });

async function once(n) {
  const { docs, folderTree } = mapLibrary(n);
  const rig = await open(srv.port, { cdp: true });
  const { page: pg, cdp, errors } = rig;
  await seedFresh(pg, srv.port, docs, folderTree);
  await boot(pg, srv.port, { mode: "Split", settle: 6000 + n * 4 });
  await cdp.send("Performance.enable");

  // Warm-up: the lazy chunk and the graph data. Unthrottled, and not measured.
  await pg.evaluate(instrument);
  await openMap(pg);
  await waitSettled(pg);
  const drawn = await pg.evaluate(() => ({
    dots: new Set([...[...document.querySelectorAll(".pf-node-dot")].map((c) => c.closest("[data-doc-id]")?.getAttribute("data-doc-id")), ...[...document.querySelectorAll(".pf-node-dots")].flatMap((p) => (p.getAttribute("data-doc-ids") || "").split(" ").filter(Boolean))]).size,
    header: document.querySelector('svg[aria-label^="Relationship map"]')?.getAttribute("aria-label") ?? "",
  }));
  await closeMap(pg);

  const main = await pg.evaluate(() => {
    const b = document.querySelector("main").getBoundingClientRect();
    return { x: b.left + Math.max(40, (b.width - 320) / 2), y: b.top + b.height / 2 };
  });

  // Measured open.
  await pg.evaluate(instrument);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  const m0 = await metrics(cdp);
  if (PROFILE) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    await cdp.send("Profiler.start");
  }
  await openMap(pg);
  await waitSettled(pg);
  const m1 = await metrics(cdp);
  const profile = PROFILE ? (await cdp.send("Profiler.stop")).profile : null;
  const r = await pg.evaluate(summarise);

  // Zooming the SETTLED map, still throttled: wheel event → the zoom label
  // committing, and → the end of the frame that shows it.
  await pg.evaluate(() => { const m = window.__mp; m.wheels = []; m.commits = []; m.paints = []; m.long = []; });
  await pg.mouse.move(main.x, main.y);
  if (process.env.PROFILE_ZOOM) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    await cdp.send("Profiler.start");
  }
  for (let i = 0; i < 8; i++) {
    await pg.mouse.wheel(0, i % 2 ? 120 : -120);
    await pg.waitForTimeout(700);
  }
  if (process.env.PROFILE_ZOOM) console.log((await attribute((await cdp.send("Profiler.stop")).profile)).join("\n"));
  const zoom = await pg.evaluate(() => {
    const m = window.__mp;
    const c = [], p = [];
    m.wheels.forEach((w, i) => {
      const next = m.wheels[i + 1]?.at ?? Infinity;
      const ci = m.commits.findIndex((x) => x >= w.at && x < next);
      if (ci < 0) return;
      c.push(m.commits[ci] - w.ts);
      if (m.paints[ci] != null) p.push(m.paints[ci] - w.ts);
    });
    const med = (xs) => (xs.length ? Math.round([...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]) : null);
    return { commitP50: med(c), commitMax: c.length ? Math.round(Math.max(...c)) : null,
      paintP50: med(p), paintMax: p.length ? Math.round(Math.max(...p)) : null,
      zoomLongest: Math.round(Math.max(0, ...m.long.map(([, d]) => d))) };
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await closeMap(pg);

  // Responsiveness: a second open, probed with wheel zooms from the first moment.
  await pg.evaluate(instrument);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  await pg.mouse.move(main.x, main.y);
  await openMap(pg);
  // A probe every PROBE_MS until the layout has come to rest (at most 90s).
  // 700ms by default: longer than the map's camera hold (300ms), so each probe
  // is an ISOLATED zoom that lands while the layout is running — the case that
  // measures contention. (Probes closer together than the hold measure a
  // continuous gesture, during which a large map holds its layout still.)
  const probeEvery = Number(process.env.PROBE_MS || 700);
  const probeUntil = Date.now() + 90000;
  for (let i = 0; Date.now() < probeUntil; i++) {
    await pg.mouse.wheel(0, i % 2 ? 120 : -120);
    await pg.waitForTimeout(probeEvery);
    if (i % 2 === 1 && await pg.evaluate(() => window.__mp.done)) break;
  }
  await waitSettled(pg);
  const probe = await pg.evaluate(summarise);
  if (process.env.DUMP) {
    console.log(`  probes (sent:latency ms): ${probe.timeline}`);
    console.log(`  long tasks while probing (start:ms): ${probe.tasks}`);
    console.log(`  long tasks, measured open (start:ms): ${r.tasks}`);
    console.log(`  long frames after the first, measured open: ${r.frames200}`);
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  await rig.browser.close();
  rig.closed = true;
  const d = (k) => Math.round(((m1[k] || 0) - (m0[k] || 0)) * 1000);
  return {
    ...r,
    script: d("ScriptDuration"), style: d("RecalcStyleDuration"), layout: d("LayoutDuration"), task: d("TaskDuration"),
    zoomP50: probe.zoomP50, zoomMax: probe.zoomMax, shownP50: probe.shownP50, shownMax: probe.shownMax, interactive: probe.interactive, ...zoom,
    probes: probe.probes, unanswered: probe.unanswered, probeLongestAfter: probe.longestAfter,
    drawn: drawn.dots, header: drawn.header, errors: errors.length,
    profile: profile ? await attribute(profile) : null,
  };
}

const median = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.floor((s.length - 1) / 2)]) : null;
};
const COLS = ["notes", "firstFrame", "settled", "longest", "longestAfter", "blocking", "longTasks", "frames",
  "frameP50", "frameMax", "script", "style", "layout", "task", "dom", "labels", "zoomP50", "zoomMax",
  "shownP50", "shownMax", "interactive", "unanswered", "probeLongestAfter", "commitP50", "commitMax", "paintP50", "paintMax", "zoomLongest", "errors"];
const rows = [];
for (const n of SIZES) {
  const runs = [];
  for (let i = 0; i < REPS; i++) {
    const r = await once(n);
    runs.push(r);
    console.log(`  ${n} notes, run ${i + 1}: ${r.header} (${r.drawn} dots)`);
    if (r.profile) console.log(r.profile.join("\n"));
  }
  const row = { notes: n };
  for (const k of COLS.slice(1)) row[k] = k === "errors" ? runs.reduce((a, r) => a + r.errors, 0) : median(runs.map((r) => r[k]));
  rows.push(row);
}
srv.close();
console.log(`\n=== ${LABEL} (CPU ×${THROTTLE}, median of ${REPS}) ===`);
// One line per metric, one column per library size.
for (const h of COLS) console.log(h.padEnd(18) + rows.map((r) => String(r[h]).padStart(10)).join(""));
fs.writeFileSync(path.join(process.env.OUT || ".", `perf-map-${LABEL}.json`), JSON.stringify(rows, null, 1));
