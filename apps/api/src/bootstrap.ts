import { createDatabase, type DatabaseHandle } from "@markdown-studio/db";
import type { Hono } from "hono";
import { createApp } from "./app.ts";
import type { Env } from "./config/env.ts";
import { authFromEnv } from "./lib/auth.ts";
import { storageFromEnv, type Storage } from "./lib/storage.ts";

/** The app plus what it opened, so a caller can close the database on shutdown. */
export function buildApp(
  env: Env,
  { poolSize }: { poolSize: number },
): { app: Hono; database: DatabaseHandle | null; storage: Storage | null } {
  const database = env.DATABASE_URL ? createDatabase({ url: env.DATABASE_URL, ssl: env.DATABASE_SSL, max: poolSize }) : null;
  const storage = storageFromEnv(env);
  const auth = authFromEnv(env, database?.db ?? null);
  const app = createApp({
    env,
    pingDatabase: database ? () => database.ping() : null,
    pingStorage: storage ? () => storage.ping() : null,
    auth,
    sync: {
      db: database?.db ?? null,
      storage,
      userIdOf: auth ? async (c) => (await auth.api.getSession({ headers: c.req.raw.headers }))?.user.id ?? null : null,
    },
  });
  return { app, database, storage };
}
