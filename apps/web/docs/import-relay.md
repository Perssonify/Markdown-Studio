# The import relay (`/api/import`)

> **Audience:** a developer who has to fix, extend, harden, or replace the relay.
> **TL;DR:** it is one file — [`api/import.js`](../api/import.js) — a same-origin
> serverless function that fetches a user-supplied URL server-side so the browser
> can import from hosts that refuse cross-origin reads. It is the only server-side
> code in an otherwise entirely client-side product, and it is internet-facing, so
> most of the file is not fetching — it is refusing to fetch.

---

## Where to look

| What | File | Notes |
|------|------|-------|
| **The relay itself** | [`api/import.js`](../api/import.js) | Vercel Serverless Function, Node runtime. Default export is the handler; `isGlobalUnicast`, `isBlockedIp`, `assertPublicUrl`, `MAX_BYTES` and `TOO_LARGE_MESSAGE` are exported for tests. |
| **The client that calls it** | [`src/store/importExport/url-import.ts`](../src/store/importExport/url-import.ts) | `fetchDirectOrProxy` — tries a direct browser fetch first and falls back to the relay only with the visitor's consent: `relayPermitted` reads the stored answer (`pf:import-relay`), and only when there is none does it ask through the caller's `confirmRelay` callback, then remember the reply. `IMPORT_RELAY = "/api/import?url="`. A relay `413` is shown to the user as the relay's own message; any other non-2xx falls through to the download-and-drop guidance. |
| **Provider URL rewriting** | [`src/store/importExport/import-url-normalize.ts`](../src/store/importExport/import-url-normalize.ts) | Turns share links into raw-download links *before* either fetch path runs. |
| **The UI** | [`src/ui/importExport/urlImportDialog/index.tsx`](../src/ui/importExport/urlImportDialog/index.tsx), [`src/ui/settings/settingsPrivacy/index.tsx`](../src/ui/settings/settingsPrivacy/index.tsx) | The dialog supplies `confirmRelay` (`useDialog().confirm` with `relayConsentPrompt`'s wording) and says when the relay was used ("fetched through the Markdown Studio server, as you allowed"). Settings ▸ Privacy ▸ **Import relay** changes the stored answer. |
| **Tests** | [`src/__tests__/import-relay.test.js`](../src/__tests__/import-relay.test.js), [`src/__tests__/import-relay-dispatcher.test.js`](../src/__tests__/import-relay-dispatcher.test.js), [`src/__tests__/ops-relay-client.test.js`](../src/__tests__/ops-relay-client.test.js), [`src/__tests__/g4-relay-consent.test.js`](../src/__tests__/g4-relay-consent.test.js) | The global-unicast allowlist (incl. the IPv4-in-IPv6, Teredo, 6to4, multicast/reserved and decimal/octal forms), `assertPublicUrl`, the `Sec-Fetch-Site` gate, response hardening, the port allowlist, the 4 MB cap, the log line, CORS pinning; a real request through the pinned `Agent` and undici's own `fetch`; the client's handling of a `413`; and the consent rules (never without a way to ask, a stored "deny" wins, a failed prompt counts as "no"). |
| **Routing** | [`vercel.json`](../vercel.json) | The SPA rewrite is `/((?!api/\|assets/\|\.well-known/).*)` — the `api/` exclusion is what keeps this function reachable. Delete it and every relay call returns `index.html`. `functions["api/import.js"].maxDuration` (25 s) caps what one slow upstream can cost. |

There is **no other server code in the repo.** If you are looking for a backend, this is it.

---

## Why it exists

Markdown Studio imports documents from a URL. The browser does that with `fetch()`,
which is subject to CORS: the *upstream* host decides whether a page on another
origin may read its bytes. Plenty of hosts say no — most importantly **Google
Drive**, which sends no `Access-Control-Allow-Origin` header to a real browser at
all. Without a server hop, "Import from URL" simply cannot work for those hosts.

The alternative — routing through a public CORS proxy — was rejected: it hands a
third party the URL, the bytes, and the user's IP. A first-party relay on the app's
own origin adds no proxy operator beyond the app's own hosting, and the host being
imported from sees the relay's request, not the user's IP. It does not make the
request private: the relay receives the address being imported (share links often
carry tokens), fetches the file, and passes it back through our server — and, like
any request, the address can land in the hosting provider's request logs. (The
relay's own log line records hosts only, never a path or query.) That is why it is
opt-in (below).

**The relay is a fallback, not the default path, and it needs the visitor's
consent.** `fetchDirectOrProxy` attempts a direct browser fetch first. Only when
that throws (CORS or network error) does it consider the relay, and only if the
visitor has agreed: the first time, the importer asks through its `confirmRelay`
callback ("Fetch this link through our server?", worded by `relayConsentPrompt`),
and the answer — yes or no — is remembered in `pf:import-relay`
(`getRelayConsent` / `setRelayConsent`) and can be changed any time in **Settings ▸
Privacy ▸ Import relay**. Without a stored "allow", and with no way to ask (a
caller that passes no `confirmRelay`), the relay is never contacted; the user gets
the download-and-drop guidance instead, which names the Settings switch. Hosts the
browser can already read — GitHub raw, Dropbox, anything that sets the CORS header
— never touch the relay at all.

A direct *timeout* is meant to be surfaced as a timeout and not retried, because a
slow origin does not get faster through an extra hop. The check does not work in
current browsers: it looks for an `AbortError`, but a fetch cut off by
`AbortSignal.timeout()` rejects with a `TimeoutError`. So a timed-out direct fetch
is handled like a CORS failure — the consent question, if unanswered, then a relay
attempt — and, when that fails too, ends with a "blocks direct browser access"
message instead of "timed out".

---

## What it does, end to end

```
UrlImportDialog
      │  raw URL typed/pasted by the user
      ▼
normalizeImportUrl()          share link → raw-download link
      │                       (Google Drive/Docs, GitHub blob, Dropbox)
      ▼
validateImportUrl()           http(s) only; reject localhost/.local/.internal and
      │                       literal private/loopback/link-local/CGNAT IPs
      ▼
fetch(url)  ── succeeds ──▶   bytes ──▶ ingest
      │
      └─ throws (CORS/network)
             │
             ▼
      consent? (pf:import-relay; asked once, Settings ▸ Privacy)
             │  "deny" / never asked with no UI ──▶ download-and-drop guidance
             ▼  "allow"
      fetch("/api/import?url=…")        ← the relay, same origin
             │
             ▼
      ┌─────────────────────────────────────────────┐
      │ api/import.js                               │
      │  1. CORS + Vary + nosniff headers           │
      │  2. GET only (OPTIONS → 204)                │
      │  3. Sec-Fetch-Site must be same-origin/none │
      │  4. per-IP rate limit                       │
      │  5. parse url param; port ∈ {80,443}        │
      │  6. safeFetch: for each hop (≤5)            │
      │       assertPublicUrl → DNS →               │
      │         global-unicast ALLOWLIST            │
      │       pin those IPs to the connection       │
      │       fetch with redirect:"manual"          │
      │  7. readCapped: 4 MB hard ceiling (413)     │
      │  8. respond octet-stream + attachment + CSP │
      │  9. ONE JSON log line (every path)          │
      └─────────────────────────────────────────────┘
             │
             ▼
      bytes ──▶ ingest   (format sniffed from body + URL + X-Upstream-Content-Type)
```

### Limits, in one table

| Knob | Value | Where |
|------|-------|-------|
| Max response size | 4,000,000 bytes (`MAX_BYTES`) → `413` + `TOO_LARGE_MESSAGE` ("…larger than the 4 MB the import relay can carry. Download it and drag it into the editor instead.") | `api/import.js` — a Vercel Function cannot return a body much over 4.5 MB, so this is the real ceiling for every relayed import (Google Drive always goes through the relay). Checked on the declared `Content-Length` and again while streaming. |
| Function wall clock | 25 s (`maxDuration`) | `vercel.json` — the platform backstop above the 20 s upstream timeout |
| Upstream timeout | 20 s per hop (`TIMEOUT_MS`) | `api/import.js` |
| Client timeout | 15 s (`URL_TIMEOUT_MS`) | `src/store/importExport/url-import.ts` — so the client gives up first |
| Redirect hops | 5 (`MAX_HOPS`) | `api/import.js` |
| Rate limit | 40 req / 60 s per IP (`RATE_MAX`) | `api/import.js` — in-memory, **per warm instance**; see [Operating it](#operating-it-owner-setup) for the real one |
| Client text cap | 5 MB (`MAX_URL_BYTES`) | `src/store/importExport/url-import.ts` — reachable only on a DIRECT fetch; through the relay the 4 MB cap wins |
| Client archive cap | 20 MB (`MAX_ARCHIVE_BYTES`) | `src/store/importExport/url-import.ts` — likewise direct-fetch only |

---

## The threat model, control by control

An unauthenticated endpoint that fetches an arbitrary URL is, by default, three
vulnerabilities wearing a trench coat: an SSRF gadget, an open proxy, and an XSS
vector. Each control below exists because of one of those.

### 1. SSRF — "fetch this and tell me what you see"

The attack is `?url=http://169.254.169.254/latest/meta-data/` (cloud credentials),
or any address on the deployment's internal network.

- **`isGlobalUnicast` is an ALLOWLIST.** An address is fetchable only when it is
  positively identified as global unicast; `isBlockedIp` is simply its
  complement. It replaced a blocklist that had to name every special range and
  did not — `::127.0.0.1` (IPv4-compatible), `::ffff:0:127.0.0.1` (IPv4-translated),
  Teredo, multicast and reserved space all passed it.
  - **IPv4:** everything except the IANA special-purpose blocks that are not
    globally reachable (`0/8`, `10/8`, `100.64/10` CGNAT, `127/8`, `169.254/16`
    link-local — also the cloud-metadata address — `172.16/12`, `192.0.0/24`,
    the three TEST-NETs, `192.88.99/24`, `192.168/16`, `198.18/15`), multicast
    `224/4` and reserved `240/4` (incl. `255.255.255.255`).
  - **IPv6:** only `2000::/3`, minus `2001::/23` (IETF assignments, incl. Teredo
    `2001::/32`), `2001:db8::/32` and `3fff::/20` (documentation) and `2002::/16`
    (6to4 — a tunnel, not a destination). Everything outside `2000::/3` — `::`,
    `::1`, NAT64, ULA, link-local, multicast, and every IPv4-in-IPv6 wrapper —
    is refused by that one test. The single exception is the plain mapped form
    `::ffff:a.b.c.d`, which is unwrapped and judged as the IPv4 it spells.
  - **Numeric host spellings** (`2130706433`, `0177.0.0.1`, `0x7f.1`, `127.1`)
    need no special case: the WHATWG URL parser normalises them to dotted-quad
    before the relay sees the hostname. The tests pin that too.
- **Checked after DNS resolution, not on the string.** `assertPublicUrl` resolves
  the hostname with `dns.lookup(..., {all:true})` and rejects if *any* returned
  address is not global unicast. A hostname that resolves to `127.0.0.1` is refused.
- **Unparseable input fails closed** — anything that is not a valid IP literal is
  not global unicast.

### 2. DNS rebinding — the TOCTOU on top of the SSRF check

Validating an IP and then calling `fetch()` lets the resolver hand back a
*different* address the second time. The fix is **pinning**: `pinnedDispatcher`
builds an undici `Agent` whose `lookup` returns only the already-vetted addresses,
and refuses if the hostname does not match. `fetch` cannot re-resolve.

`pinnedFetch` makes the request with **undici's own `fetch`**, never Node's global
one. The global `fetch` is a separate copy of undici bundled with Node (7.x in
Node 24), and a dispatcher only works with the `fetch` of its own major: with
undici 8's `Agent`, the global `fetch` failed EVERY request (`invalid
onRequestStart method`) while the stubbed unit tests stayed green.
[`import-relay-dispatcher.test.js`](../src/__tests__/import-relay-dispatcher.test.js)
drives the real pairing over a socket, against a local server.

### 3. Redirects — where most relay hardening leaks

`safeFetch` sets `redirect: "manual"` and walks the chain itself, calling
`assertPublicUrl` **and** building a fresh pinned dispatcher for **every hop**. A
public URL that 302s to `http://169.254.169.254/` is caught on hop 2. The port
allowlist lives inside `assertPublicUrl` for the same reason — put it only on the
initial URL and a redirect to `http://host:6379` walks straight through.

### 4. Proxy abuse — "use their server to fetch my traffic"

**Be precise about what this section claims.** The relay is *not* closed to
non-browser clients: `curl -H 'sec-fetch-site: none' …/api/import?url=…` gets a
`200` for any public URL. Earlier versions of this page, and of `SECURITY.md`,
said the `Sec-Fetch-Site` check made it "not an open proxy"; that was wrong.
What the controls actually buy:

- **`Sec-Fetch-Site` must be `same-origin` or `none`.** It is a forbidden header,
  so *page JavaScript* cannot set it. That stops a cross-site page from using a
  visitor's browser to drive the relay — nothing more. An absent header is
  rejected, which filters careless scripts, not deliberate ones.
- **What a determined client gets is a bounded proxy:** public (global-unicast)
  destinations only, ports 80/443 only, ≤ 4 MB per response, ≤ 20 s upstream,
  ≤ 5 redirects, and a best-effort 40 req/min per IP *per warm instance*.
- **The real rate limit and cost control live in the platform**, not in this
  file — see [Operating it](#operating-it-owner-setup). Until those are set up,
  treat the relay as a small, bounded open proxy.
- **`Access-Control-Allow-Origin` is echoed only for the two production
  origins, exactly** (`https://markdownstudio.com`, `https://www.markdownstudio.com`).
  A preview deployment calls its own relay same-origin and needs no grant; the
  old `markdown-studio-*.vercel.app` pattern bought nothing, and
  `markdown-studio.vercel.app` itself belongs to a different product.

### 5. XSS via reflected content type — the one that was a real bug

If the relay reflected the upstream `Content-Type`, an attacker could serve
`text/html` and a **same-origin navigation** to `/api/import?url=…` would render
their HTML **on this origin**, with access to every stored document. The response
is therefore nailed shut:

```
Content-Type: application/octet-stream
Content-Disposition: attachment
Content-Security-Policy: default-src 'none'; sandbox
X-Content-Type-Options: nosniff
Cache-Control: no-store
```

The real upstream type is forwarded in **`X-Upstream-Content-Type`**, a custom
header no browser will render, and the client reads it for its format hint. Nothing
is lost: the client sniffs the format from the body and URL anyway.

**Never reintroduce upstream-header reflection.** It is pinned by
`import-relay.test.js` → *"NEVER reflects the upstream Content-Type / Content-Disposition"*.

### 6. Failure disclosure

A failing upstream returns `502` with a status number and **no body relayed**, so
the relay cannot be used to read a response it just refused to hand over.

---

## Running and testing it

### The unit tests (part of the verify gate)

```bash
bun run test src/__tests__/import-relay.test.js
```

They import `isGlobalUnicast`, `isBlockedIp`, `assertPublicUrl` and the handler
directly and drive the handler with fake `req`/`res` objects — **no network, no
Vercel**. That is why the suite covers the address allowlist, the `Sec-Fetch-Site`
gate, response hardening, the port allowlist, the 4 MB cap (buffered AND streamed
bodies), the log line and CORS pinning, and does *not* cover redirect-chain
behaviour end to end (see Limitations).

### Locally

`bun run dev` is **Vite only — it does not serve `/api`.** A relay call in local
dev returns the SPA's `index.html`, the client's `res.ok` check passes but the body
is HTML, and the import fails confusingly. Two options:

```bash
# 1. Run the real function locally (needs the Vercel CLI; it is deliberately NOT
#    a dependency of this repo)
npx vercel dev

# 2. Exercise the handler directly, which is usually what you actually want
bun run test src/__tests__/import-relay.test.js
```

Against a deployment, `curl https://…/api/import?url=…` returns `403` because curl
sends no `Sec-Fetch-Site` — but `curl -H 'sec-fetch-site: none' …` returns the
file. That is expected (see §4); it is why the platform rate limit matters. To
test by hand, open the deployed app and use **File ▸ Import ▸ From URL…** with a
CORS-blocked host (a Google Drive share link is the canonical case), agree to the
consent question (or switch the relay on in Settings ▸ Privacy first), then confirm
the dialog says the file was fetched through the Markdown Studio server and that
the request produced one `"evt":"import_relay"` line in the deployment's logs.

### Adding a control

1. Put the logic in `api/import.js` as an **exported pure function** if it is
   classifiable input (like `isBlockedIp`), so it can be unit-tested without a
   network.
2. If it applies to a URL, put it in **`assertPublicUrl`**, not in the handler —
   that is the function every redirect hop calls. Handler-level checks only see
   hop 0.
3. Add the test to `import-relay.test.js`, then **break the control and confirm the
   test fails.** A guard with a test that passes either way is not a guard.
4. Give every new refusal a `reason` code, so it shows up in the log line.

---

## Operating it (owner setup)

The code bounds what ONE request can cost. Nothing in a stateless function can
bound what a million of them cost, so these steps are part of running the relay,
not optional polish. None of them needs a code change; they are Vercel project
settings an owner has to make once.

1. **Firewall rate limit (do this first).** Vercel dashboard → the project →
   **Firewall → Configure → Add rule**. Condition: *Request Path* **starts with**
   `/api/import`. Action: **Rate Limit**, fixed window **60 s**, **20 requests**,
   keyed on **IP**, then **Deny (429)**. It runs at the edge, before the function
   is invoked, so it is also the only limit that saves money. (Rate-limit rules
   depend on the plan; if the project's plan lacks them, use the kill switch in
   step 5 as the incident response and move the counter into code — step 2.)
2. **A shared counter, if the platform rule is not available.** The in-memory
   `rateBuckets` resets per instance. A real quota needs shared state — Upstash
   Redis from the Vercel Marketplace with a sliding-window limiter is the usual
   shape. That is a new dependency, so it is a decision for the owner, not something
   to slip in: key it on IP **and** add a
   coarse global ceiling, and fail OPEN to the in-memory limiter if the store is
   unreachable, so a Redis outage does not take imports down.
3. **Spend management.** Team **Settings → Billing → Spend Management**: set a
   monthly budget with notifications at 50 / 75 / 100 %. Decide deliberately
   whether hitting it should pause production — that pauses the whole app, not
   just the relay. Add usage alerts for **Function invocations** and **Fast Data
   Transfer**, the two meters relay abuse moves.
4. **Watch the log line.** Every request writes one JSON line:
   `{"evt":"import_relay","method","sfs","host","finalHost","hops","status","bytes","ms","reason"}`
   — hosts only, never a path or query, and no client IP (the platform's own
   request log already has it). Search the deployment logs for
   `"evt":"import_relay"`, or add a Log Drain to wherever alerts live. Signs of
   abuse: a burst of `rate_limited`; `blocked_address` / `blocked_host` (SSRF
   probing); a high share of `sfs:"none"` (a browser only sends that on a direct
   navigation, which the app never does — it is almost always a script); many
   different `host`s at a steady rate.
5. **Kill switch.** If the relay is being abused faster than you can tune a rule,
   add a Firewall rule that **denies** `/api/import` outright. It takes effect
   without a deploy, and the app degrades exactly as it does on a static host:
   direct imports keep working, CORS-blocked hosts get the download-and-drop
   guidance.
6. **Runtime.** `api/import.js` imports `undici` at runtime, so it must stay a
   production dependency (it is, in `dependencies`), and the project's Node.js
   version should be pinned
   (Project Settings → Node.js Version, matching `engines.node`) so a platform
   default change cannot move it underneath the pinned-dispatcher code.

The incident procedure is [runbooks/relay-abuse.md](runbooks/relay-abuse.md).

---

## Current limitations

Stated plainly, because the next person will hit them:

- **The rate limit is per warm instance, in memory.** `rateBuckets` is a `Map` in
  a serverless function. Scale out, or get a cold start, and the counter resets.
  It raises the cost of casual abuse; it is not a real quota — the Firewall rule
  in [Operating it](#operating-it-owner-setup) is.
- **It is usable as a (bounded) proxy by any HTTP client.** See §4: the
  `Sec-Fetch-Site` gate only constrains browsers.
- **`x-forwarded-for` is trusted for the client IP.** Behind Vercel that is set by
  the platform, but the code does not verify the hop count. On a different host,
  or behind an extra proxy, it is spoofable — and the rate limit is the only thing
  keyed on it.
- **No authentication or per-user quota.** Any visitor to the app can drive the
  relay at the rate limit. The product has no accounts, so there is nothing to key
  a real quota to.
- **No allowlist of upstream hosts.** Any public host on port 80/443 is fetchable.
  That is deliberate — "import from a URL" would be much less useful otherwise —
  but it means the relay's egress is broad.
- **No response-content validation.** The relay returns bytes; deciding whether
  they are a document is entirely the client's ingest pipeline
  ([`src/store/importExport/ingest.ts`](../src/store/importExport/ingest.ts)). The relay will happily fetch
  4 MB of anything.
- **4 MB is the ceiling for every relayed import**, including Google Drive, which
  always goes through the relay. The client's 20 MB archive and 5 MB text caps
  only apply to hosts the browser can fetch directly. Raising it is not a code
  change: a Vercel Function cannot return a body much over 4.5 MB, buffered or
  streamed through the standard response.
- **Redirect handling is not covered end to end by tests.** `assertPublicUrl` is
  tested directly and is called per hop, but there is no test that drives
  `safeFetch` through an actual redirect chain with a stubbed `fetch`.
- **A static deployment has no relay.** Building `dist-app/` and hosting it on a
  plain static host means `/api/import` 404s; the client falls through to the
  download-and-drag guidance. The npm library has no relay either — a host app
  embedding the editor would need to provide its own.
- **`ALLOWED_ORIGIN` names this project's two production origins exactly.** A
  fork on its own domain works same-origin without touching it; only a
  deliberately CROSS-origin reader would need an edit — and such a request is
  refused by the `Sec-Fetch-Site` gate first, so today the grant is defence in
  depth, not a working path.
- **Timeouts are wall-clock, not byte-rate.** A host that trickles bytes for 19.9
  seconds holds a connection the whole time. There is no slow-loris guard beyond
  the total timeout.

---

## If you want to make it more effective and more hardened

Roughly in order of value per unit of work.

**Effectiveness**

1. **Cover the redirect chain with tests.** Inject `fetch` into `safeFetch`, drive
   a chain that ends on a blocked address, and assert it is refused at the hop it
   should be. This is the highest-risk uncovered path in the file.
2. **Stream instead of buffering.** `readCapped` accumulates the (≤ 4 MB) body in
   memory before responding. Piping the upstream stream to the response, still
   counting bytes, would cut time-to-first-byte — it would not lift the
   platform's response-size ceiling.
3. **Conditional requests.** Forward `If-None-Match`/`If-Modified-Since` and honour
   `304`, so re-importing an unchanged document is nearly free.
4. **Better format hints.** The client already sniffs; forwarding
   `Content-Length` and the final post-redirect URL (as another `X-…` header)
   would let it pick a format without reading the body first.

**Hardening**

5. **Move the rate limit off the instance.** Vercel KV / Upstash / any shared
   counter turns a best-effort speed bump into an actual quota. Key it on IP *and*
   a coarse global ceiling so one attacker cannot exhaust the function's
   concurrency.
6. **Verify the client IP properly.** Take the *rightmost* trusted hop from
   `x-forwarded-for` rather than the leftmost, or use the platform's verified IP
   field, so the rate-limit key cannot be chosen by the caller.
7. **Add a byte-rate floor.** Abort a connection delivering under N bytes/sec, so a
   slow upstream cannot pin a function instance for the full timeout.
8. **Re-validate the IP at connect time**, not just at lookup time — a defence in
   depth on top of pinning, cheap to add inside the dispatcher's `connect`.
9. **Cap total egress per instance** (a rolling byte counter), so the relay cannot
   be used as a bandwidth amplifier even within the request-count limit.
10. **Make `ALLOWED_ORIGIN` configurable** via an environment variable with the
    two production origins as the default, if a cross-origin reader ever becomes
    a real use case. This is the only place the relay knows the deployment's
    identity.
11. ~~Structured refusal logging.~~ Done: one JSON line per request, every path
    (see [Operating it](#operating-it-owner-setup)). What is still missing is an
    alert on top of it, which is a platform setting.

**Replacing it**

If you ever move to a different host, the contract the client depends on is small
and worth preserving exactly:

- `GET /api/import?url=<encoded absolute URL>`
- `200` with the **raw bytes** and a non-renderable content type
- the upstream type in `X-Upstream-Content-Type`
- `413` with `{ "error": "<message for the user>" }` means "too large for the
  relay" — the client shows that message
- any other non-`2xx` means "fall through to the download-and-drag guidance"

Everything else in `api/import.js` is implementation.

---

## Related docs

- [architecture.md](architecture.md) — where the relay sits in the whole system
- [data-pipeline.md](data-pipeline.md) — what happens to the bytes after they arrive
- [../SECURITY.md](../../../SECURITY.md) — reporting a vulnerability
- [workflows.md](workflows.md) — the verify gate, deployment, what to run before a PR
