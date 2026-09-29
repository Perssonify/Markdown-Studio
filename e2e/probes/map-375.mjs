// Why did the map's filter chips stop being reachable at 375px?
//
// The surfaces tier opens the map at a phone width and asserts the orphan /
// broken chips and the JSON export are present (they used to be `hidden sm:*`).
// After the assertions were converted from fixed sleeps to polled deadlines the
// two chip checks began to fail — which is either the app, or the sequence that
// gets there. This reports what is actually on the page.
import { serve, open, boot, until, APP_DIR } from "../lib.mjs";

const srv = await serve(APP_DIR);
const { browser, page: pg, errors } = await open(srv.port);
await boot(pg, srv.port, { mode: "Split", settle: 6000 });

const snapshot = async (label) => {
  const s = await pg.evaluate(() => ({
    dots: document.querySelectorAll(".pf-node-dot").length,
    mapButtons: [...document.querySelectorAll("button[aria-label]")]
      .filter((b) => b.offsetParent !== null)
      .map((b) => b.getAttribute("aria-label")),
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    active: document.activeElement?.className?.toString().slice(0, 60) ?? "",
    url: location.href,
  }));
  console.log(label, JSON.stringify(s, null, 2));
  return s;
};

// Reproduce the tail of the surfaces case.
await pg.goto(`http://127.0.0.1:${srv.port}/?readonly=1`, { waitUntil: "networkidle" });
await until(async () => (await pg.locator(".ProseMirror").count()) > 0);
await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "networkidle" });
await until(async () => (await pg.locator('button[aria-label*="Bold" i], button[title*="Bold" i]').count()) > 0);

for (const [w, h] of [[1440, 900], [1024, 800], [900, 800], [768, 900], [480, 800], [375, 700]]) {
  await pg.setViewportSize({ width: w, height: h });
  await until(async () => (await pg.locator(".ProseMirror, .cm-content").count()) >= 2);
  await pg.waitForTimeout(400);
}

await pg.setViewportSize({ width: 375, height: 700 });
await pg.waitForTimeout(600);
await snapshot("before ⌘⇧G:");
await pg.keyboard.press("Control+Shift+G");
await pg.waitForTimeout(4000);
await snapshot("after ⌘⇧G:");

// Does clicking into the editor first make the shortcut land?
await pg.locator(".ProseMirror, .cm-content").first().click().catch(() => {});
await pg.keyboard.press("Control+Shift+G");
await pg.waitForTimeout(4000);
await snapshot("after clicking in, then ⌘⇧G:");

console.log("console errors:", errors.slice(0, 5));
await browser.close();
srv.close();
