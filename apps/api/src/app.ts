import { Hono } from "hono";
import { missingAuthSettings, type Env } from "./config/env/index.ts";
import type { Auth } from "./modules/auth/index.ts";
import { corsForFrontend } from "./middlewares/cors/index.ts";
import { requireOriginSecret } from "./middlewares/originVerify/index.ts";
import { authRoutes } from "./modules/auth/index.ts";
import { healthRoutes } from "./modules/health/index.ts";
import { importRelayRoutes } from "./modules/importRelay/index.ts";
import { publishedRoutes, syncRoutes, type SyncDeps } from "./modules/sync/index.ts";

export interface AppDeps {
  env: Env;
  /** One database round trip, or null when no database is configured. */
  pingDatabase: (() => Promise<void>) | null;
  /** One file-storage round trip, or null when no bucket is configured. */
  pingStorage: (() => Promise<void>) | null;
  /** Better Auth, or null until its settings are complete. */
  auth: Auth | null;
  /** Cloud sync of each user's library: needs the database, file storage and auth. */
  sync?: SyncDeps;
}

/**
 * The whole HTTP surface, independent of where it runs: src/server.ts serves
 * it with Node locally, src/lambda.ts on AWS Lambda behind CloudFront.
 */
export function createApp({ env, pingDatabase, pingStorage, auth, sync }: AppDeps): Hono {
  const app = new Hono();

  if (env.ORIGIN_VERIFY_SECRET) app.use("*", requireOriginSecret(env.ORIGIN_VERIFY_SECRET));

  // The relay first and outside the CORS middleware: it answers its own CORS.
  app.route("/", importRelayRoutes());

  app.use("*", corsForFrontend(env.CORS_ORIGINS));
  app.route("/", healthRoutes({ pingDatabase, pingStorage }));
  app.route("/", authRoutes(auth, missingAuthSettings(env)));
  app.route("/", syncRoutes(sync ?? { db: null, storage: null, userIdOf: null }) as unknown as Hono);
  app.route("/", publishedRoutes(sync ?? { db: null, storage: null }));

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error(JSON.stringify({ evt: "unhandled_error", path: c.req.path, message: err.message }));
    return c.json({ error: "internal_error" }, 500);
  });
  return app;
}
