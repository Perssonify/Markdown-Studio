import { Hono } from "hono";
import { AUTH_BASE_PATH, type Auth } from "../services/index.ts";

/**
 * /api/auth/* — handed to Better Auth. Until every setting it needs is
 * present (`missing`, by NAME only — never a value), each route answers 503
 * with what is missing, so a half-configured deploy says why sign-in is off
 * instead of failing somewhere inside the OAuth dance.
 */
export function authRoutes(auth: Auth | null, missing: readonly string[]): Hono {
  const app = new Hono();
  app.on(["GET", "POST"], `${AUTH_BASE_PATH}/*`, (c) => {
    if (!auth) return c.json({ error: "auth_not_configured", missing }, 503);
    return auth.handler(c.req.raw);
  });
  return app;
}
