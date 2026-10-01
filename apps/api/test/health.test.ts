import { describe, expect, it } from "vitest";
import { testApp } from "./helpers.ts";

describe("GET /health", () => {
  it("answers ok without a database, and says none is configured", async () => {
    const res = await testApp().request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "not_configured" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("reports the database up when it answers", async () => {
    const res = await testApp({}, { pingDatabase: async () => {} }).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "up" });
  });

  it("is 503 degraded when a configured database does not answer", async () => {
    const down = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const res = await testApp({}, { pingDatabase: down }).request("/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded", db: "down" });
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
