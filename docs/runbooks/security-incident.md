# Runbook — Security Incident

Use this when a vulnerability is reported (security@markdownstudio.com,
[SECURITY.md](../../SECURITY.md)) or suspected, or something that looks like an
exploit shows up in logs. The mailbox is named by `security.txt`, SECURITY.md
and the issue templates, but creating it is an owner action
([deployment.md ▸ Contacts that must exist](../deployment.md#contacts-that-must-exist));
until it exists, a report sent there reaches no one (A007).

## What there is to compromise
- **No server-side user data.** Documents live in each visitor's browser
  (IndexedDB / localStorage on the app's origin). The realistic high-impact bug
  is therefore **script execution on markdownstudio.com** (it can read every
  stored document of every visitor who runs it) — through imported content, the
  embed's bridge, a dependency, or the deploy pipeline.
- **The import relay** (`api/import.js`) — SSRF against internal addresses, or
  abuse as a proxy.
- **The supply chain** — a malicious dependency or GitHub Action, or a
  compromised npm publish of `@perssonify/editor`.

## Triage (first hour)
1. **Acknowledge** the reporter (target: 3 business days, SECURITY.md) and ask
   them to keep it private until a fix is live.
2. **Reproduce** on a current build. Classify: script execution on our origin /
   data exposure across origins (embed bridge) / SSRF / proxy abuse / supply
   chain / low impact.
3. **Decide whether to stop the bleeding now**:
   - Script execution via some content path → consider promoting the
     `Content-Security-Policy-Report-Only` header in `vercel.json` to enforcing
     *immediately*; it blocks injected inline script. `e2e/cases/csp.mjs` runs
     the app under the ENFORCED policy (KaTeX, Mermaid, abcjs, a `data:`
     image, Find, the map, Cards, Word export, /help) with zero violations; a
     password-protected ZIP import is the one path it does not exercise.
   - Relay SSRF or abuse → Firewall deny rule on `/api/import`
     ([relay-abuse.md](relay-abuse.md)).
   - Compromised npm release → [bad-npm-release.md](bad-npm-release.md).
   - Compromised deploy → roll back (Vercel ▸ promote last good deployment) and
     rotate the Vercel and GitHub credentials involved.

## Fix and ship
- Fix on a private branch; add a regression test (mutation-test it); run the
  full gate (`bun run lint`, `bunx tsc --noEmit`, `bun run test`, the three
  builds, the e2e suites).
- Deploy. Users receive it via the update prompt; for a severe issue, say in the
  advisory that users should press **Reload** (or close all tabs), because
  nothing force-reloads an open tab.
- For the npm package: publish a fixed version (tag `vX.Y.Z` → the Publish
  workflow) and deprecate the vulnerable range:
  `npm deprecate @perssonify/editor@"<X.Y.Z" "Security fix in X.Y.Z — upgrade"`.

## Disclose
- Credit the reporter (unless they decline) and publish an advisory once the
  fix is live — on the website or the package's README if the repository stays
  private.
- If personal data could have been exposed, involve whoever owns legal and
  privacy obligations; timelines for notification may apply.

## Afterwards
- Add the case to `SECURITY.md`'s scope if it revealed a new surface.
- Review: which control failed, and which test would have caught it.
- Renew `public/.well-known/security.txt` before its `Expires` date
  (`ops-release-config.test.js` fails 30 days ahead as a reminder).
