# Runbooks — When Things Break

This is a **client-only app**: "incidents" are things a user hits in their browser, or a broken deploy — there's no server to page about. Each runbook follows: **symptoms → diagnosis → remediation → escalation.**

| Runbook | Use when… |
|---------|-----------|
| [documents-disappeared.md](documents-disappeared.md) | A user says their documents vanished |
| [sync-loop-or-frozen-editor.md](sync-loop-or-frozen-editor.md) | The editor freezes, spikes CPU, or panes flicker |
| [storage-quota-exceeded.md](storage-quota-exceeded.md) | Saving fails / a quota error appears |
| [deploy-broken.md](deploy-broken.md) | The Vercel deploy fails or serves a blank page |

General first step for any browser issue: open devtools and read the `[DIAG]` logs ([src/utils/diag.ts](../../src/utils/diag.ts)) — they timestamp boot, engine init, and errors.
