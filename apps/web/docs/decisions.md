# Decisions

Short records of product and operational choices that were argued about, so the
next person does not have to re-argue them from scratch. Newest first. Each says
what was decided, what was rejected, and what it costs.

---

## 2026-10-22 — Google Analytics on the production site, with consent everywhere

**Decision:** the production deploy on Vercel loads Google Analytics 4
(G-WFN9X3MKR0) (`src/utils/analytics.ts`). It reports one page view per route,
carrying the route's path and title, never the address bar. Previews, local
and e2e builds, the iframe embed and the npm library carry none of it.

**Consent, for every visitor in every country:** Google's Consent Mode starts
with every storage type denied — no cookies, only cookieless pings — and a bar
asks "Allow" or "Decline", equally prominent (`src/app/analyticsConsent`,
`src/utils/analytics-consent.ts`). It is under the editor's header and under
the header of every interior page (About, Help, Sign in, Profile), and a first
visit's guided tour waits for the answer, because its overlay would cover the
bar. "Decline" stops gtag.js at once, removes its cookies and loads nothing on
later visits; "Allow" allows analytics cookies, never advertising ones.
Settings ▸ Privacy ▸ Usage analytics changes the answer.

**Rejected, in order:** a prompt for every visitor and an opt-in-only switch
(the owner first chose to load it for everyone); loading for everyone without
asking, once the EU/UK question came up; then asking only in the EEA, the UK
with its Crown dependencies and Gibraltar, and Switzerland (Google's
regional default by IP, plus a time-zone guess for the bar, since Google never
tells the page where it placed a visitor). The owner chose to ask everyone,
which also removes the region list and the guess. Cost: outside Europe, too,
visits counted with cookies are now only those of visitors who allow them.

**Why the route and not the URL:** `#share=` carries the shared documents
themselves, `#live=` the id that is a live share's only permission, and
`?import_url=` an address the user imports from. Google's default page view
sends `location.href`. Document titles never reach `document.title`.

**Cost:** the About page's "No analytics or tracking" promise is gone; the
About and Help copy now say what is collected. Marketing copy under
`marketing/` and `docs/why-markdown-studio.md` still made that promise when
this landed. Cookieless pings before an answer are what Consent Mode's
"advanced" setup does; some regulators read even those as needing consent. No
privacy policy page names Google Analytics yet, which Google's terms require.
**Owner setup in Google Analytics:** turn off Enhanced measurement ▸
Page views ▸ "Page changes based on browser history events" for the web
stream. Left on, it counts every route twice and reports the full address on
a history change, including a share link pasted into an open tab (a
same-document navigation). The app cannot switch that off from code.

---

## 2026-09-30 — On the app's own hosts, the embed keeps its own database (A072)

**Decision:** when the embed build is served from one of the app's own hosts
(`APP_HOSTS` in `src/constants.ts`: markdownstudio.com, www.markdownstudio.com,
markdownstudio.perssonify.com, the legacy markdowneditor.perssonify.com, and
localhost / 127.0.0.1 in development), it stores its documents in
`perssonify-embed-docs`, and its version history and crash stash follow that
name (`perssonify-snapshots:perssonify-embed-docs`,
`pf:recovery:perssonify-embed-docs`). On any other host — a self-hosted embed —
it keeps `perssonify-docs`.

