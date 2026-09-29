import { serve, open, boot, seed, APP_DIR } from "../lib.mjs";
import { library } from "../docs.mjs";
const srv = await serve(APP_DIR);
const { browser, page: pg, errors } = await open(srv.port);
pg.on("console", (m) => { if (m.type() !== "log") console.log("[c]", m.type(), m.text().slice(0, 200)); });
await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
await seed(pg, library(120, { kb: 1 }));
await boot(pg, srv.port, { mode: "Split", settle: 14000 });
console.log("docs listed:", await pg.evaluate(() => (document.body.innerText.match(/(\d+) DOCUMENTS?/) || [])[1]));
console.log("editor:", await pg.locator(".ProseMirror").count());
await pg.locator(".ProseMirror").first().click();
await pg.waitForTimeout(500);
await pg.keyboard.press("Control+Shift+G");
await pg.waitForTimeout(2500);
console.log("after chord w/ editor focus: dots=", await pg.locator(".pf-node-dot").count());
if ((await pg.locator(".pf-node-dot").count()) === 0) {
  const mapBtn = pg.locator('button:has-text("Map")').first();
  console.log("Map button count:", await mapBtn.count());
  await mapBtn.click().catch((e) => console.log("click failed", String(e).slice(0,120)));
}
for (const t of [2000, 5000, 10000, 20000]) {
  await pg.waitForTimeout(t === 2000 ? 2000 : 3000);
  console.log(`after ~${t}ms: dots=${await pg.locator(".pf-node-dot").count()} svg=${await pg.locator("svg").count()} overlayText=${JSON.stringify((await pg.evaluate(() => document.body.innerText)).slice(0, 120))}`);
}
console.log("errors:", errors.slice(0, 3));
await browser.close(); srv.close();
