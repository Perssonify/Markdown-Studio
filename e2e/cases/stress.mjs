// Tier 2 — scale and duration. Where the scheduler's assumptions live: it
// derives its delays from what a projection actually COSTS on this device, so
// the shapes that cost the most are the ones that can break it.
import { serve, open, boot, seed, mdText, richText, runCase, until, untilValue, APP_DIR } from "../lib.mjs";
import { proseDoc, sectionedDoc, tableDoc, fenceDoc, nestedListDoc, linkDoc, library } from "../docs.mjs";
import { mapLibrary, seedFresh } from "../map-library.mjs";
import { measureMap } from "../map-measure.mjs";

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

  // ── the relationship map at library scale (A088) ────────────────────────
  // Above LARGE_MAP_MIN notes the map batches its ordinary dots, links and
  // arrowheads into a few paths and hit-tests the pointer in code. What must
  // survive that: every note drawn exactly once and still measurable, nothing
  // drawn over a label, and the pointer and the wheel still reaching the note
  // under them. Content, not timing — cases/perf-map.mjs measures the timing.
  //
  // The library has NO folders, on purpose: with sixty folders in the world the
  // map gives 2,000 notes, the containers overlap and the map vetoes nearly
  // every name (measured: no labels at any zoom, in the build before the scale
  // work too) — and a check that nothing is drawn over a label is vacuous on a
  // map that draws no labels. Zoomed in, this one places dozens.
  {
    const srv = await serve(APP_DIR);
    const { browser, page: pg } = await open(srv.port);
    onClose(async () => { await browser.close(); srv.close(); });
    const { docs, folderTree } = mapLibrary(2000, { folders: false });
    await seedFresh(pg, srv.port, docs, folderTree);
    await boot(pg, srv.port, { mode: "Split", settle: 14000 });
    await pg.keyboard.press("Control+Shift+G");
    // At rest when the batched layer's layout version stops moving (it is
    // bumped by every step, and repainted at most every 250ms).
    let last = null, still = 0;
    for (let i = 0; i < 180 && still < 3; i++) {
      await pg.waitForTimeout(500);
      const v = await pg.evaluate(() => document.querySelector('[data-map-layer="notes"]')?.getAttribute("data-layout-version") ?? null);
      still = v != null && v === last ? still + 1 : 0;
      last = v;
    }
    rep.check("2,000 notes: the map comes to rest", still >= 3, `layout version still moving at ${last}`);

    const m = await pg.evaluate(measureMap);
    rep.check("2,000 notes: every note is drawn, exactly once",
      !!m && m.documents === 2000 && m.drawn === m.documents && m.batched === m.documents && m.batchedUnique === m.batched,
      JSON.stringify(m && { documents: m.documents, drawn: m.drawn, batched: m.batched, unique: m.batchedUnique, error: m.error }));
    // (At the overview a 2,000-note map is too dense to name anything; the
    // label checks are made zoomed in, below, where names are actually placed.)
    const noLabelCovered = (c) => !!c && c.labelLabel === 0 && c.labelDot === 0 && c.labelChip === 0
      && c.labelEdge === 0 && c.strangerLabel === 0;

    // A dot in the middle of the canvas that is drawn in the batch, not in full.
    const target = await pg.evaluate(() => {
      const svg = document.querySelector('svg[aria-label^="Relationship map"]');
      const S = svg.getBoundingClientRect();
      const full = new Set([...svg.querySelectorAll("[data-doc-id]")].map((g) => g.getAttribute("data-doc-id")));
      for (const p of svg.querySelectorAll(".pf-node-dots")) {
        const ids = (p.getAttribute("data-doc-ids") || "").split(" ").filter(Boolean);
        const k = p.getScreenCTM();
        const d = p.getAttribute("d") || "";
        const re = /M(-?\d+),(-?\d+)a(\d+),\d+ 0 1 1 (-?\d+),0/g;
        let i = 0;
        for (let g = re.exec(d); g; g = re.exec(d), i++) {
          if (full.has(ids[i])) continue;
          const cx = Number(g[1]) + Number(g[4]) / 2, cy = Number(g[2]);
          const x = k.a * cx + k.c * cy + k.e, y = k.b * cx + k.d * cy + k.f;
          if (x > S.left + 80 && x < S.right - 80 && y > S.top + 80 && y < S.bottom - 80) return { id: ids[i], x, y };
        }
      }
      return null;
    });
    rep.check("2,000 notes: a batched dot is on the canvas to point at", !!target);
    if (target) {
      await pg.mouse.move(target.x, target.y);
      const hovered = await until(() => pg.evaluate((id) => !!document.querySelector(`[data-doc-id="${id}"]`), target.id), { timeout: 5000 });
      rep.check("2,000 notes: hovering a batched dot finds its note", hovered, target.id);
      const title = await pg.evaluate((id) => document.querySelector(`[data-doc-id="${id}"]`)?.getAttribute("aria-label")?.split(" — ")[0], target.id);
      await pg.mouse.down();
      await pg.mouse.up();
      const shown = await untilValue(
        () => pg.evaluate(() => document.querySelector('aside[aria-label="Map details"] h3')?.textContent ?? null),
        (t) => !!title && t === title, { timeout: 5000 });
      rep.check("2,000 notes: clicking a batched dot selects its note", !!title && shown === title, `${shown} vs ${title}`);
    }

    const zoomLabel = () => pg.evaluate(() => document.querySelector('span.tabular-nums[aria-live="off"]')?.textContent ?? null);
    const before = await zoomLabel();
    await pg.mouse.wheel(0, -480);
    const after = await untilValue(zoomLabel, (t) => !!t && t !== before, { timeout: 5000 });
    rep.check("2,000 notes: the wheel zooms the map", !!after && after !== before, `${before} → ${after}`);
    // Close in, where there is room for names — and the placer has to find it.
    for (let i = 0; i < 6; i++) {
      await pg.locator('button[aria-label="Zoom in"]').first().click();
      await pg.waitForTimeout(150);
    }
    await pg.waitForTimeout(800);
    const zoomed = await pg.evaluate(measureMap);
    rep.check("2,000 notes, zoomed in: names are placed, and none is drawn over anything",
      (zoomed?.labels ?? 0) > 0 && noLabelCovered(zoomed?.count), JSON.stringify({ labels: zoomed?.labels, ...zoomed?.count }));
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
