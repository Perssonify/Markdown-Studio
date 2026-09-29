import { serve, open, APP_DIR } from "../lib.mjs";
const srv = await serve(APP_DIR);
const { browser, page: pg } = await open(srv.port);
pg.on("console", (m) => console.log("[c]", m.type(), m.text().slice(0, 220)));
pg.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
await pg.addInitScript(() => {
  indexedDB.open = () => { throw new DOMException("The user denied permission", "SecurityError"); };
});
await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "networkidle" });
await pg.waitForTimeout(9000);
console.log("ProseMirror:", await pg.locator(".ProseMirror").count());
console.log("body:", JSON.stringify((await pg.evaluate(() => document.body.innerText)).slice(0, 400)));
await browser.close(); srv.close();
