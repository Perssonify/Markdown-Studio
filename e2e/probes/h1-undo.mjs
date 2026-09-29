// H1: the selection-freshness fix flushes ProseMirror's DOM observer before
// EVERY Ctrl/Cmd chord — including Ctrl+Z. Does that change what undo reverts?
// Compared against a build with that one line removed.
import { serve, open, boot, seed, mdText, richText } from "../lib.mjs";
import { proseDoc } from "../docs.mjs";

const SENT = "Undo boundary sentence one. ";

async function trial(dir, { pane, gap, undos }) {
  const srv = await serve(dir);
  const { browser, page: pg, errors } = await open(srv.port);
  await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
  await seed(pg, [proseDoc("aaa", "Alpha doc", 1)]);
  await boot(pg, srv.port, { mode: "Split", settle: 6000 });

  const sel = pane === "md" ? ".cm-content" : ".ProseMirror";
  await pg.locator(sel).first().click();
  await pg.keyboard.press("Control+End");
  await pg.keyboard.press("Enter");
  await pg.waitForTimeout(400);
  const baseline = pane === "md" ? await mdText(pg) : await richText(pg);

  await pg.keyboard.type(SENT, { delay: 15 });
  await pg.waitForTimeout(gap);
  for (let i = 0; i < undos; i++) { await pg.keyboard.press("Control+z"); await pg.waitForTimeout(150); }
  await pg.waitForTimeout(1200);

  const md = await mdText(pg), rich = await richText(pg);
  const text = pane === "md" ? md : rich;
  await browser.close(); srv.close();
  return {
    // How much of the typed sentence survived the undo, as a fraction.
    remaining: (() => {
      const extra = text.length - baseline.length;
      return Math.max(0, Math.min(1, extra / SENT.length));
    })(),
    fullyUndone: !text.includes(SENT.trim().slice(0, 12)),
    panesAgree: md.includes(SENT.trim().slice(0, 12)) === rich.includes(SENT.trim().slice(0, 12)),
    errors: errors.slice(0, 1),
  };
}

const grid = [];
for (const pane of ["rich", "md"]) {
  for (const gap of [0, 10, 50, 200]) {
    for (const undos of [1]) grid.push({ pane, gap, undos });
  }
}
for (const g of grid) {
  const withFlush = await trial("/tmp/dist-flush", g);
  const without = await trial("/tmp/dist-noflush", g);
  const same = withFlush.fullyUndone === without.fullyUndone &&
    Math.abs(withFlush.remaining - without.remaining) < 0.1;
  console.log(
    `${g.pane.padEnd(4)} gap=${String(g.gap).padStart(3)}ms  ` +
    `flush:${JSON.stringify(withFlush)}  noflush:${JSON.stringify(without)}  ${same ? "SAME" : "*** DIFFERENT ***"}`
  );
}
