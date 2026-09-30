import "fake-indexeddb/auto";
import { act, render } from "@testing-library/react";
import { createElement, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TiptapPane } from "../ui/TiptapPane";
import { assetStore, sha256Hex } from "../store/asset-store";
import { assetRef, bytesToDataUrl, collectImageSrcs } from "../store/asset-refs";
import { assetImagesKey } from "../extensions/AssetImages";

/**
 * Stored images in the LIVE rich pane (A086): shown through object URLs and
 * never through a `pf-asset:` src; a data: image the user brings in is stored
 * and re-pointed; a document load is not; an image file pasted is stored; a
 * copy carries the data.
 */

let n = 0;
function png(seed = 1, size = 4096) {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let i = 8; i < size; i++) b[i] = (seed * 29 + i * 3) & 0xff;
  return b;
}
const dataUrl = (seed) => bytesToDataUrl(png(seed), "image/png");

let mounted = null;
async function mount(html) {
  const ref = createRef();
  await act(async () => { mounted = render(createElement(TiptapPane, { ref, isDark: false, defaultValue: html })); });
  return ref.current.getEditor();
}
const liveImgs = (editor) => [...editor.view.dom.querySelectorAll("img:not(.ProseMirror-separator)")];

beforeEach(() => {
  assetStore._resetForTests({ useIndexedDB: true, dbName: `assets-editor-${++n}` });
  let i = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:test/${++i}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
});

