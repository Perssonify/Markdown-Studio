# Security Policy

Markdown Studio (npm package `@perssonify/editor`) is a browser-based Markdown
editor. Documents are converted in the visitor's browser and stored there
(IndexedDB). The hosted app at `https://markdownstudio.com` also has accounts:
visitors sign in with Google, and their documents, folders and images sync to
their account. That server side is `apps/api`:

- **Accounts** — Google sign-in through Better Auth (`/api/auth/*`), with
  sessions in Postgres.
- **Cloud sync** — `/api/sync/*`: each user's documents, folder tree, images,
  past versions and daily backups, stored in a private S3 bucket and indexed in
  Postgres.
- **The import relay** — `apps/web/api/import.js`, a first-party proxy that
  fetches a user-supplied URL on the app's own origin so the browser can import
  from hosts that send no CORS headers. The app uses it only after the visitor
  has agreed to it (asked once, then remembered).

The editor also runs with no backend at all (a static build, or the npm
package), in which case only the browser-side surfaces below apply.

We take reports about any of these seriously. Thank you for looking.

## Supported versions

| What                                              | Supported |
| ------------------------------------------------- | --------- |
| The live deployment (`https://markdownstudio.com`) | Yes       |
| Current `main`                                     | Yes       |
| Latest published `@perssonify/editor` on npm       | Yes       |
| Any older tag, release or npm version              | No        |

The app is continuously deployed from `main`, so there is nothing to
back-port to: fixes land on `main`, ship to the live deployment, and go out in
the next npm release. Please reproduce against
the live site or a current `main` build before reporting.

## Reporting a vulnerability

**Please do not open a public issue for a security problem, and please do not
post a working exploit in a pull request.**

Report privately, either way:

