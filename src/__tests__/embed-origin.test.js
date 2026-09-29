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
import { createEditorClient } from "../integration/host-bridge";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");

describe("embed origin resolution", () => {
  const src = read("src/embed.tsx");

  it("does not hand the bridge its own origin", () => {
    expect(src).not.toMatch(/allowedOrigins=\{\[window\.location\.origin\]\}/);
    expect(src).toMatch(/allowedOrigins=\{allowedOrigins\}/);
  });

  it("prefers an explicit ?allowed_origin and falls back to the framing page", () => {
    const fn = src.slice(src.indexOf("function resolveAllowedOrigins"), src.indexOf("\n}", src.indexOf("function resolveAllowedOrigins")));
    expect(fn).toMatch(/getAll\("allowed_origin"\)/);
    expect(fn).toMatch(/document\.referrer/);
  });

  it("never resolves to a wildcard", () => {
    const fn = src.slice(src.indexOf("function resolveAllowedOrigins"), src.indexOf("\n}", src.indexOf("function resolveAllowedOrigins")));
    // A wildcard from a URL parameter would let whoever frames us relay the
    // document to anyone else.
    expect(fn).toMatch(/filter\(\(v\) => v !== "\*"\)/);
    expect(fn).not.toMatch(/return \["\*"\]/);
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
