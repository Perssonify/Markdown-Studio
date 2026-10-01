// Is it JUST ⌘⇧G that is dead after a reload, or every shortcut?
import { serve, open, boot, APP_DIR } from "../lib.mjs";

const srv = await serve(APP_DIR);
const { browser, page: pg, errors } = await open(srv.port);
await boot(pg, srv.port, { mode: "Split", settle: 6000 });

const probe = async (label) => {
  const out = {};
  // ⌘⇧G — route change
  const before = await pg.evaluate(() => location.pathname);
  await pg.keyboard.press("Control+Shift+G");
  await pg.waitForTimeout(2000);
  out.graph = (await pg.evaluate(() => location.pathname)) !== before ? "works" : "DEAD";
  if (out.graph === "works") { await pg.keyboard.press("Escape"); await pg.waitForTimeout(1000); }

  // ⌘⇧K — the cards overlay
  await pg.keyboard.press("Control+Shift+K");
  await pg.waitForTimeout(2000);
  out.cards = (await pg.evaluate(() =>
    !!document.querySelector('button[aria-label="Back to the editor"]'))) ? "works" : "DEAD";
  if (out.cards === "works") { await pg.keyboard.press("Escape"); await pg.waitForTimeout(1000); }

  // ⌘⇧D — the workspace panel
  const visible = () => pg.evaluate(() =>
    !!document.querySelector('button[aria-label="Close workspace panel"]'));
  const wasOpen = await visible();
  await pg.keyboard.press("Control+Shift+D");
  await pg.waitForTimeout(1200);
  out.panel = (await visible()) !== wasOpen ? "works" : "DEAD";
  if (out.panel === "works") { await pg.keyboard.press("Control+Shift+D"); await pg.waitForTimeout(800); }

  // ⌘F — Find
  await pg.keyboard.press("Control+f");
  await pg.waitForTimeout(1200);
  out.find = (await pg.evaluate(() =>
    !!document.querySelector('input[placeholder*="Find" i]'))) ? "works" : "DEAD";
  if (out.find === "works") { await pg.keyboard.press("Escape"); await pg.waitForTimeout(600); }

  console.log(label, JSON.stringify(out));
};

await probe("after boot():          ");
await pg.reload({ waitUntil: "networkidle" });
await pg.waitForTimeout(7000);
await probe("after reload (no click):");
await pg.locator(".ProseMirror").first().click();
await pg.waitForTimeout(500);
await probe("after clicking in:     ");

console.log("console errors:", errors.slice(0, 3));
await browser.close();
srv.close();
