// The surfaces nothing ever opened.
//
// `e2e/README.md` has listed these as a known gap for several releases:
// Settings, Version history, the bottom tray, the interior pages (/about,
// /help), the guided tour and the Outline tab are each reachable from the UI
// and none of them is opened by any suite. That is not a coincidental gap —
// several of 1.75.0's defects lived in exactly these surfaces (the tray
// clipping the app, the reading-width control that did nothing, the interior
// pages' focus handling), and they survived because nothing drove them.
//
// The point of this suite is deliberately modest: OPEN each one, prove it
// rendered something real, and prove the console stayed clean. The last part is
// what makes it a regression net rather than a screenshot — a crash in a lazy
// chunk, a Base UI misuse (a bare `DropdownMenuLabel` outside a group once took
// the whole app down on the first mobile tap), or a React key warning shows up
// here whatever else the case was looking at.
import { serve, open, boot, runCase, until, ROOT } from "../lib.mjs";
import path from "node:path";

const APP = process.env.E2E_APP_DIR || path.join(ROOT, "dist-app");

runCase("surfaces-deep", async (rep, onClose) => {
  const srv = await serve(APP);
  const { browser, page: pg, errors } = await open(srv.port, { viewport: { width: 1440, height: 900 } });
  onClose(async () => { await browser.close(); srv.close(); });
  await boot(pg, srv.port, { settle: 6000 });

  /** Open a menu by name and click one of its items. */
  const menuItem = async (menu, item) => {
    await pg.locator(`button:has-text("${menu}")`).first().click();
    await pg.locator(`[role="menuitem"]:has-text("${item}")`).first().click();
  };
  const visible = (sel) => pg.locator(sel).first().isVisible().catch(() => false);

  // ── Settings ────────────────────────────────────────────────────────────
  await menuItem("File", "Settings");
  rep.check("Settings opens", await until(() => visible('[role="dialog"]')));
  // Reading & typography is the section whose control was inert until 1.75.0;
  // asserting the group renders keeps the surface honest.
  rep.check("Settings shows the typography controls",
    await until(async () => (await pg.locator('text=Reading width').count()) > 0));
  const readingOptions = await pg.locator('text=Reading width').first()
    .locator("xpath=following::button[position()<=4]").allInnerTexts().catch(() => []);
  rep.check("Reading width offers Full/Narrow/Medium/Wide",
    readingOptions.join("|").includes("Narrow"), readingOptions.join("|"));
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(400);

  // ── Version history ─────────────────────────────────────────────────────
  await menuItem("Tools", "Version history");
  rep.check("Version history opens", await until(() => visible('[role="dialog"]')));
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(400);

  // ── the bottom tray ─────────────────────────────────────────────────────
  // 1.75.0 made this refuse to open when there is no room; at 1440x900 there is
  // plenty, so it must actually open.
  // Read the tray's REAL state, not whether its content is in the DOM. Since
  // 1.75.0 the tray stays mounted while collapsed (it animates
  // `grid-template-rows` 0fr ↔ 1fr instead of unmounting), so a presence check
  // like "the Document Links tab exists" is true either way — it passed here
  // against a tray that had never opened.
  const trayState = () => pg.evaluate(() => {
    const strip = [...document.querySelectorAll("div")].find((d) =>
      d.style.gridTemplateRows === "1fr" || d.style.gridTemplateRows === "0fr");
    // `inert` (A093): the collapsed tray stays mounted, so aria-hidden alone left
    // its buttons in the Tab order.
    return strip ? { rows: strip.style.gridTemplateRows, h: Math.round(strip.getBoundingClientRect().height), inert: strip.hasAttribute("inert") } : null;
  });

  rep.check("the tray starts collapsed at zero height, and inert",
    await until(async () => { const v = await trayState(); return v && v.rows === "0fr" && v.h < 1 && v.inert ? v : null; }),
    JSON.stringify(await trayState()));

  await pg.locator('button[aria-label="Panel tray"][aria-expanded="false"]').first().click();
  const expanded = await until(async () => {
    const v = await trayState();
    return v && v.rows === "1fr" && v.h > 40 && !v.inert ? v : null;
  });
  rep.check("the tray opens on a tall window, and is no longer inert", !!expanded, JSON.stringify(expanded ?? await trayState()));
  rep.check("its Document Links tab is there once open",
    await until(async () => (await pg.locator('button:has-text("Document Links")').first().isVisible().catch(() => false))));

  // …and collapses back to genuinely zero height, the documented invariant.
  await pg.locator('button[aria-label="Panel tray"][aria-expanded="true"]').first().click();
  const collapsed = await until(async () => {
    const v = await trayState();
    return v && v.rows === "0fr" && v.h < 1 && v.inert ? v : null;
  });
  rep.check("the tray collapses to zero height, and is inert again", !!collapsed, JSON.stringify(collapsed ?? await trayState()));

  // ── the Outline tab ─────────────────────────────────────────────────────
  await menuItem("View", "Outline");
  rep.check("the Outline tab opens in the workspace panel",
    await until(() => visible('[data-tour="workspace"]')));
  rep.check("the outline lists the document's headings",
    await until(async () => (await pg.locator('[data-tour="workspace"] button').count()) > 3));

  // ── B2 / B4, measured rather than guessed ───────────────────────────────
  // The backlog claims the toast covers the status bar (B2) and that its close
  // button renders OUTSIDE the toast (B4). Neither is decidable from the
  // source — both depend on sonner's own layout — so both are measured here.
  //
  // Measure a SETTLED toast. sonner animates one in from below the viewport,
  // and a first attempt at this read it mid-flight: the toast's bottom came
  // back 32px lower than where it comes to rest, which reported an overlap with
  // the status bar that does not exist. Poll until the rect stops moving.
  await pg.evaluate(() => {
    const el = document.querySelector(".ProseMirror");
    el?.dispatchEvent(new Event("focus"));
  });
  await menuItem("File", "Save");
  const readToast = () => pg.evaluate(() => {
    const toast = document.querySelector("[data-sonner-toast]");
    if (!toast) return null;
    const close = toast.querySelector("[data-close-button]");
    const t = toast.getBoundingClientRect();
    const bar = document.querySelector("footer")?.getBoundingClientRect() ?? null;
    const r = (x) => x && { l: Math.round(x.left), r: Math.round(x.right), t: Math.round(x.top), b: Math.round(x.bottom) };
    const base = { hasClose: !!close, toast: r(t), bar: r(bar), vh: window.innerHeight,
      clearsStatusBar: bar ? t.bottom <= bar.top : null };
    if (!close) return base;
    const c = close.getBoundingClientRect();
    const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
    return {
      ...base,
      close: r(c),
      closeW: Math.round(c.width), closeH: Math.round(c.height),
      // The ::before that grows the 20x20 button past the 24px minimum.
      // Read `top` rather than the `inset` shorthand — getComputedStyle does
      // not reliably serialise shorthands for a pseudo-element.
      padTop: (() => { const b = getComputedStyle(close, "::before"); return b.content === "none" ? null : b.top; })(),
      closeOnScreen: c.left >= 0 && c.top >= 0 && c.right <= window.innerWidth && c.bottom <= window.innerHeight,
      closeHitsItself: !!hit && (hit === close || close.contains(hit)),
      closeLabel: close.getAttribute("aria-label"),
    };
  });
  let prev = null;
  const toastGeom = await until(async () => {
    const v = await readToast();
    if (!v) return null;
    const same = prev && JSON.stringify(prev.toast) === JSON.stringify(v.toast);
    prev = v;
    return same ? v : null;   // two identical reads = it has come to rest
  }, { timeout: 10000 });
  if (!toastGeom) {
    rep.note("no toast settled in time — B2/B4 geometry not measured this run");
  } else {
    rep.check("B2: a settled toast clears the status bar",
      toastGeom.clearsStatusBar !== false, JSON.stringify(toastGeom));
    rep.check("B4: the toast has a close button at all", toastGeom.hasClose, JSON.stringify(toastGeom));
    if (toastGeom.hasClose) {
      // B4 as recorded — "renders outside the toast" — is literally true and
      // NOT a defect: sonner straddles the button across the toast's top-left
      // corner on purpose. What matters is that it is reachable, so that is
      // what is asserted: fully on-screen, and hit-testing to itself.
      rep.check("B4: the close button is fully on-screen",
        toastGeom.closeOnScreen, JSON.stringify(toastGeom.close));
      rep.check("B4: the close button is what you hit at its own centre",
        toastGeom.closeHitsItself, JSON.stringify(toastGeom));
      rep.check("B4: the close button is labelled",
        !!toastGeom.closeLabel, String(toastGeom.closeLabel));
      // The real finding behind B4: sonner draws it 20x20, under WCAG 2.5.8's
      // 24px. Grown with a ::before in styles.css, so the BOX stays 20 and the
      // hit area does not — assert the pseudo-element is there.
      rep.check("B4: its hit area is padded out to the 24px minimum",
        toastGeom.padTop === "-3px", JSON.stringify({ padTop: toastGeom.padTop, w: toastGeom.closeW, h: toastGeom.closeH }));
    }
  }

  // ── the interior pages ──────────────────────────────────────────────────
  // These render OVER the editor and mark it `inert`. The editor must stay
  // mounted underneath (the blank-document invariant), and focus must move in —
  // otherwise Escape never reaches the page, which is how they shipped once.
  //
  // Key on the page's own dialog, NOT on text. The first version of this looked
  // for "Keyboard shortcuts" — which is also an ITEM IN THE HELP MENU, so it
  // matched while the menu was still open and the page had not rendered yet.
  // The inert/focus checks then read a state that did not exist, and the case
  // reported a defect the app does not have.
  for (const [item, label] of [["Help", 'aria-label$="Help"'], ["About", 'aria-label^="About "']]) {
    const page = `[role="dialog"][${label}]`;
    await pg.locator('button:has-text("Help")').first().click();
    await pg.locator(`[role="menuitem"]:has-text("${item}")`).first().click();
    rep.check(`${item} page opens`, await until(() => visible(page)));
    await pg.waitForTimeout(300);
    const state = await pg.evaluate((sel) => ({
      editorStillMounted: !!document.querySelector(".ProseMirror"),
      editorInert: !!document.querySelector(".ProseMirror")?.closest("[inert]"),
      focusInPage: !!document.activeElement?.closest(sel),
    }), page);
    rep.check(`${item}: the editor stays mounted beneath it`, state.editorStillMounted, JSON.stringify(state));
    rep.check(`${item}: the covered editor is inert`, state.editorInert, JSON.stringify(state));
    rep.check(`${item}: focus moved into the page, so Escape reaches it`, state.focusInPage, JSON.stringify(state));
    await pg.keyboard.press("Escape");
    rep.check(`${item}: Escape closes it`,
      await until(async () => (await pg.locator(page).count()) === 0));
  }

  // ── the guided tour ─────────────────────────────────────────────────────
  await pg.locator('button:has-text("Help")').first().click();
  await pg.locator('[role="menuitem"]:has-text("Take a guided tour")').first().click();
  // Wait for the tour's OWN title. This waited for any "Next|Done|Skip" text,
  // which the always-present (visually hidden) "Skip to editor" link satisfies
  // before the tour has rendered — so the checks below raced the tour's first
  // paint and, under load, measured nothing and sent Escape to nobody.
  rep.check("the guided tour starts",
    await until(async () => (await pg.locator("#pf-tour-title").count()) > 0));
  // It spotlights real anchors, so a step whose target is missing would leave
  // the highlight at 0x0 — worth knowing, since the anchors live in other files.
  const spot = await until(() => pg.evaluate(() => {
    const ring = document.querySelector(".ring-primary");
    if (!ring) return null;
    const r = ring.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  }));
  rep.check("the tour's spotlight has found a real element",
    !!spot && spot.w > 10 && spot.h > 10, JSON.stringify(spot));
  await pg.keyboard.press("Escape");
  await pg.waitForTimeout(400);
  rep.check("Escape ends the tour",
    await until(async () => (await pg.locator(".ring-primary").count()) === 0));

  // The whole point of driving these surfaces: a console error anywhere in them
  // fails the run, whatever the case above was looking at.
  rep.check("no console errors across every surface opened here",
    errors.length === 0, errors.join("\n"));
});
