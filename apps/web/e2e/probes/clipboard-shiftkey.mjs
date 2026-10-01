// Does a ClipboardEvent carry shiftKey at all? `handleHtmlPaste` reads
// `event.shiftKey` to INVERT the styled-paste preference for one paste.
import { serve, open, boot, APP_DIR } from "../lib.mjs";
const srv = await serve(APP_DIR);
const { browser, page: pg } = await open(srv.port);
await boot(pg, srv.port, { mode: "Split", settle: 5000 });
console.log(await pg.evaluate(() => {
  const e = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
  const withInit = new ClipboardEvent("paste", { shiftKey: true });
  return {
    shiftKeyInPrototypeChain: "shiftKey" in e,
    valueOnPlain: e.shiftKey,
    valueWhenInitAsksForIt: withInit.shiftKey,
    ctor: Object.getPrototypeOf(e).constructor.name,
    inheritsUIEvent: e instanceof UIEvent,
  };
}));
// And what a REAL paste gesture delivers: Chromium synthesises one for
// Control+V / Shift+Insert through the input pipeline.
await pg.locator(".ProseMirror").first().click();
await pg.evaluate(() => {
  window.__paste = [];
  document.addEventListener("paste", (ev) => window.__paste.push({
    hasShift: "shiftKey" in ev, shift: ev.shiftKey, isUIEvent: ev instanceof UIEvent,
  }), true);
});
await pg.keyboard.press("Control+v");
await pg.keyboard.press("Shift+Insert");
await pg.waitForTimeout(800);
console.log("real paste gestures:", JSON.stringify(await pg.evaluate(() => window.__paste)));
await browser.close(); srv.close();
