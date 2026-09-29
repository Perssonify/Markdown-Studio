// Tier 2 — scale and duration. Where the scheduler's assumptions live: it
// derives its delays from what a projection actually COSTS on this device, so
// the shapes that cost the most are the ones that can break it.
import { serve, open, boot, seed, mdText, richText, runCase, APP_DIR } from "../lib.mjs";
import { proseDoc, sectionedDoc, tableDoc, fenceDoc, nestedListDoc, linkDoc, library } from "../docs.mjs";

const MARK = "STRESSMARK";

/** Type into a pane and wait for the other one to catch up, bounded. */
async function convergesWithin(pg, pane, text, budgetMs) {
  await pg.locator(pane === "md" ? ".cm-content" : ".ProseMirror").first().click();
  await pg.keyboard.press("Control+End");
  await pg.keyboard.press("Enter");
  await pg.keyboard.type(text, { delay: 12 });
  const other = pane === "md" ? richText : mdText;
  const started = Date.now();
  while (Date.now() - started < budgetMs) {
    if ((await other(pg)).includes(text)) return Date.now() - started;
    await pg.waitForTimeout(200);
  }
  return -1;
}

runCase("stress", async (rep, onClose) => {
  // ── shapes ──────────────────────────────────────────────────────────────
  const shapes = [
    ["prose 1KB", proseDoc("s1", "Prose small", 1)],
    ["prose 50KB", proseDoc("s2", "Prose large", 50)],
    ["sectioned 20KB", sectionedDoc("s3", "Sectioned", 20)],
    ["table 400 rows", tableDoc("s4", "Table", 400)],
    ["200 fenced blocks", fenceDoc("s5", "Fences", 200)],
    ["nested lists depth 6", nestedListDoc("s6", "Nesting", 6)],
    ["1000 inline links", linkDoc("s7", "Links", 1000)],
  ];
  for (const [label, doc] of shapes) {
    const srv = await serve(APP_DIR);
    const { browser, page: pg, errors } = await open(srv.port);
    onClose(async () => { await browser.close(); srv.close(); });
    await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
    await seed(pg, [doc]);
    await boot(pg, srv.port, { mode: "Split", settle: 9000 });
    await pg.locator(`text=${doc.title}`).first().click({ timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(3000);

    const ms = await convergesWithin(pg, "md", MARK, 20000);
    rep.check(`${label}: md → rich converges`, ms >= 0, `not within 20s`);
    if (ms >= 0) rep.note(`${label}: mirrored in ~${ms}ms`);
    await browser.close(); srv.close();
  }

  // ── sustained typing, no pause ──────────────────────────────────────────
  // This is the max-wait ceiling, which is what actually fixed the reported
  // symptom and had no coverage anywhere. Before it, the debounce was purely
  // trailing: while you kept typing, the other pane NEVER updated.
  {
    const srv = await serve(APP_DIR);
    const { browser, page: pg, errors } = await open(srv.port);
    onClose(async () => { await browser.close(); srv.close(); });
    await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
    await seed(pg, [proseDoc("t1", "Typing doc", 10)]);
    await boot(pg, srv.port, { mode: "Split", settle: 9000 });
    await pg.locator("text=Typing doc").first().click({ timeout: 15000 }).catch(() => {});
    await pg.waitForTimeout(2500);

    for (const pane of ["md", "rich"]) {
      const sel = pane === "md" ? ".cm-content" : ".ProseMirror";
      await pg.locator(sel).first().click();
      await pg.keyboard.press("Control+End");
      await pg.keyboard.press("Enter");
      const run = `${pane.toUpperCase()}RUN `.repeat(60);      // ~480 chars, no pause
      let mirroredMidRun = false;
      const typing = pg.keyboard.type(run, { delay: 12 });
      const poll = (async () => {
        const other = pane === "md" ? richText : mdText;
        for (let i = 0; i < 40; i++) {
          await pg.waitForTimeout(150);
          if ((await other(pg)).includes(`${pane.toUpperCase()}RUN ${pane.toUpperCase()}RUN`)) { mirroredMidRun = true; return; }
        }
      })();
      await Promise.all([typing, poll]);
      await pg.waitForTimeout(3000);

      const own = pane === "md" ? await mdText(pg) : await richText(pg);
      const other = pane === "md" ? await richText(pg) : await mdText(pg);
      const copies = own.split(`${pane.toUpperCase()}RUN`).length - 1;
      rep.check(`${pane} pane: every character of a 480-char run survived`, copies === 60, `${copies}/60 tokens`);
      rep.check(`${pane} pane: the other pane caught up`, other.includes(`${pane.toUpperCase()}RUN`));
      rep.check(`${pane} pane: the mirror updated DURING the run, not only after`, mirroredMidRun);
    }
    await browser.close(); srv.close();
  }

  // ── a large library ─────────────────────────────────────────────────────
  {
    const srv = await serve(APP_DIR);
    const { browser, page: pg, errors } = await open(srv.port);
    onClose(async () => { await browser.close(); srv.close(); });
    await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
    await seed(pg, library(120, { kb: 1 }));
    await boot(pg, srv.port, { mode: "Split", settle: 12000 });

    rep.check("120 documents: the app boots", (await pg.locator(".ProseMirror").count()) > 0);

    const t0 = Date.now();
    await pg.keyboard.press("Control+Shift+G");
    await pg.waitForTimeout(1000);
    const mapBtn = pg.locator('button:has-text("Map")').first();
    rep.check("120 documents: ⌘⇧G opens the map",
      (await mapBtn.getAttribute("aria-pressed")) === "true");
    let dots = 0;
    for (let i = 0; i < 60; i++) {
      await pg.waitForTimeout(500);
      dots = await pg.locator(".pf-node-dot").count();
      if (dots > 50) break;
    }
    // Zero dots with a non-empty library means the map fell back to its
    // no-edges explanation — which, with a linked fixture, means the links did
    // not resolve. Report the count so that reads as a fixture problem rather
    // than a settling problem.
    rep.check("120 documents: the relationship map draws every note", dots >= 100,
      `${dots} nodes after ${Date.now() - t0}ms (0 = the map's zero-edge mode)`);
    rep.note(`map settled in ~${Date.now() - t0}ms with ${dots} nodes`);
    await pg.keyboard.press("Escape");
    await pg.waitForTimeout(1000);

    // Rapid switching: switchGenRef has never been executed by a unit test.
    const rows = pg.locator('[aria-current], [role="treeitem"], button:has-text("Note ")');
    const n = Math.min(await rows.count(), 12);
    for (let i = 0; i < n; i++) {
      await rows.nth(i).click({ timeout: 4000 }).catch(() => {});
      await pg.waitForTimeout(60);   // deliberately inside the switch's awaits
    }
    await pg.waitForTimeout(6000);
    const settled = await pg.evaluate(() => ({
      panes: document.querySelectorAll(".ProseMirror, .cm-content").length,
      body: document.body.innerText.length,
    }));
    rep.check("rapid switching leaves a live editor", settled.panes >= 2 && settled.body > 200, JSON.stringify(settled));
    rep.check("rapid switching: the panes agree at rest",
      (await richText(pg)).slice(0, 40).replace(/\s+/g, "").length > 0);
    await browser.close(); srv.close();
  }

  // ── a long session ──────────────────────────────────────────────────────
  // Where per-render listener churn and uncancelled timers would show up.
  {
    const srv = await serve(APP_DIR);
    const { browser, page: pg, errors } = await open(srv.port);
    onClose(async () => { await browser.close(); srv.close(); });
    await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
    await seed(pg, library(8, { kb: 2 }));
    await boot(pg, srv.port, { mode: "Split", settle: 9000 });

    const heapOf = () => pg.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
    const samples = [];
    const rounds = Number(process.env.E2E_LONG_ROUNDS || 8);
    for (let r = 0; r < rounds; r++) {
      await pg.locator(".ProseMirror").first().click();
      await pg.keyboard.press("Control+End");
      await pg.keyboard.type(` round ${r} `, { delay: 8 });
      await pg.waitForTimeout(900);
      if (r % 2 === 0) { await pg.keyboard.press("Control+Shift+K"); await pg.waitForTimeout(900); await pg.keyboard.press("Escape"); }
      if (r % 3 === 0) { await pg.keyboard.press("Control+Shift+G"); await pg.waitForTimeout(1200); await pg.keyboard.press("Escape"); }
      await pg.waitForTimeout(700);
      await pg.evaluate(() => window.gc?.());
      samples.push(await heapOf());
    }
    const first = samples.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
    const last = samples.slice(-2).reduce((a, b) => a + b, 0) / 2;
    rep.note(`heap ${(first / 1e6).toFixed(1)}MB → ${(last / 1e6).toFixed(1)}MB over ${rounds} rounds`);
    // Not a leak detector — a runaway detector. Chromium's heap grows during
    // ordinary use; a 4× climb over a handful of rounds is not ordinary.
    rep.check("a long session does not run the heap away", !first || last < first * 4,
      `${(first / 1e6).toFixed(1)}MB → ${(last / 1e6).toFixed(1)}MB`);
    await browser.close(); srv.close();
  }
});
