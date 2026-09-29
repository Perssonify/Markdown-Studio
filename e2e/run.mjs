// Campaign runner. Each case is a separate process so a crash or a leaked
// browser in one cannot take the rest of the suite down with it.
//
//   bun run e2e            all suites
//   bun run e2e:smoke      tier 1 only (the CI default)
//   bun run e2e -- journeys stress
//   E2E_BROWSER=firefox node e2e/run.mjs surfaces     (or webkit; default chromium)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const ALL = ["chromium", "firefox", "webkit"];
const CHROMIUM = ["chromium"];

/**
 * Every suite: what it covers, and the engines it has been RUN green on. A
 * suite is listed for an engine only after it has been driven there; on any
 * other engine it is reported as SKIP with the reason instead of being run,
 * because a failure there would say more about the harness than the app.
 */
const SUITES = {
  harness: ["The rig checking itself — the pane readers against a known document", ALL],
  surfaces: ["Tier 1 — blast radius: every surface still works", ALL],
  "surfaces-deep": ["The surfaces nothing else opens: Settings, Version history, the tray, the interior pages, the tour, the Outline tab", ALL],
  dataloss: ["The data-loss sequences in a real browser: two tabs, real IndexedDB, real autosave", ALL],
  floor: ["The browser floor: below it a message, no app code, nothing touched; above it the app", ALL],
  stress: ["Tier 2 — scale and duration", CHROMIUM, "not yet run on other engines"],
  journeys: ["Tier 3 — user simulation, including real IME composition", CHROMIUM, "real IME composition is driven through Chromium's DevTools protocol"],
  faults: ["Tier 4 — fault injection: quota, blocked storage, multi-tab", CHROMIUM, "not yet run on other engines"],
  library: ["The published library on a host page (needs dist/)", CHROMIUM, "not yet run on other engines"],
  bridge: ["The iframe embed's host bridge, driven from a second origin (needs dist-embed/)", CHROMIUM, "not yet run on other engines"],
  csp: ["vercel.json's Content-Security-Policy ENFORCED while every renderer and lazy surface runs", CHROMIUM, "not yet run on other engines"],
  pwa: ["The service worker: offline after one online visit, and updates that never force-reload a tab", CHROMIUM, "not yet run on other engines"],
  perf: ["Measurement only — not run in CI (timing noise)", CHROMIUM, "CPU throttling is Chromium's DevTools protocol"],
};

const ENGINE = (process.env.E2E_BROWSER || "chromium").trim().toLowerCase();
if (!ALL.includes(ENGINE)) {
  console.error(`E2E_BROWSER must be one of ${ALL.join(", ")} (got "${process.env.E2E_BROWSER}")`);
  process.exit(2);
}

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
  const [what, engines, why] = SUITES[suite];
  if (!engines.includes(ENGINE)) {
    results.push([suite, "skip", `not run on ${ENGINE}: ${why}`]);
    continue;
  }
  const file = path.join(HERE, "cases", `${suite}.mjs`);
  if (!fs.existsSync(file)) { console.error(`missing case file: ${file}`); results.push([suite, 2]); continue; }
  console.log(`\n${"═".repeat(72)}\n${suite} [${ENGINE}] — ${what}\n${"═".repeat(72)}`);
  results.push([suite, await run(file)]);
}

console.log(`\n${"═".repeat(72)}`);
let failed = 0;
for (const [suite, code, reason] of results) {
  if (code === "skip") { console.log(`SKIP  ${suite} [${ENGINE}]  — ${reason}`); continue; }
  if (code) failed++;
  console.log(`${code ? "FAIL" : "PASS"}  ${suite} [${ENGINE}]`);
}
process.exit(failed ? 1 : 0);
