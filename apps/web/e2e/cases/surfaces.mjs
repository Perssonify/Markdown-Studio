// Tier 1 — blast radius. Every surface the sync work could have touched, driven
// once on a production build. This is the CI smoke suite: it asserts the app
// still behaves, not how fast it is.
import { serve, open, boot, mdText, richText, richHtml, pasteText, runCase, until, APP_DIR, EMBED_DIR, ENGINE } from "../lib.mjs";
import fs from "node:fs";

const BOLD = 'button[aria-label*="Bold" i], button[title*="Bold" i]';

/**
 * Click into the rich pane and put the caret at the end of the document — and
 * wait until ProseMirror's own selection says so before anyone types.
 *
 * WebKit fires `selectionchange` asynchronously, after Playwright's key press
 * has resolved, and a click's own selection update can land AFTER a Ctrl+End
 * sent right behind it. Measured on WebKit/Windows (6 fresh boots): the click
 * lands inside the starter document's bold "growth.perssonify.com"; in 5 of 6
 * ProseMirror still held the click position when typing began, and in 2 the
 * typed " betaRICH" went there, inheriting the bold, so ⌘B REMOVED bold and
 * "toolbar reflects bold at the caret" failed. That is the harness racing the
 * engine with keystrokes no person types that fast, not an editor defect. With
 * this wait: 8 of 8 on the first press. The retry covers a Ctrl+End the click
 * undid.
 */
async function richCaretToEnd(pg) {
  const atEnd = () => pg.evaluate(() => {
    const ed = document.querySelector(".ProseMirror")?.editor;
    if (!ed) return false;
    const { from, empty } = ed.state.selection;
    return empty && from === ed.state.selection.constructor.atEnd(ed.state.doc).from;
  });
  await pg.locator(".ProseMirror").first().click();
  for (let attempt = 0; attempt < 3; attempt++) {
    await pg.keyboard.press("Control+End");
    if (await until(atEnd, { timeout: 2000 })) return true;
  }
  return false;
}

