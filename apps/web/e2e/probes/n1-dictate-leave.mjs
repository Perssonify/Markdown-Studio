// N1: does leaving a document mid-composition lose the dictated markdown?
// `flushAndCacheIfDirty` reads mdDebounceRef as "a projection is pending", but
// during a composition that ref is pinned non-null by the 120ms retry loop.
import { serve, open, boot, seed, mdText, richText, storedDoc, canonicalText, APP_DIR } from "../lib.mjs";
import { proseDoc } from "../docs.mjs";

const MARK = "ZQDICTATEDQZ";

async function scenario({ leave, commit }) {
  const srv = await serve(APP_DIR);
  const { browser, page: pg, cdp, errors } = await open(srv.port, { cdp: true });
  await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
  await seed(pg, [proseDoc("aaa", "Alpha doc", 1), proseDoc("bbb", "Beta doc", 1)]);
  await boot(pg, srv.port, { mode: "Split", settle: 6000 });

  // Make sure Alpha is the open document.
  await pg.locator('text=Alpha doc').first().click({ timeout: 10000 }).catch(() => {});
  await pg.waitForTimeout(1500);

  await pg.locator(".cm-content").first().click();
  await pg.keyboard.press("Control+End");
  await pg.keyboard.press("Enter");
  await pg.waitForTimeout(200);

  for (const n of [4, 8, MARK.length]) {
    const t = MARK.slice(0, n);
    await cdp.send("Input.imeSetComposition", { text: t, selectionStart: t.length, selectionEnd: t.length });
    await pg.waitForTimeout(60);
  }
  if (commit) { await cdp.send("Input.insertText", { text: MARK }); await pg.waitForTimeout(200); }

  const mdDuring = await mdText(pg);
  const richDuring = await richText(pg);

  await leave(pg);
  await pg.waitForTimeout(2500);

  // Come back to Alpha and read what survived, on screen and on disk.
  await pg.locator('text=Alpha doc').first().click({ timeout: 10000 }).catch(() => {});
  await pg.waitForTimeout(2500);
  const mdAfter = await mdText(pg);
  const richAfter = await richText(pg);
  const disk = canonicalText(await storedDoc(pg, "aaa"));

  await browser.close(); srv.close();
  return {
    duringMd: mdDuring.includes(MARK), duringRich: richDuring.includes(MARK),
    afterMd: mdAfter.includes(MARK), afterRich: richAfter.includes(MARK),
    disk: disk.includes(MARK), errors: errors.slice(0, 2),
  };
}

const leaves = {
  "click another document": async (pg) => {
    await pg.locator('text=Beta doc').first().click({ timeout: 10000 });
  },
  "new document (Ctrl+N, no blur)": async (pg) => {
    await pg.keyboard.press("Control+n");
  },
};

for (const commit of [true, false]) {
  for (const [name, leave] of Object.entries(leaves)) {
    const r = await scenario({ leave, commit });
    console.log(`${commit ? "COMMITTED" : "OPEN     "} composition + ${name}`);
    console.log("   ", JSON.stringify(r));
  }
}
