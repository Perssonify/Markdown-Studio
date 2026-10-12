# Deployment and release — what the code does, what an owner must set up

> **Audience:** whoever owns the Vercel project, the domain, the GitHub
> repository and the npm organisation. Everything in this file marked
> **Owner action** is a setting or an account, not code — it cannot be merged,
> only done. The code side is in place.

---

**Doing it?** Work through the checklist in [deployment-todo.md](deployment-todo.md); this file explains each step.

**Moving to AWS:** the site and the backend are set up to be served from AWS
together — [infra/README.md](../../../infra/README.md) (CloudFront + S3 + Lambda +
RDS, driven by this app's own `vercel.json`). Until then this file describes the
Vercel project, which now needs **Root Directory = `apps/web`** (the editor moved
there when the repository became a monorepo).

## At a glance

| Area | In the repository | Owner action still needed |
|---|---|---|
| Domain serves the app | `uptime.yml` checks it every 30 min | Point markdownstudio.com at Vercel ([The domain](#the-domain)) |
| Users on the old address keep their library | A "has moved — download a backup" banner on markdowneditor.perssonify.com | Serve the current build there; redirect only later ([The old address](#the-old-address)) |
| Production only after CI | CI job names `verify` and `e2e` | Branch protection + Vercel deployment checks ([Gate production on CI](#gate-production-on-ci)) |
| Reproducible builds | Bun pinned (`packageManager`, CI), SHA-pinned actions, `--frozen-lockfile`, Dependabot | Confirm Vercel builds with the same Bun |
| npm package | `publish.yml` (tag-triggered, provenance) | Claim `@perssonify`, 2FA, token or trusted publishing, `npm` environment ([Publishing](#publishing-the-npm-package)) |
| Security contact | `security.txt`, SECURITY.md, issue templates | Create and monitor security@markdownstudio.com |
| Import relay costs | 4 MB cap, 25 s `maxDuration`, one log line per request | Firewall rate limit, spend alerts ([import-relay.md ▸ Operating it](import-relay.md#operating-it-owner-setup)) |
| Security headers | CSP report-only (hash-pinned), anti-framing enforced | Decide when to enforce the CSP ([CSP](#content-security-policy)) |

---

## The domain

The audit found markdownstudio.com serving a registrar parking page with a
"for sale" notice (nameservers `ns1/ns2.afternic.com`). The code already assumes
the domain: `APP_URL`, the relay's CORS origins, `security.txt` and SECURITY.md
all name it.

**Owner action:**
1. Confirm the registration is held by a company account (not a person's), with
   auto-renew on and more than one admin who can log in.
2. Remove any parking / for-sale listing at the registrar or marketplace.
3. In Vercel ▸ the project ▸ Settings ▸ **Domains**, add `markdownstudio.com`
   and `www.markdownstudio.com` (redirect one to the other — the relay's CORS
   grant allows both).
4. At the DNS provider, create the records Vercel shows (or delegate to Vercel's
   nameservers). Wait for Vercel to report the domain valid and the certificate
   issued.
5. Run **Actions ▸ Uptime ▸ Run workflow** and confirm it goes green. It checks
   that the Markdown Studio shell (`<title>`, `#root`) and its JavaScript entry
   are served — a parking page fails it.
6. Replace the scheduled workflow with an external uptime monitor that pages a
   person. GitHub may delay or skip scheduled runs and notifies only the
   workflow's last editor (≈1,450 runs a month).

---

## The old address

Browser storage belongs to an ORIGIN, so every library created on
markdowneditor.perssonify.com stays there — the new domain opens empty for
those users. The code handles its half: on that host (`LEGACY_APP_HOST` in
`src/constants.ts`) the app shows a "Markdown Studio has moved" banner with a
one-click full backup and a link to markdownstudio.com, where the backup
imports; Help has "Moving your library".

**Owner action:**
1. Keep serving the CURRENT build on markdowneditor.perssonify.com (the same
   Vercel project with that domain added, or its own deployment). The banner
   only reaches people who load a build that has it.
2. Do not redirect or retire the old host until its users have had time to
   move: a redirect sends them to an empty library and strands the old one.
3. Point the Labs page and any other links at markdownstudio.com.

---

## Gate production on CI

Vercel deploys `main` on every push and runs only its build command
(`build:app`, then the sourcemap strip): no type check, no tests, no browser
campaign. CI runs in parallel and nothing waits for it, so
a red merge ships to every user. Two settings close that; `vercel.json` is
deliberately not used to switch auto-deploys off.

**Owner action — GitHub:**
1. Settings ▸ **Rules ▸ Rulesets** (or Branches ▸ Branch protection) for `main`:
   - require a pull request before merging, with at least one approving review;
   - require status checks to pass: **`verify`** and **`e2e`** (the job names in
     `.github/workflows/ci.yml`), and require branches to be up to date;
   - block force pushes and deletions.
2. Add a `CODEOWNERS` file if review should be routed (none exists today).

**Owner action — Vercel:**
3. Project ▸ Settings ▸ **Deployment Checks**: add the GitHub checks `verify`
   and `e2e`. Vercel then builds a production deployment on push but only
   promotes it to the production domains after both checks pass. (If the plan
   lacks Deployment Checks: turn off automatic production deployments in
   Settings ▸ Git and promote a green deployment by hand.)
4. Keep preview deployments on — they are where a change is looked at before
   merge — and note that each preview origin has its own browser storage.

**Rollback** is Vercel ▸ Deployments ▸ a previous deployment ▸ **Promote to
Production**: instant, no rebuild.

### How a deploy reaches users
The standalone app is a PWA with a **prompting** service worker:

- Navigations are network-first, so a fresh page load online gets the new HTML.
- A tab that is already open finds the new version on its next check (it
  checks once an hour while online and visible), installs the new worker in the
  background and shows **"A new version of Markdown Studio is ready — Reload"**. Nothing
  reloads by itself; the worker takes over when the user presses Reload or
  closes every tab. Other tabs are then told, and reload on their own only when
  online, clean and in the background.
- So a bad deploy that is rolled back quickly reaches few open tabs, and a
  critical fix does NOT reach open tabs until users press Reload — say so in
  any incident note. ([runbooks/stuck-service-worker.md](runbooks/stuck-service-worker.md))

---

## Reproducible builds

- CI installs with `bun install --frozen-lockfile` using Bun **1.4.0** (the
  version that produced `bun.lock`), set once in `BUN_VERSION` in each workflow.
- Vercel runs `bun install --frozen-lockfile` (`vercel.json` ▸ `installCommand`):
  a lockfile that does not match `package.json` fails the deploy instead of
  resolving something new.
- Every GitHub Action is pinned to a full commit SHA with its version in a
  comment; workflows run with `permissions: contents: read` unless they need
  more (the publish job adds `id-token: write`).
- Dependabot (`.github/dependabot.yml`) proposes weekly updates for the Bun
  lockfile and for the pinned actions.

**Owner action:** make sure Vercel builds with the same Bun. `package.json`
already declares `"packageManager": "bun@1.4.0"`; check the Bun version in a
Vercel build log, and set it in the project's build settings if it differs.
Bump CI's `BUN_VERSION`, that field and `bun.lock` together.

---

## Content-Security-Policy

`vercel.json` sends, on every page:

- **`Content-Security-Policy-Report-Only`** — scripts from the app's origin and
  the SHA-256 hashes of the inline scripts only (no `unsafe-inline`, no
  `unsafe-eval`; `wasm-unsafe-eval` for zip.js's decrypt); styles `'self'` plus
  inline (Mermaid, KaTeX and the toast library inject styles); images and media
  from the app, `data:`, `blob:` and any `https:` host; connections to the app
  (the relay) and any `https:` host (direct URL imports); `object-src 'none'`.
- **Enforced now:** `frame-ancestors 'none'` and `X-Frame-Options: DENY` on the
  app (clickjacking), but NOT on `/embed.html`, which exists to be framed.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a
  `Permissions-Policy` that turns off camera, microphone, geolocation, payment,
  USB, serial, HID, MIDI, display capture and motion sensors.

The hashes are checked by `src/__tests__/ops-vercel-headers.test.js`, which
recomputes them from `index.html` and `embed.html` (and from the BUILT
`index.html` in CI) and fails on a missing or stale one — so **editing an inline
script means updating `vercel.json` in the same change**; the failure message
names the new hash.

**Graduating to enforcing** (owner decision): the e2e suite `csp` already runs
the production build with the policy ENFORCED against every renderer and lazy
surface and requires zero violations. When confident, rename the header key
`Content-Security-Policy-Report-Only` → `Content-Security-Policy` in both rules
(and drop the now-redundant `frame-ancestors`-only header). Report-only policies
have no report endpoint configured, so field violations appear only in browser
consoles; add a `report-to` endpoint first if you want field data.

---

## Sourcemaps

The app is built with `sourcemap: 'hidden'`: maps are emitted (the third-party
licence scan reads them, and they turn a minified stack from "Copy diagnostics"
back into source) but nothing references them. `vercel.json`'s build command
ends with `node scripts/strip-sourcemaps.mjs`, which moves every `.map` out of
`dist-app/` into `dist-app-sourcemaps/` — they are not deployed. CI keeps them
as the artifact `app-sourcemaps-<commit sha>` for 90 days (pushes to `main`);
to read a production stack, download the artifact for the deployed commit and
map the `file:line:col` from the diagnostics with any source-map tool.

---

## Publishing the npm package

`@perssonify/editor` is not on npm yet, and the scope `@perssonify` looks
unclaimed — while the docs tell people to install it. Until it is claimed,
anyone can publish under that name (a squatting / dependency-confusion risk).

**Owner action:**
1. Create (claim) the **`perssonify` organisation** on npmjs.com under a company
   account; add a second owner; **require 2FA** for all members.
2. Publishing credentials — one of:
   - **Trusted publishing** (preferred; no long-lived secret): on the package's
     npm settings, trust this repository's `publish.yml` workflow; or
   - a **granular access token** limited to `@perssonify/editor` with publish
     rights, saved as the repository secret **`NPM_TOKEN`**.
3. GitHub ▸ Settings ▸ **Environments** ▸ create **`npm`** with required
   reviewers (and, optionally, restrict it to tags `v*`).

**Releasing:**
1. Bump `version` in `package.json` (single source of the version) and merge.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. The **Publish to npm** workflow waits for the `npm` environment's approval
   (the whole job runs in that environment), then checks the tag matches
   `package.json`, runs the type check, the unit tests and the library build,
   prints `npm pack --dry-run`, and runs
   `npm publish --provenance --access public`.
4. Check the package page shows the provenance badge (built by this repository's
   workflow from this commit).

Never publish from a laptop. A bad release: [runbooks/bad-npm-release.md](runbooks/bad-npm-release.md).

---

## Contacts that must exist

- **security@markdownstudio.com** — named by `/.well-known/security.txt`,
  SECURITY.md and the issue templates. **Owner action:** create it, route it to
  at least two people, and test it. `security.txt` expires on 2027-09-29; the
  unit tests start failing 30 days before that as a reminder to renew.
- `package.json` ▸ `bugs` names `https://markdownstudio.com` and the same
  `security@markdownstudio.com` mailbox, so npm's bug link depends on the
  domain and the mailbox above both working.
