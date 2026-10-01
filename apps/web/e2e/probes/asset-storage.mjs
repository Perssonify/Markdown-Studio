// A086 measurement: what storing images as assets saves, in a real browser.
//
// The same five ~1 MB PNGs (canvas noise — incompressible, like photos), once
// INLINE as data: URLs (how every image was stored before, and how an old
// document still is) and once as ASSETS (pasted as files). For each document:
// the stored record's size, the markdown pane's length, the cost of the
// serialisation every save pays, and the time a real ⌘S takes to reach
// "Saved". Measurement only — nothing here is asserted.
//
//   bun run build:app && node e2e/probes/asset-storage.mjs
import { serve, open, boot, seed, storedDoc, APP_DIR, BLANK_PATH } from "../lib.mjs";

const RUNS = 7;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const mb = (n) => (n < 100 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);

const srv = await serve(APP_DIR);
const { browser, page: pg } = await open(srv.port, { label: "asset-storage" });
await pg.goto(`http://127.0.0.1:${srv.port}${BLANK_PATH}`);

// Five 512×512 noise PNGs (≈1 MB each), as data URLs.
const images = await pg.evaluate(async () => {
  const out = [];
  for (let k = 0; k < 5; k++) {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 512;
    const x = c.getContext("2d");
    const img = x.createImageData(512, 512);
    for (let i = 0; i < img.data.length; i++) img.data[i] = (i % 4 === 3) ? 255 : (Math.random() * 256) | 0;
    x.putImageData(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    out.push({ url, bytes: blob.size });
  }
  return out;
});
console.log(`images: ${images.map((i) => kb(i.bytes)).join(", ")} (data: URLs ${images.map((i) => kb(i.url.length)).join(", ")})`);

const para = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
const withImages = (srcs) => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Photos" }] },
    ...srcs.flatMap((src, i) => [para(`Photo ${i + 1}`), { type: "paragraph", content: [{ type: "image", attrs: { src, alt: `p${i}` } }] }]),
  ],
});
await seed(pg, [
  { id: "inline", title: "Inline photos", canonical: withImages(images.map((i) => i.url)) },
  { id: "assets", title: "Asset photos", canonical: { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Photos" }] }] } },
]);
await boot(pg, srv.port, { mode: "Split", settle: 8000 });

async function openDoc(title) {
  const panelOpen = () => pg.evaluate(() => !!document.querySelector('button[aria-label="Close workspace panel"]'));
  if (!(await panelOpen())) { await pg.keyboard.press("Control+Shift+D"); await pg.waitForTimeout(500); }
  await pg.locator(`button:has-text("${title}")`).first().click();
  await pg.waitForTimeout(4000);
}

/** One ⌘S from a fresh edit to "Saved", timed in the page. */
async function timedSave() {
  await pg.locator(".ProseMirror").first().click();
  await pg.keyboard.press("Control+End");
  await pg.keyboard.type("x");
  await pg.waitForTimeout(600); // let the projection run, so only the save is timed
  return pg.evaluate(() => new Promise((resolve) => {
    const footer = document.querySelector("footer");
    const t0 = performance.now();
    const obs = new MutationObserver(() => {
      if (/Changes saved/i.test(footer.innerText)) { obs.disconnect(); resolve(performance.now() - t0); }
    });
    obs.observe(footer, { subtree: true, childList: true, characterData: true });
    document.querySelector(".ProseMirror").dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true }));
    setTimeout(() => { obs.disconnect(); resolve(NaN); }, 20000);
  }));
}

