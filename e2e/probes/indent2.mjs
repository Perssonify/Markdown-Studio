// Isolate: is rich-pane Indent broken in the COMMAND, or in the path to it?
import { serve, open, boot, APP_DIR } from "../lib.mjs";

const srv = await serve(APP_DIR);
const { browser, page: pg, errors } = await open(srv.port);
await boot(pg, srv.port, { mode: "Split", settle: 7000 });

await pg.locator(".cm-content").first().click();
await pg.keyboard.press("Control+a");
await pg.keyboard.type("- alpha\n- bravo\n- charlie\n", { delay: 2 });
await pg.waitForTimeout(3000);

const out = await pg.evaluate(() => {
  // Reach the live editor the way the app's own node views do.
  const dom = document.querySelector(".ProseMirror");
  const view = dom.pmViewDesc?.view ?? null;
  if (!view) return { error: "no pm view handle on the DOM" };

  // Put the caret inside "bravo".
  const { state } = view;
  let pos = null;
  state.doc.descendants((node, p) => {
    if (node.isText && node.text.includes("bravo") && pos === null) pos = p + 2;
  });
  if (pos === null) return { error: "bravo not found" };
  view.dispatch(state.tr.setSelection(window.__PMTextSelection
    ? window.__PMTextSelection.create(state.doc, pos)
    : state.selection.constructor.near(state.doc.resolve(pos))));

  const s = view.state.selection;
  const names = [];
  for (let d = s.$from.depth; d >= 0; d--) names.push(s.$from.node(d).type.name);
  return { depthChain: names, listItemNames: Object.keys(view.state.schema.nodes) };
});
console.log("selection context:", JSON.stringify(out, null, 2));

await browser.close();
srv.close();
