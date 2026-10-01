// The browser floor (A097), in real engines.
//
// Below Safari/iOS 16.4, Chrome/Edge 111 and Firefox 128 the page must say so,
// run NONE of the app, and leave what is stored alone — the message promises
// that documents saved in this browser will be there after updating.
//
// `ops-browser-floor.test.js` runs the inline check against stubs. What only a
// real HTML parser can show is that the `<plaintext>` it writes swallows the
// rest of the page, so the module script, the stylesheet and the boot watchdog
// are never parsed at all. An old browser is simulated by removing one of the
// features the floor is made of (`CSS.registerProperty`, which Safari 16.3 and
// Firefox 127 lack) before any page script runs.
import fs from "node:fs";
import {
  serve, open, boot, seed, storedDoc, canonicalText, richText, runCase, until, APP_DIR, EMBED_DIR, BLANK_PATH,
} from "../lib.mjs";
import { proseDoc } from "../docs.mjs";

const BELOW = "below-floor";

/** Runs before every page script: drop @property support when asked to. */
function belowFloorInit() {
  if (!/[?&]below-floor(?:[=&]|$)/.test(location.search)) return;
  try { delete CSS.registerProperty; } catch { /* keep going */ }
  if (typeof CSS.registerProperty === "function") {
    try { Object.defineProperty(CSS, "registerProperty", { value: undefined, configurable: true }); } catch { /* checked below */ }
  }
}

/** Everything a below-the-floor page should (and should not) contain. */
const readFloorPage = (page) => page.evaluate(() => {
  const h = document.querySelector("main h1");
  const r = h ? h.getBoundingClientRect() : null;
  return {
    simulated: typeof CSS.registerProperty !== "function",
    flag: window.__PF_UNSUPPORTED === true,
    heading: h ? h.textContent : null,
    visible: !!r && r.width > 0 && r.height > 0,
    booted: window.__PF_BOOTED === true,
    root: !!document.getElementById("root"),
    editor: !!document.querySelector(".ProseMirror, .cm-editor"),
    moduleScripts: document.querySelectorAll('script[type="module"]').length,
    stylesheets: document.querySelectorAll('link[rel="stylesheet"]').length,
    // The markup after the check, as TEXT: proof the parser never built it.
    swallowed: (document.querySelector("plaintext")?.textContent ?? "").includes('<script type="module"'),
  };
});

