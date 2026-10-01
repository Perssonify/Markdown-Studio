import { createDatabase, type DatabaseHandle } from "@markdown-studio/db";
import type { Hono } from "hono";
import { createApp } from "./app.ts";
import type { Env } from "./config/env.ts";
import { authFromEnv } from "./lib/auth.ts";

/** The app plus what it opened, so a caller can close the database on shutdown. */
export function buildApp(env: Env, { poolSize }: { poolSize: number }): { app: Hono; database: DatabaseHandle | null } {
  const database = env.DATABASE_URL ? createDatabase({ url: env.DATABASE_URL, ssl: env.DATABASE_SSL, max: poolSize }) : null;
  const app = createApp({
    env,
    pingDatabase: database ? () => database.ping() : null,
    auth: authFromEnv(env, database?.db ?? null),
  });
  return { app, database };
}
