// Tier 3 — user simulation.
//
// Sequences a person actually performs, each ending in an integrity assertion.
// The centrepiece is REAL IME / voice-dictation composition, driven through CDP
// (`Input.imeSetComposition`): it is the one input class the unit tests cannot
// reach — they toggle a boolean on a mock handle — and three reproduced
// data-loss defects lived there.
import {
  serve, open, boot, seed, mdText, richText, storedDoc, canonicalText, runCase, until, APP_DIR,
} from "../lib.mjs";
import { proseDoc } from "../docs.mjs";

const MARK = "ZQDICTATEDQZ";

/** Boot a two-document library with Alpha open, in split view. */
async function session(onClose, opts = {}) {
  const srv = await serve(APP_DIR);
  const rig = await open(srv.port, { cdp: true, ...opts });
  onClose(async () => { await rig.browser.close(); srv.close(); });
  await rig.page.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
  await seed(rig.page, [proseDoc("aaa", "Alpha doc", 1), proseDoc("bbb", "Beta doc", 1)]);
  await boot(rig.page, srv.port, { mode: "Split", settle: 6000 });
  await openDoc(rig.page, "Alpha doc");
  return rig;
}

const openDoc = async (pg, title) => {
  await pg.locator(`text=${title}`).first().click({ timeout: 15000 }).catch(() => {});
  await pg.waitForTimeout(1800);
};

/** Put the caret on a fresh line at the end of a pane. */
async function caretAtEnd(pg, pane) {
  await pg.locator(pane === "md" ? ".cm-content" : ".ProseMirror").first().click();
  await pg.keyboard.press("Control+End");
  await pg.keyboard.press("Enter");
  await pg.waitForTimeout(250);
}

/** Count compositionend events from here on, so a case can tell whether a
 *  gesture ended the composition itself. */
const watchCompositionEnd = (pg) =>
  pg.evaluate(() => { window.__ce = 0; document.addEventListener("compositionend", () => window.__ce++, true); });
const compositionEnded = (pg) => pg.evaluate(() => window.__ce > 0);

/** Stream a composition WITHOUT committing it — the state the guards are about. */
async function dictate(cdp, pg, text) {
  for (const n of [Math.ceil(text.length / 3), Math.ceil((text.length * 2) / 3), text.length]) {
    const t = text.slice(0, n);
    await cdp.send("Input.imeSetComposition", { text: t, selectionStart: t.length, selectionEnd: t.length });
    await pg.waitForTimeout(60);
  }
}

