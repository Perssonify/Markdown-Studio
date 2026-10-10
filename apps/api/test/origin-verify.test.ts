import { describe, expect, it } from "vitest";
import { ORIGIN_VERIFY_HEADER } from "../src/middlewares/originVerify/index.ts";
import { testApp } from "./helpers.ts";

const SECRET = "s3cret-from-cloudfront";

describe("behind CloudFront (ORIGIN_VERIFY_SECRET set)", () => {
  const app = testApp({ ORIGIN_VERIFY_SECRET: SECRET });

  it("refuses a request without the header, or with the wrong value", async () => {
    expect((await app.request("/api/health")).status).toBe(403);
    expect((await app.request("/api/health", { headers: { [ORIGIN_VERIFY_HEADER]: "nope" } })).status).toBe(403);
    expect((await app.request("/api/import?url=x", { headers: { [ORIGIN_VERIFY_HEADER]: "nope" } })).status).toBe(403);
  });

  it("admits a request CloudFront forwarded", async () => {
    const res = await app.request("/api/health", { headers: { [ORIGIN_VERIFY_HEADER]: SECRET } });
    expect(res.status).toBe(200);
  });

  it("leaves /health open, so the function can be probed directly", async () => {
    expect((await app.request("/health")).status).toBe(200);
  });
});

describe("without ORIGIN_VERIFY_SECRET (local)", () => {
  it("does not ask for the header", async () => {
    expect((await testApp().request("/api/health")).status).toBe(200);
  });
});
