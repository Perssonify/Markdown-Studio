import { Hono } from "hono";

type Ping = (() => Promise<void>) | null;

export interface HealthDeps {
  /** One round trip to the database, or null when DATABASE_URL is not set. */
  pingDatabase: Ping;
  /** One round trip to the file storage bucket, or null when S3_BUCKET is not set. */
  pingStorage: Ping;
}

type Check = "up" | "down" | "not_configured";

async function check(name: string, ping: Ping): Promise<Check> {
  if (!ping) return "not_configured";
  try {
    await ping();
    return "up";
  } catch (err) {
    console.error(JSON.stringify({ evt: `health_${name}_down`, message: err instanceof Error ? err.message : String(err) }));
    return "down";
  }
}

/**
 * GET /health — is the process up, and can it reach its database and its
 * file storage?
 *
 * 200 `{ status: "ok", db: "up", storage: "up" }` normally; a dependency that
 * is not set up reports `not_configured` (the API runs without either); 503
 * `{ status: "degraded", … "down" }` when a configured one does not answer, so
 * a load balancer or uptime check sees the outage. Also served as /api/health,
 * the path that reaches it through the site's CloudFront.
 */
export function healthRoutes({ pingDatabase, pingStorage }: HealthDeps): Hono {
  const app = new Hono();
  for (const path of ["/health", "/api/health"]) {
    app.get(path, async (c) => {
      const [db, storage] = await Promise.all([check("db", pingDatabase), check("storage", pingStorage)]);
      const down = db === "down" || storage === "down";
      c.header("Cache-Control", "no-store");
      return c.json({ status: down ? "degraded" : "ok", db, storage }, down ? 503 : 200);
    });
  }
  return app;
}
