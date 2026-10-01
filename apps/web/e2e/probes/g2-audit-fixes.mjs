// Evidence for the G2 audit fixes, in a real browser (what jsdom cannot show):
//   A052  AltGr typing ([ ] \) reaches both panes instead of being eaten as
//         outdent / indent / CodeMirror's indentSelection.
//   A025  ⌘B typed in the Cards composer does not format the hidden document.
//   A058  a [[link]] to a missing note is marked in the rich pane.
//   A061  a catastrophic Find regex runs in a Worker and times out; the page
//         stays responsive meanwhile. A normal regex still counts.
//   A065  map wheel-zoom works on a LATER open (it was dead after the first).
//   A057  Escape on a card's delete confirmation closes the dialog, not the board.
//
// Each section is independent (a failure is recorded and the next one runs),
// so the same probe can be pointed at an older build: E2E_APP_DIR=<dist-app>.
// Against v1.77.0 (the audited build) A052, A058, A061, A065 and A057 fail.
import { serve, open, boot, seed, until, mdText, APP_DIR } from "../lib.mjs";

const para = (...content) => ({ type: "paragraph", content });
const text = (t, marks) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });
const doc = (id, title, ...blocks) => ({ id, title, canonical: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [text(title)] }, ...blocks] } });

const srv = await serve(APP_DIR);
const rig = await open(srv.port, { cdp: true });
const { page: pg, cdp, errors, browser } = rig;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

/** Run one section; a throw is a FAIL for it, and the page is reset for the next. */
async function section(name, body) {
  try {
    await body();
  } catch (e) {
    check(`${name} (section crashed)`, false, String(e?.message ?? e).split("\n")[0]);
  }
  // Reset: close Find, any overlay, any dialog.
  for (let i = 0; i < 3; i++) {
    const close = pg.locator('button[aria-label="Close find and replace"]').first();
    if (await close.count()) await close.click().catch(() => {});
    await pg.keyboard.press("Escape").catch(() => {});
    await pg.waitForTimeout(250);
  }
  const back = pg.locator('button[aria-label="Back to the editor"]').first();
  if (await back.count()) await back.click().catch(() => {});
  await pg.waitForTimeout(500);
}

// Count Worker constructions, so the Find check proves the Worker path ran
// (the main-thread fallback would report the same error for `(a+)+$`).
await pg.addInitScript(() => {
  const W = window.Worker;
  window.__workers = 0;
  window.Worker = function (...args) { window.__workers++; return new W(...args); };
});
await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
await seed(pg, [
  doc("aaa", "Alpha doc", para(text("links to "), text("Beta doc", [{ type: "link", attrs: { href: "#", docLink: "Beta doc", anchor: null } }]))),
  doc("bbb", "Beta doc", para(text("Beta body with 12px and 5em"))),
  doc("ccc", "Gamma doc", para(text("a".repeat(30) + "!"))),
]);
await boot(pg, srv.port, { mode: "Split", settle: 6000 });
const openDoc = async (title) => {
  await pg.locator(`text=${title}`).first().click({ timeout: 15000 }).catch(() => {});
  await pg.waitForTimeout(1500);
};
await openDoc("Alpha doc");

async function altGr(key, code, vk) {
  const base = { modifiers: 3 /* Alt | Ctrl — how Windows delivers AltGr */, key, code, windowsVirtualKeyCode: vk };
  await cdp.send("Input.dispatchKeyEvent", { ...base, type: "keyDown", text: key, unmodifiedText: key });
  await cdp.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
}

await section("A052 markdown pane", async () => {
  await pg.locator(".cm-content").first().click();
  await pg.keyboard.press("Control+End");
  await pg.keyboard.press("Enter");
  await altGr("[", "Digit8", 56);   // German AltGr+8
  await altGr("]", "Digit9", 57);   // German AltGr+9
  await altGr("\\", "Minus", 219);  // German AltGr+ß — CodeMirror's Mod-Alt-\ used to eat it
  await pg.waitForTimeout(400);
  const md = await mdText(pg);
  check("A052 AltGr types [ ] \\ into the markdown pane", md.includes("[]\\"), JSON.stringify(md.slice(-40)));
});

await section("A052 rich pane", async () => {
  await pg.locator(".ProseMirror").first().click();
  await pg.keyboard.press("Control+End");
  await altGr("[", "KeyF", 70);     // Hungarian AltGr+F
  await pg.waitForTimeout(400);
  const rich = await pg.evaluate(() => document.querySelector(".ProseMirror")?.textContent ?? "");
  const findOpen = await pg.locator('[aria-label="Find and replace"]').count();
  check("A052 Hungarian AltGr+F types [ in the rich pane and opens nothing", rich.includes("[") && findOpen === 0, `find panels: ${findOpen}`);
});

