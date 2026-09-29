// Which way of reading the markdown pane is CORRECT?
//
// The scroll-accumulate reader keys lines by `offsetTop`. If offsetTop is
// measured against a NON-scrolling ancestor it shifts as the pane scrolls, and
// the same line is recorded under several keys — the stress tier reported
// "300/60 tokens" for a 60-token run. CodeMirror also holds the exact text in
// its own state, which needs no scrolling at all.
import { serve, open, boot, seed, ROOT, APP_DIR } from "../lib.mjs";
import { proseDoc } from "../docs.mjs";

const srv = await serve(APP_DIR);
const { browser, page: pg } = await open(srv.port);
await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
await seed(pg, [proseDoc("p1", "Probe doc", 40)]);
await boot(pg, srv.port, { mode: "Split", settle: 8000 });
await pg.locator("text=Probe doc").first().click({ timeout: 15000 }).catch(() => {});
await pg.waitForTimeout(3000);

// A run of repeated tokens, exactly like the stress case.
await pg.locator(".cm-content").first().click();
await pg.keyboard.press("Control+End");
await pg.keyboard.press("Enter");
await pg.keyboard.type("PROBERUN ".repeat(30), { delay: 4 });
await pg.waitForTimeout(2500);

const out = await pg.evaluate(async () => {
  const content = document.querySelector(".cm-content");
  const scroller = document.querySelector(".cm-scroller");
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const cmView = content?.cmView?.view ?? null;
  const fromState = cmView ? cmView.state.doc.toString() : null;

  const gather = async (key) => {
    const prev = scroller.scrollTop;
    const seen = new Map();
    const step = Math.max(1, scroller.clientHeight - 40);
    for (let y = 0; y <= scroller.scrollHeight; y += step) {
      scroller.scrollTop = y;
      await frame();
      for (const el of content.querySelectorAll(".cm-line")) seen.set(key(el), el.textContent);
    }
    scroller.scrollTop = prev;
    await frame();
    return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t).join("\n");
  };

  // Per-pass diagnostics: where does the duplication actually come from?
  const diag = await (async () => {
    const prev = scroller.scrollTop;
    const step = Math.max(1, scroller.clientHeight - 40);
    const rows = [];
    for (let y = 0; y <= scroller.scrollHeight; y += step) {
      scroller.scrollTop = y;
      await frame();
      const els = [...content.querySelectorAll(".cm-line")];
      const hits = els.filter((e) => e.textContent.includes("PROBERUN"));
      rows.push({
        y,
        top: scroller.scrollTop,
        lines: els.length,
        children: content.children.length,
        kinds: [...new Set([...content.children].map((c) => c.className))].join(","),
        runLines: hits.length,
        runOffsets: hits.map((e) => e.offsetTop),
      });
    }
    scroller.scrollTop = prev;
    await frame();
    return rows;
  })();

  const byOffsetTop = await gather((el) => el.offsetTop);
  const byAbsolute = await gather((el) => scroller.scrollTop + el.offsetTop);

  // The overlap stitch: no positional key at all.
  const stitched = await (async () => {
    const prev = scroller.scrollTop;
    const step = Math.max(1, scroller.clientHeight - 40);
    const passes = [];
    for (let y = 0; y <= scroller.scrollHeight; y += step) {
      scroller.scrollTop = y;
      await frame();
      passes.push([...content.querySelectorAll(".cm-line")].map((l) => l.textContent));
    }
    scroller.scrollTop = prev;
    await frame();
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    const join = (a, b) => {
      for (let k = Math.min(a.length, b.length); k > 0; k--) {
        if (same(a.slice(a.length - k), b.slice(0, k))) return a.concat(b.slice(k));
      }
      return a.concat(b);
    };
    return passes.reduce((acc, p) => (acc.length ? join(acc, p) : p), []).join("\n");
  })();

  const visibleOnly = [...content.querySelectorAll(".cm-line")].map((l) => l.textContent).join("\n");
  const count = (s) => (s ? s.split("PROBERUN").length - 1 : -1);
  return {
    hasCmView: !!cmView,
    offsetParent: content.offsetParent?.className ?? "(none)",
    expected: 30,
    fromState: count(fromState),
    byOffsetTop: count(byOffsetTop),
    byAbsolute: count(byAbsolute),
    stitched: count(stitched),
    visibleOnly: count(visibleOnly),
    stitchedChars: stitched.length,
    visibleChars: visibleOnly.length,
    diag,
    stateChars: fromState?.length ?? -1,
    offsetTopChars: byOffsetTop.length,
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
srv.close();
