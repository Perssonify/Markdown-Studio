// Shared rig for the browser campaign: a static server over a built bundle, a
// Chromium page with the knobs the cases need (CPU throttling, touch, CDP), and
// helpers for seeding documents, driving real IME composition, and reporting.
//
// Deliberately dependency-light: `playwright-core` plus node built-ins, no test
// runner. CI installs one Chromium and runs `bun run e2e:smoke`.
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const APP_DIR = process.env.E2E_APP_DIR || path.join(ROOT, "dist-app");
export const EMBED_DIR = process.env.E2E_EMBED_DIR || path.join(ROOT, "dist-embed");

/**
 * Where Chromium lives. `playwright install chromium` (CI) puts it where
 * playwright-core can find it itself; this sandbox pre-installs it under
 * /opt/pw-browsers. Try the library first, then the env var, then a scan.
 */
export function chromePath() {
  if (process.env.E2E_CHROME) return process.env.E2E_CHROME;
  try {
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch { /* not installed through playwright-core's own store */ }
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base).sort().reverse()) {
      if (!d.startsWith("chromium-")) continue;
      const p = path.join(base, d, "chrome-linux", "chrome");
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error("No Chromium found. Run `bunx playwright-core install chromium` or set E2E_CHROME.");
}

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".map": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2",
  ".woff": "font/woff", ".ttf": "font/ttf", ".txt": "text/plain",
  ".webmanifest": "application/manifest+json",
};

/**
 * Static server with SPA fallback. `extra` maps URL prefixes to other dirs.
 * `opts.headers(path)` adds response headers per request path (the CSP case
 * replays vercel.json's), and `opts.transform(path, buffer)` may rewrite a
 * file's bytes (the update case serves a "new" sw.js).
 */
export async function serve(dir, extra = {}, opts = {}) {
  const srv = http.createServer((q, r) => {
    const url = decodeURIComponent(q.url.split("?")[0]);
    let root = dir, rel = url;
    for (const [prefix, d] of Object.entries(extra)) {
      if (url === prefix || url.startsWith(prefix + "/")) {
        root = d; rel = url.slice(prefix.length) || "/"; break;
      }
    }
    let p = path.join(root, rel);
    if (!p.startsWith(root)) { r.writeHead(403).end(); return; }
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(root, "index.html");
    if (!fs.existsSync(p)) { r.writeHead(404).end(); return; }
    const head = { "content-type": MIME[path.extname(p)] || "application/octet-stream", ...(opts.headers ? opts.headers(url) : {}) };
    if (opts.transform) {
      r.writeHead(200, head);
      r.end(opts.transform(url, fs.readFileSync(p)));
      return;
    }
    r.writeHead(200, head);
    fs.createReadStream(p).pipe(r);
  });
  // Track sockets so a case can take the server down HARD (offline): a plain
  // close() waits for keep-alive connections, which Chromium holds open.
  const sockets = new Set();
  srv.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((res) => srv.listen(0, "127.0.0.1", res));
  return {
    port: srv.address().port,
    close: () => srv.close(),
    kill: () => new Promise((res) => { srv.close(() => res()); for (const s of sockets) s.destroy(); }),
  };
}

/**
 * Every rig `open()` has created, in order.
 *
 * `runCase` closes each one and asserts its error log at the end, which fixes
 * three things at once that the cases got wrong individually: the README
 * claimed "every case asserts `errors` stayed empty" when faults.mjs had FIVE
 * sessions and zero such assertions; browsers registered for teardown but never
 * closed inline left ~15 Chromium instances alive at once (fine here, not on a
 * two-core runner); and a case that forgot either was silently weaker than it
 * looked.
 */
const RIGS = [];

/** Close a rig now and keep its error log for the end-of-case assertion. */
export async function closeRig(rig) {
  if (!rig || rig.closed) return;
  rig.closed = true;
  await rig.browser.close().catch(() => {});
}

/**
 * A page with error capture. `errors` collects pageerrors and console errors,
 * and `runCase` asserts it stayed empty for EVERY session — so a silent
 * regression in an unrelated surface still fails the run.
 */
