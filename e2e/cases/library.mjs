// The published LIBRARY, on a page that is not ours.
//
// `dist/` ships a stylesheet a consumer imports into an app that already has
// styles, and the claim in CLAUDE.md is that doing so does not restyle their
// page. `scope-css.test.js` pins the TRANSFORM — the base layer wrapped in
// `:where(.pf-app, …)`, the design tokens defined on the editor's roots instead
// of `:root`, page-level rules confined to `.pf-app`. This loads the BUILT file
// into a real host document and measures it, which is the claim a consumer
// actually cares about, and the one that breaks if the build wiring is ever
// changed (the scope step, `scopeLibraryStylesheet`, is wired into
// `vite.config.ts` ONLY, so a copy-paste into another config or a refactor of
// the plugin list silently un-scopes the published CSS).
import fs from "node:fs";
import path from "node:path";
import { serve, open, runCase, ROOT } from "../lib.mjs";

const DIST = process.env.E2E_DIST_DIR || path.join(ROOT, "dist");
const FIXTURES = path.join(ROOT, "e2e", "fixtures");

/** Properties a global reset moves. Everything here is measured, not declared. */
const RESET_SENSITIVE = [
  "font-size", "font-weight", "margin-block-start",
  "padding-inline-start", "text-decoration-line", "box-sizing",
  "border-top-style", "list-style-type", "font-family",
];

runCase("library", async (rep, onClose) => {
  if (!fs.existsSync(path.join(DIST, "styles.css"))) {
    rep.note("dist/styles.css not built — library checks skipped (run `bun run build`)");
    return;
  }

  // Serve the fixture and the built stylesheet from one origin, the way a
  // consumer's bundler would place them.
  const dir = fs.mkdtempSync(path.join(ROOT, ".e2e-host-"));
  onClose(async () => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(path.join(FIXTURES, "host-page.html"), path.join(dir, "index.html"));
  fs.copyFileSync(path.join(DIST, "styles.css"), path.join(dir, "styles.css"));

  const srv = await serve(dir);
  const { browser, page: pg } = await open(srv.port);
  onClose(async () => { await browser.close(); srv.close(); });
  await pg.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "networkidle" });

  const before = await pg.evaluate(() => window.__before);
  const after = await pg.evaluate(() => window.__loadEditorCss());

  // ── the host's own page must not move ───────────────────────────────────
  const HOST = ["host-h1", "host-p", "host-a", "host-ul", "host-li", "host-btn", "host-table"];
  const moved = [];
  for (const id of HOST) {
    for (const prop of RESET_SENSITIVE) {
      if (before[id][prop] !== after[id][prop]) {
        moved.push(`${id}.${prop}: ${before[id][prop]} → ${after[id][prop]}`);
      }
    }
  }
  rep.check("the published stylesheet does not restyle the host page", moved.length === 0, moved.join(" | "));

  // Spelled out for the four that a reader would check by eye, so a failure
  // names the symptom rather than a diff.
  rep.check("host heading keeps its size and weight",
    after["host-h1"]["font-size"] === "32px" && after["host-h1"]["font-weight"] === "700",
    JSON.stringify(after["host-h1"]));
  rep.check("host links keep their underline",
    after["host-a"]["text-decoration-line"] === "underline", after["host-a"]["text-decoration-line"]);
  rep.check("host list keeps its indent and bullet",
    after["host-ul"]["padding-inline-start"] !== "0px" && after["host-ul"]["list-style-type"] === "disc",
    JSON.stringify(after["host-ul"]));
  // Not an absolute value: a <button>'s UA style is already border-box with a
  // border, so "content-box and no border" was never true of it. What matters is
  // that the stylesheet did not CHANGE it — preflight sets `box-sizing:
  // border-box` and `border-style: solid` on every element, which is exactly
  // what would show up here.
  rep.check("host elements keep the box model they had",
    before["host-btn"]["box-sizing"] === after["host-btn"]["box-sizing"] &&
      before["host-p"]["box-sizing"] === after["host-p"]["box-sizing"] &&
      before["host-p"]["border-top-style"] === after["host-p"]["border-top-style"],
    JSON.stringify({ before: before["host-p"], after: after["host-p"] }));
  rep.check("the host's body margin survives",
    after.body.margin === before.body.margin, `${before.body.margin} → ${after.body.margin}`);

  // ── and it must still reach OUR subtree ─────────────────────────────────
  // Scoping that reached nothing would pass every assertion above while
  // shipping an unstyled editor.
  const reached = [];
  for (const id of ["pf-h1", "pf-ul", "pf-li", "pf-a"]) {
    for (const prop of RESET_SENSITIVE) {
      if (before[id][prop] !== after[id][prop]) reached.push(`${id}.${prop}`);
    }
  }
  rep.check("the reset still applies inside .pf-app", reached.length > 0,
    "nothing inside .pf-app changed — the base layer may have been dropped rather than scoped");
  rep.note(`inside .pf-app: ${reached.length} reset property changes`);

  // ── the design tokens ───────────────────────────────────────────────────
  // They used to be written on :root and .dark — the names a shadcn/Tailwind
  // host uses for its own design system — so importing the stylesheet
  // recoloured the host page. They are now DEFINED on the editor's roots
  // (build/scope-css.mjs), and the host's are left alone.
  rep.check("the host's own tokens on :root / .dark are not overwritten",
    JSON.stringify(after.tokens.root) === JSON.stringify(before.tokens.root),
    `${JSON.stringify(before.tokens.root)} → ${JSON.stringify(after.tokens.root)}`);
  rep.check("the host page keeps its scrollbar",
    after.htmlScrollbar === before.htmlScrollbar, `${before.htmlScrollbar} → ${after.htmlScrollbar}`);

  // …while everything of ours still resolves them. The editor inside the
  // integration wrapper must get the EDITOR's radius and background (not the
  // host's 3px / rgb), and still the wrapper's inline accent: a nested root
  // re-declaring the defaults would swallow `accentColor`.
  const { editor, menu, root } = after.tokens;
  rep.check("the editor subtree resolves the editor's tokens, not the host's",
    editor["--radius"] !== "" && editor["--radius"] !== root["--radius"] &&
      editor["--background"] !== "" && editor["--background"] !== root["--background"],
    JSON.stringify({ editor, root }));
  rep.check("the integration wrapper's inline accent still reaches the editor",
    editor["--primary"] === "rgb(11, 22, 33)", JSON.stringify(editor));
  // Portalled menus, dialogs and toasts render on <body>, outside every editor
  // container. They are roots too — if they lost the tokens, every one of them
  // would render unthemed.
  rep.check("a portalled surface outside the editor still resolves the tokens",
    menu["--border"] !== "" && menu["--background"] !== "" && menu["--background"] !== root["--background"],
    JSON.stringify(menu));
  // The fixture's host is `<html class="dark">` and the wrapper is
  // `data-theme="light"`: the editor must follow its own wrapper (light), the
  // portal the only switch it has (the host's dark). Equal backgrounds would
  // mean an ancestor's switch beat the closer one.
  rep.check("the theme switch closest to the editor wins",
    editor["--background"] !== menu["--background"],
    JSON.stringify({ editor: editor["--background"], menu: menu["--background"] }));
});
