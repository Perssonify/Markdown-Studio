// Run by `bun run build` after bundling: do the bundles actually start?
// Type-checking and unit tests run the TypeScript sources; this runs the
// deployable output — the Lambda handler with a function-URL event, and the
// Node server over a real socket — so a bundling mistake (a missed external,
// CommonJS interop) fails the build instead of a deploy.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

for (const k of ["DATABASE_URL", "DB_SECRET_ARN", "AUTH_SECRET_ARN", "GOOGLE_SECRET_ARN", "ORIGIN_SECRET_ARN", "ORIGIN_VERIFY_SECRET"]) {
  delete process.env[k];
}

const fail = (msg) => {
  console.error(`smoke-bundle: ${msg}`);
  process.exit(1);
};

function urlEvent(path, headers = {}) {
  return {
    version: "2.0",
    rawPath: path,
    rawQueryString: "",
    headers: { host: "example.lambda-url.us-east-1.on.aws", ...headers },
    requestContext: { http: { method: "GET", path, sourceIp: "203.0.113.9" }, domainName: "example.lambda-url.us-east-1.on.aws" },
    isBase64Encoded: false,
  };
}

// ── Lambda ──────────────────────────────────────────────────────────────────
const { handler } = await import(new URL("../dist/lambda/index.mjs", import.meta.url));
const health = await handler(urlEvent("/health"), {});
if (health.statusCode !== 200 || JSON.parse(health.body).status !== "ok") fail(`lambda /health → ${JSON.stringify(health)}`);
// The relay is bundled and running: a request without Sec-Fetch-Site is refused by ITS rule.
const relay = await handler(urlEvent("/api/import"), {});
if (relay.statusCode !== 403 || !/first-party/.test(relay.body)) fail(`lambda /api/import → ${JSON.stringify(relay)}`);
const { handler: migrate } = await import(new URL("../dist/lambda/migrate.mjs", import.meta.url));
if (typeof migrate !== "function") fail("lambda migrate handler is not exported");

// ── Node server ─────────────────────────────────────────────────────────────
const port = await new Promise((resolve) => {
  const s = createServer().listen(0, () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
const child = spawn(process.execPath, [new URL("../dist/server.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "inherit"],
});
try {
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  const deadline = Date.now() + 15_000;
  while (!out.includes("listening")) {
    if (Date.now() > deadline) fail(`server did not start: ${out}`);
    if (child.exitCode !== null) fail(`server exited ${child.exitCode}: ${out}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  const body = await res.json();
  if (res.status !== 200 || body.status !== "ok") fail(`server /health → ${res.status} ${JSON.stringify(body)}`);
} finally {
  child.kill();
  if (child.exitCode === null) await once(child, "exit");
}
console.log("smoke-bundle: lambda and server bundles start and answer /health");
