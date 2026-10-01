import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as triggers from "aws-cdk-lib/triggers";
import type { Construct } from "constructs";
import { assertUniformHeaders, readVercelConfig, spaRewrite, type Header } from "./site-config.ts";
import { rewriteFunctionCode, siteFiles } from "./spa-rewrite.ts";

export interface MarkdownStudioStackProps extends cdk.StackProps {
  /** The built website: apps/web/dist-app (sourcemaps already moved out). */
  webDist: string;
  /** The bundled Lambda handlers: apps/api/dist/lambda. */
  apiLambdaDist: string;
  /** apps/web/vercel.json — the site's headers and rewrite. */
  vercelConfig: string;
  /**
   * Origins besides the site's own that may call the API with credentials and
   * receive Google sign-in callbacks (the production domains, once they point
   * here). The site's own address is always first.
   */
  extraOrigins?: string[];
  /**
   * Serve the site on its own domain(s) instead of only the CloudFront
   * address: an ACM certificate in us-east-1 covering every name, and DNS
   * pointing each name at the distribution (infra/README.md ▸ The domain).
   * The first name becomes the site's URL.
   */
  domain?: { names: string[]; certificateArn: string };
}

export const SITE_URL_PARAMETER = "/markdown-studio/site-url";
export const ORIGIN_VERIFY_HEADER = "x-origin-verify";

/**
 * Markdown Studio on AWS — one stack:
 *
 *   browser ──► CloudFront ─┬─ /*      → S3 (the website, private, via OAC)
 *                           └─ /api/*  → Lambda function URL (the API)
 *                                           │ private subnets
 *                                           ├─► RDS PostgreSQL 17 (isolated subnets)
 *                                           └─► NAT instance ─► internet
 *                                               (Google OAuth, the import relay)
 *
 * The site and the API share one origin, so the frontend's existing
 * relative call to /api/import works unchanged and auth cookies are
 * first-party. Cost-shaped: one t4g.micro database, a t4g.nano NAT instance
 * instead of a NAT gateway (~$3 vs ~$32 a month), Lambda instead of an
 * always-on server.
 */
export class MarkdownStudioStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MarkdownStudioStackProps) {
    super(scope, id, props);
    cdk.Tags.of(this).add("project", "markdown-studio");
    const vercel = readVercelConfig(props.vercelConfig);
    const headers = assertUniformHeaders(vercel);

    // ── Network ─────────────────────────────────────────────────────────────
    const nat = ec2.NatProvider.instanceV2({
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
      defaultAllowedTraffic: ec2.NatTrafficDirection.OUTBOUND_ONLY,
      associatePublicIpAddress: true,
      // Standard credits: a runaway workload is throttled, never billed extra.
      creditSpecification: ec2.CpuCredits.STANDARD,
      userData: natUserData(),
    });
    const vpc = new ec2.Vpc(this, "Vpc", {
      ipAddresses: ec2.IpAddresses.cidr("10.60.0.0/16"),
      maxAzs: 2,
      natGateways: 1,
      natGatewayProvider: nat,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "app", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: "data", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    nat.connections.allowFrom(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.allTraffic(), "private subnets reach the internet through it");

    const apiSg = new ec2.SecurityGroup(this, "ApiSecurityGroup", { vpc, description: "Markdown Studio API (Lambda)", allowAllOutbound: true });
    const dbSg = new ec2.SecurityGroup(this, "DatabaseSecurityGroup", { vpc, description: "Markdown Studio database", allowAllOutbound: false });
    dbSg.addIngressRule(apiSg, ec2.Port.tcp(5432), "the API and the migration function");

    // ── Database ────────────────────────────────────────────────────────────
    // The password lives in its own secret, kept with the database: a retained
    // database whose credentials had been deleted could not be reached. (A
    // generated name: a fixed one outlives a failed first deploy and then
    // blocks every retry with "already exists".)
    const dbCredentials = new rds.DatabaseSecret(this, "DatabaseCredentials", {
      username: "markdown_studio",
      // Characters that would need escaping in a URL or a shell.
      excludeCharacters: " %+~`#$&*()|[]{}:;<>?!'/@\"\\",
    });
    dbCredentials.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    const database = new rds.DatabaseInstance(this, "Database", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.of("17.11", "17") }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      credentials: rds.Credentials.fromSecret(dbCredentials),
      databaseName: "markdown_studio",
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: false,
      publiclyAccessible: false,
      caCertificate: rds.CaCertificate.RDS_CA_RSA2048_G1,
      backupRetention: cdk.Duration.days(7),
      deleteAutomatedBackups: false,
      // CloudFormation NEVER deletes the database: not on a failed deploy's
      // rollback, not on a stack delete, not on a replacement. RETAIN leaves
      // it behind in every one of those cases, and deletion protection stops
      // anything else. Removing a database is a deliberate human act in the
      // console, never a side effect of infrastructure code.
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoMinorVersionUpgrade: true,
    });

