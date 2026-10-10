/**
 * `openDocument` must resolve when the switch has settled, not on dispatch —
 * and an async failure must reach the error reply rather than report success.
 *
 * Found by the external code review recorded in docs/backlog.md (its F005).
 * Harness: keep the REAL integration wrapper and host bridge in the test. Only
 * the core editor's asynchronous navigation boundary and presentation shells
 * are faked. Reverting EITHER the wrapper's returned promise or the bridge's
 * await acknowledges early and loses rejected navigation errors.
 */
import React, { createRef } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerssonifyEditorIntegration } from "../integration/PerssonifyEditorIntegration";
import { createHostBridge } from "../integration/host-bridge";

const inner = vi.hoisted(() => ({ openDocument: vi.fn() }));
vi.mock("../PerssonifyEditor", async () => {
  const { useImperativeHandle } = await import("react");
  return { PerssonifyEditor: function CoreBoundary({ _integrationRef }) {
    useImperativeHandle(_integrationRef, () => ({ openDocument: inner.openDocument }), []);
    return null;
  } };
});
vi.mock("next-themes", () => ({ ThemeProvider: ({ children }) => children }));
vi.mock("../ui/shared/errorBoundary", () => ({ ErrorBoundary: ({ children }) => children }));

function deferred() {
  let resolve; let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  // The unfixed wrapper drops this promise; observe a rejection so the old
  // implementation fails the response assertion rather than global error handling.
  promise.catch(() => {});
  return { promise, resolve, reject };
}
const cleanups = [];
function mounted() {
  const gate = deferred();
  inner.openDocument.mockReturnValue(gate.promise);
  const ref = createRef();
  render(<PerssonifyEditorIntegration ref={ref} />);
  return { gate, ref };
}
function requestThroughBridge(ref) {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const post = vi.spyOn(frame.contentWindow, "postMessage").mockImplementation(() => {});
  const registrations = vi.spyOn(window, "addEventListener");
  const bridge = createHostBridge(ref, { allowedOrigins: ["https://host.example"] });
  const handler = registrations.mock.calls.filter(([name]) => name === "message").at(-1)[1];
  cleanups.push(() => { bridge.destroy(); frame.remove(); });
  const event = new MessageEvent("message", {
    origin: "https://host.example", source: frame.contentWindow,
    data: { type: "perssonify", action: "openDocument", payload: { docId: "b" }, requestId: "open-b" },
  });
  // Invoke the registered async listener directly to await its completion;
  // dispatchEvent intentionally does not return an async listener's promise.
  const delivery = handler(event);
  const responses = () => post.mock.calls.filter(([msg]) => msg.event === "response");
  return { delivery, responses };
}

beforeEach(() => { vi.useFakeTimers(); inner.openDocument.mockReset(); });
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
  cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

describe("F005: openDocument preserves completion through both public layers", () => {
  it("returns the core navigation completion from the React handle", async () => {
    const f = mounted();
    const navigation = f.ref.current.openDocument("b");
    try {
      expect(navigation).toBeInstanceOf(Promise);
      expect(inner.openDocument).toHaveBeenCalledExactlyOnceWith("b");
    } finally { f.gate.resolve(); await navigation; }
  });

  it("does not send success before navigation settles", async () => {
    const f = mounted(); const request = requestThroughBridge(f.ref);
    try {
      // Also yields once: adding await only in the bridge still acknowledges
      // after this microtask when the unfixed wrapper returns undefined.
      await Promise.resolve();
      expect(request.responses()).toEqual([]);
    } finally { f.gate.resolve(); await request.delivery; }
    expect(request.responses()).toHaveLength(1);
    expect(request.responses()[0][0].payload).toEqual({ requestId: "open-b", result: { ok: true } });
    expect(request.responses()[0][1]).toBe("https://host.example");
  });

  it("returns an error response when asynchronous navigation fails", async () => {
    const f = mounted(); const request = requestThroughBridge(f.ref);
    f.gate.reject(new Error("target read failed"));
    await request.delivery;
    expect(request.responses()).toHaveLength(1);
    expect(request.responses()[0][0].payload).toEqual({ requestId: "open-b", error: "target read failed" });
  });
});
