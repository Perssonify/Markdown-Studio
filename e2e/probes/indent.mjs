// What do the Indent / Outdent buttons actually do, and where?
//
// Rich pane: sinkListItem/liftListItem are LIST-ONLY ProseMirror commands.
// Markdown pane: CodeMirror's indentMore/indentLess act on any line.
// This reports, per context, whether the document changed at all.
import { serve, open, boot, APP_DIR } from "../lib.mjs";

const srv = await serve(APP_DIR);
const { browser, page: pg, errors } = await open(srv.port);
await boot(pg, srv.port, { mode: "Split", settle: 7000 });

const setMd = async (text) => {
  await pg.locator(".cm-content").first().click();
  await pg.keyboard.press("Control+a");
  await pg.keyboard.type(text, { delay: 2 });
  await pg.waitForTimeout(2500);
};
const richHtml = () => pg.evaluate(() => document.querySelector(".ProseMirror").innerHTML);
const mdAll = () => pg.evaluate(() =>
  [...document.querySelectorAll(".cm-line")].map((l) => l.textContent).join("\n"));

const btn = (name) => pg.locator(`button[aria-label="${name}"]`).first();

/** Click into the rich pane at the text `needle`, then press the button. */
async function tryRich(label, needle, buttonName) {
  const before = await richHtml();
  const ok = await pg.evaluate((n) => {
    const walk = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walk.nextNode())) {
      if (node.textContent.includes(n)) {
        const r = document.createRange();
        r.setStart(node, Math.min(2, node.length));
        r.collapse(true);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        document.querySelector(".ProseMirror").focus();
        return true;
      }
    }
    return false;
  }, needle);
  if (!ok) { console.log(`  ${label}: (could not place caret on "${needle}")`); return; }
  await pg.waitForTimeout(300);
  await btn(buttonName).click();
  await pg.waitForTimeout(900);
  const after = await richHtml();
  console.log(`  ${label} → ${before === after ? "NO CHANGE" : "changed"}`);
}

/** Put the caret on the md line containing `needle`, then press the button. */
async function tryMd(label, needle, buttonName) {
  const before = await mdAll();
  const ok = await pg.evaluate((n) => {
    const line = [...document.querySelectorAll(".cm-line")].find((l) => l.textContent.includes(n));
    if (!line) return false;
    const t = line.firstChild ?? line;
    const r = document.createRange();
    r.setStart(t, 0); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.querySelector(".cm-content").focus();
    return true;
  }, needle);
  if (!ok) { console.log(`  ${label}: (no line "${needle}")`); return; }
  await pg.waitForTimeout(300);
  await btn(buttonName).click();
  await pg.waitForTimeout(900);
  const after = await mdAll();
  console.log(`  ${label} → ${before === after ? "NO CHANGE" : "changed"}`);
}

await setMd([
  "# Probe",
  "",
  "A plain paragraph here.",
  "",
  "- first bullet",
  "- second bullet",
  "- third bullet",
  "",
  "1. first number",
  "2. second number",
  "",
  "- [ ] first task",
  "- [ ] second task",
  "",
  "> a blockquote line",
].join("\n"));

console.log("RICH pane (sinkListItem / liftListItem):");
await tryRich("paragraph, Indent      ", "plain paragraph", "Indent");
await tryRich("1st bullet, Indent     ", "first bullet", "Indent");
await tryRich("2nd bullet, Indent     ", "second bullet", "Indent");
await tryRich("2nd bullet, Outdent    ", "second bullet", "Outdent");
await tryRich("2nd numbered, Indent   ", "second number", "Indent");
await tryRich("2nd task item, Indent  ", "second task", "Indent");
await tryRich("blockquote, Indent     ", "a blockquote", "Indent");

console.log("\nMARKDOWN pane (CodeMirror indentMore / indentLess):");
await tryMd("paragraph, Indent      ", "plain paragraph", "Indent");
await tryMd("2nd bullet, Indent     ", "second bullet", "Indent");
await tryMd("2nd task item, Indent  ", "second task", "Indent");

console.log("\nconsole errors:", errors.slice(0, 5));
await browser.close();
srv.close();
