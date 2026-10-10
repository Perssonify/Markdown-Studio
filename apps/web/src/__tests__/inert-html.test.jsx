import "fake-indexeddb/auto";
import { generateHTML } from "@tiptap/core";
import { act, render } from "@testing-library/react";
import { createElement, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TiptapPane } from "../ui/TiptapPane";
import { assetStore } from "../store/assets/asset-store";
import { assetRef } from "../store/assets/asset-refs";
import { canonicalToHtml, SERIALIZE_EXTENSIONS } from "../engine/serialize-doc";

/**
 * Serializing the document must never create an <img> in the LIVE page
 * (engine/inert-html.ts). TipTap's getHTML()/generateHTML() build every node
 * with the page's document before moving the result into an inert one, so each
 * <img> started loading its src: WebKit logged a failed load for every stored
 * image's `pf-asset:` reference on File ▸ Export ▸ HTML (found by the dataloss
 * suite on WebKit), an enforced CSP would report it, and a remote image was
 * requested on every export or host callback. The markup must not change.
 */

const HASH = "a".repeat(64);
const REMOTE = "https://example.com/tracker.png";
const HTML =
  `<h1>Title</h1><p>Text with <strong>bold</strong> and <a href="https://x.test">a link</a>.</p>` +
  `<p><img src="${assetRef(HASH)}" alt="stored"></p>` +
  `<p><img src="${REMOTE}" alt="remote" width="120" height="40"></p>` +
  `<ul><li><p>one</p></li><li><p>two</p></li></ul>` +
  `<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>` +
  `<pre><code class="language-js">const a = 1;</code></pre>`;

/** Every src/srcset handed to an element OWNED BY the live document. */
function watchLiveSrc() {
  const assigned = [];
  const realSetAttr = Element.prototype.setAttribute;
  vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function (name, value) {
    if (this.ownerDocument === document && /^(src|srcset)$/i.test(String(name))) assigned.push(String(value));
    return realSetAttr.call(this, name, value);
  });
  return assigned;
}

let mounted = null;
let n = 0;
beforeEach(() => {
  assetStore._resetForTests({ useIndexedDB: true, dbName: `inert-html-${++n}` });
  let i = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:test/${++i}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
});

describe("the rich pane's getHTML", () => {
  async function mount() {
    const ref = createRef();
    await act(async () => { mounted = render(createElement(TiptapPane, { ref, isDark: false, defaultValue: HTML })); });
    return ref.current;
  }

  it("creates no <img> in the live page — not the stored reference, not the remote image", async () => {
    const pane = await mount();
    const assigned = watchLiveSrc();
    const html = pane.getHTML();
    expect(assigned).toEqual([]);
    // …and the document's own references are in the output, untouched.
    expect(html).toContain(`src="${assetRef(HASH)}"`);
    expect(html).toContain(`src="${REMOTE}"`);
  });

  it("is byte-identical to TipTap's getHTML()", async () => {
    const pane = await mount();
    expect(pane.getHTML()).toBe(pane.getEditor().getHTML());
  });
});

describe("canonicalToHtml (per-document and ZIP export)", () => {
  const canonical = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
      { type: "paragraph", content: [
        { type: "text", text: "Colour ", marks: [{ type: "textStyle", attrs: { color: "#c00" } }] },
        { type: "text", text: "and a wiki link", marks: [{ type: "link", attrs: { href: "#", docLink: "Other", anchor: null } }] },
      ] },
      { type: "paragraph", content: [{ type: "image", attrs: { src: assetRef(HASH), alt: "stored" } }] },
      { type: "paragraph", content: [{ type: "image", attrs: { src: REMOTE, alt: "remote", width: 120, height: 40 } }] },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }] }] },
    ],
  };

  it("creates no <img> in the live page", () => {
    const assigned = watchLiveSrc();
    const html = canonicalToHtml(canonical);
    expect(assigned).toEqual([]);
    expect(html).toContain(`src="${assetRef(HASH)}"`);
  });

  it("is byte-identical to generateHTML", () => {
    expect(canonicalToHtml(canonical)).toBe(generateHTML(canonical, SERIALIZE_EXTENSIONS));
  });
});
