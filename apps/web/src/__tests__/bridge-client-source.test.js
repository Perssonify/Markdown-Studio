/**
 * An embed client must accept messages only from ITS OWN iframe. Origin does
 * not identify an instance: two editors on one host page share it, so either
 * could resolve the other's pending requests and reach its listeners.
 *
 * Found by the external code review recorded in docs/backlog.md (its F004).
 * Harness: exercise the exported client with two actual iframe Window objects.
 * Reverting the source guard delivers A's events to B, and lets A's response
 * settle B's equal request id. Both messages deliberately have the CORRECT
 * protocol and origin: another filter must not make the negative test vacuous.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditorClient } from "../integration/host-bridge";

const origin = "https://editor.example";
const clients = [];
const frames = [];
function fixture() {
  const frame = document.createElement("iframe");
  // about:blank creates a Window without loading an external resource. The
  // MessageEvent supplies the origin explicitly; no browser networking needed.
  document.body.appendChild(frame);
  frames.push(frame);
  const post = vi.spyOn(frame.contentWindow, "postMessage").mockImplementation(() => {});
  const client = createEditorClient(frame, origin);
  clients.push(client);
  return { frame, post, client };
}
function emit(frame, event, payload, senderOrigin = origin) {
  window.dispatchEvent(new MessageEvent("message", {
    source: frame.contentWindow, origin: senderOrigin,
    data: { type: "perssonify", event, payload },
  }));
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z")); });
afterEach(() => {
  for (const client of clients.splice(0)) client.destroy();
  for (const frame of frames.splice(0)) frame.remove();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
});

describe("F004: same-origin editor instances remain separate", () => {
  it("delivers onChange only to the client for the sending iframe", () => {
    const a = fixture(); const b = fixture();
    const seenA = vi.fn(); const seenB = vi.fn();
    a.client.on("onChange", seenA); b.client.on("onChange", seenB);
    emit(a.frame, "onChange", { docId: "a", markdown: "A only" });
    expect(seenA).toHaveBeenCalledExactlyOnceWith({ docId: "a", markdown: "A only" });
    expect(seenB).not.toHaveBeenCalled();
    emit(b.frame, "onChange", { docId: "b", markdown: "B only" });
    expect(seenA).toHaveBeenCalledOnce();
    expect(seenB).toHaveBeenCalledExactlyOnceWith({ docId: "b", markdown: "B only" });
  });

  it("still checks origin even when the sender Window is the expected one", () => {
    const a = fixture(); const seen = vi.fn();
    a.client.on("ready", seen);
    emit(a.frame, "ready", { rejected: true }, "https://other.example");
    expect(seen).not.toHaveBeenCalled();
    emit(a.frame, "ready", { accepted: true });
    expect(seen).toHaveBeenCalledExactlyOnceWith({ accepted: true });
  });

  it("does not settle another iframe's equal request id", async () => {
    const a = fixture(); const b = fixture();
    const seenA = vi.fn(); const seenB = vi.fn();
    const promiseA = a.client.call("getMarkdown").then(seenA);
    const promiseB = b.client.call("getMarkdown").then(seenB);
    const requestA = a.post.mock.calls[0][0].requestId;
    const requestB = b.post.mock.calls[0][0].requestId;
    // Per-client counters + the same millisecond produce this at the baseline.
    expect(requestA).toBe(requestB);
    try {
      emit(a.frame, "response", { requestId: requestA, result: { md: "A" } });
      await Promise.resolve();
      expect(seenA).toHaveBeenCalledExactlyOnceWith({ md: "A" });
      expect(seenB).not.toHaveBeenCalled();
    } finally {
      // Settle every request even on a failing baseline run, so timeouts cannot
      // turn an assertion failure into an unrelated unhandled rejection.
      emit(b.frame, "response", { requestId: requestB, result: { md: "B" } });
      await Promise.all([promiseA, promiseB]);
    }
    expect(seenB).toHaveBeenCalledExactlyOnceWith({ md: "B" });
  });
});
