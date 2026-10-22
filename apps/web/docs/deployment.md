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
| Domain serves the app | `APP_URL`, the relay's CORS origins and `security.txt` name it | Point markdownstudio.com at Vercel, and an uptime monitor at it ([The domain](#the-domain)) |
| Users on the old address keep their library | A "has moved — download a backup" banner on markdowneditor.perssonify.com | Serve the current build there; redirect only later ([The old address](#the-old-address)) |
| Production only after review | The verify gate, run locally before a PR is opened and merged (there is no CI) | Branch protection requiring a reviewed PR ([Gate production on review](#gate-production-on-review)) |
| Reproducible builds | Bun pinned (`packageManager`), `--frozen-lockfile` | Confirm Vercel builds with the same Bun |
| npm package | Published by hand by an owner | Claim `@perssonify`, 2FA ([Publishing](#publishing-the-npm-package)) |
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
5. Confirm the domain serves the Markdown Studio shell (`<title>`, `#root`) and
   its JavaScript entry — a parking page has neither.
6. Set up an external uptime monitor that pages a person.

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

## Gate production on review

Vercel deploys `main` on every push and runs only its build command
(`build:app`, then the sourcemap strip): no type check, no tests, no browser
campaign. There is no CI, so nothing else checks a merge: run the verify gate
locally before opening a pull request and again before merging it (root
`CLAUDE.md` ▸ Verify, and the editor's gate in `apps/web/CLAUDE.md`), or a red
merge ships to every user. `vercel.json` is deliberately not used to switch
auto-deploys off.

**Owner action — GitHub:**
1. Settings ▸ **Rules ▸ Rulesets** (or Branches ▸ Branch protection) for `main`:
   - require a pull request before merging, with at least one approving review;
   - block force pushes and deletions.
2. Add a `CODEOWNERS` file if review should be routed (none exists today).

**Owner action — Vercel:**
3. Keep preview deployments on — they are where a change is looked at before
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

- The verify gate installs with `bun install --frozen-lockfile`; run it with Bun
  **1.4.0** (the version that produced `bun.lock`, pinned by `packageManager`).
- Vercel runs `bun install --frozen-lockfile` (`vercel.json` ▸ `installCommand`):
  a lockfile that does not match `package.json` fails the deploy instead of
  resolving something new.

**Owner action:** make sure Vercel builds with the same Bun. `package.json`
already declares `"packageManager": "bun@1.4.0"`; check the Bun version in a
Vercel build log, and set it in the project's build settings if it differs.
Bump that field and `bun.lock` together.

---

## Content-Security-Policy

`vercel.json` sends, on every page:

- **`Content-Security-Policy-Report-Only`** — scripts from the app's origin and
  the SHA-256 hashes of the inline scripts only (no `unsafe-inline`, no
  `unsafe-eval`; `wasm-unsafe-eval` for zip.js's decrypt), plus
  `https://www.googletagmanager.com` for Google Analytics' gtag.js on the app's
  pages (never `/embed.html`; see `src/utils/analytics.ts`); styles `'self'` plus
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
`index.html` when a current `dist-app/` exists) and fails on a missing or stale one — so **editing an inline
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
`dist-app/` into `dist-app-sourcemaps/` — they are not deployed, and nothing
keeps them. To read a production stack, rebuild the deployed commit with
`vercel.json`'s build command and map the `file:line:col` from the diagnostics
against its `dist-app-sourcemaps/` with any source-map tool.

---

## Publishing the npm package

`@perssonify/editor` is not on npm yet, and the scope `@perssonify` looks
unclaimed — while the docs tell people to install it. Until it is claimed,
anyone can publish under that name (a squatting / dependency-confusion risk).

**Owner action:**
1. Create (claim) the **`perssonify` organisation** on npmjs.com under a company
   account; add a second owner; **require 2FA** for all members.
2. Publishing is a manual step by an owner, signed in to npm with their own
   2FA-protected account; no token is stored in the repository.

**Releasing:**
1. Bump `version` in `package.json` (single source of the version) and merge.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. On that commit, run the verify gate locally (root `CLAUDE.md` ▸ Verify),
   then, in `apps/web`: `bun run build`; the two checks that need the build
   (`bunx vitest run src/__tests__/pkg-cjs-require.test.js
   src/__tests__/pkg-declarations.test.js`); `npm pack --dry-run` to see what
   will be published; and `npm publish --access public`.

Only an owner publishes. A bad release: [runbooks/bad-npm-release.md](runbooks/bad-npm-release.md).

---

## Contacts that must exist

- **security@markdownstudio.com** — named by `/.well-known/security.txt`,
  SECURITY.md and the issue templates. **Owner action:** create it, route it to
  at least two people, and test it. `security.txt` expires on 2027-09-29; the
  unit tests start failing 30 days before that as a reminder to renew.
- `package.json` ▸ `bugs` names `https://markdownstudio.com` and the same
  `security@markdownstudio.com` mailbox, so npm's bug link depends on the
  domain and the mailbox above both working.
