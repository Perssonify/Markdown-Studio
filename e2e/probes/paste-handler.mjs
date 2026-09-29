// Does TiptapPane's editorProps.handlePaste survive the theme/spellcheck effect,
// which calls editor.setOptions({ editorProps: { attributes } })? setOptions
// REPLACES editorProps, and that effect runs on mount.
import { serve, open, boot, seed, mdText, richText, APP_DIR } from "../lib.mjs";
import { proseDoc } from "../docs.mjs";
const srv = await serve(APP_DIR);
const { browser, page: pg } = await open(srv.port);
await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
await seed(pg, [proseDoc("aaa", "Alpha doc", 1)]);
await boot(pg, srv.port, { mode: "Split", settle: 6000 });

console.log("handlePaste present:", await pg.evaluate(() => {
  // Reach the live editor through the ProseMirror view's own props.
  const dom = document.querySelector(".ProseMirror");
  const view = dom && (dom.pmViewDesc?.view ?? null);
  return view ? typeof view.someProp?.("handlePaste") : "no view handle";
}));

await pg.locator(".ProseMirror").first().click();
await pg.keyboard.press("Control+End");
await pg.keyboard.press("Enter");
await pg.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData("text/html", '<p><span style="color: rgb(220, 30, 30)">STYLEDPASTE</span></p>');
  dt.setData("text/plain", "STYLEDPASTE");
  document.querySelector(".ProseMirror").dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
await pg.waitForTimeout(4000);
const body = await pg.evaluate(() => document.body.innerText);
console.log("toast shown:", /Pasted with styles|styles stripped/.test(body), "|",
  (body.match(/Pasted[^\n]*/) || ["(none)"])[0]);
console.log("colour survived:", /color:\s*rgb\(220,\s*30,\s*30\)/.test(await pg.evaluate(() => document.querySelector(".ProseMirror").innerHTML)));
const md = await mdText(pg);
console.log("md contains STYLEDPASTE:", md.includes("STYLEDPASTE"), "| md length:", md.length);
console.log("rich contains:", (await richText(pg)).includes("STYLEDPASTE"));
console.log("md tail:", JSON.stringify(md.slice(-160)));
await pg.waitForTimeout(4000);
const md2 = await mdText(pg);
console.log("after +4s md contains:", md2.includes("STYLEDPASTE"));
await browser.close(); srv.close();