    // ── Secrets (values never in the template or the function's settings) ─
    const authSecret = new secretsmanager.Secret(this, "AuthSecret", {
      description: "Better Auth signing secret (rotating it signs everyone out)",
      generateSecretString: { secretStringTemplate: "{}", generateStringKey: "betterAuthSecret", passwordLength: 48, excludePunctuation: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    // Created with empty values; the Google OAuth client's ID and secret are
    // put in afterwards (infra/README.md). Generated, so CloudFormation sets
    // the value only once and a later deploy never overwrites real keys.
    const googleSecret = new secretsmanager.Secret(this, "GoogleOAuthSecret", {
      description: "Google OAuth client for sign-in: {clientId, clientSecret}",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ clientId: "", clientSecret: "" }),
        generateStringKey: "unused",
        passwordLength: 8,
        excludePunctuation: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const originSecret = new secretsmanager.Secret(this, "OriginVerifySecret", {
      description: "Header CloudFront adds so the API refuses requests that skipped it",
      generateSecretString: { secretStringTemplate: "{}", generateStringKey: "value", passwordLength: 40, excludePunctuation: true },
    });

    // ── Storage ─────────────────────────────────────────────────────────────
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    // For the documents feature. Nothing reads or writes it yet.
    const documentsBucket = new s3.Bucket(this, "DocumentsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: cdk.Duration.days(7) },
        { noncurrentVersionExpiration: cdk.Duration.days(30) },
      ],
    });

    // ── API (Lambda) ────────────────────────────────────────────────────────
    const code = lambda.Code.fromAsset(props.apiLambdaDist, { exclude: ["*.map"] });
    const shared = {
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      code,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [apiSg],
      environment: {
        NODE_ENV: "production",
        DATABASE_SSL: "verify",
        // The runtime's CA bundle, which carries the RDS certificate authorities.
        NODE_EXTRA_CA_CERTS: "/var/runtime/ca-cert.pem",
        DB_SECRET_ARN: database.secret!.secretArn,
      },
    };
    const apiLogs = new logs.LogGroup(this, "ApiLogs", { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.DESTROY });
    const api = new lambda.Function(this, "Api", {
      ...shared,
      description: "Markdown Studio API (apps/api)",
      handler: "index.handler",
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      logGroup: apiLogs,
      environment: {
        ...shared.environment,
        AUTH_SECRET_ARN: authSecret.secretArn,
        GOOGLE_SECRET_ARN: googleSecret.secretArn,
        ORIGIN_SECRET_ARN: originSecret.secretArn,
        SITE_URL_PARAMETER,
        CORS_ORIGINS: (props.extraOrigins ?? []).join(","),
      },
    });
    for (const s of [database.secret!, authSecret, googleSecret, originSecret]) s.grantRead(api);
    api.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        // Built from the name, not the parameter resource: the parameter
        // depends on CloudFront, which depends on this function.
        resources: [this.formatArn({ service: "ssm", resource: "parameter", resourceName: SITE_URL_PARAMETER.slice(1) })],
      }),
    );
    const apiUrl = api.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    // Migrations run on every deploy that changes the code, after the
    // database exists and before the API function is updated.
    const migrateLogs = new logs.LogGroup(this, "MigrateLogs", { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.DESTROY });
    const migrate = new triggers.TriggerFunction(this, "Migrate", {
      ...shared,
      description: "Markdown Studio database migrations (packages/db/drizzle)",
      handler: "migrate.handler",
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      logGroup: migrateLogs,
      executeAfter: [database, ...nat.gatewayInstances],
      executeBefore: [api],
      executeOnHandlerChange: true,
    });
    database.secret!.grantRead(migrate);

    // ── CloudFront ──────────────────────────────────────────────────────────
    const siteOrigin = origins.S3BucketOrigin.withOriginAccessControl(siteBucket, {
      // LIST lets S3 answer a missing file with 404 rather than 403, so a
      // purged chunk reads as missing, as it does on Vercel.
      originAccessLevels: [cloudfront.AccessLevel.READ, cloudfront.AccessLevel.LIST],
    });
    const apiOrigin = new origins.FunctionUrlOrigin(apiUrl, {
      customHeaders: { [ORIGIN_VERIFY_HEADER]: originSecret.secretValueFromJson("value").unsafeUnwrap() },
      readTimeout: cdk.Duration.seconds(30),
    });

    const rewrite = spaRewrite(vercel);
    const rewriteFn = new cloudfront.Function(this, "SpaRewrite", {
      comment: "vercel.json rewrite: files as-is, everything else not excluded → /index.html",
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(rewriteFunctionCode({ files: siteFiles(props.webDist), ...rewrite })),
    });

    // Honour the Cache-Control each object carries (set from vercel.json at upload).
    const honourOrigin = new cloudfront.CachePolicy(this, "HonourOriginCache", {
      comment: "Cache-Control from the S3 object",
      defaultTtl: cdk.Duration.seconds(0),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.days(365),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });
    const apiRequests = new cloudfront.OriginRequestPolicy(this, "ApiRequests", {
      comment: "What the API reads; never the viewer's Host (the function URL needs its own)",
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
        "Accept",
        "Accept-Language",
        "Content-Type",
        "Origin",
        "Referer",
        "User-Agent",
        "Sec-Fetch-Site",
        "Sec-Fetch-Mode",
        "Sec-Fetch-Dest",
        "CloudFront-Viewer-Address",
      ),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
    });

    const appHeaders = headersPolicy(this, "AppHeaders", headers.default, true);
    const embedHeaders = headersPolicy(this, "EmbedHeaders", headers.embed, true);
    const apiHeaders = headersPolicy(this, "ApiHeaders", headers.api, false);
    if (JSON.stringify(headers.assets) !== JSON.stringify(headers.default)) {
      throw new Error("vercel.json gives /assets/* different security headers from the rest of the site; give /assets/* its own policy");
    }

    const distribution = new cloudfront.Distribution(this, "Site", {
      comment: "Markdown Studio",
      ...(props.domain && {
        domainNames: props.domain.names,
        certificate: acm.Certificate.fromCertificateArn(this, "Certificate", props.domain.certificateArn),
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      }),
      defaultRootObject: "index.html",
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      defaultBehavior: {
        origin: siteOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: honourOrigin,
        responseHeadersPolicy: appHeaders,
        functionAssociations: [{ function: rewriteFn, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
        compress: true,
      },
      additionalBehaviors: {
        "/assets/*": {
          origin: siteOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: appHeaders,
          compress: true,
        },
        "/embed.html": {
          origin: siteOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: honourOrigin,
          responseHeadersPolicy: embedHeaders,
          compress: true,
        },
        "/api/*": {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: apiRequests,
          responseHeadersPolicy: apiHeaders,
          compress: true,
        },
      },
    });

    const siteUrl = `https://${props.domain?.names[0] ?? distribution.distributionDomainName}`;
    new ssm.StringParameter(this, "SiteUrlParameter", {
      parameterName: SITE_URL_PARAMETER,
      stringValue: siteUrl,
      description: "The site's public URL; the API's PUBLIC_URL and first CORS origin",
    });

    // ── Outputs ─────────────────────────────────────────────────────────────
    const out = (id: string, value: string, description: string) => new cdk.CfnOutput(this, id, { value, description });
    out("SiteUrl", siteUrl, "The website (and the API under /api)");
    out("HealthUrl", `${siteUrl}/api/health`, "API health, through CloudFront");
    out("GoogleRedirectUri", `${siteUrl}/api/auth/callback/google`, "Add to the Google OAuth client's authorized redirect URIs");
    out("DistributionId", distribution.distributionId, "For cache invalidations");
    out("SiteBucketName", siteBucket.bucketName, "The website's files");
    out("DocumentsBucketName", documentsBucket.bucketName, "For the documents feature (unused yet)");
    out("ApiFunctionName", api.functionName, "The API Lambda");
    out("DatabaseEndpoint", database.dbInstanceEndpointAddress, "Private; reachable from the VPC only");
    out("GoogleSecretName", googleSecret.secretName, "Put the Google OAuth client ID and secret here");
  }
}

