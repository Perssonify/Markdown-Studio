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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  serve, open, boot, seed, storedDoc, canonicalText, richText, runCase, until, closeRig, APP_DIR, BLANK_PATH,
} from "../lib.mjs";
import { proseDoc } from "../docs.mjs";

/** Two tabs of one browser on one library, both booted on the same document. */
async function twoTabs(onClose, { docs, label = "dataloss" }) {
  const srv = await serve(APP_DIR);
  const a = await open(srv.port, { label });
  onClose(async () => { await a.browser.close(); srv.close(); });
  await a.page.goto(`http://127.0.0.1:${srv.port}${BLANK_PATH}`);
  await seed(a.page, docs);
  await boot(a.page, srv.port, { mode: "Split", settle: 6000 });

  const b = await a.context.newPage();
  await b.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "networkidle" });
  await b.waitForTimeout(7000);
  return { srv, a, b };
}

async function typeAtEnd(pg, text) {
  await pg.bringToFront();
  await pg.locator(".ProseMirror").first().click();
  await pg.keyboard.press("Control+End");
  await pg.keyboard.type(text, { delay: 10 });
}

/**
 * Tab B types, then tab A writes the same document and saves — inside B's
 * autosave window, so B holds unsaved work another tab has just overtaken.
 * (Typed the other way round, B is clean when A's save arrives and simply
 * takes it live — which is the first case below.)
 */
async function conflictInB(rep, a, b, { editIn = "aaa", mine = "TAB-B-EDIT", theirs = "TAB-A-EDIT" } = {}) {
  await typeAtEnd(b, mine);
  await typeAtEnd(a.page, theirs);
  await a.page.keyboard.press("Control+s");
  await until(async () => canonicalText(await storedDoc(a.page, editIn)).includes(theirs),
    { timeout: 30000 });
  const parked = await until(async () => {
    const t = await shownStatus(b);
    return /another tab|conflict|not sav/i.test(t) ? t : null;
  }, { timeout: 30000 });
  rep.check(`two tabs: the second parks a conflict before we go further (${mine})`,
    !!parked, String(parked).slice(0, 160));
}

/** Drive two tabs onto the same document until the second parks a conflict. */
async function twoTabsInConflict(rep, onClose, { docs, editIn = "aaa" }) {
  const { srv, a, b } = await twoTabs(onClose, { docs });
  await conflictInB(rep, a, b, { editIn });
  return { srv, a, b };
}

/** What the status bar SHOWS — without its screen-reader live region, which
 *  keeps saying the last failure it announced after the failure has gone. */
const shownStatus = (pg) => pg.evaluate(() =>
  [...(document.querySelector("footer")?.children ?? [])]
    .filter((el) => el.getAttribute("role") !== "status")
    .map((el) => el.innerText).join(" "));
const notice = (pg) => pg.evaluate(() =>
  document.querySelector("[data-tab-sync-notice]")?.getAttribute("data-tab-sync-notice") ?? null);
const clickNotice = (pg, label) => pg.locator(`[data-tab-sync-notice] button:has-text("${label}")`).first().click();

/** Every document on disk, parsed. */
const allDocs = (pg) => pg.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("perssonify-docs");
  r.onsuccess = () => {
    const db = r.result;
    const q = db.transaction(["documents"], "readonly").objectStore("documents").getAll();
    q.onsuccess = () => { db.close(); res(q.result.map((v) => (typeof v === "string" ? JSON.parse(v) : v))); };
    q.onerror = () => { db.close(); res([]); };
  };
  r.onerror = () => res([]);
}));