**Why:** on an app host the app's library is in `perssonify-docs`, and the
embed's bridge can read and overwrite every document the embed sees, so any
page that framed the embed there could reach the whole library. The entry
below kept one name everywhere so that no embed user's documents were
orphaned; that still holds where it matters (self-hosted embeds keep their
users' documents under the old name), and the exposure is gone where the app
lives. This answers that entry's "Revisit if".

**Cost:** an embed that was ever served from an app host opens there on an
empty library; its earlier documents stay in `perssonify-docs`, where the app
on the same host shows them. None is served from one today (the production
deploy does not ship the embed). Code: `embedStorageConfig`
(`src/integration/embed-origins.ts`), called from `src/embed.tsx`; test:
`embed-storage.test.js`.

---

## 2026-09-29 — The iframe embed keeps its database name (A072)

*Refined on 2026-09-30 (above): on the app's own hosts the embed now keeps a
database of its own. Everywhere else this entry stands.*

**Decision:** the embed keeps storing documents in the default IndexedDB
database (`perssonify-docs`); it does not get a database of its own.

**Why:** the audit suggested a separate database so a framing page could not
reach the standalone app's library on the same origin. But self-hosted embeds
(`dist-embed/`, served by integrators) already store their users' documents in
`perssonify-docs` on their own origins; renaming it would open every existing
embed on an empty library — their documents orphaned, not lost, but invisible.
The protection is placed where it does not cost data: where the browser reports
the framing page (`location.ancestorOrigins` — Chromium and WebKit), the bridge
talks only to that page, and a deploy-time allowlist
(`VITE_EMBED_ALLOWED_ORIGINS`) decides who that may be
(`src/integration/embed-origins.ts`). An embed built without the allowlist still
trusts whichever page frames it.

**Revisit if:** the embed is ever served from markdownstudio.com itself (today
`/embed.html` there is the full app). Then either migrate (copy on first open)
or serve the embed from its own origin.

---

## 2026-09-29 — No third-party error tracker; a local diagnostics ring (A009)

**Decision:** errors are captured into a small, redacted, local ring
(`src/utils/diagnostics.ts`) that a user can copy from the crash screen or Help
▸ About. Nothing is sent anywhere. `setErrorReporter(fn)` (exported by the
library) and the `ErrorBoundary`'s `onError` prop are the hook a host — or a
future first-party endpoint — can subscribe to.

**Why:** the product's privacy position (documents stay in the browser, no accounts) makes a
third-party tracker a real change of promise, and none has been chosen. A ring
that holds only kind, version, browser family, error class, a redacted first
line and script positions is useful in a bug report without being a data
pipeline.

**Cost:** the team only learns about field errors when someone reports them.
Adding an endpoint later is a subscriber, not a rewrite.

---

## 2026-09-29 — Content-Security-Policy ships report-only; anti-framing is enforced (A068)

**Decision:** the full policy starts as `Content-Security-Policy-Report-Only`,
hash-pinned to the inline scripts; `frame-ancestors 'none'` +
`X-Frame-Options: DENY` are enforced on the app from day one (never on
`/embed.html`).

**Why:** a wrong enforcing CSP breaks the app for everyone, and the app loads
code and styles in several unusual ways (Mermaid, KaTeX, zip.js's WebAssembly,
lazy chunks, a service worker). Anti-framing, by contrast, cannot break a
renderer. The e2e suite `csp` runs the build with the policy ENFORCED and
requires zero violations, so promoting it is a small, evidenced step
([deployment.md ▸ CSP](deployment.md#content-security-policy)).

---

## 2026-09-29 — Updates are prompted, never forced (A008)

**Decision:** the service worker uses `registerType: "prompt"`. A new version
waits until the user presses Reload (or closes every tab). A tab may reload by
itself only when it is online, has nothing unsaved and is in the background,
and never while offline.

**Rejected:** the previous auto-update (skip waiting, claim clients, reload on
`controllerchange`, and a worker that navigated every open window). It
delivered deploys fast by force-reloading tabs mid-edit — undo history, IME
compositions and open dialogs lost, and a surprise "Leave site?" prompt.

**Cost:** an open tab can run an older build until its user presses Reload; a
critical fix must say so. Online page loads still get the current HTML, and an
open tab asks for a new version once an hour (while online and visible), so a
long-lived tab is at least told.

---

## 2026-09-29 — Opening a file by link keeps its one click (A003)

**Decision:** `?import_url=` keeps opening the importer with the address filled
in, and the user presses **Fetch**. It does not fetch on page load, including
for Google Drive links (`src/App.tsx` reads the parameter; `UrlImportDialog`
opens pre-filled; its `autoStart` option stays unused for deep links).

**Options considered:**

1. *Keep one click* (chosen).
2. Auto-open every `?import_url=` link.
3. Auto-open only Google Drive links.

**Why:** a shared link that fetched on load would make every visitor's browser
request an address the visitor has not seen — a web beacon, a way to probe
whether a visitor can reach a host, and, through the relay, a way to make our
server fetch it. Since the relay now asks for consent before its first use, an
auto-fetch would also land the consent question on someone who has not yet
decided to import anything. One click is the moment the visitor sees the
address and chooses. Limiting auto-open to Google Drive would not remove the
problem (Drive links can be anyone's) and would make the behaviour depend on
the host, which is harder to explain than one rule.

**Cost:** one extra click for a link whose purpose is "open this file". The
importer opens pre-filled with the address field focused, so it is one click
(or Enter), not a form.

**Revisit if:** links are ever signed by the app (so the address is not
attacker-chosen), or users show that the extra click causes real drop-off.
