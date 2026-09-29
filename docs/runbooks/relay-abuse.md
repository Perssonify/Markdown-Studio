# Runbook — Import Relay Abuse (`/api/import`)

The relay fetches a user-supplied URL server-side. To a browser it is only
reachable first-party, but **any HTTP client can use it as a bounded proxy**
(public destinations, ports 80/443, ≤ 4 MB, ≤ 20 s) — see
[import-relay.md ▸ Proxy abuse](../import-relay.md#4-proxy-abuse--use-their-server-to-fetch-my-traffic).
This runbook is for when someone does.

## Symptoms
- A spend or usage alert on **Function invocations** or **Fast Data Transfer**
  (Vercel ▸ Settings ▸ Billing ▸ Spend Management).
- A burst of `"evt":"import_relay"` log lines, or of `"reason":"rate_limited"`.
- Complaints from a third party that "markdownstudio.com" is crawling them.

## Diagnosis
Vercel ▸ the project ▸ **Logs**, filter for `import_relay`. Each request is ONE
JSON line: `method, sfs, host, finalHost, hops, status, bytes, ms, reason` —
hosts only, never a path or query, never the client IP (the platform's own
request log has the IP).

| Signal | Meaning |
|---|---|
| many `sfs:"none"` | A browser only sends `none` on a direct navigation, which the app never does — almost always a script. |
| `reason:"blocked_address"` / `"blocked_host"` | Someone probing for SSRF (internal addresses, metadata). Refused; worth watching, not an incident by itself. |
| `reason:"rate_limited"` in bursts | One IP over 40 req/min on a warm instance. |
| steady traffic to many unrelated `host`s | The relay used as a general proxy. |
| `reason:"too_large"` | Files over 4 MB — usually a legitimate user, not abuse. |

Cross-reference the client IPs in the platform request log for the same window.

## Remediation — fastest first
1. **Kill switch (no deploy):** Vercel ▸ Firewall ▸ add a rule **Request Path
   starts with `/api/import` → Deny**. The app degrades exactly as on a static
   host: direct imports keep working, CORS-blocked hosts get the
   download-and-drop guidance.
2. **Rate limit (the durable fix):** replace the deny with **Rate Limit**, fixed
   window 60 s, 20 requests, keyed on IP (see
   [import-relay.md ▸ Operating it](../import-relay.md#operating-it-owner-setup)).
3. **Block specific sources:** Firewall ▸ IP block / country / JA4 rules for the
   offenders you identified.
4. **Cap spend:** confirm Spend Management has a budget and alert thresholds.

## After
- Remove the deny rule once a rate-limit rule is in place, and confirm a real
  import (a Google Drive share link) still works.
- If a destination complained, reply with the relay's user agent
  (`PerssonifyImport/1.0`) and what was done.

## Escalation
The Vercel team owner (Firewall and billing access). If the logs show a request
that REACHED a private or metadata address, that is a security incident —
[security-incident.md](security-incident.md).
