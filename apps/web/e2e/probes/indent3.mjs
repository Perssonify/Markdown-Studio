// Real mouse clicks and real keys — no synthetic Ranges.
// Tab is TipTap's own sinkListItem binding; the toolbar button is the app's path.
import { serve, open, boot, APP_DIR } from "../lib.mjs";

const srv = await serve(APP_DIR);
const { browser, page: pg, errors } = await open(srv.port);
await boot(pg, srv.port, { mode: "Split", settle: 7000 });

await pg.locator(".cm-content").first().click();
await pg.keyboard.press("Control+a");
await pg.keyboard.type("- alpha\n- bravo\n- charlie\n", { delay: 3 });
await pg.waitForTimeout(3000);

const html = () => pg.evaluate(() => document.querySelector(".ProseMirror").innerHTML);
// Count nesting honestly: a <ul> that is INSIDE an <li>.
const nested = async () =>
  pg.evaluate(() => document.querySelectorAll(".ProseMirror li ul, .ProseMirror li ol").length);
const dump = async () => (await html()).replace(/\s+/g, " ").slice(0, 300);

/** Click directly on the word "bravo" in the rich pane. */
async function caretOnBravo() {
  const el = pg.locator(".ProseMirror li", { hasText: "bravo" }).last();
  await el.click();
  await pg.waitForTimeout(400);
  return pg.evaluate(() => getSelection()?.anchorNode?.textContent?.slice(0, 20) ?? "(none)");
}

console.log("caret lands on:", await caretOnBravo());
console.log("nested before:", await nested());
console.log("html:", await dump());

await pg.keyboard.press("Tab");
await pg.waitForTimeout(800);
console.log("after Tab            → nested:", await nested());

// Undo, then try the toolbar button from the same caret position.
await pg.keyboard.press("Control+z");
await pg.waitForTimeout(1200);
console.log("after undo           → nested:", await nested());

console.log("caret lands on:", await caretOnBravo());
await pg.locator('button[aria-label="Indent"]').first().click();
await pg.waitForTimeout(1000);
console.log("after Indent button  → nested:", await nested());

// And the keyboard shortcut the Help page documents.
await pg.keyboard.press("Control+z");
await pg.waitForTimeout(1200);
console.log("caret lands on:", await caretOnBravo());
await pg.keyboard.press("Control+]");
await pg.waitForTimeout(1000);
console.log("after Ctrl+]         → nested:", await nested());

console.log("final html:", await dump());
console.log("\nconsole errors:", errors.slice(0, 5));
await browser.close();
srv.close();
