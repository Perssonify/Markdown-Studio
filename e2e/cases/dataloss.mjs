// The data-loss sequences, in a real browser.
//
// These three were found by an external code review and fixed in 1.77.0. The
// fixes are unit-tested against fake editor/storage boundaries, which is enough
// to pin the logic — but not enough to claim the DEFECT was real in the running
// application. Two real tabs, real IndexedDB, real autosave timing and the
// actual UI affordances are where these live, and that is what this suite is.
//
// `faults.mjs` already stops exactly where two of them begin: it drives two
// tabs into a conflict, asserts the second parks a terminal status, and ends.
// Everything below is what happens NEXT.
import {
  serve, open, boot, seed, storedDoc, canonicalText, richText, runCase, until, APP_DIR, BLANK_PATH,
} from "../lib.mjs";
import { proseDoc } from "../docs.mjs";

/** Drive two tabs onto the same document until the second parks a conflict. */
async function twoTabsInConflict(rep, onClose, { docs, editIn = "aaa" }) {
  const srv = await serve(APP_DIR);
  const a = await open(srv.port, { label: "dataloss" });
  onClose(async () => { await a.browser.close(); srv.close(); });
  await a.page.goto(`http://127.0.0.1:${srv.port}${BLANK_PATH}`);
  await seed(a.page, docs);
  await boot(a.page, srv.port, { mode: "Split", settle: 6000 });

  const b = await a.context.newPage();
  await b.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "networkidle" });
  await b.waitForTimeout(7000);

  // Tab A writes first, and we wait for it to actually reach disk — that write
  // is what tab B's guard has to notice.
  await a.page.bringToFront();
  await a.page.locator(".ProseMirror").first().click();
  await a.page.keyboard.press("Control+End");
  await a.page.keyboard.type("TAB-A-EDIT", { delay: 10 });
  await until(async () => canonicalText(await storedDoc(a.page, editIn)).includes("TAB-A-EDIT"),
    { timeout: 30000 });

  // Tab B is still holding the pre-write revision, so its own edit conflicts.
  await b.bringToFront();
  await b.locator(".ProseMirror").first().click();
  await b.keyboard.press("Control+End");
  await b.keyboard.type("TAB-B-EDIT", { delay: 10 });
  const parked = await until(async () => {
    const t = await b.evaluate(() => document.querySelector("footer")?.innerText ?? "");
    return /another tab|conflict|not sav/i.test(t) ? t : null;
  }, { timeout: 30000 });
  rep.check("two tabs: the second parks a conflict before we go further",
    !!parked, String(parked).slice(0, 160));
  return { srv, a, b };
}

const footer = (pg) => pg.evaluate(() => document.querySelector("footer")?.innerText ?? "");

