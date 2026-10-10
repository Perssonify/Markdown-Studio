import type { LambdaFunctionURLEvent } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { trustViewerAddress } from "../src/lambda.ts";
import { resolveSecretsIntoEnv } from "../src/lib/awsSecrets/index.ts";

const event = (headers: Record<string, string>) => ({ headers }) as unknown as LambdaFunctionURLEvent;

describe("trustViewerAddress", () => {
  it("replaces a client-supplied X-Forwarded-For with CloudFront's viewer address (IPv4)", () => {
    const e = event({ "x-forwarded-for": "1.2.3.4, 9.9.9.9", "cloudfront-viewer-address": "198.51.100.7:51234" });
    trustViewerAddress(e);
    expect(e.headers["x-forwarded-for"]).toBe("198.51.100.7");
  });

  it("strips the port from an IPv6 viewer address", () => {
    const e = event({ "cloudfront-viewer-address": "2001:db8::1:51234" });
    trustViewerAddress(e);
    expect(e.headers["x-forwarded-for"]).toBe("2001:db8::1");
  });

  it("leaves the request alone when CloudFront did not set the header", () => {
    const e = event({ "x-forwarded-for": "1.2.3.4" });
    trustViewerAddress(e);
    expect(e.headers["x-forwarded-for"]).toBe("1.2.3.4");
  });
});

describe("resolveSecretsIntoEnv", () => {
  const secrets: Record<string, string> = {
    db: JSON.stringify({ host: "db.internal", port: 5432, username: "markdown_studio", password: "p@ss/w:rd%", dbname: "markdown_studio" }),
    auth: JSON.stringify({ betterAuthSecret: "a".repeat(48) }),
    google: JSON.stringify({ clientId: "", clientSecret: "" }),
    origin: JSON.stringify({ value: "edge-secret" }),
  };
  const read = {
    secret: async (arn: string) => secrets[arn]!,
    parameter: async (name: string) => ({ "/markdown-studio/site-url": "https://d123.cloudfront.net/" })[name]!,
  };

  it("does nothing (and reads nothing) when no secret ARN is set", async () => {
    const env: Record<string, string | undefined> = {};
    const refuse = () => Promise.reject(new Error("must not be called"));
    await resolveSecretsIntoEnv(env, { secret: refuse, parameter: refuse });
    expect(env).toEqual({});
  });

  it("puts the site's URL first in CORS_ORIGINS and uses it as PUBLIC_URL", async () => {
    const env: Record<string, string | undefined> = { SITE_URL_PARAMETER: "/markdown-studio/site-url", CORS_ORIGINS: "https://markdownstudio.com" };
    await resolveSecretsIntoEnv(env, read);
    expect(env.PUBLIC_URL).toBe("https://d123.cloudfront.net");
    expect(env.CORS_ORIGINS).toBe("https://d123.cloudfront.net,https://markdownstudio.com");
  });

  it("builds DATABASE_URL from the RDS secret, escaping the password", async () => {
    const env: Record<string, string | undefined> = { DB_SECRET_ARN: "db", AUTH_SECRET_ARN: "auth", GOOGLE_SECRET_ARN: "google", ORIGIN_SECRET_ARN: "origin" };
    await resolveSecretsIntoEnv(env, read);
    const url = new URL(env.DATABASE_URL!);
    expect(url.hostname).toBe("db.internal");
    expect(decodeURIComponent(url.password)).toBe("p@ss/w:rd%");
    expect(url.pathname).toBe("/markdown_studio");
    expect(env.BETTER_AUTH_SECRET).toBe("a".repeat(48));
    expect(env.ORIGIN_VERIFY_SECRET).toBe("edge-secret");
    // Google not filled in yet: empty, so loadEnv treats it as unset and sign-in stays off.
    expect(env.GOOGLE_CLIENT_ID).toBe("");
  });
});
