import { z } from "zod";

const list = z
  .string()
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );

const optional = z
  .string()
  .optional()
  .transform((s) => (s && s.trim() ? s.trim() : undefined));

/**
 * Every setting the API reads, validated once at startup. Locally they come
 * from apps/api/.env (see .env.example); on AWS, infra sets them on the Lambda
 * and the secrets are read from Secrets Manager (src/lambda.ts).
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  /** The browser origins allowed to call the API cross-origin (the frontend). */
  CORS_ORIGINS: list.default(["http://localhost:5173", "http://localhost:4173"]),

  /** Where a browser reaches this API; Better Auth builds its callback URLs from it. */
  PUBLIC_URL: z.url().default("http://localhost:4000"),

  DATABASE_URL: optional.pipe(z.url().optional()),
  DATABASE_SSL: z.enum(["off", "require", "verify"]).default("off"),

  /** Signs session cookies. At least 32 characters; `openssl rand -base64 32`. */
  BETTER_AUTH_SECRET: optional.pipe(z.string().min(32).optional()),
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,

  /**
   * Set only behind CloudFront: the value CloudFront adds as `x-origin-verify`,
   * so a request that skipped the CDN (straight to the Lambda URL) is refused.
   */
  ORIGIN_VERIFY_SECRET: optional,

  /** The documents bucket. Nothing reads it yet; it is wired for the sync feature. */
  S3_BUCKET: optional,
});

export type Env = z.infer<typeof EnvSchema>;

/** Parse `source` (process.env by default); throws one readable error listing every bad key. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid API configuration:\n${issues}`);
  }
  return parsed.data;
}

/** The settings Google sign-in still needs, by name (never by value). */
export function missingAuthSettings(env: Env): string[] {
  const missing: string[] = [];
  if (!env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!env.BETTER_AUTH_SECRET) missing.push("BETTER_AUTH_SECRET");
  if (!env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  return missing;
}
