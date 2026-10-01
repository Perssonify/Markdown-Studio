// Probe (not a suite): which step of the A086 image session makes WebKit log
// "Failed to load resource: URL using bad/illegal format or missing URL", and
// for which URL. Prints each step, every failed request and every console
// error with a timestamp.
//   E2E_BROWSER=webkit node e2e/probes/asset-console-webkit.mjs
import { serve, open, boot, seed, closeRig, APP_DIR, BLANK_PATH } from "../lib.mjs";
import { proseDoc } from "../docs.mjs";

const t0 = Date.now();
const log = (...a) => console.log(`[${String(Date.now() - t0).padStart(6)}ms]`, ...a);
const srv = await serve(APP_DIR);
const rig = await open(srv.port, { label: "probe" });
const pg = rig.page;
pg.on("console", (m) => { if (m.type() === "error" || /Failed to load/.test(m.text())) log("CONSOLE", m.type(), m.text(), JSON.stringify(m.location())); });
pg.on("requestfailed", (r) => log("REQUESTFAILED", r.url().slice(0, 160), r.failure()?.errorText));
pg.on("request", (r) => { const u = r.url(); if (!/^http:\/\/127\.0\.0\.1/.test(u)) log("REQUEST", u.slice(0, 160)); });

const step = (s) => log("STEP", s);
step("goto blank");
await pg.goto(`http://127.0.0.1:${srv.port}${BLANK_PATH}`);
await seed(pg, [proseDoc("img", "Picture doc", 1)]);
step("boot");
await boot(pg, srv.port, { mode: "Split", settle: 6000 });
step("paste image");
await pg.locator(".ProseMirror").first().click();
await pg.keyboard.press("Control+End");
await pg.evaluate(async () => {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 48;
  const x = c.getContext("2d");
  x.fillStyle = "#c33"; x.fillRect(0, 0, 64, 48);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], "diagram.png", { type: "image/png" }));
  const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
  if (!ev.clipboardData || !ev.clipboardData.files.length) Object.defineProperty(ev, "clipboardData", { value: dt });
  document.querySelector(".ProseMirror").dispatchEvent(ev);
});
await pg.waitForTimeout(4000);
log("imgs:", JSON.stringify(await pg.evaluate(() => [...document.querySelectorAll("img")].map((i) => (i.getAttribute("src") || "(none)").slice(0, 60)))));
step("reload");
await pg.reload({ waitUntil: "networkidle" });
await pg.waitForTimeout(5000);
log("imgs:", JSON.stringify(await pg.evaluate(() => [...document.querySelectorAll("img")].map((i) => (i.getAttribute("src") || "(none)").slice(0, 60)))));
step("export html");
const dl = pg.waitForEvent("download", { timeout: 20000 });
await pg.locator('button:has-text("File")').first().click();
await pg.locator('[role="menuitem"]:has-text("Export")').first().click();
await pg.locator('[role="menuitem"]:has-text("HTML (.html)")').first().click();
await dl;
await pg.waitForTimeout(2000);
step("export backup");
const dl2 = pg.waitForEvent("download", { timeout: 20000 });
await pg.locator('button:has-text("File")').first().click();
await pg.locator('[role="menuitem"]:has-text("Export")').first().click();
await pg.locator('[role="menuitem"]:has-text("Full backup (.zip)")').first().click();
await dl2;
await pg.waitForTimeout(2000);
step("done; errors collected by the rig:");
for (const e of rig.errors) log("RIG", e);
await closeRig(rig);
srv.close();
