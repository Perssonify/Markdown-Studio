// Is anything on the relationship map drawn over text? (A088 re-check)
//
// CLAUDE.md claims, measured in a real browser, ZERO for: label↔label,
// label↔dot, label↔chip, container↔container, a stranger's dot or label inside
// a container, chip↔chip and label↔canvas edge — and a non-zero chip↔dot, by
// design (chips paint last). This measures all of it (map-measure.mjs) on
// generated workspaces (map-library.mjs), desktop and phone, at fit / 4
// zoom-outs / 8 zoom-ins.
//
// It also prints a FINGERPRINT of everything drawn (positions, label
// placements, containers, chips, camera) per state: run it against two builds
// and compare, to prove a small map renders identically. The library is seeded
// before the app ever boots (`seedFresh`: no starter documents with fresh ids),
// and reduced motion is emulated so the layout rests without depending on frame
// timing — the physics is the same either way.
//
// Usage: DIR=<dist> SIZES=3,12,25,40,153,2000 node e2e/probes/map-overlap.mjs
import { serve, open, boot, APP_DIR } from "../lib.mjs";
import { mapLibrary, seedFresh } from "../map-library.mjs";
import { measureMap } from "../map-measure.mjs";
import crypto from "node:crypto";

const DIR = process.env.DIR || APP_DIR;
const SIZES = (process.env.SIZES || "3,12,25,40,153,2000").split(",").map(Number);
const VIEWPORTS = [["desktop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]];
const srv = await serve(DIR);

let failures = 0;
for (const n of SIZES) {
  for (const [vpName, viewport] of VIEWPORTS) {
    const { docs, folderTree } = mapLibrary(n);
    const rig = await open(srv.port, { cdp: true, viewport });
    const { page: pg, cdp } = rig;
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await seedFresh(pg, srv.port, docs, folderTree);
    await boot(pg, srv.port, { mode: vpName === "phone" ? null : "Split", settle: 5000 + n * 4 });
    await pg.keyboard.press("Control+Shift+G");
    await pg.waitForFunction(() => document.querySelector(".pf-node-dot, .pf-node-dots[data-doc-ids]:not([data-doc-ids=''])"), null, { timeout: 180000 });
    await pg.waitForTimeout(1500);
    const states = [];
    const click = async (label, times) => {
      for (let i = 0; i < times; i++) {
        await pg.locator(`button[aria-label="${label}"]`).first().click();
        await pg.waitForTimeout(120);
      }
      await pg.waitForTimeout(600);
    };
    states.push(["fit", await pg.evaluate(measureMap)]);
    await click("Zoom out", 4);
    states.push(["4 out", await pg.evaluate(measureMap)]);
    await click("Fit map to view", 1);
    await click("Zoom in", 8);
    states.push(["8 in", await pg.evaluate(measureMap)]);
    for (const [name, m] of states) {
      if (!m || m.error) { console.log(`${n} notes ${vpName} ${name}: ${m?.error ?? "no map"}`); failures++; continue; }
      const bad = Object.entries(m.count).filter(([k, v]) => k !== "chipDot" && v > 0);
      if (bad.length) failures++;
      const hash = crypto.createHash("sha1").update(m.print).digest("hex").slice(0, 12);
      console.log(`${String(n).padStart(5)} notes ${vpName.padEnd(7)} ${name.padEnd(6)} drawn=${m.drawn}/${m.documents} labels=${m.labels} boxes=${m.boxes} `
        + `${Object.entries(m.count).map(([k, v]) => `${k}=${v}`).join(" ")} print=${hash}${bad.length ? "  <-- OVERLAP" : ""}`);
    }
    await rig.browser.close();
    rig.closed = true;
  }
}
srv.close();
console.log(failures ? `\n${failures} state(s) with an overlap CLAUDE.md says cannot happen` : "\nnothing drawn over text in any state");
