# Runbook — Hosting Outage (markdownstudio.com is down or wrong)

## Symptoms
- An external uptime monitor alerts (setting one up is an owner action —
  [deployment.md ▸ The domain](../deployment.md#the-domain), A001).
- Users report the site will not load, shows a parking / "domain for sale" page,
  a Vercel error page, or a certificate warning.
- Installed users mostly do NOT notice: the service worker serves the app from
  its precache when the network fails or answers 5xx.

## What still works during an outage
- **Installed / previously visited browsers keep working offline**: navigations
  fall back to the worker's precached shell (also on a 5xx), every chunk is
  precached, and documents live in the browser. Editing, saving, export all work.
- **New visitors get nothing**, and **URL import through the relay** fails (it
  is a Vercel function; the client falls back to "download the file and drag it
  in").

## Diagnosis
1. **Which layer?**
   ```bash
   dig +short markdownstudio.com NS        # registrar/DNS: should be your DNS provider or Vercel, NOT a parking service
   dig +short markdownstudio.com A         # should resolve to Vercel
   curl -sSI https://markdownstudio.com/   # TLS + HTTP status
   curl -sS https://markdownstudio.com/ | grep -o '<title>[^<]*'   # "Markdown Studio"? or a parking page?
   ```
   - Parking / for-sale page or foreign nameservers → **domain/registrar** problem
     (the state the audit found: `ns1/ns2.afternic.com`). Owner action at the
     registrar; see [deployment.md ▸ The domain](../deployment.md#the-domain).
   - DNS fine, HTTP 5xx / Vercel error → **Vercel**. Check
     <https://www.vercel-status.com>, then the project's Deployments and
     Runtime Logs.
   - 200 with the app shell but the app is blank → not an outage: see
     [deploy-broken.md](deploy-broken.md).
2. **Certificate errors** → Vercel issues certificates only for domains attached
   to the project with valid DNS; check Project ▸ Settings ▸ Domains.

## Remediation
- **Vercel incident**: nothing to deploy; wait, and post a status note where
  users will see it. Installed users are unaffected.
- **Bad production deployment**: Vercel ▸ Deployments ▸ the last good one ▸
  **Promote to Production** (instant rollback; no rebuild).
- **Domain / DNS**: restore the registrar records (`A`/`CNAME` to Vercel, or
  Vercel nameservers), re-verify the domain in the Vercel project. DNS changes
  take time to propagate — keep the old records' TTL in mind.
- **Relay only** (imports fail, site fine): see [relay-abuse.md](relay-abuse.md)
  — a Firewall kill switch may be active.

## After
- Confirm the site serves the app again (the `curl` checks above) and the
  uptime monitor is green.
- If the outage came from a domain or registrar change, record who owns the
  registrar account and when it renews ([deployment.md](../deployment.md)).

## Prevention
- The registration, DNS and Vercel project must be owned by company accounts
  with more than one admin, and auto-renew on.
- An external uptime monitor that pages a person.

## Escalation
No on-call. The owner of the Vercel team and of the domain registration.