runCase("surfaces", async (rep, onClose) => {
  const srv = await serve(APP_DIR);
  const { browser, page: pg } = await open(srv.port);
  onClose(async () => { await browser.close(); srv.close(); });
  await boot(pg, srv.port, { mode: "Split", settle: 6000 });

  // ── both mirror directions ──────────────────────────────────────────────
  await pg.locator(".cm-content").first().click();
  await pg.keyboard.press("Control+End");
  await pg.keyboard.type("\n\nMIRRORCHECK alpha");
  rep.check("md → rich mirror",
    await until(async () => (await richText(pg)).includes("MIRRORCHECK alpha")));

  rep.check("the rich pane's caret reaches the end of the document", await richCaretToEnd(pg));
  await pg.keyboard.type(" betaRICH");
  rep.check("rich → md mirror",
    await until(async () => (await mdText(pg)).includes("betaRICH")));

  // ── toolbar state tracks the caret (the setActiveFormats path) ───────────
  const boldBtn = pg.locator(BOLD).first();
  const pressed = (el) => el.getAttribute("aria-pressed") === "true";
  await pg.keyboard.down("Shift");
  for (let i = 0; i < 8; i++) await pg.keyboard.press("ArrowLeft");
  await pg.keyboard.up("Shift");
  await pg.waitForTimeout(700);
  await pg.keyboard.press("Control+b");
  rep.check("toolbar reflects bold at the caret",
    await until(async () => (await boldBtn.evaluate(pressed).catch(() => null)) === true));
  await pg.keyboard.press("Home");
  rep.check("toolbar clears bold when the caret leaves it",
    await until(async () => (await boldBtn.evaluate(pressed).catch(() => null)) === false));

  // ── round trip through the rich pane ────────────────────────────────────
  const SAMPLE = [
    "## Round trip", "", "- alpha", "- beta", "", "1. first", "2. second", "",
    "```js", "const a = 1;   ", "", "", "const b = 2;", "```", "",
    "A link to [[Changelog]] and some **bold** text.",
  ].join("\n");
  await pg.locator(".cm-content").first().click();
  await pg.keyboard.press("Control+End");
  await pasteText(pg, ".cm-content", "\n\n" + SAMPLE + "\n");
  await until(async () => (await richText(pg)).includes("const b = 2;"));
  const html = await richHtml(pg), text = await richText(pg);
  rep.check("round trip: bullet list survives", /<ul[^>]*>[\s\S]*alpha/.test(html));
  rep.check("round trip: ordered list survives", /<ol[^>]*>[\s\S]*first/.test(html));
  rep.check("round trip: fenced code survives", text.includes("const a = 1;") && text.includes("const b = 2;"));
  rep.check("round trip: wiki link survives", text.includes("Changelog"));

  await richCaretToEnd(pg);
  await pg.keyboard.type(" .");
  await until(async () => (await mdText(pg)).includes("const b = 2;"));
  const md = await mdText(pg);
  rep.check("round trip: code content and trailing whitespace survive",
    md.includes("const a = 1;   ") && md.includes("const b = 2;"));
  rep.check("round trip: wiki link is not escaped", md.includes("[[Changelog]]"));
  await pg.keyboard.type("y");
  await until(async () => (await mdText(pg)).includes("const b = 2;y") || (await mdText(pg)) !== md);
  await pg.keyboard.press("Backspace");
  rep.check("round trip is a fixed point", await until(async () => (await mdText(pg)) === md));

  // ── peer surfaces ───────────────────────────────────────────────────────
  await pg.keyboard.press("Control+Shift+G");
  rep.check("relationship map opens",
    await until(async () => (await pg.locator(".pf-node-dot").count()) > 0));
  rep.check("map does not draw a folder chip above the nodes", await pg.evaluate(() => {
    // Draw order is the map's last-resort collision resolution and is pinned in
    // graph-metrics.test.js; this is the rendered proof.
    const all = [...document.querySelectorAll(".pf-node-dot, .pf-folder-chip")];
    const lastDot = all.map((e) => e.classList.contains("pf-node-dot")).lastIndexOf(true);
    const firstChip = all.findIndex((e) => e.classList.contains("pf-folder-chip"));
    return firstChip === -1 || firstChip > lastDot;
  }));
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(800);

  await pg.keyboard.press("Control+Shift+K");
  rep.check("cards board opens",
    await until(async () => (await pg.locator("[data-md-preview]").count()) > 0));
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(800);
  rep.check("the editor survived both overlays", (await pg.locator(".ProseMirror").count()) > 0);

  // ── workspace panel ─────────────────────────────────────────────────────
  const filesTab = pg.locator('button:has-text("Files")').first();
  rep.check("workspace panel is present", (await filesTab.count()) > 0);
  await pg.keyboard.press("Control+Shift+D");
  rep.check("⌘⇧D closes the workspace panel",
    await until(async () => !(await filesTab.isVisible().catch(() => false))));
  await pg.keyboard.press("Control+Shift+D");
  rep.check("⌘⇧D reopens it",
    await until(() => filesTab.isVisible().catch(() => false)));

  // ── the memoized sheets still take LIVE readings ────────────────────────
  // React.memo froze these: their props never change, so a heap gauge that
  // reads performance.memory at render showed one number for as long as the
  // panel stayed open — the single question it exists to answer. A tick while
  // open is the fix; this is the behavioural proof.
  await pg.keyboard.press("Escape");
  const opened = await openMenuItem(pg, "Memory");
  const heapApi = await pg.evaluate(() => !!(performance.memory && performance.memory.usedJSHeapSize));
  if (opened && !heapApi) {
    // The gauge reads `performance.memory`, which only Chromium exposes; on
    // the other engines the sheet has no heap reading to keep live.
    rep.skip("memory sheet takes a live reading while open", `performance.memory does not exist in ${ENGINE}`);
    await pg.keyboard.press("Escape"); await pg.waitForTimeout(600);
  } else if (opened) {
    const readings = new Set();
    for (let i = 0; i < 4; i++) {
      readings.add(await pg.evaluate(() => {
        const m = document.body.innerText.match(/(\d[\d.,]*)\s*(MB|KB)/g);
        return m ? m.join("|") : "none";
      }));
      // Allocate so the heap actually moves between samples.
      await pg.evaluate(() => { window.__ballast = (window.__ballast || []).concat(new Array(200000).fill("x")); });
      await pg.waitForTimeout(1400);
    }
    rep.check("memory sheet takes a live reading while open", readings.size > 1,
      `same reading ${readings.size} time(s): ${[...readings][0]}`);
    await pg.keyboard.press("Escape"); await pg.waitForTimeout(600);
    await pg.evaluate(() => { delete window.__ballast; });
  } else {
    rep.note("memory sheet not reachable from the menu on this build — skipped");
  }

  // ── read-only ───────────────────────────────────────────────────────────
  await pg.goto(`http://127.0.0.1:${srv.port}/?readonly=1`, { waitUntil: "networkidle" });
  // The editor has to MOUNT before "no toolbar" means anything — poll for the
  // pane, then assert the absence.
  await until(async () => (await pg.locator(".ProseMirror").count()) > 0);
  rep.check("read-only hides the formatting toolbar", (await pg.locator(BOLD).count()) === 0);
  await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "networkidle" });
  rep.check("the toolbar returns after read-only",
    await until(async () => (await pg.locator(BOLD).count()) > 0));

  // ── breakpoints ─────────────────────────────────────────────────────────
  // Each of these is a real switch in the layout, and none of them is reachable
  // from jsdom: the toolbar's compaction is measured on its OWN width, and the
  // split stacking and menu collapse are matchMedia.
  for (const [w, h, label] of [[1440, 900, "desktop"], [1024, 800, "laptop"], [900, 800, "narrow"], [768, 900, "tablet"], [480, 800, "phone"], [375, 700, "small phone"]]) {
    await pg.setViewportSize({ width: w, height: h });
    // Poll for the relayout, then read once: the overflow assertion is about
    // the SETTLED layout, and polling it would hide a transient overflow.
    await until(async () => (await pg.locator(".ProseMirror, .cm-content").count()) >= 2);
    await pg.waitForTimeout(400);
    const layout = await pg.evaluate(() => ({
      hamburger: !!document.querySelector('button[aria-label*="menu" i]'),
      panes: [...document.querySelectorAll(".ProseMirror, .cm-content")].length,
      bodyOverflowsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      // The separator reports which way it splits, so this reads the real
      // layout decision rather than inferring it from element positions.
      separator: document.querySelector('[role="separator"][aria-label="Resize panes"]')
        ?.getAttribute("aria-orientation") ?? null,
    }));
    rep.check(`${label} (${w}px): both panes still render`, layout.panes >= 2, JSON.stringify(layout));
    rep.check(`${label} (${w}px): the page does not scroll horizontally`, !layout.bodyOverflowsX, JSON.stringify(layout));

    // The README used to admit that these cases asserted only "both panes
    // render" — never the switches themselves, which are the whole point of a
    // breakpoint. Both flip at 768px (`EditorPanes` matchMedia and the menu
    // bar's `useIsMobile`), deliberately the SAME number so a phone does not
    // get a collapsed menu beside side-by-side panes.
    const stacked = w < 768;
    rep.check(`${label} (${w}px): menu ${stacked ? "collapses to ☰" : "stays a row"}`,
      layout.hamburger === stacked, JSON.stringify(layout));
    rep.check(`${label} (${w}px): panes ${stacked ? "stack" : "sit side by side"}`,
      layout.separator === (stacked ? "horizontal" : "vertical"), JSON.stringify(layout));
  }
  // The map's filter chips and its JSON export used to be `hidden sm:*`, so on a
  // phone both simply vanished — and CLAUDE.md says the export deliberately has
  // no other home (it was moved off the status bar) while the chips ARE the
  // filter. The header wraps now instead of hiding them.
  await pg.setViewportSize({ width: 375, height: 700 });
  await pg.waitForTimeout(600);
  await pg.keyboard.press("Control+Shift+G");
  const visible = (sel) => pg.locator(sel).first().isVisible().catch(() => false);
  rep.check("375px: the map's unlinked filter is reachable",
    await until(() => visible('button[aria-label$="unlinked"]')));
  rep.check("375px: the map's JSON export is reachable",
    await until(() => visible('button[aria-label="Export map data as JSON"]')));
  rep.check("375px: the map still does not scroll the page horizontally",
    !(await pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)));
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(600);

  await pg.setViewportSize({ width: 1440, height: 900 });
  await pg.waitForTimeout(600);

  // ── the three switches the loop above cannot see ────────────────────────
  // The loop reads one thing per viewport width. These three each need their
  // own reader, and two of them need more than a window resize: the toolbar's
  // compaction and the cards board's column count key off an ELEMENT's measured
  // box, not the viewport, which is the whole point of them and is exactly what
  // makes a window-resize case unable to tell them apart from a media query.
  // The map's rail is a plain `lg:` switch, but what it switches BETWEEN — a
  // right column and a docked bottom sheet — has to be measured as geometry.
  const panelOpen = () => pg.evaluate(() =>
    !!document.querySelector('button[aria-label="Close workspace panel"]'));
  const setPanel = async (want) => {
    if ((await panelOpen()) === want) return;
    await pg.keyboard.press("Control+Shift+D");
    await until(async () => (await panelOpen()) === want);
    await pg.waitForTimeout(400);
  };

  // 1. Toolbar compaction is decided by the TOOLBAR's own measured width
  //    (`TOOLBAR_COMPACT_BP`, 1080), not the window's — that is the whole
  //    reason it is a ResizeObserver and not a media query, because a library
  //    consumer mounts the editor into a container narrower than their page.
  //
  //    In the STANDALONE shell those two numbers happen to agree: the toolbar
  //    is a full-width band above the row that holds `<main>` and the workspace
  //    panel, so opening the panel does not narrow it. (toolbar/index.tsx claimed the
  //    opposite until this case was written — a comment left behind by the
  //    WorkspacePanel refactor, which moved the toolbar out of the column that
  //    the panel shares.) So resizing the window here cannot tell the two
  //    implementations apart, and a case that only did that would pass against
  //    a media query.
  //
  //    Constraining the editor ROOT in a wide window can: the viewport stays
  //    1440 while the toolbar's box becomes 900. Own-box says compact; viewport
  //    says not. This is exactly the library-mount geometry.
  await pg.setViewportSize({ width: 1440, height: 900 });
  await pg.waitForTimeout(500);
  const toolbarState = () => pg.evaluate(() => {
    const bar = document.querySelector('[data-tour="toolbar"]');
    const chevron = document.querySelector(
      'button[title="Expand Toolbar"], button[title="Collapse Toolbar"], button[title="Unpin to collapse"]');
    return { w: bar ? Math.round(bar.getBoundingClientRect().width) : null, compact: !!chevron };
  });
  const constrain = (px) => pg.evaluate((w) => {
    const root = document.querySelector(".perssonify-editor");
    if (root) root.style.width = w ? `${w}px` : "";
  }, px);

  const unconstrained = await toolbarState();
  rep.check("1440px window, full-width editor: the toolbar is not compact",
    unconstrained.compact === false && unconstrained.w > 1080, JSON.stringify(unconstrained));

  await constrain(900);
  await pg.waitForTimeout(500);
  const constrained = await toolbarState();
  rep.check("1440px window, 900px editor: the toolbar compacts anyway",
    constrained.compact === true, JSON.stringify({ vw: 1440, ...constrained }));
  rep.check("…so compaction follows the toolbar's box, not the viewport",
    constrained.w !== null && constrained.w < 1080 && unconstrained.w > 1080,
    JSON.stringify({ unconstrained, constrained }));

  await constrain(0);
  await pg.waitForTimeout(600);
  rep.check("and it un-compacts when the container grows back",
    await until(async () => ((await toolbarState()).compact === false)));

  // 2. The map's details rail is a right COLUMN on lg+ and a docked bottom
  //    SHEET below it. Both are docked flex siblings of the map pane — nothing
  //    floats over the canvas — so the switch is readable as whether the rail
  //    sits to the right of the canvas or underneath it.
  const railGeom = async () => {
    if (!(await pg.evaluate(() => !!document.querySelector('aside[aria-label="Map details"]')))) {
      const show = pg.locator('button[aria-label="Show details panel"]').first();
      if (await show.count()) { await show.click(); await pg.waitForTimeout(500); }
    }
    return pg.evaluate(() => {
      const rail = document.querySelector('aside[aria-label="Map details"]');
      const svg = document.querySelector('svg[aria-label^="Relationship map"]');
      if (!rail || !svg) return null;
      const a = rail.getBoundingClientRect(), b = svg.getBoundingClientRect();
      return {
        rail: { l: Math.round(a.left), t: Math.round(a.top), w: Math.round(a.width) },
        map: { r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width) },
        toRight: a.left >= b.right - 2,
        below: a.top >= b.bottom - 2,
      };
    });
  };
  for (const [w, h, wide2] of [[1440, 900, true], [900, 800, false]]) {
    await pg.setViewportSize({ width: w, height: h });
    await pg.waitForTimeout(500);
    await pg.keyboard.press("Control+Shift+G");
    await until(async () => (await pg.locator('svg[aria-label^="Relationship map"]').count()) > 0);
    await pg.waitForTimeout(900);
    const g = await railGeom();
    rep.check(`${w}px: the map's rail docks ${wide2 ? "as a right column" : "as a bottom sheet"}`,
      !!g && (wide2 ? g.toRight && !g.below : g.below && !g.toRight), JSON.stringify(g));
    if (g) {
      rep.check(`${w}px: the rail is ${wide2 ? "a fixed 20rem column" : "the full width of the pane"}`,
        wide2 ? Math.abs(g.rail.w - 320) <= 2 : Math.abs(g.rail.w - g.map.w) <= 2, JSON.stringify(g));
    }
    await pg.keyboard.press("Escape");
    await pg.waitForTimeout(500);
  }

  // 3. The Cards board's column count is measured from the BOARD via a
  //    ResizeObserver, not from Tailwind's viewport breakpoints — the defect
  //    that motivated it packed four columns into ~940px because `xl:` read the
  //    window while the panel had taken 340px off the board. Assert the count
  //    against the board's OWN width at each threshold (<560 / <860 / <1160),
  //    including one case where only the panel moves.
  const boardCols = () => pg.evaluate(() => {
    const cards = [...document.querySelectorAll('button[aria-label^="Edit note:"]')];
    if (!cards.length) return null;
    const board = cards[0].closest("[class*='overflow-y-auto']");
    const lefts = new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left)));
    return { cols: lefts.size, boardW: board ? Math.round(board.clientWidth) : null };
  });
  const expectedCols = (w) => (w < 560 ? 1 : w < 860 ? 2 : w < 1160 ? 3 : 4);
  // A board can never show more columns than it has cards, and the seeded
  // library is THREE — enough on its own to make this case unable to fail, since
  // at 1440 both "4 columns" and "3 columns" cap to three. Add some documents.
  for (let i = 0; i < 4; i++) {
    await pg.locator('button:has-text("File")').first().click();
    await pg.locator('[role="menuitem"]:has-text("New document")').first().click();
    await pg.waitForTimeout(500);
  }
  await setPanel(false);

  // The thresholds themselves, by window width.
  for (const [w, h] of [[1440, 900], [1000, 800], [700, 800]]) {
    await pg.setViewportSize({ width: w, height: h });
    await pg.waitForTimeout(400);
    await pg.keyboard.press("Control+Shift+K");
    await until(async () => (await pg.locator('button[aria-label^="Edit note:"]').count()) > 0);
    await pg.waitForTimeout(700);
    const b = await boardCols();
    const cap = await pg.evaluate(() => document.querySelectorAll('button[aria-label^="Edit note:"]').length);
    const want = b ? Math.min(expectedCols(b.boardW), cap) : null;
    rep.check(`cards at ${w}px: the column count matches the board's width`,
      !!b && b.cols === want, JSON.stringify({ ...b, want, cap }));
    await pg.keyboard.press("Escape");
    await pg.waitForTimeout(400);
  }

  // And that the count follows the BOARD rather than the window — the defect
  // that motivated the ResizeObserver, which packed four columns into ~940px
  // because `xl:` read the window while the workspace panel had taken 340px off
  // the board. Narrowing the editor root in a wide window is the discriminating
  // case, for the same reason it is for the toolbar above.
  //
  // Opening the workspace panel is NOT that case, and an earlier version of this
  // used it: the panel's width is re-clamped against the viewport, so after the
  // 900px map cases above it came back at 240 instead of 340, leaving a 1200px
  // board — still in the same 4-column band as the 1440px window. The check
  // passed with `window.innerWidth` substituted for the board's width.
  await pg.setViewportSize({ width: 1440, height: 900 });
  await pg.waitForTimeout(400);
  await pg.keyboard.press("Control+Shift+K");
  await until(async () => (await pg.locator('button[aria-label^="Edit note:"]').count()) > 0);
  await pg.waitForTimeout(600);
  const wideBoard = await boardCols();
  await constrain(800);
  await pg.waitForTimeout(800);
  const narrowBoard = await boardCols();
  await constrain(0);
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(400);
  rep.check("cards: a 1440px window lays out four columns",
    wideBoard?.cols === 4, JSON.stringify(wideBoard));
  rep.check("cards: constraining the board to 800px drops it to two, window unchanged",
    narrowBoard?.cols === 2, JSON.stringify({ vw: 1440, ...narrowBoard }));

  await setPanel(false);
  await pg.setViewportSize({ width: 1440, height: 900 });
  await pg.waitForTimeout(600);

  // ── touch / coarse pointer ──────────────────────────────────────────────
  // ~15 `pointer-coarse:` rules exist so row actions and small controls are
  // reachable on a phone. Resizing does not reach them — only touch emulation.
  {
    const t = await open(srv.port, { touch: true, viewport: { width: 390, height: 780 } });
    onClose(async () => { await t.browser.close(); });
    await boot(t.page, srv.port, { mode: null, settle: 6000 });
    // This used to PRINT a count and assert nothing, which is a statistic, not
    // a test — the number could double and the run would still be green. It is
    // an assertion now, against WCAG 2.5.8's 24px rather than the 32px the note
    // used: 32 is this repo's own house target for icon buttons, and holding
    // every control to it would fail on text chips that are legitimately
    // shorter. What is measured is the HIT AREA, not the box, because most of
    // the `pointer-coarse:` work in this app grows a ::before and deliberately
    // leaves the element's own geometry alone (see the divider, below).
    const sizes = await t.page.evaluate(() => {
      const grow = (v) => Math.abs(parseFloat(v) || 0);
      const under = [];
      let total = 0;
      for (const b of document.querySelectorAll("button")) {
        total++;
        if (b.offsetParent === null) continue;
        const r = b.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const before = getComputedStyle(b, "::before");
        const has = before.content !== "none";
        const w = has ? r.width + grow(before.left) + grow(before.right) : r.width;
        const h = has ? r.height + grow(before.top) + grow(before.bottom) : r.height;
        if (w < 24 || h < 24) {
          under.push({ label: (b.getAttribute("aria-label") || b.getAttribute("title") || b.textContent || "").trim().slice(0, 40),
            w: Math.round(w), h: Math.round(h) });
        }
      }
      return { under, total };
    });
    rep.check(`every visible button clears WCAG 2.5.8's 24px on a phone (${sizes.total} buttons)`,
      sizes.under.length === 0, JSON.stringify(sizes.under));

    // The pane divider was a 4px strip against WCAG 2.5.8's 24px minimum, and
    // its "larger touch target" pullout could never help — `absolute` inside a
    // 4px parent adds no hit area. The fix is a `pointer-coarse:` ::before, so
    // the element's own box stays 4px (the divider maths depend on it) and only
    // the HIT AREA grows. Measure what a finger can actually land on, which
    // means the pseudo-element, not the box.
    const hasDivider = await until(
      async () => (await t.page.locator('[role="separator"][aria-label="Resize panes"]').count()) > 0,
      { timeout: 8000 },
    );
    rep.check("the split divider exists on a phone-sized touch viewport", !!hasDivider);
    const hit = await t.page.evaluate(() => {
      const el = document.querySelector('[role="separator"][aria-label="Resize panes"]');
      if (!el) return null;
      const box = el.getBoundingClientRect();
      const before = getComputedStyle(el, "::before");
      const grow = (v) => Math.abs(parseFloat(v) || 0);
      // Stacked on a phone, so the vertical extent is what a finger needs.
      return {
        boxH: box.height,
        hitH: box.height + grow(before.top) + grow(before.bottom),
        touchAction: getComputedStyle(el).touchAction,
      };
    });
    rep.check("the pane divider is reachable by finger (>=24px hit area)",
      !!hit && hit.hitH >= 24, JSON.stringify(hit));
    rep.check("the pane divider itself stays thin — only the hit area grew",
      !!hit && hit.boxH <= 8, JSON.stringify(hit));
    rep.check("the pane divider owns the gesture (touch-action:none)",
      !!hit && hit.touchAction === "none", JSON.stringify(hit));
  }

  // ── keyboard, focus, forced colours, print, 400% zoom (A090-A100) ───────
  // Each of these is invisible to jsdom: `:focus-visible`, a media query, a
  // computed system colour, real layout at a 192px-tall viewport.
  {
    const k = await open(srv.port, { viewport: { width: 1280, height: 800 } });
    onClose(async () => { await k.browser.close(); });
    const kp = k.page;
    await boot(kp, srv.port, { mode: "Split", settle: 6000 });

    // A094: the skip link is the first stop and lands IN the editor. From a
    // FRESH load: boot() clicked the mode switcher, and blur() does not reset
    // the browser's sequential-navigation start point.
    await kp.reload({ waitUntil: "networkidle" });
    await until(async () => (await kp.locator(".ProseMirror").count()) > 0, { timeout: 20000 });
    await kp.waitForTimeout(1500);
    if (ENGINE === "webkit") {
      // WebKit leaves links out of the Tab order unless Safari's "Press Tab to
      // highlight each item" is on (Option+Tab reaches them; Playwright's
      // WebKit reaches them with neither), so there the first TAB stop is the
      // first button by definition. What the skip link is for is checked
      // instead: it is first in the focus order, and it lands in the editor.
      const first = await kp.evaluate(() => [...document.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")]
        .find((el) => el.tabIndex >= 0 && !el.disabled && !el.closest("[inert]"))?.textContent?.trim() ?? "");
      rep.check("A094: 'Skip to editor' is first in the focus order (WebKit: links are not Tab stops by default)",
        first === "Skip to editor", first);
      await kp.keyboard.press("Shift");
      await kp.evaluate(() => [...document.querySelectorAll("a")].find((a) => a.textContent.trim() === "Skip to editor")?.focus());
    } else {
      await kp.keyboard.press("Tab");
      const firstStop = await kp.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
      rep.check("A094: the first Tab stop is 'Skip to editor'", firstStop === "Skip to editor", firstStop);
    }
    await kp.keyboard.press("Enter");
    const landed = await kp.evaluate(() => document.activeElement?.className ?? "");
    rep.check("A094: …and Enter lands in the editor", /cm-content|ProseMirror/.test(String(landed)), String(landed));

    // A094 + A090: the toolbar is ONE stop, arrows move along it, and the
    // keyboard-focused control shows a 2px ring in the focus token. (A key
    // press first, so Chrome treats the programmatic focus as keyboard focus.)
    await kp.keyboard.press("Shift");
    await kp.evaluate(() => {
      const bar = document.querySelector('[role="toolbar"]');
      [...bar.querySelectorAll("button")].find((b) => b.tabIndex >= 0 && !b.disabled)?.focus();
    });
    // The generated Button has `transition-all`, so the outline's width and
    // colour ANIMATE in from their initial values (medium / currentColor):
    // read after the transition, or the first frame is what gets measured.
    await kp.waitForTimeout(500);
    const ring = await kp.evaluate(() => {
      const bar = document.querySelector('[role="toolbar"]');
      const stops = [...bar.querySelectorAll("button")].filter((b) => b.tabIndex >= 0 && !b.disabled);
      const b = document.activeElement;
      const cs = getComputedStyle(b);
      const probe = document.createElement("div");
      probe.style.color = "var(--focus-ring)";
      document.body.append(probe);
      const want = getComputedStyle(probe).color;
      probe.remove();
      return { stops: stops.length, visible: b.matches(":focus-visible"), style: cs.outlineStyle,
        width: cs.outlineWidth, color: cs.outlineColor, want };
    });
    rep.check("A094: the formatting toolbar is ONE tab stop", ring.stops === 1, JSON.stringify(ring));
    rep.check("A090: keyboard focus shows a 2px solid ring in --focus-ring (beats `outline-none`)",
      ring.visible && ring.style === "solid" && ring.width === "2px" && ring.color === ring.want, JSON.stringify(ring));
    const before = await kp.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    await kp.keyboard.press("ArrowRight");
    const after = await kp.evaluate(() => ({ label: document.activeElement?.getAttribute("aria-label"),
      inBar: !!document.activeElement?.closest('[role="toolbar"]'), tab: document.activeElement?.tabIndex }));
    rep.check("A094: ArrowRight moves along the toolbar and takes the tab stop with it",
      after.inBar && after.label !== before && after.tab === 0, JSON.stringify({ before, after }));

    // A094: DOM order now matches visual order.
    const order = await kp.evaluate(() => {
      const a = document.querySelector('aside[aria-label="Workspace"]');
      const m = document.querySelector("main");
      if (!a || !m) return null;
      return { first: !!(a.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING),
        left: a.getBoundingClientRect().right <= m.getBoundingClientRect().left + 1 };
    });
    rep.check("A094: the library precedes <main> in the DOM and still sits to its left",
      !!order && order.first && order.left, JSON.stringify(order));

    // A094: the folder tree's arrow keys.
    const tree = await kp.evaluate(() => {
      const items = [...document.querySelectorAll('[role="tree"] [role="treeitem"]')];
      return { count: items.length, stops: items.filter((i) => i.tabIndex === 0).length };
    });
    rep.check("A094: the folder tree is one tab stop", tree.count > 1 && tree.stops === 1, JSON.stringify(tree));
    await kp.keyboard.press("Shift");
    await kp.evaluate(() => document.querySelector('[role="tree"] [role="treeitem"][tabindex="0"]')?.focus());
    const k0 = await kp.evaluate(() => document.activeElement?.getAttribute("data-key"));
    await kp.keyboard.press("Home");
    await kp.keyboard.press("ArrowDown");
    const k1 = await kp.evaluate(() => document.activeElement?.getAttribute("data-key"));
    const firstKey = await kp.evaluate(() => document.querySelector('[role="tree"] [role="treeitem"]')?.getAttribute("data-key"));
    rep.check("A094: Home then ArrowDown walks the tree", !!k1 && k1 !== firstKey, JSON.stringify({ k0, firstKey, k1 }));

    // A095: forced colours keep the pressed state and the focus ring. (After
    // the buttons' transition-all settles, as above.)
    await kp.mouse.move(1, 1);
    await kp.emulateMedia({ forcedColors: "active" });
    await kp.waitForTimeout(500);
    const fc = await kp.evaluate(() => {
      const pressed = document.querySelector('[data-slot="mode-switcher-button"][aria-pressed="true"]');
      const probe = document.createElement("div");
      probe.style.backgroundColor = "Highlight";
      document.body.append(probe);
      const hl = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const focused = getComputedStyle(document.activeElement);
      return { forced: matchMedia("(forced-colors: active)").matches,
        bg: pressed ? getComputedStyle(pressed).backgroundColor : null, hl,
        ring: focused.outlineStyle, ringColor: focused.outlineColor };
    });
    rep.check("A095: forced colours paint the pressed view button in Highlight",
      fc.forced && fc.bg === fc.hl, JSON.stringify(fc));
    // What this guards is that the indicator is an OUTLINE, which forced
    // colours keeps, not the box-shadow ring it deletes. Measured by mutation:
    // Chromium paints a forced-colours outline in Highlight on its own, so the
    // stylesheet's `outline-color: Highlight` restatement is not what makes
    // this pass (it is there for engines that do not).
    // On every engine: Chromium forces Highlight on outlines by itself, but
    // Firefox and WebKit rely on the stylesheet's restatement, which was dead
    // (a lower-specificity selector than the ring rules) until it restated
    // their own selectors. e2e/probes/forced-colors-ring.mjs measures it.
    rep.check("A095: …and the focus ring survives, in the system Highlight colour",
      fc.ring === "solid" && fc.ringColor === fc.hl, JSON.stringify(fc));
    await kp.emulateMedia({ forcedColors: "none" });

    // A100: print prints the document, not the app.
    await kp.emulateMedia({ media: "print" });
    const pr = await kp.evaluate(() => {
      const shown = (sel) => { const el = document.querySelector(sel); return !!el && getComputedStyle(el).display !== "none"; };
      const pm = document.querySelector('[data-print-pane="rich"] .ProseMirror');
      return { menubar: shown('[data-tour="menubar"]'), toolbar: shown('[data-tour="toolbar"]'),
        footer: shown(".perssonify-editor footer"), library: shown('aside[aria-label="Workspace"]'),
        md: shown('[data-print-pane="md"]'), rich: shown('[data-print-pane="rich"]'),
        pmH: pm ? Math.round(pm.getBoundingClientRect().height) : 0,
        shell: getComputedStyle(document.querySelector(".pf-shell")).overflow };
    });
    rep.check("A100: print hides the chrome", !pr.menubar && !pr.toolbar && !pr.footer && !pr.library && !pr.md, JSON.stringify(pr));
    rep.check("A100: print shows the rendered document, unclipped", pr.rich && pr.pmH > 0 && pr.shell === "visible", JSON.stringify(pr));
    await kp.emulateMedia({ media: "screen" });

    // A091: 1366×768 at 400% zoom is a 342×192 CSS viewport.
    await kp.setViewportSize({ width: 342, height: 192 });
    await kp.waitForTimeout(800);
    const z = await kp.evaluate(() => {
      const row = document.querySelector(".pf-editor-row")?.getBoundingClientRect();
      const footer = document.querySelector(".perssonify-editor footer");
      // "instant": html.pf-app has scroll-behavior:smooth, so a default
      // scrollIntoView would still be gliding when this reads the rect.
      footer?.scrollIntoView({ behavior: "instant", block: "end" });
      const f = footer?.getBoundingClientRect();
      return { rowH: row ? Math.round(row.height) : 0, vh: innerHeight,
        docH: document.documentElement.scrollHeight,
        footerOnScreen: !!f && f.top >= 0 && f.bottom <= innerHeight + 1 && f.height > 0 };
    });
    rep.check("A091: at 400% zoom the editor row gets a full viewport (it had zero)", z.rowH >= z.vh - 1, JSON.stringify(z));
    rep.check("A091: …and the page scrolls to a reachable status bar", z.docH > z.vh && z.footerOnScreen, JSON.stringify(z));

    // A100: a landscape phone keeps the panes side by side.
    await kp.evaluate(() => window.scrollTo(0, 0));
    await kp.setViewportSize({ width: 667, height: 375 });
    await kp.waitForTimeout(800);
    const lp = await kp.evaluate(() => ({
      orientation: document.querySelector('[role="separator"][aria-label="Resize panes"]')?.getAttribute("aria-orientation") ?? null,
      cm: Math.round(document.querySelector(".cm-editor")?.getBoundingClientRect().height ?? 0),
      pm: Math.round(document.querySelector(".tiptap-preview")?.getBoundingClientRect().height ?? 0),
    }));
    rep.check("A100: a landscape phone (667×375) keeps split panes side by side", lp.orientation === "vertical", JSON.stringify(lp));
    rep.check("A100: …so each editor keeps a usable height (was 37-69px stacked)", lp.cm > 150 && lp.pm > 150, JSON.stringify(lp));
    await kp.setViewportSize({ width: 1280, height: 800 });
  }

  // ── reduced motion ──────────────────────────────────────────────────────
  // The graph's force simulation animates node positions from rAF, which no
  // stylesheet can reach — so this is the one piece of motion in the app that
  // the global CSS guard does NOT cover, and the only way to see it is to
  // emulate the preference in a real browser.
  {
    const r = await open(srv.port, { viewport: { width: 1280, height: 800 } });
    onClose(async () => { await r.browser.close(); });
    // Playwright emulates the preference on every engine (it was a raw CDP
    // call, which made this block Chromium-only).
    await r.page.emulateMedia({ reducedMotion: "reduce" });
    await boot(r.page, srv.port, { settle: 6000 });
    rep.check("reduced motion is actually emulated",
      await r.page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches));

    await r.page.keyboard.press("Control+Shift+G");
    await until(async () => (await r.page.locator(".pf-node-dot").count()) > 0, { timeout: 15000 });
    // Sample twice across a window in which an un-gated simulation is still
    // visibly moving: at 3 seeded documents it runs well past this.
    // Read the PARENT group's transform, not the circle's cx/cy: every dot is
    // drawn at cx=0,cy=0 and positioned by `translate()` on its <g>, so a
    // cx/cy sample would compare "0,0" with "0,0" for every node and pass
    // whatever the simulation did — a case that cannot fail.
    const read = () => r.page.evaluate(() =>
      [...document.querySelectorAll(".pf-node-dot")]
        .map((n) => n.closest("g")?.getAttribute("transform") ?? "?")
        .join("|"));
    const first = await read();
    await r.page.waitForTimeout(400);
    const second = await read();
    rep.check("the map opens already settled instead of animating into place",
      first.length > 0 && first === second, `${first.slice(0, 80)} vs ${second.slice(0, 80)}`);
    rep.check("no console errors in the reduced-motion session", r.errors.length === 0, r.errors.join("\n"));
  }

  // ── the iframe embed ────────────────────────────────────────────────────
  if (fs.existsSync(`${EMBED_DIR}/index.html`)) {
    const esrv = await serve(EMBED_DIR);
    const e = await open(esrv.port);
    onClose(async () => { await e.browser.close(); esrv.close(); });
    await e.page.goto(`http://127.0.0.1:${esrv.port}/`, { waitUntil: "networkidle" });
    await until(async () => (await e.page.locator('button:has-text("Files")').count()) > 0,
      { timeout: 30000 });
    // The embed seeds NO starter documents — that is standalone-app behaviour —
    // so it opens on the empty state and a host supplies content. Check the
    // chrome mounts and that creating a document brings up a live editor.
    rep.check("embed mounts its chrome", (await e.page.locator('button:has-text("Files")').count()) > 0);
    const create = e.page.locator('button:has-text("Create New Document")').first();
    if (await create.count()) {
      await create.click();
      await until(async () => (await e.page.locator(".ProseMirror").count()) > 0);
    }
    rep.check("embed opens a live editor", (await e.page.locator(".ProseMirror").count()) > 0);
    await e.page.locator(".ProseMirror").first().click().catch(() => {});
    await e.page.keyboard.type("EMBEDTYPING");
    rep.check("embed mirrors typing into the markdown pane",
      await until(async () =>
        (await e.page.evaluate(() =>
          [...document.querySelectorAll(".cm-line")].map((l) => l.textContent).join("\n"))).includes("EMBEDTYPING")));
  } else {
    rep.note("dist-embed/ not built — embed checks skipped (run `bun run build:embed`)");
  }
});

/** Open a menu-bar item by visible text; returns whether it was found. */
async function openMenuItem(pg, label) {
  for (const menu of ["Tools", "View", "File"]) {
    const trigger = pg.locator(`button:has-text("${menu}")`).first();
    if (!(await trigger.count())) continue;
    await trigger.click().catch(() => {});
    await pg.waitForTimeout(500);
    const item = pg.locator(`[role="menuitem"]:has-text("${label}")`).first();
    if ((await item.count()) && (await item.isVisible().catch(() => false))) {
      await item.click().catch(() => {});
      await pg.waitForTimeout(1200);
      return true;
    }
    await pg.keyboard.press("Escape").catch(() => {});
    await pg.waitForTimeout(250);
  }
  return false;
}
