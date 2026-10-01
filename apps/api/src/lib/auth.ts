import type { Database } from "@markdown-studio/db";
import { schema } from "@markdown-studio/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Env } from "../config/env.ts";

export const AUTH_BASE_PATH = "/api/auth";

export interface AuthSettings {
  db: Database;
  secret: string;
  publicUrl: string;
  trustedOrigins: readonly string[];
  google: { clientId: string; clientSecret: string };
}

/**
 * Accounts, Google sign-in only. Better Auth serves every route under
 * /api/auth (sign-in, the Google callback, session, sign-out) and keeps users,
 * sessions and the Google account link in Postgres (packages/db/src/schema/auth.ts).
 *
 * Email and password are off: Google is the only way in. The Google OAuth
 * client must list `${publicUrl}/api/auth/callback/google` as an authorized
 * redirect URI.
 */
export function createAuth(s: AuthSettings) {
  return betterAuth({
    appName: "Markdown Studio",
    baseURL: s.publicUrl,
    basePath: AUTH_BASE_PATH,
    secret: s.secret,
    trustedOrigins: [...s.trustedOrigins],
    database: drizzleAdapter(s.db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: { enabled: false },
    // Validate every callback / redirect URL (and, with a cookie, the Origin)
    // against trustedOrigins in EVERY environment. Better Auth's default skips
    // this whenever it detects a test run, so a suite would pass an open
    // redirect that production refuses — or refuse nothing at all if the
    // detection ever misfired in production.
    advanced: { disableOriginCheck: false },
    socialProviders: {
      google: {
        clientId: s.google.clientId,
        clientSecret: s.google.clientSecret,
        // Always show the account chooser: a shared computer should not sign
        // the next person in as whoever used it last.
        prompt: "select_account",
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Auth when every setting it needs is present, else null (the routes then answer 503). */
export function authFromEnv(env: Env, db: Database | null): Auth | null {
  if (!db || !env.BETTER_AUTH_SECRET || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return createAuth({
    db,
    secret: env.BETTER_AUTH_SECRET,
    publicUrl: env.PUBLIC_URL,
    trustedOrigins: env.CORS_ORIGINS,
    google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
  });
}
