# Security Policy

Markdown Studio (npm package `@perssonify/editor`) is a client-only Markdown
editor: documents are created, converted and stored entirely in the visitor's
browser, with no account and no document upload. The one server-side component
is `api/import.js` — a first-party "import relay" that fetches a user-supplied
URL on the app's own origin so the browser can import from hosts that send no
CORS headers.

We take reports about that relay, about the import/ingest path, and about the
embed's host-supplied parameters seriously. Thank you for looking.

## Supported versions

| What                                              | Supported |
| ------------------------------------------------- | --------- |
| The live deployment (`https://markdownstudio.com`) | Yes       |
| Current `main`                                     | Yes       |
| Latest published `@perssonify/editor` on npm       | Yes       |
| Any older tag, release or npm version              | No        |

The app is continuously deployed from `main` and holds no server-side user
data, so there is nothing to back-port to: fixes land on `main`, ship to the
live deployment, and go out in the next npm release. Please reproduce against
the live site or a current `main` build before reporting.

## Reporting a vulnerability

**Please do not open a public issue for a security problem, and please do not
post a working exploit in a pull request.**

Report privately through GitHub's private vulnerability reporting:

- <https://github.com/SolutionPath/markdown-studio/security/advisories/new>

(If that page is not available to you, open a public issue that says only
"security report, requesting a private channel" — with **no** details — and a
maintainer will open an advisory and invite you to it.)

A useful report includes:

- the affected surface (relay / import path / embed parameter / library API),
- the exact URL, file or parameter value that triggers it,
- what an attacker gains (be specific — reading another origin's data,
  executing script on `markdownstudio.com`, reaching a host the relay should
  refuse, corrupting stored documents),
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

**The import relay — `api/import.js`.** It is internet-facing and deliberately
hardened; anything that gets past one of these controls is a valid report:

- **SSRF.** `http(s)` only; `localhost`, `*.local` and `*.internal` refused;
  private, loopback, link-local, CGNAT and cloud-metadata addresses refused
  *after* DNS resolution, including IPv6 loopback/ULA/link-local and the
  IPv4-in-IPv6 forms (mapped, NAT64, 6to4).
- **Per-hop revalidation.** Redirects are followed manually and every hop is
  re-validated (scheme, port, host, resolved addresses).
- **DNS rebinding.** The vetted IPs are pinned to the connection through an
  undici dispatcher, so `fetch` cannot re-resolve to a different address
  between validation and connect (TOCTOU).
- **Port allowlist.** Only ports 80 and 443, on the initial URL *and* on every
  redirect hop.
- **First-party gate.** `Sec-Fetch-Site` must be `same-origin` or `none`; an
  absent header (non-browser client) is refused, so the relay is not an open
  proxy. Reads are CORS-restricted to this project's own origins.
- **Response neutralisation.** The upstream `Content-Type`/`Content-Disposition`
  are never reflected; responses are forced to
  `application/octet-stream` + `Content-Disposition: attachment` +
  `Content-Security-Policy: default-src 'none'; sandbox` + `nosniff`, so a
  same-origin navigation to `/api/import?url=…` cannot render attacker HTML on
  our origin.
- **Resource bounds.** Hard byte cap, request timeout, redirect-hop cap and a
  best-effort per-IP rate limit.

**The import / ingest path (client side).** Content arriving from a file, an
archive, a URL import or a paste is untrusted:

- HTML ingest sanitisation (`src/store/ingest.ts` `sanitizeForIngest`) and the
  inert-`DOMParser` conversion in `src/store/canonical-ops.ts` — script
  execution, mutation-XSS or forced resource loads from imported content.
- Archive extraction (`src/store/archive.ts`) — path traversal or
  prototype-pollution keys getting past `normalizeArchivePath` into the folder
  tree or a storage key, and anything that lets a crafted archive read or
  overwrite documents it should not touch.
- `?import_url=` — it only *pre-fills* the importer and must never auto-fetch.

**The embed and host-supplied parameters.** `embed.html` / the `integration`
entry point accept host-controlled values (`theme`, `bg`, `accentColor`,
`view_mode`, `readonly`, `ads`, `chrome`). CSS colours go through
`sanitizeCssColor` (`src/theme/palette.ts`). A parameter value that escapes
into script, breaks out of the iframe, or turns into an outbound network
request is in scope.

**The library API.** `@perssonify/editor` consumed as a package: an input a
host passes in (initial document, host bridge calls) that leads to script
execution in the host page.

## Not in scope

- **The visitor's own browser storage.** Documents live in `localStorage`
  (`pf:` keys) and IndexedDB (including the `perssonify-snapshots` sidecar) in
  plain text, by design — there is no server and no encryption at rest. Anyone
  with access to the device, the browser profile, or devtools on the page can
  read them. That is the product's threat model, not a vulnerability.
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
other people. Do not attempt to access accounts, infrastructure, or data that
is not yours — there are no user accounts to access.
