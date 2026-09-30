// Probe (not a suite): are any notes drawn on top of each other on the
// relationship map? Opens a generated library (e2e/map-library.mjs), waits for
// the layout to rest, fits the whole map, and counts distinct dot positions,
// the largest stack, overlapping folder boxes and stranger dots inside a box.
//   N=150 FOLDERS=1 DIR=<dist-app> node e2e/probes/map-stacks.mjs
import { serve, open, boot, closeRig, APP_DIR } from "../lib.mjs";
import { mapLibrary, seedFresh } from "../map-library.mjs";
import { measureMap } from "../map-measure.mjs";

const DIR = process.env.DIR || APP_DIR;
const N = Number(process.env.N || 150);
const FOLDERS = process.env.FOLDERS !== "0";
const SEED = Number(process.env.SEED || 7);
const srv = await serve(DIR);
const rig = await open(srv.port, { label: "map-stacks" });
const pg = rig.page;
const { docs, folderTree } = mapLibrary(N, { folders: FOLDERS, seed: SEED });
await seedFresh(pg, srv.port, docs, folderTree);
await boot(pg, srv.port, { mode: "Split", settle: 14000 });
await pg.keyboard.press("Control+Shift+G");
// At rest when the layout stops moving (the batched layer's version on a large
// map; the drawn dots' positions on a small one).
let last = null, still = 0;
for (let i = 0; i < 240 && still < 3; i++) {
  await pg.waitForTimeout(500);
  const v = await pg.evaluate(() =>
    document.querySelector('[data-map-layer="notes"]')?.getAttribute("data-layout-version")
    ?? [...document.querySelectorAll(".pf-node-dot")].slice(0, 20).map((c) => c.getAttribute("cx") + "," + c.getAttribute("cy")).join("|"));
  still = v && v === last ? still + 1 : 0;
  last = v;
}
await pg.locator('button[aria-label="Fit map to view"]').first().click();
await pg.waitForTimeout(1500);
const m = await pg.evaluate(measureMap);
const dots = JSON.parse(m.print).dots; // [id, x0, y0, w] in screen px
const zoom = await pg.evaluate(() => [...document.querySelectorAll("span")].find((x) => /^\d+%$/.test(x.textContent || ""))?.textContent ?? "?");
// Distinct in WORLD terms: screen px divided by the zoom, rounded to a unit.
const k = Number(zoom.replace("%", "")) / 100 || 1;
const key = (d) => `${Math.round(d[1] / k)},${Math.round(d[2] / k)}`;
const groups = new Map();
for (const d of dots) groups.set(key(d), (groups.get(key(d)) ?? 0) + 1);
const largest = Math.max(...groups.values());
console.log(`N=${N} folders=${FOLDERS} seed=${SEED} zoom=${zoom} dots=${dots.length} distinct=${groups.size} largestStack=${largest} ` +
  `boxBox=${m.count.boxBox} strangerDots=${m.count.strangerDot} labels=${m.labels}`);
if (rig.errors.length) console.log("errors:", rig.errors.slice(0, 3));
await closeRig(rig);
srv.close();
