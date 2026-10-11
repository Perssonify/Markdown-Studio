import { describe, expect, it } from "vitest";
import { FRONTEND, testApp } from "../fixtures/index.ts";

const preflight = (path: string, origin: string) =>
  testApp().request(path, {
    method: "OPTIONS",
    headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
  });

describe("CORS for the frontend", () => {
  it("grants a listed origin, with credentials", async () => {
    const res = await preflight("/health", FRONTEND);
    expect(res.headers.get("access-control-allow-origin")).toBe(FRONTEND);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("grants nothing to an origin that is not listed", async () => {
    const res = await preflight("/health", "https://evil.example");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("an ordinary GET from a listed origin carries the grant", async () => {
    const res = await testApp().request("/health", { headers: { Origin: FRONTEND } });
    expect(res.headers.get("access-control-allow-origin")).toBe(FRONTEND);
  });

  it("CORS_ORIGINS replaces the defaults", async () => {
    const app = testApp({ CORS_ORIGINS: "https://markdownstudio.com" });
    const local = await app.request("/health", { headers: { Origin: FRONTEND } });
    expect(local.headers.get("access-control-allow-origin")).toBeNull();
    const prod = await app.request("/health", { headers: { Origin: "https://markdownstudio.com" } });
    expect(prod.headers.get("access-control-allow-origin")).toBe("https://markdownstudio.com");
  });

  // The relay's CORS is a security control of its own (only the two
  // production origins may read relayed bytes cross-origin). The app-wide
  // middleware must not widen it to the dev origins.
  it("is NOT applied to the import relay, which keeps its own rule", async () => {
    const dev = await preflight("/api/import", FRONTEND);
    expect(dev.status).toBe(204);
    expect(dev.headers.get("access-control-allow-origin")).toBeNull();
    const prod = await preflight("/api/import", "https://markdownstudio.com");
    expect(prod.headers.get("access-control-allow-origin")).toBe("https://markdownstudio.com");
  });
});
