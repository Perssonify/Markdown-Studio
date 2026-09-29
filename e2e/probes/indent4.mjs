// Indent / Outdent against a REAL list, seeded as canonical PM JSON.
// (Typing "- a\n- b\n" into CodeMirror triggers list auto-continuation and
//  yields three SEPARATE one-item lists — a broken fixture, not a broken app.)
import { serve, open, boot, seed, until, APP_DIR } from "../lib.mjs";

const P = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const li = (t) => ({ type: "listItem", content: [P(t)] });
const doc = {
  id: "ind", title: "Indent probe",
  canonical: { type: "doc", content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Indent probe" }] },
    P("A plain paragraph."),
    { type: "bulletList", content: [li("alpha"), li("bravo"), li("charlie")] },
    { type: "orderedList", content: [li("one"), li("two")] },
    { type: "taskList", content: [
      { type: "taskItem", attrs: { checked: false }, content: [P("task one")] },
      { type: "taskItem", attrs: { checked: false }, content: [P("task two")] },
    ] },
    { type: "blockquote", content: [P("a quoted line")] },
  ] },
};

const srv = await serve(APP_DIR);
const { browser, page: pg, errors } = await open(srv.port);
await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
await seed(pg, [doc]);
await boot(pg, srv.port, { mode: "Split", settle: 8000 });
await pg.locator("text=Indent probe").first().click({ timeout: 15000 }).catch(() => {});
await pg.waitForTimeout(2500);

const nestedCount = () =>
  pg.evaluate(() => document.querySelectorAll(".ProseMirror li ul, .ProseMirror li ol").length);
const html = () => pg.evaluate(() => document.querySelector(".ProseMirror").innerHTML);

async function caretOn(word) {
  const el = pg.locator(".ProseMirror p", { hasText: new RegExp(`^${word}$`) }).first();
  if (!(await el.count())) return false;
  await el.click();
  await pg.waitForTimeout(350);
  return true;
}

async function press(word, how) {
  if (!(await caretOn(word))) { console.log(`  ${how} on "${word}": caret not placed`); return; }
  const before = await html();
  const nb = await nestedCount();
  if (how === "Tab") await pg.keyboard.press("Tab");
  else if (how === "Ctrl+]") await pg.keyboard.press("Control+]");
  else if (how === "Ctrl+[") await pg.keyboard.press("Control+[");
  else await pg.locator(`button[aria-label="${how}"]`).first().click();
  await pg.waitForTimeout(900);
  const changed = (await html()) !== before;
  console.log(`  ${how.padEnd(8)} on "${word}"`.padEnd(34) +
    `→ ${changed ? "changed" : "NO CHANGE"}   nesting ${nb} → ${await nestedCount()}`);
}

console.log("baseline nesting:", await nestedCount());
console.log("\nRICH pane:");
for (const [word, how] of [
  ["bravo", "Indent"], ["bravo", "Tab"], ["bravo", "Ctrl+]"],
  ["alpha", "Indent"], ["two", "Indent"], ["task two", "Indent"],
  ["A plain paragraph.", "Indent"], ["a quoted line", "Indent"],
]) await press(word, how);

console.log("\noutdent, after the nesting above:");
await press("bravo", "Outdent");

console.log("\nconsole errors:", errors.slice(0, 5));
await browser.close();
srv.close();
