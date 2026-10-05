// Vercel entry: the same app as a Vercel Function. The repository's
// vercel.json runs the API as the `api` service and routes /api/* to it, with
// the request's path unchanged (every route here is under /api). Settings are
// the project's environment variables — no Secrets Manager — and Vercel sets
// X-Forwarded-For itself (a client-supplied value is not passed on), which the
// relay's rate limit and the session record read.
import { buildApp } from "./bootstrap.ts";
import { loadEnv, withVercelSite } from "./config/env.ts";

// Fluid compute serves several requests at once from one instance.
const { app } = buildApp(loadEnv(withVercelSite(process.env)), { poolSize: 5 });

export default app;