runCase("journeys", async (rep, onClose) => {
  // ── N1: leaving a document with a composition still open ────────────────
  // Reproduced before the fix: dictate into the markdown pane, press ⌘N (which
  // never blurs, so the composition stays live), and the dictated text was gone
  // from both panes AND from disk when you came back.
  {
    const { page: pg, cdp, errors } = await session(onClose);
    await caretAtEnd(pg, "md");
    await dictate(cdp, pg, MARK);
    await pg.keyboard.press("Control+n");          // new document — no blur
    await pg.waitForTimeout(2500);                 // let the new doc settle
    await openDoc(pg, "Alpha doc");
    await until(async () => (await richText(pg)).length > 100);

    const md = await mdText(pg), rich = await richText(pg);
    const disk = canonicalText(await storedDoc(pg, "aaa"));
    rep.check("N1 md pane kept the dictated text across ⌘N", md.includes(MARK), md.slice(-80));
    rep.check("N1 rich pane received it", rich.includes(MARK), rich.slice(-80));
    rep.check("N1 it reached disk", disk.includes(MARK), disk.slice(-80));
  }

  // Same, leaving by clicking another document. This path always worked (the
  // click blurs the editor, which ends the composition), and is here so a
  // future change cannot quietly break the case that was fine.
  {
    const { page: pg, cdp } = await session(onClose);
    await caretAtEnd(pg, "md");
    await dictate(cdp, pg, MARK);
    await openDoc(pg, "Beta doc");
    await openDoc(pg, "Alpha doc");
    const disk = canonicalText(await storedDoc(pg, "aaa"));
    rep.check("N1 clicking another document also keeps it", disk.includes(MARK), disk.slice(-80));
  }

  // ── N2: ⌘Z mid-composition must not strand the deferred projection ──────
  // `cancelPendingSync` used to clear the 120ms retry loop, which is the
  // deferred projection's only wake-up. The panes ended permanently out of
  // step, in both directions.
  for (const pane of ["md", "rich"]) {
    const { page: pg, cdp } = await session(onClose);
    await caretAtEnd(pg, pane);
    await watchCompositionEnd(pg);
    await dictate(cdp, pg, MARK);
    await pg.keyboard.press("Control+z");
    await pg.waitForTimeout(300);
    // The IME commits — unless the gesture already ended the composition, in
    // which case inserting again would just duplicate the text.
    if (!(await compositionEnded(pg))) await cdp.send("Input.insertText", { text: MARK });
    await pg.waitForTimeout(4000);
    const md = await mdText(pg), rich = await richText(pg);
    rep.check(`N2 panes converge after ⌘Z mid-composition (${pane} pane)`,
      md.includes(MARK) === rich.includes(MARK) && md.includes(MARK),
      `md:${md.includes(MARK)} rich:${rich.includes(MARK)}`);
  }

  // ── N3: a formatting chord mid-composition must not corrupt the text ────
  // ⌘B while dictating into the markdown pane dispatched straight into the
  // composing CodeMirror view: the streamed text ended up DUPLICATED and the
  // rich pane never converged.
  for (const pane of ["md", "rich"]) {
    const { page: pg, cdp } = await session(onClose);
    await caretAtEnd(pg, pane);
    await watchCompositionEnd(pg);
    await dictate(cdp, pg, MARK);
    await pg.keyboard.press("Control+b");
    await pg.waitForTimeout(300);
    if (!(await compositionEnded(pg))) await cdp.send("Input.insertText", { text: MARK });
    await pg.waitForTimeout(4000);
    const md = await mdText(pg), rich = await richText(pg);
    const copies = md.split(MARK).length - 1;
    rep.check(`N3 ⌘B mid-composition does not duplicate the text (${pane} pane)`,
      copies === 1, `${copies} copies in the markdown pane`);
    rep.check(`N3 panes still converge (${pane} pane)`,
      md.includes(MARK) === rich.includes(MARK), `md:${md.includes(MARK)} rich:${rich.includes(MARK)}`);
  }

  // ── H1: the selection-freshness flush runs before EVERY ⌘-chord ─────────
  // It calls ProseMirror's domObserver.flush() before the ⌘Z branch, so the
  // question is whether it changes what undo reverts. Measured against a build
  // with that line removed: identical at every gap, in both panes — because
  // ProseMirror's own keydown handler already force-flushes the observer before
  // its keymap runs. This pins that undo still reverts the whole typed run.
  {
    const { page: pg } = await session(onClose);
    const SENT = "Undo boundary sentence one. ";
    for (const gap of [0, 50, 200]) {
      await caretAtEnd(pg, "rich");
      const before = await richText(pg);
      await pg.keyboard.type(SENT, { delay: 15 });
      await pg.waitForTimeout(gap);
      await pg.keyboard.press("Control+z");
      await until(async () => !(await richText(pg)).includes(SENT.trim()));
      const after = await richText(pg);
      rep.check(`H1 ⌘Z ${gap}ms after typing reverts the run`,
        !after.includes(SENT.trim()) && after.length <= before.length + 2,
        `len ${before.length} -> ${after.length}`);
    }
  }

  // ── ⌘B applies at every settle delay ────────────────────────────────────
  // The selection-freshness fix exists for this: a chord pressed within a few
  // milliseconds of a selection gesture used to act on the PREVIOUS selection,
  // so ⌘B set a stored mark at the caret instead of bolding the word.
  {
    const { page: pg } = await session(onClose);
    for (const gap of [0, 10, 50, 200]) {
      await caretAtEnd(pg, "rich");
      await pg.keyboard.type("boldtarget", { delay: 10 });
      await pg.waitForTimeout(400);
      await pg.keyboard.down("Shift");
      for (let i = 0; i < 10; i++) await pg.keyboard.press("ArrowLeft");
      await pg.keyboard.up("Shift");
      await pg.waitForTimeout(gap);
      await pg.keyboard.press("Control+b");
      await until(async () =>
        /<strong>boldtarget<\/strong>/.test(
          await pg.evaluate(() => document.querySelector(".ProseMirror").innerHTML)));
      const html = await pg.evaluate(() => document.querySelector(".ProseMirror").innerHTML);
      rep.check(`⌘B ${gap}ms after a selection bolds the selected word`,
        /<strong>boldtarget<\/strong>/.test(html), html.slice(-160));
    }
  }

  // ── a composition flag that gets stuck must not wedge the sync ──────────
  // The undo above destroys the composition WITHOUT a compositionend event, so
  // CodeMirror's `view.composing` stays true. Before COMPOSITION_STALL_MS,
  // every projection deferred forever: the panes never converged again, not
  // after the commit and not after further typing.
  {
    const { page: pg, cdp } = await session(onClose);
    await caretAtEnd(pg, "md");
    await watchCompositionEnd(pg);
    await dictate(cdp, pg, MARK);
    await pg.keyboard.press("Control+z");              // kills the composition silently
    await pg.waitForTimeout(300);
    await cdp.send("Input.insertText", { text: MARK });
    await pg.waitForTimeout(300);
    const endedCleanly = await compositionEnded(pg);
    await pg.waitForTimeout(11000);                    // past the stall expiry
    const md = await mdText(pg), rich = await richText(pg);
    rep.note(`compositionend after the undo: ${endedCleanly}`);
    rep.check("a stuck composition flag does not wedge the sync",
      md.includes(MARK) && rich.includes(MARK), `md:${md.includes(MARK)} rich:${rich.includes(MARK)}`);
  }

  // ── Paste, then leave immediately ───────────────────────────────────────
  // handleHtmlPaste arms an uncancelled 100ms forceSyncHtmlToMd; a document
  // switch inside that window used to be able to land it on the wrong document.
  {
    const { page: pg, errors } = await session(onClose);
    await caretAtEnd(pg, "rich");
    await pg.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData("text/html", "<p><b>PASTEDMARK</b> pasted content</p>");
      document.querySelector(".ProseMirror").dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await openDoc(pg, "Beta doc");       // switch inside the 100ms window
    await until(async () => canonicalText(await storedDoc(pg, "aaa")).includes("PASTEDMARK"),
      { timeout: 25000 });
    const beta = canonicalText(await storedDoc(pg, "bbb"));
    await openDoc(pg, "Alpha doc");
    const alpha = canonicalText(await storedDoc(pg, "aaa"));
    rep.check("paste then switch: the paste stayed in its own document",
      alpha.includes("PASTEDMARK") && !beta.includes("PASTEDMARK"),
      `alpha:${alpha.includes("PASTEDMARK")} beta:${beta.includes("PASTEDMARK")}`);
  }

  // ── ⇧+paste inverts the styled-paste preference ─────────────────────────
  // A documented feature that had never worked: the handler read
  // `event.shiftKey`, and ClipboardEvent does not inherit from UIEvent — it has
  // no shiftKey at all, on a synthetic event or on the one a real ⇧+paste
  // delivers. The modifier now comes from the view, which is where ProseMirror
  // keeps it for its own plain-text-paste branch.
  {
    const { page: pg } = await session(onClose);
    const paste = async (shift, mark) => {
      await caretAtEnd(pg, "rich");
      if (shift) await pg.keyboard.down("Shift");   // a REAL keydown; PM records it
      await pg.evaluate((mark) => {
        const dt = new DataTransfer();
        dt.setData("text/html", `<p><span style="color: rgb(220, 30, 30)">${mark}</span></p>`);
        dt.setData("text/plain", mark);
        document.querySelector(".ProseMirror").dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      }, mark);
      if (shift) await pg.keyboard.up("Shift");
      await until(async () =>
        (await pg.evaluate(() => document.querySelector(".ProseMirror").innerHTML)).includes(mark));
      await pg.waitForTimeout(400);   // the styles land with the node, not after
      const html = await pg.evaluate(() => document.querySelector(".ProseMirror").innerHTML);
      const run = html.match(new RegExp(`<[^>]*>[^<]*${mark}`));
      return /color:\s*rgb\(220,\s*30,\s*30\)/.test(run ? run[0] : "");
    };
    rep.check("paste keeps styles when the preference says so", await paste(false, "PLAINPASTEMARK"));
    rep.check("⇧+paste inverts it and strips them", !(await paste(true, "SHIFTPASTEMARK")));
  }

  // ── A file dropped on a pane must not navigate the app away ─────────────
  {
    const { page: pg } = await session(onClose);
    await pg.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["# dropped"], "dropped.md", { type: "text/markdown" }));
      for (const sel of [".ProseMirror", ".cm-content"]) {
        const el = document.querySelector(sel);
        el.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
        el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      }
    });
    await pg.waitForTimeout(1500);
    rep.check("a file dropped on a pane does not navigate away",
      (await pg.url()).endsWith("/"), await pg.url());
    rep.check("the editor is still mounted after a drop",
      (await pg.locator(".ProseMirror").count()) > 0);
  }

  // ── R1: renaming a heading keeps the links to it working ────────────────
  // The offer is driven by the browser's own caret reports (`selectionchange`,
  // key-up) in whichever pane has the caret — jsdom sees neither a real caret
  // nor the markdown pane's parse tree. Typed a key at a time: while the caret
  // stays in the heading nothing is offered; the arrow key that leaves it is.
  {
    const srv = await serve(APP_DIR);
    const rig = await open(srv.port, {});
    onClose(async () => { await rig.browser.close(); srv.close(); });
    const pg = rig.page;
    await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
    const H = (level, text) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
    const P = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
    await seed(pg, [
      { id: "guide", title: "Guide", canonical: { type: "doc", content: [H(1, "Guide"), H(2, "Setup"), P("setup body"), H(2, "Usage"), P("usage body")] } },
      { id: "notes", title: "Notes", canonical: { type: "doc", content: [H(1, "Notes"), P("See [[Guide#Setup]] and [[Guide#Usage]].")] } },
    ]);
    await boot(pg, srv.port, { mode: "Split", settle: 6000 });
    await openDoc(pg, "Guide");
    const offered = () => pg.evaluate(() =>
      [...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.textContent).join(" | "));
    const update = (heading) => pg.locator("[data-sonner-toast]", { hasText: heading }).locator("button", { hasText: "Update" }).click();
    const notesOnDisk = async () => canonicalText(await storedDoc(pg, "notes"));

    // In the rich pane.
    await pg.locator(".ProseMirror h2", { hasText: "Setup" }).first().click();
    await pg.keyboard.press("End");
    // ProseMirror reads a click's caret from the browser's selectionchange,
    // which arrives asynchronously; a Backspace sent the same millisecond acts
    // on the caret it had before the click.
    await pg.waitForTimeout(250);
    for (let i = 0; i < 5; i++) await pg.keyboard.press("Backspace");
    await pg.keyboard.type("Installation", { delay: 40 });
    await pg.waitForTimeout(2500); // a NEGATIVE assertion: nothing to poll for
    rep.check("R1 no offer while the caret is still in the heading (rich pane)",
      !/renamed/.test(await offered()), await offered());
    await pg.keyboard.press("ArrowDown");
    const richOffer = await until(async () => /update 1 link in 1 note to “Installation”/.test(await offered()));
    rep.check("R1 leaving the heading offers to update the link (rich pane)", richOffer, await offered());
    if (richOffer) await update("Installation");
    rep.check("R1 Update rewrote the other note on disk",
      await until(async () => (await notesOnDisk()).includes("[[Guide#Installation]]")), await notesOnDisk());

    // In the markdown pane — its caret is judged by CodeMirror's parse tree.
    await pg.locator(".cm-line", { hasText: "## Usage" }).first().click();
    await pg.keyboard.press("End");
    await pg.waitForTimeout(250);
    for (let i = 0; i < 5; i++) await pg.keyboard.press("Backspace");
    await pg.keyboard.type("How to use it", { delay: 40 });
    await pg.waitForTimeout(2500);
    rep.check("R1 no offer while the caret is still in the heading (markdown pane)",
      !/“How to use it”/.test(await offered()), await offered());
    await pg.keyboard.press("ArrowDown");
    const mdOffer = await until(async () => /update 1 link in 1 note to “How to use it”/.test(await offered()));
    rep.check("R1 leaving the heading offers to update the link (markdown pane)", mdOffer, await offered());
    if (mdOffer) await update("How to use it");
    rep.check("R1 Update rewrote it too",
      await until(async () => (await notesOnDisk()).includes("[[Guide#How to use it]]")), await notesOnDisk());
  }
});
