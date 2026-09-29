// Does CDP Input.imeSetComposition produce a REAL composition in each pane?
// Everything downstream depends on this, so prove it before building on it.
import { serve, open, boot, APP_DIR } from "../lib.mjs";

const srv = await serve(APP_DIR);
const { browser, page: pg, cdp } = await open(srv.port, { cdp: true });
await boot(pg, srv.port, { mode: "Split", settle: 6000 });

await pg.evaluate(() => {
  window.__ev = [];
  for (const t of ["compositionstart", "compositionupdate", "compositionend"]) {
    document.addEventListener(t, (e) => {
      const where = e.target.closest?.(".cm-content") ? "md"
        : e.target.closest?.(".ProseMirror") ? "rich"
        : (e.target.className || e.target.nodeName);
      window.__ev.push(`${t}:${where}:${JSON.stringify(e.data)}`);
    }, true);
  }
});

for (const [name, sel] of [["md", ".cm-content"], ["rich", ".ProseMirror"]]) {
  await pg.locator(sel).first().click();
  await pg.keyboard.press("Control+End");
  await pg.keyboard.press("Enter");
  await pg.waitForTimeout(300);
  await pg.evaluate(() => { window.__ev = []; });

  for (const partial of ["di", "dict", "dictated"]) {
    await cdp.send("Input.imeSetComposition", {
      text: partial, selectionStart: partial.length, selectionEnd: partial.length,
    });
    await pg.waitForTimeout(80);
  }
  const midEvents = await pg.evaluate(() => window.__ev.slice());
  const midFlags = await pg.evaluate(() => ({
    pmComposing: !!document.querySelector(".ProseMirror")?.classList.contains("ProseMirror-composition"),
    pmClasses: document.querySelector(".ProseMirror")?.className,
    cmClasses: document.querySelector(".cm-editor")?.className,
  }));
  const mdMid = await pg.evaluate(() => [...(document.querySelectorAll(".cm-line") || [])].map(l => l.textContent).join("\n"));
  const richMid = await pg.evaluate(() => document.querySelector(".ProseMirror")?.textContent);

  await cdp.send("Input.insertText", { text: "dictated" });
  await pg.waitForTimeout(300);
  const endEvents = await pg.evaluate(() => window.__ev.slice());

  console.log(`\n--- ${name} pane ---`);
  console.log("mid-composition events:", midEvents.join(" | ") || "(none)");
  console.log("mid flags:", JSON.stringify(midFlags));
  console.log("md text tail:", JSON.stringify(mdMid.slice(-40)));
  console.log("rich text tail:", JSON.stringify((richMid || "").slice(-40)));
  console.log("after commit, all events:", endEvents.join(" | ") || "(none)");
}

await browser.close(); srv.close();
