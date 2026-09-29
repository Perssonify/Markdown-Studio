# Runbook — Documents Disappeared

**Do not tell a user their work is gone until you have checked all four
recovery paths below.** Most "it's gone" reports are recoverable in the app
itself, and the first thing a support reply says decides whether the user keeps
the evidence (and the data) or clears site data in frustration.

## Symptoms
- The library (Files tab) is empty, or one document is missing or rolled back.
- "I typed something, closed the tab, and it's not there."
- Fewer documents after a browser restart, an OS update, "clear browsing data",
  or after opening the app on a different domain, browser, or profile.

## First: ask for two things
1. **Copy diagnostics** (crash screen, or Help ▸ About). It lists recent failed,
   refused or conflicted saves, quota errors and boot-watchdog recoveries —
   never document content. `save-blocked` = the app refused to overwrite a
   document with an empty editor; `save-conflict` = another tab wrote it first.
2. **Where they use it**: the exact address (storage is per-ORIGIN — `www.` and
   the bare domain, a preview URL, or an old domain are different libraries),
   the browser and profile, and whether it is a private window (private-window
   storage is discarded when the window closes).

## The recovery paths, in order

### 1. Version history — Tools ▸ Version history
A separate IndexedDB database (`perssonify-snapshots`) keeps earlier versions of
every document: up to 20 per document, for up to 30 days, ~12 MB in total, and
it never evicts a document's most recent snapshot. It records a version when an
autosave is about to overwrite older content (throttled), always before a large
shrink or an explicit clear (`pre-clear`), before a restore (`pre-restore`), and
**before a document is deleted (`pre-delete`)**.

- A rolled-back or emptied document: open it, then Version history ▸ **Restore
  in place** (the current content is snapshotted first, so this is reversible).
- A **deleted** document: Version history lists it under **"Other & deleted
  documents"** — **Restore as new document**.

### 2. The unload stash — automatic, on the next visit
Text typed inside the autosave window and then lost to a reload or a closed tab
is written synchronously to `localStorage` (`pf:recovery`) as the page unloads,
because IndexedDB cannot finish a write while a page is being torn down. On the
next start, `documentStore.initialize()` adopts it — for documents that still
exist, and only when the stash is newer than what is on disk — as an **unsaved
draft** (status bar: unsaved changes); the next autosave writes it.

It is **one-shot** (removed as it is read, so it cannot resurrect itself over
newer work), expires after 7 days, and holds at most 2 MB. So: ask the user to
**open the app again in the same browser and profile** before anything else.

### 3. Backups they made
File ▸ Export ▸ **Full backup (.zip) — restorable**, or an earlier export. Import
the ZIP (drag it onto the editor, or File ▸ Import): documents come back with
their folders, titles, tags and timestamps.

### 4. The raw database (only when the library LIST is wrong)
The library list is **not** re-derived from the stored documents.
`initialize()` calls `storage.list()`, which returns the `__manifest` record in
the `meta` store exactly as stored. A document whose record exists in
`documents` but is missing from the manifest (an interrupted write) stays
invisible after every reload — reloading does not repair it.

In DevTools on the app's own origin, console:

```js
const db = await new Promise((r, j) => { const q = indexedDB.open("perssonify-docs"); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
const get = (store, key) => new Promise((r) => { db.transaction(store).objectStore(store).get(key).onsuccess = (e) => r(e.target.result); });
const allKeys = await new Promise((r) => { db.transaction("documents").objectStore("documents").getAllKeys().onsuccess = (e) => r(e.target.result); });
const manifest = JSON.parse((await get("meta", "__manifest")) || '{"documents":[]}');   // stored as a JSON STRING
const listed = new Set(manifest.documents.map((d) => d.id));
console.table({ storedRecords: allKeys.length, listedInManifest: listed.size });
console.log("stored but not listed:", allKeys.filter((k) => !listed.has(k)));
```

- **Both empty** → the browser's storage for this origin is gone (see below).
- **Stored but not listed** → the records are intact. Get them out rather than
  editing the database: for each id, `JSON.parse(await get("documents", id))` is
  a full document record; save them (e.g. `copy(JSON.stringify(records))`) and
  have the user import a backup built from them, or file a bug with the list so
  a developer can rebuild the manifest. Do not hand-edit `meta` on a user's
  machine as a first resort.
- **`__prefs.lastActiveDocId` points at a missing id** → only the restore of
  the last-open document is affected; `initialize()` falls back to the most
  recently updated document.

## When the storage really is gone
Browser storage for an origin can be removed by "clear browsing data", by
Safari's seven-day cap on script-writable storage for sites that are not
installed to the Home Screen/Dock, by Chromium evicting a non-persistent origin
under disk pressure, and by private windows closing. Version history lives in
the same origin's storage and goes with it. Only backups/exports survive.
Recent builds ask the browser to keep this origin's data persistent after the
first save, nudge people to make a full backup, and explain an emptied library
instead of re-seeding the starter documents (Settings ▸ Storage shows the
state).

What is NOT a cause: the **boot watchdog** (inline in index.html) and a
**service-worker update** only ever touch Cache Storage and worker registrations
— never IndexedDB or localStorage.

## Prevention
- A **Full backup** is the only copy that survives the browser losing the
  origin's storage. Say so plainly.
- Installing the app (Home Screen / Dock) exempts it from Safari's seven-day
  eviction.

## Escalation
No on-call. File an issue with: browser + version, the address used, whether
storage was cleared, the Copy-diagnostics text, and the console output of the
snippet above. The write path is [src/store/documentStore.ts](../../src/store/documentStore.ts)
(`saveActiveDoc`, `initialize`) + [src/store/idb-storage-adapter.ts](../../src/store/idb-storage-adapter.ts);
the snapshot ring is [src/store/snapshot-store.ts](../../src/store/snapshot-store.ts);
the unload stash is [src/store/crash-recovery.ts](../../src/store/crash-recovery.ts).