/**
 * Turn the instance into a NAT: forward packets, and masquerade what leaves
 * by the default route's interface.
 *
 * CDK's default script failed on this instance size, so the first deploy's
 * migration function timed out reaching Secrets Manager: a t4g.nano has
 * 512 MB, and `dnf` loading the Amazon Linux 2023 repository metadata was
 * OOM-killed (the boot log said so) — nothing after it ran. A temporary swap
 * file lets the one install finish. The default script also finds the
 * interface with `route`, which AL2023 does not install; `ip` is always
 * there, with `ens5` (the Nitro default) as the fallback.
 */
export function natUserData(): ec2.UserData {
  const ud = ec2.UserData.forLinux();
  ud.addCommands(
    "set -euxo pipefail",
    "fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile",
    "dnf install -y iptables-services",
    "swapoff /swapfile && rm -f /swapfile",
    "systemctl enable --now iptables",
    'echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/90-nat.conf',
    "sysctl -p /etc/sysctl.d/90-nat.conf",
    "IFACE=$(ip -o -4 route show default | awk '{print $5; exit}')",
    'iptables -t nat -A POSTROUTING -o "${IFACE:-ens5}" -j MASQUERADE',
    // iptables-services ships a FORWARD rule that rejects everything.
    "iptables -F FORWARD",
    "service iptables save",
  );
  return ud;
}

