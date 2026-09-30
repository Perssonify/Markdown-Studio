import { describe, expect, it } from "vitest";
import {
  INLINE_MAX_CHARS,
  assetRef,
  bytesToDataUrl,
  collectAssetRefs,
  collectImageSrcs,
  isAssetRef,
  isExternalizableDataUrl,
  mapImageSrcs,
  parseAssetRef,
  parseDataUrl,
  replaceRefsInText,
} from "../store/asset-refs";
import { isDangerousUrl } from "../utils/url-safety";
import { sanitizeForIngest } from "../store/ingest";
import { sanitizeCanonicalNode } from "../store/canonical-sanitize";
import { sanitizePastedHtml } from "../engine/html-cleaner";
import { neutralizeAssetSrcs } from "../ui/asset-dom";

/** The reference format and its place in the sanitizers (A086). */

const H = "a1b2c3d4".repeat(8); // 64 hex digits
const REF = `pf-asset:${H}`;

describe("asset references", () => {
  it("accept exactly the scheme, 64 hex digits and an optional fragment", () => {
    expect(isAssetRef(REF)).toBe(true);
    expect(isAssetRef(`${REF}#gh-dark-mode-only`)).toBe(true);
    expect(parseAssetRef(`${REF}#gh-dark-mode-only`)).toEqual({ hash: H, fragment: "#gh-dark-mode-only" });
    expect(parseAssetRef(REF.toUpperCase().replace("PF-ASSET", "pf-asset"))?.hash).toBe(H); // hash case-insensitive
    for (const bad of ["pf-asset:", `pf-asset:${H.slice(1)}`, `pf-asset:${H}0`, "pf-asset:javascript:alert(1)", `x${REF}`, `${REF} onerror=x`]) {
      expect(isAssetRef(bad), bad).toBe(false);
    }
  });

  it("assetRef builds the lower-case form", () => {
    expect(assetRef(H.toUpperCase())).toBe(REF);
  });

  it("collectAssetRefs finds a reference anywhere a value can hold one", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "image", attrs: { src: REF } }] },
        { type: "paragraph", content: [{ type: "themeImage", attrs: { lightSrc: `pf-asset:${"0".repeat(64)}`, darkSrc: "" } }] },
        { type: "codeBlock", content: [{ type: "text", text: `see pf-asset:${"f".repeat(64)}` }] },
      ],
    };
    expect([...collectAssetRefs(doc)].sort()).toEqual(["0".repeat(64), H, "f".repeat(64)].sort());
    expect([...collectAssetRefs(`![](${REF})`)]).toEqual([H]);
    expect(collectAssetRefs(null).size).toBe(0);
  });
});

describe("data: URLs", () => {
  it("round-trip bytes through base64", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
    const url = bytesToDataUrl(bytes, "image/png");
    const back = parseDataUrl(url);
    expect(back.mime).toBe("image/png");
    expect([...back.bytes]).toEqual([...bytes]);
  });

  it("encodes a large buffer without overflowing the call stack", () => {
    const big = new Uint8Array(3 * 1024 * 1024).fill(7);
    expect(parseDataUrl(bytesToDataUrl(big, "image/png")).bytes.length).toBe(big.length);
  });

  it("only big RASTER data: URLs are worth storing; tiny ones stay inline", () => {
    const pad = "A".repeat(INLINE_MAX_CHARS);
    expect(isExternalizableDataUrl(`data:image/png;base64,${pad}`)).toBe(true);
    expect(isExternalizableDataUrl(`data:image/jpeg;base64,${pad}`)).toBe(true);
    expect(isExternalizableDataUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(false); // under the threshold
    expect(isExternalizableDataUrl(`data:image/svg+xml;base64,${pad}`)).toBe(false);
    expect(isExternalizableDataUrl(`data:text/html;base64,${pad}`)).toBe(false);
    expect(isExternalizableDataUrl(`https://x.test/${pad}`)).toBe(false);
  });
});

