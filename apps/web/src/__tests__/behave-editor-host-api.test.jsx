/**
 * A108 — the host API (`useHostApi`): what a library host or the iframe bridge
 * can do to the editor, checked against the adapter ("disk"), the panes and the
 * downloads it starts. The integration and the bridge both drive exactly this
 * handle.
 *
 * One mount; the cases are one journey (see behave-harness.jsx).
 */
import { createRef } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react/pure";
import {
  act, captureDownloads, heading, installBrowserStubs, mdText, menuClick, mountEditor, onDisk, outsideAct, para, readBlobBytes,
  readBlobText, richEditor, seededAdapter, store, storedDoc, textOf, typeRich, until, untilHydrated,
  untilMdHas, untilRichHas,
} from "./behave-harness";
import { useUIStore } from "../store/uiStore";

vi.setConfig({ testTimeout: 30000 });

const handle = createRef();
const onGraphUpdate = vi.fn();
let adapter;
let downloads;
let warn;
let err;

beforeAll(async () => {
  installBrowserStubs();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
  downloads = captureDownloads();
  adapter = await seededAdapter([
    storedDoc("home", "Home", [heading(1, "Home"), para("home body")], { updated: "2026-09-03T10:00:00.000Z" }),
    storedDoc("side", "Side", [heading(1, "Side"), para("side body")], { updated: "2026-09-01T10:00:00.000Z" }),
  ]);
  await mountEditor({ storageAdapter: adapter, _integrationRef: handle, _onIntegrationGraphUpdate: onGraphUpdate });
  await until(() => store().hydratedDocId, "a document to open");
  if (store().activeDocId !== "home") await act(async () => { await handle.current.openDocument("home"); });
  await untilHydrated("home");
}, 30000);

afterAll(() => { cleanup(); downloads.restore(); warn.mockRestore(); err.mockRestore(); });

const h = () => handle.current;

describe("reading", () => {
  it("hands back the open document in every representation", async () => {
    await untilMdHas("home body");
    expect(h().getMarkdown()).toContain("# Home");
    expect(h().getMarkdown()).toContain("home body");
    expect(h().getHTML()).toMatch(/<h1[^>]*>Home<\/h1>/);
    expect(textOf(h().getCanonical())).toContain("home body");
    expect(h().getActiveDocument().id).toBe("home");
    expect(h().getDocuments().map((d) => d.id).sort()).toEqual(["home", "side"]);
    expect((await h().getDocById("side")).title).toBe("Side");
    expect(h().getFidelityReport()?.lossless).toBe(true);
  });
});

describe("adding documents", () => {
  it("addDocuments persists each one, opens the last, and reports the new graph", async () => {
    onGraphUpdate.mockClear();
    let res;
    await act(async () => {
      res = await h().addDocuments([
        { id: "api-one", markdown: "# One from host\n\nsee [[Two from host]]" },
        { id: "api-two", title: "Two from host", canonical: { type: "doc", content: [para("two body")] } },
      ]);
    });
    expect(res.ids).toEqual(["api-one", "api-two"]);
    expect(textOf((await onDisk(adapter, "api-one")).canonical)).toContain("see ");
    expect((await onDisk(adapter, "api-two")).title).toBe("Two from host");
    // The last one is OPEN — in the store and in the panes.
    await untilHydrated("api-two");
    await untilRichHas("two body");
    // …and the host heard about the link between them.
    const graph = onGraphUpdate.mock.calls.at(-1)[0];
    expect(graph.edges.some((e) => e.source === "api-one" && e.target === "api-two")).toBe(true);
    expect(h().getGraph().edges.some((e) => e.source === "api-one" && e.target === "api-two")).toBe(true);
  });

  it("is idempotent by id, and the deprecated setDocuments adds instead of doing nothing", async () => {
    const count = (await adapter.list()).length;
    let res;
    await act(async () => { res = await h().addDocuments([{ id: "api-one", markdown: "# Changed?" }]); });
    expect(res.ids).toEqual(["api-one"]);
    expect((await adapter.list()).length).toBe(count);
    expect(textOf((await onDisk(adapter, "api-one")).canonical)).not.toContain("Changed?");

    await act(async () => { res = await h().setDocuments(["# Legacy string doc\n\nlegacy body"]); });
    expect(res.ids).toHaveLength(1);
    expect(textOf((await onDisk(adapter, res.ids[0])).canonical)).toContain("legacy body");
    expect((await adapter.list()).length).toBe(count + 1);
  });

  it("importContent opens HTML and ProseMirror JSON as new saved documents", async () => {
    let doc;
    await act(async () => { doc = await h().importContent("<h1>Pasted page</h1><p>html <strong>body</strong></p>", "html"); });
    await untilHydrated(doc.id);
    await untilMdHas("html **body**");
    expect(textOf((await onDisk(adapter, doc.id)).canonical)).toContain("html ");
  });
});

