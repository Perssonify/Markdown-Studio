import { describe, expect, it } from "vitest";
import { testApp } from "./helpers.ts";

const up = async () => {};
const down = async () => {
  throw new Error("connect ECONNREFUSED");
};

describe("GET /health", () => {
  it("answers ok with nothing configured, and says so", async () => {
    const res = await testApp().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "not_configured", storage: "not_configured" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("reports the database and storage up when they answer", async () => {
    const res = await testApp({}, { pingDatabase: up, pingStorage: up }).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "up", storage: "up" });
  });

  it("is 503 degraded when a configured database does not answer", async () => {
    const res = await testApp({}, { pingDatabase: down, pingStorage: up }).request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded", db: "down", storage: "up" });
  });

  it("is 503 degraded when configured storage does not answer", async () => {
    const res = await testApp({}, { pingDatabase: up, pingStorage: down }).request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded", db: "up", storage: "down" });
  });

  it("is also served at /api/health (the path CloudFront routes to the API)", async () => {
    const res = await testApp().request("/api/health");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("ok");
  });

  it("an unknown path is a JSON 404", async () => {
    const res = await testApp().request("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