/** A CloudFront response-headers policy carrying exactly the headers vercel.json gives these paths, plus HSTS (which Vercel adds by itself). */
function headersPolicy(scope: Construct, id: string, list: Header[], override: boolean): cloudfront.ResponseHeadersPolicy {
  const security: cloudfront.ResponseSecurityHeadersBehavior = {
    // Vercel sends this on every response of a production deployment without
    // being asked; CloudFront does not, so it is stated here.
    strictTransportSecurity: { accessControlMaxAge: cdk.Duration.seconds(63072000), includeSubdomains: false, override },
  };
  const custom: cloudfront.ResponseCustomHeader[] = [];
  for (const { key, value } of list) {
    switch (key.toLowerCase()) {
      case "content-security-policy":
        Object.assign(security, { contentSecurityPolicy: { contentSecurityPolicy: value, override } });
        break;
      case "x-frame-options":
        if (value !== "DENY") throw new Error(`X-Frame-Options ${value} is not mapped`);
        Object.assign(security, { frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override } });
        break;
      case "x-content-type-options":
        if (value !== "nosniff") throw new Error(`X-Content-Type-Options ${value} is not mapped`);
        Object.assign(security, { contentTypeOptions: { override } });
        break;
      case "referrer-policy":
        if (value !== "no-referrer") throw new Error(`Referrer-Policy ${value} is not mapped`);
        Object.assign(security, { referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER, override } });
        break;
      case "content-security-policy-report-only":
      case "permissions-policy":
        custom.push({ header: key, value, override });
        break;
      default:
        throw new Error(`vercel.json header ${key} has no CloudFront mapping; add one in headersPolicy()`);
    }
  }
  return new cloudfront.ResponseHeadersPolicy(scope, id, {
    comment: `Markdown Studio — from apps/web/vercel.json (${id})`,
    securityHeadersBehavior: security,
    customHeadersBehavior: custom.length ? { customHeaders: custom } : undefined,
  });
}
