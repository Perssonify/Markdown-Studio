// N2: does Ctrl+Z mid-composition strand the deferred projection?
// N3: does a formatting chord dispatch into a composing CodeMirror view and
//     destroy the streamed text?
import { serve, open, boot, seed, mdText, richText, APP_DIR } from "../lib.mjs";
import { proseDoc } from "../docs.mjs";

const MARK = "QQCOMPOSEDQQ";

async function scenario({ pane, chord, label }) {
  const srv = await serve(APP_DIR);
  const { browser, page: pg, cdp, errors } = await open(srv.port, { cdp: true });
  await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
  await seed(pg, [proseDoc("aaa", "Alpha doc", 1)]);
  await boot(pg, srv.port, { mode: "Split", settle: 6000 });

  const sel = pane === "md" ? ".cm-content" : ".ProseMirror";
  await pg.locator(sel).first().click();
  await pg.keyboard.press("Control+End");
  await pg.keyboard.press("Enter");
  await pg.waitForTimeout(300);
  await pg.evaluate(() => { window.__ce = 0; document.addEventListener("compositionend", () => window.__ce++, true); });

  for (const n of [4, 8, MARK.length]) {
    const t = MARK.slice(0, n);
    await cdp.send("Input.imeSetComposition", { text: t, selectionStart: t.length, selectionEnd: t.length });
    await pg.waitForTimeout(60);
  }
  const beforeChordMd = await mdText(pg);

  if (chord) { await pg.keyboard.press(chord); await pg.waitForTimeout(300); }

  // Commit the composition — a real IME always ends eventually. If the chord
  // ALREADY ended it (which is what ending a composition on a formatting
  // command looks like), inserting again would just duplicate the text and say
  // nothing about the app.
  const ended = await pg.evaluate(() => window.__ce > 0);
  if (!ended) await cdp.send("Input.insertText", { text: MARK });
  await pg.waitForTimeout(4000);

  const md = await mdText(pg), rich = await richText(pg);
  await browser.close(); srv.close();
  return {
    label,
    endedByChord: ended,
    textPresentBeforeChord: beforeChordMd.includes(MARK),
    mdKeptText: md.includes(MARK),
    richConverged: rich.includes(MARK),
    duplicated: (md.split(MARK).length - 1) > 1,
    errors: errors.slice(0, 2),
  };
}

const cases = [
  { pane: "md", chord: null, label: "md pane, no chord (control)" },
  { pane: "md", chord: "Control+z", label: "md pane, Ctrl+Z mid-composition (N2)" },
  { pane: "md", chord: "Control+b", label: "md pane, Ctrl+B mid-composition (N3)" },
  { pane: "rich", chord: null, label: "rich pane, no chord (control)" },
  { pane: "rich", chord: "Control+z", label: "rich pane, Ctrl+Z mid-composition" },
  { pane: "rich", chord: "Control+b", label: "rich pane, Ctrl+B mid-composition" },
];
for (const c of cases) console.log(JSON.stringify(await scenario(c)));
