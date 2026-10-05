import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MarkdownStudioStack } from "../lib/markdown-studio-stack.ts";
import { readVercelConfig, securityHeadersFor } from "../lib/site-config.ts";

const vercelPath = fileURLToPath(new URL("../../vercel.json", import.meta.url));
const vercel = readVercelConfig(vercelPath);
const dirs: string[] = [];
let template: Template;

function dir(files: string[]): string {
  const d = mkdtempSync(join(tmpdir(), "ms-stack-"));
  dirs.push(d);
  for (const f of files) {
    mkdirSync(dirname(join(d, f)), { recursive: true });
    writeFileSync(join(d, f), "x");
  }
  return d;
}

beforeAll(() => {
  const app = new cdk.App();
  const stack = new MarkdownStudioStack(app, "Test", {
    webDist: dir(["index.html", "sw.js", "assets/a.js"]),
    apiLambdaDist: dir(["index.mjs", "migrate.mjs", "drizzle/0000_init.sql"]),
    vercelConfig: vercelPath,
    extraOrigins: ["https://markdownstudio.com"],
    filesBucketName: "markdown-studio-files-test",
  });
  template = Template.fromStack(stack);
}, 120_000);
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const header = (path: string, key: string) => securityHeadersFor(vercel, path).find((h) => h.key.toLowerCase() === key)!.value;

describe("the AWS stack", () => {
  it("routes egress through a t4g.nano NAT instance, not a NAT gateway", () => {
    template.resourceCountIs("AWS::EC2::NatGateway", 0);
    template.hasResourceProperties("AWS::EC2::Instance", { InstanceType: "t4g.nano", SourceDestCheck: false });
  });

  it("keeps the database private, encrypted, backed up and protected from deletion", () => {
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      Engine: "postgres",
      EngineVersion: Match.stringLikeRegexp("^17\\."),
      DBInstanceClass: "db.t4g.micro",
      PubliclyAccessible: false,
      StorageEncrypted: true,
      DeletionProtection: true,
      MultiAZ: false,
      BackupRetentionPeriod: 7,
    });
  });

  // A failed deploy's rollback, a stack delete or a replacement must never
  // remove the database or the secret that holds its password.
  it("never lets CloudFormation delete the database or its credentials", () => {
    template.hasResource("AWS::RDS::DBInstance", { DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" });
    const dbSecret = Object.values(template.findResources("AWS::SecretsManager::SecretTargetAttachment"))[0]!.Properties.SecretId.Ref as string;
    expect(template.toJSON().Resources[dbSecret]).toMatchObject({ DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" });
  });

  it("opens the database to the API's security group only", () => {
    template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", { IpProtocol: "tcp", FromPort: 5432, ToPort: 5432, SourceSecurityGroupId: Match.anyValue() });
  });

  // Users' files live in FilesStack; this stack owns only the website's bucket.
  it("owns only the website bucket, and keeps it private", () => {
    template.resourceCountIs("AWS::S3::Bucket", 1);
    template.allResourcesProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    });
  });

  it("runs the API on Node 24 in the VPC, with secrets by reference only", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "index.handler",
      Runtime: "nodejs24.x",
      VpcConfig: Match.anyValue(),
      Environment: {
        Variables: Match.objectLike({
          DATABASE_SSL: "verify",
          SITE_URL_PARAMETER: "/markdown-studio/site-url",
          CORS_ORIGINS: "https://markdownstudio.com",
          DB_SECRET_ARN: Match.anyValue(),
          GOOGLE_SECRET_ARN: Match.anyValue(),
        }),
      },
    });
    const env = JSON.stringify(template.findResources("AWS::Lambda::Function"));
    expect(env).not.toMatch(/GOOGLE_CLIENT_SECRET|BETTER_AUTH_SECRET|DATABASE_URL/);
  });

  it("gives the API its file-storage bucket, read and write, through its role (no keys)", () => {
    const fns = template.findResources("AWS::Lambda::Function", { Properties: { Handler: "index.handler" } });
    const vars = Object.values(fns)[0]!.Properties.Environment.Variables;
    expect(vars.S3_BUCKET).toBe("markdown-studio-files-test");
    expect(vars).not.toHaveProperty("S3_ACCESS_KEY_ID");
    expect(vars).not.toHaveProperty("S3_ENDPOINT");
    const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
    // Tagging: the backup upload links carry `kind=backup`. List*: past versions.
    for (const action of ["s3:PutObject", "s3:PutObjectTagging", "s3:GetObject*", "s3:List*", "s3:DeleteObject*"]) expect(policies).toContain(action);
    expect(policies).toContain(":s3:::markdown-studio-files-test/*");
  });

  it("reaches S3 through a gateway endpoint, not the NAT instance", () => {
    template.hasResourceProperties("AWS::EC2::VPCEndpoint", {
      VpcEndpointType: "Gateway",
      ServiceName: Match.objectLike({ "Fn::Join": Match.arrayWith([Match.arrayWith([".s3"])]) }),
    });
  });

  it("migrates the database before the API is updated", () => {
    template.hasResourceProperties("AWS::Lambda::Function", { Handler: "migrate.handler", Runtime: "nodejs24.x" });
    template.resourceCountIs("Custom::Trigger", 1);
  });

  it("serves the site and /api/* from one CloudFront distribution", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: "index.html",
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: "redirect-to-https",
          FunctionAssociations: [Match.objectLike({ EventType: "viewer-request" })],
        }),
        CacheBehaviors: Match.arrayWith([
          Match.objectLike({ PathPattern: "/assets/*" }),
          Match.objectLike({ PathPattern: "/embed.html" }),
          Match.objectLike({ PathPattern: "/api/*", AllowedMethods: Match.arrayWith(["POST"]), ViewerProtocolPolicy: "https-only" }),
        ]),
      }),
    });
  });

  it("sends the CSP, frame denial and the rest exactly as vercel.json states them", () => {
    template.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          ContentSecurityPolicy: { ContentSecurityPolicy: header("/about", "content-security-policy"), Override: true },
          FrameOptions: { FrameOption: "DENY", Override: true },
          ReferrerPolicy: { ReferrerPolicy: "no-referrer", Override: true },
        }),
        CustomHeadersConfig: {
          Items: Match.arrayWith([
            { Header: "Content-Security-Policy-Report-Only", Value: header("/about", "content-security-policy-report-only"), Override: true },
          ]),
        },
      }),
    });
  });

  it("never forwards the viewer's Host to the API (the function URL needs its own)", () => {
    const policies = template.findResources("AWS::CloudFront::OriginRequestPolicy");
    const headers = Object.values(policies)[0]!.Properties.OriginRequestPolicyConfig.HeadersConfig.Headers as string[];
    expect(headers.map((h) => h.toLowerCase())).not.toContain("host");
    expect(headers).toContain("CloudFront-Viewer-Address");
    expect(headers).toContain("Sec-Fetch-Site");
  });
});
