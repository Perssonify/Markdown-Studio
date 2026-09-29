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
| **The relay itself** | [`api/import.js`](../api/import.js) | Vercel Serverless Function, Node runtime. Default export is the handler; `isBlockedIp` and `assertPublicUrl` are exported for tests. |
| **The client that calls it** | [`src/store/url-import.ts`](../src/store/url-import.ts) | `fetchDirectOrProxy` — tries a direct browser fetch first, falls back to the relay. `IMPORT_RELAY = "/api/import?url="`. |
| **Provider URL rewriting** | [`src/store/import-url-normalize.ts`](../src/store/import-url-normalize.ts) | Turns share links into raw-download links *before* either fetch path runs. |
| **The UI** | [`src/ui/UrlImportDialog.tsx`](../src/ui/UrlImportDialog.tsx) | Discloses to the user when the relay was used ("first-party — not a third-party proxy"). |
| **Tests** | [`src/__tests__/import-relay.test.js`](../src/__tests__/import-relay.test.js) | SSRF blocklist, `assertPublicUrl`, the `Sec-Fetch-Site` gate, response hardening, the port allowlist. |
| **Routing** | [`vercel.json`](../vercel.json) | The SPA rewrite is `/((?!api/).*)` — the `api/` exclusion is what keeps this function reachable. Delete it and every relay call returns `index.html`. |

There is **no other server code in the repo.** If you are looking for a backend, this is it.

---

## Why it exists

Markdown Studio imports documents from a URL. The browser does that with `fetch()`,
which is subject to CORS: the *upstream* host decides whether a page on another
origin may read its bytes. Plenty of hosts say no — most importantly **Google
Drive**, which sends no `Access-Control-Allow-Origin` header to a real browser at
all. Without a server hop, "Import from URL" simply cannot work for those hosts.

The alternative — routing through a public CORS proxy — was rejected: it hands a
third party the URL, the bytes, and the user's IP, for a product whose entire
privacy story is "your documents never leave your browser." A first-party relay on
the app's own origin keeps the request inside the deployment.

**The relay is a fallback, not the default path.** `fetchDirectOrProxy` attempts a
direct browser fetch first, and only retries through `/api/import` when that throws
(CORS or network error). Hosts the browser can already read — GitHub raw, Dropbox,
anything that sets the CORS header — never touch the relay at all. A direct
*timeout* is surfaced as a timeout and is **not** retried, because a slow origin
does not get faster through an extra hop.

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
      │       assertPublicUrl → DNS → IP blocklist  │
      │       pin those IPs to the connection       │
      │       fetch with redirect:"manual"          │
      │  7. readCapped: 25 MB hard ceiling          │
      │  8. respond octet-stream + attachment + CSP │
      └─────────────────────────────────────────────┘
             │
             ▼
      bytes ──▶ ingest   (format sniffed from body + URL + X-Upstream-Content-Type)
```

### Limits, in one table

| Knob | Value | Where |
|------|-------|-------|
| Max response size | 25 MB (`MAX_BYTES`) | `api/import.js` — headroom over the client's 20 MB archive ceiling |
| Upstream timeout | 20 s (`TIMEOUT_MS`) | `api/import.js` |
| Client timeout | 15 s (`URL_TIMEOUT_MS`) | `src/store/url-import.ts` — so the client gives up first |
| Redirect hops | 5 (`MAX_HOPS`) | `api/import.js` |
| Rate limit | 40 req / 60 s per IP (`RATE_MAX`) | `api/import.js` — in-memory, **per warm instance** |
| Client text cap | 5 MB (`MAX_URL_BYTES`) | `src/store/url-import.ts` |
| Client archive cap | 20 MB (`MAX_ARCHIVE_BYTES`) | `src/store/url-import.ts` |

---

## The threat model, control by control

An unauthenticated endpoint that fetches an arbitrary URL is, by default, three
vulnerabilities wearing a trench coat: an SSRF gadget, an open proxy, and an XSS
vector. Each control below exists because of one of those.

### 1. SSRF — "fetch this and tell me what you see"

The attack is `?url=http://169.254.169.254/latest/meta-data/` (cloud credentials),
or any address on the deployment's internal network.

- **`isBlockedIp`** refuses loopback, `0/8`, `10/8`, `172.16/12`, `192.168/16`,
  link-local `169.254/16` (which is also the cloud-metadata address), and CGNAT
  `100.64/10`. On the IPv6 side: `::`, `::1`, `fe80::/10` link-local, `fc00::/7`
  unique-local — **and the IPv4-embedded forms**, which are the classic bypass:
  `::ffff:127.0.0.1` (mapped), `64:ff9b::/96` (NAT64) and `2002::/16` (6to4) are
  unwrapped to their underlying IPv4 and re-checked.
- **Checked after DNS resolution, not on the string.** `assertPublicUrl` resolves
  the hostname with `dns.lookup(..., {all:true})` and rejects if *any* returned
  address is blocked. A hostname that resolves to `127.0.0.1` is refused.
- **Unparseable input fails closed** — `isBlockedIp` returns `true` for anything
  that is not a valid IP.

### 2. DNS rebinding — the TOCTOU on top of the SSRF check

