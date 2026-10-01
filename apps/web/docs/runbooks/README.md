# Runbooks — When Things Break

Most "incidents" here are things a user hits in their browser; the rest are the
hosting, the one server function (the import relay), the service worker, and
the npm package. Each runbook follows: **symptoms → diagnosis → remediation →
escalation.**

| Runbook | Use when… |
|---------|-----------|
| [documents-disappeared.md](documents-disappeared.md) | A user says their documents vanished — check Version history and the unload stash before saying "gone" |
| [sync-loop-or-frozen-editor.md](sync-loop-or-frozen-editor.md) | The editor freezes, spikes CPU, or panes flicker |
| [storage-quota-exceeded.md](storage-quota-exceeded.md) | The status bar says "Storage full — not saving" / a quota error appears |
| [deploy-broken.md](deploy-broken.md) | The Vercel deploy fails or serves a blank page |
| [stuck-service-worker.md](stuck-service-worker.md) | "The new version never arrives", or a blank page that survives reloads |
| [hosting-outage.md](hosting-outage.md) | markdownstudio.com is down, parked, or shows a Vercel/TLS error |
| [relay-abuse.md](relay-abuse.md) | Spend alerts, or `/api/import` being used as a proxy |
| [security-incident.md](security-incident.md) | A vulnerability report, or signs of an exploit |
| [bad-npm-release.md](bad-npm-release.md) | A broken or unexpected `@perssonify/editor` version on npm |

**General first step for any browser issue:** ask for **Copy diagnostics** (the
crash screen, or Help ▸ About). It is a privacy-safe list of recent errors —
kind, app version, browser family, redacted message, script position — plus
failed/refused/conflicted saves and boot-watchdog recoveries, with no document
content ([src/utils/diagnostics.ts](../../src/utils/diagnostics.ts)). For deeper
tracing, the `[DIAG]` console logs ([src/utils/diag.ts](../../src/utils/diag.ts))
are OFF by default: enable them with `?diag=1` or
`localStorage.setItem("perssonify-diag", "1")` and reload.
