import { describe, expect, it } from "vitest";
import { loadEnv, missingAuthSettings, withVercelSite } from "../src/config/env/index.ts";

describe("loadEnv", () => {
  it("runs with nothing set: port 4000, the frontend's local origins, no database", () => {
    const env = loadEnv({});
    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:5173", "http://localhost:4173"]);
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.DATABASE_SSL).toBe("off");
  });

  it("splits and trims CORS_ORIGINS", () => {
    expect(loadEnv({ CORS_ORIGINS: " https://a.example , https://b.example ," }).CORS_ORIGINS).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("treats an empty value as unset (a blank line in .env)", () => {
    const env = loadEnv({ DATABASE_URL: "", GOOGLE_CLIENT_ID: "  " });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it("names every invalid setting in one error", () => {
    expect(() => loadEnv({ PORT: "abc", DATABASE_URL: "not a url", BETTER_AUTH_SECRET: "short" })).toThrow(
      /PORT[\s\S]*DATABASE_URL[\s\S]*BETTER_AUTH_SECRET/,
    );
  });

  it("lists what Google sign-in still needs, by name", () => {
    expect(missingAuthSettings(loadEnv({}))).toEqual([
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
    ]);
    const complete = loadEnv({
      DATABASE_URL: "postgres://u:p@localhost:5440/db",
      BETTER_AUTH_SECRET: "x".repeat(32),
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
    });
    expect(missingAuthSettings(complete)).toEqual([]);
  });

  // RDS from Vercel: the runtime does not trust Amazon's RDS CAs, so they come
  // in a setting — often pasted on one line with literal "\n"s.
  it("reads DATABASE_CA as PEM, with literal \"\\n\"s as line breaks", () => {
    const pem = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----";
    expect(loadEnv({ DATABASE_CA: pem }).DATABASE_CA).toBe(pem);
    expect(loadEnv({ DATABASE_CA: pem.replaceAll("\n", "\\n") }).DATABASE_CA).toBe(pem);
    expect(loadEnv({}).DATABASE_CA).toBeUndefined();
  });

  it("on Vercel, takes the site's address from the project's production URL unless it is set", () => {
    const vercel = { VERCEL_PROJECT_PRODUCTION_URL: "markdown-studio.vercel.app" };
    const env = loadEnv(withVercelSite(vercel));
    expect(env.PUBLIC_URL).toBe("https://markdown-studio.vercel.app");
    expect(env.CORS_ORIGINS).toEqual(["https://markdown-studio.vercel.app"]);
    const set = loadEnv(withVercelSite({ ...vercel, PUBLIC_URL: "https://example.com", CORS_ORIGINS: "https://example.com" }));
    expect([set.PUBLIC_URL, set.CORS_ORIGINS]).toEqual(["https://example.com", ["https://example.com"]]);
    // Elsewhere nothing changes.
    expect(withVercelSite({ PORT: "4000" })).toEqual({ PORT: "4000" });
  });
});
