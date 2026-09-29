// What does markdown-pane Indent do to a PARAGRAPH?
// Four leading spaces is an indented code block in markdown.
import { serve, open, boot, seed, mdText, richText, APP_DIR } from "../lib.mjs";

const P = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const doc = { id: "ind5", title: "MD indent probe", canonical: { type: "doc", content: [
  { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "MD indent probe" }] },
  P("A plain paragraph that should stay prose."),
] } };

const srv = await serve(APP_DIR);
const { browser, page: pg, errors } = await open(srv.port);
await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
await seed(pg, [doc]);
await boot(pg, srv.port, { mode: "Split", settle: 8000 });
await pg.locator("text=MD indent probe").first().click({ timeout: 15000 }).catch(() => {});
await pg.waitForTimeout(2500);

// Caret on the paragraph line in the MARKDOWN pane.
await pg.evaluate(() => {
  const line = [...document.querySelectorAll(".cm-line")].find((l) => l.textContent.includes("should stay prose"));
  const r = document.createRange(); r.setStart(line.firstChild ?? line, 0); r.collapse(true);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  document.querySelector(".cm-content").focus();
});
await pg.waitForTimeout(400);

const richHas = async (sel) => pg.evaluate((s) => !!document.querySelector(s), sel);
console.log("before: rich pane has <pre>:", await richHas(".ProseMirror pre"));

for (let i = 1; i <= 2; i++) {
  await pg.locator('button[aria-label="Indent"]').first().click();
  await pg.waitForTimeout(1600);
  const md = (await mdText(pg)).split("\n").find((l) => l.includes("should stay prose")) ?? "";
  console.log(`after ${i}× Indent: md line = ${JSON.stringify(md)}`);
  console.log(`                   rich pane has <pre>:`, await richHas(".ProseMirror pre"),
              "| rich text:", JSON.stringify((await richText(pg)).slice(-60)));
}

console.log("\nconsole errors:", errors.slice(0, 5));
await browser.close();
srv.close();
