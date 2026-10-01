import { Hono } from "hono";

export interface HealthDeps {
  /** One round trip to the database, or null when DATABASE_URL is not set. */
  pingDatabase: (() => Promise<void>) | null;
}

/**
 * GET /health — is the process up, and can it reach its database?
 *
 * 200 `{ status: "ok", db: "up" }` normally; 200 with `db: "not_configured"`
 * when no database is set (the scaffold runs without one); 503
 * `{ status: "degraded", db: "down" }` when a configured database does not
 * answer, so a load balancer or uptime check sees the outage. Also served as
 * /api/health, the path that reaches it through the site's CloudFront.
 */
export function healthRoutes({ pingDatabase }: HealthDeps): Hono {
  const app = new Hono();
  const check = async () => {
    if (!pingDatabase) return { code: 200 as const, body: { status: "ok", db: "not_configured" } };
    try {
      await pingDatabase();
      return { code: 200 as const, body: { status: "ok", db: "up" } };
    } catch (err) {
      console.error(JSON.stringify({ evt: "health_db_down", message: err instanceof Error ? err.message : String(err) }));
      return { code: 503 as const, body: { status: "degraded", db: "down" } };
    }
  };
  for (const path of ["/health", "/api/health"]) {
    app.get(path, async (c) => {
      const { code, body } = await check();
      c.header("Cache-Control", "no-store");
      return c.json(body, code);
    });
  }
  return app;
}
