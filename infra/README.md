# infra — Markdown Studio on AWS (CDK)

One CloudFormation stack, `MarkdownStudio`, in `us-east-1`, defined in
[`lib/markdown-studio-stack.ts`](lib/markdown-studio-stack.ts):

```
browser ──► CloudFront ─┬─ /*      → S3 (the website, private, via Origin Access Control)
                        └─ /api/*  → Lambda function URL (apps/api)
                                       │ private subnets
                                       ├─► RDS PostgreSQL 17 (isolated subnets, no public access)
                                       └─► NAT instance ─► internet (Google sign-in, the import relay)
```

The site and the API share one origin, so the editor's existing relative call
to `/api/import` works unchanged and sign-in cookies are first-party.

**Nothing here has been deployed.** The account is bootstrapped for CDK
(`CDKToolkit`); deploying is an owner step.

## The database is never deleted by this code

- `RemovalPolicy.RETAIN` on the RDS instance AND on the secret holding its
  password: a failed deploy's rollback, a stack delete or a replacement leaves
  both in place. `test/stack.test.ts` fails if either policy changes.
- Deletion protection is on.
- Removing a database is a deliberate human decision in the AWS console, never a
  side effect of a deploy.

## What it costs (us-east-1, approximate, low traffic)

| Item | ~ per month |
| --- | --- |
| RDS `db.t4g.micro` + 20 GB gp3, 7-day backups | $14 |
| NAT instance `t4g.nano` + its public IPv4 address | $7 |
| Secrets Manager (4 secrets) | $1.60 |
| Lambda, CloudFront, S3 at low traffic | under $1 |
| **Total** | **≈ $23** |

The NAT instance replaces a managed NAT gateway (~$32 a month plus data).

## Deploying

Needs AWS credentials for the account and Docker not at all (the API is bundled
locally by Rolldown).

```bash
bun run deploy        # from the repository root
```

[`scripts/deploy.ts`](scripts/deploy.ts) builds the editor (`build:app`) and the
API bundle, strips the sourcemaps (as Vercel's build does), runs `cdk deploy`
(which asks before any IAM or security-group change), uploads the site to its
bucket — hashed assets first, HTML last — and invalidates CloudFront.
`bun run deploy:web` re-publishes the site only.

On every deploy that changes the API bundle, a migration function applies
`packages/db/drizzle` before the API function is updated.

The stack outputs (`aws cloudformation describe-stacks --stack-name MarkdownStudio`)
name the site URL, the health URL, the Google redirect URI and the secret to
put the Google keys in.

## Google sign-in

1. Create the OAuth client (apps/api/README.md ▸ Google sign-in) with the
   output `GoogleRedirectUri` as an authorized redirect URI.
2. Put its ID and secret into the secret named by the output `GoogleSecretName`:
   ```bash
   aws secretsmanager put-secret-value --region us-east-1 --secret-id <GoogleSecretName> \
     --secret-string '{"clientId":"…","clientSecret":"…"}'
   ```
   A later deploy never overwrites it (the value is generated once, then left alone).
3. New Lambda instances read it at start; to pick it up at once, redeploy or
   update any setting of the API function.

## How the website is served — taken from `apps/web/vercel.json`

infra does not restate the hosting rules; it reads them
([`lib/site-config.ts`](lib/site-config.ts)):

- **Headers:** the hash-pinned report-only CSP, `frame-ancestors 'none'`,
  `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` and `Permissions-Policy`
  become CloudFront response-headers policies (the embed gets its own, without
  the framing ban; `/api/*` gets only the common three). Plus HSTS, which Vercel
  sends on its own.
- **Cache-Control:** set per file at upload, from the same rules
  ([`lib/upload-plan.ts`](lib/upload-plan.ts)).
- **The SPA rewrite:** a CloudFront Function serves a file that exists as
  itself and rewrites anything else not excluded to `/index.html` — the order
  Vercel uses ([`lib/spa-rewrite.ts`](lib/spa-rewrite.ts)). `/assets/*` misses are
  real 404s.

So a CSP hash change in `vercel.json` reaches both hosts.

## The domain

The stack serves the CloudFront address until the domain moves. Then: request
an ACM certificate in **us-east-1** for `markdownstudio.com` and
`www.markdownstudio.com` (DNS validation at the registrar), and deploy with

```bash
bunx cdk deploy MarkdownStudio -c domainNames=markdownstudio.com,www.markdownstudio.com -c certificateArn=arn:aws:acm:us-east-1:…
```

then point both names at the distribution. The site URL (and so the API's
`PUBLIC_URL` and the Google redirect URI) follows the first name.

## Lessons from the first deploy attempt (1 Oct 2026)

- A `t4g.nano` (512 MB) could not run `dnf install` — it was OOM-killed, so the
  NAT never forwarded anything and the migration timed out reaching Secrets
  Manager. `natUserData()` adds a temporary swap file; it also finds the
  interface with `ip`, as AL2023 has no `route`. Not yet proven on AWS.
- Fixed secret names blocked a retry after a failed first deploy; secrets now
  get generated names.
- A failed first deploy tried to remove its new database; the database is now
  retained in every case (above).

## Tests

`bun run test` here: the stack's safety properties (`test/stack.test.ts`), the
vercel.json reading, the rewrite function run as CloudFront would, and the
upload plan. They synthesize the stack with stand-in builds; no AWS access.
