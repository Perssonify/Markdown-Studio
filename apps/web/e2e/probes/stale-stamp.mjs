// Two dictations separated by longer than COMPOSITION_STALL_MS. The liveness
// stamp must belong to the CURRENT composition: derived only from updates, it
// stayed at the first dictation's timestamp, so the second was declared stuck
// on its very first check and a projection could dispatch into it.
import { serve, open, boot, seed, mdText, richText, APP_DIR } from "../lib.mjs";
import { proseDoc } from "../docs.mjs";
const srv = await serve(APP_DIR);
const { browser, page: pg, cdp } = await open(srv.port, { cdp: true });
await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
await seed(pg, [proseDoc("aaa", "Alpha doc", 1)]);
await boot(pg, srv.port, { mode: "Split", settle: 6000 });

async function dictation(mark) {
  await pg.locator(".ProseMirror").first().click();   // rich pane: setValue writes CM, guard is CM's
  await pg.keyboard.press("Control+End");
  await pg.keyboard.press("Enter");
  await pg.waitForTimeout(200);
  for (const n of [4, 8, mark.length]) {
    const t = mark.slice(0, n);
    await cdp.send("Input.imeSetComposition", { text: t, selectionStart: t.length, selectionEnd: t.length });
    await pg.waitForTimeout(60);
  }
  await cdp.send("Input.insertText", { text: mark });
  await pg.waitForTimeout(2500);
  return { md: (await mdText(pg)).includes(mark), rich: (await richText(pg)).includes(mark) };
}

console.log("first  dictation:", JSON.stringify(await dictation("FIRSTDICTATIONX")));
console.log("waiting past the stall window…");
await pg.waitForTimeout(11000);
console.log("second dictation:", JSON.stringify(await dictation("SECONDDICTATIONX")));
await browser.close(); srv.close();