await section("A025", async () => {
  const before = await mdText(pg);
  await pg.keyboard.press("Control+Shift+K");
  await until(async () => (await pg.locator('[data-workspace-overlay="cards"]').count()) > 0, { timeout: 15000 });
  await pg.locator("text=Take a note…").first().click();
  await pg.keyboard.type("quick note");
  await pg.keyboard.press("Control+a");
  await pg.keyboard.press("Control+b");
  await pg.waitForTimeout(500);
  await pg.locator('button:has-text("Cancel")').first().click();
  await pg.locator('button[aria-label="Back to the editor"]').first().click();
  await until(async () => (await pg.locator("[data-workspace-overlay]").count()) === 0, { timeout: 5000 }).catch(() => {});
  await pg.waitForTimeout(800);
  const after = await mdText(pg);
  check("A025 ⌘B in the Cards composer leaves the document alone", after === before, after === before ? "" : "document changed");
});

await section("A058", async () => {
  await pg.locator(".cm-content").first().click();
  await pg.keyboard.press("Control+End");
  await pg.keyboard.press("Enter");
  await pg.keyboard.type("see [[Nowhere at all]] and [[Beta doc]]");
  const read = () => pg.evaluate(() => {
    const deco = [...document.querySelectorAll(".ProseMirror a.wiki-link .wiki-link-unresolved")].map((e) => e.textContent);
    const attr = [...document.querySelectorAll(".ProseMirror a.wiki-link[data-unresolved]")].map((e) => e.textContent);
    return [...deco, ...attr];
  });
  const ok = await until(async () => (await read()).join("|") === "Nowhere at all", { timeout: 15000 });
  check("A058 only the missing link is marked broken", ok, JSON.stringify(await read()));
});

await section("A061", async () => {
  await openDoc("Gamma doc");
  await pg.locator(".cm-content").first().click();
  await pg.keyboard.press("Control+f");
  const input = pg.locator('[aria-label="Find in Markdown"], input[placeholder="Find in Markdown..."]').first();
  await input.waitFor({ timeout: 10000 });
  await pg.locator('button[title="Toggle Regular Expression Search"]').first().click();
  const counter = () => pg.evaluate(() => {
    const el = document.querySelector('[aria-label="Find in Markdown"], input[placeholder="Find in Markdown..."]');
    const box = el?.parentElement?.querySelector("span");
    return box?.textContent ?? "";
  });
  await input.fill("a{5,}");
  await until(async () => /1\/1/.test(await counter()), { timeout: 5000 }).catch(() => {});
  const workers = await pg.evaluate(() => window.__workers);
  check("A061 a normal regex is counted, through a Worker", /1\/1/.test(await counter()) && workers > 0, `${await counter()}, workers=${workers}`);

  // (a|a)+$ is exponential and is NOT caught by the static nested-quantifier
  // guard — only a terminable Worker keeps the page alive here.
  const t0 = Date.now();
  await input.fill("(a|a)+$");
  await pg.waitForTimeout(200);
  await pg.evaluate(() => 1);
  const responsive = Date.now() - t0 - 200;
  const gotErr = await until(async () => (await counter()) === "ERR", { timeout: 6000 });
  check("A061 a catastrophic regex times out into an error", gotErr, `counter=${await counter()}`);
  check("A061 the page stayed responsive while it ran", responsive < 1000, `${responsive}ms`);
  await input.fill("a{5,}");
  await until(async () => /1\/1/.test(await counter()), { timeout: 5000 }).catch(() => {});
  check("A061 searching works again after a timeout (a fresh Worker)", /1\/1/.test(await counter()), await counter());
});

const zoomLabel = () => pg.evaluate(() => [...document.querySelectorAll("span")].map((s) => s.textContent.trim()).find((t) => /^\d+%$/.test(t)) ?? "(none)");
for (let n = 1; n <= 2; n++) {
  await section(`A065 open #${n}`, async () => {
    await pg.keyboard.press("Control+Shift+G");
    await until(async () => (await pg.locator(".pf-node-dot").count()) > 0, { timeout: 20000 });
    await pg.waitForTimeout(1500);
    const box = await pg.locator("svg[role='group']").first().boundingBox();
    await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const before = await zoomLabel();
    await pg.mouse.wheel(0, -400);
    await pg.waitForTimeout(600);
    const after = await zoomLabel();
    check(`A065 wheel zooms the map on open #${n}`, after !== before, `${before} → ${after}`);
  });
}

await section("A057", async () => {
  await pg.keyboard.press("Control+Shift+K");
  await until(async () => (await pg.locator('[data-workspace-overlay="cards"]').count()) > 0, { timeout: 15000 });
  await pg.waitForTimeout(1200);
  await pg.locator('button[aria-label="Delete note"]').first().click({ force: true });
  const dialogUp = await until(async () => (await pg.locator('[role="alertdialog"]').count()) > 0, { timeout: 5000 });
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(600);
  const dialogGone = (await pg.locator('[role="alertdialog"]').count()) === 0;
  const boardStill = (await pg.locator('[data-workspace-overlay="cards"]').count()) > 0;
  check("A057 Escape closes the delete confirmation but not the board", dialogUp && dialogGone && boardStill, `dialog=${dialogUp}/${dialogGone} board=${boardStill}`);
});

console.log("console errors:", errors.slice(0, 5));
await browser.close();
srv.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed}/${results.length} FAILED` : `\n${results.length} checks passed`);
process.exit(failed || errors.length ? 1 : 0);
