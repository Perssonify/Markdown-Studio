// Local entry: `bun run dev` (from the repo root, with the frontend) or
// `bun run --cwd apps/api dev`. Reads apps/api/.env when it exists.
import { serve } from "@hono/node-server";
import { buildApp } from "./bootstrap.ts";
import { loadEnv, missingAuthSettings } from "./config/env.ts";

const env = loadEnv();
const { app, database } = buildApp(env, { poolSize: 10 });

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`api: listening on http://localhost:${info.port} (health: /health)`);
  if (!env.DATABASE_URL) console.log("api: no DATABASE_URL — running without a database (bun run db:up starts one)");
  if (!env.S3_BUCKET) console.log("api: no S3_BUCKET — running without file storage (bun run db:up starts a local S3)");
  const missing = missingAuthSettings(env);
  if (missing.length) console.log(`api: Google sign-in is off until these are set: ${missing.join(", ")}`);
});

const shutdown = () => {
  server.close();
  void database?.close();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