runCase("dataloss", async (rep, onClose) => {
  // ── F003: a conflict must survive an ordinary navigation ────────────────
  // Switching away and back rebuilt `activeDoc` from the freshly-read record,
  // so ANOTHER tab's `updated` became the baseline for a draft written against
  // the older revision. Drift collapsed to zero and the write the guard had
  // already refused went through — silently overwriting the other tab's work.
  {
    const { b } = await twoTabsInConflict(rep, onClose, {
      docs: [proseDoc("aaa", "Alpha doc", 1), proseDoc("bbb", "Beta doc", 1)],
    });

    // Leave the document and come back, the way a user would: through the
    // library list, not by poking the store.
    const panelOpen = () => b.evaluate(() =>
      !!document.querySelector('button[aria-label="Close workspace panel"]'));
    const openDoc = async (title) => {
      if (!(await panelOpen())) {
        await b.keyboard.press("Control+Shift+D");
        await until(panelOpen);
      }
      await b.waitForTimeout(500);
      await b.locator(`button:has-text("${title}")`).first().click();
      await b.waitForTimeout(2500);
    };
    await openDoc("Beta doc");
    rep.check("F003: the second tab really did leave the conflicted document",
      !(await richText(b)).includes("TAB-B-EDIT"));
    await openDoc("Alpha doc");
    rep.check("F003: …and came back to its own unsaved text",
      await until(async () => (await richText(b)).includes("TAB-B-EDIT")));

    // Now type again. Before the fix this save saw zero drift and committed,
    // destroying TAB-A-EDIT. Give autosave well past its window to do so.
    await b.locator(".ProseMirror").first().click();
    await b.keyboard.press("Control+End");
    await b.keyboard.type("-AFTER-RETURN", { delay: 10 });
    await b.waitForTimeout(12000);

    const disk = canonicalText(await storedDoc(b, "aaa"));
    rep.check("F003: the other tab's work is STILL on disk after switching away and back",
      disk.includes("TAB-A-EDIT"), disk.slice(-200));
    rep.check("F003: the conflicted draft did not overwrite it",
      !disk.includes("-AFTER-RETURN"), disk.slice(-200));
    rep.check("F003: and the tab still says it is not saving",
      /another tab|conflict|not sav/i.test(await footer(b)), (await footer(b)).slice(0, 160));
  }

  // ── F001: closing a conflicted document must not discard it ─────────────
  // The close path prompted only on `saveStatus === "editing"`. `conflict` is
  // TERMINAL, ordinary typing caches no draft, and the close path never
  // flushed one — so the document closed with the text on no surface at all.
  {
    const { b } = await twoTabsInConflict(rep, onClose, {
      docs: [proseDoc("aaa", "Alpha doc", 1), proseDoc("bbb", "Beta doc", 1)],
    });

    await b.locator('button:has-text("File")').first().click();
    await b.locator('[role="menuitem"]:has-text("Close document")').first().click();

    // The fix is the PROMPT: the user is asked instead of losing the text.
    const asked = await until(async () => {
      const dlg = await b.locator('[role="alertdialog"], [role="dialog"]').first();
      return (await dlg.count()) && (await dlg.isVisible().catch(() => false)) ? await dlg.innerText() : null;
    }, { timeout: 8000 });
    rep.check("F001: closing a conflicted document asks first",
      !!asked, String(asked).slice(0, 200));

    if (asked) {
      // Cancel, and the document must still be there with its text intact —
      // the point of asking is that "cancel" is a real option.
      const cancel = b.locator('button:has-text("Cancel")').first();
      if (await cancel.count()) await cancel.click();
      await b.waitForTimeout(1500);
      rep.check("F001: cancelling keeps the document and its unsaved text",
        (await richText(b)).includes("TAB-B-EDIT"), (await richText(b)).slice(-160));
    }

    // A control, not the discriminator: closing does not itself write, so this
    // holds in the broken build too (mutation-tested). The check that goes red
    // without the fix is the PROMPT — without it the document closes and its
    // text exists on no surface at all. Kept because a close that DID write
    // would be a worse defect than the one being fixed.
    const disk = canonicalText(await storedDoc(b, "aaa"));
    rep.check("F001 [control]: closing never writes over the other tab's version",
      disk.includes("TAB-A-EDIT"), disk.slice(-200));
  }

  // ── A018: a RELOAD after a conflict must not overwrite the other tab ─────
  // The conflict message tells the user to reload. The unload handler stashed
  // the conflicted tab's text; the next boot adopted it against the record on
  // disk — whose `updated` is the OTHER tab's — so the guard saw no drift and
  // the first autosave replaced that tab's work (the audit watched it go
  // within 15s). The stash now carries the revision the draft was written on.
  {
    const { b } = await twoTabsInConflict(rep, onClose, {
      docs: [proseDoc("aaa", "Alpha doc", 1), proseDoc("bbb", "Beta doc", 1)],
    });

    await b.reload({ waitUntil: "domcontentloaded" });
    // Nothing typed is lost: the reloaded tab shows its own unsaved text…
    rep.check("A018: the reloaded tab still has its unsaved text",
      await until(async () => (await richText(b)).includes("TAB-B-EDIT"), { timeout: 20000 }),
      (await richText(b)).slice(-160));
    // …and gives autosave well past its window to do damage.
    await b.waitForTimeout(12000);

    const disk = canonicalText(await storedDoc(b, "aaa"));
    rep.check("A018: the other tab's work is STILL on disk after the reload",
      disk.includes("TAB-A-EDIT"), disk.slice(-200));
    rep.check("A018: the reloaded draft did not overwrite it",
      !disk.includes("TAB-B-EDIT"), disk.slice(-200));
    rep.check("A018: and the reloaded tab says it is not saving",
      /another tab|conflict|not sav/i.test(await footer(b)), (await footer(b)).slice(0, 160));
  }
});