runCase("floor", async (rep, onClose) => {
  const srv = await serve(APP_DIR);
  onClose(async () => srv.close());
  const url = (query = "") => `http://127.0.0.1:${srv.port}/${query}`;

  const rig = await open(srv.port, { label: "floor" });
  const { page, context } = rig;
  await context.addInitScript(belowFloorInit);

  // ── at the floor: the app runs and a document reaches disk ──────────────
  await page.goto(url(BLANK_PATH.slice(1)));
  await seed(page, [proseDoc("floor-doc", "Floor doc", 1)]);
  await boot(page, srv.port, { mode: "Split", settle: 6000 });
  rep.check("at the floor the app boots",
    await until(() => page.evaluate(() => window.__PF_BOOTED === true && !!document.querySelector(".ProseMirror"))));
  // The service worker's precache is part of what the watchdog would delete;
  // let it finish installing so "before" is not a moving target.
  await page.evaluate(() => Promise.race([
    navigator.serviceWorker ? navigator.serviceWorker.ready : Promise.resolve(),
    new Promise((r) => setTimeout(r, 15000)),
  ]));
  const before = await storedDoc(page, "floor-doc");
  const env = () => page.evaluate(async () => ({
    caches: self.caches ? (await caches.keys()).sort() : null,
    workers: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : null,
  }));
  const envBefore = await env();
  rep.check("the seeded document is on disk", canonicalText(before).includes("Floor doc"));

  // ── the same browser, below the floor ───────────────────────────────────
  let loads = 0;
  page.on("load", () => { loads++; });
  await page.goto(url(`?${BELOW}`), { waitUntil: "load" });
  const loadsAtArrival = loads;
  // The watchdog acts 4s after its first piece of evidence; an old browser's
  // failed bundle would have produced that evidence at once. A NEGATIVE
  // assertion, so a fixed wait is the right tool.
  await page.waitForTimeout(6000);
  const floor = await readFloorPage(page);
  rep.check("the simulation holds: @property support is gone on this page", floor.simulated, JSON.stringify(floor));
  rep.check("below the floor the message is shown", floor.flag && floor.visible &&
    floor.heading === "Markdown Studio needs a newer browser", JSON.stringify(floor));
  rep.check("no app code runs: the module script was never parsed, only swallowed as text",
    floor.moduleScripts === 0 && floor.swallowed && !floor.booted && !floor.editor && !floor.root, JSON.stringify(floor));
  rep.check("the app's stylesheet never loads (the message styles itself)", floor.stylesheets === 0, JSON.stringify(floor));
  const watchdog = await page.evaluate(() => ({
    note: localStorage.getItem("pf:boot-recovered"),
    stamp: sessionStorage.getItem("pf:boot-recover-at"),
  }));
  rep.check("the boot watchdog does nothing: no recovery note, no reload",
    watchdog.note === null && watchdog.stamp === null && loads === loadsAtArrival, JSON.stringify({ ...watchdog, loads, loadsAtArrival }));
  rep.check("the stored document is untouched", JSON.stringify(await storedDoc(page, "floor-doc")) === JSON.stringify(before));
  const envAfter = await env();
  if (!envBefore.caches?.length || !envBefore.workers) {
    // Nothing installed means nothing to lose: a PASS here could not fail.
    rep.skip("the offline caches and the service worker survive",
      `no service worker or caches were installed on ${JSON.stringify(envBefore)}`);
  } else {
    rep.check("the offline caches and the service worker survive",
      envBefore.caches.every((k) => (envAfter.caches ?? []).includes(k)) && envAfter.workers === envBefore.workers,
      JSON.stringify({ envBefore, envAfter }));
  }

  // ── after updating: the document is there ───────────────────────────────
  await boot(page, srv.port, { mode: "Split", settle: 6000 });
  rep.check("after updating, the app boots again",
    await until(() => page.evaluate(() => window.__PF_BOOTED === true && !!document.querySelector(".ProseMirror"))));
  rep.check("…and opens the document saved before",
    await until(async () => (await richText(page)).includes("Perssonify builds custom technology")),
    (await richText(page)).slice(0, 120));
  rep.check("…whose stored content never changed", canonicalText(await storedDoc(page, "floor-doc")) === canonicalText(before));

  // ── the iframe embed carries the same check ─────────────────────────────
  if (!fs.existsSync(`${EMBED_DIR}/index.html`)) {
    rep.skip("the embed's floor", "dist-embed/ not built — run `bun run build:embed`");
    return;
  }
  const esrv = await serve(EMBED_DIR);
  onClose(async () => esrv.close());
  const e = await open(esrv.port, { label: "floor/embed" });
  await e.context.addInitScript(belowFloorInit);
  await e.page.goto(`http://127.0.0.1:${esrv.port}/?${BELOW}`, { waitUntil: "load" });
  await e.page.waitForTimeout(3000);
  const ef = await readFloorPage(e.page);
  rep.check("the embed below the floor shows the message and runs nothing",
    ef.simulated && ef.visible && ef.heading === "Markdown Studio needs a newer browser" &&
    ef.moduleScripts === 0 && ef.swallowed && !ef.editor && !ef.root, JSON.stringify(ef));
  await e.page.goto(`http://127.0.0.1:${esrv.port}/`, { waitUntil: "networkidle" });
  // The embed seeds no documents, so a booted embed is its chrome on the empty
  // state (as in surfaces.mjs), not an editor.
  rep.check("the embed at the floor boots",
    await until(async () => (await e.page.locator('button:has-text("Files")').count()) > 0 &&
      (await e.page.evaluate(() => !window.__PF_UNSUPPORTED && !document.body.textContent.includes("needs a newer browser"))),
    { timeout: 30000 }));
});
