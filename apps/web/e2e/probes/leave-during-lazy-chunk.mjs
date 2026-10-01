// Leaving the app while a lazy chunk is still loading (Firefox).
//
// Firefox rejects the OLD document's in-flight dynamic imports when a
// navigation away starts, while that document is still alive. The app reads the
// rejection as a stale-deploy chunk error (`vite:preloadError`, main.tsx) and
// `reloadForChunkErrorIfSafe` (utils/app-health.ts) calls location.reload() —
// which cancels the navigation the user asked for: the app reloads instead of
// letting them leave. Chromium and WebKit do not reject there.
//
// The Welcome document renders math, so KaTeX is the chunk in flight shortly
// after `load`. This leaves at staggered moments after `load` and prints, per
// round, whether the navigation survived, the rejections the page saw, and the
// order of beforeunload / pagehide / the rejection.
//
//   E2E_BROWSER=firefox node e2e/probes/leave-during-lazy-chunk.mjs
import { serve, APP_DIR, BLANK_PATH, ENGINE } from "../lib.mjs";
import { chromium, firefox, webkit } from "playwright-core";

const srv = await serve(APP_DIR);
const browser = await ({ chromium, firefox, webkit })[ENGINE].launch();
const base = `http://127.0.0.1:${srv.port}`;
let hijacked = 0;
for (let round = 0; round < 12; round++) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    const t0 = performance.now();
    const mark = (what) => { try { sessionStorage.setItem("probe:" + what, String(Math.round(performance.now() - t0))); } catch { /* */ } };
    addEventListener("beforeunload", () => mark("beforeunload"));
    addEventListener("pagehide", () => mark("pagehide"));
    addEventListener("vite:preloadError", () => mark("preloadError"));
  });
  const page = await context.newPage();
  const rejections = [];
  page.on("pageerror", (e) => rejections.push(e.message.slice(0, 90)));
  await page.goto(base + "/", { waitUntil: "load" });
  await page.waitForTimeout(round * 120);
  let outcome = "left";
  try {
    await page.goto(base + BLANK_PATH, { waitUntil: "load" });
  } catch (e) {
    outcome = "NAVIGATION CANCELLED: " + String(e).split("\n")[0];
    hijacked++;
  }
  await page.waitForTimeout(800);
  const order = await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("probe:"))
    .map((k) => `${k.slice(6)}@${sessionStorage.getItem(k)}ms`).join(", ")).catch(() => "?");
  console.log(`[${ENGINE} r${round} +${round * 120}ms] ${outcome} | rejections: ${rejections.length} ${rejections[0] ?? ""} | ${order}`);
  await context.close();
}
console.log(`\n${ENGINE}: ${hijacked} of 12 navigations away were cancelled by the app's reload`);
await browser.close();
srv.close();
