import { createApp, type AppDeps } from "../src/app.ts";
import { loadEnv } from "../src/config/env.ts";

/** The app with test settings: no database and no auth unless a case supplies them. */
export function testApp(overrides: Record<string, string> = {}, deps: Partial<Omit<AppDeps, "env">> = {}) {
  const env = loadEnv({ NODE_ENV: "test", ...overrides });
  return createApp({ env, pingDatabase: null, pingStorage: null, auth: null, ...deps });
}

export const FRONTEND = "http://localhost:5173";
