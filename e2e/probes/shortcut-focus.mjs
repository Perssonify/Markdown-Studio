// Where does focus sit after a cold load, and do the shortcuts work there?
//
// `useKeyboardShortcuts` listens on the document and acts only when focus is
// INSIDE this editor instance or "nowhere in particular" (body). If anything
// else on the page holds focus — the app shell, say — every shortcut is dead
// until the user clicks into the editor.
import { serve, open, boot, APP_DIR } from "../lib.mjs";

const srv = await serve(APP_DIR);
const { browser, page: pg, errors } = await open(srv.port);

const where = () =>
  pg.evaluate(() => {
    const a = document.activeElement;
    return {
      tag: a?.tagName ?? "(none)",
      cls: (a?.className ?? "").toString().slice(0, 60),
      isBody: a === document.body,
      insideEditor: !!a && !!a.closest?.(".perssonify-editor, [data-pf-editor]"),
    };
  });

await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "networkidle" });
await pg.waitForTimeout(6000);
console.log("cold load, before dismissing the tour:", JSON.stringify(await where()));

await boot(pg, srv.port, { mode: "Split", settle: 6000 });
console.log("after boot():", JSON.stringify(await where()));

const tryShortcut = async (label) => {
  const before = await pg.evaluate(() => location.pathname);
  await pg.keyboard.press("Control+Shift+G");
  await pg.waitForTimeout(2500);
  const after = await pg.evaluate(() => location.pathname);
  console.log(`${label}: ⌘⇧G ${before} → ${after} (${after !== before ? "WORKED" : "DEAD"})`);
  if (after !== before) { await pg.keyboard.press("Escape"); await pg.waitForTimeout(1200); }
};

await tryShortcut("after boot");

// A reload, which is the state a user is in before their first click.
await pg.reload({ waitUntil: "networkidle" });
await pg.waitForTimeout(6000);
console.log("after reload:", JSON.stringify(await where()));
await tryShortcut("after reload, no click");

await pg.locator(".ProseMirror").first().click();
console.log("after clicking the editor:", JSON.stringify(await where()));
await tryShortcut("after clicking the editor");

console.log("console errors:", errors.slice(0, 3));
await browser.close();
srv.close();
