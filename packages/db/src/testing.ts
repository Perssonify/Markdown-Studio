import pg from "pg";

/**
 * A fresh, empty database for one test suite, created next to the one
 * `serverUrl` names (it needs CREATE DATABASE, which the Docker and CI
 * Postgres superuser has). Each package's suite gets its own, so Turbo can run
 * them side by side without one dropping the other's tables.
 */
export async function freshTestDatabase(serverUrl: string, name: string): Promise<string> {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`test database name must be [a-z0-9_]: ${name}`);
  const admin = new pg.Client({ connectionString: serverUrl });
  await admin.connect();
  try {
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.toString();
}
