/**
 * The browser floor (A097): below Safari/iOS 16.4, Chrome/Edge 111 and
 * Firefox 128 the page says so instead of going blank — and never lets the
 * boot watchdog "recover" a browser that is simply too old.
 *
 * Before this, an old Safari got a blank page (the Tailwind v4 stylesheet does
 * not apply there) or a SyntaxError out of the bundle; the watchdog took that
 * error for a broken deploy, unregistered the service worker, deleted every
 * cache and reloaded into the same blank page.
 *
 * These cases run the SHIPPED inline scripts, read out of index.html and
 * embed.html: in a sandbox with the features stubbed present or missing, and
 * in a jsdom document parsed from the real file. What jsdom cannot show is the
 * parser turning the rest of the page into text after `<plaintext>` (so the
 * module script is never parsed); `e2e/cases/floor.mjs` asserts that in
 * Chromium, Firefox and WebKit.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { parse } from "acorn";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const INDEX = read("index.html");
const EMBED = read("embed.html");
const inlineScripts = (html) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const FLOOR = inlineScripts(INDEX).find((s) => s.includes("Browser floor"));
const WATCHDOG = inlineScripts(INDEX).find((s) => s.includes("Boot watchdog"));

/** The three features the floor is made of, all present: a supported browser. */
const AT_FLOOR = { css: true, registerProperty: true, colorMix: true, lookbehind: true };

