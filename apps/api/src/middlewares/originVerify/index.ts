import type { MiddlewareHandler } from "hono";
import { timingSafeEqual } from "node:crypto";

export const ORIGIN_VERIFY_HEADER = "x-origin-verify";

/**
 * Behind CloudFront, refuse requests that did not come through it. CloudFront
 * adds a secret header to every request it forwards to the Lambda; the
 * Lambda's own URL is public, so without this anyone could skip the CDN and
 * its security headers. `/health` stays open so the function can be probed
 * directly.
 */
export function requireOriginSecret(secret: string): MiddlewareHandler {
  const expected = Buffer.from(secret);
  return async (c, next) => {
    if (c.req.path === "/health") return next();
    const got = Buffer.from(c.req.header(ORIGIN_VERIFY_HEADER) ?? "");
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
      return c.json({ error: "forbidden" }, 403);
    }
    return next();
  };
}
