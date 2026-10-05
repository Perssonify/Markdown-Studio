import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.ts";

export { schema };

/**
 * How the connection is encrypted.
 * - `off`: plain TCP — the local Docker Postgres.
 * - `require`: TLS without verifying the certificate.
 * - `verify`: TLS with the certificate checked against the trusted CAs. RDS
 *   on Lambda: the runtime's bundle carries the RDS CAs once
 *   NODE_EXTRA_CA_CERTS points at it (infra sets that). Elsewhere (Vercel),
 *   `ca` passes the RDS certificates themselves.
 */
export type DatabaseSsl = "off" | "require" | "verify";

export interface DatabaseOptions {
  url: string;
  ssl?: DatabaseSsl;
  /** Pool size. A Lambda instance serves one request at a time, so 1–2 there. */
  max?: number;
  /** PEM certificates to verify the server against (with `verify`), instead of the default CAs. */
  ca?: string;
}

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  /** One round trip, bounded by `timeoutMs`. Throws when the database is unreachable. */
  ping(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

export function createDatabase({ url, ssl = "off", max = 10, ca }: DatabaseOptions): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString: url,
    ssl: ssl === "off" ? false : { rejectUnauthorized: ssl === "verify", ...(ssl === "verify" && ca ? { ca } : {}) },
    max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
  });
  // An idle client that loses its connection (a database restart, a failover)
  // emits 'error' on the pool; unhandled, that would crash the process.
  pool.on("error", (err) => {
    console.error(JSON.stringify({ evt: "db_pool_error", message: err.message }));
  });
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    async ping(timeoutMs = 2_000) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`database did not answer within ${timeoutMs} ms`)), timeoutMs);
      });
      try {
        await Promise.race([pool.query("select 1"), timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
    close: () => pool.end(),
  };
}