/** Version history entries (document, reason) whose content holds `needle`. */
const historyWith = (pg, needle) => pg.evaluate((needle) => new Promise((res) => {
  const r = indexedDB.open("perssonify-snapshots");
  // Never CREATE the app's database from here: an empty one would stop the
  // app's own open from building its schema.
  r.onupgradeneeded = () => r.transaction.abort();
  r.onsuccess = () => {
    const db = r.result;
    if (!db.objectStoreNames.contains("snapshots")) { db.close(); return res([]); }
    const q = db.transaction("snapshots").objectStore("snapshots").getAll();
    q.onsuccess = () => {
      db.close();
      // A record keeps its content as JSON text (`json`) since A083, as an
      // object (`canonical`) before.
      const text = (s) => (typeof s.json === "string" ? s.json : JSON.stringify(s.canonical ?? null));
      res(q.result.filter((s) => text(s).includes(needle)).map((s) => `${s.docId}:${s.reason}`));
    };
    q.onerror = () => { db.close(); res([]); };
  };
  r.onerror = () => res([]);
}), needle);

runCase("dataloss", async (rep, onClose) => {
  // ── Live sync between tabs: a save in one tab reaches the other ─────────
  // Two tabs on one library used to see each other's work only after a
  // reload, and found out they had been overtaken only when they tried to
  // save. Now every committed write is announced (ids and revisions only) and
  // a CLEAN tab takes it live; the library list follows too.
  {
    const { a, b } = await twoTabs(onClose, {
      docs: [proseDoc("aaa", "Alpha doc", 1), proseDoc("bbb", "Beta doc", 1)],
      label: "live sync",
    });
    await typeAtEnd(a.page, "LIVE-FROM-A");
    await a.page.keyboard.press("Control+s");
    rep.check("live sync: A's save reaches B's rich pane without a reload",
      await until(async () => (await richText(b)).includes("LIVE-FROM-A"), { timeout: 20000 }),
      (await richText(b)).slice(-160));
    rep.check("live sync: …and B's markdown pane",
      await until(async () => (await b.evaluate(() => document.querySelector(".cm-content")?.textContent ?? "")).includes("LIVE-FROM-A")));
    rep.check("live sync: B says so, quietly",
      await until(async () => (await b.locator('[data-sonner-toast]:has-text("Updated from another tab")').count()) > 0));
    rep.check("live sync: B is not in conflict and asks nothing",
      !/another tab|conflict|not sav/i.test(await shownStatus(b)) && (await notice(b)) === null, (await shownStatus(b)).slice(0, 160));

    // B keeps working on top of it: its own edit lands, A's survives.
    await typeAtEnd(b, "-THEN-B");
    await b.keyboard.press("Control+s");
    const disk = await until(async () => {
      const t = canonicalText(await storedDoc(b, "aaa"));
      return t.includes("-THEN-B") ? t : null;
    }, { timeout: 20000 });
    rep.check("live sync: B's edit on top of A's is saved, and A's is still there",
      !!disk && disk.includes("LIVE-FROM-A"), String(disk).slice(-200));
    rep.check("live sync: …and A takes B's edit live in turn",
      await until(async () => (await richText(a.page)).includes("-THEN-B"), { timeout: 20000 }));

    // The library list follows: a document made in A appears in B's panel.
    await a.page.bringToFront();
    await a.page.locator('button[aria-label="New document"]').first().click();
    await a.page.waitForTimeout(1500);
    await a.page.locator(".ProseMirror").first().click();
    // "# " becomes a heading as it is typed, and the first heading names it.
    await a.page.keyboard.type("# Fresh from A", { delay: 10 });
    await a.page.keyboard.press("Control+s");
    await b.bringToFront();
    rep.check("live sync: a document created in A appears in B's library",
      await until(async () => (await b.locator('[role="tree"]').first().innerText().catch(() => "")).includes("Fresh from A"), { timeout: 20000 }),
      (await b.locator('[role="tree"]').first().innerText().catch(() => "")).slice(0, 200));
  }

  // ── Live sync: unsaved work here, and the three ways out ────────────────
  // B has typed; A saves the same document. B must not take A's version over
  // its typing, nor save over A's: it parks the conflict AT ONCE and offers
  // Keep mine / Use theirs / Save mine as a copy. Whichever version is set
  // aside goes to Version history first — nothing is lost on any branch.
  {
    const { a, b } = await twoTabs(onClose, {
      docs: [proseDoc("aaa", "Alpha doc", 1), proseDoc("bbb", "Beta doc", 1)],
      label: "tab conflict choices",
    });

    await conflictInB(rep, a, b, { mine: "B-KEEP-1", theirs: "A-SET-ASIDE-1" });
    rep.check("choices: B shows the notice", (await notice(b)) === "Changed in another tab", String(await notice(b)));
    rep.check("choices: B still shows its own typing", (await richText(b)).includes("B-KEEP-1"));
    await clickNotice(b, "Keep mine");
    const kept = await until(async () => {
      const t = canonicalText(await storedDoc(b, "aaa"));
      return t.includes("B-KEEP-1") ? t : null;
    }, { timeout: 20000 });
    rep.check("Keep mine: B's version is on disk", !!kept, String(kept).slice(-200));
    rep.check("Keep mine: A's version is in Version history",
      (await until(() => historyWith(b, "A-SET-ASIDE-1").then((h) => h.length ? h : null))) !== null,
      JSON.stringify(await historyWith(b, "A-SET-ASIDE-1")));
    rep.check("Keep mine: A takes B's version live",
      await until(async () => (await richText(a.page)).includes("B-KEEP-1"), { timeout: 20000 }));
    await b.waitForTimeout(1500);

    await conflictInB(rep, a, b, { mine: "B-SET-ASIDE-2", theirs: "A-USED-2" });
    await clickNotice(b, "Use theirs");
    rep.check("Use theirs: B shows A's version",
      await until(async () => (await richText(b)).includes("A-USED-2") && !(await richText(b)).includes("B-SET-ASIDE-2"), { timeout: 20000 }),
      (await richText(b)).slice(-200));
    rep.check("Use theirs: B's version is in Version history",
      (await until(() => historyWith(b, "B-SET-ASIDE-2").then((h) => h.length ? h : null))) !== null);
    await b.waitForTimeout(7000); // past B's autosave window: nothing of B's may land now
    const afterTheirs = canonicalText(await storedDoc(b, "aaa"));
    rep.check("Use theirs: disk holds A's version, not B's",
      afterTheirs.includes("A-USED-2") && !afterTheirs.includes("B-SET-ASIDE-2"), afterTheirs.slice(-200));

    await conflictInB(rep, a, b, { mine: "B-COPIED-3", theirs: "A-SHOWN-3" });
    await clickNotice(b, "Save mine as a copy");
    const copy = await until(async () => (await allDocs(b)).find((d) => d.id !== "aaa" && canonicalText(d).includes("B-COPIED-3")), { timeout: 20000 });
    rep.check("Save mine as a copy: a new document holds B's version", !!copy, copy ? copy.title : "no copy");
    rep.check("Save mine as a copy: B now shows A's version",
      await until(async () => (await richText(b)).includes("A-SHOWN-3"), { timeout: 20000 }));
    const afterCopy = canonicalText(await storedDoc(b, "aaa"));
    rep.check("Save mine as a copy: the document itself holds A's version",
      afterCopy.includes("A-SHOWN-3") && !afterCopy.includes("B-COPIED-3"), afterCopy.slice(-200));
  }

  // ── Live sync: the document open in B is deleted in A ───────────────────
  // B must not resurrect it by saving, and must not lose what it held: the
  // text stays on screen, saving stops, and B can keep it under a new id.
  {
    const { a, b } = await twoTabs(onClose, {
      docs: [proseDoc("aaa", "Alpha doc", 1), proseDoc("bbb", "Beta doc", 1)],
      label: "deleted in another tab",
    });
    await typeAtEnd(b, "B-UNSAVED-AT-DELETE");
    await a.page.bringToFront();
    await a.page.locator('[role="tree"] [data-key="d:aaa"]').first().click({ button: "right" });
    await a.page.locator('[role="menuitem"]:has-text("Delete")').first().click();
    await a.page.locator('[role="alertdialog"] button:has-text("Delete")').first().click();
    await until(async () => (await storedDoc(a.page, "aaa")) === null, { timeout: 20000 });

    rep.check("deleted: B shows the notice",
      (await until(() => notice(b).then((n) => n === "Deleted in another tab" ? n : null), { timeout: 20000 })) !== null,
      String(await notice(b)));
    rep.check("deleted: B keeps the text on screen", (await richText(b)).includes("B-UNSAVED-AT-DELETE"));
    rep.check("deleted: B says it is not saving", /Deleted in another tab/i.test(await shownStatus(b)), (await shownStatus(b)).slice(0, 160));
    await b.bringToFront();
    await b.keyboard.press("Control+s");
    await b.waitForTimeout(7000); // past the autosave window
    rep.check("deleted: B never writes it back", (await storedDoc(b, "aaa")) === null);
    rep.check("deleted: B's unsaved text is in Version history",
      (await until(() => historyWith(b, "B-UNSAVED-AT-DELETE").then((h) => h.length ? h : null))) !== null);

    await clickNotice(b, "Keep as a new document");
    const fresh = await until(async () => (await allDocs(b)).find((d) => canonicalText(d).includes("B-UNSAVED-AT-DELETE")), { timeout: 20000 });
    rep.check("deleted: Keep as a new document saves it under a new id", !!fresh && fresh.id !== "aaa", fresh ? fresh.id : "none");
    rep.check("deleted: …and the old id stays deleted", (await storedDoc(b, "aaa")) === null);
    rep.check("deleted: …and B saves normally again", !/not sav/i.test(await shownStatus(b)) && (await notice(b)) === null,
      (await shownStatus(b)).slice(0, 160));
  }

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
      /another tab|conflict|not sav/i.test(await shownStatus(b)), (await shownStatus(b)).slice(0, 160));
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
      /another tab|conflict|not sav/i.test(await shownStatus(b)), (await shownStatus(b)).slice(0, 160));
  }

  // ── A086: an image stored as an asset survives a reload, an export and a
  // restore into a fresh browser ──────────────────────────────────────────
  // Pasted images now live in their own database (perssonify-assets) and the
  // document holds a `pf-asset:` reference. What only a real browser can say:
  // the picture is SHOWN (object URL, decoded pixels), the reference is what
  // reached disk, the HTML export stands on its own, and a full backup carries
  // the picture into a profile that has never seen it.
  {
    const srv = await serve(APP_DIR);
    const rig = await open(srv.port, { label: "assets" });
    onClose(async () => { await rig.browser.close(); srv.close(); });
    const pg = rig.page;
    await pg.goto(`http://127.0.0.1:${srv.port}${BLANK_PATH}`);
    await seed(pg, [proseDoc("img", "Picture doc", 1)]);
    await boot(pg, srv.port, { mode: "Split", settle: 6000 });

    // A real 64×48 PNG, pasted into the rich pane as a FILE (a screenshot).
    await pg.locator(".ProseMirror").first().click();
    await pg.keyboard.press("Control+End");
    const hash = await pg.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 64; c.height = 48;
      const x = c.getContext("2d");
      x.fillStyle = "#c33"; x.fillRect(0, 0, 64, 48);
      x.fillStyle = "#36c"; x.fillRect(8, 8, 30, 20);
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], "diagram.png", { type: "image/png" }));
      const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      if (!ev.clipboardData || !ev.clipboardData.files.length) Object.defineProperty(ev, "clipboardData", { value: dt });
      document.querySelector(".ProseMirror").dispatchEvent(ev);
      const d = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
    });
    const shown = () => pg.evaluate(() =>
      [...document.querySelectorAll(".ProseMirror img:not(.ProseMirror-separator)")]
        .some((i) => i.src.startsWith("blob:") && i.naturalWidth === 64 && !i.hasAttribute("data-pf-asset-missing")));
    rep.check("A086: a pasted image is SHOWN from the asset store (object URL, decoded)",
      await until(shown, { timeout: 15000 }));
    rep.check("A086: no live <img> was ever handed the pf-asset: reference",
      await pg.evaluate(() => ![...document.querySelectorAll("img")].some((i) => (i.getAttribute("src") || "").startsWith("pf-asset:"))));

    const onDisk = await until(async () => {
      const d = await storedDoc(pg, "img");
      return d && JSON.stringify(d.canonical).includes(`pf-asset:${hash}`) ? d : null;
    }, { timeout: 30000 });
    rep.check("A086: the document on disk holds the reference, not base64",
      !!onDisk && !JSON.stringify(onDisk).includes("base64,"), JSON.stringify(onDisk?.canonical ?? null).slice(0, 200));
    const assetMeta = await pg.evaluate((h) => new Promise((res) => {
      const r = indexedDB.open("perssonify-assets");
      r.onsuccess = () => {
        const q = r.result.transaction("meta").objectStore("meta").get(h);
        q.onsuccess = () => { res(q.result ?? null); r.result.close(); };
        q.onerror = () => res(null);
      };
      r.onerror = () => res(null);
    }), hash);
    rep.check("A086: the bytes are in the perssonify-assets database, once",
      !!assetMeta && assetMeta.mime === "image/png", JSON.stringify(assetMeta));
    rep.check("A086: the markdown pane shows a short reference, not a wall of base64",
      await until(async () => {
        const t = await pg.evaluate(() => document.querySelector(".cm-content")?.textContent ?? "");
        return t.includes(`pf-asset:${hash.slice(0, 8)}…`) && !t.includes("base64");
      }, { timeout: 10000 }));

    await pg.reload({ waitUntil: "networkidle" });
    rep.check("A086: after a reload the image is still there",
      await until(shown, { timeout: 20000 }));

    // File ▸ Export ▸ HTML is self-contained. Downloads are saved OUT of the
    // browser's artifact folder, which is deleted when that browser closes.
    const exportVia = async (item) => {
      const dl = pg.waitForEvent("download", { timeout: 20000 });
      await pg.locator('button:has-text("File")').first().click();
      await pg.locator('[role="menuitem"]:has-text("Export")').first().click();
      await pg.locator(`[role="menuitem"]:has-text("${item}")`).first().click();
      const d = await dl;
      const to = path.join(os.tmpdir(), `e2e-a086-${Date.now()}-${d.suggestedFilename()}`);
      await d.saveAs(to);
      onClose(async () => fs.rmSync(to, { force: true }));
      return to;
    };
    const html = fs.readFileSync(await exportVia("HTML (.html)"), "utf8");
    rep.check("A086: the HTML export embeds the image as data",
      html.includes("data:image/png;base64,") && !html.includes("pf-asset:"), html.slice(0, 200));

    // Full backup → a FRESH profile (a new browser) → import → the image is back.
    const zipPath = await exportVia("Full backup (.zip)");
    const zipBytes = fs.readFileSync(zipPath);
    rep.check("A086: the backup carries the image as a file",
      zipBytes.includes(Buffer.from(`assets/${hash}.png`)), `${zipBytes.length} bytes`);
    await closeRig(rig);

    const fresh = await open(srv.port, { label: "assets restore (fresh profile)" });
    const p2 = fresh.page;
    await boot(p2, srv.port, { mode: "Split", settle: 6000 });
    await p2.locator('input[type="file"]').first().setInputFiles(zipPath);
    const restored = () => p2.evaluate(() =>
      [...document.querySelectorAll(".ProseMirror img:not(.ProseMirror-separator)")]
        .some((i) => i.src.startsWith("blob:") && i.naturalWidth === 64));
    rep.check("A086: restored on a fresh profile, the document shows its image",
      await until(restored, { timeout: 30000 }),
      await p2.evaluate(() => document.querySelector(".ProseMirror")?.innerHTML.slice(0, 300)));
    await closeRig(fresh);
  }
});
