/**
 * The iframe embed must talk to the page that framed it.
 *
 * `allowedOrigins={[window.location.origin]}` was the EDITOR's origin, read
 * from inside the iframe — while an inbound message's `event.origin` is the
 * HOST's. `createHostBridge` dropped every one, and the outbound `emit` posted
 * to the app's own origin while targeting the parent, so `ready`/`onChange`
 * were discarded too. Every action in the integration guide was inert against
 * the shipped /embed.html, and no parameter could widen it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveEmbedAllowedOrigins } from "../integration/embed-origins";
import { createEditorClient } from "../integration/host-bridge";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");

/** The resolver with defaults: no params, no referrer, browser without ancestorOrigins. */
const resolve = ({ query = "", referrer = "", ancestorOrigins, deployAllowlist } = {}) =>
  resolveEmbedAllowedOrigins({ params: new URLSearchParams(query), referrer, ancestorOrigins, deployAllowlist });

describe("embed origin resolution", () => {
  const src = read("src/embed.tsx");

  it("does not hand the bridge its own origin", () => {
    expect(src).not.toMatch(/allowedOrigins=\{\[window\.location\.origin\]\}/);
    expect(src).toMatch(/allowedOrigins=\{allowedOrigins\}/);
  });

  it("feeds the resolver the framing page's real signals and the deploy allowlist", () => {
    const fn = src.slice(src.indexOf("function resolveAllowedOrigins"), src.indexOf("\n}", src.indexOf("function resolveAllowedOrigins")));
    expect(fn).toMatch(/resolveEmbedAllowedOrigins\(/);
    expect(fn).toMatch(/document\.referrer/);
    expect(fn).toMatch(/ancestorOrigins/);
    expect(fn).toMatch(/VITE_EMBED_ALLOWED_ORIGINS/);
  });

  // The rules that were pinned by reading embed.tsx's source are now asserted
  // on the resolver's behaviour (A072 moved them to integration/embed-origins.ts).
  it("prefers an explicit ?allowed_origin and falls back to the framing page", () => {
    expect(resolve({ query: "allowed_origin=https://host.example", referrer: "https://other.example/page" })).toEqual(["https://host.example"]);
    expect(resolve({ query: "allowed_origin=https://a.example,https://b.example" })).toEqual(["https://a.example", "https://b.example"]);
    expect(resolve({ referrer: "https://framer.example/some/page?x=1" })).toEqual(["https://framer.example"]);
    expect(resolve({})).toEqual([]); // referrer suppressed, nothing else known: deny all
  });

  it("never resolves to a wildcard", () => {
    // A wildcard from a URL parameter would let whoever frames us relay the
    // document to anyone else.
    expect(resolve({ query: "allowed_origin=*" })).toEqual([]);
    expect(resolve({ query: "allowed_origin=*&allowed_origin=https://host.example" })).toEqual(["https://host.example"]);
    expect(resolve({ referrer: "https://framer.example/", deployAllowlist: "*" })).toEqual([]);
    expect(resolve({ query: "allowed_origin=https://host.example/not-an-origin" })).toEqual([]);
  });
});

describe("the embed trusts only whoever REALLY frames it (A072)", () => {
  it("an ?allowed_origin must be the actual framer where the browser reports it", () => {
    const framed = { ancestorOrigins: ["https://host.example"] };
    expect(resolve({ ...framed, query: "allowed_origin=https://host.example" })).toEqual(["https://host.example"]);
    // A framing page naming some other window gets nothing.
    expect(resolve({ ...framed, query: "allowed_origin=https://victim.example" })).toEqual([]);
    // A spoofed/stale referrer is overridden by the reported framer.
    expect(resolve({ ...framed, referrer: "https://elsewhere.example/" })).toEqual(["https://host.example"]);
  });

  it("uses the reported framer when the referrer is suppressed", () => {
    expect(resolve({ ancestorOrigins: ["https://host.example"] })).toEqual(["https://host.example"]);
  });

  it("a page that is not framed at all has no bridge partner", () => {
    expect(resolve({ ancestorOrigins: [], query: "allowed_origin=https://host.example", referrer: "https://host.example/" })).toEqual([]);
  });

  it("the deploy-time allowlist has the last word", () => {
    const allow = "https://meridien.example, https://staging.meridien.example";
    expect(resolve({ ancestorOrigins: ["https://meridien.example"], deployAllowlist: allow })).toEqual(["https://meridien.example"]);
    // Any other framer — whatever it passes — is refused.
    expect(resolve({ ancestorOrigins: ["https://attacker.example"], query: "allowed_origin=https://attacker.example", deployAllowlist: allow })).toEqual([]);
    // Firefox (no ancestorOrigins): the referrer is still checked against the list.
    expect(resolve({ referrer: "https://attacker.example/", deployAllowlist: allow })).toEqual([]);
    expect(resolve({ referrer: "https://staging.meridien.example/x", deployAllowlist: allow })).toEqual(["https://staging.meridien.example"]);
  });
});

describe("createEditorClient no longer defaults to a wildcard", () => {
  /** A stand-in iframe: the client only reads `src` and `contentWindow`. */
  function fakeIframe(srcAttr) {
    const posted = [];
    return {
      posted,
      el: {
        getAttribute: (n) => (n === "src" ? srcAttr : null),
        contentWindow: { postMessage: (msg, origin) => posted.push({ msg, origin }) },
      },
    };
  }

  it("derives the editor's origin from the iframe it was given", () => {
    const { el, posted } = fakeIframe("https://editor.example/embed.html?mode=split");
    createEditorClient(el).send("ping");
    expect(posted[0].origin).toBe("https://editor.example");
  });

  it("accepts an explicit origin string", () => {
    const { el, posted } = fakeIframe("https://editor.example/embed.html");
    createEditorClient(el, "https://other.example").send("ping");
    expect(posted[0].origin).toBe("https://other.example");
  });

  it("accepts the { allowedOrigins } shape the integration guide documents", () => {
    // Passing that object used to land in the positional `editorOrigin` slot,
    // so postMessage threw and every inbound origin comparison failed — the
    // reader who followed the docs got a dead client.
    const { el, posted } = fakeIframe("https://editor.example/embed.html");
    createEditorClient(el, { allowedOrigins: ["https://documented.example"] }).send("ping");
    expect(posted[0].origin).toBe("https://documented.example");
  });

  // This pair used to be ONE case that could not fail. It dispatched
  // `type: "perssonify-editor"`, but the wire protocol constant is
  // `"perssonify"` — so the message was rejected by the protocol check before
  // origin was ever consulted, and the empty-list assertion held no matter what
  // the origin guard did. Mutation-tested: with BOTH the origin and source
  // guards deleted, the old case still passed.
  //
  // A negative assertion about a filter is worth nothing without a positive
  // control proving the same message gets through when the filter should allow
  // it. That is what separates "the guard works" from "the fixture was
  // malformed", which is exactly the distinction the old case lost.
  const readyMessage = (origin, source) => new MessageEvent("message", {
    data: { type: "perssonify", version: "1.0", event: "ready", payload: { from: origin } },
    origin,
    source,
  });

  it("ignores messages from an origin other than the editor's", () => {
    const { el } = fakeIframe("https://editor.example/embed.html");
    const client = createEditorClient(el);
    const seen = [];
    client.on("ready", (p) => seen.push(p));
    // Correct protocol and the right source window, so ORIGIN is the only
    // thing that can reject it.
    window.dispatchEvent(readyMessage("https://attacker.example", el.contentWindow));
    expect(seen).toEqual([]);
    client.destroy();
  });

  it("…and delivers the otherwise identical message from the editor's own origin", () => {
    const { el } = fakeIframe("https://editor.example/embed.html");
    const client = createEditorClient(el);
    const seen = [];
    client.on("ready", (p) => seen.push(p));
    window.dispatchEvent(readyMessage("https://editor.example", el.contentWindow));
    expect(seen).toEqual([{ from: "https://editor.example" }]);
    client.destroy();
  });
});
