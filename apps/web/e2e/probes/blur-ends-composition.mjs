// Does blurring a pane END an in-flight composition, and does the composed text
// land in that pane's own document? The leaving-path fix depends on it.
import { serve, open, boot, seed, mdText, richText, APP_DIR } from "../lib.mjs";
import { proseDoc } from "../docs.mjs";

const MARK = "BLURTESTMARK";
const srv = await serve(APP_DIR);
const { browser, page: pg, cdp } = await open(srv.port, { cdp: true });
await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
await seed(pg, [proseDoc("aaa", "Alpha doc", 1)]);
await boot(pg, srv.port, { mode: "Split", settle: 6000 });

for (const [pane, sel] of [["md", ".cm-content"], ["rich", ".ProseMirror"]]) {
  await pg.locator(sel).first().click();
  await pg.keyboard.press("Control+End");
  await pg.keyboard.press("Enter");
  await pg.waitForTimeout(300);
  await pg.evaluate(() => { window.__ce = 0; document.addEventListener("compositionend", () => window.__ce++, true); });

  for (const n of [4, 8, MARK.length]) {
    const t = MARK.slice(0, n);
    await cdp.send("Input.imeSetComposition", { text: t, selectionStart: t.length, selectionEnd: t.length });
    await pg.waitForTimeout(50);
  }
  // Blur synchronously, then read immediately — no awaits in between.
  const sync = await pg.evaluate((sel) => {
    const el = document.querySelector(sel);
    const before = window.__ce;
    el.blur();
    const after = window.__ce;
    const text = sel === ".cm-content"
      ? [...document.querySelectorAll(".cm-line")].map(l => l.textContent).join("\n")
      : document.querySelector(".ProseMirror").textContent;
    return { compositionEndBeforeBlur: before, compositionEndAfterBlur: after, textRightAfterBlur: text.slice(-30) };
  }, sel);
  await pg.waitForTimeout(600);
  console.log(pane, JSON.stringify(sync),
    "| md:", (await mdText(pg)).includes(MARK), "| rich:", (await richText(pg)).includes(MARK));
}
await browser.close(); srv.close();
