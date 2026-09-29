// Does wheel-zoom work on the relationship map?
//
// The wheel listener is attached in an effect whose only dependency (`toRaw`) is
// a useCallback with an EMPTY dependency array — so the effect runs exactly
// once, on mount. The map renders an empty-state instead of the <svg> until the
// graph data arrives, which happens after mount. If the svg is absent on that
// one run, the listener is never attached and the wheel does nothing for the
// rest of the session.
import { serve, open, boot, until, APP_DIR } from "../lib.mjs";

const srv = await serve(APP_DIR);
const { browser, page: pg, errors } = await open(srv.port);
await boot(pg, srv.port, { mode: "Split", settle: 6000 });

await pg.keyboard.press("Control+Shift+G");
await until(async () => (await pg.locator(".pf-node-dot").count()) > 0, { timeout: 20000 });

// The readout is the <span> between the two zoom buttons in the footer strip.
const zoomLabel = () =>
  pg.evaluate(() => {
    const out = [...document.querySelectorAll("span")]
      .map((s) => s.textContent.trim())
      .filter((t) => /^\d+%$/.test(t));
    return out[0] ?? "(no zoom readout)";
  });

console.log("svg present:", await pg.locator("svg[role='group']").count());
const before = await zoomLabel();

const box = await pg.locator("svg[role='group']").first().boundingBox();
await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await pg.mouse.wheel(0, -400);
await pg.waitForTimeout(800);
const afterWheel = await zoomLabel();

// The footer's zoom buttons go through a different path (a click handler, not
// the effect), so they isolate the listener from the camera itself.
await pg.locator('button[aria-label="Zoom in"]').first().click();
await pg.waitForTimeout(600);
const afterButton = await zoomLabel();

console.log(JSON.stringify({ before, afterWheel, afterButton }, null, 2));
console.log(afterWheel === before ? "WHEEL ZOOM IS DEAD" : "wheel zoom works");
console.log("console errors:", errors.slice(0, 3));
await browser.close();
srv.close();
