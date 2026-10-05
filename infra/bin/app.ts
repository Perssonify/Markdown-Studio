// The CDK app (`bun run --cwd infra synth`, or `bun run deploy` from the root,
// which builds first). Run by Node directly — see infra/cdk.json.
import * as cdk from "aws-cdk-lib";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FilesStack } from "../lib/files-stack.ts";
import { MarkdownStudioStack } from "../lib/markdown-studio-stack.ts";

const repo = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const webDist = repo("apps/web/dist-app");
const apiLambdaDist = repo("apps/api/dist/lambda");

const app = new cdk.App();
const account = process.env.CDK_DEFAULT_ACCOUNT;

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

// Users' files — its own stack, deployed on its own (`bunx cdk deploy
// MarkdownStudioFiles`) and never touched by the app's deploys. S3 cannot
// rename a bucket: a new name here is a NEW bucket, and the old one is left
// as it is, files and all (retained) — copy them over before switching.
const filesBucketName = "markdown-studio-labs";
new FilesStack(app, "MarkdownStudioFiles", {
  env: { account, region: "us-east-1" },
  description: "Markdown Studio — users' files (S3)",
  bucketName: filesBucketName,
  // The site (its CloudFront address is added once the app is deployed), and
  // the editor on a developer's machine.
  allowedOrigins: [...new Set([...extraOrigins, ...domainNames.map((d) => `https://${d}`), "http://localhost:5173", "http://localhost:4173"])],
});

// The production stack needs the builds. Without them it is left out, with a
// note, so the files bucket can still be deployed on its own.
const missingBuilds = (
  [
    [webDist, "bun run --cwd apps/web build:app"],
    [apiLambdaDist, "bun run --cwd apps/api build"],
  ] as const
).filter(([dir]) => !existsSync(dir));

if (missingBuilds.length) {
  for (const [dir, how] of missingBuilds) {
    console.warn(`MarkdownStudio stack skipped: ${dir} does not exist — build it (${how}) or run \`bun run deploy\`, which does`);
  }
} else {
  new MarkdownStudioStack(app, "MarkdownStudio", {
    env: { account, region: "us-east-1" },
    description: "Markdown Studio — website (S3 + CloudFront), API (Lambda), database (RDS PostgreSQL)",
    terminationProtection: true,
    webDist,
    apiLambdaDist,
    vercelConfig: repo("apps/web/vercel.json"),
    extraOrigins,
    domain: domainNames.length ? { names: domainNames, certificateArn } : undefined,
    filesBucketName,
  });
}