- **GitHub:** [report a vulnerability](https://github.com/Perssonify/Markdown-Studio/security/advisories/new)
  (private vulnerability reporting on this repository), or
- **E-mail:** **<security@markdownstudio.com>**

The e-mail address is also published at
<https://markdownstudio.com/.well-known/security.txt> (RFC 9116). If you want
to encrypt your report, say so in a first short message and we will agree a way
to exchange it.

A useful report includes:

- the affected surface (accounts / sync API / relay / import path / embed
  parameter / library API),
- the exact URL, file or parameter value that triggers it,
- what an attacker gains (be specific — reading or changing another user's
  documents, taking over a session, reading another origin's data, executing
  script on `markdownstudio.com`, reaching a host the relay should refuse,
  corrupting stored documents),
- steps to reproduce, and the browser/OS if it is browser-specific.

### What to expect

| Stage                                                          | Target            |
| -------------------------------------------------------------- | ----------------- |
| Acknowledgement that we received the report                     | 3 business days   |
| Initial assessment (in scope? severity? reproduced?)            | 7 calendar days   |
| Fix deployed for a confirmed high-severity issue                | 30 calendar days  |
| Public advisory / credit, once a fix is live                    | after the fix     |

We are a small team, not a 24/7 response desk — those are honest targets, not
an SLA. We will tell you if something is going to take longer, and we are happy
to credit you in the advisory unless you would rather stay anonymous. There is
no bug bounty.

## In scope

**Accounts and sessions — `apps/api/src/modules/auth`.** Google sign-in through
Better Auth, with its origin check switched on explicitly. A way to sign in as
someone else, to steal or fixate a session, to bypass the origin check, or to
turn the sign-in callbacks into an open redirect is in scope.

**Cloud sync — `apps/api/src/modules/sync`.** Every route acts only on the
signed-in user's own library. Reading, writing, deleting or listing another
user's documents, images, versions or backups is in scope, as is getting a
presigned S3 link for an object that isn't yours, or a write that skips the
server's revision check (`base`) and overwrites newer content.

**The import relay — `apps/web/api/import.js`.** It is internet-facing and deliberately
hardened; anything that gets past one of these controls is a valid report:

- **SSRF.** `http(s)` only; `localhost`, `*.local` and `*.internal` refused;
  the resolved address must be **global unicast** — an allowlist, checked
  *after* DNS resolution, so private, loopback, link-local, CGNAT,
  cloud-metadata, multicast, reserved and documentation space are refused in
  both families, as is every IPv4-in-IPv6 wrapper except the plain
  `::ffff:a.b.c.d` mapping (which is judged as the IPv4 it spells).
- **Per-hop revalidation.** Redirects are followed manually and every hop is
  re-validated (scheme, port, host, resolved addresses).
- **DNS rebinding.** The vetted IPs are pinned to the connection through an
  undici dispatcher, so `fetch` cannot re-resolve to a different address
  between validation and connect (TOCTOU).
- **Port allowlist.** Only ports 80 and 443, on the initial URL *and* on every
  redirect hop.
- **First-party gate.** `Sec-Fetch-Site` must be `same-origin` or `none`, so a
  cross-site page cannot use a visitor's browser to drive the relay, and reads
  are CORS-restricted to the two production origins exactly. This does **not**
  stop a non-browser client, which can send any header it likes: to a script
  the relay is a bounded proxy (public destinations, ports 80/443, ≤ 4 MB,
  ≤ 20 s), and volume limits belong at the platform (a firewall rule the
  operator configures). Using it as that bounded proxy is known and not a
  finding; getting it to exceed one of those bounds is.
- **Response neutralisation.** The upstream `Content-Type`/`Content-Disposition`
  are never reflected; responses are forced to
  `application/octet-stream` + `Content-Disposition: attachment` +
  `Content-Security-Policy: default-src 'none'; sandbox` + `nosniff`, so a
  same-origin navigation to `/api/import?url=…` cannot render attacker HTML on
  our origin.
- **Resource bounds.** A 4 MB response cap, request timeout, redirect-hop cap and
  a best-effort per-IP rate limit (in memory, per warm instance). The durable
  rate limit is a platform firewall rule, set up by the operator.

**The import / ingest path (client side).** Content arriving from a file, an
archive, a URL import or a paste is untrusted:

- HTML ingest sanitisation (`src/store/importExport/ingest.ts` `sanitizeForIngest`) and the
  inert-`DOMParser` conversion in `src/store/documents/canonical-ops.ts` — script
  execution, mutation-XSS or forced resource loads from imported content.
- Archive extraction (`src/store/importExport/archive.ts`) — path traversal or
  prototype-pollution keys getting past `normalizeArchivePath` into the folder
  tree or a storage key, and anything that lets a crafted archive read or
  overwrite documents it should not touch.
- `?import_url=` — it only *pre-fills* the importer and must never auto-fetch.

**The embed and host-supplied parameters.** `embed.html` / the `integration`
entry point accept host-controlled values (`theme`, `bg`, `accentColor`,
`view_mode`, `readonly`, `chrome`, `allowed_origin`). CSS colours go through
`sanitizeCssColor` (`src/theme/palette.ts`). A parameter value that escapes
into script, breaks out of the iframe, or turns into an outbound network
request is in scope. The embed's host bridge can read and write the documents
the embed sees; which origin may drive it is decided by
`src/integration/embed-origins.ts` (a deploy-time `VITE_EMBED_ALLOWED_ORIGINS`
allowlist, then the browser-reported framer). A framing page that gets bridge
access despite a configured allowlist, or while naming a window other than
itself, is in scope. An embed deployed WITHOUT an allowlist trusts whoever
frames it — that is documented behaviour, not a finding.

**The library API.** `@perssonify/editor` consumed as a package: an input a
host passes in (initial document, host bridge calls) that leads to script
execution in the host page.

## Not in scope

- **The visitor's own browser storage.** Documents live in IndexedDB
  (including the `perssonify-snapshots` version-history sidecar), and the unload
  stash, drafts and preferences in `localStorage` (`pf:` keys) — in plain text,
  by design. Anyone with access to the device, the browser profile, or devtools
  on the page can read them. That is the product's threat model, not a
  vulnerability. (Settings ▸ Local data ▸ Erase all local data removes them.)
- **Synced content is not end-to-end encrypted.** It is encrypted at rest in S3
  with AWS-managed keys, and the service can read it. That is documented, not
  a finding; a way for anyone else to read it is.
- **Self-XSS in your own document.** You can author raw HTML in your own
  editor; content you type into your own browser is not a cross-user issue.
  Content that arrives via *import* is a different matter and is in scope.
- **Anything requiring a compromised device, malicious browser extension, or
  physical access.**
- **Denial of service against your own tab** — pasting a 200 MB document and
  freezing the renderer is a performance bug; file it as a normal issue.
- **Missing hardening headers on a local `bun run dev` server**, or on a fork's
  own deployment. Report against the live deployment.
- **Third-party dependency advisories with no demonstrated impact here.** A
  Dependabot alert with a working path into this app is welcome; a raw CVE list
  is not a report.
- **Automated-scanner output** (missing `SameSite` on a cookie we do not set,
  "no CSP" on an asset, etc.) without a concrete exploit.
- **Social engineering, phishing, spam** of the maintainers or of
  markdownstudio.com.

## Testing guidelines

Test against your own browser and your own documents. When probing the relay,
please use your own hosts as targets, keep request volume low (there is a
per-IP rate limit for a reason), and do not attempt to degrade the service for
other people. Use your own Google account (or a test account you
own) and your own documents. Do not attempt to access accounts,
infrastructure, or data that is not yours: if you find you can, stop, and
report what you found without looking further.
