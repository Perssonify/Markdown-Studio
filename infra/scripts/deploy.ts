// `bun run deploy` (from the repository root): build, deploy the stack, then
// publish the website to its bucket — the AWS counterpart of Vercel's
// buildCommand (build:app, then strip-sourcemaps).
//
//   --web-only    skip the CDK deploy; rebuild and re-upload the website only
//   --skip-build  use the builds already on disk
//
// Needs AWS credentials for the target account (the default profile, or
// AWS_PROFILE) and, once per account and region, `bunx cdk bootstrap`.
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readVercelConfig } from "../lib/site-config.ts";
import { planUploads, type Upload } from "../lib/upload-plan.ts";

const STACK = "MarkdownStudio";
const REGION = "us-east-1";
const repo = (p = "") => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const args = new Set(process.argv.slice(2));

function run(command: string, cwd = repo(), env: Record<string, string> = {}): void {
  console.log(`\n$ ${command}`);
  const r = spawnSync(command, { cwd, stdio: "inherit", shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`failed (${r.status}): ${command}`);
}

if (!args.has("--skip-build")) {
  // This deployment has the API, so the site is built WITH accounts: visitors
  // sign in (apps/web/src/app/account.ts). A build without the flag — the
  // Vercel one — has no account UI and makes no account calls.
  run("bunx turbo run build:app --filter=@perssonify/editor", repo(), { VITE_ACCOUNTS: "on" });
  run("bunx turbo run build --filter=@markdown-studio/api");
}
// As on Vercel: sourcemaps are built (the licence notice reads them) but never deployed.
run("node scripts/strip-sourcemaps.mjs", repo("apps/web"));

if (!args.has("--web-only")) {
  // No --require-approval: the CDK asks before any IAM or security-group
  // change, so a person sees exactly what widens before it happens.
  run(`bunx cdk deploy ${STACK}`, repo("infra"));
}

const cfn = new CloudFormationClient({ region: REGION });
const { Stacks } = await cfn.send(new DescribeStacksCommand({ StackName: STACK }));
const outputs = Object.fromEntries((Stacks?.[0]?.Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]));
const bucket = outputs.SiteBucketName;
const distributionId = outputs.DistributionId;
if (!bucket || !distributionId) throw new Error(`stack ${STACK} has no SiteBucketName/DistributionId output — deploy it first`);

const plan = planUploads(repo("apps/web/dist-app"), readVercelConfig(repo("vercel.json")));
const s3 = new S3Client({ region: REGION });
const put = (u: Upload) =>
  s3.send(new PutObjectCommand({ Bucket: bucket, Key: u.key, Body: readFileSync(u.file), ContentType: u.contentType, CacheControl: u.cacheControl }));

// Everything but the HTML in parallel batches; the HTML entry points last, so
// no visitor gets a page whose chunks are not uploaded yet.
const html = plan.filter((u) => u.key.endsWith(".html"));
const rest = plan.filter((u) => !u.key.endsWith(".html"));
for (let i = 0; i < rest.length; i += 16) await Promise.all(rest.slice(i, i + 16).map(put));
for (const u of html) await put(u);
console.log(`\nuploaded ${plan.length} files to s3://${bucket}`);

await new CloudFrontClient({ region: REGION }).send(
  new CreateInvalidationCommand({
    DistributionId: distributionId,
    InvalidationBatch: { CallerReference: `deploy-${Date.now()}`, Paths: { Quantity: 1, Items: ["/*"] } },
  }),
);
console.log(`invalidated the CloudFront cache\n\nsite:   ${outputs.SiteUrl}\nhealth: ${outputs.HealthUrl}`);
