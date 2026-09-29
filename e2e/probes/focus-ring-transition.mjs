// Probe (A090): why a focus ring read straight after focus() looks WRONG.
//
// Every variant below — including an injected `outline: 2px solid red` —
// reads back "solid 3px <currentColor> off 0px" when sampled in the same task
// as the focus. None of them is losing the cascade: the generated Button has
// `transition-all`, so outline-width and outline-color ANIMATE in from their
// initial values (medium = 3px, currentColor) and the first frame is what gets
// measured. The surfaces case therefore waits for the transition before it
// reads the ring. Kept as the evidence for that wait.
import { serve, open, boot, APP_DIR } from "../lib.mjs";

const srv = await serve(APP_DIR);
const { browser, page } = await open(srv.port, { viewport: { width: 1280, height: 800 } });
try {
  await boot(page, srv.port, { mode: "Split", settle: 6000 });
  await page.evaluate(() => document.querySelector('[data-slot="mode-switcher-button"]')?.focus());
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => !!document.activeElement?.closest('[role="toolbar"]'))) break;
  }
  const variants = {
    shorthandVar: "[data-probe]:focus-visible{outline:2px solid var(--focus-ring)}",
    shorthandHex: "[data-probe]:focus-visible{outline:2px solid #ff0000}",
    longhands: "[data-probe]:focus-visible{outline-width:2px;outline-style:solid;outline-color:var(--focus-ring)}",
    whereScoped: ":where(.pf-app) :focus-visible{outline:2px solid #00ff00}",
    notList: ":where(.pf-app) :focus-visible:not(:is(.cm-content,.ProseMirror,[tabindex=\"-1\"])){outline:2px solid #0000ff}",
  };
  const out = await page.evaluate((variants) => {
    const b = document.activeElement;
    b.setAttribute("data-probe", "1");
    const read = () => { const cs = getComputedStyle(b); return `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} off ${cs.outlineOffset}`; };
    const res = { base: read(), fv: b.matches(":focus-visible") };
    for (const [name, css] of Object.entries(variants)) {
      const st = document.createElement("style");
      st.textContent = css;
      document.head.append(st);
      res[name] = read();
      st.remove();
    }
    // Is the app's own rule present in a stylesheet the page is using?
    let found = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const r of sheet.cssRules) {
          if (r.cssText && r.cssText.includes("--focus-ring,")) found.push(r.cssText.slice(0, 180));
        }
      } catch { /* cross-origin */ }
    }
    res.appRules = found;
    return res;
  }, variants);
  console.log(JSON.stringify(out, null, 1));
} finally {
  await browser.close();
  srv.close();
}
