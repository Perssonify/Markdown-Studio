// The Content-Security-Policy in vercel.json, ENFORCED.
//
// vercel.json ships the policy as Content-Security-Policy-Report-Only first, so a
// mistake costs a console line instead of a broken app. "Report-only" is only
// safe to promote if the app does nothing the policy forbids, and a unit test
// can only read the policy, not run the app under it. This case serves the
// production build with vercel.json's headers — the report-only policy switched
// to ENFORCING — and drives every renderer and lazy surface that loads code or
// styles its own way (KaTeX, Mermaid, abcjs, a data: image, Find, the map,
// Cards, Word export, the Help page), collecting every
// `securitypolicyviolation`. Any violation, or any console error, fails the run.
//
// Not driven here: decrypting a password-protected ZIP (zip.js's WebAssembly +
// worker path, which is why the policy allows 'wasm-unsafe-eval' and blob:/data:
// workers).
import fs from "node:fs";
import path from "node:path";
import { serve, open, boot, runCase, until, APP_DIR, ROOT } from "../lib.mjs";
import { PROBE_MD, allRendered, exportWord, openLazySurfaces, pasteMarkdown, renderers } from "../renderers.mjs";

const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));

/** vercel.json's headers for a path, with the report-only policy ENFORCED. */
function headersFor(urlPath) {
  const out = {};
  for (const rule of vercel.headers) {
    if (!new RegExp(`^${rule.source}$`).test(urlPath)) continue;
    for (const { key, value } of rule.headers) {
      if (key === "Content-Security-Policy") continue; // frame-ancestors only; the full policy below carries it
      out[key === "Content-Security-Policy-Report-Only" ? "Content-Security-Policy" : key] = value;
    }
  }
  return out;
}

runCase("csp", async (rep, onClose) => {
  const srv = await serve(APP_DIR, {}, { headers: headersFor });
  const { browser, page: pg } = await open(srv.port, { label: "csp enforced" });
  onClose(async () => { await browser.close(); srv.close(); });

  // Every violation, whether or not it also reached the console. Collected per
  // page (the init script runs again on each navigation), so read before leaving.
  await pg.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__csp.push(`${e.effectiveDirective} ← ${e.blockedURI || "(inline)"} ${e.sample ? JSON.stringify(e.sample.slice(0, 60)) : ""}`);
    });
  });
  const violations = [];
  const collect = async () => violations.push(...(await pg.evaluate(() => window.__csp || [])));

  // Sanity: the policy really is enforced on this server.
  const res = await fetch(`http://127.0.0.1:${srv.port}/`);
  const enforced = res.headers.get("content-security-policy") || "";
  rep.check("the app is served with the vercel.json policy ENFORCED",
    /script-src 'self'/.test(enforced) && /frame-ancestors 'none'/.test(enforced), enforced.slice(0, 120));

  await boot(pg, srv.port, { mode: "Split", settle: 6000 });
  rep.check("the app boots under the enforced policy", (await pg.locator(".ProseMirror").count()) > 0);

  await pasteMarkdown(pg, PROBE_MD);
  rep.check("KaTeX, Mermaid (dagre and ELK layouts), abcjs and a data: image all render",
    await until(async () => allRendered(await renderers(pg)), { timeout: 30000 }),
    JSON.stringify(await renderers(pg)));

  // An image stored as an asset (A086): the document holds `pf-asset:<hash>`,
  // a scheme img-src does not allow, so the editor must only ever show it
  // through an object URL (blob:, which it does allow) — any <img> handed the
  // reference itself is a violation, even one never attached to the page.
  await pg.locator(".ProseMirror").first().click();
  await pg.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 40; c.height = 30;
    c.getContext("2d").fillRect(0, 0, 40, 30);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "shot.png", { type: "image/png" }));
    document.querySelector(".ProseMirror").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  rep.check("a pasted image stored as an asset renders (through blob:)",
    await until(() => pg.evaluate(() => [...document.querySelectorAll(".ProseMirror img")]
      .some((i) => i.src.startsWith("blob:") && i.naturalWidth === 40)), { timeout: 15000 }));

  const lazy = await openLazySurfaces(pg, until);
  rep.check("Find & Replace, the map and Cards (lazy chunks) all open", lazy.find && lazy.map && lazy.cards, JSON.stringify(lazy));

  const docx = await exportWord(pg).catch(() => null);
  rep.check("Word export (lazy docx) downloads a file", !!docx && docx.endsWith(".docx"), String(docx));
  await collect();

  await pg.goto(`http://127.0.0.1:${srv.port}/help`, { waitUntil: "networkidle" });
  rep.check("the Help page (lazy) renders", await until(async () => (await pg.locator("text=Sharing & embedding").count()) > 0));
  await collect();

  rep.check("ZERO Content-Security-Policy violations", violations.length === 0, violations.join(" | "));
});
