/**
 * On Lambda, configuration that is secret — or that only exists after deploy —
 * is read at cold start rather than stored in the function's settings, where
 * anyone allowed to view the function could read it. infra passes names:
 *
 * - DB_SECRET_ARN — the RDS-generated credentials
 *   (`{ host, port, username, password, dbname }`) → DATABASE_URL
 * - AUTH_SECRET_ARN — `{ betterAuthSecret }` → BETTER_AUTH_SECRET
 * - GOOGLE_SECRET_ARN — `{ clientId, clientSecret }` → GOOGLE_CLIENT_ID/SECRET
 *   (empty strings until the Google OAuth client is filled in; sign-in stays
 *   off until then)
 * - ORIGIN_SECRET_ARN — `{ value }` → ORIGIN_VERIFY_SECRET
 * - SITE_URL_PARAMETER — an SSM parameter holding the site's public URL
 *   (the CloudFront address, or the custom domain) → PUBLIC_URL, and first in
 *   CORS_ORIGINS. A parameter, because the URL is only known once CloudFront
 *   exists, and CloudFront already depends on this function.
 *
 * Locally none of these are set and this does nothing.
 */
type EnvBag = Record<string, string | undefined>;

export interface AwsReaders {
  secret(arn: string): Promise<string>;
  parameter(name: string): Promise<string>;
}

async function defaultReaders(): Promise<AwsReaders> {
  // Provided by the Lambda Node.js runtime; the bundle leaves @aws-sdk/* external.
  const sm = await import("@aws-sdk/client-secrets-manager");
  const ssm = await import("@aws-sdk/client-ssm");
  const secrets = new sm.SecretsManagerClient({});
  const params = new ssm.SSMClient({});
  return {
    async secret(arn) {
      const out = await secrets.send(new sm.GetSecretValueCommand({ SecretId: arn }));
      if (!out.SecretString) throw new Error(`secret ${arn} has no string value`);
      return out.SecretString;
    },
    async parameter(name) {
      const out = await params.send(new ssm.GetParameterCommand({ Name: name }));
      if (!out.Parameter?.Value) throw new Error(`parameter ${name} has no value`);
      return out.Parameter.Value;
    },
  };
}

const KEYS = ["DB_SECRET_ARN", "AUTH_SECRET_ARN", "GOOGLE_SECRET_ARN", "ORIGIN_SECRET_ARN", "SITE_URL_PARAMETER"];

export async function resolveSecretsIntoEnv(env: EnvBag, readers?: AwsReaders): Promise<void> {
  if (!KEYS.some((k) => env[k])) return;
  const read = readers ?? (await defaultReaders());
  const json = async (key: string): Promise<Record<string, unknown>> => JSON.parse(await read.secret(env[key]!));

  if (env.DB_SECRET_ARN) {
    const s = await json("DB_SECRET_ARN");
    const url = new URL("postgres://placeholder");
    url.hostname = String(s.host);
    url.port = String(s.port ?? 5432);
    url.username = encodeURIComponent(String(s.username));
    url.password = encodeURIComponent(String(s.password));
    url.pathname = `/${String(s.dbname ?? "postgres")}`;
    env.DATABASE_URL = url.toString();
  }
  if (env.AUTH_SECRET_ARN) env.BETTER_AUTH_SECRET = String((await json("AUTH_SECRET_ARN")).betterAuthSecret ?? "");
  if (env.GOOGLE_SECRET_ARN) {
    const g = await json("GOOGLE_SECRET_ARN");
    env.GOOGLE_CLIENT_ID = String(g.clientId ?? "");
    env.GOOGLE_CLIENT_SECRET = String(g.clientSecret ?? "");
  }
  if (env.ORIGIN_SECRET_ARN) env.ORIGIN_VERIFY_SECRET = String((await json("ORIGIN_SECRET_ARN")).value ?? "");
  if (env.SITE_URL_PARAMETER) {
    const site = (await read.parameter(env.SITE_URL_PARAMETER)).replace(/\/+$/, "");
    env.PUBLIC_URL = site;
    env.CORS_ORIGINS = [site, ...(env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)].join(",");
  }
}
