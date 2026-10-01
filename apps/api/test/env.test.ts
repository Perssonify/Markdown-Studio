import { describe, expect, it } from "vitest";
import { loadEnv, missingAuthSettings } from "../src/config/env.ts";

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
});
