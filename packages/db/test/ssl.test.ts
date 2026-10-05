import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/index.ts";

// How each DATABASE_SSL setting reaches pg. Creating the pool connects to
// nothing, so this needs no database.
const sslOf = (...args: Parameters<typeof createDatabase>) => {
  const handle = createDatabase(...args);
  const ssl = (handle.pool as unknown as { options: { ssl: unknown } }).options.ssl;
  void handle.close();
  return ssl;
};
const url = "postgres://u:p@db.example.com:5432/markdown_studio";

describe("the database connection's TLS", () => {
  it("is off, unverified or verified as asked", () => {
    expect(sslOf({ url, ssl: "off" })).toBe(false);
    expect(sslOf({ url, ssl: "require" })).toEqual({ rejectUnauthorized: false });
    expect(sslOf({ url, ssl: "verify" })).toEqual({ rejectUnauthorized: true });
  });

  it("verifies against the given certificates (RDS from Vercel), and only when verifying", () => {
    expect(sslOf({ url, ssl: "verify", ca: "PEM" })).toEqual({ rejectUnauthorized: true, ca: "PEM" });
    expect(sslOf({ url, ssl: "require", ca: "PEM" })).toEqual({ rejectUnauthorized: false });
  });
});
