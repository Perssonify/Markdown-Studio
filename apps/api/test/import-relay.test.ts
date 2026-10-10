import { describe, expect, it } from "vitest";
import { runVercelHandler, type VercelLikeHandler } from "../src/utils/vercelHandler/index.ts";
import { testApp } from "./helpers.ts";

// The relay's own behaviour is tested where it lives
// (apps/web/src/__tests__/import-relay*.test.js). These cases prove the API
// RUNS it — that its rules reach a caller through the adapter — and that the
// adapter carries every kind of answer the relay gives.

const relay = (query: string, init: RequestInit = {}) => testApp().request(`/api/import${query}`, init);
const firstParty = { "Sec-Fetch-Site": "same-origin" };

describe("GET /api/import runs the frontend's relay", () => {
  it("refuses a request that is not first-party (its Sec-Fetch-Site rule)", async () => {
    const res = await relay("?url=https://example.com/a.md");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only first-party requests are allowed." });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("refuses an internal host (its SSRF rule), before any network access", async () => {
    const res = await relay("?url=http://localhost/secret", { headers: firstParty });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "That host can't be imported." });
  });

  it("refuses a non-standard port and a missing url", async () => {
    expect((await relay("?url=https://example.com:8443/x", { headers: firstParty })).status).toBe(400);
    expect((await relay("", { headers: firstParty })).status).toBe(400);
  });

  it("answers GET only", async () => {
    const res = await relay("?url=https://example.com/a.md", { method: "POST", headers: firstParty });
    expect(res.status).toBe(405);
  });
});

describe("runVercelHandler", () => {
  const request = (path: string, init?: RequestInit) => new Request(`http://api.test${path}`, init);

  it("passes method, lower-cased headers and the query (repeated keys as arrays)", async () => {
    let seen: unknown;
    const h: VercelLikeHandler = (req, res) => {
      seen = req;
      res.status(204).end();
    };
    const res = await runVercelHandler(h, request("/x?url=a&tag=1&tag=2", { headers: { "X-Thing": "v" } }));
    expect(res.status).toBe(204);
    expect(seen).toMatchObject({ method: "GET", url: "/x?url=a&tag=1&tag=2", headers: { "x-thing": "v" }, query: { url: "a", tag: ["1", "2"] } });
  });

  it("json(): the status, a JSON body and its content type", async () => {
    const res = await runVercelHandler((_q, r) => r.status(418).json({ a: 1 }), request("/"));
    expect(res.status).toBe(418);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual({ a: 1 });
  });

  it("send(Buffer): the exact bytes and the headers the handler set", async () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255]);
    const h: VercelLikeHandler = (_q, r) => {
      r.setHeader("Content-Type", "application/octet-stream");
      r.setHeader("X-Upstream-Content-Type", "text/markdown");
      r.status(200).send(bytes);
    };
    const res = await runVercelHandler(h, request("/"));
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(bytes));
    expect(res.headers.get("x-upstream-content-type")).toBe("text/markdown");
  });

  it("an async handler is awaited", async () => {
    const h: VercelLikeHandler = async (_q, r) => {
      await new Promise((ok) => setTimeout(ok, 5));
      r.status(201).json({ late: true });
    };
    const res = await runVercelHandler(h, request("/"));
    expect(res.status).toBe(201);
  });
});
