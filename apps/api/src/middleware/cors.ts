import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";

/**
 * CORS for the frontend's origins (CORS_ORIGINS): credentials allowed, so a
 * session cookie can ride along once the frontend signs in. An origin not on
 * the list gets no Access-Control-Allow-Origin at all.
 *
 * In production the site and the API share one origin through CloudFront
 * (/api/* → this app), so this matters for local development (Vite on :5173,
 * the API on :4000) and any origin listed explicitly.
 */
export function corsForFrontend(origins: readonly string[]): MiddlewareHandler {
  const allowed = new Set(origins);
  return cors({
    origin: (origin) => (allowed.has(origin) ? origin : null),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  });
}
