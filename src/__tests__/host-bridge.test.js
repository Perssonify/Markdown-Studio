import { describe, it, expect, vi, afterEach } from "vitest";
import { createHostBridge } from "../integration/host-bridge";

const ORIGIN = "https://host.test";

function makeHandle() {
  return {
    setDocuments: vi.fn(),
    setFieldSchemas: vi.fn(),
    setTheme: vi.fn(),
    setMode: vi.fn(),
    setAccent: vi.fn(),
    openDocument: vi.fn(),
    setChrome: vi.fn(),
    addDocuments: vi.fn(async () => ({ ids: ["x1"] })),
    updateDocument: vi.fn(async () => ({ id: "a", updated: true })),
    appendToDocument: vi.fn(async () => ({ id: "a", updated: true })),
    importContent: vi.fn(),
    setAssociations: vi.fn(),
    getCanonicalDocument: vi.fn(() => ({})),
    getMarkdown: vi.fn(() => ""),
    getHTML: vi.fn(() => ""),
    getGraph: vi.fn(() => ({ nodes: [], edges: [] })),
    copyAsPrompt: vi.fn(),
    getDocuments: vi.fn(() => []),
    getActiveDocument: vi.fn(() => null),
  };
}

function dispatch(action, payload, origin = ORIGIN) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "perssonify", action, payload, requestId: "r1" },
      origin,
    })
  );
  // handleMessage is async; let the microtask queue flush.
  return new Promise((r) => setTimeout(r, 0));
}

let bridge;
afterEach(() => {
  bridge?.destroy();
  bridge = undefined;
});

describe("host bridge actions", () => {
  it("routes setMode / setAccent / openDocument to the handle", async () => {
    const handle = makeHandle();
    bridge = createHostBridge({ current: handle }, { allowedOrigins: [ORIGIN] });

    await dispatch("setMode", { mode: "md" });
    await dispatch("setAccent", { accent: "blue" });
    await dispatch("openDocument", { docId: "doc-42" });

    expect(handle.setMode).toHaveBeenCalledWith("md");
    expect(handle.setAccent).toHaveBeenCalledWith("blue");
    expect(handle.openDocument).toHaveBeenCalledWith("doc-42");
  });

  it("routes setChrome to the handle (chrome or level key)", async () => {
    const handle = makeHandle();
    bridge = createHostBridge({ current: handle }, { allowedOrigins: [ORIGIN] });
    await dispatch("setChrome", { chrome: "none" });
    expect(handle.setChrome).toHaveBeenCalledWith("none");
    await dispatch("setChrome", { level: "minimal" });
    expect(handle.setChrome).toHaveBeenCalledWith("minimal");
  });

  it("refuses a view mode or chrome level the handle's type does not accept, with an error reply", async () => {
    // The handle's `setMode`/`setChrome` take literal unions (A113); a message
    // is untyped, so the bridge is where an unknown value is turned away. It
    // used to be stored as the view mode, which no pane renders.
    const handle = makeHandle();
    bridge = createHostBridge({ current: handle }, { allowedOrigins: [ORIGIN] });
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const post = vi.spyOn(frame.contentWindow, "postMessage").mockImplementation(() => {});
    const send = (action, payload, requestId) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "perssonify", action, payload, requestId },
          origin: ORIGIN,
          source: frame.contentWindow,
        }),
      );
      return new Promise((r) => setTimeout(r, 0));
    };
    const reply = (requestId) => post.mock.calls.map(([msg]) => msg.payload).find((p) => p?.requestId === requestId);
    try {
      await send("setMode", { mode: "rich" }, "m1");
      await send("setChrome", { chrome: "compact" }, "c1");
      expect(handle.setMode).not.toHaveBeenCalled();
      expect(handle.setChrome).not.toHaveBeenCalled();
      expect(reply("m1")).toMatchObject({ error: "Unknown view mode: rich" });
      expect(reply("c1")).toMatchObject({ error: "Unknown chrome level: compact" });

      await send("setMode", { mode: "split" }, "m2");
      expect(handle.setMode).toHaveBeenCalledWith("split");
      expect(reply("m2")).toMatchObject({ result: { ok: true } });
    } finally {
      frame.remove();
    }
  });

  it("routes updateDocument with id + patch fields to the handle", async () => {
    const handle = makeHandle();
    bridge = createHostBridge({ current: handle }, { allowedOrigins: [ORIGIN] });
    await dispatch("updateDocument", { id: "a", title: "T", markdown: "# T" });
    expect(handle.updateDocument).toHaveBeenCalledWith("a", {
      title: "T",
      markdown: "# T",
      canonical: undefined,
    });
  });

  it("routes appendToDocument (id via id or docId) to the handle", async () => {
    const handle = makeHandle();
    bridge = createHostBridge({ current: handle }, { allowedOrigins: [ORIGIN] });
    await dispatch("appendToDocument", { docId: "a", markdown: "more" });
    expect(handle.appendToDocument).toHaveBeenCalledWith("a", "more");
  });

  it("routes addDocuments with the docs payload to the handle", async () => {
    const handle = makeHandle();
    bridge = createHostBridge({ current: handle }, { allowedOrigins: [ORIGIN] });
    const docs = [{ id: "a", markdown: "# A" }, { title: "B", markdown: "# B" }];
    await dispatch("addDocuments", { docs });
    expect(handle.addDocuments).toHaveBeenCalledWith(docs);
  });

  it("accepts openDocument via `id` as well as `docId`", async () => {
    const handle = makeHandle();
    bridge = createHostBridge({ current: handle }, { allowedOrigins: [ORIGIN] });
    await dispatch("openDocument", { id: "doc-7" });
    expect(handle.openDocument).toHaveBeenCalledWith("doc-7");
  });

  it("ignores messages from disallowed origins", async () => {
    const handle = makeHandle();
    bridge = createHostBridge({ current: handle }, { allowedOrigins: [ORIGIN] });
    await dispatch("setMode", { mode: "html" }, "https://evil.test");
    expect(handle.setMode).not.toHaveBeenCalled();
  });

  it("does not throw when the handle ref is still null", async () => {
    bridge = createHostBridge({ current: null }, { allowedOrigins: [ORIGIN] });
    await expect(dispatch("getGraph", {})).resolves.toBeUndefined();
  });
});