async function measure(label, id) {
  const rec = await pg.evaluate((id) => new Promise((res) => {
    const r = indexedDB.open("perssonify-docs");
    r.onsuccess = () => { const q = r.result.transaction("documents").objectStore("documents").get(id); q.onsuccess = () => { res(q.result?.length ?? 0); r.result.close(); }; };
  }), id);
  const md = await pg.evaluate(() => document.querySelector(".cm-content")?.cmTile?.root?.view?.state.doc.length ?? -1);
  const ser = await pg.evaluate(() => {
    const ed = document.querySelector(".ProseMirror").editor;
    const med = (f) => {
      const times = [];
      let out;
      for (let i = 0; i < 7; i++) {
        const t0 = performance.now();
        out = f();
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      return { out, ms: times[3] };
    };
    const json = med(() => JSON.stringify(ed.getJSON()).length);
    // What every rich→markdown projection serialises before turndown runs.
    const html = med(() => ed.getHTML().length);
    return { len: json.out, ms: json.ms, htmlLen: html.out, htmlMs: html.ms };
  });
  const saves = [];
  for (let i = 0; i < RUNS; i++) saves.push(await timedSave());
  const assets = await pg.evaluate(async () => {
    // Opening a database that does not exist yet would CREATE it — empty, at
    // version 1 — and the app's own open would then find no object stores.
    if (!(await indexedDB.databases()).some((d) => d.name === "perssonify-assets")) return { count: 0, bytes: 0 };
    return new Promise((res) => {
    const r = indexedDB.open("perssonify-assets");
    r.onsuccess = () => {
      if (!r.result.objectStoreNames.contains("meta")) { res({ count: 0, bytes: 0 }); return; }
      const q = r.result.transaction("meta").objectStore("meta").getAll();
      q.onsuccess = () => { res({ count: q.result.length, bytes: q.result.reduce((n, a) => n + a.size, 0) }); r.result.close(); };
    };
    r.onerror = () => res({ count: 0, bytes: 0 });
    });
  });
  console.log(`\n${label}`);
  console.log(`  stored document record   ${mb(rec)}`);
  console.log(`  asset database           ${assets.count} images, ${mb(assets.bytes)}`);
  console.log(`  markdown pane length     ${md.toLocaleString()} characters`);
  console.log(`  getJSON + stringify      ${ser.ms.toFixed(1)} ms for ${mb(ser.len)} (median of 7)`);
  console.log(`  getHTML (per projection) ${ser.htmlMs.toFixed(1)} ms for ${mb(ser.htmlLen)} (median of 7)`);
  console.log(`  fits the 2 MB crash stash ${ser.len <= 2 * 1024 * 1024 ? "yes" : "NO — unsaved edits are not stashed on unload"}`);
  console.log(`  one snapshot's budget     ${mb(ser.len * 2)} of version history's 12 MB ring`);
  console.log(`  ⌘S → "Saved"             ${median(saves).toFixed(0)} ms median (runs: ${saves.map((s) => s.toFixed(0)).join(", ")})`);
}

await openDoc("Inline photos");
await measure("BEFORE — five images inline as data: URLs", "inline");

// The same five pictures pasted as files into the other document.
await openDoc("Asset photos");
await pg.locator(".ProseMirror").first().click();
await pg.keyboard.press("Control+End");
await pg.evaluate(async (urls) => {
  const dt = new DataTransfer();
  for (const [i, u] of urls.entries()) {
    const blob = await (await fetch(u)).blob();
    dt.items.add(new File([blob], `photo-${i + 1}.png`, { type: "image/png" }));
  }
  document.querySelector(".ProseMirror").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, images.map((i) => i.url));
let refs = 0;
for (let t = 0; t < 60; t++) {
  const d = await storedDoc(pg, "assets");
  refs = d ? (JSON.stringify(d.canonical).match(/pf-asset:/g) || []).length : 0;
  if (refs >= 5) break;
  await pg.waitForTimeout(500);
}
console.log(`\n(the asset document holds ${refs} references on disk; editor title: ${await pg.evaluate(() => document.querySelector(".ProseMirror h1")?.textContent)})`);
await measure("AFTER — the same five images as assets", "assets");

const est = await pg.evaluate(async () => (await navigator.storage.estimate()).usage);
console.log(`\norigin usage (navigator.storage.estimate, both documents + assets + history): ${mb(est)}`);
await browser.close();
srv.close();
