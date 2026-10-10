import "fake-indexeddb/auto";
import { act, render } from "@testing-library/react";
import { createElement, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeMirrorPane } from "../ui/CodeMirrorPane";
import { useUIStore } from "../store/preferences/uiStore";
import { assetStore, sha256Hex } from "../store/assets/asset-store";

/**
 * Stored images in the MARKDOWN pane (A086): the reference folds to its first
 * eight digits (a view — the text is untouched) and opens when the caret
 * touches it; an image file pasted or dropped is stored and inserted as
 * `![alt](pf-asset:…)`.
 */

const H = "0123456789abcdef".repeat(4);
let unmount;
let n = 0;
beforeEach(() => {
  useUIStore.setState({ readOnly: false });
  assetStore._resetForTests({ useIndexedDB: true, dbName: `assets-md-${++n}` });
});
afterEach(() => { unmount?.(); unmount = undefined; });

async function pane(doc) {
  const ref = createRef();
  await act(async () => { ({ unmount } = render(createElement(CodeMirrorPane, { ref, isDark: false, defaultValue: doc }))); });
  return ref.current.getView();
}

describe("folded references", () => {
  it("shows the first eight digits and an ellipsis, leaving the document text whole", async () => {
    const view = await pane(`intro\n\n![chart](pf-asset:${H})\n`);
    const line = [...view.contentDOM.querySelectorAll(".cm-line")].find((l) => l.textContent.includes("chart"));
    expect(line.textContent).toBe(`![chart](pf-asset:${H.slice(0, 8)}…)`);
    expect(line.querySelector(".cm-pf-asset-fold").title).toContain(H);
    expect(view.state.doc.toString()).toContain(`pf-asset:${H}`);
  });

  it("unfolds while the caret is inside it, so it can be edited like any text", async () => {
    const doc = `![chart](pf-asset:${H})`;
    const view = await pane(doc);
    await act(async () => { view.dispatch({ selection: { anchor: doc.indexOf("pf-asset") + 12 } }); });
    expect(view.contentDOM.querySelector(".cm-pf-asset-fold")).toBeNull();
    expect(view.contentDOM.textContent).toContain(H);
  });
});

describe("image files into the markdown pane", () => {
  const png = () => {
    const b = new Uint8Array(3000);
    b.set([0x89, 0x50, 0x4e, 0x47]);
    for (let i = 4; i < b.length; i++) b[i] = (i * 13) & 0xff;
    return b;
  };
  const file = (bytes, name) => {
    const f = new Blob([bytes], { type: "image/png" });
    Object.defineProperty(f, "name", { value: name });
    f.arrayBuffer = () => Promise.resolve(bytes.slice().buffer);
    return f;
  };
  const paste = (view, files, text = "") => {
    const e = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "clipboardData", { value: { files, getData: (t) => (t === "text/plain" ? text : "") } });
    view.contentDOM.dispatchEvent(e);
    return e;
  };

  it("a pasted image is stored and inserted as a reference", async () => {
    const view = await pane("start ");
    await act(async () => { view.dispatch({ selection: { anchor: 6 } }); });
    let e;
    await act(async () => { e = paste(view, [file(png(), "diagram.png")]); });
    expect(e.defaultPrevented).toBe(true);
    const hash = await sha256Hex(png());
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe(`start ![diagram](pf-asset:${hash})`));
    expect(await assetStore.get(hash)).not.toBeNull();
  });

  it("with the store unavailable the image goes in inline", async () => {
    assetStore._resetForTests();
    const view = await pane("");
    await act(async () => { paste(view, [file(png(), "diagram.png")]); });
    await vi.waitFor(() => expect(view.state.doc.toString()).toMatch(/^!\[diagram\]\(data:image\/png;base64,/));
  });

  it("text on the clipboard is pasted as text (CodeMirror's own paste), not as an image", async () => {
    const view = await pane("");
    await act(async () => { paste(view, [file(png(), "diagram.png")], "plain words"); });
    await new Promise((r) => setTimeout(r, 50));
    expect(view.state.doc.toString()).toBe("plain words");
    expect((await assetStore.stats()).count).toBe(0);
  });

  it("read-only: nothing is inserted or stored", async () => {
    useUIStore.setState({ readOnly: true });
    const view = await pane("ro");
    await act(async () => { paste(view, [file(png(), "diagram.png")]); });
    await new Promise((r) => setTimeout(r, 50));
    expect(view.state.doc.toString()).toBe("ro");
    expect((await assetStore.stats()).count).toBe(0);
  });
});
