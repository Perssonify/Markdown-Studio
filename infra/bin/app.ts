// The CDK app (`bun run --cwd infra synth`, or `bun run deploy` from the root,
// which builds first). Run by Node directly — see infra/cdk.json.
import * as cdk from "aws-cdk-lib";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MarkdownStudioStack } from "../lib/markdown-studio-stack.ts";

const repo = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const webDist = repo("apps/web/dist-app");
const apiLambdaDist = repo("apps/api/dist/lambda");
for (const [dir, how] of [
  [webDist, "bun run --cwd apps/web build:app"],
  [apiLambdaDist, "bun run --cwd apps/api build"],
] as const) {
  if (!existsSync(dir)) throw new Error(`${dir} does not exist — build it first (${how}), or run \`bun run deploy\`, which does`);
}

const app = new cdk.App();
const list = (key: string) =>
  String(app.node.tryGetContext(key) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const extraOrigins = list("extraOrigins");
// Optional: `-c domainNames=markdownstudio.com,www.markdownstudio.com -c certificateArn=arn:aws:acm:us-east-1:…`
// (or the same keys in cdk.json) once the certificate is issued.
const domainNames = list("domainNames");
const certificateArn = String(app.node.tryGetContext("certificateArn") ?? "");
if (domainNames.length && !certificateArn) throw new Error("domainNames needs certificateArn (an ACM certificate in us-east-1)");

new MarkdownStudioStack(app, "MarkdownStudio", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "us-east-1" },
  description: "Markdown Studio — website (S3 + CloudFront), API (Lambda), database (RDS PostgreSQL)",
  terminationProtection: true,
  webDist,
  apiLambdaDist,
  vercelConfig: repo("apps/web/vercel.json"),
  extraOrigins,
  domain: domainNames.length ? { names: domainNames, certificateArn } : undefined,
});