export async function open(port, {
  label = "",
  throttle = 0,
  viewport = { width: 1440, height: 900 },
  touch = false,
  cdp = false,
  ignoreErrors = [],
} = {}) {
  const browser = await chromium.launch({ executablePath: chromePath() });
  const context = await browser.newContext({
    viewport,
    hasTouch: touch,
    isMobile: false, // isMobile forces mobile UA + meta-viewport emulation; we want plain coarse pointer
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  const keep = (t) => !ignoreErrors.some((re) => re.test(t));
  page.on("pageerror", (e) => { const t = "pageerror: " + String(e).slice(0, 300); if (keep(t)) errors.push(t); });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = "console: " + m.text().slice(0, 300);
    if (keep(t)) errors.push(t);
  });
  let session = null;
  if (throttle || cdp) {
    session = await context.newCDPSession(page);
    if (throttle) await session.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  }
  const rig = { browser, context, page, errors, cdp: session, closed: false, label };
  RIGS.push(rig);
  return rig;
}

/** Load the app, dismiss the first-run tour, and select a view mode. */
export async function boot(page, port, { mode = "Split", settle = 4000, query = "" } = {}) {
  await page.goto(`http://127.0.0.1:${port}/${query}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(settle);
  for (const label of ["Skip tour", "Skip", "Got it"]) {
    const el = page.locator(`button:has-text("${label}")`).first();
    if ((await el.count()) && (await el.isVisible().catch(() => false))) {
      await el.click().catch(() => {});
      await page.waitForTimeout(400);
      break;
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  if (mode) {
    await page.locator(`button:has-text("${mode}")`).first().click({ timeout: 20000 });
    await page.waitForTimeout(1200);
  }
}

/** Seed documents straight into the app's IndexedDB, before it boots. */
export const seed = (page, docs) =>
  page.evaluate(async (docs) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("perssonify-docs");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const now = new Date().toISOString();
    const summaries = docs.map((d) => ({
      id: d.id, title: d.title, updated: now, created: now,
      wordCount: 100, tags: [], hasResiduals: false, originFormat: "markdown",
    }));
    await new Promise((res, rej) => {
      const tx = db.transaction(["documents", "meta"], "readwrite");
      for (const d of docs) {
        tx.objectStore("documents").put(JSON.stringify({
          id: d.id, userTitle: d.title, titlePinnedByUser: true, title: d.title,
          origin: { format: "markdown", raw: "" }, canonical: d.canonical,
          residuals: [], ingestReport: null, metadata: {}, tags: [],
          created: now, updated: now,
        }), d.id);
      }
      tx.objectStore("meta").put(JSON.stringify({ documents: summaries }), "__manifest");
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, docs);

/** Read a document's stored canonical back out of IndexedDB. */
export const storedDoc = (page, id) =>
  page.evaluate(async (id) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("perssonify-docs");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const raw = await new Promise((res, rej) => {
      const tx = db.transaction(["documents"], "readonly");
      const q = tx.objectStore("documents").get(id);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    db.close();
    return raw ? JSON.parse(raw) : null;
  }, id);

/** Plain text of a stored canonical, for on-disk content assertions. */
export function canonicalText(doc) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.text) out.push(n.text);
    (n.content || []).forEach(walk);
  };
  walk(doc && doc.canonical);
  return out.join(" ");
}

// ── Pane accessors ─────────────────────────────────────────────────────────
/**
 * The markdown pane's FULL text.
 *
 * CodeMirror 6 renders only the visible viewport: measured, a 60 KB document had
 * **13 lines / 969 characters** in the DOM out of ~61,000. Reading `.cm-line`
 * once therefore answered questions about 1.6% of the document, and every
 * markdown-pane assertion in this suite could pass or fail for a reason that has
 * nothing to do with the app. CodeMirror leaves no usable back-reference on the
 * DOM (`cmView` is absent on the built editor) and the app exposes no view
 * handle, so the honest way to read it all is to scroll through and accumulate.
 *
 * De-duplicating the passes is the whole difficulty, and `offsetTop` alone does
 * not do it. CodeMirror ESTIMATES the height of lines it has not measured and
 * refines the estimate as they scroll past, and it positions the content 10px
 * differently at scrollTop 0 than at any other position — so the SAME line
 * reports several different offsetTops across a sweep and is recorded several
 * times over. Measured on a 40 KB note: a 30-token run came back as 360 tokens;
 * with a warm-up sweep, 15 of 400 known lines were still recorded twice. That is
 * worse than the single-query reader it replaced — under-reading fails loudly,
 * over-reading produces a plausible wrong number.
 *
 * So a line is the same line if the TEXT matches and the offset is within half a
 * line height. That tolerance is what makes it exact rather than approximate:
 * two distinct occurrences of identical text (two blank lines, two `---` rules)
 * are a full line apart, so nothing real is ever collapsed.
 *
 * (Two approaches that do NOT work, so they are not tried again: adding
 * `scrollTop` to `offsetTop` — the offsetParent IS the scroller, so offsetTop is
 * already in content space; and stitching passes by their longest suffix/prefix
 * overlap — CodeMirror force-renders the line holding the SELECTION at every
 * scroll position, so it appears at the end of every pass and breaks the join.)
 *
 * `innerText` is avoided throughout: it double-counts CodeMirror's blank line
 * (`<div class="cm-line"><br></div>` — the block break AND the `<br>`).
 * `e2e/probes/cm-text-source.mjs` is the measurement behind all of this, and
 * `cases/harness.mjs` asserts the reader against a document of known lines.
 */
export const mdText = (page) =>
  page.evaluate(async () => {
    const content = document.querySelector(".cm-content");
    if (!content) return "";
    const read = () => [...content.querySelectorAll(".cm-line")];
    const scroller = document.querySelector(".cm-scroller");
    if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 4) {
      return read().map((l) => l.textContent).join("\n");
    }

    const prev = scroller.scrollTop;
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const step = Math.max(1, scroller.clientHeight - 40);

    // WARM-UP. CodeMirror only measures a line once it has rendered it, and a
    // long wrapped line at the end of a document it has been guessing about
    // moved by SIX THOUSAND pixels across one sweep — far beyond any per-line
    // tolerance, so it was recorded five times over (the stress tier read a
    // 60-token run as 300). One silent pass forces every line to be measured;
    // after it the offsets only wobble by the ~10px scrollTop-0 shift, which is
    // what the tolerance below is for.
    for (let y = 0; y <= scroller.scrollHeight; y += step) {
      scroller.scrollTop = y;
      await frame();
    }
    // text → the offsets it has been seen at. Indexed by text rather than
    // scanned: a linear search over everything found so far is O(n²) in the
    // lines of the document, and this runs inside poll loops on 50 KB notes.
    const byText = new Map();
    const found = [];   // { top, text }

    for (let y = 0; y <= scroller.scrollHeight; y += step) {
      scroller.scrollTop = y;
      await frame();
      for (const el of read()) {
        const top = el.offsetTop;
        const text = el.textContent;
        // Same line, seen again from a different scroll position — see above.
        // A tolerance of half a line is what makes this exact rather than
        // approximate: two DISTINCT occurrences of identical text (two blank
        // lines, two `---` rules) are a full line height apart, so nothing real
        // is ever collapsed.
        const tol = Math.max(8, (el.offsetHeight || 16) / 2);
        const tops = byText.get(text);
        if (tops) {
          if (tops.some((t) => Math.abs(t - top) <= tol)) continue;
          tops.push(top);
        } else {
          byText.set(text, [top]);
        }
        found.push({ top, text });
      }
    }

    scroller.scrollTop = prev;
    await frame();
    return found.sort((a, b) => a.top - b.top).map((f) => f.text).join("\n");
  });
export const richText = (page) =>
  page.evaluate(() => document.querySelector(".ProseMirror")?.textContent ?? "");
export const richHtml = (page) =>
  page.evaluate(() => document.querySelector(".ProseMirror")?.innerHTML ?? "");

// ── Real IME composition, through CDP ──────────────────────────────────────
/**
 * Drive a genuine composition: `Input.imeSetComposition` fires
 * compositionstart/update in the renderer exactly as an IME or Windows Voice
 * dictation does, which is the one input class the unit tests cannot reach
 * (they toggle a boolean on a mock). `commit: false` leaves the composition
 * OPEN — that is the state every composition guard in the app is about.
 */
export async function imeCompose(cdp, text, { chunk = 3 } = {}) {
  for (let i = chunk; i <= text.length; i += chunk) {
    const partial = text.slice(0, Math.min(i, text.length));
    await cdp.send("Input.imeSetComposition", {
      text: partial, selectionStart: partial.length, selectionEnd: partial.length,
    });
  }
  const full = text;
  await cdp.send("Input.imeSetComposition", {
    text: full, selectionStart: full.length, selectionEnd: full.length,
  });
}

/** End an open composition by committing its text (fires compositionend). */
export const imeCommit = (cdp, text) =>
  cdp.send("Input.insertText", { text });

/** True while the page reports an active composition in either pane. */
export const composing = (page) =>
  page.evaluate(() => {
    const cm = document.querySelector(".cm-editor");
    const pm = document.querySelector(".ProseMirror");
    // Both libraries mark the DOM during composition; PM adds the class, CM
    // keeps it on the view. Fall back to the observable marker each provides.
    return !!(pm && pm.classList.contains("ProseMirror-composition")) ||
      !!(cm && cm.classList.contains("cm-composing"));
  });

/**
 * Poll `fn` until it returns truthy, or the deadline passes. Returns how long it
 * took, or -1 on timeout.
 *
 * Assertions used fixed `waitForTimeout(N)` budgets tuned on this machine; a
 * two-core CI runner is a different machine, and a fixed sleep there is a flake
 * generator in one direction and wasted minutes in the other.
 */
export async function waitUntil(fn, { timeout = 15000, interval = 200 } = {}) {
  const started = Date.now();
  for (;;) {
    if (await fn()) return Date.now() - started;
    if (Date.now() - started > timeout) return -1;
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Wait for the other pane to show `text`. Returns ms, or -1. */
export const waitForMirror = (page, pane, text, opts) =>
  waitUntil(async () => ((pane === "md" ? await richText(page) : await mdText(page)) || "").includes(text), opts);

/**
 * Poll `fn` until it returns something truthy, then return THAT value; on
 * timeout, return whatever the last call gave.
 *
 * This is the form an assertion wants: `rep.check(name, await until(() => …))`
 * replaces "sleep for a budget I guessed, then look once". A budget that is too
 * short does not report "too slow", it reports the same FAIL a genuine
 * regression does — and one that is too long is minutes of CI spent waiting for
 * something that finished immediately. Returning the last value keeps the
 * failure detail intact (you see what it actually was, not just `false`).
 *
 * Use a fixed sleep ONLY for a negative assertion — proving something did NOT
 * happen needs a real interval, and there is nothing to poll for.
 */
export async function until(fn, { timeout = 15000, interval = 150 } = {}) {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - started > timeout) return v;
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** `until`, for a value compared against an expectation rather than a boolean.
 *  Returns the last value seen, so the caller asserts on it as usual. */
export async function untilValue(fn, matches, opts) {
  let last;
  await until(async () => { last = await fn(); return matches(last); }, opts);
  return last;
}

// ── Reporting ──────────────────────────────────────────────────────────────
export function reporter(suite) {
  const rows = [];
  return {
    check(name, ok, detail = "") {
      rows.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 400) });
      console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? "  — " + String(detail).slice(0, 200) : ""}`);
    },
    note: (msg) => console.log(`      ${msg}`),
    finish() {
      const failed = rows.filter((r) => !r.ok);
      console.log(failed.length ? `\n${suite}: ${failed.length}/${rows.length} FAILED` : `\n${suite}: ${rows.length} checks passed`);
      if (process.env.E2E_JSON) {
        fs.writeFileSync(process.env.E2E_JSON, JSON.stringify({ suite, rows }, null, 2));
      }
      return failed.length;
    },
  };
}

/** Run a case body with guaranteed teardown, and exit non-zero on failure. */
export async function runCase(suite, body) {
  const rep = reporter(suite);
  let teardown = () => {};
  try {
    await body(rep, (fn) => { const prev = teardown; teardown = async () => { await fn(); await prev(); }; });
  } catch (e) {
    rep.check(`${suite} crashed`, false, e && e.stack ? e.stack.split("\n").slice(0, 3).join(" ") : String(e));
  } finally {
    await teardown().catch(() => {});
    // Central, not per-case: a console error or an uncaught exception in ANY
    // session fails the run, whether or not that case remembered to look.
    for (const [i, rig] of RIGS.entries()) {
      await closeRig(rig);
      rep.check(
        `no console errors in session ${i + 1}${rig.label ? ` (${rig.label})` : ""}`,
        rig.errors.length === 0,
        rig.errors.join(" | ")
      );
    }
  }
  process.exit(rep.finish() ? 1 : 0);
}
