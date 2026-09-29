// The harness checking ITSELF.
//
// Two of this campaign's readers have been wrong, and a wrong reader is worse
// than a missing case: it produces a number that looks like an answer. `mdText`
// first read only CodeMirror's rendered viewport (969 characters of a 60 KB
// document), and then, once it scrolled, recorded the same line a dozen times
// because CodeMirror refines its height estimates as they scroll past — a
// 30-token run came back as 360.
//
// So the reader is measured against a document whose every line is known
// (`LINE0001` …). "Did it recover the whole document, exactly once each" is
// then decidable, which is the only way the tiers above it mean anything.
import { serve, open, boot, seed, mdText, richText, runCase, APP_DIR } from "../lib.mjs";
import { numberedDoc } from "../docs.mjs";

const LINES = 400;

runCase("harness", async (rep, onClose) => {
  const srv = await serve(APP_DIR);
  const { browser, page: pg } = await open(srv.port, { label: "harness" });
  onClose(async () => { await browser.close(); srv.close(); });
  await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
  await seed(pg, [numberedDoc("h1", "Numbered doc", LINES)]);
  await boot(pg, srv.port, { mode: "Split", settle: 9000 });
  await pg.locator("text=Numbered doc").first().click({ timeout: 15000 }).catch(() => {});
  await pg.waitForTimeout(3000);

  const tag = (i) => `LINE${String(i).padStart(4, "0")}`;
  const counts = (text) => {
    const missing = [], duplicated = [];
    for (let i = 1; i <= LINES; i++) {
      const n = text.split(tag(i)).length - 1;
      if (n === 0) missing.push(tag(i));
      else if (n > 1) duplicated.push(`${tag(i)}×${n}`);
    }
    return { missing, duplicated };
  };

  // ── the markdown pane, which virtualises ────────────────────────────────
  const md = await mdText(pg);
  const m = counts(md);
  rep.note(`markdown pane: ${md.length} characters read`);
  rep.check(`mdText recovers all ${LINES} lines`, m.missing.length === 0,
    `${m.missing.length} missing, first: ${m.missing.slice(0, 5).join(", ")}`);
  rep.check("mdText recovers each line exactly ONCE", m.duplicated.length === 0,
    `${m.duplicated.length} duplicated, first: ${m.duplicated.slice(0, 5).join(", ")}`);
  rep.check("mdText keeps the lines in document order",
    md.indexOf(tag(1)) < md.indexOf(tag(LINES / 2)) && md.indexOf(tag(LINES / 2)) < md.indexOf(tag(LINES)));

  // ── and again with the caret at the TOP ─────────────────────────────────
  // CodeMirror force-renders the line holding the selection at every scroll
  // position; with the caret at the end that line is the one most likely to be
  // double-counted, so read it from both ends.
  await pg.locator(".cm-content").first().click();
  await pg.keyboard.press("Control+Home");
  await pg.waitForTimeout(500);
  const md2 = counts(await mdText(pg));
  rep.check("mdText is not disturbed by where the caret is",
    md2.missing.length === 0 && md2.duplicated.length === 0,
    `${md2.missing.length} missing / ${md2.duplicated.length} duplicated`);

  // ── the rich pane, which does not ───────────────────────────────────────
  const r = counts(await richText(pg));
  rep.check(`richText recovers all ${LINES} lines`, r.missing.length === 0,
    `${r.missing.length} missing`);
  rep.check("richText recovers each line exactly ONCE", r.duplicated.length === 0,
    `${r.duplicated.length} duplicated`);

  // ── a very long WRAPPED line ────────────────────────────────────────────
  // The shape that broke the first two readers and that the numbered document
  // above does NOT contain: one logical line, hundreds of characters, wrapped
  // over many visual rows at the end of a document whose heights CodeMirror has
  // only estimated. Its offsetTop moved by thousands of pixels across a sweep,
  // and it was recorded five times — the stress tier reported a 60-token run as
  // 300 tokens. A self-test that only holds for uniform short lines is not a
  // self-test.
  {
    await pg.locator(".cm-content").first().click();
    await pg.keyboard.press("Control+End");
    await pg.keyboard.press("Enter");
    await pg.keyboard.type("WRAPRUN ".repeat(60), { delay: 4 });
    await pg.waitForTimeout(3000);

    const md = await mdText(pg);
    const copies = md.split("WRAPRUN").length - 1;
    rep.check("mdText reads a long wrapped line exactly once", copies === 60, `${copies}/60 tokens`);

    // And from the top, where CodeMirror's estimates for everything below are
    // at their worst.
    await pg.keyboard.press("Control+Home");
    await pg.waitForTimeout(500);
    const md2 = await mdText(pg);
    rep.check("…including when the caret is at the other end of the document",
      md2.split("WRAPRUN").length - 1 === 60, `${md2.split("WRAPRUN").length - 1}/60 tokens`);

    const after = counts(md);
    rep.check("and the numbered lines are still each read once",
      after.missing.length === 0 && after.duplicated.length === 0,
      `${after.missing.length} missing / ${after.duplicated.length} duplicated`);

    // HONEST LIMIT: these cases hold the reader's de-duplication TOLERANCE but
    // not its warm-up sweep — measured, they pass with the warm-up removed,
    // while the stress tier's sustained-typing case fails immediately (a
    // 60-token run read as 300). The shape that needs the warm-up is a smaller
    // document typed into while the reader is polling, which is stress's, not
    // this fixture's. Do not read a green run here as "the reader is fully
    // covered"; run `bun run e2e:stress` too when you change it.
  }

  // ── the reader must not change the document ─────────────────────────────
  // It scrolls the pane twice. If that ever became an edit, every case built on
  // it would be measuring its own side effects.
  const before = await pg.evaluate(() => document.querySelector(".cm-content")?.textContent?.length ?? 0);
  await mdText(pg);
  await mdText(pg);
  const after = await pg.evaluate(() => document.querySelector(".cm-content")?.textContent?.length ?? 0);
  rep.check("reading the markdown pane does not edit it", Math.abs(after - before) < 200,
    `${before} → ${after} rendered characters`);

  const again = counts(await mdText(pg));
  rep.check("repeated reads agree", again.missing.length === 0 && again.duplicated.length === 0,
    `${again.missing.length} missing / ${again.duplicated.length} duplicated`);
});
