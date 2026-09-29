// Decisive test that editorProps.handlePaste is live: only OUR handler inverts
// the styled-paste preference on Shift. ProseMirror's default paste has no
// such notion, so if Shift strips the colour, the handler ran.
import { serve, open, boot, seed, richHtml, APP_DIR } from "../lib.mjs";
import { proseDoc } from "../docs.mjs";
const srv = await serve(APP_DIR);
const { browser, page: pg } = await open(srv.port);
await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
await seed(pg, [proseDoc("aaa", "Alpha doc", 1)]);
await boot(pg, srv.port, { mode: "Split", settle: 6000 });

async function paste(shift, mark) {
  await pg.locator(".ProseMirror").first().click();
  await pg.keyboard.press("Control+End");
  await pg.keyboard.press("Enter");
  // A REAL Shift keydown, so ProseMirror records the modifier the way it does
  // for a genuine ⇧+paste. The ClipboardEvent itself cannot carry it.
  if (shift) await pg.keyboard.down("Shift");
  await pg.evaluate(({ shift, mark }) => {
    const dt = new DataTransfer();
    dt.setData("text/html", `<p><span style="color: rgb(220, 30, 30)">${mark}</span></p>`);
    dt.setData("text/plain", mark);
    document.querySelector(".ProseMirror").dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true, shiftKey: shift }));
  }, { shift, mark });
  if (shift) await pg.keyboard.up("Shift");
  await pg.waitForTimeout(600);
  const toast = (await pg.evaluate(() => document.body.innerText)).match(/Pasted[^\n]*/);
  await pg.waitForTimeout(1500);
  const html = await richHtml(pg);
  const m = html.match(new RegExp(`<[^>]*>[^<]*${mark}`));
  return { toast: toast ? toast[0] : "(none)", coloured: /color:\s*rgb\(220,\s*30,\s*30\)/.test(m ? m[0] : "") };
}

console.log("plain paste (pref = styled):", JSON.stringify(await paste(false, "PLAINPASTEMARK")));
console.log("shift paste (inverts to strip):", JSON.stringify(await paste(true, "SHIFTPASTEMARK")));
await browser.close(); srv.close();
