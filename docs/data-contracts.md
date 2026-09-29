# Data Contracts — identifiers that must not be renamed

> **The product is called Markdown Studio. Several DATA identifiers still say
> `perssonify`. That split is deliberate and permanent — do not "fix" it.**

There is no server-side copy of anyone's data and no migration endpoint.
Everything a user owns lives in their own browser, or in files they already
exported to their own disk. That
makes these strings **on-disk contracts**: the app finds a returning user's data
by matching them exactly. Rename one and the data is still there, but the app no
longer recognises it — which a user experiences as "my documents are gone".

## The identifiers

| Identifier | Where it lives | What breaks if it changes |
| --- | --- | --- |
| `pf:` key prefix | localStorage keys (`pf:workspace`, `pf:font-size`, `pf:fr-*`, …), including the unload stash `pf:recovery` and the `pf:library-canary` that tells a wiped library from a first visit | Every returning visitor's settings reset to defaults; unsaved drafts stashed at unload are not found |
| `perssonify-theme` | the theme preference key in localStorage (next-themes `storageKey`, app and embed) | Every returning visitor's light/dark choice resets |
| `perssonify-document` | the `_format` field of the export/backup JSON envelope | Every `.json` file a user has already exported stops being recognised on import |
| `perssonify-backup` | the full-library archive name | Re-import detection keys on it — a backup ZIP would import as a folder of loose files instead of restoring library state |
| `perssonify-snapshots` | sidecar IndexedDB database (recoverable version history) | The whole snapshot ring is orphaned — the last-resort recovery net for a wiped document |
| `perssonify-docs` | the main IndexedDB database (documents + `__manifest` / `__prefs`), in the standalone app and in self-hosted iframe embeds alike ([decisions.md](decisions.md)) | The user's entire library is orphaned |
| `perssonify-embed-docs` | the iframe embed's database when it is served from one of the app's own hosts (`APP_HOSTS`), with `perssonify-snapshots:perssonify-embed-docs` and `pf:recovery:perssonify-embed-docs` beside it ([decisions.md](decisions.md)) | Every embed user on those hosts opens on an empty library |
| `perssonify` | the iframe `postMessage` protocol tag ([host-bridge.ts](../src/integration/host-bridge.ts)) | Every existing embedder's bridge stops handshaking |
| `@perssonify/editor` | the npm package name | Every existing import in every embedder breaks |

A library host that passes its own `storageConfig` (`dbName` or `namespace`)
gets suffixed names for two of these — `perssonify-snapshots:<namespace>` and
`pf:recovery:<namespace>` — so its users' version history and unload stash are
kept apart ([src/store/documentStore.ts](../src/store/documentStore.ts)
`configureLocalStores`). The unsuffixed names above are the standalone app's
and stay exactly as they are.

The user-visible name is **not** in that list. It is single-sourced from
`APP_NAME` in [src/constants.ts](../src/constants.ts), with `APP_DOMAIN` /
`APP_URL` beside it. Surfaces that cannot import TypeScript — `index.html`,
`embed.html`, `public/site.webmanifest`, and the PWA manifest in
`vite.app.config.ts` — repeat the string, and are pinned to it by a test.

## How this is enforced

[`src/__tests__/app-identity.test.js`](../src/__tests__/app-identity.test.js)
asserts both halves at once: that the display name is consistent everywhere, and
that the `pf:` prefix, the `perssonify-document` envelope, the
`perssonify-backup` archive name, the `perssonify-snapshots` database and the
`@perssonify/editor` package name are untouched. **Do not weaken or delete that
test.** If it fails, the change is wrong — not the test. (The remaining rows —
the `perssonify-theme` key, the `perssonify-docs` database name and the bridge
protocol tag — are not covered by that test; treat them as equally frozen.)

## Related

- [database.md](database.md) — the IndexedDB stores, keys and record shapes.
- [features.md](features.md) — full backup / restore and version history, the two
  features that depend most directly on these strings.
- [`CLAUDE.md`](../CLAUDE.md) — the same warning, in the agent-facing context file.