describe("showing stored images", () => {
  it("a stored image is shown through an object URL — a live <img> never gets the reference", async () => {
    const hash = await assetStore.put(png(1), "image/png");
    // Every src ever given to an element, attached or not: an <img> in the
    // live document starts loading the moment its src is set, even detached,
    // and a `pf-asset:` load is a CSP violation.
    const assigned = [];
    const realSetAttr = Element.prototype.setAttribute;
    vi.spyOn(Element.prototype, "setAttribute").mockImplementation(function (name, value) {
      if (this.ownerDocument === document && String(name).toLowerCase() === "src") assigned.push(String(value));
      return realSetAttr.call(this, name, value);
    });
    const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      configurable: true,
      get() { return srcDesc.get.call(this); },
      set(v) { if (this.ownerDocument === document) assigned.push(String(v)); srcDesc.set.call(this, v); },
    });
    let editor;
    try {
      editor = await mount(`<p><img src="${assetRef(hash)}#gh-dark-mode-only" alt="chart" width="40"></p>`);
      await vi.waitFor(() => expect(liveImgs(editor)[0].getAttribute("src")).toMatch(/^blob:/));
    } finally {
      Object.defineProperty(HTMLImageElement.prototype, "src", srcDesc);
    }
    expect(assigned.filter((s) => s.startsWith("pf-asset:"))).toEqual([]);
    await vi.waitFor(() => expect(liveImgs(editor)[0].getAttribute("src")).toMatch(/^blob:test\/\d+#gh-dark-mode-only$/));
    const img = liveImgs(editor)[0];
    expect(img.getAttribute("alt")).toBe("chart");
    expect(img.getAttribute("width")).toBe("40");
    expect(img.hasAttribute("data-pf-asset-missing")).toBe(false);
    // Serialisation still carries the reference (it is what the markdown holds).
    expect(editor.getHTML()).toContain(`src="${assetRef(hash)}#gh-dark-mode-only"`);
  });

  it("a missing asset shows a visible 'Image unavailable' placeholder and never throws", async () => {
    const ghost = "7".repeat(64);
    const editor = await mount(`<p><img src="${assetRef(ghost)}" alt="lost chart"></p>`);
    await vi.waitFor(() => expect(liveImgs(editor)[0].hasAttribute("data-pf-asset-missing")).toBe(true));
    const img = liveImgs(editor)[0];
    expect(img.getAttribute("alt")).toBe("Image unavailable: lost chart");
    expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(img.getAttribute("src")).not.toContain("pf-asset:");
    // The document itself is untouched.
    expect(editor.getHTML()).toContain(assetRef(ghost));
  });

  it("the placeholder recovers when the asset arrives (a backup restored while it is open)", async () => {
    const bytes = png(2);
    const hash = await sha256Hex(bytes);
    const editor = await mount(`<p><img src="${assetRef(hash)}" alt="later"></p>`);
    await vi.waitFor(() => expect(liveImgs(editor)[0].hasAttribute("data-pf-asset-missing")).toBe(true));
    await assetStore.put(bytes, "image/png");
    await vi.waitFor(() => expect(liveImgs(editor)[0].getAttribute("src")).toMatch(/^blob:/));
    expect(liveImgs(editor)[0].getAttribute("alt")).toBe("later");
  });

  it("the object URL is released when the image leaves the document", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const hash = await assetStore.put(png(3), "image/png");
      const editor = await mount(`<p><img src="${assetRef(hash)}"></p>`);
      await vi.waitFor(() => expect(liveImgs(editor)[0].getAttribute("src")).toMatch(/^blob:/));
      await act(async () => { editor.commands.setContent("<p>gone</p>", { emitUpdate: false }); });
      vi.advanceTimersByTime(5000);
      expect(URL.revokeObjectURL).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a data: image the USER brings in is stored and re-pointed", () => {
  it("paste-style insertion: the node ends on a reference once the bytes have committed", async () => {
    const editor = await mount("<p>x</p>");
    await act(async () => { editor.chain().insertContent(`<img src="${dataUrl(4)}" alt="pasted">`).run(); });
    const hash = await sha256Hex(png(4));
    await vi.waitFor(() => expect(collectImageSrcs(editor.getJSON())).toEqual([assetRef(hash)]));
    expect(await assetStore.get(hash)).not.toBeNull();
    expect(editor.getHTML()).not.toContain("base64");
  });

  it("the rewrite is not an undo step: ⌘Z undoes the paste itself", async () => {
    const editor = await mount("<p>x</p>");
    await act(async () => { editor.chain().insertContent(`<img src="${dataUrl(5)}">`).run(); });
    const hash = await sha256Hex(png(5));
    await vi.waitFor(() => expect(collectImageSrcs(editor.getJSON())).toEqual([assetRef(hash)]));
    await act(async () => { editor.commands.undo(); });
    expect(collectImageSrcs(editor.getJSON())).toEqual([]);
  });

  it("a document LOAD (preventUpdate) is never rewritten — opening an old document leaves it alone", async () => {
    const editor = await mount("<p>x</p>");
    await act(async () => { editor.commands.setContent(`<p><img src="${dataUrl(6)}"></p>`, { emitUpdate: false }); });
    await new Promise((r) => setTimeout(r, 150));
    expect(collectImageSrcs(editor.getJSON())).toEqual([dataUrl(6)]);
    expect((await assetStore.stats()).count).toBe(0);
  });

  it("the rewrite does not land in a different document (the editor was re-hydrated meanwhile)", async () => {
    const editor = await mount("<p>x</p>");
    await act(async () => {
      editor.chain().insertContent(`<img src="${dataUrl(7)}">`).run();
      // A hydration re-creates the state (resetHistory) — a new document identity.
      const { EditorState } = await import("@tiptap/pm/state");
      editor.view.updateState(EditorState.create({ doc: editor.state.doc, plugins: editor.state.plugins }));
    });
    await vi.waitFor(async () => expect((await assetStore.stats()).count).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(collectImageSrcs(editor.getJSON())).toEqual([dataUrl(7)]);
  });

  it("read-only: nothing is rewritten", async () => {
    const editor = await mount("<p>x</p>");
    await act(async () => {
      editor.setEditable(false);
      editor.chain().insertContent(`<img src="${dataUrl(8)}">`).run();
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(collectImageSrcs(editor.getJSON())).toEqual([dataUrl(8)]);
  });

  it("with the store unavailable the image simply stays inline (the fallback)", async () => {
    assetStore._resetForTests();
    const editor = await mount("<p>x</p>");
    await act(async () => { editor.chain().insertContent(`<img src="${dataUrl(9)}">`).run(); });
    await new Promise((r) => setTimeout(r, 100));
    expect(collectImageSrcs(editor.getJSON())).toEqual([dataUrl(9)]);
  });

  it("a tiny data: image stays inline by design", async () => {
    const editor = await mount("<p>x</p>");
    const tiny = bytesToDataUrl(png(10, 64), "image/png");
    await act(async () => { editor.chain().insertContent(`<img src="${tiny}">`).run(); });
    await new Promise((r) => setTimeout(r, 100));
    expect(collectImageSrcs(editor.getJSON())).toEqual([tiny]);
  });
});

describe("image files pasted into the rich pane", () => {
  const pasteFiles = (editor, files, html = "") => {
    const event = { clipboardData: { files, getData: (t) => (t === "text/html" ? html : "") }, preventDefault() {} };
    let handled = false;
    editor.view.someProp("handlePaste", (f) => { if (!handled) handled = !!f(editor.view, event, null); return handled; });
    return handled;
  };
  const file = (bytes, name, type) => {
    const f = new Blob([bytes], { type });
    Object.defineProperty(f, "name", { value: name });
    f.arrayBuffer = () => Promise.resolve(bytes.slice().buffer);
    return f;
  };

  it("a pasted screenshot is stored and inserted as a reference", async () => {
    const editor = await mount("<p>x</p>");
    let handled;
    await act(async () => { handled = pasteFiles(editor, [file(png(11), "image.png", "image/png")]); });
    expect(handled).toBe(true);
    const hash = await sha256Hex(png(11));
    await vi.waitFor(() => expect(collectImageSrcs(editor.getJSON())).toEqual([assetRef(hash)]));
    // A clipboard screenshot's generic name says nothing: decorative alt.
    const img = editor.getJSON().content.flatMap((b) => b.content ?? []).find((c) => c.type === "image");
    expect(img.attrs.alt).toBe("");
  });

  it("with the store unavailable the file is inserted inline instead", async () => {
    assetStore._resetForTests();
    const editor = await mount("<p>x</p>");
    await act(async () => { pasteFiles(editor, [file(png(12), "diagram.png", "image/png")]); });
    await vi.waitFor(() => expect(collectImageSrcs(editor.getJSON())).toEqual([dataUrl(12)]));
  });

  it("a file pasted just before the document changes is not inserted into the next one", async () => {
    const editor = await mount("<p>x</p>");
    const { EditorState } = await import("@tiptap/pm/state");
    await act(async () => {
      pasteFiles(editor, [file(png(14), "late.png", "image/png")]);
      // A hydration lands while the file is being stored.
      editor.view.updateState(EditorState.create({ doc: editor.state.doc, plugins: editor.state.plugins }));
    });
    await vi.waitFor(async () => expect((await assetStore.stats()).count).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(collectImageSrcs(editor.getJSON())).toEqual([]);
  });

  it("files that are not all raster images are left to the default paste", async () => {
    const editor = await mount("<p>x</p>");
    expect(pasteFiles(editor, [file(new TextEncoder().encode("<svg/>"), "x.svg", "image/svg+xml")])).toBe(false);
  });
});

describe("copying rich content carries the image data", () => {
  it("the clipboard HTML has the data: image, not the reference, once the selection warmed it", async () => {
    const hash = await assetStore.put(png(13), "image/png");
    const editor = await mount(`<p>before <img src="${assetRef(hash)}" alt="c"> after</p>`);
    await act(async () => { editor.commands.selectAll(); });
    await vi.waitFor(() => expect(assetStore.peekDataUrl(hash)).toBeTruthy());
    const { dom } = editor.view.serializeForClipboard(editor.state.selection.content());
    const src = dom.querySelector("img").getAttribute("src");
    expect(src).toBe(dataUrl(13));
    // The document is untouched.
    expect(collectImageSrcs(editor.getJSON())).toEqual([assetRef(hash)]);
  });

  it("the plugin state carries a document identity that a hydration renews", async () => {
    const editor = await mount("<p>x</p>");
    const before = assetImagesKey.getState(editor.state).token;
    const { EditorState } = await import("@tiptap/pm/state");
    editor.view.updateState(EditorState.create({ doc: editor.state.doc, plugins: editor.state.plugins }));
    expect(assetImagesKey.getState(editor.state).token).not.toBe(before);
  });
});
