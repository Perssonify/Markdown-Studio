// AWS entry: the same app on Lambda, behind CloudFront (/api/* → the
// function URL). infra/lib/markdown-studio-stack.ts creates it.
import type { LambdaFunctionURLEvent, Context } from "aws-lambda";
import { handle } from "hono/aws-lambda";
import { buildApp } from "./bootstrap.ts";
import { loadEnv } from "./config/env/index.ts";
import { resolveSecretsIntoEnv } from "./lib/awsSecrets/index.ts";

type Handler = (event: LambdaFunctionURLEvent, context: Context) => Promise<unknown>;

let ready: Promise<Handler> | null = null;

async function init(): Promise<Handler> {
  await resolveSecretsIntoEnv(process.env);
  // One request at a time per Lambda instance: a pool of 2 leaves room for a
  // health ping beside the request's own query.
  const { app } = buildApp(loadEnv(process.env), { poolSize: 2 });
  return handle(app) as unknown as Handler;
}

/**
 * The address the relay's per-IP rate limit and Better Auth's session record
 * use. Behind CloudFront the request's own source is a CloudFront edge, and a
 * client can put anything in X-Forwarded-For, so it is replaced by
 * CloudFront-Viewer-Address ("ip:port"), which CloudFront sets itself — the
 * Lambda only accepts requests that came through CloudFront (origin-verify).
 */
export function trustViewerAddress(event: LambdaFunctionURLEvent): void {
  const headers = event.headers ?? (event.headers = {});
  const viewer = headers["cloudfront-viewer-address"];
  if (viewer) headers["x-forwarded-for"] = viewer.replace(/:\d+$/, "");
}

export async function handler(event: LambdaFunctionURLEvent, context: Context): Promise<unknown> {
  ready ??= init().catch((err) => {
    ready = null; // a failed cold start (secrets unreachable) retries on the next request
    throw err;
  });
  const run = await ready;
  trustViewerAddress(event);
  return run(event, context);
}
