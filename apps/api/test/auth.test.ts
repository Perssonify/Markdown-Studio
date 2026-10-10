import { createDatabase, type DatabaseHandle } from "@markdown-studio/db";
import { runMigrations } from "@markdown-studio/db/migrate";
import { freshTestDatabase } from "@markdown-studio/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env/index.ts";
import { authFromEnv } from "../src/modules/auth/index.ts";
import { FRONTEND, testApp } from "./helpers.ts";

describe("/api/auth before it is configured", () => {
  it("answers 503 and names what is missing (never a value)", async () => {
    const res = await testApp({ GOOGLE_CLIENT_ID: "id-only" }).request("/api/auth/get-session");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "auth_not_configured",
      missing: ["DATABASE_URL", "BETTER_AUTH_SECRET", "GOOGLE_CLIENT_SECRET"],
    });
  });
});

// Better Auth against a real Postgres with the committed migrations: CI's api
// job provides one; locally `bun run db:up` (TEST_DATABASE_URL in .env.example).
const server = process.env.TEST_DATABASE_URL;

describe.skipIf(!server)("/api/auth with Google configured", () => {
  let handle: DatabaseHandle;
  let app: ReturnType<typeof testApp>;
  const settings = {
    BETTER_AUTH_SECRET: "test-secret-".padEnd(40, "x"),
    GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    PUBLIC_URL: "http://localhost:4000",
  };

  beforeAll(async () => {
    const url = await freshTestDatabase(server!, "markdown_studio_test_api");
    handle = createDatabase({ url, max: 2 });
    await runMigrations(handle.pool);
    const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: url, ...settings });
    app = testApp({ DATABASE_URL: url, ...settings }, { auth: authFromEnv(env, handle.db), pingDatabase: () => handle.ping() });
  });
  afterAll(() => handle?.close());

  it("is up", async () => {
    const res = await app.request("/api/auth/ok");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("has no session for a visitor who has not signed in", async () => {
    const res = await app.request("/api/auth/get-session");
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("starts Google sign-in: a Google authorization URL, and the OAuth state stored in the database", async () => {
    const res = await app.request("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: FRONTEND },
      body: JSON.stringify({ provider: "google", callbackURL: `${FRONTEND}/` }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; redirect: boolean };
    const google = new URL(body.url);
    expect(google.origin).toBe("https://accounts.google.com");
    expect(google.searchParams.get("client_id")).toBe(settings.GOOGLE_CLIENT_ID);
    expect(google.searchParams.get("redirect_uri")).toBe("http://localhost:4000/api/auth/callback/google");
    expect(google.searchParams.get("prompt")).toBe("select_account");
    const { rows } = await handle.pool.query("select count(*)::int as n from verification");
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("refuses to start sign-in for a callback on an untrusted origin", async () => {
    const res = await app.request("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: FRONTEND },
      body: JSON.stringify({ provider: "google", callbackURL: "https://evil.example/" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("there is no email/password sign-in", async () => {
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: FRONTEND },
      body: JSON.stringify({ email: "a@example.com", password: "password123" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const { rows } = await handle.pool.query('select count(*)::int as n from "user"');
    expect(rows[0].n).toBe(0);
  });

  it("/health reports the database up", async () => {
    expect(await (await app.request("/health")).json()).toMatchObject({ status: "ok", db: "up" });
  });
});
