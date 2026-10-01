# Runbook — Deploy Broken / Blank Page

## Symptoms
- The Vercel deploy fails, or the deployed site loads a blank white page.
- `#root` never mounts; the console may be empty or show a module error.

## Diagnosis
1. **Build vs runtime?**
   - **Build failed** → the Vercel build log. `vercel.json` runs
     `bun install --frozen-lockfile`, then
     `bun run build:app && node scripts/strip-sourcemaps.mjs`. A lockfile that
     does not match `package.json` fails the install on purpose — regenerate
     `bun.lock` with the pinned Bun (1.4.0: `packageManager` in `package.json`,
     `BUN_VERSION` in `.github/workflows/ci.yml`) and commit it. `build:app` is
     `vite build` followed by `scripts/third-party-licenses.mjs`, which writes
     `dist-app/third-party-licenses.txt` from the build's hidden sourcemaps and
     fails the build if there are none. Reproduce anything else locally with
     `bun run build:app`.
   - **Build succeeded, page blank** → the devtools console and network panel
     on the deployed URL.
2. **Blank page checks:**
   - An `/assets/*.js` request that **404s** → the HTML and the chunks come
     from different deployments (an old tab, or a cached shell). Expected for
     old tabs after a deploy; the inline **boot watchdog** recovers a page whose
     scripts failed to load (online only; it clears Cache Storage and
     unregisters the service worker — never documents — and reloads once).
   - An `/assets/*.js` request answered **200 `text/html`** → the SPA rewrite
     is catching assets again. `vercel.json` must exclude them:
     `"source": "/((?!api/|assets/|\\.well-known/).*)"`.
   - No `[BOOT]` log with `?diag=1` → the bundle did not execute (a throwing
     module at import time is not caught by the ErrorBoundary; look for the
     first red error).
   - A CSP report in the console (`Content-Security-Policy-Report-Only`) is a
     REPORT, not the cause of a blank page — unless the policy has been
     promoted to enforcing, in which case an inline script whose hash is not in
     `vercel.json` is blocked (`ops-vercel-headers.test.js` should have failed).
   - Blank only when the page is **inside an iframe** → anti-framing is
     enforced on purpose (`frame-ancestors 'none'` and `X-Frame-Options: DENY`
     on every page except `/embed.html`).
3. **Routing:** deep links 404? The SPA rewrite must cover them (everything
   except `api/`, `assets/` and `.well-known/`).

## Remediation
- **Roll back first, fix second**: Vercel ▸ Deployments ▸ last good ▸
  **Promote to Production**. Users already on the broken build receive the fix
  through the update prompt; the boot watchdog handles pages that cannot boot.
- **Reproduce locally**: `bun run build:app && bun run preview`. If `preview`
  is blank, it is a real bundle problem, not Vercel.

## Prevention
- Production must only receive commits that passed CI — branch protection with
  required checks, and Vercel deployment checks. Both are owner settings
  ([deployment.md ▸ Gate production on CI](../deployment.md#gate-production-on-ci));
  until they are switched on, Vercel deploys every push to `main` without
  waiting for CI (A005).
- The CI gate: lint, type-check, unit tests, the three builds, the browser
  campaign (including the enforced-CSP and service-worker suites).

## Escalation
No on-call. If it is Vercel-specific (not reproducible locally), check
<https://www.vercel-status.com> and the project settings; otherwise file an
issue with the build log and the first console error.
