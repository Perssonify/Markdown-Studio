// The shortcut hook registers a CAPTURE-phase keydown listener on `document`.
// If any of its dependencies changes identity per render, that listener is
// removed and re-added on the hottest path in the app.
import { serve, open, boot, APP_DIR } from "../lib.mjs";
const srv = await serve(APP_DIR);
const { browser, page: pg } = await open(srv.port);
await pg.addInitScript(() => {
  window.__lc = { add: 0, remove: 0 };
  const add = document.addEventListener.bind(document);
  const rm = document.removeEventListener.bind(document);
  document.addEventListener = (t, f, o) => { if (t === "keydown" && (o === true || o?.capture)) window.__lc.add++; return add(t, f, o); };
  document.removeEventListener = (t, f, o) => { if (t === "keydown" && (o === true || o?.capture)) window.__lc.remove++; return rm(t, f, o); };
});
await boot(pg, srv.port, { mode: "Split", settle: 7000 });
await pg.locator(".ProseMirror").first().click();
const before = await pg.evaluate(() => ({ ...window.__lc }));
await pg.keyboard.type("counting listener churn while typing a sentence.", { delay: 20 });
await pg.waitForTimeout(3000);
const after = await pg.evaluate(() => ({ ...window.__lc }));
console.log("capture keydown add/remove — before:", JSON.stringify(before), "after:", JSON.stringify(after));
console.log("re-subscriptions during 47 keystrokes:", after.add - before.add);
await browser.close(); srv.close();
