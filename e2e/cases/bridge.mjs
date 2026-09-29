// The iframe EMBED's host bridge, driven from a second origin.
//
// `runCase` owns the process (it exits non-zero on failure), so each suite is
// its own file — see run.mjs.
import fs from "node:fs";
import path from "node:path";
import { serve, open, runCase, until, ROOT, EMBED_DIR } from "../lib.mjs";

const FIXTURES = path.join(ROOT, "e2e", "fixtures");
//
// The shipped iframe embed could not receive a single host message: it passed
// the EDITOR's origin as `allowedOrigins`, which is never the sender's, so
// `isOriginAllowed` rejected everything. That was invisible to every unit test
// because both halves live in this repo and agreed with each other. This drives
// the built embed from a real second origin (a different port IS a different
// origin) with a hand-written client, and asserts the wire, not our idea of it.
runCase("bridge", async (rep, onClose) => {
  if (!fs.existsSync(path.join(EMBED_DIR, "index.html"))) {
    rep.note("dist-embed/ not built — bridge checks skipped (run `bun run build:embed`)");
    return;
  }

  const esrv = await serve(EMBED_DIR);
  onClose(async () => esrv.close());

  const dir = fs.mkdtempSync(path.join(ROOT, ".e2e-bridge-"));
  onClose(async () => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(path.join(FIXTURES, "embed-host.html"), path.join(dir, "index.html"));
  const hsrv = await serve(dir);
  onClose(async () => hsrv.close());

  const embedUrl = (query = "") => `http://127.0.0.1:${esrv.port}/${query}`;
  const hostUrl = (query) => `http://127.0.0.1:${hsrv.port}/?embed=${encodeURIComponent(embedUrl(query))}`;

  // ── the referrer-derived allowlist ──────────────────────────────────────
  {
    const { browser, page: pg } = await open(hsrv.port, { label: "bridge/referrer" });
    onClose(async () => { await browser.close(); });
    await pg.goto(hostUrl(""), { waitUntil: "networkidle" });

    const gotReady = await until(() => pg.evaluate(() => window.__sawEvent("ready")), { timeout: 20000 });
    rep.check("the embed announces itself to the page that framed it", !!gotReady,
      "no `ready` event — the bridge is not talking to its host");
    rep.check("`ready` is addressed to the host origin, not broadcast",
      await pg.evaluate(() => window.__events.every((e) => e.origin === new URL(document.querySelector("iframe").src).origin)));

    // A round trip. `setDocuments` is an additive alias that used to be a
    // complete no-op (it called the store's PURE createDoc and dropped every
    // result), so a host got a success reply and an unchanged library.
    const set = await pg.evaluate(() =>
      window.__call("setDocuments", {
        // The API takes `markdown` (or `canonical`) — `content` is not a field
        // it reads, and passing it created an empty document.
        documents: [{ id: "bridged", title: "Bridged", markdown: "# Bridged\n\nFrom the host." }],
      })
    );
    rep.check("a host command gets a response", set !== null, "timed out waiting for a response");
    rep.check("the command did not error", set && !set.error, set && set.error);

    const md = await until(async () => {
      const r = await pg.evaluate(() => window.__call("getMarkdown"));
      return r && r.result && String(r.result.md ?? "").includes("Bridged") ? r : null;
    }, { timeout: 15000 });
    rep.check("the document the host set comes back through the bridge", !!md,
      "getMarkdown never returned the host's content");
    rep.check("getMarkdown returns { md, fidelityReport }, not a bare string",
      !!md && typeof md.result === "object" && "md" in md.result, JSON.stringify(md && md.result).slice(0, 200));

    // An unknown action used to RESOLVE with an error object, so a host's
    // "Export as Word" silently did nothing and reported success.
    const unknown = await pg.evaluate(() => window.__call("thisActionDoesNotExist"));
    rep.check("an unknown action comes back as an error, not a silent success",
      !!unknown && !!unknown.error, JSON.stringify(unknown));
  }

  // ── the allowlist is real ───────────────────────────────────────────────
  // Pin the embed to a third-party origin: the framing page is then NOT
  // allowed, and every message it sends must be ignored. Without this, "the
  // bridge answered us" proves the wire works but not that it is guarded.
  {
    const { browser, page: pg } = await open(hsrv.port, { label: "bridge/denied" });
    onClose(async () => { await browser.close(); });
    await pg.goto(hostUrl("?allowed_origin=https%3A%2F%2Fnot-this-host.example"), { waitUntil: "networkidle" });
    await pg.waitForTimeout(6000);   // negative assertion: nothing to poll for

    rep.check("a disallowed host receives no events", await pg.evaluate(() => window.__events.length) === 0,
      await pg.evaluate(() => JSON.stringify(window.__events.map((e) => e.event))));
    const denied = await pg.evaluate(() => window.__call("getMarkdown", {}, 5000));
    rep.check("a disallowed host's commands are ignored", denied === null,
      JSON.stringify(denied));
    rep.check("the embed still rendered for its own sake",
      await pg.frameLocator("#editor").locator("body").count() > 0);
  }
});