/** A RegExp that fails the way Safari before 16.4 does on a lookbehind. */
function RegExpWithoutLookbehind(source, flags) {
  if (/\(\?<[=!]/.test(String(source))) throw new SyntaxError("Invalid regular expression: invalid group specifier name");
  return new RegExp(source, flags);
}

function runFloor(missing = {}) {
  const f = { ...AT_FLOOR, ...missing };
  const written = [];
  const sandbox = {
    document: { write: (...parts) => written.push(parts.join("")) },
    RegExp: f.lookbehind ? RegExp : RegExpWithoutLookbehind,
  };
  if (f.css) {
    sandbox.CSS = {
      supports: f.supportsThrows
        ? () => { throw new TypeError("CSS.supports is broken"); }
        : (_prop, value) => f.colorMix || !String(value).includes("color-mix"),
    };
    if (f.registerProperty) sandbox.CSS.registerProperty = () => {};
  }
  sandbox.window = sandbox;
  vm.runInNewContext(FLOOR, sandbox);
  return { sandbox, html: written.join("") };
}

describe("the floor script", () => {
  it("is in index.html, before the boot watchdog and before the module entry", () => {
    expect(FLOOR).toBeTruthy();
    expect(WATCHDOG).toBeTruthy();
    expect(INDEX.indexOf(FLOOR)).toBeLessThan(INDEX.indexOf(WATCHDOG));
    expect(INDEX.indexOf(FLOOR)).toBeLessThan(INDEX.indexOf('<script type="module"'));
  });

  it("is in embed.html byte for byte, before its module entry", () => {
    const embedFloor = inlineScripts(EMBED).find((s) => s.includes("Browser floor"));
    expect(embedFloor).toBe(FLOOR);
    expect(EMBED.indexOf(FLOOR)).toBeLessThan(EMBED.indexOf('<script type="module"'));
  });

  it("still runs before the entry in the BUILT app (checked when a current dist-app/ exists)", () => {
    const built = join(process.cwd(), "dist-app", "index.html");
    if (!existsSync(built)) return;
    if (statSync(built).mtimeMs < statSync(join(process.cwd(), "index.html")).mtimeMs) return;
    const html = readFileSync(built, "utf8").replace(/\r\n/g, "\n");
    // Vite injects the entry, its preloads and the stylesheets at the end of
    // <head>; everything <plaintext> must swallow has to come after the check.
    const at = html.indexOf(FLOOR);
    expect(at).toBeGreaterThan(-1);
    for (const tag of ['<script type="module"', '<link rel="modulepreload"', '<link rel="stylesheet"']) {
      expect(html.indexOf(tag), tag).toBeGreaterThan(at);
    }
  });

  it("parses as ES5, so the browsers it turns away can run it (no lookbehind literal either)", () => {
    expect(() => parse(FLOOR, { ecmaVersion: 5 })).not.toThrow();
  });

  it("leaves a browser at the floor alone: no message, no flag", () => {
    const { sandbox, html } = runFloor();
    expect(html).toBe("");
    expect(sandbox.__PF_UNSUPPORTED).toBeUndefined();
  });

  it.each([
    ["no @property (Safari < 16.4, Firefox < 128)", { registerProperty: false }],
    ["no color-mix() (Chrome/Edge < 111, Firefox < 113)", { colorMix: false }],
    ["no regex lookbehind (Safari < 16.4)", { lookbehind: false }],
    ["no CSS namespace at all", { css: false }],
    ["a CSS.supports that throws", { supportsThrows: true }],
  ])("below the floor — %s: writes the message, then <plaintext>", (_name, missing) => {
    const { sandbox, html } = runFloor(missing);
    expect(sandbox.__PF_UNSUPPORTED).toBe(true);
    expect(html).toContain("Markdown Studio needs a newer browser");
    // <plaintext> is the LAST thing written: the tokenizer never leaves that
    // state, so the rest of the page (watchdog, stylesheet, module script)
    // becomes text and none of it runs.
    expect(html).toMatch(/<plaintext style="display:none">$/);
  });

  it("the message names the supported versions and says nothing was deleted", () => {
    const { html } = runFloor({ registerProperty: false });
    const text = new JSDOM(html).window.document.body.textContent;
    for (const s of ["Safari 16.4", "iOS or iPadOS 16.4", "Chrome", "Edge 111", "Firefox 128"]) expect(text).toContain(s);
    expect(text).toContain("Nothing has been deleted");
    expect(text).toMatch(/Documents you saved in this browser are untouched/);
    expect(text).toMatch(/will be there .* after updating/);
  });

  it("the message depends on nothing but itself (the app's CSS never loads)", () => {
    const { html } = runFloor({ registerProperty: false });
    expect(html).not.toMatch(/\sclass=/);
    expect(html).not.toMatch(/<(link|script|img|iframe|style)\b/i);
    expect(html).not.toMatch(/url\(|src=|href=/i);
    const doc = new JSDOM(html).window.document;
    expect(doc.querySelector("main h1")?.textContent).toBe("Markdown Studio needs a newer browser");
    expect(doc.querySelector("main").getAttribute("style")).toMatch(/max-width/);
  });
});

/** The boot watchdog in a sandbox, as ops-watchdog.test.js runs it. */
function bootWatchdog({ unsupported }) {
  const listeners = {};
  const timers = [];
  const local = new Map();
  const session = new Map();
  const calls = { reload: 0, unregistered: 0, cachesDeleted: [] };
  const sandbox = {
    __PF_BOOTED: false,
    ...(unsupported ? { __PF_UNSUPPORTED: true } : {}),
    navigator: {
      onLine: true,
      serviceWorker: { getRegistrations: async () => [{ unregister: async () => calls.unregistered++ }] },
    },
    caches: { keys: async () => ["workbox-precache-v2-x"], delete: async (k) => calls.cachesDeleted.push(k) },
    sessionStorage: { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => session.set(k, String(v)) },
    localStorage: { getItem: (k) => local.get(k) ?? null, setItem: (k, v) => local.set(k, String(v)) },
    location: { reload: () => calls.reload++ },
    setTimeout: (fn) => timers.push(fn) && timers.length,
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
    Promise, Date, JSON, Number, String,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(WATCHDOG, sandbox);
  const fire = (type, event) => (listeners[type] || []).forEach((fn) => fn(event));
  return {
    calls,
    local,
    /** The two kinds of evidence an old browser produces: a failed load and a SyntaxError from the bundle. */
    async failLikeAnOldBrowser() {
      fire("error", { target: { tagName: "SCRIPT" } });
      fire("error", {
        target: sandbox,
        error: new SyntaxError("Invalid regular expression: invalid group specifier name"),
        message: "SyntaxError: Invalid regular expression: invalid group specifier name",
        filename: "https://markdownstudio.com/assets/index-abc123.js",
      });
      for (const t of timers.splice(0)) t();
      fire("online", {});
      for (const t of timers.splice(0)) t();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe("the floor and the boot watchdog cooperate", () => {
  it("control: on a supported browser the same evidence DOES trigger recovery", async () => {
    const w = bootWatchdog({ unsupported: false });
    await w.failLikeAnOldBrowser();
    expect(w.calls.reload).toBe(1);
  });

  it("below the floor the watchdog never clears caches, unregisters or reloads", async () => {
    const w = bootWatchdog({ unsupported: true });
    await w.failLikeAnOldBrowser();
    expect(w.calls.reload).toBe(0);
    expect(w.calls.cachesDeleted).toEqual([]);
    expect(w.calls.unregistered).toBe(0);
    expect(w.local.has("pf:boot-recovered")).toBe(false);
  });
});

describe("the real index.html, parsed by jsdom", () => {
  /**
   * jsdom runs the inline scripts in document order while it parses. It has no
   * `CSS` namespace at all, so it is below the floor unless one is provided.
   * Unlike a browser it keeps parsing after `<plaintext>` (its document.write
   * inserts nodes rather than feeding the tokenizer), so the watchdog still
   * installs here — which is what lets this also check that the watchdog,
   * running after the floor in the real page, stands down.
   */
  function load({ supported }) {
    const timers = [];
    const dom = new JSDOM(INDEX, {
      url: "https://markdownstudio.com/",
      runScripts: "dangerously",
      beforeParse(window) {
        if (supported) window.CSS = { registerProperty() {}, supports: () => true };
        window.setTimeout = (fn) => timers.push(fn) && timers.length;
        window.__reloads = 0;
      },
    });
    return { dom, window: dom.window, timers };
  }

  it("a supported browser gets the app's page untouched", () => {
    const { window } = load({ supported: true });
    expect(window.__PF_UNSUPPORTED).toBeUndefined();
    expect(window.document.querySelector("main")).toBeNull();
    expect(window.document.getElementById("root")).not.toBeNull();
  });

  it("below the floor the message is in the page, followed by <plaintext>, and a boot error recovers nothing", () => {
    const { window, timers } = load({ supported: false });
    expect(window.__PF_UNSUPPORTED).toBe(true);
    const main = window.document.querySelector("main");
    expect(main?.querySelector("h1")?.textContent).toBe("Markdown Studio needs a newer browser");
    expect(main.nextElementSibling?.tagName).toBe("PLAINTEXT");

    // The bundle failing, as it would on this browser: nothing is armed.
    window.dispatchEvent(new window.ErrorEvent("error", {
      message: "SyntaxError", filename: "https://markdownstudio.com/assets/index-abc123.js", error: new SyntaxError("x"),
    }));
    for (const t of timers.splice(0)) t();
    expect(window.localStorage.getItem("pf:boot-recovered")).toBeNull();
    expect(window.sessionStorage.getItem("pf:boot-recover-at")).toBeNull();
  });
});
