import { Hono } from "hono";
// The relay's one copy (see src/utils/vercelHandler/index.ts). Its security rules —
// SSRF allowlist, pinned DNS, Sec-Fetch-Site, its own two-origin CORS, size
// and time caps — are documented in apps/web/docs/import-relay.md and tested
// in apps/web/src/__tests__/import-relay*.test.js.
import relayHandler from "../../../../../web/api/import.js";
import { runVercelHandler, type VercelLikeHandler } from "../../../utils/vercelHandler/index.ts";

/**
 * GET /api/import?url=… — the frontend's URL-import relay, the same path the
 * frontend already calls (apps/web/src/store/url-import.ts). It answers its
 * own CORS and OPTIONS, so the app-wide CORS middleware is NOT applied here:
 * widening the relay's origins would loosen a security control.
 */
export function importRelayRoutes(): Hono {
  const app = new Hono();
  app.all("/api/import", (c) => runVercelHandler(relayHandler as VercelLikeHandler, c.req.raw));
  return app;
}