describe("changing documents", () => {
  it("updateDocument refuses an unknown id rather than creating one", async () => {
    const count = (await adapter.list()).length;
    let res;
    await act(async () => { res = await h().updateDocument("no-such-doc", { markdown: "x" }); });
    expect(res).toEqual({ id: "no-such-doc", updated: false });
    await act(async () => { res = await h().updateDocument("", { markdown: "x" }); });
    expect(res.updated).toBe(false);
    expect((await adapter.list()).length).toBe(count);
  });

  it("a body update to a BACKGROUND document writes it without touching the open one", async () => {
    await act(async () => { await h().openDocument("home"); });
    await untilHydrated("home");
    let res;
    await act(async () => { res = await h().updateDocument("side", { markdown: "# Side\n\nrewritten by the host" }); });
    expect(res).toEqual({ id: "side", updated: true });
    expect(textOf((await onDisk(adapter, "side")).canonical)).toContain("rewritten by the host");
    expect(store().activeDocId).toBe("home");
    expect(richEditor().getText()).toContain("home body");
    expect(richEditor().getText()).not.toContain("rewritten by the host");
  });

  it("a body update to the OPEN document shows in both panes", async () => {
    await act(async () => { await h().updateDocument("home", { markdown: "# Home\n\nreplaced while open", title: "Home v2" }); });
    await untilRichHas("replaced while open");
    await untilMdHas("replaced while open");
    const disk = await onDisk(adapter, "home");
    expect(textOf(disk.canonical)).toContain("replaced while open");
    expect(disk.title).toBe("Home v2");
    // A title-only update renames without rewriting the body.
    await act(async () => { await h().updateDocument("home", { title: "Home v3" }); });
    const renamed = await onDisk(adapter, "home");
    expect(renamed.title).toBe("Home v3");
    expect(textOf(renamed.canonical)).toContain("replaced while open");
  });

  it("appendToDocument on the open document keeps what the user just typed", async () => {
    await typeRich(" typed but not yet saved");
    await act(async () => { await h().appendToDocument("home", "appended by the host"); });
    await untilRichHas("appended by the host");
    const disk = textOf((await onDisk(adapter, "home")).canonical);
    expect(disk).toContain("typed but not yet saved");
    expect(disk).toContain("appended by the host");
    // …in that order: the append lands at the end.
    expect(disk.indexOf("typed but not yet saved")).toBeLessThan(disk.indexOf("appended by the host"));
  });

  it("appendToDocument on a background document appends to what is stored", async () => {
    let res;
    await act(async () => { res = await h().appendToDocument("side", "- a list item from the host"); });
    expect(res.updated).toBe(true);
    const disk = textOf((await onDisk(adapter, "side")).canonical);
    expect(disk).toContain("rewritten by the host");
    expect(disk).toContain("a list item from the host");
    expect((await h().appendToDocument("nope", "x")).updated).toBe(false);
  });
});

describe("presentation", () => {
  it("setMode and setChrome change what is on screen", async () => {
    await act(async () => { h().setMode("md"); });
    expect(useUIStore.getState().mode).toBe("md");
    await act(async () => { h().setMode("split"); });
    expect(useUIStore.getState().mode).toBe("split");

    expect(document.querySelector('[data-tour="menubar"]')).not.toBeNull();
    await act(async () => { h().setChrome("minimal"); });
    await until(() => document.querySelector('[data-tour="menubar"]') === null, "the menu bar to go");
    // Minimal keeps a slim title strip naming the open document.
    expect(document.querySelector(".perssonify-editor").textContent).toContain("Home v3");
    await act(async () => { h().setChrome("none"); });
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    await act(async () => { h().setChrome("full"); });
    await until(() => document.querySelector('[data-tour="menubar"]'), "the menu bar to return");
  });
});

describe("exporting", () => {
  it("exportAs writes the open document as HTML, JSON, Markdown and Word", async () => {
    await act(async () => { await h().exportAs("html"); });
    let f = downloads.last();
    expect(f.name).toBe("home-v3.html");
    const html = await readBlobText(f.blob);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("<title>Home v3</title>");
    expect(html).toContain("appended by the host");

    await act(async () => { await h().exportAs("json"); });
    f = downloads.last();
    expect(f.name).toBe("home-v3.json");
    const env = JSON.parse(await readBlobText(f.blob));
    expect(env._format).toBe("perssonify-document");
    expect(env.id).toBe("home");
    expect(env.title).toBe("Home v3");
    expect(textOf(env.canonical)).toContain("appended by the host");

    await act(async () => { await h().exportAs("md"); });
    f = downloads.last();
    expect(f.name).toBe("home-v3.md");
    expect(await readBlobText(f.blob)).toContain("appended by the host");

    await act(async () => { await h().exportAs("docx"); });
    f = await until(() => downloads.named(/\.docx$/)[0], "the Word download");
    const bytes = new Uint8Array(await readBlobBytes(f.blob));
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK"); // a real .docx is a ZIP
  });
});

describe("erasing", () => {
  it("clearLocalData empties the library and the editor", async () => {
    await act(async () => { await h().clearLocalData(); });
    expect(await adapter.list()).toEqual([]);
    await until(() => /No document open/.test(document.body.textContent), "the empty state");
    expect(store().documents).toEqual([]);
  });

  it("with NO editor mounted, updateDocument still writes the document (it opens it to convert)", async () => {
    // A document stored behind the editor's back — the embed-with-nothing-open case.
    await adapter.save(storedDoc("late", "Late", [para("late body")]));
    expect(richEditor()).toBeNull();
    // Not inside act(): the path mounts the editor and then waits for it.
    const res = await outsideAct(() => h().updateDocument("late", { markdown: "# Late\n\nconverted without an open editor" }));
    expect(res).toEqual({ id: "late", updated: true });
    expect(textOf((await onDisk(adapter, "late")).canonical)).toContain("converted without an open editor");
    expect(mdText()).toContain("converted without an open editor");
  });

  it("with NO editor mounted, appendToDocument appends to the stored markdown", async () => {
    await menuClick("File", "Close document");
    await until(() => richEditor() === null, "the editor to unmount");
    const res = await outsideAct(() => h().appendToDocument("late", "and one more line"));
    expect(res).toEqual({ id: "late", updated: true });
    const disk = textOf((await onDisk(adapter, "late")).canonical);
    expect(disk).toContain("converted without an open editor");
    expect(disk).toContain("and one more line");
  });
});
