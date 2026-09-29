// Campaign runner. Each case is a separate process so a crash or a leaked
// browser in one cannot take the rest of the suite down with it.
//
//   bun run e2e            all suites
//   bun run e2e:smoke      tier 1 only (the CI default)
//   bun run e2e -- journeys stress
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const SUITES = {
  harness: "The rig checking itself — the pane readers against a known document",
  surfaces: "Tier 1 — blast radius: every surface still works",
  "surfaces-deep": "The surfaces nothing else opens: Settings, Version history, the tray, the interior pages, the tour, the Outline tab",
  dataloss: "The data-loss sequences in a real browser: two tabs, real IndexedDB, real autosave",
  stress: "Tier 2 — scale and duration",
  journeys: "Tier 3 — user simulation, including real IME composition",
  faults: "Tier 4 — fault injection: quota, blocked storage, multi-tab",
  library: "The published library on a host page (needs dist/)",
  bridge: "The iframe embed's host bridge, driven from a second origin (needs dist-embed/)",
  perf: "Measurement only — not run in CI (timing noise)",
};

const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const suites = requested.length ? requested : Object.keys(SUITES).filter((s) => s !== "perf");

for (const s of suites) {
  if (!SUITES[s]) {
    console.error(`Unknown suite "${s}". Known: ${Object.keys(SUITES).join(", ")}`);
    process.exit(2);
  }
}

if (!fs.existsSync(path.join(ROOT, "dist-app", "index.html"))) {
  console.error("dist-app/ is missing — run `bun run build:app` first.");
  process.exit(2);
}

const run = (file) =>
  new Promise((res) => {
    const child = spawn(process.execPath, [file], { stdio: "inherit", cwd: ROOT, env: process.env });
    child.on("exit", (code) => res(code ?? 1));
  });

const results = [];
for (const suite of suites) {
  const file = path.join(HERE, "cases", `${suite}.mjs`);
  if (!fs.existsSync(file)) { console.error(`missing case file: ${file}`); results.push([suite, 2]); continue; }
  console.log(`\n${"═".repeat(72)}\n${suite} — ${SUITES[suite]}\n${"═".repeat(72)}`);
  results.push([suite, await run(file)]);
}

console.log(`\n${"═".repeat(72)}`);
let failed = 0;
for (const [suite, code] of results) {
  if (code) failed++;
  console.log(`${code ? "FAIL" : "PASS"}  ${suite}`);
}
process.exit(failed ? 1 : 0);