describe("walking canonical JSON", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "a" }] },
      { type: "paragraph", content: [{ type: "image", attrs: { src: "old", alt: "x", width: "40" } }] },
    ],
  };

  it("collects every image source", () => {
    expect(collectImageSrcs(doc)).toEqual(["old"]);
  });

  it("maps sources copy-on-write — the input is never mutated, untouched nodes are shared", () => {
    const out = mapImageSrcs(doc, (s) => (s === "old" ? REF : s));
    expect(out.content[1].content[0].attrs).toEqual({ src: REF, alt: "x", width: "40" });
    expect(doc.content[1].content[0].attrs.src).toBe("old");
    expect(out.content[0]).toBe(doc.content[0]);
    expect(mapImageSrcs(doc, (s) => s)).toBe(doc);
  });
});

describe("replacing references in exported text", () => {
  it("replaces known references and reports the rest", () => {
    const other = "b".repeat(64);
    const { text, missing } = replaceRefsInText(
      `<img src="${REF}#gh-dark-mode-only"><img src="pf-asset:${other}">`,
      (h) => (h === H ? "data:image/png;base64,AAAA" : null)
    );
    expect(text).toBe(`<img src="data:image/png;base64,AAAA#gh-dark-mode-only"><img src="pf-asset:${other}">`);
    expect(missing).toEqual([other]);
  });
});

describe("the sanitizers allow asset references and still block script URLs", () => {
  it("isDangerousUrl: a well-formed reference is allowed; anything else under the scheme is not", () => {
    expect(isDangerousUrl(REF)).toBe(false);
    expect(isDangerousUrl(`${REF}#gh-light-mode-only`)).toBe(false);
    expect(isDangerousUrl("pf-asset:javascript:alert(1)")).toBe(true);
    expect(isDangerousUrl("pf-asset:1234")).toBe(true);
    expect(isDangerousUrl("PF-ASSET:not-a-hash")).toBe(true);
    // Unchanged neighbours.
    expect(isDangerousUrl("javascript:alert(1)")).toBe(true);
    expect(isDangerousUrl("data:image/svg+xml,<svg onload=1>")).toBe(true);
    expect(isDangerousUrl("data:image/png;base64,iVBOR")).toBe(false);
  });

  it("sanitizeForIngest (import, card preview) keeps a reference and strips a script URL", () => {
    const out = sanitizeForIngest(`<p><img src="${REF}" alt="a"><img src="javascript:alert(1)" alt="b"><img src="pf-asset:javascript:x" alt="c"></p>`);
    const d = new DOMParser().parseFromString(out, "text/html");
    const imgs = [...d.querySelectorAll("img")];
    expect(imgs[0].getAttribute("src")).toBe(REF);
    expect(imgs[1].hasAttribute("src")).toBe(false);
    expect(imgs[2].hasAttribute("src")).toBe(false);
  });

  it("sanitizeCanonicalNode (JSON import, storage load) keeps references on both image nodes", () => {
    const node = sanitizeCanonicalNode({
      type: "doc",
      content: [
        { type: "image", attrs: { src: REF } },
        { type: "themeImage", attrs: { lightSrc: REF, darkSrc: "javascript:alert(1)" } },
        { type: "image", attrs: { src: "pf-asset:bogus" } },
      ],
    });
    expect(node.content[0].attrs.src).toBe(REF);
    expect(node.content[1].attrs.lightSrc).toBe(REF);
    expect(node.content[1].attrs.darkSrc).toBeUndefined();
    expect(node.content[2].attrs.src).toBeUndefined();
  });

  it("the paste sanitizer keeps a reference", () => {
    expect(sanitizePastedHtml(`<img src="${REF}">`)).toContain(REF);
    expect(sanitizePastedHtml(`<img src="javascript:alert(1)">`)).not.toContain("javascript:");
  });
});

describe("rendered HTML never hands a reference to a live <img>", () => {
  it("neutralizeAssetSrcs moves references off src/srcset and leaves other images alone", () => {
    const html = `<p><img src="${REF}" alt="a"><img src="https://x.test/a.png"></p><picture><source srcset="${REF}"><img src="${REF}#gh-dark-mode-only"></picture>`;
    const out = neutralizeAssetSrcs(html);
    expect(out).not.toMatch(/\ssrc="pf-asset:/);
    expect(out).not.toMatch(/\ssrcset="pf-asset:/);
    expect(out).toContain(`data-pf-asset-src="${REF}"`);
    expect(out).toContain(`data-pf-asset-srcset="${REF}"`);
    expect(out).toContain(`data-pf-asset-src="${REF}#gh-dark-mode-only"`);
    expect(out).toContain('src="https://x.test/a.png"');
  });
});
