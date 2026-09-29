# Authentication & Authorization

> **TL;DR — there is none, by design, as of June 2026.** The app is a local-first, single-user, client-only SPA. There is no login, no session, no roles, no server to authenticate against. The root [`README.md`](../README.md) says the same thing; this doc adds the detail and the history, so you don't go hunting for files that don't exist.

## Identity model

There is no concept of a "user" entity in this codebase. Documents are not owned by anyone; they belong to whoever has the browser tab. The only persisted "identity-ish" data are:

- **Theme preference** — `localStorage["perssonify-theme"]` (via `next-themes`, [src/main.tsx](../src/main.tsx)).
- **App preferences** — the `__prefs` record in IndexedDB (last active doc, sync mode, editor mode). See [database.md#the-meta-store](database.md#the-meta-store).

None of these identify a person; they're per-browser settings.

## What's authenticated

Nothing. Every feature in [features.md](features.md) is reachable by anyone who loads the page. This is acceptable because:

1. **No shared backend** — there is no data on a server to protect; everything lives in the visitor's own browser (IndexedDB / localStorage).
2. **No multi-tenancy** — one browser profile = one user's data, isolated by the browser's same-origin storage partitioning.
3. **Access control, if needed, belongs to the host.** When embedded via [`<PerssonifyEditorIntegration>`](../src/integration/PerssonifyEditorIntegration.tsx), the *embedding application* is responsible for gating who can open the editor.

## What used to exist (history — so you don't resurrect it by accident)

None of this is in the code any more:

- A `middleware.ts` Vercel Edge gate — **does not exist** (verified: no `middleware.ts` anywhere in the repo). The only server-side file is [`api/import.js`](../api/import.js), the same-origin fallback relay for "Import from URL" — it is unrelated to auth and reads no secrets.
- A `MARKDOWNEDITOR_PASSWORD` env var with SHA-256 + timing-safe comparison — **not referenced anywhere** in `src/` (verified: no `.env*` files, no password logic).
- A `me_auth` HttpOnly cookie / `POST /__auth` login — **gone**.

The removal is recorded in git:

```
84d7099 refactor: remove login form and authentication logic from App component
```

[`vercel.json`](../vercel.json) today is a plain static SPA config — build with Bun, output `dist-app/`, rewrite everything **except `/api/*`** to `/index.html`. No middleware, and the single serverless function (`api/import.js`) is the import relay, not an auth gate.

> If a future requirement reintroduces auth, do **not** restore the old middleware blindly — design it against the current static-SPA + optional-embed model. Note this doc and [gotchas.md](gotchas.md) when you do.

## Authentication flow

```mermaid
flowchart LR
    A([User opens app]) --> B[Static assets served by Vercel]
    B --> C[SPA boots: src/main.tsx]
    C --> D[Documents loaded from IndexedDB]
    D --> E([Editing — no auth step anywhere])
```

There is no browser→server→token handshake to diagram, because there is no server step. The "session" is simply the browser tab plus its IndexedDB partition.

## Authorization model

No roles, no permissions, no scopes, no per-row checks. The only access *modulation* in the product is by **UI mode / device**, not by identity:

- Below 768px the split view stacks vertically instead of sitting side by side ([src/ui/EditorPanes.tsx](../src/ui/EditorPanes.tsx)).
- Decorative commands are gated by **Clean vs Styled** sync mode, not permissions ([src/ui/Toolbar.tsx](../src/ui/Toolbar.tsx), `DECORATIVE_CMDS`).

## Service-to-service / internal auth

The only cross-boundary channel is the **iframe `postMessage` bridge** used when the editor is embedded ([src/integration/host-bridge.ts](../src/integration/host-bridge.ts)). Its "auth" is **origin checking**:

- Both `createHostBridge` and `createEditorClient` accept an `allowedOrigins` option.
- **Default is `[]` (deny-all)** — the bridge ignores incoming messages until the embedder passes an explicit allowlist of trusted parent origins (or `["*"]` to intentionally accept any). This is a secure-by-default change from the old `["*"]`. See the CSRF/origin note below.

## Common auth gotchas

- **Don't resurrect the removed gate.** If you find a reference to `middleware.ts`, `MARKDOWNEDITOR_PASSWORD`, or a `me_auth` cookie in an old branch, note or doc, it predates commit `84d7099` — none of it is in the current code.
- **`allowedOrigins` defaults to `[]` (deny-all).** If you embed the editor, pass an explicit allowlist to both `createHostBridge` and `createEditorClient` ([src/integration/host-bridge.ts](../src/integration/host-bridge.ts)); with no allowlist the bridge ignores incoming messages. Passing `["*"]` accepts any origin, meaning any page that can frame the editor can drive its imperative API (read/replace document content) via `postMessage` — opt into that deliberately.
- **CSRF / CORS:** Not applicable in the classic sense — there are no authenticated server endpoints and no cookies used for access. The relevant attack surface is **postMessage origin spoofing**, mitigated only by setting `allowedOrigins`.
- **No data-at-rest encryption.** IndexedDB content is plaintext and readable by anything with access to the browser profile / devtools. Don't store secrets in documents.
- **Dev vs prod:** identical from an auth standpoint (none). The only environment difference is which origin embeds you.
