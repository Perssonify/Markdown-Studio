import { Hono } from "hono";
import { missingAuthSettings, type Env } from "./config/env.ts";
import type { Auth } from "./lib/auth.ts";
import { corsForFrontend } from "./middleware/cors.ts";
import { requireOriginSecret } from "./middleware/origin-verify.ts";
import { authRoutes } from "./routes/auth.ts";
import { healthRoutes } from "./routes/health.ts";
import { importRelayRoutes } from "./routes/import-relay.ts";

export interface AppDeps {
  env: Env;
  /** One database round trip, or null when no database is configured. */
  pingDatabase: (() => Promise<void>) | null;
  /** Better Auth, or null until its settings are complete. */
  auth: Auth | null;
}

/**
 * The whole HTTP surface, independent of where it runs: src/server.ts serves
 * it with Node locally, src/lambda.ts on AWS Lambda behind CloudFront.
 */
export function createApp({ env, pingDatabase, auth }: AppDeps): Hono {
  const app = new Hono();

  if (env.ORIGIN_VERIFY_SECRET) app.use("*", requireOriginSecret(env.ORIGIN_VERIFY_SECRET));

  // The relay first and outside the CORS middleware: it answers its own CORS.
  app.route("/", importRelayRoutes());

  app.use("*", corsForFrontend(env.CORS_ORIGINS));
  app.route("/", healthRoutes({ pingDatabase }));
  app.route("/", authRoutes(auth, missingAuthSettings(env)));

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error(JSON.stringify({ evt: "unhandled_error", path: c.req.path, message: err.message }));
    return c.json({ error: "internal_error" }, 500);
  });
  return app;
}
