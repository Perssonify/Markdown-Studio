// The focus ring's colour under forced colours, per engine (A095).
//
// styles.css restates `outline-color: Highlight` for forced colours "for
// engines that pick a different system colour" — but as `:where(…)
// :focus-visible`, specificity (0,1,0), against ring rules of (0,2,0)
// (`:focus-visible:not(…)` and `:is([role=…]):focus-visible`), so it never
// applies. Chromium hides that by forcing outlines to Highlight itself; Firefox
// forces them to CanvasText, and WebKit's emulation forces nothing. This reads
// the ring on a focused button and a focused tree row, then again with the
// restatement written at the ring rules' own specificity.
//
//   E2E_BROWSER=firefox node e2e/probes/forced-colors-ring.mjs   (or webkit, chromium)
import { serve, open, boot, APP_DIR, ENGINE } from "../lib.mjs";

const ROOTS = ":where(.pf-app, .perssonify-editor, [data-base-ui-portal], [data-sonner-toaster], [data-pf-portal])";
const FIX = `@media (forced-colors: active) {
  ${ROOTS} :focus-visible:not(.cm-content, .ProseMirror, [tabindex="-1"]),
  ${ROOTS} :is([role^="menuitem"], [role="option"], [role="treeitem"], [role="tab"]):focus-visible { outline-color: Highlight; }
}`;

const srv = await serve(APP_DIR);
const { browser, page } = await open(srv.port, { viewport: { width: 1280, height: 800 } });
await boot(page, srv.port, { mode: "Split", settle: 5000 });
await page.emulateMedia({ forcedColors: "active" });

// Keyboard focus first: a Tab stop matches :focus-visible on every engine, and a
// programmatic focus() that follows one inherits it (the spec's heuristic,
// which Firefox and WebKit follow; Chromium keys on the last input instead).
const read = async (selector) => {
  await page.keyboard.press("Tab");
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
  el?.focus();
  const probe = document.createElement("div");
  probe.style.backgroundColor = "Highlight";
  document.body.append(probe);
  const hl = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const cs = el ? getComputedStyle(el) : null;
  return { fv: el?.matches(":focus-visible"), style: cs?.outlineStyle, color: cs?.outlineColor, highlight: hl };
  }, selector);
};

const targets = { "toolbar button": '[role="toolbar"] button[tabindex="0"]', "tree row": '[role="tree"] [role="treeitem"][tabindex="0"]' };
for (const [name, sel] of Object.entries(targets)) {
  const r = await read(sel);
  console.log(`${ENGINE} as shipped   ${name}: ${JSON.stringify(r)} -> ${r.color === r.highlight ? "Highlight" : "NOT Highlight"}`);
}
await page.addStyleTag({ content: FIX });
for (const [name, sel] of Object.entries(targets)) {
  const r = await read(sel);
  console.log(`${ENGINE} with the fix ${name}: ${JSON.stringify(r)} -> ${r.color === r.highlight ? "Highlight" : "NOT Highlight"}`);
}
await browser.close();
srv.close();
