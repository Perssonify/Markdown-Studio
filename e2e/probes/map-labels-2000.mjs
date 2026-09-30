// Probe (not a suite): how many notes the relationship map names at 2,000
// notes in 60 folders, at the overview and zoomed in, and whether any name is
// drawn over anything (A088 follow-up). Measurement only.
//   DIR=<dist-app> [N=2000] [SEED=7] node e2e/probes/map-labels-2000.mjs [label]
import { serve, open, boot, closeRig, APP_DIR } from "../lib.mjs";
import { mapLibrary, seedFresh } from "../map-library.mjs";
import { measureMap } from "../map-measure.mjs";

const DIR = process.env.DIR || APP_DIR;
const LABEL = process.argv[2] || "run";
const N = Number(process.env.N || 2000);
const srv = await serve(DIR);
const rig = await open(srv.port, { label: `map-labels ${LABEL}` });
const pg = rig.page;
const { docs, folderTree } = mapLibrary(N, { seed: Number(process.env.SEED || 7) });
await seedFresh(pg, srv.port, docs, folderTree);
await boot(pg, srv.port, { mode: "Split", settle: 14000 });
await pg.keyboard.press("Control+Shift+G");

async function rest() {
  let last = null, still = 0;
  for (let i = 0; i < 240 && still < 3; i++) {
    await pg.waitForTimeout(500);
    const v = await pg.evaluate(() =>
      document.querySelector('[data-map-layer="notes"]')?.getAttribute("data-layout-version")
      ?? String(document.querySelectorAll(".pf-node-dot").length));
    still = v != null && v === last ? still + 1 : 0;
    last = v;
  }
  await pg.waitForTimeout(800);
}
/** Notes whose dot is on the canvas — batched dots included (parsed like measureMap). */
const onScreen = () => {
  const svg = document.querySelector('svg[aria-label^="Relationship map"]');
  const S = svg.getBoundingClientRect();
  const ids = new Set();
  const inside = (x, y) => x > S.left && x < S.right && y > S.top && y < S.bottom;
  for (const c of svg.querySelectorAll(".pf-node-dot")) { const r = c.getBoundingClientRect(); if (inside(r.x + r.width / 2, r.y + r.height / 2)) ids.add(c.closest("[data-doc-id]")?.getAttribute("data-doc-id")); }
  for (const p of svg.querySelectorAll(".pf-node-dots")) {
    const list = (p.getAttribute("data-doc-ids") || "").split(" ").filter(Boolean);
    const m = p.getScreenCTM(); const re = /M(-?\d+),(-?\d+)a(\d+),\d+ 0 1 1 (-?\d+),0/g; const d = p.getAttribute("d") || ""; let i = 0;
    for (let g = re.exec(d); g; g = re.exec(d), i++) { const cx = Number(g[1]) + Number(g[4]) / 2, cy = Number(g[2]); if (inside(m.a * cx + m.c * cy + m.e, m.b * cx + m.d * cy + m.f)) ids.add(list[i]); }
  }
  return ids.size;
};
const row = async (where) => {
  const m = await pg.evaluate(measureMap);
  const c = m?.count ?? {};
  console.log(`${LABEL.padEnd(8)} ${where.padEnd(10)} docs=${m?.documents} labels=${m?.labels} boxes=${m?.boxes} ` +
    `labelLabel=${c.labelLabel} labelDot=${c.labelDot} labelChip=${c.labelChip} labelEdge=${c.labelEdge} ` +
    `strangerLabel=${c.strangerLabel} strangerLabelOwnDot=${c.strangerLabelOwnDot} boxBox=${c.boxBox} ` +
    `zoom=${await pg.evaluate(() => [...document.querySelectorAll("span")].find((x) => /^\d+%$/.test(x.textContent || ""))?.textContent ?? "?")} ` +
    `notesOnScreen=${await pg.evaluate(onScreen)}`);
};

await rest();
await row("default");
// Zoom in from the default view — the open note's neighbourhood. (Fitting the
// whole map first and zooming about the canvas centre lands in empty space.)
for (let i = 1; i <= 5; i++) {
  await pg.locator('button[aria-label="Zoom in"]').first().click();
  await pg.waitForTimeout(900);
  await row(`in x${i}`);
}
await pg.locator('button[aria-label="Fit map to view"]').first().click();
await pg.waitForTimeout(1200);
await row("fit");
// …and in from the whole map, about the canvas centre: every zoom between the
// overview and the notes' own scale. (Before the two-level folder layout the
// middle of a folder map was mostly empty space; it is not any more.)
for (let i = 1; i <= 8; i++) {
  await pg.locator('button[aria-label="Zoom in"]').first().click();
  await pg.waitForTimeout(900);
  await row(`fit+in x${i}`);
}
if (rig.errors.length) console.log("errors:", rig.errors.slice(0, 3));
await closeRig(rig);
srv.close();