Validating an IP and then calling `fetch()` lets the resolver hand back a
*different* address the second time. The fix is **pinning**: `pinnedDispatcher`
builds an undici `Agent` whose `lookup` returns only the already-vetted addresses,
and refuses if the hostname does not match. `fetch` cannot re-resolve.

### 3. Redirects — where most relay hardening leaks

`safeFetch` sets `redirect: "manual"` and walks the chain itself, calling
`assertPublicUrl` **and** building a fresh pinned dispatcher for **every hop**. A
public URL that 302s to `http://169.254.169.254/` is caught on hop 2. The port
allowlist lives inside `assertPublicUrl` for the same reason — put it only on the
initial URL and a redirect to `http://host:6379` walks straight through.

### 4. Open proxy — "use their server to fetch my traffic"

- **`Sec-Fetch-Site` must be `same-origin` or `none`.** It is a forbidden header,
  so page JavaScript cannot spoof it; the app's own fetch sends `same-origin`, a
  direct navigation sends `none`. **An absent header is rejected** — that is the
  signature of a non-browser client (curl, another server), which is exactly the
  abuse path.
- **Ports 80 and 443 only.** A relay that connects to any port is a port scanner
  even against public hosts.
- **Per-IP rate limit**, best-effort (see Limitations).
- **`Access-Control-Allow-Origin` is echoed only for matching origins**, from a
  regex that **requires a hyphen** before any suffix — `markdown-studioevil.vercel.app`
  does not match, while real preview URLs (`markdown-studio-git-…`) do.

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

### The unit tests (what CI runs)

```bash
bun run test src/__tests__/import-relay.test.js
```

They import `isBlockedIp`, `assertPublicUrl` and the handler directly and drive the
handler with fake `req`/`res` objects — **no network, no Vercel**. That is why the
suite covers the address classifier, the `Sec-Fetch-Site` gate, response hardening
and the port allowlist, and does *not* cover redirect-chain behaviour end to end
(see Limitations).

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

Against a deployment, the endpoint is reachable only as a first-party request —
`curl https://…/api/import?url=…` is **supposed** to return `403`, because curl
sends no `Sec-Fetch-Site`. To test by hand, open the deployed app and use
**Tools ▸ Import from URL** with a CORS-blocked host (a Google Drive share link is
the canonical case), then confirm the dialog shows the "server relay" disclosure.

### Adding a control

1. Put the logic in `api/import.js` as an **exported pure function** if it is
   classifiable input (like `isBlockedIp`), so it can be unit-tested without a
   network.
2. If it applies to a URL, put it in **`assertPublicUrl`**, not in the handler —
   that is the function every redirect hop calls. Handler-level checks only see
   hop 0.
3. Add the test to `import-relay.test.js`, then **break the control and confirm the
   test fails.** A guard with a test that passes either way is not a guard.

---

## Current limitations

Stated plainly, because the next person will hit them:

- **The rate limit is per warm instance, in memory.** `rateBuckets` is a `Map` in
  a serverless function. Scale out, or get a cold start, and the counter resets.
  It raises the cost of casual abuse; it is not a real quota.
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
  ([`src/store/ingest.ts`](../src/store/ingest.ts)). The relay will happily fetch
  25 MB of anything.
- **Redirect handling is not covered end to end by tests.** `assertPublicUrl` is
  tested directly and is called per hop, but there is no test that drives
  `safeFetch` through an actual redirect chain with a stubbed `fetch`.
- **A static deployment has no relay.** Building `dist-app/` and hosting it on a
  plain static host means `/api/import` 404s; the client falls through to the
  download-and-drag guidance. The npm library has no relay either — a host app
  embedding the editor would need to provide its own.
- **The `ALLOWED_ORIGIN` regex is hardcoded to this project's domains.** Fork the
  repo, deploy to your own domain, and relayed responses become unreadable
  cross-origin until you edit that constant. Same-origin requests are unaffected.
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
2. **Stream instead of buffering.** `readCapped` accumulates the whole body in
   memory before responding. Piping the upstream stream to the response (still
   counting bytes against the cap) would cut memory and time-to-first-byte, and
   make the 25 MB ceiling much cheaper to raise.
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
    current regex as the default, so a fork does not have to patch source. This is
    the only place the relay knows the deployment's identity.
11. **Structured refusal logging.** Today a refusal returns a status and vanishes.
    Emitting a one-line structured log per refusal (reason, host, IP) makes abuse
    visible; without it, nobody will ever know the relay is being probed.

**Replacing it**

If you ever move to a different host, the contract the client depends on is small
and worth preserving exactly:

- `GET /api/import?url=<encoded absolute URL>`
- `200` with the **raw bytes** and a non-renderable content type
- the upstream type in `X-Upstream-Content-Type`
- any non-`2xx` means "fall through to the download-and-drag guidance"

Everything else in `api/import.js` is implementation.

---

## Related docs

- [architecture.md](architecture.md) — where the relay sits in the whole system
- [data-pipeline.md](data-pipeline.md) — what happens to the bytes after they arrive
- [../SECURITY.md](../SECURITY.md) — reporting a vulnerability
- [workflows.md](workflows.md) — CI, deployment, what runs on a PR
