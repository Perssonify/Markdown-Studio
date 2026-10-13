# Deployment to-do

> A checklist for putting the production-readiness branch live and launching
> markdownstudio.com. Tick items off as they are done. The *why* and the exact
> click-paths are in [deployment.md](deployment.md); the finding IDs (A0xx) are
> from the 2026-09 audit ([audit-2026-09.md](audit-2026-09.md)).
> Everything here is a setting, an account or a check — the code side is done.

## 1. Before the first production deploy

- [ ] Merge `audit/production-readiness-fixes` into `main` through a reviewed pull request, after running the verify gate locally (there is no CI — root `CLAUDE.md` ▸ Verify, and the editor's gate in `apps/web/CLAUDE.md`).
- [ ] Bump `version` in `package.json`, rename CHANGELOG's `[Unreleased]` to that version, and clear the in-app **Changelog** starter document for the release.
- [ ] GitHub ▸ Rulesets for `main`: require a PR with one approval, block force pushes and deletions (A005).
- [ ] Vercel: confirm the dashboard does not override `vercel.json` — the install command must be `bun install --frozen-lockfile` and the build command `bun run build:app && node scripts/strip-sourcemaps.mjs`.
- [ ] Vercel: check a build log shows **Bun 1.4.0** (the `packageManager` version); set it in the project settings if not (A014).
- [ ] Vercel: set the project's Node.js version to **24.x** (`.node-version`; 22.x also lies inside `engines.node` as long as Vercel's 22 is 22.22.2 or later) — the import relay function runs on it, and its undici 8 needs Node 22.19 or later.

## 2. The domain (A001, A002)

- [ ] Confirm markdownstudio.com is registered to a company account (auto-renew on, two admins) and remove the parking / "for sale" listing.
- [ ] Vercel ▸ Domains: add `markdownstudio.com` and `www.markdownstudio.com` (one redirecting to the other); create the DNS records Vercel shows; wait for the certificate.
- [ ] Confirm markdownstudio.com serves the Markdown Studio app, not a parking page. Then set up an external uptime monitor that alerts a person.
- [ ] `markdownstudio.perssonify.com`: a permanent **301 redirect** to markdownstudio.com — not a second copy of the app (a second copy would be a second, separate library for users).

## 3. The old address — markdowneditor.perssonify.com (A004)

- [ ] Deploy the **current** build to markdowneditor.perssonify.com as well. Only there it shows the "Markdown Studio has moved — download a full backup" banner; users import that backup on markdownstudio.com.
- [ ] Do **not** redirect the old address yet. Pick a grace period (for example 60–90 days), announce it, and redirect only after it ends — a redirect sends users to an empty library.
- [ ] labs.perssonify.com: point every editor link at markdownstudio.com, and publish the detail page `labs.perssonify.com/markdownstudio` (copy is in `marketing/`).

## 4. Accounts and settings

- [ ] Create **security@markdownstudio.com**, route it to at least two people, send a test mail (A007). `security.txt` names it and expires on 2027-09-29.
- [ ] Vercel ▸ **Firewall**: a rate-limit rule for `/api/import`, plus spend alerts. Details: [import-relay.md ▸ Operating it](import-relay.md#operating-it-owner-setup) (A010).
- [ ] Decide when the Content-Security-Policy goes from **report-only** to enforced; the switch is renaming one header key in `vercel.json` ([deployment.md ▸ CSP](deployment.md#content-security-policy)) (A068).
- [ ] `/embed.html` returns 404 on the app deploy by design. Only if embedding on markdownstudio.com is wanted: deploy the embed build there too, and set `VITE_EMBED_ALLOWED_ORIGINS` for it (A072).
- [ ] Rotate the GitHub token that was printed in a test run's output during the audit work.

## 5. The npm package — only if you publish the library (A006)

- [ ] Claim the **`perssonify`** organisation on npmjs.com under a company account; add a second owner; require 2FA.
- [ ] Release by hand: bump `package.json`, merge, `git tag vX.Y.Z && git push origin vX.Y.Z`, then on that commit run the verify gate, `bun run build` and `npm publish --access public` from `apps/web` ([deployment.md ▸ Publishing](deployment.md#publishing-the-npm-package)).

## 6. Not code, before the public launch

- [ ] Privacy policy, terms of service and imprint, with counsel (A075). Link them from the About footer and Settings ▸ Privacy (routes `/privacy`, `/terms`, `/imprint`).
- [ ] Trademark clearance for "Markdown Studio"; settle the launch brand and one legal entity name (A080).
- [ ] An accessibility statement (A081).
- [ ] Name an owner for each area and add a `CODEOWNERS` file (A112).

## 7. After every deploy — a 5-minute check

- [ ] https://markdownstudio.com opens the editor.
- [ ] `curl -I https://markdownstudio.com/` shows `Content-Security-Policy-Report-Only`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.
- [ ] A file under `/assets/` is served with `Cache-Control: public, max-age=31536000, immutable`, and its `.map` returns 404 (sourcemaps are not deployed).
- [ ] `/embed.html` returns 404 (unless the embed build is deployed there).
- [ ] `/.well-known/security.txt` and `/third-party-licenses.txt` load.
- [ ] Type something, reload: it is still there. Open a second tab: both behave.
- [ ] Load once, go offline, reload: the app still opens and works.
- [ ] After the NEXT deploy, an open tab shows "A new version of Markdown Studio is ready — Reload" instead of reloading by itself.
- [ ] The browser console shows no CSP report-only violations during normal use.
- [ ] Importing a link from a site that blocks browsers asks once before using the server relay.
